#!/usr/bin/env node
// STORY-040 "No automated staff in co-op mode" check — in process.
//
// Same style as `check-coop-mode.mjs` (STORY-039's own check, which this one is a sibling to,
// not a rewrite of) and `check-workers.mjs` (the worker AI check this story leans on for its
// `plantParty`/`plantReadyOrder`-style direct-state-injection technique): a real `Match`, the
// real systems registered against the real simulation loop, no socket, no client.
//
// WHAT THIS STORY ADDS, AND WHAT THIS SCRIPT PROVES, beyond what `check-coop-mode.mjs` already
// covers (co-op reaches service with one shared restaurant, a real action from either seat lands
// on it):
//
//   1. A co-op restaurant's roster/`staffAssignments` is genuinely EMPTY end to end — the pure
//      builders (`buildReadyUpPayload`, `validateSetupSubmission`, `defaultSubmission`) AND the
//      live `worker-system.js#buildStaff` it feeds.
//   2. Every `match.brigade.owns*()` question is `false` for a co-op restaurant — the "no
//      brigade" branch every downstream system already had (worker-system.js's own header,
//      "WHAT THE WORKERS TOOK OVER, AND WHAT STAYED ABSTRACTED").
//   3. Each of those "no brigade" fallbacks is EXERCISED, not just asserted false-by-inspection:
//      a party seats itself, a seated party is greeted and takes its own path to ordering, a
//      ready plate teleports to its table after `ORDER_PASS_HANDOFF_MS`, a paid party's table
//      goes straight back into rotation with no dirty flag, and a low bin auto-dispatches a
//      restock — a real co-op restaurant staffed by nobody but its two players behaving exactly
//      like any other unstaffed restaurant already does today.
//   4. `setup-validator.js`'s `worker_unassigned` rejection does not fire for a co-op submission
//      with an empty roster to assign, and REGRESSION: a non-coop submission with the same empty
//      `staffAssignments` is still rejected — this story changed nothing about every other mode.
//
// Run: node scripts/check-coop-no-staff.mjs

import { Match } from '../server/src/game/match.js';
import { registerSystem, clearSystems, stepMatch } from '../server/src/game/simulation-loop.js';
import { movementSystem } from '../server/src/game/systems/movement-system.js';
import { setupSystem } from '../server/src/game/systems/setup-system.js';
import { customerSystem } from '../server/src/game/systems/customer-system.js';
import { orderSystem } from '../server/src/game/systems/order-system.js';
import { eventSystem } from '../server/src/game/systems/event-system.js';
import { inventorySystem } from '../server/src/game/systems/inventory-system.js';
import { workerSystem } from '../server/src/game/systems/worker-system.js';
import { upgradeSystem } from '../server/src/game/systems/upgrade-system.js';
import {
  validateSetupSubmission,
  defaultSubmission,
} from '../server/src/game/validators/setup-validator.js';
import { buildReadyUpPayload } from '../shared/game-logic/ready-up-menu.js';
import { rosterOf } from '../shared/schemas/setup-rules.js';
import { catalogue } from '../server/src/game/catalogue.js';
import { CUSTOMER_STATES } from '../shared/schemas/game-state.js';
import {
  STARTING_CASH,
  STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT,
  CUSTOMER_SEATED_GREET_MS,
  CUSTOMER_PAYING_MS,
  ORDER_PASS_HANDOFF_MS,
} from '../shared/constants/tuning.js';
import layout from '../shared/game-data/restaurant-layout.json' with { type: 'json' };

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

console.log('Co-op no-automated-staff check\n');

