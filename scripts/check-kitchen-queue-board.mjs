#!/usr/bin/env node
// STORY-043 "Kitchen order queue board, with real dish models" check — in process.
//
// Same style as `check-owner-actions.mjs`/`check-workers.mjs`: a real `Match`, the real
// `order-system.js` registered against the real simulation loop, no socket, no client. Ticket
// state is INJECTED DIRECTLY into `order-system.js`'s own internal `restaurant.stations.get
// (station).queue` (the same "direct-state-injection technique" `check-owner-actions.mjs`/
// `check-workers.mjs` use to force a specific branch deterministically) rather than routed
// through `match.kitchen.placeOrder`'s own probabilistic dish draw — this story adds no new
// dish-selection logic, so the probabilistic draw is not what needs proving; exact `queueAgeMs`/
// `patienceRisk` combinations across specific stations are.
//
// WHAT THIS SCRIPT PROVES, beyond "it doesn't crash":
//   1. `worker-system.js#compareTickets` is a real export, and `_internal.compareTickets` still
//      points at the SAME function — the promotion (this story's Decision 67) did not fork it.
//   2. `order-system.js#queuedTicketsAcrossStations` concatenates every station and sorts with
//      that exact comparator — proven by comparing its output against an independently
//      hand-sorted array, not just eyeballing plausible-looking output.
//   3. A blocked ticket (`blockedByIngredientId` set) still appears, at its rank-order position —
//      this board is NOT `selectCookTask`'s own filtered candidate list.
//   4. `match_snapshot.you.kitchenQueueBoard` is scoped to the VIEWER's own restaurant only — the
//      negative is asserted directly (a rival's ticket ids are never present), not inferred from
//      the positive case alone.
//   5. The field populates in a plain (non-coop) match — AC4's explicit "confirm behavior in a
//      non-co-op match too" — AND in a co-op match, identically for both seats.
//   6. A ticket disappears from the board the instant it starts (`match.kitchen.startTicket`) —
//      the "updates live" claim, exercised, not asserted by inspection.
//
// Run: node scripts/check-kitchen-queue-board.mjs

import assert from 'node:assert/strict';
import { Match } from '../server/src/game/match.js';
import { registerSystem, clearSystems, stepMatch } from '../server/src/game/simulation-loop.js';
import { setupSystem } from '../server/src/game/systems/setup-system.js';
import { customerSystem } from '../server/src/game/systems/customer-system.js';
import { orderSystem, _internal as orderInternal } from '../server/src/game/systems/order-system.js';
import { compareTickets, _internal as workerInternal } from '../server/src/game/systems/worker-system.js';
import { catalogue } from '../server/src/game/catalogue.js';

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

function registerAll() {
  clearSystems();
  registerSystem(setupSystem);
  registerSystem(customerSystem);
  registerSystem(orderSystem);
}

function runUntilPhase(match, phase, maxSteps = 20_000) {
  quiet(() => {
    for (let i = 0; i < maxSteps && match.phase !== phase && !match.ended; i += 1) {
      stepMatch(match, TICK_MS);
    }
  });
  return match.phase === phase;
}

/** Minimal, hand-built accepted setup — same "skip the real validation flow, this story does not
 * exercise it" reasoning `check-orders.mjs#makeMatch` uses. `staffAssignments` content is
 * irrelevant here: `workerSystem` is never registered by this script, so nothing ever reads it. */
function acceptedSetup(mains) {
  return {
    menu: mains,
    addons: [],
    startingUpgradeId: null,
    staffAssignments: {},
    startingInventory: {},
    policyId: null,
    policyDishId: null,
    upgradeCost: 0,
    inventoryCost: 0,
    cashRemaining: 1000,
    submittedAtMs: 0,
    locked: false,
    autoFilled: false,
  };
}

function competitiveMatch(id) {
  const match = new Match({ id, seed: id, requiredPlayers: 2 });
  match.join({ fallbackPlayerId: 'p1' });
  match.join({ fallbackPlayerId: 'p2' });
  const mains = [{ dishId: 'smash_burger', price: 14 }, { dishId: 'cheesecake', price: 9 }];
  match.players.get('p1').setup = acceptedSetup(mains);
  match.players.get('p2').setup = acceptedSetup(mains);
  match.setReady('p1', true);
  match.setReady('p2', true);
  return match;
}

/**
 * Pushes a ticket straight onto a station's real queue, bypassing `placeOrder`'s probabilistic
 * dish draw — see this file's own header. Builds the same shape `makeTicket`/`enqueueTicket`
 * (`order-system.js`) produce, and a matching minimal `order` (`queuedTicketsAt` reads
 * `order.request.patienceMs`/`order.placedAtMs` for `patienceRisk`).
 */
