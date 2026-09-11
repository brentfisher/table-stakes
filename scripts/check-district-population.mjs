#!/usr/bin/env node
// District population walk-and-render check — the executable half of STORY-044.
//
// Reported: "it seems like [customers] just show up at yours." Investigation found TWO real
// gaps: `party.position` jumped at each of §17's decision points instead of being integrated
// per tick (no real walk, even for a party that DOES render), and the client filtered every
// customer not already tied to the viewer's own `restaurantId` — so a party still deciding, or
// one that chose the rival, never rendered at all. This script proves both are actually fixed:
//
//   1. `party.position` closes on `party.destinationPosition` incrementally, tick by tick, for
//      a party approaching a chosen restaurant's queue, walking to its table once seated, AND
//      (the sharper case found while implementing this story — a "set once at the decision"
//      design would have missed it entirely) a party that leaves without ever choosing one.
//   2. Two parties still deciding at once are NOT rendered stacked on the exact same point.
//   3. `shared/game-logic/district-population.js#shouldRenderCustomerForViewer` — the same
//      predicate `GameClient.ts` filters through — includes every district-transit-state party
//      regardless of `restaurantId`, and still excludes a party actually queued/seated at the
//      rival, on both synthetic snapshots and a real match's own `match.customers` wire shape.
//
// Same house pattern as check-district-choice.mjs: a real `Match`, the real `customerSystem`,
// direct `_internal` calls to force specific branches deterministically rather than hoping a
// seeded run produces them (`_internal` exists ONLY for scripts like this one — see
// customer-system.js's own header on it).
//
// Run: node scripts/check-district-population.mjs

