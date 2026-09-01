#!/usr/bin/env node
// Upgrade terminal check — STORY-012's acceptance criteria, in process.
//
// Same style as check-owner-actions.mjs: a real `Match`, every gameplay system registered
// against the real simulation loop, and `action-validator.js`'s own `handlePurchaseUpgrade`
// called directly with the exact `{sequence, upgradeId}` shape the wire protocol carries — no
// socket, no server process, no client. This story's substance is almost entirely at the seams
// (does a purchased Serving Tray actually raise the carry-capacity limit `resolvePickup`
// enforces? does Faster Grill actually change a real ticket's timing?), and a check that only
// exercised `upgrade-system.js`'s own facade in isolation would pass against effect hooks
// wired to nothing.
//
// SCOPE: only the 5 upgrades this story wires an effect for (`serving_tray_1`, `serving_tray_2`,
// `faster_grill_1`, `better_seating_1`, `pantry_shelves_1`) get an end-to-end assertion. The
// other 6 catalogue entries are covered by exactly one check — that buying one is rejected,
// not silently accepted or charged.
//
// WHAT THIS SCRIPT DOES NOT COVER. `UpgradeTerminal.tsx`'s rendering and
// `InteractionController.ts#nearUpgradeTerminal` are client TypeScript with no server-side
// equivalent to call — `npm run build:client`'s `tsc --noEmit` is what proves that half
// type-checks. Every check below exercises the SERVER authority path.
//
// Run: node scripts/check-upgrades.mjs

import { Match } from '../server/src/game/match.js';
import { registerSystem, clearSystems, stepMatch } from '../server/src/game/simulation-loop.js';
import { movementSystem } from '../server/src/game/systems/movement-system.js';
import { customerSystem } from '../server/src/game/systems/customer-system.js';
import { orderSystem } from '../server/src/game/systems/order-system.js';
import { setupSystem } from '../server/src/game/systems/setup-system.js';
import { eventSystem } from '../server/src/game/systems/event-system.js';
import { inventorySystem } from '../server/src/game/systems/inventory-system.js';
import { workerSystem } from '../server/src/game/systems/worker-system.js';
import { upgradeSystem, _internal as upgradeInternal } from '../server/src/game/systems/upgrade-system.js';
import { handleInteract, handlePurchaseUpgrade } from '../server/src/game/validators/action-validator.js';
import { catalogue } from '../server/src/game/catalogue.js';
import { readFileSync } from 'node:fs';
import {
  OWNER_CARRY_CAPACITY,
  OWNER_TASK_DURATIONS_MS,
  STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT,
  INVENTORY_RESTOCK_TRAVEL_MS,
  INVENTORY_RESTOCK_MS_PER_UNIT,
} from '../shared/constants/tuning.js';
import { CUSTOMER_STATES } from '../shared/schemas/game-state.js';

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

console.log('Upgrade terminal check — PRD §10 upgrades, action-validator authority\n');

// --- 0. registration --------------------------------------------------------------------------
clearSystems();
registerSystem(movementSystem);
registerSystem(setupSystem);
registerSystem(customerSystem);
registerSystem(orderSystem);
registerSystem(eventSystem);
registerSystem(inventorySystem);
registerSystem(workerSystem);
registerSystem(upgradeSystem);

const PROBE_MAINS = [
  { dishId: 'smash_burger', price: 14 },
  { dishId: 'caesar_salad', price: 12 },
  { dishId: 'chicken_sandwich', price: 13 },
];

function submission({ mains = PROBE_MAINS, addons = [], startingInventory = {}, staff, startingUpgradeId = null, cashRemaining = 0 } = {}) {
  return {
    menu: mains,
    addons,
    startingUpgradeId,
    staffAssignments: staff ?? { cook_1: 'prep', server_1: 'dining_room' },
    startingInventory,
    policyId: null,
    policyDishId: null,
    upgradeCost: 0,
    inventoryCost: 0,
    cashRemaining,
    submittedAtMs: 0,
    locked: false,
    autoFilled: false,
  };
}

