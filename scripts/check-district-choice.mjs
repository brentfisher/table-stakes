#!/usr/bin/env node
// Shared district and restaurant choice check — the executable half of STORY-010.
//
// The repo has no test framework (Milestone 0 Decision 8), so this is a runnable script in the
// style of check-orders.mjs: it constructs real `Match` objects, registers the real systems
// against the real simulation loop, and steps them with synthetic `dtMs`.
//
// WHY THIS ONE REGISTERS FOUR SYSTEMS. Every check script before this registered only the
// systems its own story owned, and a field-name mismatch between the customer and event systems
// silently disabled every event effect on customer spawning for three merges — each suite green,
// the seam between them broken. This story's subject matter IS the interaction between systems:
// the menu comes from `setupSystem`, the projected wait comes from `orderSystem`'s kitchen, and
// event affinity comes from `eventSystem`'s published effects. All four are registered here, in
// the order `systems/index.js` uses, and every cross-system assertion below goes through the
// CONSUMER's read path (`match.kitchen.queueDepth()`, `_internal.getEventEffects()`,
// `match.toSnapshot()`) rather than reaching into the producer's internals.
//
// Run: node scripts/check-district-choice.mjs

import { Match } from '../server/src/game/match.js';
import { clearSystems, registerSystem, stepMatch } from '../server/src/game/simulation-loop.js';
import { customerSystem, _internal } from '../server/src/game/systems/customer-system.js';
import { orderSystem } from '../server/src/game/systems/order-system.js';
import { setupSystem } from '../server/src/game/systems/setup-system.js';
import { eventSystem } from '../server/src/game/systems/event-system.js';
import { CUSTOMER_STATES, DECISION_REASONS } from '../shared/schemas/game-state.js';
import {
  DISTRICT_REPUTATION_MAX,
  DISTRICT_REPUTATION_MIN,
  DISTRICT_REPUTATION_START,
  DISTRICT_CHOICE_TEMPERATURE,
} from '../shared/constants/tuning.js';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

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
const NEUTRAL_EFFECTS = { footTrafficMultiplier: 1, partySizeMultiplier: 1, segmentWeightOverrides: {} };

/** Every §17 reason this run actually produced, from anywhere in the script. */
const reasonsSeen = new Set();
function noteReasons(match) {
  for (const decision of match.districtDecisions ?? []) {
    if (decision.reason) reasonsSeen.add(decision.reason);
  }
}

// --- harness ----------------------------------------------------------------------------------

clearSystems();
registerSystem(setupSystem);
registerSystem(customerSystem);
registerSystem(orderSystem);
registerSystem(eventSystem);

/**
 * A submission shaped exactly as `setup-submit`'s accepted result, assigned straight onto the
 * player the way check-orders.mjs does it. `setup-system.js` locks whatever is here at the
 * setup -> service transition, so the district reads a real locked menu either way.
 */
