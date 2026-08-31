#!/usr/bin/env node
// Inventory, ingredient bins and restocking check — STORY-006's acceptance criteria, in process.
//
// The repo has no test framework (Milestone 0 Decision 8), so this is a runnable script in the
// style of check-orders.mjs: a real `Match`, the real systems registered against the real
// simulation loop in the real order, stepped with synthetic `dtMs`. No sockets, no server
// process, no client.
//
// `setup`, `customers`, `orders`, `events` AND `inventory` are registered together, because this
// story's whole substance is at the seams: the kitchen is what consumes stock, the customer
// system is what stops ordering a dish that has gone unavailable, and PRD §9's
// `ingredient_shortage` is what makes a restock slower. A check that registered only this
// story's own system would pass against a model wired to nothing.
//
// Everything that must be proved rather than hoped for is FORCED deterministically — an empty
// bin, an empty pantry, a restock in flight, an event-affected ingredient — because a seeded run
// producing one is luck, not evidence.
//
// Run: node scripts/check-inventory.mjs

import { Match } from '../server/src/game/match.js';
import { registerSystem, clearSystems, stepMatch } from '../server/src/game/simulation-loop.js';
import { customerSystem } from '../server/src/game/systems/customer-system.js';
import { orderSystem } from '../server/src/game/systems/order-system.js';
import { setupSystem } from '../server/src/game/systems/setup-system.js';
import { eventSystem, resolveEffects } from '../server/src/game/systems/event-system.js';
import {
  inventorySystem,
  consumingStationFor,
  _internal,
} from '../server/src/game/systems/inventory-system.js';
import {
  defaultSubmission,
  validateSetupSubmission,
} from '../server/src/game/validators/setup-validator.js';
import { catalogue } from '../server/src/game/catalogue.js';
import { CUSTOMER_STATES } from '../shared/schemas/game-state.js';
import { defaultInventoryAllocation, inventoryCost } from '../shared/schemas/setup-rules.js';
import {
  INVENTORY_MAX_CONCURRENT_RESTOCKS,
  INVENTORY_RESTOCK_MS_PER_UNIT,
  INVENTORY_RESTOCK_THRESHOLD_UNITS,
  INVENTORY_RESTOCK_TRAVEL_MS,
  INVENTORY_STATION_BIN_CAPACITY,
  STARTING_CASH,
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
const dish = (id) => catalogue.dishesById[id];

console.log('Inventory / ingredient bins / restocking check\n');

// --- 0. registration ---------------------------------------------------------------------------
// The order systems/index.js uses. `inventory` last: it decorates the `restaurants[]` array
// `customer-system.js` reassigns wholesale during its own update.
clearSystems();
registerSystem(setupSystem);
registerSystem(customerSystem);
registerSystem(orderSystem);
registerSystem(eventSystem);
registerSystem(inventorySystem);

/** A hand-built accepted submission, the shape `setup-validator.js` produces. */
function submission({ mains, addons = [], startingInventory = {} }) {
  return {
    menu: mains,
    addons,
    startingUpgradeId: null,
    staffAssignments: { cook_1: 'prep', server_1: 'dining_room' },
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

function makeMatch({ id, seed = id, phasePreset = 'prototype', setups = {} }) {
  const playerIds = Object.keys(setups);
  const match = new Match({ id, seed, phasePreset, requiredPlayers: Math.max(1, playerIds.length) });
  for (const playerId of playerIds) {
    match.join({ fallbackPlayerId: playerId });
    match.setReady(playerId, true);
  }
  for (const [playerId, setup] of Object.entries(setups)) {
    match.players.get(playerId).setup = setup;
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
 * Step the whole loop. `isolate` drops the district's parties every tick so a probe's bin levels
 * move only because of the tickets the probe itself placed — parties need eight seconds to reach
 * ORDERING, so clearing them each tick means none ever orders.
 */
function step(match, steps = 1, { isolate = true } = {}) {
  quiet(() => {
    for (let i = 0; i < steps; i += 1) {
      stepMatch(match, TICK_MS);
      if (isolate) match._customerSimState?.parties.clear();
    }
  });
}

/** A party-shaped order request, so a check can place an order without waiting for a spawn. */
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

const PROBE_MAINS = [
  { dishId: 'smash_burger', price: 14 },
  { dishId: 'caesar_salad', price: 12 },
  { dishId: 'chicken_sandwich', price: 13 },
];
const PROBE_ADDONS = [{ dishId: 'cheesecake', price: 10 }];

/** Enough of everything the probe menu needs that nothing is short unless a check empties it. */
function fullPantry(mains = PROBE_MAINS, addons = PROBE_ADDONS, units = 200) {
  const pantry = {};
  for (const slot of [...mains, ...addons]) {
    for (const ingredientId of Object.keys(dish(slot.dishId).ingredients)) pantry[ingredientId] = units;
  }
  return pantry;
}

const inventoryOf = (match, restaurantId = 'p1') =>
  _internal.ensureState(match).restaurants.get(restaurantId);
const ticketsOf = (match, restaurantId = 'p1') => {
  const out = [];
  for (const restaurant of match._orderSimState.restaurants.values()) {
    if (restaurant.restaurantId !== restaurantId) continue;
    for (const order of restaurant.orders.values()) out.push(...order.tickets);
  }
  return out;
};

// --- 1. the pantry is seeded from the STORY-009 allocation, and mise en place fills the bins ----
{
  const allocation = { bun: 30, beef: 30, cheese: 40, lettuce: 60, croutons: 10, dressing: 10, chicken: 30, cheesecake_base: 5, berries: 5 };
  const match = makeMatch({
    id: 'm_seed',
    setups: { p1: submission({ mains: PROBE_MAINS, addons: PROBE_ADDONS, startingInventory: allocation }) },
  });
  runUntilPhase(match, 'service');
  const inv = inventoryOf(match);

  const allocated = Object.values(allocation).reduce((s, n) => s + n, 0);
  check(
    'the restaurant\'s stock is seeded from STORY-009\'s accepted `startingInventory`, unit for unit',
    inv.ledger.unitsAllocated === allocated,
    `${inv.ledger.unitsAllocated}u allocated from the submission`,
  );

  // Mise en place: min(allocation, capacity) into the bin, the rest left in the pantry.
  const binPlusPantry = {};
  for (const [ingredientId, units] of Object.entries(allocation)) {
    binPlusPantry[ingredientId] =
      _internal.binLevel(inv, 'prep', ingredientId) +
      _internal.binLevel(inv, 'plating', ingredientId) +
      (inv.pantry[ingredientId] ?? 0);
  }
  check(
    'no unit is created or destroyed at the setup -> service lock — bins plus pantry equal the allocation',
    Object.entries(allocation).every(([id, units]) => binPlusPantry[id] === units),
    JSON.stringify(binPlusPantry),
  );
  check(
    'each bin opens at min(allocation, INVENTORY_STATION_BIN_CAPACITY), with the surplus left in the pantry',
    _internal.binLevel(inv, 'prep', 'lettuce') === INVENTORY_STATION_BIN_CAPACITY &&
      inv.pantry.lettuce === 60 - INVENTORY_STATION_BIN_CAPACITY &&
      _internal.binLevel(inv, 'prep', 'croutons') === 10 &&
      inv.pantry.croutons === 0,
    `lettuce bin=${_internal.binLevel(inv, 'prep', 'lettuce')} pantry=${inv.pantry.lettuce}; ` +
      `croutons bin=${_internal.binLevel(inv, 'prep', 'croutons')} pantry=${inv.pantry.croutons}`,
  );

  // THE PER-STATION ASSERTION, structurally: cheesecake plates straight from the plating bin and
  // never touches prep; every other probe dish starts at prep and never touches plating. A single
  // flat map keyed only by ingredient cannot produce this.
  check(
    'bins are per STATION, holding only what that station\'s dishes consume',
    _internal.binLevel(inv, 'plating', 'cheesecake_base') === 5 &&
      _internal.binLevel(inv, 'prep', 'cheesecake_base') === 0 &&
      _internal.binLevel(inv, 'prep', 'beef') === 24 &&
      _internal.binLevel(inv, 'plating', 'beef') === 0,
    `cheesecake_base: plating=5 prep=0; beef: prep=${_internal.binLevel(inv, 'prep', 'beef')} plating=0`,
  );
  check(
    'a dish\'s ingredients belong to the station that runs its FIRST stationStep',
    consumingStationFor(dish('smash_burger')) === 'prep' &&
      consumingStationFor(dish('cheesecake')) === 'plating' &&
      inv.requirements.map((r) => r.station).sort().join(',') === 'plating,prep',
    `smash_burger -> prep, cheesecake -> plating; bins: ${inv.requirements.map((r) => r.station).join(', ')}`,
  );
}

// --- 2. consumption happens AT THE STEP, not at order time --------------------------------------
{
  const match = makeMatch({
    id: 'm_consume',
    setups: { p1: submission({ mains: PROBE_MAINS, startingInventory: fullPantry(PROBE_MAINS, []) }) },
  });
  runUntilPhase(match, 'service');
  const inv = inventoryOf(match);

  const before = { ...(inv.bins.get('prep') ?? {}) };
  const placed = match.kitchen.placeOrder(request());
  const ticket = ticketsOf(match)[0];
  const needed = dish(ticket.dishId).ingredients;

  const afterOrder = { ...(inv.bins.get('prep') ?? {}) };
  check(
    'placing an order consumes NOTHING — an order in a queue has not been cooked',
    placed.ok && Object.keys(before).every((id) => afterOrder[id] === before[id]),
    `${ticket.dishId} ordered; prep bin unchanged`,
  );
  check(
    'the ticket is queued and has not started a step yet',
    ticket.state === 'queued' && ticket.stepIndex === -1,
    `state=${ticket.state} stepIndex=${ticket.stepIndex}`,
  );

  step(match, 1); // one tick: dispatchQueues starts the first step
  const afterDispatch = { ...(inv.bins.get('prep') ?? {}) };
  const consumedCorrectly = Object.entries(needed).every(
    ([id, qty]) => afterDispatch[id] === before[id] - qty,
  );
  const untouched = Object.keys(before)
    .filter((id) => !(id in needed))
    .every((id) => afterDispatch[id] === before[id]);
  check(
    'the dish\'s ingredients come out of the bin when its FIRST station step is dispatched',
    ticket.stepIndex === 0 && ticket.state === 'in_progress' && consumedCorrectly && untouched,
    `${ticket.dishId} started at ${ticket.station}; ` +
      Object.entries(needed).map(([id, q]) => `${id} ${before[id]}->${afterDispatch[id]} (-${q})`).join(' '),
  );

  // Walk the rest of the dish's steps: the later stations must not charge for it a second time.
  const totalMs = dish(ticket.dishId).stationSteps.reduce((s, x) => s + x.durationMs, 0);
  step(match, Math.ceil(totalMs / TICK_MS) + 4);
  const afterPlating = { ...(inv.bins.get('prep') ?? {}) };
  check(
    'walking the remaining stationSteps consumes nothing more — one serving is charged once',
    ticket.state === 'ready' &&
      Object.keys(before).every((id) => afterPlating[id] === afterDispatch[id]),
    `${ticket.dishId} reached ${ticket.state} through ${dish(ticket.dishId).stationSteps.length} steps`,
  );
}

// --- 3. an empty bin BLOCKS, and is distinguishable from a merely long queue ---------------------
{
  const match = makeMatch({
    id: 'm_block',
    setups: { p1: submission({ mains: PROBE_MAINS, startingInventory: fullPantry(PROBE_MAINS, []) }) },
  });
  runUntilPhase(match, 'service');
  const inv = inventoryOf(match);

  // CONTROL FIRST: a deep queue with full bins. Nothing here is short, and no ticket is blocked —
  // this is what "a merely long queue" looks like, and it is the thing a shortage must not be
  // confused with.
  for (let i = 0; i < 8; i += 1) {
    match.kitchen.placeOrder(request({ customerId: `party_q_${i}`, tableId: `table_${(i % 6) + 1}` }));
  }
  step(match, 1);
  const backlogDepth = match.kitchen.queueDepth('p1', 'prep');
  const backlogSnapshot = match.toSnapshot('p1');
  check(
    'CONTROL: a station backlog with full bins reports queue depth and NO shortage',
    backlogDepth > 0 &&
      backlogSnapshot.orders.every((o) => o.blockedByIngredientId === null) &&
      (backlogSnapshot.restaurants[0].shortages ?? []).length === 0,
    `${backlogDepth} tickets queued at prep, 0 shortages, 0 blocked tickets`,
  );

  // Now empty ONE ingredient's prep bin while the pantry still holds plenty of it. All three
  // probe mains use lettuce, so the whole queue is about to be blocked on one ingredient.
  //
  // Stepped past the tickets already being worked first: a claim is only attempted when the
  // station has a free pair of hands, so a station that is merely FULL tells you nothing about
  // its bins. The restock the abstracted restocker starts on the same tick takes
  // 3500 + 24 x 150 = 7100ms, so the window this observes is comfortably before it lands.
  const binPrep = inv.bins.get('prep');
  binPrep.lettuce = 0;
  step(match, 70);
  const blockedSnapshot = match.toSnapshot('p1');
  const blockedTickets = blockedSnapshot.orders.filter((o) => o.blockedByIngredientId === 'lettuce');
  const shortages = blockedSnapshot.restaurants[0].shortages ?? [];
  const lettuceShort = shortages.find((s) => s.ingredientId === 'lettuce');

  check(
    'an empty bin blocks the tickets that need it — they stay queued instead of being produced',
    blockedTickets.length > 0 && blockedTickets.every((o) => o.state === 'queued'),
    `${blockedTickets.length} tickets held at prep on lettuce`,
  );
  check(
    'the shortage is its own snapshot state, naming the station and the ingredient',
    Boolean(lettuceShort) &&
      lettuceShort.station === 'prep' &&
      lettuceShort.blockedTickets > 0 &&
      lettuceShort.exhausted === false,
    JSON.stringify(lettuceShort),
  );
  check(
    'a blocked ticket is distinguishable from a queued one at the ticket level, not inferred',
    blockedSnapshot.orders.some((o) => o.state === 'queued' && o.blockedByIngredientId !== null),
    'orders[].blockedByIngredientId names the ingredient; null means "waiting for hands"',
  );
  // A blocked ticket keeps its place in the station's queue, so the STORY-005 identity between
  // the snapshot and `kitchen.queueDepth()` still holds while a shortage is running.
  const derivedDepth = blockedSnapshot.orders.filter(
    (o) => o.station === 'prep' && o.state === 'queued',
  ).length;
  check(
    'queue depth still equals the derived count during a shortage — blocking does not move tickets',
    derivedDepth === match.kitchen.queueDepth('p1', 'prep'),
    `derived ${derivedDepth} === kitchen.queueDepth ${match.kitchen.queueDepth('p1', 'prep')}`,
  );

  // A dish whose bin is empty but whose pantry is not is still ON the menu: this is a delay, not
  // a menu change, and it is what the restock recovers from.
  check(
    'a bin-empty-but-pantry-stocked dish stays available — the shortage is recoverable, not terminal',
    match.dishAvailability.p1.smash_burger === true &&
      match.pantry.stockOf('p1', 'lettuce') + _internal.binLevel(inv, 'prep', 'lettuce') > 0,
    `pantry lettuce=${match.pantry.stockOf('p1', 'lettuce')}`,
  );

  // RECOVERY. The abstracted restocker is already walking; step until it lands.
  const producedBefore = match._orderSimState.restaurants.get('p1').ledger.dishesProduced;
  step(match, Math.ceil((INVENTORY_RESTOCK_TRAVEL_MS + 30 * INVENTORY_RESTOCK_MS_PER_UNIT) / TICK_MS) + 400);
  const after = match.toSnapshot('p1');
  check(
    'a restock un-blocks the queue and normal production resumes (block -> recovery)',
    _internal.binLevel(inv, 'prep', 'lettuce') > 0 &&
      match._orderSimState.restaurants.get('p1').ledger.dishesProduced > producedBefore &&
      (after.restaurants[0].shortages ?? []).every((s) => s.ingredientId !== 'lettuce'),
    `lettuce bin back to ${_internal.binLevel(inv, 'prep', 'lettuce')}u; ` +
      `${match._orderSimState.restaurants.get('p1').ledger.dishesProduced - producedBefore} more dishes produced`,
  );
}

// --- 4. one empty bin does not stop the station, and does not stop the other station -------------
{
  const match = makeMatch({
    id: 'm_stations',
    setups: {
      p1: submission({
        mains: PROBE_MAINS,
        addons: PROBE_ADDONS,
        startingInventory: fullPantry(),
      }),
    },
  });
  runUntilPhase(match, 'service');
  const inv = inventoryOf(match);

  // Collect one cheesecake ticket (plating-consuming) and one prep ticket, deterministically:
  // keep placing orders until both kinds exist.
  let cheesecakeTicket = null;
  let prepTicket = null;
  for (let i = 0; i < 60 && (!cheesecakeTicket || !prepTicket); i += 1) {
    match.kitchen.placeOrder(request({ customerId: `party_s_${i}`, tableId: `table_${(i % 6) + 1}`, partySize: 2 }));
    for (const ticket of ticketsOf(match)) {
      if (ticket.stepIndex !== -1) continue;
      if (ticket.dishId === 'cheesecake') cheesecakeTicket ??= ticket;
      else prepTicket ??= ticket;
    }
  }

  // Empty the PLATING bin's cheesecake_base only. Prep is untouched and must keep cooking.
  inv.bins.get('plating').cheesecake_base = 0;
  inv.jobs.length = 0; // start the observation with no restock already walking
  step(match, 1);
  check(
    'draining the PLATING bin blocks only the dish that plates from it; prep keeps producing',
    cheesecakeTicket.state === 'queued' &&
      cheesecakeTicket.blockedByIngredientId === 'cheesecake_base' &&
      cheesecakeTicket.station === 'plating' &&
      prepTicket.state !== 'queued',
    `cheesecake held at plating on cheesecake_base; ${prepTicket.dishId} is ${prepTicket.state} at prep`,
  );
  const shortage = match.pantry.shortagesFor('p1').find((s) => s.ingredientId === 'cheesecake_base');
  check(
    'the shortage names the station whose bin is empty, not just the ingredient',
    shortage?.station === 'plating',
    JSON.stringify(shortage),
  );

  // The mirror: refill plating, empty every PREP ingredient. The cheesecake must plate anyway.
  inv.bins.get('plating').cheesecake_base = 20;
  for (const id of Object.keys(inv.bins.get('prep'))) inv.bins.get('prep')[id] = 0;
  inv.jobs.length = 0;
  const platedBefore = match._orderSimState.restaurants.get('p1').ledger.dishesProduced;
  step(match, Math.ceil(dish('cheesecake').stationSteps[0].durationMs / TICK_MS) + 4);
  check(
    'draining every PREP ingredient does not stop the plating station — the bins are independent',
    match._orderSimState.restaurants.get('p1').ledger.dishesProduced > platedBefore &&
      ticketsOf(match).some((t) => t.dishId === 'cheesecake' && t.state !== 'queued'),
    `${match._orderSimState.restaurants.get('p1').ledger.dishesProduced - platedBefore} dishes plated with prep empty`,
  );
}

// --- 5. a blocked ticket is skipped, not a head-of-line block ------------------------------------
{
  const match = makeMatch({
    id: 'm_headline',
    setups: {
      p1: submission({
        mains: [
          { dishId: 'steak_frites', price: 34 },
          { dishId: 'espresso', price: 5 },
          { dishId: 'caesar_salad', price: 12 },
        ].slice(0, 3),
        startingInventory: fullPantry(
          [{ dishId: 'steak_frites' }, { dishId: 'caesar_salad' }, { dishId: 'espresso' }],
          [],
        ),
      }),
    },
  });
  runUntilPhase(match, 'service');
  const inv = inventoryOf(match);

  // steak_frites is the only dish that needs steak. Empty it, place a steak ticket first, then a
  // salad behind it, and give prep exactly one free pair of hands.
  inv.bins.get('prep').steak = 0;
  inv.jobs.length = 0;
  match.kitchen.placeOrder(request({ customerId: 'party_steak', preferredTags: ['premium', 'date-night'], dislikedTags: ['light', 'quick', 'office', 'vegetarian'] }));
  match.kitchen.placeOrder(request({ customerId: 'party_salad', tableId: 'table_2', preferredTags: ['light', 'quick', 'office', 'vegetarian'], dislikedTags: ['premium', 'date-night', 'hearty'] }));
  const [first, second] = ticketsOf(match);
  step(match, 1);
  check(
    'a ticket blocked on an empty bin is skipped over, not left to block the whole station',
    first.dishId === 'steak_frites' &&
      first.state === 'queued' &&
      first.blockedByIngredientId === 'steak' &&
      second.state === 'in_progress',
    `${first.dishId} held on steak; ${second.dishId} started behind it`,
  );
}

// --- 6. bin AND pantry empty: the dish leaves the menu, and its order is cancelled ----------------
{
  const match = makeMatch({
    id: 'm_unavailable',
    setups: {
      p1: submission({ mains: PROBE_MAINS, startingInventory: fullPantry(PROBE_MAINS, []) }),
    },
  });
  runUntilPhase(match, 'service');
  const inv = inventoryOf(match);

  // caesar_salad is the only probe main that needs croutons. Take every crouton the restaurant
  // owns — bin, pantry and anything in transit — and nothing else.
  const kill = (ingredientId) => {
    inv.pantry[ingredientId] = 0;
    for (const bin of inv.bins.values()) if (ingredientId in bin) bin[ingredientId] = 0;
    inv.jobs = inv.jobs.filter((j) => j.ingredientId !== ingredientId);
  };

  const placed = match.kitchen.placeOrder(request({ customerId: 'party_doomed', preferredTags: ['light', 'quick', 'office', 'vegetarian'], dislikedTags: ['hearty', 'fast', 'casual', 'portable', 'stadium'] }));
  const doomed = ticketsOf(match).find((t) => t.dishId === 'caesar_salad');
  kill('croutons');
  step(match, 2);

  check(
    'with the ingredient gone from bin AND pantry, the dish is marked unavailable',
    match.dishAvailability.p1.caesar_salad === false &&
      match.dishAvailability.p1.smash_burger === true,
    `caesar_salad=false, smash_burger=true`,
  );
  const shortage = match.pantry.shortagesFor('p1').find((s) => s.ingredientId === 'croutons');
  check(
    'the shortage reports `exhausted` — a delay and an ingredient that is gone are not the same state',
    shortage?.exhausted === true,
    JSON.stringify(shortage),
  );
  check(
    'an in-flight ticket for an unavailable dish is voided, and its order is cancelled',
    Boolean(doomed) &&
      doomed.state === 'cancelled' &&
      match.kitchen.pollDelivery(placed.orderId)?.cancelled === true,
    `${doomed?.dishId} voided as "${doomed?.voidedReason}"; order ${match.kitchen.pollDelivery(placed.orderId)?.reason}`,
  );

  // New orders stop selecting it. 60 orders is far past the point a 1-in-3 draw would miss it.
  let sawUnavailable = 0;
  for (let i = 0; i < 60; i += 1) {
    match.kitchen.placeOrder(request({ customerId: `party_after_${i}`, tableId: `table_${(i % 6) + 1}`, partySize: 3 }));
  }
  for (const ticket of ticketsOf(match)) {
    if (ticket.dishId === 'caesar_salad' && ticket.orderId !== placed.orderId) sawUnavailable += 1;
  }
  check(
    'an unavailable dish drops off the menu — no new order selects it (§8 "menu items unavailable")',
    sawUnavailable === 0,
    `${ticketsOf(match).length} tickets placed after it went unavailable, 0 of them caesar_salad`,
  );
}

// --- 7. a real party whose only dish runs out reaches CANCEL_ORDER --------------------------------
{
  const match = makeMatch({
    id: 'm_cancel_party',
    phasePreset: 'full',
    setups: {
      p1: submission({ mains: PROBE_MAINS, startingInventory: fullPantry(PROBE_MAINS, [], 600) }),
    },
  });
  runUntilPhase(match, 'service');
  const inv = inventoryOf(match);

  // Let the district run for real until a party is WAITING_FOR_FOOD with its tickets STILL
  // QUEUED — which is the only interesting case, because a ticket already on the line has had
  // its ingredients pulled and will be cooked. Prep is deliberately jammed with probe orders so
  // a real party's tickets go to the back of a queue rather than starting immediately.
  let waiting = null;
  quiet(() => {
    for (let i = 0; i < 5_000 && !waiting; i += 1) {
      if (!match.kitchen) break;
      while (match.kitchen.queueDepth('p1', 'prep') < 6) {
        match.kitchen.placeOrder(request({ customerId: `party_jam_${i}`, tableId: 'table_1' }));
      }
      stepMatch(match, TICK_MS);
      for (const party of match._customerSimState?.parties.values() ?? []) {
        if (party.state !== CUSTOMER_STATES.WAITING_FOR_FOOD) continue;
        const tickets = ticketsOf(match).filter((x) => x.orderId === party.orderId);
        if (tickets.length > 0 && tickets.every((x) => x.state === 'queued')) waiting = party;
      }
    }
  });

  // Now take away everything the restaurant owns. Every menu dish becomes unproducible, so every
  // queued ticket of that party's order is voided and the order is cancelled outright.
  if (waiting) {
    for (const bin of inv.bins.values()) for (const id of Object.keys(bin)) bin[id] = 0;
    for (const id of Object.keys(inv.pantry)) inv.pantry[id] = 0;
    inv.jobs.length = 0;
    quiet(() => {
      for (let i = 0; i < 400 && waiting.state === CUSTOMER_STATES.WAITING_FOR_FOOD; i += 1) {
        stepMatch(match, TICK_MS);
      }
    });
  }
  check(
    'a real party waiting on food the kitchen can no longer make reaches CANCEL_ORDER (PRD §8)',
    Boolean(waiting) && waiting.state === CUSTOMER_STATES.CANCEL_ORDER,
    waiting
      ? `party ${waiting.customerId} -> ${waiting.state}`
      : 'no party ever reached WAITING_FOR_FOOD with a queued ticket',
  );
}

// --- 8. restocking moves stock pantry -> bin, and it TAKES TIME -----------------------------------
{
  const match = makeMatch({
    id: 'm_restock',
    setups: { p1: submission({ mains: PROBE_MAINS, startingInventory: fullPantry(PROBE_MAINS, []) }) },
  });
  runUntilPhase(match, 'service');
  const inv = inventoryOf(match);

  inv.bins.get('prep').beef = 4;
  inv.jobs.length = 0;
  const pantryBefore = inv.pantry.beef;
  const units = INVENTORY_STATION_BIN_CAPACITY - 4;
  const expectedMs = INVENTORY_RESTOCK_TRAVEL_MS + INVENTORY_RESTOCK_MS_PER_UNIT * units;

  const job = match.pantry.requestRestock('p1', 'prep', 'beef');
  check(
    'a restock is a timed job whose duration is travel + per-unit handling, both from tuning.js',
    job.ok && job.units === units && job.durationMs === expectedMs,
    `${job.units}u in ${job.durationMs}ms (= ${INVENTORY_RESTOCK_TRAVEL_MS} travel + ${units} x ${INVENTORY_RESTOCK_MS_PER_UNIT})`,
  );
  check(
    'the units leave the pantry the moment the trip starts, so two requests cannot promise the same stock',
    inv.pantry.beef === pantryBefore - units,
    `pantry beef ${pantryBefore} -> ${inv.pantry.beef}`,
  );
  check(
    'a second concurrent restock is refused while one is walking (one pair of hands)',
    match.pantry.requestRestock('p1', 'prep', 'cheese').reason === 'restocker_busy' &&
      INVENTORY_MAX_CONCURRENT_RESTOCKS === 1,
    'restocker_busy',
  );

  // The bin must be UNCHANGED right up to the last tick before the job lands.
  const ticksToLand = Math.ceil(expectedMs / TICK_MS);
  step(match, ticksToLand - 1);
  const midFlight = _internal.binLevel(inv, 'prep', 'beef');
  step(match, 1);
  const landed = _internal.binLevel(inv, 'prep', 'beef');
  check(
    'nothing reaches the bin until the trip is over — a restock is not instantaneous',
    midFlight < 4 + units && landed === 4 + units,
    `bin ${midFlight}u one tick before the trip lands, ${landed}u after`,
  );

  // PRD §10 "Pantry Shelves — restock travel time -25%": STORY-012's hook, read defensively.
  inv.bins.get('prep').beef = 0;
  inv.jobs.length = 0;
  match.upgradeEffects = { restockTravelTimeMultiplier: 0.75 };
  const upgraded = match.pantry.requestRestock('p1', 'prep', 'beef', 10);
  match.upgradeEffects = undefined;
  check(
    'PRD §10\'s "restock travel time -25%" hook scales the TRAVEL half and leaves handling alone',
    upgraded.durationMs ===
      Math.round(INVENTORY_RESTOCK_TRAVEL_MS * 0.75 + INVENTORY_RESTOCK_MS_PER_UNIT * 10),
    `${upgraded.durationMs}ms with Pantry Shelves vs ` +
      `${INVENTORY_RESTOCK_TRAVEL_MS + INVENTORY_RESTOCK_MS_PER_UNIT * 10}ms without`,
  );
  check(
    'a restock from an empty pantry is refused rather than inventing stock',
    (() => {
      inv.pantry.dressing = 0;
      inv.jobs.length = 0;
      inv.bins.get('prep').dressing = 0;
      return match.pantry.requestRestock('p1', 'prep', 'dressing').reason === 'pantry_empty';
    })(),
    'pantry_empty',
  );
}

// --- 9. PRD §9 `ingredient_shortage` runs through the same model, not a special case ---------------
{
  const match = makeMatch({
    id: 'm_event',
    setups: {
      p1: submission({ mains: PROBE_MAINS, startingInventory: fullPantry(PROBE_MAINS, []) }),
      p2: submission({ mains: PROBE_MAINS, startingInventory: fullPantry(PROBE_MAINS, []) }),
    },
  });
  runUntilPhase(match, 'service');
  const state = _internal.ensureState(match);
  const inv = inventoryOf(match);

  const card = catalogue.eventsById.ingredient_shortage;
  const neutralDurations = {};
  for (const ingredientId of ['beef', 'cheese', 'lettuce', 'bun', 'chicken', 'croutons', 'dressing']) {
    neutralDurations[ingredientId] = match.pantry.restockDurationMs(ingredientId, 10);
  }
  check(
    'with no event running, every ingredient restocks at the same speed',
    new Set(Object.values(neutralDurations)).size === 1,
    `${Object.values(neutralDurations)[0]}ms for all of them`,
  );

  // The real resolution path — `resolveEffects` is the function event-system.js itself calls, so
  // the effect keys come from events.json rather than from this script.
  // `event-system.js` republishes `match.eventEffects` on EVERY tick, active or not, so a forced
  // effects object must be read by this system before the loop overwrites it. The system's own
  // `update` is the real code path either way — section 10 below runs the whole seeded deck.
  match.eventEffects = resolveEffects(match.market, [card]);
  quiet(() => inventorySystem.update(match, TICK_MS));
  const affected = match.pantry.affectedIngredientIds();

  check(
    'the event names an ingredient count and a restock multiplier, and both reach the model',
    match.eventEffects.affectedIngredientCount === card.effects.affectedIngredientCount &&
      match.eventEffects.ingredientRestockDurationMultiplier ===
        card.effects.ingredientRestockDurationMultiplier &&
      affected.length === card.effects.affectedIngredientCount,
    `affected: ${affected.join(', ')} (x${card.effects.ingredientRestockDurationMultiplier} restock)`,
  );
  check(
    'the affected ingredient is drawn from what the restaurants actually cook, never from the whole catalogue',
    affected.length === card.effects.affectedIngredientCount &&
      affected.every((id) =>
        inv.requirements.some((r) => r.ingredients.some((x) => x.ingredientId === id)),
      ),
    `${affected.join(', ')} is on the locked menu`,
  );

  // THE DISCRIMINATING ASSERTION. "A restock took time" passes even when the effect key is
  // misspelled and reads as the neutral 1.0. Comparing the affected ingredient against an
  // unaffected one, same units, cannot.
  const unaffected = ['beef', 'cheese', 'lettuce', 'bun', 'chicken', 'croutons', 'dressing'].find(
    (id) => !affected.includes(id),
  );
  const affectedMs = match.pantry.restockDurationMs(affected[0], 10);
  const unaffectedMs = match.pantry.restockDurationMs(unaffected, 10);
  check(
    'the affected ingredient restocks exactly `ingredientRestockDurationMultiplier` slower than an unaffected one',
    affectedMs === Math.round(unaffectedMs * card.effects.ingredientRestockDurationMultiplier) &&
      affectedMs !== unaffectedMs,
    `${affected[0]} ${affectedMs}ms vs ${unaffected} ${unaffectedMs}ms (x${(affectedMs / unaffectedMs).toFixed(2)})`,
  );
  check(
    'PRD §9 fairness: both restaurants read the SAME affected ingredient — one match-level draw',
    affected.length > 0 &&
      JSON.stringify(match.pantry.affectedIngredientIds()) === JSON.stringify(affected) &&
      Array.isArray(match.pantry.shortagesFor('p2')),
    `p1 and p2 both see ${affected.join(', ')}`,
  );

  // Held for the life of the shortage: an unrelated event ending must not re-roll which
  // ingredient is scarce.
  match.eventEffects = resolveEffects(match.market, [card, catalogue.eventsById.rainstorm]);
  quiet(() => inventorySystem.update(match, TICK_MS));
  check(
    'the affected ingredient is drawn once, on the rising edge, and held while the shortage lasts',
    affected.length > 0 &&
      JSON.stringify(match.pantry.affectedIngredientIds()) === JSON.stringify(affected),
    `still ${match.pantry.affectedIngredientIds().join(', ')} after a second event started`,
  );

  match.eventEffects = resolveEffects(match.market, []);
  quiet(() => inventorySystem.update(match, TICK_MS));
  check(
    'when the event ends the shortage clears and restocks return to their normal speed',
    match.pantry.affectedIngredientIds().length === 0 &&
      match.pantry.restockDurationMs(affected[0], 10) === unaffectedMs,
    `back to ${match.pantry.restockDurationMs(affected[0], 10)}ms`,
  );
  void state;
}

// --- 10. the event, end to end, through the real seeded deck --------------------------------------
{
  // `stadium_district` is the market whose §16 pool contains `ingredient_shortage`. Find a seed
  // that draws it, then run service until the deck actually plays the card.
  let match = null;
  for (const seed of ['stadium-1', 'stadium-2', 'stadium-3', 'stadium-4', 'stadium-5', 'stadium-6', 'stadium-7', 'stadium-8']) {
    const candidate = makeMatch({
      id: `m_deck_${seed}`,
      seed,
      phasePreset: 'full',
      setups: { p1: submission({ mains: PROBE_MAINS, startingInventory: fullPantry(PROBE_MAINS, []) }) },
    });
    if (candidate.market?.id === 'stadium_district') {
      match = candidate;
      break;
    }
  }
  runUntilPhase(match, 'service');
  let sawAffected = [];
  quiet(() => {
    for (let i = 0; i < 8_000 && sawAffected.length === 0 && !match.ended; i += 1) {
      stepMatch(match, TICK_MS);
      sawAffected = match.pantry?.affectedIngredientIds() ?? [];
    }
  });
  check(
    'the seeded deck firing `ingredient_shortage` for real reaches this model with no special case',
    sawAffected.length === 1 &&
      match.eventEffects.activeEventIds.includes('ingredient_shortage'),
    `${match.market.id} drew ingredient_shortage; it is short of ${sawAffected.join(', ')}`,
  );
}

// --- 11. the starting allocation is validated server-side, and is what the model gets --------------
{
  const legal = {
    type: 'setup_submit',
    menu: PROBE_MAINS,
    addons: [],
    startingUpgradeId: null,
    staffAssignments: { cook_1: 'prep', server_1: 'dining_room' },
    startingInventory: { beef: 20, bun: 20, cheese: 20, lettuce: 10 },
    policyId: null,
  };
  const accepted = validateSetupSubmission(legal);
  check(
    'a legal allocation is accepted, priced and normalized by the STORY-009 validator (unchanged)',
    accepted.ok &&
      accepted.submission.inventoryCost ===
        inventoryCost(legal.startingInventory, catalogue.ingredients),
    `$${accepted.ok ? accepted.submission.inventoryCost : '?'} of stock, $${accepted.ok ? accepted.submission.cashRemaining : '?'} left`,
  );
  const rejections = [
    ['unknown_ingredient', { unobtainium: 5 }],
    ['invalid_inventory_quantity', { beef: -1 }],
    ['invalid_inventory_quantity', { beef: STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT + 1 }],
    ['inventory_over_budget', { steak: 80, beef: 80, chicken: 80 }],
  ];
  check(
    'an illegal allocation never reaches the model — it is refused with its own reason',
    rejections.every(([reason, startingInventory]) => {
      const result = validateSetupSubmission({ ...legal, startingInventory });
      return result.ok === false && result.reason === reason;
    }),
    rejections.map(([r]) => r).join(', '),
  );

  // The only line STORY-006 changed in that validator: an idle player used to get an EMPTY
  // pantry, which is now a restaurant that cannot cook a single ticket.
  const auto = defaultSubmission();
  const autoUnits = Object.values(auto.startingInventory).reduce((s, n) => s + n, 0);
  check(
    'a player who never submits gets a legal, affordable, menu-derived pantry rather than an empty one',
    auto.autoFilled === true &&
      autoUnits > 0 &&
      auto.inventoryCost <= STARTING_CASH &&
      auto.cashRemaining >= 0 &&
      Object.keys(auto.startingInventory).every((id) =>
        auto.menu.some((slot) => id in dish(slot.dishId).ingredients),
      ),
    `${autoUnits}u for $${auto.inventoryCost}, $${auto.cashRemaining} left`,
  );
  const expensive = defaultInventoryAllocation(
    [dish('steak_frites'), dish('pasta_primavera'), dish('nachos')],
    catalogue.ingredients,
    { cash: 60, cashShare: 0.6, servings: 45, maxUnitsPerIngredient: 80 },
  );
  check(
    'the default allocation scales down to fit the cash instead of producing an illegal submission',
    inventoryCost(expensive, catalogue.ingredients) <= 36 &&
      Object.values(expensive).every((n) => Number.isInteger(n) && n > 0),
    `$${inventoryCost(expensive, catalogue.ingredients)} of stock on a $36 budget`,
  );

  // And the model reads THAT allocation, not one of its own.
  const match = makeMatch({
    id: 'm_wired',
    setups: { p1: { ...accepted.submission, locked: false } },
  });
  runUntilPhase(match, 'service');
  const inv = inventoryOf(match);
  check(
    'the inventory model is seeded from the accepted submission, not from a second source of stock',
    inv.ledger.unitsAllocated === 70 &&
      _internal.binLevel(inv, 'prep', 'beef') === 20 &&
      _internal.binLevel(inv, 'prep', 'croutons') === 0,
    `70u allocated; the menu\'s croutons were never bought, so its bin opens empty`,
  );
}

// --- 12. the snapshot: the shortage signal is public, the pantry and the priced menu are not -------
{
  const p1Menu = [
    { dishId: 'steak_frites', price: 34 },
    { dishId: 'pasta_primavera', price: 22 },
    { dishId: 'caesar_salad', price: 12 },
  ];
  const p2Menu = PROBE_MAINS;
  const match = makeMatch({
    id: 'm_privacy',
    setups: {
      p1: submission({ mains: p1Menu, startingInventory: fullPantry(p1Menu, []) }),
      p2: submission({ mains: p2Menu, startingInventory: fullPantry(p2Menu, []) }),
    },
  });
  runUntilPhase(match, 'service');
  inventoryOf(match, 'p1').bins.get('prep').steak = 0;
  step(match, 2, { isolate: false });

  const snapshot = match.toSnapshot('p2');
  const p1View = snapshot.restaurants.find((r) => r.restaurantId === 'p1');
  check(
    'match_snapshot.restaurants[] carries the §8 shortage signal, published with no edit to match.js',
    Array.isArray(p1View.shortages) && p1View.shortages.some((s) => s.ingredientId === 'steak'),
    JSON.stringify(p1View.shortages),
  );
  const wire = JSON.stringify(snapshot.restaurants);
  const leaks = [];
  for (const key of ['menu', 'price', 'cash', 'inventory', 'pantry', 'revenue', 'ledger']) {
    if (wire.includes(`"${key}"`)) leaks.push(key);
  }
  for (const slot of p1Menu) if (wire.includes(slot.dishId)) leaks.push(slot.dishId);
  check(
    'and carries no rival dish id, price, menu or stock level with it (PRD §18, Decision 16)',
    leaks.length === 0,
    leaks.length === 0 ? 'shortages name a station and an ingredient, nothing else' : leaks.join(', '),
  );

  // The results transition must not leave a stale pantry or availability map behind.
  quiet(() => {
    while (match.phase !== 'results' && !match.ended) stepMatch(match, 1_000);
  });
  const done = match.toSnapshot('p1');
  check(
    'the model is torn down at the results transition, like every other system\'s',
    match.pantry === undefined &&
      match.dishAvailability === undefined &&
      match._inventorySimState === undefined &&
      (done.restaurants ?? []).length === 0,
    'pantry, dishAvailability and the sim state are all cleared',
  );
}

// --- 13. PRD §24 balance: what shortages actually cost a full service ------------------------------
{
  console.log('\n  Balance run — a real 1v1 with the inventory model registered:\n');
  const SEEDS = ['bal-1', 'bal-2', 'bal-3', 'bal-4', 'bal-5', 'bal-6'];
  const rows = [];
  for (const seed of SEEDS) {
    const menu = [
      { dishId: 'smash_burger', price: 14 },
      { dishId: 'caesar_salad', price: 12 },
      { dishId: 'chicken_sandwich', price: 13 },
    ];
    const setup = () => {
      const auto = defaultSubmission();
      return { ...auto, menu, addons: [], autoFilled: false };
    };
    const match = makeMatch({
      id: `m_bal_${seed}`,
      seed,
      phasePreset: 'full',
      setups: { p1: setup(), p2: setup() },
    });
    runUntilPhase(match, 'service');
    let shortageTicks = 0;
    let totalTicks = 0;
    quiet(() => {
      while ((match.phase === 'service' || match.phase === 'final_rush') && !match.ended) {
        stepMatch(match, TICK_MS);
        totalTicks += 1;
        for (const inv of match._inventorySimState?.restaurants.values() ?? []) {
          if (inv.shortages.some((s) => s.blockedTickets > 0)) {
            shortageTicks += 1;
            break;
          }
        }
      }
    });
    const summary = match.districtSummary ?? [];
    const served = summary.map((s) => s.guestsServed);
    const ledgers = [...(match._inventorySimState?.restaurants.values() ?? [])];
    rows.push({
      seed,
      market: match.market.id,
      served,
      blockedShare: totalTicks > 0 ? shortageTicks / totalTicks : 0,
      unavailable: ledgers.flatMap((i) => [...i.ledger.dishesGoneUnavailable]),
    });
    console.log(
      `    ${seed} ${match.market.id.padEnd(20)} served=${served.join('/')} ` +
        `blocked ${(rows.at(-1).blockedShare * 100).toFixed(1)}% of ticks ` +
        `unavailable=[${rows.at(-1).unavailable.join(' ') || 'none'}]`,
    );
  }
  const allServed = rows.flatMap((r) => r.served);
  const lo = Math.min(...allServed);
  const hi = Math.max(...allServed);
  const peakBlocked = Math.max(...rows.map((r) => r.blockedShare));
  console.log(
    `\n    parties served per restaurant across ${SEEDS.length} full matches: ${lo}-${hi}; ` +
      `production blocked on an empty bin for at most ${(peakBlocked * 100).toFixed(1)}% of ticks\n`,
  );
  check(
    'a well-stocked restaurant still serves parties all match — the model does not starve the kitchen',
    lo > 0 && rows.every((r) => r.served.every((n) => n > 0)),
    `${lo}-${hi} parties served per restaurant`,
  );
  check(
    'shortages BITE — at least one match spends real time with production blocked on an empty bin',
    peakBlocked > 0,
    `peak ${(peakBlocked * 100).toFixed(1)}% of ticks with at least one ticket held on stock`,
  );
  check(
    'but they do not dominate: no match spends most of its service blocked',
    peakBlocked < 0.5,
    `${(peakBlocked * 100).toFixed(1)}% < 50%`,
  );
}

// --- results ---------------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.error(`\n${failed.length} FAILED:`);
  for (const r of failed) console.error(`  - ${r.name}`);
  process.exit(1);
}
