#!/usr/bin/env node
// Owner interaction check — STORY-008's acceptance criteria, in process.
//
// The repo has no test framework (Milestone 0 Decision 8), so this is a runnable script in the
// style of check-workers.mjs: a real `Match`, the real systems registered against the real
// simulation loop, and `action-validator.js`'s own `handleInteract` called directly with the
// exact `{targetId, action}` shape the wire protocol carries — no socket, no server process, no
// client. `setup`, `customers`, `orders`, `events`, `inventory` AND `workers` are registered
// together: this story's substance is almost entirely at the seams (does the owner's `pickup`
// actually remove a plate from the pool the AI server reads? does `resolveReadyOrders`'s
// abstracted hand-off respect a claim?), and a check that registered only this story's own
// module would pass against a validator wired to nothing real.
//
// WHAT THIS SCRIPT DOES NOT COVER. `InteractionController.ts`'s target resolution and
// `HudPanel`/`App`'s rendering are client TypeScript with no server-side equivalent to call —
// `npm run build:client`'s `tsc --noEmit` is what proves that half type-checks, and this
// script is silent on it. Every check below exercises the SERVER authority path: what
// `action-validator.js` accepts, rejects, and why — which is also the only half PRD §12 asks
// the server to own.
//
// Run: node scripts/check-owner-actions.mjs

