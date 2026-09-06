#!/usr/bin/env node
// STORY-029 (PRD-027 §9 "Presentation Event Reducer"). Exercises
// `shared/game-logic/presentation-event-reducer.js` directly against constructed
// `PresentationSnapshotInput` fragments — the same "pure function, no `Match`" style
// `scripts/check-hud.mjs`'s own layer-3 section already uses for `hud-alerts.js`.
//
// What this proves, per STORY-029's acceptance criteria:
//   1. Determinism: the same (previous, next, alreadyEmittedKeys) input returns identical output
//      across two calls.
//   2. Dedup: a realistic snapshot sequence (queued → ready → still ready → still ready) emits
//      the `ticket-ready` key exactly once, never replayed on later still-ready snapshots.
//   3. Key format: every emitted key is literally `presentationType:entityId:stateVersion`.
//   4. No gameplay-action-emitting capability, BY CONSTRUCTION: every emitted `PresentationEvent`
//      shape is checked against an explicit allow-list of fields for its `type` — an
//      action-shaped field (`action`, `resolve`, `dispatch`, `apply`, ...) sneaking into the
//      union would fail this even if nothing in the reducer ever calls it, per the story's own
//      "not merely by absence of a call" requirement.
//   5. Priority order matches `hud-alerts.js#ALERT_CATEGORIES` exactly — not a second ranking.
//   6. Restaurant scoping: a rival ticket becoming ready never produces a toast for this viewer.
//   7. The two real, wired sources (ticket-ready, event-warning/active/ended) end to end, using
//      real `dishes.json`/`events.json` ids so the dish-name/event-copy lookups are exercised
//      against real data, not a stub.
//
// Run: node scripts/check-presentation-events.mjs

import {
  reducePresentationEvents,
  presentationEventKey,
  presentationEventPriority,
} from '../shared/game-logic/presentation-event-reducer.js';
import { ALERT_CATEGORIES } from '../shared/game-logic/hud-alerts.js';
import dishesData from '../shared/game-data/dishes.json' with { type: 'json' };
import eventsData from '../shared/game-data/events.json' with { type: 'json' };

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('Presentation-event reducer check — PRD-027 §9\n');

// A real dish/event, so dish-name and event-copy resolution is exercised against the actual
// catalogue, not a fabricated id `dishesById`/`eventsById` would never see.
const REAL_DISH = dishesData.dishes[0];
const REAL_EVENT = eventsData.events[0];

function baseOrder(overrides = {}) {
  return {
    orderId: 'order_1',
    ticketId: 'ticket_1',
    restaurantId: 'p1',
    customerId: 'c1',
    tableId: 'T04',
    dishId: REAL_DISH.id,
    price: 14,
    state: 'queued',
    station: 'grill',
    currentStepIndex: 0,
    remainingMs: 1000,
    readyAgeMs: 0,
    ...overrides,
  };
}

function snapshotOf(orders, events, selfRestaurantId = 'p1', carrying = []) {
  return { selfRestaurantId, orders, events, carrying };
}

// =================================================================================================
console.log('1. determinism — same input, called twice, returns identical output');
// =================================================================================================
{
  const prev = snapshotOf([baseOrder({ state: 'queued' })], []);
  const next = snapshotOf([baseOrder({ state: 'ready', readyAgeMs: 900 })], []);
  const keys = new Set();
  const first = reducePresentationEvents(prev, next, keys);
  const second = reducePresentationEvents(prev, next, keys);
  check(
    'two calls with the same (previous, next, alreadyEmittedKeys) return deep-equal output',
    JSON.stringify(first) === JSON.stringify(second) && first.length === 1,
    `first=${JSON.stringify(first)} second=${JSON.stringify(second)}`,
  );
  check(
    'previous === null (no prior snapshot yet) always yields no events, regardless of next',
    reducePresentationEvents(null, next, new Set()).length === 0,
  );
}

