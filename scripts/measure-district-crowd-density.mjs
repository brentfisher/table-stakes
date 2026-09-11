#!/usr/bin/env node
// District crowd density measurement — STORY-046.
//
// Requested: "show many more people deciding to go to neither restaurant to show the crowds
// just walking by." STORY-044 made every district party (including one that never picks a
// restaurant) actually render and walk; STORY-045 let a player Peek at it. This story is the
// TUNING pass, and per `docs/kb/conventions.md`'s own testing rule 3 ("measure, don't assert —
// a figure that misses its target is reported as a finding, not tuned away"), the honest first
// step is to MEASURE the real numbers from a real `Match` before touching anything:
//
//   1. the real non-conversion rate — parties that never pick a restaurant at all
//      (`LEAVE_DISTRICT`, `match.districtDecisions.filter(d => d.chosenRestaurantId === null)`,
//      the same district-wide definition `check-district-choice.mjs` section 1 already uses),
//      PLUS the per-restaurant "did not choose ME" fraction the story's own AC1 names
//      (`CHOOSE_RIVAL` + `LEAVE_DISTRICT` against `customer-system.js#districtSummary`'s
//      `view.counts` — see the "two different denominators" note below for why these two
//      numbers answer different questions and both are reported);
//   2. how long a NON-CONVERTING party is actually visible end to end today — not a hand-derived
//      estimate from `CUSTOMER_ENTER_DISTRICT_MS`/`CUSTOMER_EVALUATE_RESTAURANTS_MS`/
//      `CUSTOMER_EXIT_LINGER_MS`/`CUSTOMER_MOVE_SPEED` alone, but the REAL measured wall-clock
//      span from `party.spawnedAtMs` to the real tick `state.parties` actually drops the party's
//      id, watched directly the way `check-district-population.mjs` samples real per-tick state,
//      because the real exit-walk distance depends on wherever `spreadAcrossCandidates` happened
//      to place that party among however many others were leaving at that same instant — it
//      genuinely varies run to run, seed to seed.
//
// HARD BOUNDARY, enforced by never importing or touching it: `market.baseFootTrafficPerMinute`
// (`shared/game-data/markets.json`) and the choice model (`scoreRestaurant`/`softmaxPick`,
// `customer-system.js`) are read-only background here. This script only ever reads
// `match.districtDecisions`/`match.districtSummary`/`state.parties` — it never calls
// `_internal.spawnParty`/`_internal.resolveEvaluateRestaurants` to force a branch the way
// `check-district-choice.mjs`/`check-district-population.mjs` do; every number below comes from
// letting a real seeded match run end to end on its own arrival process and its own choice draws.
//
// Two runs are produced and compared: BEFORE (this file imports the CURRENT `tuning.js` values,
// so re-running this script after any tuning edit automatically measures the new numbers — there
// is no separate "after" mode. To compare across a change, run this script, edit tuning.js,
// re-run it, and diff the two console outputs) — see this story's Implementation notes for the
// actual before/after numbers this run produced.
//
// This is a REPORTING script, not a pass/fail check (this repo's own `check-bot.mjs` precedent
// for "measure, don't assert" — see conventions.md's Testing rule 3): it prints real numbers and
// draws no line under them. The pass/fail REGRESSION GUARD this story adds lives in
// `check-district-population.mjs` instead (a new section asserting a floor on the "pure walk-by"
// visible duration) — see that file for the falsifiable check.
//
// Run: node scripts/measure-district-crowd-density.mjs

import { Match } from '../server/src/game/match.js';
import { clearSystems, registerSystem, stepMatch } from '../server/src/game/simulation-loop.js';
import { customerSystem, _internal } from '../server/src/game/systems/customer-system.js';
import { orderSystem } from '../server/src/game/systems/order-system.js';
import { setupSystem } from '../server/src/game/systems/setup-system.js';
import { eventSystem } from '../server/src/game/systems/event-system.js';
import { CUSTOMER_STATES, isExitState } from '../shared/schemas/game-state.js';
import markets from '../shared/game-data/markets.json' with { type: 'json' };
import {
  CUSTOMER_ENTER_DISTRICT_MS,
  CUSTOMER_EVALUATE_RESTAURANTS_MS,
  CUSTOMER_EXIT_LINGER_MS,
  CUSTOMER_MOVE_SPEED,
  CUSTOMER_EXIT_OFFSET,
} from '../shared/constants/tuning.js';

const realLog = console.log;
function quiet(fn) {
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = realLog;
  }
}

const TICK_MS = 50;

function submission(mains) {
  return {
    menu: mains,
    addons: [],
    startingUpgradeId: null,
    staffAssignments: { cook_1: 'prep', server_1: 'dining_room' },
    startingInventory: {},
    policyId: null,
    policyDishId: null,
    upgradeCost: 0,
    inventoryCost: 0,
    cashRemaining: 0,
    submittedAtMs: 0,
    locked: false,
    autoFilled: false,
  };
}