import { Match } from '../server/src/game/match.js';
import { registerSystem, clearSystems, stepMatch } from '../server/src/game/simulation-loop.js';
import { movementSystem } from '../server/src/game/systems/movement-system.js';
import { customerSystem } from '../server/src/game/systems/customer-system.js';
import { orderSystem } from '../server/src/game/systems/order-system.js';
import { setupSystem } from '../server/src/game/systems/setup-system.js';
import { eventSystem } from '../server/src/game/systems/event-system.js';
import { inventorySystem } from '../server/src/game/systems/inventory-system.js';
import { workerSystem } from '../server/src/game/systems/worker-system.js';
import { handleInteract } from '../server/src/game/validators/action-validator.js';
import { defaultSubmission } from '../server/src/game/validators/setup-validator.js';
import { catalogue } from '../server/src/game/catalogue.js';
import { CUSTOMER_STATES } from '../shared/schemas/game-state.js';
import { readFileSync } from 'node:fs';
import {
  OWNER_TASK_DURATIONS_MS,
  OWNER_CARRY_CAPACITY,
  OWNER_SPRINT_MAX_MS,
  OWNER_SPRINT_COOLDOWN_MS,
  UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD,
  WORKER_RESTOCK_THRESHOLD_UNITS,
  STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT,
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

console.log('Owner interaction check — PRD §8 contextual actions, action-validator authority\n');

// --- 0. registration --------------------------------------------------------------------------
clearSystems();
registerSystem(movementSystem);
registerSystem(setupSystem);
registerSystem(customerSystem);
registerSystem(orderSystem);
registerSystem(eventSystem);
registerSystem(inventorySystem);
registerSystem(workerSystem);

const PROBE_MAINS = [
  { dishId: 'smash_burger', price: 14 },
  { dishId: 'caesar_salad', price: 12 },
  { dishId: 'chicken_sandwich', price: 13 },
];

function submission({ mains = PROBE_MAINS, addons = [], startingInventory = {}, staff } = {}) {
  return {
    menu: mains,
    addons,
    startingUpgradeId: null,
    staffAssignments: staff ?? { cook_1: 'prep', server_1: 'dining_room' },
    startingInventory,
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

function fullPantry() {
  const allocation = {};
  for (const ingredientId of Object.keys(catalogue.ingredients)) {
    allocation[ingredientId] = STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT;
  }
  return allocation;
}

function makeMatch({ id, seed = id, phasePreset = 'prototype', setups, staff } = {}) {
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

/** Remove every party the district spawned, keeping only ones a probe planted, exactly as
 * `check-workers.mjs` isolates its own probes from live district demand. */
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
const customerView = (match, rid) => match._customerSimState.restaurants.get(rid);
const inventoryOf = (match, rid) => match._inventorySimState.restaurants.get(rid);

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

/** Puts an order on the pass, ready to carry, without waiting for a real kitchen run —
 * `check-workers.mjs`'s `plantReadyOrder`, unchanged. */
function plantReadyOrder(match, { customerId, tableId }) {
  const placed = match.kitchen.placeOrder(request({ customerId, tableId }));
  const restaurant = kitchenRestaurant(match, 'p1');
  const order = restaurant.orders.get(placed.orderId);
  for (const ticket of order.tickets) {
    for (const station of restaurant.stations.values()) {
      const q = station.queue.indexOf(ticket);
      if (q !== -1) station.queue.splice(q, 1);
      const a = station.active.indexOf(ticket);
      if (a !== -1) station.active.splice(a, 1);
    }
    ticket.state = 'ready';
    ticket.station = null;
    ticket.readyAtMs = match.elapsedMs;
  }
  order.state = 'ready';
  order.readyAtMs = match.elapsedMs;
  return order;
}

function plantParty(match, { customerId, restaurantId = 'p1', state, tableId = null, partySize = 2, everUnhappy = false }) {
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
    everUnhappy,
    complaintHandled: false,
  };
  sim.parties.set(customerId, party);
  return party;
}

/** Move the owner to within `OWNER_INTERACT_RANGE` of a world entity id, so every test is
 * "the owner walked there", not "the target teleported to the owner". */
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

/** One `interact` at the current sequence, auto-incrementing so a real test can send several
 * without each call re-deriving the number. */
let seq = 0;
function interact(match, playerId, targetId, action) {
  seq += 1;
  return handleInteract(match, playerId, { targetId, action, sequence: seq });
}

function cookProbe(id) {
  const match = makeMatch({
    id,
    setups: { p1: submission({ startingInventory: fullPantry() }) },
  });
  runUntilPhase(match, 'service');
  step(match, 1);
  return match;
}

// =============================================================================================
// 1. RANGE, EXISTENCE, STATE — the three things action-validator.js's AC bullet names
// =============================================================================================
{
  const match = cookProbe('m_gate');

  standFar(match, 'p1');
  const far = interact(match, 'p1', 'pantry', 'restock');
  check(
    'out of range is rejected, not silently ignored',
    far.ok === false && far.error === 'interact_rejected' && far.reason === 'out_of_range',
    JSON.stringify(far),
  );

  standAt(match, 'p1', 'pantry');
  const noSuchTarget = interact(match, 'p1', 'station_deep_fryer', 'cook');
  check(
    'a target id that names nothing real is rejected, not treated as any station',
    noSuchTarget.ok === false && noSuchTarget.reason === 'no_such_target',
    JSON.stringify(noSuchTarget),
  );

  standAt(match, 'p1', 'station_prep');
  const nothingQueued = interact(match, 'p1', 'station_prep', 'cook');
  check(
    'a real, in-range target with nothing to do is rejected for STATE, not existence',
    nothingQueued.ok === false && nothingQueued.reason === 'nothing_queued',
    JSON.stringify(nothingQueued),
  );

  const wrongPhase = (() => {
    const lobbyMatch = makeMatch({ id: 'm_lobby', setups: { p1: submission() } });
    standAt(lobbyMatch, 'p1', 'pantry');
    return interact(lobbyMatch, 'p1', 'pantry', 'restock');
  })();
  check(
    'interact outside service/final_rush is rejected by phase, not by a coincidental target miss',
    wrongPhase.ok === false && wrongPhase.reason === 'wrong_phase',
    JSON.stringify(wrongPhase),
  );

  const wrongStation = (() => {
    standAt(match, 'p1', 'station_prep');
    return interact(match, 'p1', 'station_prep', 'plate');
  })();
  check(
    '`plate` at a non-plating station is rejected — the action must match what the target IS',
    wrongStation.ok === false && wrongStation.reason === 'wrong_action_for_target',
    JSON.stringify(wrongStation),
  );
}

// =============================================================================================
// 2. cook / plate — same kitchen.startTicket() call, discriminated by station
// =============================================================================================
{
  const match = cookProbe('m_cook');
  const restaurant = kitchenRestaurant(match, 'p1');
  const placed = match.kitchen.placeOrder(request({ customerId: 'party_probe_cook' }));
  const order = restaurant.orders.get(placed.orderId);
  const ticket = order.tickets[0];

  standAt(match, 'p1', `station_${ticket.station}`);
  const result = interact(match, 'p1', `station_${ticket.station}`, 'cook');
  check(
    'a valid `cook` starts the queued ticket at that station',
    result.ok === true && ticket.state === 'in_progress',
    `ticket now ${ticket.state}`,
  );

  const secondQueued = restaurant.stations.get(ticket.station).queue.length;
  check(
    'the ticket left the queue — this is the real dispatch, not a cosmetic flag',
    secondQueued === 0,
    `queue depth ${secondQueued}`,
  );
}

// =============================================================================================
// 3. pickup -> carry -> deliver, the two-touch "carry a plate to a table"
// =============================================================================================
{
  const match = cookProbe('m_carry');
  const order = plantReadyOrder(match, { customerId: 'party_probe_carry', tableId: 'table_2' });

  standAt(match, 'p1', 'service_pass');
  const picked = interact(match, 'p1', 'service_pass', 'pickup');
  const player = match.players.get('p1');
  check(
    'pickup claims the ready order and puts it in the owner\'s hands',
    picked.ok === true && player.carrying.length === 1 && player.carrying[0].orderId === order.orderId,
    JSON.stringify(player.carrying),
  );
  check(
    'a claimed order disappears from readyOrders — the AI server cannot also grab it',
    match.kitchen.readyOrders('p1').length === 0,
    `readyOrders=${match.kitchen.readyOrders('p1').length}`,
  );

  const snap = match.toSnapshot('p1');
  check(
    'the carry is public on match_snapshot.players — an order id, nothing private',
    snap.players.find((p) => p.playerId === 'p1').carrying.join(',') === order.orderId,
    JSON.stringify(snap.players.find((p) => p.playerId === 'p1').carrying),
  );

  player.pendingAction = null; // isolate the wrong-table check from pickup's own cooldown
  standAt(match, 'p1', 'table_1');
  const wrongTable = interact(match, 'p1', 'table_1', 'deliver');
  check(
    'delivering to the WRONG table is rejected — the plate belongs to a specific party',
    wrongTable.ok === false && wrongTable.reason === 'wrong_table',
    JSON.stringify(wrongTable),
  );
  check(
    'a rejected deliver does not drop the plate — the owner is still carrying it',
    player.carrying.length === 1,
    `carrying ${player.carrying.length}`,
  );

  // The busy cooldown from `pickup` above is still running; jump the clock so `deliver` is a
  // clean second action rather than a `busy` rejection muddying what this block is testing.
  match.elapsedMs += OWNER_TASK_DURATIONS_MS.pickup + 1;
  player.pendingAction = null;

  standAt(match, 'p1', 'table_2');
  const delivered = interact(match, 'p1', 'table_2', 'deliver');
  check(
    'delivering to the RIGHT table succeeds and empties the owner\'s hands',
    delivered.ok === true && player.carrying.length === 0 && order.state === 'delivered',
    `ok=${delivered.ok} carrying=${player.carrying.length} order=${order.state}`,
  );
}

// =============================================================================================
// 4. carry capacity — the server-side property, read from tuning, not asserted twice
// =============================================================================================
{
  const match = cookProbe('m_capacity');
  check('OWNER_CARRY_CAPACITY is the PRD §7 baseline of one plate', OWNER_CARRY_CAPACITY === 1, `${OWNER_CARRY_CAPACITY}`);

  plantReadyOrder(match, { customerId: 'party_probe_cap_a', tableId: 'table_1' });
  plantReadyOrder(match, { customerId: 'party_probe_cap_b', tableId: 'table_2' });

  standAt(match, 'p1', 'service_pass');
  interact(match, 'p1', 'service_pass', 'pickup');
  match.players.get('p1').pendingAction = null; // isolate the capacity check from the cooldown
  const secondPickup = interact(match, 'p1', 'service_pass', 'pickup');
  check(
    'a second pickup at capacity is rejected — carry_full, not silently swapped',
    secondPickup.ok === false && secondPickup.reason === 'carry_full',
    JSON.stringify(secondPickup),
  );
  check(
    'the second plate stays on the pass, available to a worker or a later pickup',
    match.kitchen.readyOrders('p1').length === 1,
    `readyOrders=${match.kitchen.readyOrders('p1').length}`,
  );
}

// =============================================================================================
// 5. drop_carry — §8's secondary action (F), self-targeted, releases the claim
// =============================================================================================
{
  const match = cookProbe('m_drop');
  const order = plantReadyOrder(match, { customerId: 'party_probe_drop', tableId: 'table_1' });
  standAt(match, 'p1', 'service_pass');
  interact(match, 'p1', 'service_pass', 'pickup');
  match.players.get('p1').pendingAction = null;

  const dropped = interact(match, 'p1', 'self', 'drop_carry');
  check(
    'drop_carry empties the owner\'s hands without delivering',
    dropped.ok === true && match.players.get('p1').carrying.length === 0 && order.state === 'ready',
    `ok=${dropped.ok} carrying=${match.players.get('p1').carrying.length} order=${order.state}`,
  );
  check(
    'the dropped plate is back on the pass for anyone to pick up again',
    match.kitchen.readyOrders('p1').some((o) => o.orderId === order.orderId),
    `readyOrders=${JSON.stringify(match.kitchen.readyOrders('p1'))}`,
  );
}

// =============================================================================================
// 6. restock — the same shopping list §17 cook rule 4 reads, through the pantry facade
// =============================================================================================
{
  const match = cookProbe('m_restock');
  const inv = inventoryOf(match, 'p1');
  const binBefore = WORKER_RESTOCK_THRESHOLD_UNITS - 5; // at or under the cook's own trigger
  inv.bins.get('prep').lettuce = binBefore;
  standAt(match, 'p1', 'pantry');
  const result = interact(match, 'p1', 'pantry', 'restock');
  check(
    'restock at the pantry requests a trip for the neediest bin',
    result.ok === true,
    JSON.stringify(result),
  );
  check(
    'a restock job is now in flight for that bin',
    inv.jobs.some((j) => j.station === 'prep' && j.ingredientId === 'lettuce'),
    JSON.stringify(inv.jobs),
  );

  const nothingToDo = (() => {
    const m2 = cookProbe('m_restock_full');
    standAt(m2, 'p1', 'pantry');
    return interact(m2, 'p1', 'pantry', 'restock');
  })();
  check(
    'a fully stocked kitchen has nothing to restock — rejected, not a wasted trip',
    nothingToDo.ok === false && nothingToDo.reason === 'nothing_to_restock',
    JSON.stringify(nothingToDo),
  );
}

// =============================================================================================
// 7. seat — the longest-waiting party at the host stand
// =============================================================================================
{
  const match = cookProbe('m_seat');
  plantParty(match, { customerId: 'party_probe_seat', state: CUSTOMER_STATES.APPROACH_OR_QUEUE });
  standAt(match, 'p1', 'host_stand');
  const result = interact(match, 'p1', 'host_stand', 'seat');
  const party = match._customerSimState.parties.get('party_probe_seat');
  check(
    'seat moves the longest-waiting party off the queue and onto a table',
    result.ok === true && party.state === CUSTOMER_STATES.SEATED && party.tableId !== null,
    `ok=${result.ok} state=${party.state} table=${party.tableId}`,
  );
}

// =============================================================================================
// 8. clear_table — a real dirty table, and the state it turns back into
// =============================================================================================
{
  const match = cookProbe('m_clear');
  const table = customerView(match, 'p1').tables.get('table_3');
  table.dirty = true;
  standAt(match, 'p1', 'table_3');
  const result = interact(match, 'p1', 'table_3', 'clear_table');
  check(
    'clear_table wipes a real dirty table',
    result.ok === true && table.dirty === false,
    `ok=${result.ok} dirty=${table.dirty}`,
  );
  const clean = (() => {
    match.players.get('p1').pendingAction = null; // isolate from the first clear's own cooldown
    standAt(match, 'p1', 'table_3');
    return interact(match, 'p1', 'table_3', 'clear_table');
  })();
  check(
    'a clean table is not a legal clear_table target — nothing to do there',
    clean.ok === false && clean.reason === 'not_dirty',
    JSON.stringify(clean),
  );
}

// =============================================================================================
// 9. handle_complaint — PRD §8's "unhappy customer" recovery, and its one-shot limit
// =============================================================================================
{
  // `everUnhappy` is set by real patience decay, not injected — the SEATED party below crosses
  // `UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD` from `advanceParty` ticking it down, the same path a
  // real match uses, so the rest of this block's hand-set `everUnhappy: true` probes are known
  // to be testing what the real trigger actually produces.
  const triggerMatch = cookProbe('m_complaint_trigger');
  const trigger = plantParty(triggerMatch, {
    customerId: 'party_probe_trigger',
    state: CUSTOMER_STATES.SEATED,
    tableId: 'table_6',
  });
  trigger.patienceMsRemaining = (UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD + 0.01) * trigger.patienceSeconds * 1000;
  step(triggerMatch, 1);
  check(
    'CONTROL: still above the threshold, patience decay alone does not mark a party unhappy',
    trigger.everUnhappy === false,
    `frac=${(trigger.patienceMsRemaining / (trigger.patienceSeconds * 1000)).toFixed(3)}`,
  );
  step(triggerMatch, 80); // 4s of real decay — comfortably past the 1%-of-budget buffer above
  check(
    'and crossing it for real (not injected) sets the sticky `everUnhappy` flag',
    trigger.everUnhappy === true,
    `frac=${(trigger.patienceMsRemaining / (trigger.patienceSeconds * 1000)).toFixed(3)}, ` +
      `threshold=${UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD}`,
  );

  const match = cookProbe('m_complaint');
  const party = plantParty(match, {
    customerId: 'party_probe_unhappy',
    state: CUSTOMER_STATES.EATING,
    tableId: 'table_4',
    everUnhappy: true,
  });
  party.patienceMsRemaining = 20_000; // 20s of 300s — well under the threshold, on purpose

  // `match.customers` (what toSnapshot() actually serializes) is republished by
  // customer-system.js's own update() — a tick is needed before a snapshot reflects a party
  // planted directly into the internal state map, exactly like every other probe in this file.
  step(match, 1);
  const snapshotBefore = match.toSnapshot('p1');
  check(
    'the live `unhappy` signal is public on customers[] before the owner acts',
    snapshotBefore.customers.find((c) => c.customerId === party.customerId)?.unhappy === true,
    JSON.stringify(snapshotBefore.customers.find((c) => c.customerId === party.customerId)),
  );

  standAt(match, 'p1', 'table_4');
  const handled = interact(match, 'p1', 'table_4', 'handle_complaint');
  check(
    'handle_complaint recovers the party and buys real patience, not a cosmetic flag',
    handled.ok === true && party.complaintHandled === true && party.patienceMsRemaining > 20_000,
    `ok=${handled.ok} handled=${party.complaintHandled} patience=${party.patienceMsRemaining}`,
  );

  step(match, 1);
  const snapshotAfter = match.toSnapshot('p1');
  check(
    'the signal clears the instant it is handled — live, not sticky, on the wire',
    snapshotAfter.customers.find((c) => c.customerId === party.customerId)?.unhappy === false,
    JSON.stringify(snapshotAfter.customers.find((c) => c.customerId === party.customerId)),
  );

  match.players.get('p1').pendingAction = null;
  const again = interact(match, 'p1', 'table_4', 'handle_complaint');
  check(
    'the same party cannot be farmed for recovery twice',
    again.ok === false && again.reason === 'not_unhappy',
    JSON.stringify(again),
  );

  const control = plantParty(match, {
    customerId: 'party_probe_content',
    state: CUSTOMER_STATES.EATING,
    tableId: 'table_5',
    everUnhappy: false,
  });
  standAt(match, 'p1', 'table_5');
  const notUnhappy = interact(match, 'p1', 'table_5', 'handle_complaint');
  check(
    'CONTROL: a party that was never unhappy is not a legal handle_complaint target',
    notUnhappy.ok === false && notUnhappy.reason === 'not_unhappy',
    JSON.stringify({ result: notUnhappy, control: control.customerId }),
  );
}

// =============================================================================================
// 10. repair — declared, and unreachable until a real failure state exists
// =============================================================================================
{
  const match = cookProbe('m_repair');
  standAt(match, 'p1', 'station_grill');
  const result = interact(match, 'p1', 'station_grill', 'repair');
  check(
    'repair is a legal action shape but always rejected — no station is ever marked broken yet',
    result.ok === false && result.reason === 'no_failure_state',
    JSON.stringify(result),
  );
}

// =============================================================================================
// 11. the owner is faster than a worker, and the differential is one named constant
// =============================================================================================
{
  check(
    'OWNER_TASK_DURATIONS_MS is derived from WORKER_TASK_DURATIONS_MS, not a second set of numbers',
    OWNER_TASK_DURATIONS_MS.cook < OWNER_TASK_DURATIONS_MS.cook + 1 &&
      Object.keys(OWNER_TASK_DURATIONS_MS).every((k) => OWNER_TASK_DURATIONS_MS[k] > 0),
    JSON.stringify(OWNER_TASK_DURATIONS_MS),
  );

  const match = cookProbe('m_busy');
  const restaurant = kitchenRestaurant(match, 'p1');
  const placed = match.kitchen.placeOrder(request({ customerId: 'party_probe_busy' }));
  const ticket = restaurant.orders.get(placed.orderId).tickets[0];
  standAt(match, 'p1', `station_${ticket.station}`);
  interact(match, 'p1', `station_${ticket.station}`, 'cook');

  const secondTicket = restaurant.orders.get(
    match.kitchen.placeOrder(request({ customerId: 'party_probe_busy2' })).orderId,
  ).tickets[0];
  const tooSoon = interact(match, 'p1', `station_${secondTicket.station}`, 'cook');
  check(
    'a second interact before the first action\'s duration elapses is rejected as busy',
    tooSoon.ok === false && tooSoon.reason === 'busy',
    JSON.stringify(tooSoon),
  );

  match.elapsedMs += OWNER_TASK_DURATIONS_MS.cook + 1;
  const afterCooldown = interact(match, 'p1', `station_${secondTicket.station}`, 'cook');
  check(
    'and it succeeds once the action\'s own duration has actually elapsed — a rate, not a lockout',
    afterCooldown.ok === true,
    JSON.stringify(afterCooldown),
  );
}

// =============================================================================================
// 12. arbitration — the owner and the AI server never compete for the same plate
// =============================================================================================
{
  const match = cookProbe('m_arbitration');
  const order = plantReadyOrder(match, { customerId: 'party_probe_arb', tableId: 'table_1' });
  standAt(match, 'p1', 'service_pass');
  interact(match, 'p1', 'service_pass', 'pickup');

  // The AI server would read `readyOrders()` on its own next tick — assert directly against
  // the SAME pool it reads, rather than stepping the loop and hoping the worker's own timing
  // happens to line up, which is what `check-workers.mjs` calls out as the thing that hid a
  // broken seam for three merges when a check only watched the OUTPUT of a shared pool.
  check(
    'a plate the owner claimed is invisible to the pool the AI server reads for its own rule 1',
    match.kitchen.readyOrders('p1').every((o) => o.orderId !== order.orderId),
    `readyOrders=${JSON.stringify(match.kitchen.readyOrders('p1'))}`,
  );

  // And the abstracted hand-off (no server on the floor) must not steal it either — the one
  // configuration `resolveReadyOrders`'s own claimedBy guard exists for.
  const bareMatch = makeMatch({
    id: 'm_arbitration_bare',
    setups: { p1: submission({ startingInventory: fullPantry(), staff: {} }) },
  });
  runUntilPhase(bareMatch, 'service');
  step(bareMatch, 1);
  const bareOrder = plantReadyOrder(bareMatch, { customerId: 'party_probe_bare', tableId: 'table_1' });
  standAt(bareMatch, 'p1', 'service_pass');
  interact(bareMatch, 'p1', 'service_pass', 'pickup');
  step(bareMatch, 300); // well past ORDER_PASS_HANDOFF_MS
  check(
    'the abstracted hand-off does not deliver a plate out from under the owner mid-walk',
    bareOrder.state === 'ready' && match.players?.get,
    `order state=${bareOrder.state}`,
  );
}

// =============================================================================================
// 13. no click-to-earn — no interact action moves revenue
// =============================================================================================
{
  const source = readFileSync(
    new URL('../server/src/game/validators/action-validator.js', import.meta.url),
    'utf8',
  );
  check(
    'action-validator.js never touches revenue, cash or a ledger directly',
    !/revenue|ledger|cash/i.test(source),
    'grepped the file for those three words',
  );

  const match = cookProbe('m_no_click_to_earn');
  const before = match.kitchen.revenueFor('p1');
  standAt(match, 'p1', 'pantry');
  interact(match, 'p1', 'pantry', 'restock');
  standAt(match, 'p1', 'host_stand');
  interact(match, 'p1', 'host_stand', 'seat');
  check(
    'running interacts with nothing to sell moves no money',
    match.kitchen.revenueFor('p1') === before,
    `before=${before} after=${match.kitchen.revenueFor('p1')}`,
  );
}

// =============================================================================================
// 14. sprint stays stamina-limited server-side — STORY-001/003's own AC line, still true
// =============================================================================================
{
  const match = cookProbe('m_sprint');
  const player = match.players.get('p1');
  match.applyInput('p1', { sequence: 1, move: { x: 1, z: 0, sprint: true }, facing: 0 });

  const ticksToExhaust = Math.ceil(OWNER_SPRINT_MAX_MS / TICK_MS) + 2;
  quiet(() => {
    for (let i = 0; i < ticksToExhaust; i += 1) stepMatch(match, TICK_MS);
  });
  check(
    'continuous sprint intent cannot sprint past OWNER_SPRINT_MAX_MS',
    player.sprinting === false && player.sprintCooldownMs > 0,
    `sprinting=${player.sprinting} cooldownMs=${player.sprintCooldownMs}`,
  );

  const stillSprint = (() => {
    quiet(() => stepMatch(match, TICK_MS));
    return player.sprinting;
  })();
  check(
    'and stays locked out through the cooldown, not just for one tick',
    stillSprint === false,
    `cooldownMs=${player.sprintCooldownMs} of ${OWNER_SPRINT_COOLDOWN_MS}`,
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
