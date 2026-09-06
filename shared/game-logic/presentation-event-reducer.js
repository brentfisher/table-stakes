// PRD-027 §9 "Presentation Event Reducer" — a small pure diff of previous-versus-next
// `match_snapshot` state into deduplicated, stably-keyed `PresentationEvent`s for the arcade
// toast layer. Plain JS with a sibling `.d.ts` (Decision 4's shape), living under `shared/` for
// the same reason `hud-alerts.js`/`state-color-bands.js` do: this module has two runtime
// consumers that cannot share a build step — `client/src/game/GameClient.ts` (bundled by Vite)
// and `scripts/check-presentation-events.mjs` (run directly by plain Node). A dependency-light
// `.js` file with a JSON-data import (Node's `with { type: 'json' }`, the same pattern
// `scripts/check-workers.mjs` already uses) is the one shape both can import unmodified.
//
// STORY-029 IS THE FOUNDATION, NOT THE WHOLE PRD. Only two of the ten §9 `PresentationEvent`
// types were actually DETECTED there — `ticket-ready` (an `OrderSnapshot.state` transition to
// `ready`) and `event-warning`/`event-active`/`event-ended` (an `events[]` state transition).
// STORY-031 adds two more: `detectOwnerPickedUpEvents`/`detectOrderDeliveredEvents`, diffing
// `carrying[]` against `orders[]` the same "previous vs. next snapshot, never predicted" way.
// The remaining four (the three `customer-*` types, `ingredient-blocked`) are still exported as
// part of the full union so a later story can add its own `detectX` sibling function beside the
// four below without touching the shared key/version/priority machinery. See STORY-029's own
// Notes for why this split is deliberate, not an oversight.
//
// ONE TYPE IN THE UNION IS NOT PRODUCED HERE AT ALL: `delivery-rejected`. It is not a snapshot
// DIFF — a rejected `interact` never changes authoritative state, so there is nothing for two
// consecutive `match_snapshot`s to disagree about (§8). `GameClient.ts` synthesizes it directly
// from the `interact_rejected` error message, with a freshly-minted key every time (never run
// through `alreadyEmittedKeys`) — see that file's own comment on why gating it through this
// module's dedup machinery would be wrong for something that is not a state transition.
//
// THE KEY FORMAT, AND WHY VERSIONING IS COUNT-DERIVED, NOT A FIXED "v1": PRD §9's own example
// (`event-active:office_break:active_v1`) suggests a literal "_v1" suffix, but
// `event-system.js` (`counts.set(entry.eventId, ...)`) proves the SAME `eventId` can occur MORE
// THAN ONCE in a single match (e.g. two separate rainstorms) — a fixed "v1" would silently
// swallow every toast after the first occurrence, exactly the "repeated snapshots must not
// replay the same toast" bug in reverse (starving a GENUINE new occurrence instead of a stale
// repeat). `nextVersionTag` instead counts how many keys already emitted this match share the
// same `presentationType:entityId:` prefix and mints the next one — deterministic given the same
// `alreadyEmittedKeys` input, and naturally distinguishes "this ticket/event's Nth time crossing
// this transition" from a steady-state repeat, which never re-crosses the edge at all (see
// `detectTicketReadyEvents`'s own `wasReady` guard) and so never reaches version-minting in the
// first place.
//
// THE ONE RULE hud-alerts.js's OWN FILE HEADER ALREADY ESTABLISHED, restated here: this module
// computes no game state. Every input is a value `match_snapshot` already publishes; this only
// diffs and classifies it. Notable Pattern 11: rules emit state, views render it.

import { ALERT_CATEGORIES } from './hud-alerts.js';
import eventsData from '../game-data/events.json' with { type: 'json' };
import dishesData from '../game-data/dishes.json' with { type: 'json' };

const EVENT_BY_ID = new Map(eventsData.events.map((e) => [e.id, e]));
const DISH_NAME_BY_ID = new Map(dishesData.dishes.map((d) => [d.id, d.name]));

function dishNameFor(dishId) {
  return DISH_NAME_BY_ID.get(dishId) ?? dishId;
}