const BASIC_MENU = [
  { dishId: 'smash_burger', price: 14 },
  { dishId: 'caesar_salad', price: 12 },
];

function makeDistrict({ id, seed = id, marketId = null } = {}) {
  // `phasePreset: 'full'` — this is a balance measurement against PRD §24's own targets, which
  // are written against a real-length match, not the `prototype` preset's compressed one.
  const match = new Match({ id, seed, phasePreset: 'full', requiredPlayers: 2, marketId });
  match.join({ fallbackPlayerId: 'p1' });
  match.join({ fallbackPlayerId: 'p2' });
  match.setReady('p1', true);
  match.setReady('p2', true);
  match.players.get('p1').setup = submission(BASIC_MENU);
  match.players.get('p2').setup = submission(BASIC_MENU);
  return match;
}

function runUntilPhase(match, phase, maxSteps = 20_000) {
  quiet(() => {
    for (let i = 0; i < maxSteps && match.phase !== phase && !match.ended; i += 1) {
      stepMatch(match, TICK_MS);
    }
  });
  return match.phase === phase;
}

/**
 * Runs one seeded district end to end through `service` + `final_rush` (the two phases
 * `customerSystem` is registered for — PRD §24's whole "a match" window), watching the REAL
 * `state.parties` map tick by tick so every duration below is a measured wall-clock span, not a
 * formula. Returns per-party records for every party that ever spawned in the district.
 */
function runAndObserve({ id, seed, marketId = null }) {
  const match = makeDistrict({ id, seed, marketId });
  runUntilPhase(match, 'service');
  const state = _internal.ensureState(match);

  // customerId -> record. Populated the tick a party first appears in `state.parties`, then
  // mutated in place as the SAME object `advanceParty`/`exitParty`/`cleanupExitedParties` mutate
  // — so once a party is deleted from `state.parties`, this record still holds its true final
  // field values (nothing here is recomputed after the fact).
  const records = new Map();
  let previouslyPresent = new Set();

  const observeTick = () => {
    const nowPresent = new Set(state.parties.keys());
    for (const [customerId, party] of state.parties) {
      if (!records.has(customerId)) {
        records.set(customerId, {
          customerId,
          party,
          removedAtMs: null,
          truncated: false,
        });
      }
    }
    // A party present last tick but gone now was just removed by `cleanupExitedParties` THIS
    // tick — the real, observed removal instant, not `exitAtMs + CUSTOMER_EXIT_LINGER_MS`
    // computed after the fact (which would be the same number only if nothing ever drifts).
    for (const customerId of previouslyPresent) {
      if (!nowPresent.has(customerId)) {
        const record = records.get(customerId);
        if (record && record.removedAtMs === null) record.removedAtMs = match.elapsedMs;
      }
    }
    previouslyPresent = nowPresent;
  };

  quiet(() => {
    // isServicePhase covers exactly 'service' and 'final_rush' — see match.js's own getter —
    // which is exactly the window customerSystem.update runs in (its own `phases` declaration).
    while (match.isServicePhase && !match.ended) {
      stepMatch(match, TICK_MS);
      observeTick();
    }
  });

  // Anything still in state.parties when the window ends never got a real removal tick inside
  // this run — it is CENSORED (would resolve into 'results' with no more customerSystem ticks to
  // clean it up), not a true measured duration. Marked, not silently included as if it were 0.
  for (const customerId of previouslyPresent) {
    const record = records.get(customerId);
    if (record) record.truncated = true;
  }

  return { match, state, records: [...records.values()] };
}

/** True for a party whose FIRST (and only, for this cohort) decision was to pick neither
 * restaurant — the exact "walking by" case the original request is about: no queue time, no
 * table time, just the decide-then-exit-walk. Read from `match.districtDecisions`
 * (`chosenRestaurantId === null`), the same field `check-district-choice.mjs` section 1 already
 * treats as the authoritative "left before choosing" signal. */
function walkedByNeitherIds(match) {
  const ids = new Set();
  for (const decision of match.districtDecisions ?? []) {
    if (decision.chosenRestaurantId === null) ids.add(decision.customerId);
  }
  return ids;
}