function injectTicket(state, restaurant, { ticketId, orderId, dishId, station, price = 10, patienceMs, placedAtMs, queuedAtMs, blockedByIngredientId = null }) {
  if (!restaurant.orders.has(orderId)) {
    restaurant.orders.set(orderId, {
      orderId,
      restaurantId: restaurant.restaurantId,
      customerId: `party_${orderId}`,
      tableId: 'table_1',
      placedAtMs,
      readyAtMs: null,
      deliveredAtMs: null,
      finishedAtMs: null,
      state: 'placed',
      tickets: [],
      request: { patienceMs },
      quality: null,
      qualityComponents: null,
      satisfaction: null,
      revenue: 0,
      settled: false,
      claimedBy: null,
      quotedRevenue: price,
    });
  }
  const dish = catalogue.dishesById[dishId];
  const ticket = {
    ticketId,
    orderId,
    dishId,
    dish,
    price,
    state: 'queued',
    queuedAtMs,
    stepIndex: -1,
    station,
    remainingMs: 0,
    readyAtMs: null,
    voidedReason: null,
    blockedByIngredientId,
  };
  restaurant.orders.get(orderId).tickets.push(ticket);
  restaurant.stations.get(station).queue.push(ticket);
  return ticket;
}

console.log('Kitchen order queue board check — STORY-043\n');
registerAll();

// --- 1. compareTickets promotion did not fork the function --------------------------------
check(
  "compareTickets is a real top-level export, and _internal's own entry still points at the SAME function (Decision 67)",
  workerInternal.compareTickets === compareTickets,
);

// --- 2-6. a real two-restaurant match, tickets injected directly ---------------------------
const match = competitiveMatch('m_queue_board');
const reachedService = runUntilPhase(match, 'service');
check('the probe match reaches service with a plain (non-coop) two-seat roster', reachedService && !match.sharedRestaurant);

// A clean, round elapsedMs so every queueAgeMs/patienceRisk below is exact and legible.
match.elapsedMs = 100_000;
const state = orderInternal.ensureState(match);
const p1 = state.restaurants.get('p1');
const p2 = state.restaurants.get('p2');

// p1: four tickets, engineered so `compareTickets`'s two rules (bucket, then patience) produce
// one unambiguous order with no ties for the tie-break to hide a bug behind.
//   p1_blocked        grill   bucket 2 (queueAgeMs 5000ms), patienceRisk 1.0   (clamped)  -> #1
//   p1_old_prep       prep    bucket 2 (queueAgeMs 5000ms), patienceRisk .083             -> #2
//   p1_new_urgent     plating bucket 0 (queueAgeMs 0ms),    patienceRisk .9               -> #3
//   p1_new_patient    plating bucket 0 (queueAgeMs 0ms),    patienceRisk .009             -> #4
injectTicket(state, p1, { ticketId: 'p1_blocked', orderId: 'p1_o1', dishId: 'smash_burger', station: 'grill', patienceMs: 3_000, placedAtMs: 95_000, queuedAtMs: 95_000, blockedByIngredientId: 'beef' });
injectTicket(state, p1, { ticketId: 'p1_old_prep', orderId: 'p1_o2', dishId: 'smash_burger', station: 'prep', patienceMs: 60_000, placedAtMs: 95_000, queuedAtMs: 95_000 });
injectTicket(state, p1, { ticketId: 'p1_new_urgent', orderId: 'p1_o3', dishId: 'cheesecake', station: 'plating', patienceMs: 1_000, placedAtMs: 99_100, queuedAtMs: 100_000 });
injectTicket(state, p1, { ticketId: 'p1_new_patient', orderId: 'p1_o4', dishId: 'cheesecake', station: 'plating', patienceMs: 100_000, placedAtMs: 99_100, queuedAtMs: 100_000 });

// p2 (the rival): tickets that would sort ABOVE everything of p1's if scoping ever leaked —
// oldest possible bucket, maximum patience risk — so a scoping bug fails LOUDLY (p2's ticket at
// the very front of p1's list), not quietly.
injectTicket(state, p2, { ticketId: 'p2_would_lead', orderId: 'p2_o1', dishId: 'smash_burger', station: 'prep', patienceMs: 1, placedAtMs: 0, queuedAtMs: 0 });
injectTicket(state, p2, { ticketId: 'p2_other', orderId: 'p2_o2', dishId: 'cheesecake', station: 'plating', patienceMs: 60_000, placedAtMs: 95_000, queuedAtMs: 95_000 });

const p1Ranked = match.kitchen.queuedTicketsAcrossStations('p1');
const expectedOrder = ['p1_blocked', 'p1_old_prep', 'p1_new_urgent', 'p1_new_patient'];
check(
  'queuedTicketsAcrossStations ranks p1\'s tickets across grill/prep/plating in the exact compareTickets order',
  JSON.stringify(p1Ranked.map((t) => t.ticketId)) === JSON.stringify(expectedOrder),
  p1Ranked.map((t) => t.ticketId).join(','),
);