function eventCopyFor(eventId) {
  const def = EVENT_BY_ID.get(eventId);
  // Placeholder-safe: an unknown eventId (should never happen against a valid catalogue, but this
  // is diff logic, not catalogue validation — that is `shared/game-data/loader.js`'s job) still
  // produces a renderable toast rather than throwing mid-match.
  return { title: def?.title ?? eventId, description: def?.description ?? '' };
}

/** PRD-027 §9's literal key format. Exported so the check script can assert the format directly
 * against a real emitted key, not just re-derive its own copy of this string template. */
export function presentationEventKey(presentationType, entityId, stateVersion) {
  return `${presentationType}:${entityId}:${stateVersion}`;
}

/** See file header "THE KEY FORMAT..." for why this counts rather than hardcodes "v1". */
function nextVersionTag(alreadyEmittedKeys, presentationType, entityId) {
  const prefix = `${presentationType}:${entityId}:`;
  let count = 0;
  for (const key of alreadyEmittedKeys) {
    if (key.startsWith(prefix)) count += 1;
  }
  return `v${count + 1}`;
}

/**
 * PRD-027 §5.2/§9. Fires once per ticket the instant `OrderSnapshot.state` crosses INTO `ready`
 * (not on every snapshot the ticket happens to already be ready) — the `wasReady` guard below is
 * what makes repeated 10 Hz snapshots of an already-ready ticket produce nothing.
 *
 * Keyed on `ticketId`, NOT `orderId` — see this file's `.d.ts` header comment and
 * `hud-alerts.js#foodReadyAlerts`'s own identical choice: `orderId` is shared by every ticket a
 * multi-dish party's order decomposed into, so two tickets from the same order becoming ready
 * within the same snapshot would collide onto one key under `orderId` alone and silently drop
 * one ticket's toast.
 */
function detectTicketReadyEvents(previous, next, alreadyEmittedKeys) {
  const prevByTicket = new Map((previous.orders ?? []).map((o) => [o.ticketId, o]));
  const emitted = [];
  for (const order of next.orders) {
    // Toasts are this viewer's own arcade feedback (PRD §7 "React owns screen-space HUD/toasts"
    // for THIS restaurant) — the rival's ready food is never this player's toast to see, same
    // scoping `hud-alerts.js#foodReadyAlerts` already applies.
    if (order.restaurantId !== next.selfRestaurantId) continue;
    if (order.state !== 'ready') continue;
    // Defensive, not expected in practice: a ticket normally has a table before it can be
    // cooked. A toast naming no table would violate PRD §4.2 "message must imply a decision", so
    // skip rather than emit a broken one.
    if (order.tableId === null) continue;

    const wasReady = prevByTicket.get(order.ticketId)?.state === 'ready';
    if (wasReady) continue;

    const type = 'ticket-ready';
    const version = nextVersionTag(alreadyEmittedKeys, type, order.ticketId);
    const key = presentationEventKey(type, order.ticketId, version);
    if (alreadyEmittedKeys.has(key)) continue;

    emitted.push({
      key,
      event: {
        type,
        orderId: order.orderId,
        ticketId: order.ticketId,
        dishName: dishNameFor(order.dishId),
        tableId: order.tableId,
        readyAgeMs: order.readyAgeMs,
      },
    });
  }
  return emitted;
}

/**
 * PRD-027 §5.4/§9. Fires once per `events[]` entry each time its `state` actually changes
 * (`warning` → `active` → `ended`, per `EventState`) — an event holding steady in one state across
 * many snapshots (the ordinary case at 10 Hz) never re-enters this branch. Match-wide, unlike
 * ticket-ready: events are not restaurant-scoped, same as `EventBanner.tsx`'s own unfiltered read.
 */