function fullPantry() {
  const allocation = {};
  for (const ingredientId of Object.keys(catalogue.ingredients)) {
    allocation[ingredientId] = STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT;
  }
  return allocation;
}

function makeMatch({ id, seed = id, phasePreset = 'prototype', setups, staff }) {
  const playerIds = Object.keys(setups);
  const match = new Match({ id, seed, phasePreset, requiredPlayers: Math.max(1, playerIds.length) });
  for (const playerId of playerIds) {
    match.join({ fallbackPlayerId: playerId });
    match.setReady(playerId, true);
  }
  for (const [playerId, setup] of Object.entries(setups)) {
    match.players.get(playerId).setup = { ...setup, staffAssignments: staff ?? setup.staffAssignments };
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

function step(match, steps = 1) {
  quiet(() => {
    for (let i = 0; i < steps; i += 1) {
      stepMatch(match, TICK_MS);
      dropSpawnedParties(match);
    }
  });
}

/** Remove every party the district spawned, keeping only ones a probe planted — exactly as
 * `check-owner-actions.mjs`/`check-workers.mjs` isolate their own probes from live demand. */
function dropSpawnedParties(match) {
  const parties = match._customerSimState?.parties;
  if (!parties) return;
  for (const [id, party] of parties) {
    if (!id.startsWith('party_probe')) {
      if (party.tableId) {
        const table = match._customerSimState.restaurants.get(party.restaurantId)?.tables.get(party.tableId);
        if (table && table.occupiedBy === id) table.occupiedBy = null;
      }
      parties.delete(id);
    }
  }
}

const kitchenRestaurant = (match, rid) => match._orderSimState.restaurants.get(rid);

function request(overrides = {}) {
  return {
    customerId: 'party_probe',
    restaurantId: 'p1',
    tableId: 'table_1',
    segmentId: 'office_worker',
    partySize: 1,
    preferredTags: [],
    dislikedTags: [],
    budget: 999,
    patienceMs: 120_000,
    ...overrides,
  };
}

function plantParty(match, { customerId, restaurantId = 'p1', state, tableId = null, partySize = 2 }) {
  const sim = match._customerSimState;
  const view = sim.restaurants.get(restaurantId);
  const table = tableId ? view.tables.get(tableId) : null;
  const position = table
    ? { x: table.position[0], y: table.position[1], z: table.position[2] }
    : { x: sim.queuePosition[0], y: sim.queuePosition[1], z: sim.queuePosition[2] };
  if (table) table.occupiedBy = customerId;
  const party = {
    customerId,
    segmentId: 'office_worker',
    partySize,
    state,
    restaurantId,
    position,
    tableId,
    orderId: null,
    orderOutcome: null,
    satisfaction: null,
    decisionReason: null,
    patienceSeconds: 300,
    patienceMsRemaining: 300_000,
    budget: 999,
    preferredTags: [],
    dislikedTags: [],
    spawnedAtMs: match.elapsedMs,
    stateEnteredAtMs: match.elapsedMs,
    patienceAtSeatedFrac: 1,
    patienceAtOrderPlacedFrac: null,
    patienceAtFoodDeliveredFrac: null,
    eatingTargetMs: 10_000,
    everUnhappy: false,
    complaintHandled: false,
  };
  sim.parties.set(customerId, party);
  return party;
}

/** Move the owner to within range of a world entity id, so every test is "the owner walked
 * there", not "the target teleported to the owner" — `check-owner-actions.mjs`'s `standAt`. */
const LAYOUT = JSON.parse(readFileSync(new URL('../shared/game-data/restaurant-layout.json', import.meta.url)));
const ENTITY_BY_ID = new Map(LAYOUT.entities.map((e) => [e.id, e]));
function standAt(match, playerId, entityId) {
  const entity = ENTITY_BY_ID.get(entityId);
  if (!entity) throw new Error(`no layout entity ${entityId}`);
  const [x, y, z] = entity.position;
  match.players.get(playerId).position = { x, y, z };
}
function standFar(match, playerId) {
  match.players.get(playerId).position = { x: -50, y: 0, z: -50 };
}

let seq = 0;
function purchase(match, playerId, upgradeId) {
  seq += 1;
  return handlePurchaseUpgrade(match, playerId, { upgradeId, sequence: seq });
}
let interactSeq = 0;
function interact(match, playerId, targetId, action) {
  interactSeq += 1;
  return handleInteract(match, playerId, { targetId, action, sequence: interactSeq });
}

function cookProbe(id, { cashRemaining = 1000, startingUpgradeId = null, mains = PROBE_MAINS } = {}) {
  const match = makeMatch({
    id,
    setups: { p1: submission({ mains, startingInventory: fullPantry(), cashRemaining, startingUpgradeId }) },
  });
  runUntilPhase(match, 'service');
  step(match, 1);
  standAt(match, 'p1', 'upgrade_terminal');
  return match;
}

// =============================================================================================
// 1. RANGE, EXISTENCE, PHASE — the shape action-validator.js's AC bullet names
// =============================================================================================
{
  const match = cookProbe('m_range');

  const farAway = (() => {
    standFar(match, 'p1');
    return purchase(match, 'p1', 'serving_tray_1');
  })();
  check(
    'a purchase from across the restaurant is rejected out_of_range',
    farAway.ok === false && farAway.reason === 'out_of_range',
    JSON.stringify(farAway),
  );

  standAt(match, 'p1', 'upgrade_terminal');
  const bogus = purchase(match, 'p1', 'not_a_real_upgrade');
  check(
    'an unknown upgrade id is rejected, not treated as any real one',
    bogus.ok === false && bogus.reason === 'unknown_upgrade',
    JSON.stringify(bogus),
  );

  const wrongPhase = (() => {
    const lobbyMatch = makeMatch({ id: 'm_lobby', setups: { p1: submission({ cashRemaining: 1000 }) } });
    standAt(lobbyMatch, 'p1', 'upgrade_terminal');
    return purchase(lobbyMatch, 'p1', 'serving_tray_1');
  })();
  check(
    'purchase outside service/final_rush is rejected by phase',
    wrongPhase.ok === false && wrongPhase.reason === 'wrong_phase',
    JSON.stringify(wrongPhase),
  );
}

// =============================================================================================
// 2. Declared-but-unimplemented EFFECT keys are rejected, never silently free or charged
// =============================================================================================
{
  const match = cookProbe('m_unwired');
  const before = match.upgrades.cashAvailable('p1');
  const result = purchase(match, 'p1', 'prep_counter_1');
  const after = match.upgrades.cashAvailable('p1');
  check(
    'an upgrade with no wired effect is rejected effect_not_implemented, not silently accepted',
    result.ok === false && result.reason === 'effect_not_implemented',
    JSON.stringify(result),
  );
  check(
    'a rejected purchase never touches cash — no charge for an effect nothing reads',
    before === after,
    `${before} -> ${after}`,
  );
  check(
    'it is genuinely not owned after the rejection',
    !match.upgrades.ownedUpgrades('p1').includes('prep_counter_1'),
    JSON.stringify(match.upgrades.ownedUpgrades('p1')),
  );
}

// =============================================================================================
// 3. serving_tray_1 / serving_tray_2 — purchase flow, prerequisite, MAX-of-tiers capacity
// =============================================================================================
{
  const match = cookProbe('m_tray', { cashRemaining: 1000 });
  const catalogueTray1 = catalogue.upgradesById.serving_tray_1;
  const catalogueTray2 = catalogue.upgradesById.serving_tray_2;

  const beforeSecond = purchase(match, 'p1', 'serving_tray_2');
  check(
    'serving_tray_2 is rejected before its prerequisite is owned',
    beforeSecond.ok === false && beforeSecond.reason === 'prerequisite_missing',
    JSON.stringify(beforeSecond),
  );

  const cashBefore = match.upgrades.cashAvailable('p1');
  const bought = purchase(match, 'p1', 'serving_tray_1');
  const cashAfter = match.upgrades.cashAvailable('p1');
  check('a valid purchase of serving_tray_1 succeeds', bought.ok === true, JSON.stringify(bought));
  check(
    'cashAvailable is debited by exactly the upgrade cost',
    cashAfter === cashBefore - catalogueTray1.cost,
    `${cashBefore} -> ${cashAfter}, cost ${catalogueTray1.cost}`,
  );
  check(
    'ownerCarryCapacity reflects the newly owned tier',
    match.upgrades.ownerCarryCapacity('p1') === catalogueTray1.effects.ownerCarryCapacity,
    `capacity=${match.upgrades.ownerCarryCapacity('p1')}`,
  );

  const duplicate = purchase(match, 'p1', 'serving_tray_1');
  check(
    'buying the same upgrade twice is rejected already_owned, never double-charged',
    duplicate.ok === false &&
      duplicate.reason === 'already_owned' &&
      match.upgrades.cashAvailable('p1') === cashAfter,
    JSON.stringify(duplicate),
  );

  const tier2 = purchase(match, 'p1', 'serving_tray_2');
  check(
    'serving_tray_2 becomes purchasable once its prerequisite is owned',
    tier2.ok === true,
    JSON.stringify(tier2),
  );
  check(
    'ownerCarryCapacity takes the MAX across owned tiers — 3, not 2',
    match.upgrades.ownerCarryCapacity('p1') === catalogueTray2.effects.ownerCarryCapacity,
    `capacity=${match.upgrades.ownerCarryCapacity('p1')}`,
  );
  check(
    'both tiers stay recorded owned — MAX is a read, not a replace',
    match.upgrades.ownedUpgrades('p1').includes('serving_tray_1') &&
      match.upgrades.ownedUpgrades('p1').includes('serving_tray_2'),
    JSON.stringify(match.upgrades.ownedUpgrades('p1')),
  );
}

// =============================================================================================
// 4. serving_tray_1 raises the REAL carry-capacity resolvePickup enforces
// =============================================================================================
{
  const match = cookProbe('m_carry', { cashRemaining: 1000 });
  const restaurant = kitchenRestaurant(match, 'p1');

  function plantReady(customerId, tableId) {
    const placed = match.kitchen.placeOrder(request({ customerId, tableId }));
    const order = restaurant.orders.get(placed.orderId);
    for (const ticket of order.tickets) {
      for (const stationState of restaurant.stations.values()) {
        const q = stationState.queue.indexOf(ticket);
        if (q !== -1) stationState.queue.splice(q, 1);
        const a = stationState.active.indexOf(ticket);
        if (a !== -1) stationState.active.splice(a, 1);
      }
      ticket.state = 'ready';
      ticket.station = null;
      ticket.readyAtMs = match.elapsedMs;
    }
    order.state = 'ready';
    order.readyAtMs = match.elapsedMs;
    return order;
  }

  plantReady('party_probe_carry_1', 'table_1');
  plantReady('party_probe_carry_2', 'table_2');

  const player = match.players.get('p1');
  standAt(match, 'p1', 'service_pass');
  const firstPickup = interact(match, 'p1', 'service_pass', 'pickup');
  check('the flat-capacity first pickup succeeds', firstPickup.ok === true, JSON.stringify(firstPickup));

  // Clear the pickup's own busy cooldown between assertions in this block — the SAME
  // convention `check-owner-actions.mjs` uses, isolating "carry_full" from an unrelated "busy".
  player.pendingAction = null;
  const secondBeforeUpgrade = interact(match, 'p1', 'service_pass', 'pickup');
  check(
    'a SECOND pickup is rejected carry_full at the OWNER_CARRY_CAPACITY baseline',
    secondBeforeUpgrade.ok === false &&
      secondBeforeUpgrade.reason === 'carry_full' &&
      OWNER_CARRY_CAPACITY === 1,
    JSON.stringify(secondBeforeUpgrade),
  );

  player.pendingAction = null;
  standAt(match, 'p1', 'upgrade_terminal');
  const bought = purchase(match, 'p1', 'serving_tray_1');
  check('serving_tray_1 purchase succeeds mid-service', bought.ok === true, JSON.stringify(bought));

  standAt(match, 'p1', 'service_pass');
  const secondAfterUpgrade = interact(match, 'p1', 'service_pass', 'pickup');
  check(
    'the SAME second pickup a flat capacity of 1 would reject now succeeds — the upgrade actually raised the real limit',
    secondAfterUpgrade.ok === true,
    JSON.stringify(secondAfterUpgrade),
  );
}

// =============================================================================================
// 5. faster_grill_1 — a real ticket's grill step actually times faster, not just a resolved number
// =============================================================================================
{
  // A single-dish menu (smash_burger only) so every order's one ticket is the same dish in
  // both matches — the comparison needs the SAME baseline durationMs on both sides.
  const GRILL_ONLY_MENU = [{ dishId: 'smash_burger', price: 14 }];

  function grillRemainingMsAfterStart(matchId, grantUpgrade) {
    const match = cookProbe(matchId, { cashRemaining: 1000, mains: GRILL_ONLY_MENU });
    if (grantUpgrade) {
      const state = upgradeInternal.ensureState(match);
      state.restaurants.get('p1').owned.add('faster_grill_1');
      // `match.upgradeEffects` is republished once per tick by `upgradeSystem.update()`,
      // which runs AFTER `orderSystem`/`customerSystem` in registration order — one tick of
      // staleness by design (see `systems/index.js`'s header comment). Step once so the
      // dispatch below reads the just-granted upgrade, not last tick's snapshot of it.
      step(match, 1);
    }
    const restaurant = kitchenRestaurant(match, 'p1');
    const placed = match.kitchen.placeOrder(request({ customerId: `party_probe_grill_${matchId}` }));
    const order = restaurant.orders.get(placed.orderId);
    const ticket = order.tickets.find((t) => t.dishId === 'smash_burger');
    // Drive it through prep (staffed by cook_1, so it dispatches through the brigade seam) to
    // the grill, which auto-dispatches (nobody is posted there) and starts immediately.
    for (let i = 0; i < 400 && ticket.station !== 'grill'; i += 1) step(match, 1);
    return { ticket, restaurant };
  }

  const withoutUpgrade = grillRemainingMsAfterStart('m_grill_control', false);
  const withUpgrade = grillRemainingMsAfterStart('m_grill_upgraded', true);
  const grillDurationMs = withoutUpgrade.ticket.dish.stationSteps.find((s) => s.station === 'grill').durationMs;

  check(
    'setup: both tickets actually reach the grill and start (in_progress) before comparing',
    withoutUpgrade.ticket.station === 'grill' &&
      withoutUpgrade.ticket.state === 'in_progress' &&
      withUpgrade.ticket.station === 'grill' &&
      withUpgrade.ticket.state === 'in_progress',
    `control=${withoutUpgrade.ticket.state}, upgraded=${withUpgrade.ticket.state}`,
  );
  check(
    'faster_grill_1 makes the SAME grill step start with exactly 15% less remaining time',
    withUpgrade.ticket.remainingMs === Math.round(grillDurationMs * 0.85) &&
      withoutUpgrade.ticket.remainingMs === grillDurationMs &&
      withUpgrade.ticket.remainingMs < withoutUpgrade.ticket.remainingMs,
    `control=${withoutUpgrade.ticket.remainingMs}ms, upgraded=${withUpgrade.ticket.remainingMs}ms of ${grillDurationMs}ms`,
  );
}

// =============================================================================================
// 6. better_seating_1 — slows decay from SEATED onward only, never during APPROACH_OR_QUEUE
// =============================================================================================
{
  const match = cookProbe('m_seating', { cashRemaining: 1000 });
  standAt(match, 'p1', 'upgrade_terminal');
  purchase(match, 'p1', 'better_seating_1');
  // One tick for `match.upgradeEffects` to catch up to the purchase — see the identical note
  // in section 5. Without it the FIRST of the 20 ticks below still decays at the un-upgraded
  // rate, since `upgradeSystem` republishes effects after `customerSystem` reads them.
  step(match, 1);

  const queued = plantParty(match, { customerId: 'party_probe_queue', state: CUSTOMER_STATES.APPROACH_OR_QUEUE });
  const seated = plantParty(match, { customerId: 'party_probe_seated', state: CUSTOMER_STATES.SEATED, tableId: 'table_3' });
  const queuedBefore = queued.patienceMsRemaining;
  const seatedBefore = seated.patienceMsRemaining;

  step(match, 20); // 1000ms of real decay
  check(
    'APPROACH_OR_QUEUE decays at the full, un-multiplied rate even with the upgrade owned',
    queuedBefore - queued.patienceMsRemaining === 1000,
    `decayed ${queuedBefore - queued.patienceMsRemaining}ms of 1000ms`,
  );
  const seatedDecay = seatedBefore - seated.patienceMsRemaining;
  check(
    'SEATED decays SLOWER than the raw tick — "seated patience +15%" divides the decay, not multiplies it',
    Math.abs(seatedDecay - 1000 / 1.15) < 1 && seatedDecay < 1000,
    `decayed ${seatedDecay.toFixed(1)}ms of 1000ms, expected ${(1000 / 1.15).toFixed(1)}ms`,
  );
}

// =============================================================================================
// 7. pantry_shelves_1 — reduces the REAL restock duration the pantry facade quotes
// =============================================================================================
{
  const match = cookProbe('m_pantry', { cashRemaining: 1000 });
  const withoutUpgrade = match.pantry.restockDurationMs('p1', 'lettuce', 10);

  standAt(match, 'p1', 'upgrade_terminal');
  const bought = purchase(match, 'p1', 'pantry_shelves_1');
  check('pantry_shelves_1 purchase succeeds', bought.ok === true, JSON.stringify(bought));
  // One tick for `match.upgradeEffects` to catch up — see the identical note in section 5.
  step(match, 1);

  const withUpgrade = match.pantry.restockDurationMs('p1', 'lettuce', 10);
  const expectedWithout = Math.round(INVENTORY_RESTOCK_TRAVEL_MS + INVENTORY_RESTOCK_MS_PER_UNIT * 10);
  const expectedWith = Math.round(INVENTORY_RESTOCK_TRAVEL_MS * 0.75 + INVENTORY_RESTOCK_MS_PER_UNIT * 10);
  check(
    'restock quotes exactly 25% less TRAVEL time, handling unchanged',
    withoutUpgrade === expectedWithout && withUpgrade === expectedWith && withUpgrade < withoutUpgrade,
    `${withoutUpgrade}ms -> ${withUpgrade}ms`,
  );
}

// =============================================================================================
// 8. startingUpgradeId — owned automatically at service start, no additional debit
// =============================================================================================
{
  const match = cookProbe('m_starting', { cashRemaining: 1000, startingUpgradeId: 'pantry_shelves_1' });
  check(
    'the setup-chosen starting upgrade is owned the moment service begins',
    match.upgrades.ownedUpgrades('p1').includes('pantry_shelves_1'),
    JSON.stringify(match.upgrades.ownedUpgrades('p1')),
  );
  check(
    'no additional cash was debited for it — cashRemaining already priced it in at setup',
    match.upgrades.cashAvailable('p1') === 1000,
    `cashAvailable=${match.upgrades.cashAvailable('p1')}`,
  );
}

// =============================================================================================
// 9. cashAvailable arithmetic — starting cash + revenue - spend
// =============================================================================================
{
  const match = cookProbe('m_cash', { cashRemaining: 500 });
  const restaurant = kitchenRestaurant(match, 'p1');
  check('cashAvailable starts at exactly cashRemaining with no revenue or spend yet', match.upgrades.cashAvailable('p1') === 500, `${match.upgrades.cashAvailable('p1')}`);

  restaurant.ledger.revenue = 300; // a settled order's booked revenue, forced for determinism
  check(
    'cashAvailable rises by exactly the booked revenue',
    match.upgrades.cashAvailable('p1') === 800,
    `${match.upgrades.cashAvailable('p1')}`,
  );

  standAt(match, 'p1', 'upgrade_terminal');
  const cost = catalogue.upgradesById.faster_grill_1.cost;
  purchase(match, 'p1', 'faster_grill_1');
  check(
    'cashAvailable falls by exactly the purchase cost on top of that',
    match.upgrades.cashAvailable('p1') === 800 - cost,
    `${match.upgrades.cashAvailable('p1')}, expected ${800 - cost}`,
  );
}

// =============================================================================================
// 10. insufficient_cash — the fourth AC'd rejection reason
// =============================================================================================
{
  const match = cookProbe('m_broke', { cashRemaining: 0 });
  standAt(match, 'p1', 'upgrade_terminal');
  const result = purchase(match, 'p1', 'serving_tray_1');
  check(
    'a purchase with too little cash is rejected insufficient_cash, not silently granted',
    result.ok === false && result.reason === 'insufficient_cash',
    JSON.stringify(result),
  );
  check('nothing was granted for the rejected purchase', match.upgrades.ownedUpgrades('p1').length === 0, JSON.stringify(match.upgrades.ownedUpgrades('p1')));
}

// =============================================================================================
// 11. §21 Milestone 4 "no duplicate-purchase bugs" — same tick, back to back
// =============================================================================================
{
  const match = cookProbe('m_duplicate', { cashRemaining: 1000 });
  standAt(match, 'p1', 'upgrade_terminal');
  const cost = catalogue.upgradesById.faster_grill_1.cost;
  const first = purchase(match, 'p1', 'faster_grill_1');
  const second = purchase(match, 'p1', 'faster_grill_1');
  check(
    'two purchases of the same upgrade back to back never double the effect or double-charge',
    first.ok === true &&
      second.ok === false &&
      second.reason === 'already_owned' &&
      match.upgrades.cashAvailable('p1') === 1000 - cost &&
      match.upgrades.stationSpeedMultiplier('p1', 'grill') === 0.85,
    `cash=${match.upgrades.cashAvailable('p1')}, multiplier=${match.upgrades.stationSpeedMultiplier('p1', 'grill')}`,
  );
}

// =============================================================================================
// 12. PRD §24 affordability cadence — a rising-edge event log, not a level check
// =============================================================================================
{
  const match = cookProbe('m_affordability', { cashRemaining: 0 });
  const state = upgradeInternal.ensureState(match);
  const restaurant = state.restaurants.get('p1');

  check(
    'starting broke, nothing is affordable yet — no event logged',
    restaurant.affordableAtMs.length === 0,
    JSON.stringify(restaurant.affordableAtMs),
  );

  // Simulate revenue arriving: cross the cheapest wired upgrade's cost threshold, forced
  // directly on the ledger for determinism, exactly as section 9 forces `ledger.revenue`.
  const cheapestCost = Math.min(
    ...['serving_tray_1', 'faster_grill_1', 'better_seating_1', 'pantry_shelves_1'].map(
      (id) => catalogue.upgradesById[id].cost,
    ),
  );
  kitchenRestaurant(match, 'p1').ledger.revenue = cheapestCost;
  step(match, 1);
  check(
    'crossing the threshold logs exactly one rising-edge affordability event',
    restaurant.affordableAtMs.length === 1,
    JSON.stringify(restaurant.affordableAtMs),
  );

  step(match, 10);
  check(
    'staying affordable for more ticks does NOT log another event — a level, not a repeat',
    restaurant.affordableAtMs.length === 1,
    JSON.stringify(restaurant.affordableAtMs),
  );

  standAt(match, 'p1', 'upgrade_terminal');
  const cheapestId = ['serving_tray_1', 'faster_grill_1', 'better_seating_1', 'pantry_shelves_1'].find(
    (id) => catalogue.upgradesById[id].cost === cheapestCost,
  );
  purchase(match, 'p1', cheapestId);
  step(match, 1);
  check(
    'buying the only affordable thing drops back to unaffordable — no event on the way down',
    restaurant.affordableAtMs.length === 1,
    JSON.stringify(restaurant.affordableAtMs),
  );

  kitchenRestaurant(match, 'p1').ledger.revenue += 500;
  step(match, 1);
  check(
    'affording something ELSE later logs a second rising-edge event',
    restaurant.affordableAtMs.length === 2,
    JSON.stringify(restaurant.affordableAtMs),
  );
}

// --- summary ------------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log(`${failed.length} FAILED:`);
  for (const r of failed) console.log(`  - ${r.name}`);
  process.exit(1);
}