function summarizeDurations(recordsSubset) {
  const complete = recordsSubset.filter((r) => !r.truncated && r.removedAtMs !== null);
  const truncated = recordsSubset.length - complete.length;
  if (complete.length === 0) {
    return { n: 0, truncated, meanMs: null, medianMs: null, minMs: null, maxMs: null };
  }
  const durations = complete
    .map((r) => r.removedAtMs - r.party.spawnedAtMs)
    .sort((a, b) => a - b);
  const sum = durations.reduce((a, b) => a + b, 0);
  const mid = Math.floor(durations.length / 2);
  const medianMs =
    durations.length % 2 === 0 ? (durations[mid - 1] + durations[mid]) / 2 : durations[mid];
  return {
    n: complete.length,
    truncated,
    meanMs: sum / durations.length,
    medianMs,
    minMs: durations[0],
    maxMs: durations[durations.length - 1],
  };
}

function fmt(ms) {
  if (ms === null) return 'n/a';
  return `${ms.toFixed(0)}ms (${(ms / 1000).toFixed(2)}s)`;
}

console.log('District crowd density measurement (STORY-046)\n');
console.log(
  `Current in-bounds pacing constants: CUSTOMER_ENTER_DISTRICT_MS=${CUSTOMER_ENTER_DISTRICT_MS} ` +
    `CUSTOMER_EVALUATE_RESTAURANTS_MS=${CUSTOMER_EVALUATE_RESTAURANTS_MS} ` +
    `CUSTOMER_EXIT_LINGER_MS=${CUSTOMER_EXIT_LINGER_MS} CUSTOMER_MOVE_SPEED=${CUSTOMER_MOVE_SPEED} ` +
    `CUSTOMER_EXIT_OFFSET=${CUSTOMER_EXIT_OFFSET}\n`,
);

clearSystems();
registerSystem(setupSystem);
registerSystem(customerSystem);
registerSystem(orderSystem);
registerSystem(eventSystem);

const SEEDS = ['density-1', 'density-2', 'density-3', 'density-4', 'density-5'];
const MARKET_IDS = markets.markets.map((m) => m.id);

const perMarket = [];
let grandArrivals = 0;
let grandWalkedByNeither = 0;
let grandNonConversionAny = 0; // walked-by-neither + ABANDON_QUEUE/CANCEL_ORDER/LEAVE_ANGRY
const allWalkByRecords = [];
const allDistrictSummaries = []; // { marketId, seed, restaurantId, guestsServed }
// AC1's OWN literal definition: "parties that end in CHOOSE_RIVAL + LEAVE_DISTRICT, as a
// fraction of all district arrivals" — read per-restaurant off `districtSummary`'s own
// `counts`, exactly as the AC names it. This is a DIFFERENT (larger) number than the
// district-wide "walked by neither" figure above: from restaurant A's own funnel, a party that
// chose restaurant B is "CHOSE_RIVAL" (a real conversion for the district, just not for A), so
// this is "the fraction of parties that did not choose ME", not "the fraction that walked past
// both restaurants". Both are reported; the district-wide figure is the one that answers "how
// many people are visibly walking by," which is what this story's own request is actually about.
const funnelPerMarket = [];