function detectEventTransitionEvents(previous, next, alreadyEmittedKeys) {
  const prevStateByEvent = new Map((previous.events ?? []).map((e) => [e.eventId, e.state]));
  const emitted = [];
  for (const evt of next.events) {
    const prevState = prevStateByEvent.get(evt.eventId) ?? null;
    if (evt.state === prevState) continue;

    const type = evt.state === 'warning' ? 'event-warning' : evt.state === 'active' ? 'event-active' : 'event-ended';
    const version = nextVersionTag(alreadyEmittedKeys, type, evt.eventId);
    const key = presentationEventKey(type, evt.eventId, version);
    if (alreadyEmittedKeys.has(key)) continue;

    const { title, description } = eventCopyFor(evt.eventId);
    emitted.push({ key, event: { type, eventId: evt.eventId, title, description } });
  }
  return emitted;
}

/**
 * PRD-027 §5.3/§9. Fires once per ORDER the instant it enters the owner's OWN `carrying[]` —
 * `carrying` is order-scoped (`PlayerSnapshot.carrying`'s own field comment: "a whole order
 * ...is one carry slot"), so there is exactly one pickup moment per order regardless of how many
 * dishes/tickets it decomposed into, unlike `detectTicketReadyEvents`'s per-ticket keying above.
 * `wasCarrying` is this function's own version of `detectTicketReadyEvents`'s `wasReady` guard:
 * an order already sitting in `carrying[]` last snapshot (the overwhelmingly common case at
 * 10 Hz) is a steady state, not a fresh pickup, and must emit nothing.
 *
 * `dishName` joins every ticket sharing this `orderId` ("SMASH BURGER + CAESAR SALAD") — the
 * same cross-reference this story's own Notes require ("cross-reference each carried order id
 * against `orders[]` ... do not assume `carrying.length` maps 1:1 to plates"), since one carry
 * slot can hold more than one dish.
 */
function detectOwnerPickedUpEvents(previous, next, alreadyEmittedKeys) {
  const prevCarrying = new Set(previous.carrying ?? []);
  const nextCarrying = next.carrying ?? [];
  const emitted = [];
  for (const orderId of nextCarrying) {
    if (prevCarrying.has(orderId)) continue; // already carrying it last snapshot, not a fresh pickup

    const tickets = next.orders.filter((o) => o.orderId === orderId && o.restaurantId === next.selfRestaurantId);
    if (tickets.length === 0) continue; // defensive: no ticket data yet to name in the toast
    const tableId = tickets[0].tableId;
    if (tableId === null) continue; // same "never emit a broken toast" discipline as ticket-ready
    const dishName = tickets.map((t) => dishNameFor(t.dishId)).join(' + ');

    const type = 'owner-picked-up';
    const version = nextVersionTag(alreadyEmittedKeys, type, orderId);
    const key = presentationEventKey(type, orderId, version);
    if (alreadyEmittedKeys.has(key)) continue;

    emitted.push({ key, event: { type, orderId, dishName, tableId } });
  }
  return emitted;
}

/**
 * PRD-027 §5.3/§9. Fires once per order the instant it LEAVES the owner's OWN `carrying[]` AND
 * every ticket sharing that `orderId` confirms `state === 'delivered'` in the SAME snapshot —
 * never on the local keypress that sent the `deliver` interact (§8: "never predicted"), and
 * never on a `drop_carry` (which also empties `carrying[]` for that order but leaves its
 * tickets short of `delivered` — see `action-validator.js#resolveDropCarry`). That second
 * condition is what tells the two apart from a snapshot diff alone.
 *
 * `revenue` sums the same `ticket.price` fields `order-system.js#deliverOrder` itself sums
 * server-side (`served.reduce((sum, t) => sum + t.price, 0)`) — no new wire field needed, since
 * `price` is already public per ticket (`toPublicOrderSnapshot`).
 */