// =================================================================================================
console.log('\n2. dedup — a realistic snapshot sequence never replays the same key');
// =================================================================================================
{
  const emittedKeys = new Set();
  const allEmitted = [];

  let previous = null;
  const advance = (next) => {
    const emitted = reducePresentationEvents(previous, next, emittedKeys);
    for (const { key } of emitted) emittedKeys.add(key);
    allEmitted.push(...emitted);
    previous = next;
    return emitted;
  };

  advance(snapshotOf([baseOrder({ state: 'queued' })], [])); // s0: nothing yet (no prior snapshot)
  const onReady = advance(snapshotOf([baseOrder({ state: 'ready', readyAgeMs: 100 })], [])); // s1: crosses into ready
  const stillReady1 = advance(snapshotOf([baseOrder({ state: 'ready', readyAgeMs: 3_000 })], [])); // s2: steady state
  const stillReady2 = advance(snapshotOf([baseOrder({ state: 'ready', readyAgeMs: 6_000 })], [])); // s3: steady state

  check('the ready transition emits exactly one event', onReady.length === 1, JSON.stringify(onReady));
  check('a snapshot where the ticket is STILL ready emits nothing (repeat #1)', stillReady1.length === 0);
  check('a snapshot where the ticket is STILL ready emits nothing (repeat #2)', stillReady2.length === 0);
  check(
    'across the whole sequence, no key was ever returned twice',
    allEmitted.length === new Set(allEmitted.map((e) => e.key)).size,
    `keys=${JSON.stringify(allEmitted.map((e) => e.key))}`,
  );
}

// =================================================================================================
console.log('\n3. key format — presentationType:entityId:stateVersion, PRD-027 §9 literal');
// =================================================================================================
{
  const prev = snapshotOf([baseOrder({ state: 'in_progress' })], []);
  const next = snapshotOf([baseOrder({ state: 'ready', readyAgeMs: 50 })], []);
  const [emitted] = reducePresentationEvents(prev, next, new Set());
  check('exactly one event emitted for this fixture', Boolean(emitted));
  const KEY_FORMAT = /^[a-z-]+:[^:]+:v\d+$/;
  check(
    'the key matches presentationType:entityId:stateVersion',
    KEY_FORMAT.test(emitted.key),
    emitted.key,
  );
  check(
    'the key is exactly presentationEventKey(type, ticketId, "v1") for a first occurrence',
    emitted.key === presentationEventKey('ticket-ready', 'ticket_1', 'v1'),
    emitted.key,
  );

  // A SECOND occurrence of the same ticket-and-transition (only reachable if the ticket's key
  // prefix already has one entry in `alreadyEmittedKeys`) mints v2, not a repeat of v1 — proving
  // the version is derived from real occurrence count, not a fixed "v1" (see the reducer's own
  // "THE KEY FORMAT" header comment on why that matters for events that CAN recur in a match).
  const secondOccurrenceKeys = new Set([emitted.key]);
  const [secondEmitted] = reducePresentationEvents(prev, next, secondOccurrenceKeys);
  check(
    'a second occurrence (prefix already has one emitted key) mints v2, not a repeat of v1',
    secondEmitted?.key === presentationEventKey('ticket-ready', 'ticket_1', 'v2'),
    JSON.stringify(secondEmitted),
  );
}