import { Match } from '../server/src/game/match.js';
import { clearSystems, registerSystem, stepMatch } from '../server/src/game/simulation-loop.js';
import { customerSystem, _internal } from '../server/src/game/systems/customer-system.js';
import { setupSystem } from '../server/src/game/systems/setup-system.js';
import layout from '../shared/game-data/restaurant-layout.json' with { type: 'json' };
import { CUSTOMER_STATES } from '../shared/schemas/game-state.js';
import { shouldRenderCustomerForViewer } from '../shared/game-logic/district-population.js';
import {
  CUSTOMER_MOVE_SPEED,
  CUSTOMER_ARRIVAL_EPSILON,
  CUSTOMER_LEAVING_MS,
  CUSTOMER_EXIT_LINGER_MS,
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

function makeDistrict({ id, seed = id } = {}) {
  const match = new Match({ id, seed, phasePreset: 'prototype', requiredPlayers: 2 });
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

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Steps `party` for `ticks` ticks via `_internal.advanceParty` directly (bypassing
 * `customerSystem.update`'s arrivals/cleanup, exactly like check-customer-lifecycle.mjs's own
 * direct-advance sections), recording a `{x, z}` COPY of `party.position` after every tick. */
function recordWalk(match, state, party, ticks) {
  const samples = [];
  quiet(() => {
    for (let i = 0; i < ticks; i += 1) {
      _internal.advanceParty(match, state, party, TICK_MS);
      match.elapsedMs += TICK_MS;
      samples.push({ x: party.position.x, z: party.position.z });
    }
  });
  return samples;
}

clearSystems();
registerSystem(setupSystem);
registerSystem(customerSystem);

console.log('District population walk-and-render check\n');

// --- 1. APPROACH_OR_QUEUE is a real per-tick walk, not a jump ------------------------------
{
  const match = makeDistrict({ id: 'm_walk_queue', seed: 'walk-queue' });
  runUntilPhase(match, 'service');
  const state = _internal.ensureState(match);
  const party = _internal.spawnParty(match, state, NEUTRAL_EFFECTS);
  const birth = { x: party.position.x, z: party.position.z };

  // Force the decision deterministically (same "force the branch" discipline
  // check-customer-lifecycle.mjs uses) rather than hope the probabilistic choice lands on p1.
  party.restaurantId = 'p1';
  party.state = CUSTOMER_STATES.APPROACH_OR_QUEUE;
  party.stateEnteredAtMs = match.elapsedMs;
  // No worker system is registered in this script (see the top-of-file `registerSystem` list),
  // so `advanceParty`'s own automatic-seating fallback (`if (!match.brigade?.ownsSeating(...))
  // tryToSeat(...)`) would otherwise seat this party on tick 1 — same pre-STORY-007 behavior
  // check-customer-lifecycle.mjs's own APPROACH_OR_QUEUE sections rely on elsewhere. Occupying
  // every table keeps it genuinely queued for the whole observation window, which is what THIS
  // section is testing.
  for (const table of state.restaurants.get('p1').tables.values()) table.occupiedBy = 'blocker';

  const target = _internal.queueDisplayPosition(state, party);
  check(
    'the queue slot is genuinely elsewhere, not the party\'s own current position',
    dist(birth, target) > 1,
    `birth=(${birth.x.toFixed(2)},${birth.z.toFixed(2)}) target=(${target.x.toFixed(2)},${target.z.toFixed(2)})`,
  );

  const samples = recordWalk(match, state, party, 60);
  const firstStepDelta = dist(birth, samples[0]);
  const midDeltas = samples.slice(1, 10).map((s, i) => dist(samples[i], s));
  check(
    'position moves a bounded, non-zero distance on the very first tick (an integration step, not a snap)',
    firstStepDelta > 0 && firstStepDelta < dist(birth, target),
    `first-tick delta=${firstStepDelta.toFixed(3)}, full distance=${dist(birth, target).toFixed(3)}`,
  );
  check(
    'every one of several consecutive early ticks moves position again (real per-tick integration, not jump-then-static)',
    midDeltas.every((d) => d > 0),
    `deltas=${midDeltas.map((d) => d.toFixed(3)).join(',')}`,
  );
  const last = samples[samples.length - 1];
  check(
    'the walk actually arrives at the queue slot within CUSTOMER_ARRIVAL_EPSILON',
    dist(last, target) <= CUSTOMER_ARRIVAL_EPSILON,
    `final distance to target=${dist(last, target).toFixed(3)}`,
  );
}

// --- 2. SEATED is a real per-tick walk to the table, not a jump ----------------------------
{
  const match = makeDistrict({ id: 'm_walk_table', seed: 'walk-table' });
  runUntilPhase(match, 'service');
  const state = _internal.ensureState(match);
  const party = _internal.spawnParty(match, state, NEUTRAL_EFFECTS);
  const view = state.restaurants.get('p1');
  const table = [...view.tables.values()][0];

  party.restaurantId = 'p1';
  party.state = CUSTOMER_STATES.SEATED;
  party.stateEnteredAtMs = match.elapsedMs;
  party.tableId = table.id;
  table.occupiedBy = party.customerId;
  const birth = { x: party.position.x, z: party.position.z };
  const tablePos = { x: table.position[0], z: table.position[2] };

  const samples = recordWalk(match, state, party, 60);
  const firstStepDelta = dist(birth, samples[0]);
  check(
    'a newly-seated party does not teleport to its table on the seating tick',
    firstStepDelta > 0 && firstStepDelta < dist(birth, tablePos),
    `first-tick delta=${firstStepDelta.toFixed(3)}, full distance=${dist(birth, tablePos).toFixed(3)}`,
  );
  const last = samples[samples.length - 1];
  check(
    'it eventually walks all the way to its real table position',
    dist(last, tablePos) <= CUSTOMER_ARRIVAL_EPSILON,
    `final distance to table=${dist(last, tablePos).toFixed(3)}`,
  );
}

// --- 3. LEAVE_DISTRICT walks to a genuine exit landmark, not back to its own spawn point ----
// This is the sharpest case: a party that spawns, never chooses a restaurant, and leaves has
// NEVER moved before this tick. A "destination set once at the decision" design (tried first,
// and rejected — see customer-system.js#computeDestination's own header) would have given this
// exact party a destination equal to its own current position: zero delta, indistinguishable
// from the instant-despawn bug this story exists to fix.
{
  const match = makeDistrict({ id: 'm_walk_exit', seed: 'walk-exit' });
  runUntilPhase(match, 'service');
  const state = _internal.ensureState(match);
  const party = _internal.spawnParty(match, state, NEUTRAL_EFFECTS);
  const birth = { x: party.position.x, z: party.position.z };

  party.state = CUSTOMER_STATES.LEAVE_DISTRICT;
  party.stateEnteredAtMs = match.elapsedMs;
  party.exitAtMs = match.elapsedMs;

  const target = _internal.computeDestination(match, state, party);
  check(
    'the exit landmark is a real, distinct point — not the party\'s own current (birth) position',
    dist(target, birth) > 1,
    `birth=(${birth.x.toFixed(2)},${birth.z.toFixed(2)}) exitPosition=(${state.exitPosition[0].toFixed(2)},${state.exitPosition[2].toFixed(2)})`,
  );

  const samples = recordWalk(match, state, party, 40);
  const firstStepDelta = dist(birth, samples[0]);
  check(
    'a party that never moved before now visibly walks on its very first tick as LEAVE_DISTRICT (the bug this story fixes)',
    firstStepDelta > 0,
    `first-tick delta=${firstStepDelta.toFixed(3)}`,
  );
  const totalDelta = dist(birth, samples[samples.length - 1]);
  check(
    'and keeps walking further away over the subsequent ticks, not settling back at zero delta',
    totalDelta > firstStepDelta,
    `total delta after ${samples.length} ticks=${totalDelta.toFixed(3)}, first-tick delta=${firstStepDelta.toFixed(3)}`,
  );
}

// --- 4. Two parties still deciding at once are not stacked on the identical point ----------
{
  const match = makeDistrict({ id: 'm_loiter_spread', seed: 'loiter-spread' });
  runUntilPhase(match, 'service');
  const state = _internal.ensureState(match);
  const a = _internal.spawnParty(match, state, NEUTRAL_EFFECTS); // party_1 — spawns first
  const b = _internal.spawnParty(match, state, NEUTRAL_EFFECTS); // party_2 — same tick

  const destA = _internal.computeDestination(match, state, a);
  const destB = _internal.computeDestination(match, state, b);
  check(
    'two simultaneously-loitering (ENTER_DISTRICT) parties get DIFFERENT destinations, not the identical entry point',
    dist(destA, destB) > 0.5,
    `a=(${destA.x.toFixed(2)},${destA.z.toFixed(2)}) b=(${destB.x.toFixed(2)},${destB.z.toFixed(2)})`,
  );
}

// --- 5. shouldRenderCustomerForViewer — the client's own render-filter predicate -----------
{
  const cases = [
    // [description, customer, viewerRestaurantId, expected]
    ['still deciding, no restaurant yet — visible to either viewer', { restaurantId: null, state: CUSTOMER_STATES.ENTER_DISTRICT }, 'p2', true],
    ['evaluating — visible to either viewer', { restaurantId: null, state: CUSTOMER_STATES.EVALUATE_RESTAURANTS }, 'p1', true],
    ['left without choosing — visible to either viewer', { restaurantId: null, state: CUSTOMER_STATES.LEAVE_DISTRICT }, 'p1', true],
    ['walking out after being served at the RIVAL — still visible (shared exit landmark, not the rival\'s floor)', { restaurantId: 'p2', state: CUSTOMER_STATES.LEAVING }, 'p1', true],
    ['queued at the RIVAL — excluded (would collide with this viewer\'s own queue coordinates)', { restaurantId: 'p2', state: CUSTOMER_STATES.APPROACH_OR_QUEUE }, 'p1', false],
    ['seated at the RIVAL — excluded (would collide with this viewer\'s own table coordinates)', { restaurantId: 'p2', state: CUSTOMER_STATES.SEATED }, 'p1', false],
    ['seated at THIS viewer\'s own restaurant — included, unchanged from before this story', { restaurantId: 'p1', state: CUSTOMER_STATES.SEATED }, 'p1', true],
    ['queued at THIS viewer\'s own restaurant — included, unchanged from before this story', { restaurantId: 'p1', state: CUSTOMER_STATES.APPROACH_OR_QUEUE }, 'p1', true],
  ];
  for (const [description, customer, viewerRestaurantId, expected] of cases) {
    const actual = shouldRenderCustomerForViewer(customer, viewerRestaurantId);
    check(`shouldRenderCustomerForViewer: ${description}`, actual === expected, `got ${actual}, want ${expected}`);
  }
}

// --- 6. The same predicate applied to a REAL match's own match.customers wire shape --------
{
  const match = makeDistrict({ id: 'm_wire_shape', seed: 'wire-shape' });
  runUntilPhase(match, 'service');
  const state = _internal.ensureState(match);

  const deciding = _internal.spawnParty(match, state, NEUTRAL_EFFECTS); // stays ENTER_DISTRICT

  const seated = _internal.spawnParty(match, state, NEUTRAL_EFFECTS);
  seated.restaurantId = 'p1';
  seated.state = CUSTOMER_STATES.SEATED;
  seated.stateEnteredAtMs = match.elapsedMs;
  const view = state.restaurants.get('p1');
  const table = [...view.tables.values()][0];
  seated.tableId = table.id;
  table.occupiedBy = seated.customerId;

  quiet(() => customerSystem.update(match, TICK_MS));

  const decidingSnapshot = match.customers.find((c) => c.customerId === deciding.customerId);
  const seatedSnapshot = match.customers.find((c) => c.customerId === seated.customerId);
  check(
    'match.customers actually publishes the still-deciding party (no state filter, as documented)',
    Boolean(decidingSnapshot),
    `found=${Boolean(decidingSnapshot)}`,
  );
  check(
    'p2\'s own viewer would render the still-deciding party',
    Boolean(decidingSnapshot) && shouldRenderCustomerForViewer(decidingSnapshot, 'p2'),
  );
  check(
    'p2\'s own viewer would NOT render p1\'s seated party',
    Boolean(seatedSnapshot) && !shouldRenderCustomerForViewer(seatedSnapshot, 'p2'),
  );
  check(
    'p1\'s own viewer WOULD render its own seated party (unchanged)',
    Boolean(seatedSnapshot) && shouldRenderCustomerForViewer(seatedSnapshot, 'p1'),
  );
}

// --- 7. CUSTOMER_MOVE_SPEED's own worst-case-exit arithmetic actually holds ----------------
// `shared/constants/tuning.js`'s own comment claims the farthest table in the CURRENT layout
// clears the LEAVING + EXIT_LINGER budget. Measured here against the real layout file rather
// than asserted, so a future layout or tuning edit that breaks the claim fails loudly instead
// of silently going stale in a comment.
{
  const entry = layout.spawn.customerEntry;
  const tables = layout.entities.filter((e) => e.type === 'table');
  const farthest = Math.max(
    ...tables.map((t) => Math.hypot(t.position[0] - entry[0], t.position[2] - entry[2])),
  );
  const budgetMs = CUSTOMER_LEAVING_MS + CUSTOMER_EXIT_LINGER_MS;
  const walkMs = (farthest / CUSTOMER_MOVE_SPEED) * 1000;
  check(
    'the farthest table\'s exit walk completes before cleanupExitedParties would remove it',
    walkMs < budgetMs,
    `farthest=${farthest.toFixed(2)}u walkMs=${walkMs.toFixed(0)} budgetMs=${budgetMs}`,
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