// Independently hand-sort the same underlying tickets (queuedTicketsAt, per station, the SAME
// comparator this script imports for its own use) — proving the facade is exactly that
// concatenation, not a lookalike with its own drifted logic.
const manuallyRanked = ['prep', 'grill', 'oven', 'plating']
  .flatMap((station) => match.kitchen.queuedTicketsAt('p1', station))
  .sort(compareTickets)
  .map((t) => t.ticketId);
check(
  'queuedTicketsAcrossStations is byte-identical to an independently hand-sorted concatenation of queuedTicketsAt',
  JSON.stringify(p1Ranked.map((t) => t.ticketId)) === JSON.stringify(manuallyRanked),
);

const blockedEntry = p1Ranked.find((t) => t.ticketId === 'p1_blocked');
check(
  'a blocked ticket still appears on the board, carrying its blockedByIngredientId (not selectCookTask\'s own filtered candidate list)',
  blockedEntry?.blockedByIngredientId === 'beef',
);

// --- viewer scoping: never the rival's queue ------------------------------------------------
const p1Snapshot = match.toSnapshot('p1');
const p2Snapshot = match.toSnapshot('p2');
const p1Ids = p1Snapshot.you.kitchenQueueBoard.map((e) => e.ticketId);
const p2Ids = p2Snapshot.you.kitchenQueueBoard.map((e) => e.ticketId);

check('you.kitchenQueueBoard for p1 matches the facade exactly', JSON.stringify(p1Ids) === JSON.stringify(expectedOrder));
check('p1 sees a non-empty board (a vacuous pass would prove nothing)', p1Ids.length === 4);
check("p1's snapshot contains NONE of p2's ticket ids — the negative, asserted directly", p1Ids.every((id) => !id.startsWith('p2_')));
check("p2's snapshot contains NONE of p1's ticket ids", p2Ids.every((id) => !id.startsWith('p1_')));
check("p2's own tickets are still there — this is scoping, not a bug that empties everyone's board", p2Ids.length === 2);

// --- AC4: populates in a non-coop match (this whole match IS the non-coop case) -------------
check('AC4 — the board is populated in a plain, staffed (non-sharedRestaurant) match', !match.sharedRestaurant && p1Ids.length > 0);

// --- AC4: also populates identically for both co-op seats -----------------------------------
{
  registerAll();
  const coop = new Match({ id: 'm_queue_board_coop', seed: 'm_queue_board_coop', requiredPlayers: 2, sharedRestaurant: true });
  coop.join({ fallbackPlayerId: 'host' });
  coop.join({ fallbackPlayerId: 'guest' });
  const mains = [{ dishId: 'smash_burger', price: 14 }];
  coop.players.get('host').setup = acceptedSetup(mains);
  coop.setReady('host', true);
  coop.setReady('guest', true);
  runUntilPhase(coop, 'service');
  coop.elapsedMs = 50_000;
  const coopState = orderInternal.ensureState(coop);
  const coopRestaurant = coopState.restaurants.get(coop.restaurantIdFor('host'));
  injectTicket(coopState, coopRestaurant, { ticketId: 'coop_ticket', orderId: 'coop_o1', dishId: 'smash_burger', station: 'prep', patienceMs: 60_000, placedAtMs: 45_000, queuedAtMs: 45_000 });
  const hostBoard = coop.toSnapshot('host').you.kitchenQueueBoard.map((e) => e.ticketId);
  const guestBoard = coop.toSnapshot('guest').you.kitchenQueueBoard.map((e) => e.ticketId);
  check('a co-op match populates the board identically for both seats (same shared restaurant)', JSON.stringify(hostBoard) === JSON.stringify(['coop_ticket']) && JSON.stringify(guestBoard) === JSON.stringify(['coop_ticket']));
}

// --- live update: a started ticket disappears from the board --------------------------------
const startResult = match.kitchen.startTicket('p1', 'p1_old_prep');
check('starting a queued ticket succeeds (prep has free capacity, no pantry registered to block it)', startResult.ok === true, JSON.stringify(startResult));
const afterStart = match.kitchen.queuedTicketsAcrossStations('p1').map((t) => t.ticketId);
check(
  'AC3 — the started ticket is gone from the board the instant it starts, everything else remains',
  !afterStart.includes('p1_old_prep') && JSON.stringify(afterStart) === JSON.stringify(['p1_blocked', 'p1_new_urgent', 'p1_new_patient']),
  afterStart.join(','),
);
const afterStartSnapshot = match.toSnapshot('p1').you.kitchenQueueBoard.map((e) => e.ticketId);
check('the same live update is visible through the full match_snapshot wire path, not just the facade', JSON.stringify(afterStartSnapshot) === JSON.stringify(afterStart));

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed.`);
if (passed !== results.length) process.exit(1);