function submission(mains, addons = []) {
  return {
    menu: mains,
    addons,
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

function makeDistrict({ id, seed = id, phasePreset = 'prototype', menus = {} } = {}) {
  const match = new Match({ id, seed, phasePreset, requiredPlayers: 2 });
  match.join({ fallbackPlayerId: 'p1' });
  match.join({ fallbackPlayerId: 'p2' });
  match.setReady('p1', true);
  match.setReady('p2', true);
  for (const [playerId, menu] of Object.entries(menus)) {
    if (menu) match.players.get(playerId).setup = menu;
  }
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
 * Force `n` parties through the real EVALUATE_RESTAURANTS decision and tally where they went,
 * holding district conditions still: each party is removed from the pool once it has decided, so
 * the queue it would have joined cannot feed back into the next party's projected wait. Every
 * decision goes through `resolveEvaluateRestaurants` — the shipped path, not a reimplementation.
 */
function tallyChoices(match, state, n, mutateParty = null) {
  // `reasons` is every reason recorded; `wonBy` splits them by WHICH restaurant won the party,
  // which is the only way to say "p1 won these on shorter_projected_wait" — a pooled tally
  // mixes in every reason the rival won its own parties by and proves nothing.
  const tally = { p1: 0, p2: 0, leave: 0, reasons: {}, wonBy: { p1: {}, p2: {} } };
  for (let i = 0; i < n; i += 1) {
    const party = _internal.spawnParty(match, state, NEUTRAL_EFFECTS);
    if (mutateParty) mutateParty(party);
    party.state = CUSTOMER_STATES.EVALUATE_RESTAURANTS;
    _internal.resolveEvaluateRestaurants(match, state, party);
    if (party.state === CUSTOMER_STATES.APPROACH_OR_QUEUE) tally[party.restaurantId] += 1;
    else tally.leave += 1;
    if (party.decisionReason) {
      tally.reasons[party.decisionReason] = (tally.reasons[party.decisionReason] ?? 0) + 1;
      if (party.restaurantId) {
        const bucket = tally.wonBy[party.restaurantId];
        bucket[party.decisionReason] = (bucket[party.decisionReason] ?? 0) + 1;
      }
      reasonsSeen.add(party.decisionReason);
    }
    state.parties.delete(party.customerId);
  }
  return tally;
}

const share = (tally) => (tally.p1 + tally.p2 === 0 ? 0 : tally.p1 / (tally.p1 + tally.p2));

// Two menus that differ ONLY in price: same dishes, p1 undercutting p2 by 10%. That is the
// smallest interesting score edge — one axis, one direction, everything else identical.
const SAME_DISHES = [
  { dishId: 'smash_burger', price: 14 },
  { dishId: 'caesar_salad', price: 12 },
  { dishId: 'pasta_primavera', price: 22 },
];
const cheaperBy = (factor) => SAME_DISHES.map((slot) => ({ ...slot, price: Number((slot.price * factor).toFixed(2)) }));

console.log('Shared district and restaurant choice check\n');

// --- 1. ONE shared pool, PRD §22 --------------------------------------------------------------
{
  const match = makeDistrict({ id: 'm_pool', seed: 'pool-seed' });
  runUntilPhase(match, 'service');
  quiet(() => {
    for (let i = 0; i < 3000; i += 1) stepMatch(match, TICK_MS);
  });
  const state = _internal.ensureState(match);
  noteReasons(match);

  const spawnLogHasNoRestaurant = state.spawnLog.every((entry) => !('restaurantId' in entry));
  const decided = match.districtDecisions.length;
  const chosenTotal = [...state.restaurants.values()].reduce((sum, v) => sum + v.counts.chosen, 0);
  const leftBeforeChoosing = match.districtDecisions.filter((d) => d.chosenRestaurantId === null).length;

  check(
    'parties spawn into ONE district pool — a single arrival log, with no restaurant attached at spawn',
    state.spawnLog.length > 0 && spawnLogHasNoRestaurant,
    `${state.spawnLog.length} arrivals, none pre-assigned to a restaurant`,
  );
  check(
    'every decided party is accounted for exactly once: chosen by a restaurant, or gone from the district',
    decided > 0 && chosenTotal + leftBeforeChoosing === decided,
    `${decided} decisions = ${chosenTotal} chosen + ${leftBeforeChoosing} left`,
  );
  check(
    'BOTH restaurants draw from that one pool — neither is starved by a per-restaurant spawner',
    [...state.restaurants.values()].every((v) => v.counts.chosen > 0),
    [...state.restaurants.values()].map((v) => `${v.restaurantId}=${v.counts.chosen}`).join(' '),
  );
  check(
    'a party carries no restaurantId until EVALUATE_RESTAURANTS resolves',
    [...state.parties.values()].every(
      (p) =>
        p.restaurantId === null ||
        (p.state !== CUSTOMER_STATES.ENTER_DISTRICT && p.state !== CUSTOMER_STATES.EVALUATE_RESTAURANTS),
    ),
    'checked every live party',
  );
}

// --- 2. PROBABILISTIC, NOT ARGMAX (PRD §6, §23) ----------------------------------------------
//
// The assertion that matters most in this file, and the one deliberately written as a BAND:
// `share < 0.9` would pass for a coin flip, and `share > 0.5` would pass for an argmax. A modest
// edge must win a modestly larger share — more than chance, far short of everything.
{
  const rows = [];
  for (const seed of ['edge-1', 'edge-2', 'edge-3', 'edge-4', 'edge-5', 'edge-6']) {
    const match = makeDistrict({
      id: `m_edge_${seed}`,
      seed,
      menus: { p1: submission(cheaperBy(0.9)), p2: submission(SAME_DISHES) },
    });
    runUntilPhase(match, 'service');
    const state = _internal.ensureState(match);
    rows.push(tallyChoices(match, state, 400));
  }
  const totals = rows.reduce((acc, t) => ({ p1: acc.p1 + t.p1, p2: acc.p2 + t.p2, leave: acc.leave + t.leave }), {
    p1: 0,
    p2: 0,
    leave: 0,
  });
  const edgeShare = share(totals);

  // The score edge those prices actually buy, measured through the shipped scorer.
  const probe = makeDistrict({
    id: 'm_edge_probe',
    seed: 'edge-1',
    menus: { p1: submission(cheaperBy(0.9)), p2: submission(SAME_DISHES) },
  });
  runUntilPhase(probe, 'service');
  const probeState = _internal.ensureState(probe);
  const probeParty = _internal.spawnParty(probe, probeState, NEUTRAL_EFFECTS);
  const effects = _internal.getEventEffects(probe);
  const [u1, u2] = ['p1', 'p2'].map(
    (id) => _internal.scoreRestaurant(probe, probeState, probeState.restaurants.get(id), probeParty, effects).utility,
  );

  console.log(
    `\n    a 10% price undercut is worth ${(u1 - u2).toFixed(3)} of utility at temperature ` +
      `${DISTRICT_CHOICE_TEMPERATURE}; it won ${(edgeShare * 100).toFixed(1)}% of ` +
      `${totals.p1 + totals.p2} contested parties across 6 seeds\n`,
  );

  check(
    'a modestly better restaurant wins a modestly larger share — a SPLIT (55-85%), never a sweep',
    edgeShare > 0.55 && edgeShare < 0.85,
    `p1 took ${(edgeShare * 100).toFixed(1)}% (${totals.p1} vs ${totals.p2}); argmax would be ~100%, blindness ~50%`,
  );
  check(
    'the worse restaurant is never shut out — it keeps a substantial share of the district',
    totals.p2 / (totals.p1 + totals.p2) > 0.15,
    `p2 kept ${((totals.p2 / (totals.p1 + totals.p2)) * 100).toFixed(1)}%`,
  );

  // Monotonicity: a bigger edge buys a bigger share, so the split is a response to the score and
  // not a fixed ratio that would survive any scoring change at all.
  // Deliberately inside the unsaturated part of the price axis: past roughly 0.75x the suggested
  // price the value term is pinned at its ceiling — a dish cannot read as better than "excellent
  // value", and a discount past that point is a donation, not a demand lever.
  const FACTORS = [1.0, 0.93, 0.86];
  const shares = [];
  for (const factor of FACTORS) {
    const match = makeDistrict({
      id: `m_slope_${factor}`,
      seed: 'slope-seed',
      menus: { p1: submission(cheaperBy(factor)), p2: submission(SAME_DISHES) },
    });
    runUntilPhase(match, 'service');
    shares.push(share(tallyChoices(match, _internal.ensureState(match), 1500)));
  }
  check(
    'a bigger price advantage buys a bigger share, monotonically — the split tracks the score',
    shares.every((sh, i) => i === 0 || sh > shares[i - 1]),
    shares.map((sh, i) => `${FACTORS[i]}x -> ${(sh * 100).toFixed(0)}%`).join(', '),
  );
  check(
    'an identical menu at an identical price splits the district evenly (45-55%)',
    shares[0] > 0.45 && shares[0] < 0.55,
    `${(shares[0] * 100).toFixed(1)}% with nothing to choose between them`,
  );
}

// --- 3. capacity and live queue length change outcomes MID-MATCH (PRD §4.2) -------------------
//
// One match, three windows: both restaurants idle, then p1's dining room full with a queue at
// the door, then p1 free again. Same match, same seed, same menus — only the live state moves.
{
  const match = makeDistrict({
    id: 'm_capacity',
    seed: 'capacity-seed',
    menus: { p1: submission(SAME_DISHES), p2: submission(SAME_DISHES) },
  });
  runUntilPhase(match, 'service');
  const state = _internal.ensureState(match);
  const p1 = state.restaurants.get('p1');

  const before = tallyChoices(match, state, 400);

  for (const table of p1.tables.values()) table.occupiedBy = 'seated_party';
  const queuers = [];
  for (let i = 0; i < 6; i += 1) {
    const queuer = _internal.spawnParty(match, state, NEUTRAL_EFFECTS);
    queuer.restaurantId = 'p1';
    queuer.state = CUSTOMER_STATES.APPROACH_OR_QUEUE;
    queuers.push(queuer);
  }
  const queueLength = _internal.queueLengthFor(state, 'p1');
  const during = tallyChoices(match, state, 400);

  for (const table of p1.tables.values()) table.occupiedBy = null;
  for (const queuer of queuers) state.parties.delete(queuer.customerId);
  const after = tallyChoices(match, state, 400);

  check(
    'filling p1\'s dining room and queue mid-match visibly moves parties to the rival',
    share(during) < share(before) - 0.15,
    `p1 share ${(share(before) * 100).toFixed(0)}% -> ${(share(during) * 100).toFixed(0)}% with ` +
      `${queueLength} queueing and 0 tables free`,
  );
  check(
    'freeing p1\'s tables mid-match brings those parties back — the effect is live, not sticky',
    share(after) > share(during) + 0.15,
    `p1 share recovered to ${(share(after) * 100).toFixed(0)}%`,
  );
  check(
    'a party turned away by a full rival records restaurant_full as the reason it went elsewhere',
    (during.reasons.restaurant_full ?? 0) > 0,
    `restaurant_full cited ${during.reasons.restaurant_full ?? 0} times while p1 was full`,
  );
}

// --- 4. projected wait comes from the KITCHEN's own read path (PRD §6 "Actual service speed") --
{
  const match = makeDistrict({
    id: 'm_backlog',
    seed: 'backlog-seed',
    menus: { p1: submission(SAME_DISHES), p2: submission(SAME_DISHES) },
  });
  runUntilPhase(match, 'service');
  const state = _internal.ensureState(match);
  const p2view = state.restaurants.get('p2');
  const probeParty = _internal.spawnParty(match, state, NEUTRAL_EFFECTS);

  const waitBefore = _internal.projectedWaitMs(match, state, p2view, probeParty.partySize);
  const depthBefore = _internal.kitchenBacklogFor(match, 'p2');

  // A REAL backlog: real orders, placed through the kitchen facade the customer system uses,
  // then cooked for a while so tickets stack up behind the station concurrency limit.
  quiet(() => {
    for (let i = 0; i < 12; i += 1) {
      const filler = _internal.spawnParty(match, state, NEUTRAL_EFFECTS);
      filler.restaurantId = 'p2';
      match.kitchen.placeOrder(_internal.orderRequest(filler));
      state.parties.delete(filler.customerId);
    }
    for (let i = 0; i < 20; i += 1) orderSystem.update(match, TICK_MS);
  });

  const depthAfter = _internal.kitchenBacklogFor(match, 'p2');
  const waitAfter = _internal.projectedWaitMs(match, state, p2view, probeParty.partySize);
  state.parties.delete(probeParty.customerId);

  check(
    'a real kitchen backlog is visible through match.kitchen.queueDepth(), the consumer read path',
    depthAfter > depthBefore && depthAfter > 0,
    `deepest station queue ${depthBefore} -> ${depthAfter} tickets`,
  );
  check(
    'that backlog lengthens the projected wait the choice model scores',
    waitAfter > waitBefore,
    `projected wait ${Math.round(waitBefore / 1000)}s -> ${Math.round(waitAfter / 1000)}s`,
  );
}

// --- 5. THE RECOVERY REQUIREMENT: weaker menu, faster service (PRD §21 M2, §22 Quality) -------
//
// p1 runs a menu this district barely wants, priced above the suggested price. p2 runs the menu
// the district is built for — and then lets its kitchen fall behind. §22's "A poor pre-match
// strategy can be partially recovered through execution" says p1 must win parties back, and §17
// says the reason on record must be `shorter_projected_wait`.
//
// The rival is slowed with a REAL kitchen backlog — real orders, placed through the same
// `match.kitchen.placeOrder` seam the customer system uses — and NOT by filling its dining room,
// because a full dining room is `restaurant_full`, a different §17 reason and a different claim.
{
  // The seed is chosen so the market is `downtown_lunch`, and asserted below: a menu is only
  // "weak" relative to a crowd, and this scenario is meaningless if the seed drifts to the
  // pre-theatre market where steak and pasta are exactly what the district wants.
  const match = makeDistrict({
    id: 'm_recovery',
    seed: 'dl-3',
    menus: {
      p1: submission([
        { dishId: 'steak_frites', price: 44 },
        { dishId: 'pasta_primavera', price: 30 },
        { dishId: 'smash_burger', price: 20 },
      ]),
      p2: submission([
        { dishId: 'caesar_salad', price: 11 },
        { dishId: 'chicken_sandwich', price: 12 },
        { dishId: 'smash_burger', price: 13 },
      ]),
    },
  });
  check(
    'the recovery scenario runs in the market its menus were written for',
    match.market.id === 'downtown_lunch',
    `market=${match.market.id}`,
  );
  runUntilPhase(match, 'service');
  const state = _internal.ensureState(match);

  // First, with both kitchens idle: the weaker menu must be LOSING. A menu that was never weaker
  // cannot be recovered from, and this assertion is what stops the scenario proving nothing.
  const idle = tallyChoices(match, state, 600);

  // Now p2 executes badly: real tickets stack up behind its station concurrency limits.
  quiet(() => {
    for (let i = 0; i < 6; i += 1) {
      const filler = _internal.spawnParty(match, state, NEUTRAL_EFFECTS);
      filler.restaurantId = 'p2';
      match.kitchen.placeOrder(_internal.orderRequest(filler));
      state.parties.delete(filler.customerId);
    }
    for (let i = 0; i < 10; i += 1) orderSystem.update(match, TICK_MS);
  });
  const backlog = _internal.kitchenBacklogFor(match, 'p2');
  const swamped = tallyChoices(match, state, 600);

  console.log(
    `\n    recovery scenario: the weaker, dearer menu took ${(share(idle) * 100).toFixed(0)}% of parties ` +
      `while both kitchens were idle, and ${(share(swamped) * 100).toFixed(0)}% once the rival's kitchen ` +
      `was ${backlog} tickets deep\n`,
  );

  check(
    'the weaker, dearer menu really is losing while both restaurants execute equally well',
    share(idle) < 0.4,
    `weak menu took ${(share(idle) * 100).toFixed(0)}% against a strong one`,
  );
  check(
    'a player with a weaker menu but faster service WINS parties back (PRD §21 Milestone 2)',
    share(swamped) > share(idle) + 0.15,
    `${(share(idle) * 100).toFixed(0)}% -> ${(share(swamped) * 100).toFixed(0)}% once the rival backed up`,
  );
  const wonByWeakMenu = swamped.wonBy.p1;
  check(
    'and the parties the WEAKER menu won are recorded as won on shorter_projected_wait',
    (wonByWeakMenu.shorter_projected_wait ?? 0) > 0 &&
      (wonByWeakMenu.shorter_projected_wait ?? 0) >
        (wonByWeakMenu.better_menu_fit ?? 0) + (wonByWeakMenu.better_price ?? 0),
    `p1 won by ${JSON.stringify(wonByWeakMenu)}; p2 won by ${JSON.stringify(swamped.wonBy.p2)}`,
  );
}

// --- 6. reputation compounds, is capped, and the cap is not cosmetic (PRD §4.2, §23) ----------
{
  const view = _internal.buildRestaurantView('p1');
  const startedAt = view.reputation;
  const trail = [];
  for (let i = 0; i < 5; i += 1) {
    _internal.applyReview(view, 100);
    trail.push(Number(view.reputation.toFixed(1)));
  }
  const compounded = view.reputation;
  for (let i = 0; i < 500; i += 1) _internal.applyReview(view, 100);

  check(
    'reputation compounds across a match — consecutive happy guests keep moving it',
    startedAt === DISTRICT_REPUTATION_START && trail.every((r, i) => i === 0 || r > trail[i - 1]) && compounded > startedAt,
    `${startedAt} -> ${trail.join(' -> ')}`,
  );
  check(
    'reputation is CAPPED — 500 perfect reviews cannot push it past the ceiling',
    view.reputation === DISTRICT_REPUTATION_MAX,
    `${view.reputation} with DISTRICT_REPUTATION_MAX=${DISTRICT_REPUTATION_MAX}`,
  );
  const floorView = _internal.buildRestaurantView('p2');
  for (let i = 0; i < 500; i += 1) _internal.applyWalkout(floorView);
  check(
    'and floored — a disastrous match cannot drive it below the floor',
    floorView.reputation === DISTRICT_REPUTATION_MIN,
    `${floorView.reputation} with DISTRICT_REPUTATION_MIN=${DISTRICT_REPUTATION_MIN}`,
  );

  // THE CONSEQUENCE, which is what §4.2 actually asks for: a clamp that still let the leader
  // take every party would satisfy the two checks above and none of the design rule.
  const match = makeDistrict({
    id: 'm_unwinnable',
    seed: 'unwinnable-seed',
    menus: { p1: submission(SAME_DISHES), p2: submission(SAME_DISHES) },
  });
  runUntilPhase(match, 'service');
  const state = _internal.ensureState(match);
  state.restaurants.get('p1').reputation = DISTRICT_REPUTATION_MAX;
  state.restaurants.get('p2').reputation = DISTRICT_REPUTATION_MIN;
  const tally = tallyChoices(match, state, 800);
  const trailingShare = tally.p2 / (tally.p1 + tally.p2);

  // And the gap a player can actually OPEN in the first two minutes — which is what §4.2's
  // "not so strongly that the match becomes unwinnable early" is really about. Fifteen perfect
  // reviews against fifteen walkouts is a dominant opening, and the trailing restaurant must
  // still be drawing a large minority of the district after it.
  const early = makeDistrict({
    id: 'm_early_lead',
    seed: 'early-lead-seed',
    menus: { p1: submission(SAME_DISHES), p2: submission(SAME_DISHES) },
  });
  runUntilPhase(early, 'service');
  const earlyState = _internal.ensureState(early);
  for (let i = 0; i < 15; i += 1) {
    _internal.applyReview(earlyState.restaurants.get('p1'), 100);
    _internal.applyWalkout(earlyState.restaurants.get('p2'));
  }
  const earlyTally = tallyChoices(early, earlyState, 800);
  const earlyTrailing = earlyTally.p2 / (earlyTally.p1 + earlyTally.p2);

  console.log(
    `\n    a restaurant pinned at the reputation ceiling beat one pinned at the floor ` +
      `${(share(tally) * 100).toFixed(0)}/${(trailingShare * 100).toFixed(0)}; the biggest lead a ` +
      `strong first two minutes can actually open (${earlyState.restaurants.get('p1').reputation.toFixed(0)} ` +
      `vs ${earlyState.restaurants.get('p2').reputation.toFixed(0)}) was worth ` +
      `${((1 - earlyTrailing) * 100).toFixed(0)}/${(earlyTrailing * 100).toFixed(0)}\n`,
  );

  check(
    'a dominant early reputation lead leaves the match clearly winnable (PRD §4.2, §23)',
    earlyTrailing > 0.3,
    `after 15 perfect reviews vs 15 walkouts the trailing restaurant still drew ` +
      `${(earlyTrailing * 100).toFixed(0)}% of parties`,
  );
  check(
    'even the unreachable extreme — the ceiling against the floor — never shuts the rival out',
    trailingShare > 0.1,
    `the trailing restaurant still won ${(trailingShare * 100).toFixed(0)}% of parties`,
  );
  check(
    'and the reputation lead is still worth having — it wins clearly more than half',
    share(tally) > 0.6,
    `the leader took ${(share(tally) * 100).toFixed(0)}%`,
  );
  check(
    'a party won on reputation records higher_reputation',
    (tally.reasons.higher_reputation ?? 0) > 0,
    JSON.stringify(tally.reasons),
  );
}

// --- 7. reputation actually moves from real service, through the real state machine ------------
{
  const match = makeDistrict({
    id: 'm_reputation_live',
    seed: 'rep-live-seed',
    menus: { p1: submission(SAME_DISHES), p2: submission(SAME_DISHES) },
  });
  runUntilPhase(match, 'service');
  const state = _internal.ensureState(match);
  quiet(() => {
    for (let i = 0; i < 4000; i += 1) stepMatch(match, TICK_MS);
  });
  const moved = [...state.restaurants.values()].filter((v) => v.reputation !== DISTRICT_REPUTATION_START);
  const inBand = [...state.restaurants.values()].every(
    (v) => v.reputation >= DISTRICT_REPUTATION_MIN && v.reputation <= DISTRICT_REPUTATION_MAX,
  );
  check(
    'a real service phase moves both restaurants\' reputation, and never outside the capped band',
    moved.length === 2 && inBand,
    [...state.restaurants.values()].map((v) => `${v.restaurantId}=${v.reputation.toFixed(1)}`).join(' '),
  );
  noteReasons(match);
}

// --- 8. event affinity, from a REAL activated event (Decision 12 / §16 vocabulary) -------------
//
// Never by hand-assigning `match.eventEffects`: that is exactly the shape of the bug that hid a
// broken customer/event seam for three merges. The event system runs, deals its own seeded deck,
// and this waits for a card that moves dish demand.
{
  // A party with no tag preferences and a large budget scores menu fit and price IDENTICALLY on
  // both menus, so the only axis left that can differ is event affinity. Constructed, not drawn,
  // for the same reason check-customer-lifecycle forces its exit states: a branch worth checking
  // is worth checking deterministically.
  const neutralise = (party) => {
    party.preferredTags = [];
    party.dislikedTags = [];
    party.budget = 500;
  };
  const coffeeMenu = submission(
    [
      { dishId: 'caesar_salad', price: 12 },
      { dishId: 'pasta_primavera', price: 22 },
      { dishId: 'chicken_sandwich', price: 13 },
    ],
    [{ dishId: 'espresso', price: 5 }],
  );
  const heartyMenu = submission([
    { dishId: 'smash_burger', price: 14 },
    { dishId: 'chicken_sandwich', price: 13 },
    { dishId: 'steak_frites', price: 34 },
  ]);

  let found = null;
  for (const seed of ['ev-1', 'ev-2', 'ev-3', 'ev-4', 'ev-5', 'ev-6', 'ev-7', 'ev-8'] ) {
    if (found) break;
    const match = makeDistrict({ id: `m_event_${seed}`, seed, menus: { p1: coffeeMenu, p2: heartyMenu } });
    runUntilPhase(match, 'service');
    const state = _internal.ensureState(match);
    quiet(() => {
      for (let i = 0; i < 4000 && !found; i += 1) {
        stepMatch(match, TICK_MS);
        const effects = _internal.getEventEffects(match);
        if ((effects.activeEventIds?.length ?? 0) === 0) continue;
        if (Object.keys(effects.dishTagDemandMultipliers ?? {}).length === 0) continue;
        const tally = tallyChoices(match, state, 60, neutralise);
        if ((tally.reasons.event_affinity ?? 0) > 0) {
          found = { seed, eventIds: [...effects.activeEventIds], tally, effects };
        }
      }
    });
  }

  check(
    'a live event moves the choice, and the party won on it records event_affinity',
    found !== null,
    found
      ? `${found.eventIds.join(',')} active; event_affinity cited ${found.tally.reasons.event_affinity} times, ` +
        `boosted tags ${JSON.stringify(found.effects.dishTagDemandMultipliers)}`
      : 'no active event ever produced an event_affinity decision',
  );
  check(
    'and the event affinity read by the choice model is the event system\'s own dish-demand answer',
    found !== null &&
      _internal.eventAffinityFor(
        [{ dish: { tags: ['coffee'] } }],
        found.effects,
      ) !== _internal.eventAffinityFor([{ dish: { tags: ['no_such_tag'] } }], found.effects),
    found ? 'a boosted tag and an untouched tag score differently' : 'not reached',
  );
}

// --- 9. customer_abandoned_queue, the last §17 reason ------------------------------------------
{
  const match = makeDistrict({ id: 'm_abandon', seed: 'abandon-seed' });
  runUntilPhase(match, 'service');
  const state = _internal.ensureState(match);
  const view = state.restaurants.get('p1');
  for (const table of view.tables.values()) table.occupiedBy = 'blocker';
  const party = _internal.spawnParty(match, state, NEUTRAL_EFFECTS);
  party.restaurantId = 'p1';
  party.state = CUSTOMER_STATES.APPROACH_OR_QUEUE;
  party.patienceMsRemaining = 0;
  const repBefore = view.reputation;
  _internal.advanceParty(match, state, party, TICK_MS);
  if (party.decisionReason) reasonsSeen.add(party.decisionReason);

  check(
    'a party that gives up queueing records customer_abandoned_queue and costs that restaurant reputation',
    party.state === CUSTOMER_STATES.ABANDON_QUEUE &&
      party.decisionReason === 'customer_abandoned_queue' &&
      view.reputation < repBefore &&
      view.abandonedParties === 1,
    `reason=${party.decisionReason} reputation ${repBefore.toFixed(1)} -> ${view.reputation.toFixed(1)}`,
  );
}

// --- 10. every §17 decision reason is reachable ------------------------------------------------
{
  // better_menu_fit needs a menu difference that is about TASTE, not price: same prices, but one
  // restaurant sells what this market's crowd actually wants.
  const match = makeDistrict({
    id: 'm_menu_fit',
    seed: 'menufit-seed',
    menus: {
      p1: submission([
        { dishId: 'caesar_salad', price: 12 },
        { dishId: 'chicken_sandwich', price: 13 },
        { dishId: 'smash_burger', price: 14 },
      ]),
      p2: submission([
        { dishId: 'steak_frites', price: 34 },
        { dishId: 'pasta_primavera', price: 22 },
        { dishId: 'smash_burger', price: 14 },
      ]),
    },
  });
  runUntilPhase(match, 'service');
  const tally = tallyChoices(match, _internal.ensureState(match), 600);
  check(
    'a menu that fits the district\'s crowd better wins parties on better_menu_fit',
    (tally.reasons.better_menu_fit ?? 0) > 0,
    JSON.stringify(tally.reasons),
  );

  const missing = DECISION_REASONS.filter((reason) => !reasonsSeen.has(reason));
  check(
    'every one of the seven PRD §17 decision reasons is reachable and was actually recorded',
    missing.length === 0,
    missing.length === 0 ? [...reasonsSeen].sort().join(', ') : `never reached: ${missing.join(', ')}`,
  );
}

// --- 11. honesty: no reason is invented where no comparison decided anything --------------------
{
  const match = makeDistrict({
    id: 'm_honesty',
    seed: 'honesty-seed',
    menus: { p1: submission(SAME_DISHES), p2: submission(SAME_DISHES) },
  });
  runUntilPhase(match, 'service');
  const tie = tallyChoices(match, _internal.ensureState(match), 400);
  const citedOnATie = Object.values(tie.reasons).reduce((sum, n) => sum + n, 0);
  check(
    'two identical restaurants produce NO decision reasons — a coin flip is not a "better price"',
    citedOnATie === 0,
    `${tie.p1 + tie.p2} parties chose, ${citedOnATie} reasons cited`,
  );

  // A one-restaurant district (a dev match) has nothing to compare against, and says so.
  const solo = new Match({ id: 'm_solo', seed: 'solo-seed', phasePreset: 'prototype', requiredPlayers: 1 });
  solo.join({ fallbackPlayerId: 'p1' });
  solo.setReady('p1', true);
  runUntilPhase(solo, 'service');
  const soloState = _internal.ensureState(solo);
  const soloTally = tallyChoices(solo, soloState, 200);
  const soloComparative = Object.entries(soloTally.reasons).filter(([r]) => r !== 'restaurant_full');
  check(
    'a district with one restaurant cites no comparative reason — there is no rival to have beaten',
    soloTally.p1 > 0 && soloComparative.length === 0,
    `${soloTally.p1} parties chose the only restaurant, reasons: ${JSON.stringify(soloTally.reasons)}`,
  );
}

// --- 12. PRD §21 Milestone 2: different menus produce different customer distributions ---------
{
  const runDistribution = (seed, menus) => {
    const match = makeDistrict({ id: `m_dist_${seed}_${Object.keys(menus).length}`, seed, menus, phasePreset: 'full' });
    runUntilPhase(match, 'service');
    const state = _internal.ensureState(match);
    quiet(() => {
      for (let i = 0; i < 20_000 && match.isServicePhase; i += 1) stepMatch(match, TICK_MS);
    });
    noteReasons(match);
    const views = [...state.restaurants.values()];
    return {
      p1: views[0].counts.chosen,
      p2: views[1].counts.chosen,
      served: views.map((v) => v.counts[CUSTOMER_STATES.REVIEW]),
      spawned: state.counts.spawned,
    };
  };

  const seed = 'milestone2-seed';
  const even = runDistribution(seed, { p1: submission(SAME_DISHES), p2: submission(SAME_DISHES) });
  const skewed = runDistribution(seed, {
    p1: submission(cheaperBy(0.7)),
    p2: submission(SAME_DISHES.map((s) => ({ ...s, price: Number((s.price * 1.5).toFixed(2)) }))),
  });

  console.log(
    `\n    §21 M2, one seed, two setups: identical menus split ${even.p1}/${even.p2}; ` +
      `pricing one restaurant low and the other high split ${skewed.p1}/${skewed.p2} ` +
      `(${even.spawned} and ${skewed.spawned} parties arrived in the district)\n`,
  );

  check(
    'different menu/pricing choices visibly produce different customer distributions (PRD §21 M2)',
    Math.abs(skewed.p1 - skewed.p2) > Math.abs(even.p1 - even.p2) + 10,
    `even ${even.p1}/${even.p2} vs priced ${skewed.p1}/${skewed.p2}`,
  );
  check(
    'a badly priced menu loses conversion but never empties the restaurant (PRD §24)',
    skewed.p2 > 0 && skewed.p2 < skewed.p1,
    `the expensive restaurant still drew ${skewed.p2} parties and served ${skewed.served[1]}`,
  );
}

// --- 13. privacy: neither client receives the rival's hidden state ------------------------------
{
  const p1Menu = submission([
    { dishId: 'steak_frites', price: 41 },
    { dishId: 'pasta_primavera', price: 27 },
    { dishId: 'caesar_salad', price: 17 },
  ]);
  const p2Menu = submission([
    { dishId: 'smash_burger', price: 9 },
    { dishId: 'chicken_sandwich', price: 8 },
    { dishId: 'nachos', price: 11 },
  ]);
  const match = makeDistrict({ id: 'm_privacy', seed: 'privacy-seed', menus: { p1: p1Menu, p2: p2Menu } });
  runUntilPhase(match, 'service');
  quiet(() => {
    for (let i = 0; i < 2000; i += 1) stepMatch(match, TICK_MS);
  });

  const snapshots = { p1: match.toSnapshot('p1'), p2: match.toSnapshot('p2') };

  // Scoped to what THIS story publishes — `restaurants[]` and the viewer's own `you` — because
  // that is what it is responsible for. NOT the whole snapshot: STORY-005's `orders[]` carries
  // a public `dishId` and `price` per ticket by its own explicit design (you can see what is
  // cooking across the street), so a whole-snapshot scan would fail on a decision this story did
  // not make and must not silently reverse. Flagged in the PR rather than smuggled into a check.
  const leaks = [];
  const PRIVATE_KEYS = ['menu', 'price', 'cash', 'inventory', 'revenue', 'ledger', 'budget', 'setup'];
  for (const [viewer, rivalMenu, rivalId] of [['p1', p2Menu, 'p2'], ['p2', p1Menu, 'p1']]) {
    // `restaurants[]` is the district view both players receive identically — the half this
    // story publishes. Dish ids are distinctive strings, so a substring scan for them is
    // structural; the private-field scan below is what covers prices, which are just numbers.
    const wire = JSON.stringify(snapshots[viewer].restaurants);
    for (const slot of [...rivalMenu.menu, ...rivalMenu.addons]) {
      if (wire.includes(slot.dishId)) leaks.push(`${viewer} sees ${rivalId}'s dish ${slot.dishId}`);
    }
    for (const key of PRIVATE_KEYS) {
      if (wire.includes(`"${key}"`)) leaks.push(`${viewer} sees a "${key}" field in restaurants[]`);
    }
    // `you` is the per-viewer half (Decision 16). It must hold this viewer's own submission and
    // never carry a second player's.
    const you = snapshots[viewer].you;
    if (JSON.stringify(you).includes(`"${rivalId}"`)) leaks.push(`${viewer}'s you names ${rivalId}`);
    for (const slot of rivalMenu.menu) {
      if (JSON.stringify(you.setup ?? {}).includes(slot.dishId)) {
        leaks.push(`${viewer}'s you.setup holds ${rivalId}'s ${slot.dishId}`);
      }
    }
  }
  check(
    "neither viewer's district view carries the rival's menu, or any private restaurant field (§18, Decision 16)",
    leaks.length === 0,
    leaks.length === 0
      ? `no rival dish id and none of [${PRIVATE_KEYS.join(', ')}] in restaurants[] or you`
      : leaks.join('; '),
  );
  check(
    "a viewer's own setup is still their own, and only theirs",
    snapshots.p1.you.setup?.menu?.[0]?.dishId === p1Menu.menu[0].dishId &&
      snapshots.p2.you.setup?.menu?.[0]?.dishId === p2Menu.menu[0].dishId,
    "you.setup is the viewer's own submission",
  );

  const allowed = new Set([
    'restaurantId', 'playerId', 'reputation', 'queueLength', 'seatsTotal', 'seatsAvailable',
    'projectedWaitMs', 'guestsServed', 'averageSatisfaction', 'abandonedParties', 'tables',
    'id', 'seats', 'occupiedBy', 'dirty',
  ]);
  const keys = new Set();
  for (const restaurant of snapshots.p1.restaurants) {
    for (const key of Object.keys(restaurant)) keys.add(key);
    for (const table of restaurant.tables ?? []) for (const key of Object.keys(table)) keys.add(key);
  }
  const unexpected = [...keys].filter((k) => !allowed.has(k));
  check(
    'match_snapshot.restaurants carries exactly the public observables the model itself scores',
    snapshots.p1.restaurants.length === 2 && unexpected.length === 0,
    unexpected.length === 0 ? [...keys].sort().join(', ') : `unexpected: ${unexpected.join(', ')}`,
  );
  check(
    'the district decision log stays server-side and never enters a snapshot',
    (match.districtDecisions?.length ?? 0) > 0 &&
      !JSON.stringify(snapshots.p1).includes('districtDecisions') &&
      snapshots.p1.districtDecisions === undefined,
    `${match.districtDecisions.length} decisions recorded on match state, none serialized`,
  );
  check(
    'both viewers receive the same public district view — reputation and queues are visible to both',
    JSON.stringify(snapshots.p1.restaurants) === JSON.stringify(snapshots.p2.restaurants),
    'identical restaurants[] for both viewers',
  );
}

// --- 14. the decision record survives to `results`, where STORY-014 reads it -------------------
{
  const match = makeDistrict({
    id: 'm_results',
    seed: 'results-seed',
    phasePreset: 'prototype',
    menus: { p1: submission(cheaperBy(0.8)), p2: submission(SAME_DISHES) },
  });
  quiet(() => {
    for (let i = 0; i < 40_000 && !match.ended; i += 1) stepMatch(match, TICK_MS);
  });
  noteReasons(match);
  const summary = match.districtSummary ?? [];
  check(
    'the per-restaurant decision summary is published at results, after the sim state is cleared',
    match._customerSimState === undefined &&
      summary.length === 2 &&
      summary.every((r) => Number.isFinite(r.reputation) && r.counts.chosen >= 0),
    summary.map((r) => `${r.restaurantId}: chosen=${r.counts.chosen} lost=${r.counts.CHOOSE_RIVAL} rep=${r.reputation}`).join(' | '),
  );
  check(
    'the full decision log outlives the match, one record per decision, each with its scores',
    (match.districtDecisions?.length ?? 0) > 0 &&
      match.districtDecisions.every(
        (d) => typeof d.customerId === 'string' && d.utilities && Object.keys(d.utilities).length === 2,
      ),
    `${match.districtDecisions.length} decisions, each carrying both restaurants' utilities`,
  );
}

// --- 15. determinism: the same seed decides the same way ----------------------------------------
{
  const digest = (seed) => {
    const match = makeDistrict({
      id: `m_determinism_${seed}_${Math.random()}`,
      seed,
      menus: { p1: submission(cheaperBy(0.85)), p2: submission(SAME_DISHES) },
    });
    runUntilPhase(match, 'service');
    quiet(() => {
      for (let i = 0; i < 2000; i += 1) stepMatch(match, TICK_MS);
    });
    return JSON.stringify(match.districtDecisions);
  };
  const a = digest('determinism-seed');
  const b = digest('determinism-seed');
  const c = digest('other-seed');
  check(
    'the same seed produces the identical decision log (Decision 6/18)',
    a.length > 2 && a === b,
    `${JSON.parse(a).length} decisions, identical`,
  );
  check(
    'a different seed does not',
    a !== c,
    'different seed, different decisions',
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