for (const marketId of MARKET_IDS) {
  const market = markets.markets.find((m) => m.id === marketId);
  let arrivals = 0;
  let walkedByNeither = 0;
  let nonConversionAny = 0;
  const walkByRecordsThisMarket = [];

  for (const seed of SEEDS) {
    const { match, records } = runAndObserve({ id: `m_${marketId}_${seed}`, seed, marketId });
    const decisions = match.districtDecisions ?? [];
    arrivals += decisions.length;
    const walkByIds = walkedByNeitherIds(match);
    walkedByNeither += walkByIds.size;

    for (const record of records) {
      if (isExitState(record.party.state) && record.party.state !== CUSTOMER_STATES.CHOOSE_RIVAL) {
        // CHOOSE_RIVAL is never a real party.state (see customer-system.js's own comment on
        // buildRestaurantView) — every party actually in state.parties resolves to one of the
        // OTHER four exit states, or is still mid-lifecycle / truncated.
        if (
          record.party.state === CUSTOMER_STATES.LEAVE_DISTRICT ||
          record.party.state === CUSTOMER_STATES.ABANDON_QUEUE ||
          record.party.state === CUSTOMER_STATES.CANCEL_ORDER ||
          record.party.state === CUSTOMER_STATES.LEAVE_ANGRY
        ) {
          nonConversionAny += 1;
        }
      }
      if (walkByIds.has(record.customerId)) walkByRecordsThisMarket.push(record);
    }

    for (const restaurant of match.districtSummary ?? []) {
      allDistrictSummaries.push({ marketId, seed, restaurantId: restaurant.restaurantId, guestsServed: restaurant.guestsServed });
      const c = restaurant.counts ?? {};
      const chosen = c.chosen ?? 0;
      const rival = c[CUSTOMER_STATES.CHOOSE_RIVAL] ?? 0;
      const leftDistrict = c[CUSTOMER_STATES.LEAVE_DISTRICT] ?? 0;
      const denom = chosen + rival + leftDistrict;
      funnelPerMarket.push({
        marketId,
        seed,
        restaurantId: restaurant.restaurantId,
        chosen,
        rival,
        leftDistrict,
        notMeFraction: denom > 0 ? (rival + leftDistrict) / denom : 0,
      });
    }
  }

  allWalkByRecords.push(...walkByRecordsThisMarket);
  grandArrivals += arrivals;
  grandWalkedByNeither += walkedByNeither;
  grandNonConversionAny += nonConversionAny;

  const durations = summarizeDurations(walkByRecordsThisMarket);
  perMarket.push({ marketId, market, arrivals, walkedByNeither, nonConversionAny, durations });

  console.log(`--- ${marketId} (baseFootTrafficPerMinute=${market.baseFootTrafficPerMinute}, ${SEEDS.length} seeds, phasePreset 'full' = 360s of service+final_rush each) ---`);
  console.log(`  total district arrivals (districtDecisions):      ${arrivals}`);
  console.log(
    `  chose NEITHER restaurant (LEAVE_DISTRICT, walked by):     ${walkedByNeither} ` +
      `(${arrivals > 0 ? ((walkedByNeither / arrivals) * 100).toFixed(1) : '0.0'}% of arrivals)`,
  );
  console.log(
    `  any non-conversion (walked-by + abandoned/cancelled/left-angry): ${nonConversionAny} ` +
      `(${arrivals > 0 ? ((nonConversionAny / arrivals) * 100).toFixed(1) : '0.0'}% of arrivals)`,
  );
  console.log(
    `  "walked by neither" visible duration — spawn to snapshot-removal, n=${durations.n}` +
      `${durations.truncated > 0 ? ` (+${durations.truncated} truncated by match end, excluded)` : ''}:`,
  );
  console.log(
    `    mean=${fmt(durations.meanMs)} median=${fmt(durations.medianMs)} min=${fmt(durations.minMs)} max=${fmt(durations.maxMs)}`,
  );
  const marketFunnels = funnelPerMarket.filter((f) => f.marketId === marketId);
  const fChosen = marketFunnels.reduce((s, f) => s + f.chosen, 0);
  const fRival = marketFunnels.reduce((s, f) => s + f.rival, 0);
  const fLeft = marketFunnels.reduce((s, f) => s + f.leftDistrict, 0);
  const fDenom = fChosen + fRival + fLeft;
  console.log(
    `  AC1's own literal metric — per-restaurant funnel, districtSummary.counts, summed over both restaurants: ` +
      `chosen=${fChosen} CHOOSE_RIVAL=${fRival} LEAVE_DISTRICT=${fLeft} -> ` +
      `"did not choose ME" = (CHOOSE_RIVAL+LEAVE_DISTRICT)/total = ${fDenom > 0 ? (((fRival + fLeft) / fDenom) * 100).toFixed(1) : '0.0'}%`,
  );
  console.log('');
}

const overallDurations = summarizeDurations(allWalkByRecords);
console.log('=== Aggregate across all three markets ===');
console.log(`total district arrivals: ${grandArrivals}`);
console.log(
  `chose neither restaurant: ${grandWalkedByNeither} (${((grandWalkedByNeither / grandArrivals) * 100).toFixed(1)}% of arrivals)`,
);
console.log(
  `any non-conversion (walked-by + abandoned/cancelled/left-angry): ${grandNonConversionAny} (${((grandNonConversionAny / grandArrivals) * 100).toFixed(1)}% of arrivals)`,
);
console.log(
  `"walked by neither" visible duration — n=${overallDurations.n}${overallDurations.truncated > 0 ? ` (+${overallDurations.truncated} truncated, excluded)` : ''}:`,
);
console.log(
  `  mean=${fmt(overallDurations.meanMs)} median=${fmt(overallDurations.medianMs)} min=${fmt(overallDurations.minMs)} max=${fmt(overallDurations.maxMs)}`,
);

// PRD §24 cross-check (docs/kb/conventions.md "Open Balance Gaps"): guestsServed per restaurant,
// from the SAME runs already produced above (no second simulation pass), against the cited
// 40-90 target for a real 1v1.
console.log('\n=== PRD §24 cross-check: guestsServed per restaurant (docs/kb/conventions.md "Open Balance Gaps") ===');
for (const row of allDistrictSummaries) {
  console.log(`  ${row.marketId}/${row.seed}/${row.restaurantId}: guestsServed=${row.guestsServed}`);
}
const servedSum = allDistrictSummaries.reduce((sum, r) => sum + r.guestsServed, 0);
console.log(
  `\nMean guestsServed per restaurant across ${allDistrictSummaries.length} restaurant-runs: ` +
    `${(servedSum / allDistrictSummaries.length).toFixed(1)} — PRD §24 target is 40-90.`,
);