// =================================================================================================
console.log('\n4. no gameplay-action-emitting capability — by construction, every field checked');
// =================================================================================================
{
  // Every §9 PresentationEvent shape this reducer can produce, explicitly enumerated. An
  // action-shaped field slipping into any of them (or a whole new type nobody accounted for)
  // fails this section even though nothing here ever CALLS such a field — the story's own "not
  // merely by absence of a call" requirement.
  const ALLOWED_FIELDS_BY_TYPE = {
    'ticket-ready': ['type', 'orderId', 'ticketId', 'dishName', 'tableId', 'readyAgeMs'],
    'owner-picked-up': ['type', 'orderId', 'dishName', 'tableId'],
    'order-delivered': ['type', 'orderId', 'dishName', 'tableId', 'revenue'],
    'event-warning': ['type', 'eventId', 'title', 'description'],
    'event-active': ['type', 'eventId', 'title', 'description'],
    'event-ended': ['type', 'eventId', 'title', 'description'],
    'customer-critical': ['type', 'customerId', 'tableId'],
    'customer-lost-to-rival': ['type', 'customerId', 'tableId'],
    'customer-abandoned': ['type', 'customerId', 'tableId'],
    'ingredient-blocked': ['type', 'ingredientId', 'stationId'],
    'delivery-rejected': ['type', 'reason'],
  };
  const ACTION_SHAPED_FIELD_NAMES = ['action', 'resolve', 'dispatch', 'apply', 'execute', 'command', 'intent'];

  function assertNoActionCapability(event) {
    const allowed = ALLOWED_FIELDS_BY_TYPE[event.type];
    if (!allowed) return `unknown type "${event.type}" — not in the §9 union this check knows about`;
    const extra = Object.keys(event).filter((k) => !allowed.includes(k));
    if (extra.length > 0) return `unexpected field(s) [${extra.join(', ')}] on a "${event.type}" event`;
    const actionLike = Object.keys(event).filter((k) => ACTION_SHAPED_FIELD_NAMES.includes(k.toLowerCase()));
    if (actionLike.length > 0) return `action-shaped field(s) [${actionLike.join(', ')}] on a "${event.type}" event`;
    return null;
  }

  // Exercise the two REAL producers directly.
  const prevOrders = snapshotOf([baseOrder({ state: 'queued' })], []);
  const nextOrders = snapshotOf([baseOrder({ state: 'ready', readyAgeMs: 200 })], []);
  const ticketReadyEmitted = reducePresentationEvents(prevOrders, nextOrders, new Set());

  const prevEvents = snapshotOf([], [{ eventId: REAL_EVENT.id, state: 'warning' }]);
  const nextEventsActive = snapshotOf([], [{ eventId: REAL_EVENT.id, state: 'active' }]);
  const eventActiveEmitted = reducePresentationEvents(prevEvents, nextEventsActive, new Set());

  for (const { event } of [...ticketReadyEmitted, ...eventActiveEmitted]) {
    const problem = assertNoActionCapability(event);
    check(`"${event.type}" carries no action-shaped field (fields: ${Object.keys(event).join(', ')})`, !problem, problem ?? '');
  }

  // And every OTHER type in the full union, by construction (not produced by this story's
  // detectors yet, but the return type's shape discipline must hold for all ten regardless).
  for (const [type, fields] of Object.entries(ALLOWED_FIELDS_BY_TYPE)) {
    const fabricated = Object.fromEntries(fields.map((f) => [f, f === 'type' ? type : 'x']));
    const problem = assertNoActionCapability(fabricated);
    check(`the "${type}" shape itself carries no action-shaped field`, !problem, problem ?? '');
  }
}

// =================================================================================================
console.log('\n5. priority order — reuses hud-alerts.js#ALERT_CATEGORIES, not a new ranking');
// =================================================================================================
{
  const categoryIndex = (category) => ALERT_CATEGORIES.indexOf(category) + 1;

  check(
    'ticket-ready ranks at food_ready_undelivered\'s position',
    presentationEventPriority({ type: 'ticket-ready' }) === categoryIndex('food_ready_undelivered'),
  );
  check(
    'event-warning/event-active/event-ended all rank at event_countdown\'s position',
    ['event-warning', 'event-active', 'event-ended'].every(
      (type) => presentationEventPriority({ type }) === categoryIndex('event_countdown'),
    ),
  );
  check(
    'the three customer-* types all rank at customer_abandonment_imminent\'s position (priority 1, most urgent)',
    ['customer-critical', 'customer-lost-to-rival', 'customer-abandoned'].every(
      (type) => presentationEventPriority({ type }) === categoryIndex('customer_abandonment_imminent'),
    ) && categoryIndex('customer_abandonment_imminent') === 1,
  );
  check(
    'ingredient-blocked ranks at ingredient_shortage\'s position',
    presentationEventPriority({ type: 'ingredient-blocked' }) === categoryIndex('ingredient_shortage'),
  );
  check(
    'owner-picked-up/order-delivered/delivery-rejected (ordinary action feedback, no HUD-alert equivalent) rank at the lowest tier',
    presentationEventPriority({ type: 'owner-picked-up' }) === categoryIndex('general_suggestion') &&
      presentationEventPriority({ type: 'order-delivered' }) === categoryIndex('general_suggestion') &&
      presentationEventPriority({ type: 'delivery-rejected' }) === categoryIndex('general_suggestion') &&
      categoryIndex('general_suggestion') === ALERT_CATEGORIES.length,
  );
  check(
    'food-ready outranks (lower number than) an event transition, matching §6.1\'s literal order',
    presentationEventPriority({ type: 'ticket-ready' }) < presentationEventPriority({ type: 'event-active' }),
  );
}

// =================================================================================================
console.log('\n6. restaurant scoping — a rival ticket never produces a toast for this viewer');
// =================================================================================================
{
  const prev = snapshotOf([baseOrder({ restaurantId: 'rival', state: 'queued' })], [], 'p1');
  const next = snapshotOf([baseOrder({ restaurantId: 'rival', state: 'ready', readyAgeMs: 500 })], [], 'p1');
  const emitted = reducePresentationEvents(prev, next, new Set());
  check('a rival restaurant\'s ticket becoming ready emits nothing for this viewer', emitted.length === 0);
}