// =============================================================================================
// 1. THE PURE BUILDERS: empty roster in, empty assignments out — and back to a legal submission
// =============================================================================================
{
  // The layout's roster is NOT empty — this story does not touch restaurant-layout.json. If it
  // were empty, "co-op gets an empty roster" would be true for every mode and prove nothing.
  const roster = rosterOf(catalogue.layout);
  check('sanity: the shipped layout has a real, non-empty mandatory roster', roster.length > 0, `roster=${roster.map((w) => w.id).join(',')}`);

  const mains = [
    { dishId: 'smash_burger', price: 14 },
    { dishId: 'caesar_salad', price: 12 },
    { dishId: 'chicken_sandwich', price: 13 },
  ];
  const basePayload = {
    mainIds: mains.map((m) => m.dishId),
    extraIds: [],
    prices: Object.fromEntries(mains.map((m) => [m.dishId, m.price])),
    dishes: catalogue.dishes,
    ingredients: catalogue.ingredients,
    layout: catalogue.layout,
  };

  const coopPayload = buildReadyUpPayload({ ...basePayload, sharedRestaurant: true });
  check(
    'buildReadyUpPayload: sharedRestaurant true builds an EMPTY staffAssignments',
    Object.keys(coopPayload.staffAssignments).length === 0,
    JSON.stringify(coopPayload.staffAssignments),
  );

  const normalPayload = buildReadyUpPayload(basePayload);
  check(
    'buildReadyUpPayload: sharedRestaurant defaults to false — every pre-existing caller unaffected',
    roster.every((w) => normalPayload.staffAssignments[w.id] === w.posts[0]),
    JSON.stringify(normalPayload.staffAssignments),
  );

  const coopAccepted = validateSetupSubmission(
    { ...coopPayload, startingInventory: {} },
    { catalogue, layout: catalogue.layout, startingCash: STARTING_CASH, sharedRestaurant: true },
  );
  check(
    "validateSetupSubmission: a co-op submission with an empty staffAssignments is LEGAL — worker_unassigned never fires",
    coopAccepted.ok === true && Object.keys(coopAccepted.submission.staffAssignments).length === 0,
    JSON.stringify(coopAccepted),
  );

  // REGRESSION: the exact same empty staffAssignments, WITHOUT sharedRestaurant, is still
  // illegal — this story did not loosen the rule for every other mode.
  const nonCoopRejected = validateSetupSubmission(
    { ...normalPayload, staffAssignments: {}, startingInventory: {} },
    { catalogue, layout: catalogue.layout, startingCash: STARTING_CASH },
  );
  check(
    'REGRESSION: the same empty staffAssignments is still worker_unassigned for a non-coop submission',
    nonCoopRejected.ok === false && nonCoopRejected.reason === 'worker_unassigned',
    JSON.stringify(nonCoopRejected),
  );

  const coopDefault = defaultSubmission({ catalogue, layout: catalogue.layout, startingCash: STARTING_CASH, sharedRestaurant: true });
  check(
    'defaultSubmission: an idle co-op player also gets an empty staffAssignments, and it is still a legal fallback',
    Object.keys(coopDefault.staffAssignments).length === 0,
    JSON.stringify(coopDefault.staffAssignments),
  );

  const normalDefault = defaultSubmission({ catalogue, layout: catalogue.layout, startingCash: STARTING_CASH });
  check(
    'REGRESSION: defaultSubmission with no sharedRestaurant option still fills the full mandatory roster',
    roster.every((w) => normalDefault.staffAssignments[w.id] === w.posts[0]),
    JSON.stringify(normalDefault.staffAssignments),
  );
}

// =============================================================================================
// harness for the real-service-phase sections below — same registration set check-coop-mode.mjs
// uses, so this script's Match behaves exactly like that one's, not a bespoke subset.
// =============================================================================================
clearSystems();
registerSystem(movementSystem);
registerSystem(setupSystem);
registerSystem(customerSystem);
registerSystem(orderSystem);
registerSystem(eventSystem);
registerSystem(inventorySystem);
registerSystem(workerSystem);
registerSystem(upgradeSystem);

const TICK_MS = 50;
const PROBE_MAINS = [
  { dishId: 'smash_burger', price: 14 },
  { dishId: 'caesar_salad', price: 12 },
  { dishId: 'chicken_sandwich', price: 13 },
];

function fullPantry() {
  const allocation = {};
  for (const ingredientId of Object.keys(catalogue.ingredients)) {
    allocation[ingredientId] = STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT;
  }
  return allocation;
}

/** A hand-built accepted co-op submission — same shape `setup-validator.js` produces for a real
 * one, with `staffAssignments: {}` since that is the only legal value for a co-op restaurant. */