function detectOrderDeliveredEvents(previous, next, alreadyEmittedKeys) {
  const prevCarrying = new Set(previous.carrying ?? []);
  const nextCarrying = new Set(next.carrying ?? []);
  const emitted = [];
  for (const orderId of prevCarrying) {
    if (nextCarrying.has(orderId)) continue; // still carrying it — nothing has happened yet

    const tickets = next.orders.filter((o) => o.orderId === orderId && o.restaurantId === next.selfRestaurantId);
    if (tickets.length === 0) continue;
    if (!tickets.every((t) => t.state === 'delivered')) continue; // a drop_carry, not a delivery

    const tableId = tickets[0].tableId;
    if (tableId === null) continue;
    const dishName = tickets.map((t) => dishNameFor(t.dishId)).join(' + ');
    // Same rounding-to-cents `toCents` in order-system.js does; a plain reduce would otherwise
    // occasionally leave a floating-point remainder ($14.989999999999998).
    const revenue = Math.round(tickets.reduce((sum, t) => sum + t.price, 0) * 100) / 100;

    const type = 'order-delivered';
    const version = nextVersionTag(alreadyEmittedKeys, type, orderId);
    const key = presentationEventKey(type, orderId, version);
    if (alreadyEmittedKeys.has(key)) continue;

    emitted.push({ key, event: { type, orderId, dishName, tableId, revenue } });
  }
  return emitted;
}

/**
 * The reducer. `previous === null` means no prior snapshot exists yet (a fresh join or
 * reconnect) and always yields `[]` — reading a ticket already `ready` or an event already
 * `active` on the very FIRST snapshot a client ever sees as a "transition" would replay every
 * in-progress moment as a toast the instant someone connects. Same discipline
 * `hud-cash-feedback.js#cashFeedbackFor`'s own first-value guard already established for
 * `you.revenue`.
 */
export function reducePresentationEvents(previous, next, alreadyEmittedKeys) {
  if (previous === null) return [];
  return [
    ...detectTicketReadyEvents(previous, next, alreadyEmittedKeys),
    ...detectEventTransitionEvents(previous, next, alreadyEmittedKeys),
    ...detectOwnerPickedUpEvents(previous, next, alreadyEmittedKeys),
    ...detectOrderDeliveredEvents(previous, next, alreadyEmittedKeys),
  ];
}

// PRD-027 §6.1 "Use the existing service-HUD priority order" — literally
// `hud-alerts.js#ALERT_CATEGORIES`, not a second independently-tuned ranking. See STORY-029's own
// Notes for why porting the attached asset's tone-based `useArcadeToastQueue` sort instead would
// have silently forked the HUD's and the toasts' idea of "most urgent" from each other.
//
// The three `customer-*` types share category 1 (`customer_abandonment_imminent`): each is a
// customer-loss risk or outcome, the same concern the HUD's own top-priority alert names.
// `ingredient-blocked` is category 3 (`ingredient_shortage`), `ticket-ready` is category 2
// (`food_ready_undelivered`), and the three `event-*` transitions are category 5
// (`event_countdown`) — all direct, named matches in `ALERT_CATEGORIES`.
//
// `owner-picked-up`/`order-delivered` have NO matching HUD-alert category: they are ordinary
// action confirmations ("it worked"), not something-is-wrong alerts. `hud-alerts.js` never
// ranks a confirmation at all, so there is no existing line to reuse; they fall to the lowest
// tier (`general_suggestion`) deliberately, the same "ambient, not urgent" tier that category
// already represents for the HUD. `delivery-rejected` (STORY-031, synthesized directly by
// `GameClient.ts` — see the file header) sits right beside them for the same reason: it is
// player-action feedback, not a HUD-ranked game-state alert.
const CATEGORY_BY_PRESENTATION_TYPE = {
  'customer-critical': 'customer_abandonment_imminent',
  'customer-lost-to-rival': 'customer_abandonment_imminent',
  'customer-abandoned': 'customer_abandonment_imminent',
  'ticket-ready': 'food_ready_undelivered',
  'ingredient-blocked': 'ingredient_shortage',
  'event-warning': 'event_countdown',
  'event-active': 'event_countdown',
  'event-ended': 'event_countdown',
  'owner-picked-up': 'general_suggestion',
  'order-delivered': 'general_suggestion',
  'delivery-rejected': 'general_suggestion',
};

const PRIORITY_BY_CATEGORY = Object.fromEntries(ALERT_CATEGORIES.map((category, index) => [category, index + 1]));

/** 1 (most urgent) through `ALERT_CATEGORIES.length` (least) — see the mapping comment above. */
export function presentationEventPriority(event) {
  return PRIORITY_BY_CATEGORY[CATEGORY_BY_PRESENTATION_TYPE[event.type]];
}