// =================================================================================================
console.log('\n7. defensive: a ready ticket with no table never emits (would violate §4.2)');
// =================================================================================================
{
  const prev = snapshotOf([baseOrder({ tableId: null, state: 'queued' })], []);
  const next = snapshotOf([baseOrder({ tableId: null, state: 'ready', readyAgeMs: 500 })], []);
  const emitted = reducePresentationEvents(prev, next, new Set());
  check('a ready ticket with tableId === null does not emit a broken toast', emitted.length === 0);
}

// =================================================================================================
console.log('\n8. end to end — the two real, wired sources, against real catalogue data');
// =================================================================================================
{
  // ticket-ready: dish name resolved from the real dishes.json entry, not a stub.
  const prev = snapshotOf([baseOrder({ state: 'in_progress' })], []);
  const next = snapshotOf([baseOrder({ state: 'ready', readyAgeMs: 750 })], []);
  const [ticketReady] = reducePresentationEvents(prev, next, new Set());
  check('ticket-ready fires with the real dish name', ticketReady?.event.dishName === REAL_DISH.name, JSON.stringify(ticketReady));
  check('ticket-ready carries the real tableId', ticketReady?.event.tableId === 'T04');
  check('ticket-ready type is exactly "ticket-ready"', ticketReady?.event.type === 'ticket-ready');

  // event-warning -> event-active -> event-ended: three distinct toasts, real title/description.
  const emittedKeys = new Set();
  let previous = snapshotOf([], []);
  const step = (state) => {
    const nextSnap = snapshotOf([], [{ eventId: REAL_EVENT.id, state }]);
    const emitted = reducePresentationEvents(previous, nextSnap, emittedKeys);
    for (const { key } of emitted) emittedKeys.add(key);
    previous = nextSnap;
    return emitted;
  };
  const warning = step('warning');
  const active = step('active');
  const ended = step('ended');

  check('event-warning fires once, with the real event title/description', warning.length === 1 &&
    warning[0].event.title === REAL_EVENT.title && warning[0].event.description === REAL_EVENT.description);
  check('event-active fires once, distinct type and key from event-warning', active.length === 1 &&
    active[0].event.type === 'event-active' && active[0].key !== warning[0].key);
  check('event-ended fires once, distinct type and key from the other two', ended.length === 1 &&
    ended[0].event.type === 'event-ended' && ended[0].key !== warning[0].key && ended[0].key !== active[0].key);
  check(
    'all three transitions carry the SAME eventId across distinct presentation types',
    warning[0].event.eventId === REAL_EVENT.id &&
      active[0].event.eventId === REAL_EVENT.id &&
      ended[0].event.eventId === REAL_EVENT.id,
  );
}