function coopSubmission({ mains = PROBE_MAINS, cashRemaining = 1000 } = {}) {
  return {
    menu: mains,
    addons: [],
    startingUpgradeId: null,
    staffAssignments: {},
    startingInventory: fullPantry(),
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

function runUntilPhase(match, phase, maxSteps = 20_000) {
  quiet(() => {
    for (let i = 0; i < maxSteps && match.phase !== phase && !match.ended; i += 1) {
      stepMatch(match, TICK_MS);
    }
  });
  return match.phase === phase;
}

/** Step the loop, dropping every party the district itself spawned so a probe's floor only ever
 * holds the parties the probe planted — same isolation technique `check-workers.mjs` uses. */
function step(match, steps = 1, { isolate = true } = {}) {
  quiet(() => {
    for (let i = 0; i < steps; i += 1) {
      stepMatch(match, TICK_MS);
      if (isolate) dropSpawnedParties(match, sharedId);
    }
  });
}

function dropSpawnedParties(match, restaurantId) {
  const parties = match._customerSimState?.parties;
  if (!parties) return;
  for (const [id, party] of parties) {
    if (!id.startsWith('party_probe')) {
      if (party.tableId) {
        const table = match._customerSimState.restaurants.get(restaurantId)?.tables.get(party.tableId);
        if (table && table.occupiedBy === id) table.occupiedBy = null;
      }
      parties.delete(id);
    }
  }
}

/** Plant a party directly on the shared restaurant's floor in a chosen state — the same
 * direct-injection technique `check-workers.mjs#plantParty` uses to force a specific scenario
 * deterministically rather than hoping the district's own RNG produces one. */
function plantParty(match, { customerId, state, tableId = null, partySize = 2 }) {
  const sim = match._customerSimState;
  const view = sim.restaurants.get(sharedId);
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
    restaurantId: sharedId,
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
  };
  sim.parties.set(customerId, party);
  return party;
}

/** Put a plated, ready order on the pass for `tableId`, without waiting for a real kitchen run —
 * same technique as `check-workers.mjs#plantReadyOrder`. */
function plantReadyOrder(match, { customerId, tableId }) {
  const placed = match.kitchen.placeOrder({
    customerId,
    restaurantId: sharedId,
    tableId,
    segmentId: 'office_worker',
    partySize: 2,
    preferredTags: [],
    dislikedTags: [],
    budget: 999,
    patienceMs: 300_000,
  });
  const restaurant = match._orderSimState.restaurants.get(sharedId);
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

const match = new Match({
  id: 'coop-no-staff',
  seed: 'coop-no-staff',
  phasePreset: 'prototype',
  requiredPlayers: 2,
  sharedRestaurant: true,
});
match.join({ fallbackPlayerId: 'host' });
match.join({ fallbackPlayerId: 'guest' });
match.setReady('host', true);
match.setReady('guest', true);
match.players.get('host').setup = coopSubmission();
match.players.get('guest').setup = coopSubmission({ cashRemaining: 500 });

const reachedService = runUntilPhase(match, 'service');
check('the co-op match reaches service with an empty roster on both submissions', reachedService, `phase=${match.phase}`);

const sharedId = match.restaurantIdFor('guest');

// =============================================================================================
// 2. THE ROSTER: worker-system.js#buildStaff genuinely produces zero workers, and every
//    owns*() question the brigade facade answers is false for this restaurant
// =============================================================================================
{
  step(match, 4);
  const staff = match._workerSimState.restaurants.get(sharedId);
  check(
    'worker-system.js#buildStaff: the shared restaurant has ZERO workers — AC1',
    Boolean(staff) && staff.workers.length === 0,
    `workers=${JSON.stringify(staff?.workers)}`,
  );
  check(
    'match.brigade.owns*() is false for every duty on the shared restaurant',
    match.brigade.ownsSeating(sharedId) === false &&
      match.brigade.ownsDelivery(sharedId) === false &&
      match.brigade.ownsOrderTaking(sharedId) === false &&
      match.brigade.ownsPayment(sharedId) === false &&
      match.brigade.ownsTableClearing(sharedId) === false &&
      match.brigade.ownsRestocking(sharedId) === false &&
      match.brigade.ownsStation(sharedId, 'grill') === false,
    'every owns*() question returned false',
  );
}

// =============================================================================================
// 3. THE FALLBACKS: each one actually runs for the shared restaurant, not just "asserted false"
// =============================================================================================

// --- 3a. auto seating: a queued party seats itself, no server/host required -------------------
{
  const party = plantParty(match, { customerId: 'party_probe_queue', state: CUSTOMER_STATES.APPROACH_OR_QUEUE });
  step(match, 10);
  check(
    'AUTO SEATING: a queued co-op party seats itself onto a free table (ownsSeating is false)',
    party.state === CUSTOMER_STATES.SEATED && party.tableId !== null,
    `state=${party.state} tableId=${party.tableId}`,
  );
  match._customerSimState.parties.delete('party_probe_queue');
  if (party.tableId) match._customerSimState.restaurants.get(sharedId).tables.get(party.tableId).occupiedBy = null;
}

// --- 3b. auto greet / order-taking: a seated party moves itself to ORDERING -------------------
{
  const party = plantParty(match, { customerId: 'party_probe_seated', state: CUSTOMER_STATES.SEATED, tableId: 'table_2' });
  step(match, Math.ceil(CUSTOMER_SEATED_GREET_MS / TICK_MS) + 2);
  check(
    'AUTO GREET: a seated co-op party moves itself into ORDERING once CUSTOMER_SEATED_GREET_MS elapses (ownsOrderTaking is false)',
    party.state === CUSTOMER_STATES.ORDERING,
    `state=${party.state}`,
  );
  match._customerSimState.parties.delete('party_probe_seated');
  match._customerSimState.restaurants.get(sharedId).tables.get('table_2').occupiedBy = null;
}

// --- 3c. order-pass hand-off: a ready plate teleports to its table -----------------------------
{
  const order = plantReadyOrder(match, { customerId: 'party_probe_food', tableId: 'table_1' });
  step(match, Math.ceil(ORDER_PASS_HANDOFF_MS / TICK_MS) + 2, { isolate: false });
  const restaurant = match._orderSimState.restaurants.get(sharedId);
  const settled = restaurant.orders.get(order.orderId);
  check(
    'ORDER-PASS HAND-OFF: a ready plate auto-delivers to its table after ORDER_PASS_HANDOFF_MS (ownsDelivery is false)',
    settled.state === 'delivered',
    `state=${settled.state}`,
  );
}

// --- 3d. auto payment collection + table auto-resolves clean (no dirty-table wait) -------------
{
  const party = plantParty(match, { customerId: 'party_probe_paying', state: CUSTOMER_STATES.PAYING, tableId: 'table_3' });
  step(match, Math.ceil(CUSTOMER_PAYING_MS / TICK_MS) + 2);
  const table = match._customerSimState.restaurants.get(sharedId).tables.get('table_3');
  check(
    'AUTO PAYMENT: a paying co-op party moves itself to LEAVING once CUSTOMER_PAYING_MS elapses (ownsPayment is false)',
    party.state === CUSTOMER_STATES.LEAVING,
    `state=${party.state}`,
  );
  check(
    "AUTO TABLE CLEARING: the vacated table is NOT marked dirty — it auto-resolves straight back into rotation (ownsTableClearing is false, exactly the pre-worker-system behavior worker-system.js's own header describes)",
    table.occupiedBy === null && table.dirty === false,
    `occupiedBy=${table.occupiedBy} dirty=${table.dirty}`,
  );
}

// --- 3e. auto-dispatched restocking -------------------------------------------------------------
{
  const inv = match._inventorySimState.restaurants.get(sharedId);
  inv.jobs.length = 0; // start the observation with no restock already walking
  const [{ station, ingredients }] = inv.requirements;
  const ingredientId = ingredients[0].ingredientId;
  inv.bins.get(station)[ingredientId] = 0;
  check('sanity: the shared restaurant still holds pantry stock for the ingredient under test', (inv.pantry[ingredientId] ?? 0) > 0, `pantry.${ingredientId}=${inv.pantry[ingredientId]}`);
  step(match, 4);
  check(
    'AUTO RESTOCKING: an empty bin auto-dispatches a restock job with nobody to walk it (ownsRestocking is false)',
    inv.jobs.length > 0,
    `jobs=${JSON.stringify(inv.jobs.map((j) => ({ ingredientId: j.ingredientId, station: j.station })))}`,
  );
}

// =============================================================================================
// 4. REGRESSION: a plain (non-coop) match still rosters, still owns every duty
// =============================================================================================
{
  const competitive = new Match({ id: 'competitive-no-staff-regression', seed: 'competitive-no-staff-regression', phasePreset: 'prototype', requiredPlayers: 1 });
  competitive.join({ fallbackPlayerId: 'solo' });
  competitive.setReady('solo', true);
  competitive.players.get('solo').setup = {
    menu: PROBE_MAINS,
    addons: [],
    startingUpgradeId: null,
    staffAssignments: { cook_1: 'prep', server_1: 'dining_room', host_1: 'host_stand' },
    startingInventory: fullPantry(),
    policyId: null,
    policyDishId: null,
    upgradeCost: 0,
    inventoryCost: 0,
    cashRemaining: 1000,
    submittedAtMs: 0,
    locked: false,
    autoFilled: false,
  };
  runUntilPhase(competitive, 'service');
  quiet(() => stepMatch(competitive, TICK_MS));
  const staff = competitive._workerSimState.restaurants.get('solo');
  check(
    'REGRESSION: a non-coop restaurant still gets its full rostered brigade — this story changes nothing about it',
    staff.workers.length === rosterOf(catalogue.layout).length &&
      competitive.brigade.ownsSeating('solo') === true &&
      competitive.brigade.ownsRestocking('solo') === true,
    `workers=${staff.workers.length}`,
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