// =================================================================================================
console.log('\n9. STORY-031 — owner-picked-up / order-delivered, real carrying[]/orders[] diffs');
// =================================================================================================
{
  // Pickup: an order enters `carrying[]` — fires once, names the real dish/table, never on the
  // steady state of "still carrying it".
  const readyOrder = baseOrder({ state: 'ready', readyAgeMs: 500 });
  const beforePickup = snapshotOf([readyOrder], [], 'p1', []);
  const afterPickup = snapshotOf([readyOrder], [], 'p1', ['order_1']);
  const pickupEmitted = reducePresentationEvents(beforePickup, afterPickup, new Set());
  const pickedUp = pickupEmitted.find((e) => e.event.type === 'owner-picked-up');
  check('owner-picked-up fires the instant an order enters carrying[]', Boolean(pickedUp), JSON.stringify(pickupEmitted));
  check('owner-picked-up carries the real dish name', pickedUp?.event.dishName === REAL_DISH.name);
  check('owner-picked-up carries the real tableId', pickedUp?.event.tableId === 'T04');
  check('owner-picked-up key is presentationEventKey("owner-picked-up", orderId, "v1")',
    pickedUp?.key === presentationEventKey('owner-picked-up', 'order_1', 'v1'));

  const stillCarrying = reducePresentationEvents(afterPickup, afterPickup, new Set([pickedUp.key]));
  check('still carrying the same order next snapshot emits nothing (steady state)', stillCarrying.length === 0);

  // Delivery: the order leaves carrying[] AND its ticket confirms 'delivered' — fires once, with
  // a revenue figure summed from the real per-ticket `price` field, not a fabricated number.
  const deliveredOrder = baseOrder({ state: 'delivered' });
  const afterDelivery = snapshotOf([deliveredOrder], [], 'p1', []);
  const deliveryEmitted = reducePresentationEvents(afterPickup, afterDelivery, new Set([pickedUp.key]));
  const delivered = deliveryEmitted.find((e) => e.event.type === 'order-delivered');
  check('order-delivered fires the instant an order leaves carrying[] AND is state=delivered', Boolean(delivered), JSON.stringify(deliveryEmitted));
  check('order-delivered revenue sums the real ticket price(s)', delivered?.event.revenue === deliveredOrder.price, JSON.stringify(delivered));
  check('order-delivered carries the real tableId', delivered?.event.tableId === 'T04');

  // A drop_carry: the order leaves carrying[] but its ticket is still 'ready', not 'delivered' —
  // must NOT be read as a delivery (§8: never predicted/never a false positive on a non-transition).
  const droppedOrder = baseOrder({ state: 'ready', readyAgeMs: 500 });
  const afterDrop = snapshotOf([droppedOrder], [], 'p1', []);
  const dropEmitted = reducePresentationEvents(afterPickup, afterDrop, new Set([pickedUp.key]));
  check(
    'a drop_carry (order leaves carrying[] but ticket stays ready, not delivered) never emits order-delivered',
    dropEmitted.every((e) => e.event.type !== 'order-delivered'),
    JSON.stringify(dropEmitted),
  );

  // A multi-ticket order (a party that ordered more than one dish) — dishName joins every
  // ticket's dish, revenue sums every ticket's price, and only ONE owner-picked-up/order-delivered
  // event fires for the whole order, not one per ticket.
  const multiTickets = [
    baseOrder({ ticketId: 'ticket_1', dishId: REAL_DISH.id, price: 10, state: 'ready' }),
    baseOrder({ ticketId: 'ticket_2', dishId: dishesData.dishes[1].id, price: 6, state: 'ready' }),
  ];
  const beforeMultiPickup = snapshotOf(multiTickets, [], 'p1', []);
  const afterMultiPickup = snapshotOf(multiTickets, [], 'p1', ['order_1']);
  const multiPickupEmitted = reducePresentationEvents(beforeMultiPickup, afterMultiPickup, new Set())
    .filter((e) => e.event.type === 'owner-picked-up');
  check('a multi-ticket order emits exactly one owner-picked-up event, not one per ticket', multiPickupEmitted.length === 1, JSON.stringify(multiPickupEmitted));
  check(
    'its dishName joins every ticket\'s dish',
    multiPickupEmitted[0]?.event.dishName === `${REAL_DISH.name} + ${dishesData.dishes[1].name}`,
    JSON.stringify(multiPickupEmitted),
  );

  const deliveredMultiTickets = multiTickets.map((t) => ({ ...t, state: 'delivered' }));
  const afterMultiDelivery = snapshotOf(deliveredMultiTickets, [], 'p1', []);
  const multiDeliveryEmitted = reducePresentationEvents(afterMultiPickup, afterMultiDelivery, new Set())
    .filter((e) => e.event.type === 'order-delivered');
  check('a multi-ticket order emits exactly one order-delivered event, not one per ticket', multiDeliveryEmitted.length === 1, JSON.stringify(multiDeliveryEmitted));
  check('its revenue sums every ticket\'s price (10 + 6 = 16)', multiDeliveryEmitted[0]?.event.revenue === 16, JSON.stringify(multiDeliveryEmitted));

  // Restaurant scoping: the rival's own owner picking up their own order is never this viewer's
  // toast — same discipline section 6 above already proves for ticket-ready.
  const rivalReady = baseOrder({ restaurantId: 'rival', state: 'ready' });
  const rivalBefore = snapshotOf([rivalReady], [], 'p1', []);
  const rivalAfter = snapshotOf([rivalReady], [], 'p1', ['order_1']); // this viewer's OWN carrying somehow names a rival order — defensive
  const rivalEmitted = reducePresentationEvents(rivalBefore, rivalAfter, new Set());
  check('an order whose ticket belongs to the rival restaurant never emits a toast for this viewer', rivalEmitted.length === 0, JSON.stringify(rivalEmitted));
}

// =================================================================================================
console.log('');
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.log(`${failed.length}/${results.length} checks FAILED`);
  process.exit(1);
}
console.log(`All ${results.length} checks passed.`);
