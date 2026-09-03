// PRD §18 "Alert prioritization" — the ranked, capped critical-alert list. Plain JS with a
// sibling `.d.ts` (Decision 4's shape), living under `shared/` for the reason nothing else here
// needs that: this module has TWO runtime consumers that cannot share a build step — the
// browser client (`client/src/game/GameClient.ts`, bundled by Vite) and `scripts/check-hud.mjs`
// (run directly by plain Node, no TypeScript loader in this repo). A shared, dependency-free
// `.js` file is the only shape both can import unmodified.
//
// THE ONE RULE THIS FILE FOLLOWS: it never decides WHETHER a restaurant-level bottleneck
// category is active — that judgment is `hud-bottleneck-system.js`'s (server-authoritative,
// see that file's header), read here off `restaurant.activeBottlenecks`. This file only picks
// out WHICH specific entity (customer, ticket, shortage) earns the alert's text, from the same
// raw arrays the server used to make that call. A category with no server flag never produces
// an alert here, however alarming a raw number might look in isolation — that is what keeps the
// two classifiers from ever disagreeing (the exact drift `order-system.js`'s own
// `blockedByIngredientId` comment warns a duplicated signal invites).
//
// `event_countdown` and `upgrade_available` are the two named PRD §18 priorities that are NOT
// restaurant bottlenecks (an event is match-wide; affordability is the viewer's own catalogue
// read) — they are derived directly from `events[]` and the caller's own `canAffordUpgrade`,
// with no `activeBottlenecks` gate to duplicate, because there is no second computation of
// either to duplicate against.
//
// `equipment_problem` (PRD §18 priority 4) has a reserved priority slot below and NO producer —
// `hud-bottleneck-system.js` never emits `equipment_failure` because nothing in this codebase
// ever marks a station broken (see that file's header). No alert of this category will ever be
// generated until a later story adds the mechanism; the slot exists so that story only has to
// add a bottleneck source, never touch the ranking below.

import { isExitState } from '../schemas/game-state.js';
import { ORDER_FRESHNESS_GRACE_MS, HUD_EVENT_COUNTDOWN_ALERT_MS } from '../constants/tuning.js';

/** PRD §18's seven named alert categories, in priority order — the array index IS the rank. */
export const ALERT_CATEGORIES = Object.freeze([
  'customer_abandonment_imminent',
  'food_ready_undelivered',
  'ingredient_shortage',
  'equipment_problem',
  'event_countdown',
  'upgrade_available',
  'general_suggestion',
]);

const PRIORITY = Object.freeze(
  Object.fromEntries(ALERT_CATEGORIES.map((category, index) => [category, index + 1])),
);

function findSelf(restaurants, selfRestaurantId) {
  return restaurants.find((r) => r.restaurantId === selfRestaurantId) ?? null;
}

/** Priority 1. Gated on the server's own `unhappy_customer` classification; see file header. */
function abandonmentAlerts(self, selfRestaurantId, customers) {
  if (!self?.activeBottlenecks?.includes('unhappy_customer')) return [];
  return customers
    .filter((c) => c.restaurantId === selfRestaurantId && c.unhappy && !isExitState(c.state))
    // Most urgent (least patience left) first, so a cap below the total count keeps the worst
    // ones, never an arbitrary subset.
    .sort((a, b) => a.patienceRemaining - b.patienceRemaining)
    .map((c) => ({
      key: `abandonment:${c.customerId}`,
      category: 'customer_abandonment_imminent',
      priority: PRIORITY.customer_abandonment_imminent,
      detail: { customerId: c.customerId, tableId: c.tableId, patienceRemaining: c.patienceRemaining },
    }));
}

/** Priority 2. Gated on the server's own `server_overload` classification; see file header. */
function foodReadyAlerts(self, selfRestaurantId, orders) {
  if (!self?.activeBottlenecks?.includes('server_overload')) return [];
  return orders
    .filter(
      (o) => o.restaurantId === selfRestaurantId && o.state === 'ready' && o.readyAgeMs > ORDER_FRESHNESS_GRACE_MS,
    )
    .sort((a, b) => b.readyAgeMs - a.readyAgeMs)
    .map((o) => ({
      key: `food_ready:${o.ticketId}`,
      category: 'food_ready_undelivered',
      priority: PRIORITY.food_ready_undelivered,
      detail: { orderId: o.orderId, ticketId: o.ticketId, dishId: o.dishId, tableId: o.tableId, readyAgeMs: o.readyAgeMs },
    }));
}

/** Priority 3. Gated on the server's own `ingredient_shortage` classification; see file header. */
function shortageAlerts(self) {
  if (!self?.activeBottlenecks?.includes('ingredient_shortage')) return [];
  return (self.shortages ?? [])
    .filter((s) => s.blockedTickets > 0)
    .sort((a, b) => b.blockedTickets - a.blockedTickets)
    .map((s) => ({
      key: `shortage:${s.station}:${s.ingredientId}`,
      category: 'ingredient_shortage',
      priority: PRIORITY.ingredient_shortage,
      detail: { station: s.station, ingredientId: s.ingredientId, blockedTickets: s.blockedTickets },
    }));
}

/** Priority 5. PRD §7's own 10-20s teaser window, not a restaurant bottleneck — see file header. */
function eventCountdownAlerts(events) {
  return events
    .filter((e) => e.state === 'warning' && typeof e.startsInMs === 'number' && e.startsInMs <= HUD_EVENT_COUNTDOWN_ALERT_MS)
    .sort((a, b) => a.startsInMs - b.startsInMs)
    .map((e) => ({
      key: `event:${e.eventId}`,
      category: 'event_countdown',
      priority: PRIORITY.event_countdown,
      detail: { eventId: e.eventId, startsInMs: e.startsInMs },
    }));
}

/** Priority 6. The caller's own affordability read (STORY-012 precedent) — see file header. */
function upgradeAvailableAlerts(canAffordUpgrade, affordableUpgradeId) {
  if (!canAffordUpgrade) return [];
  return [
    {
      key: 'upgrade_available',
      category: 'upgrade_available',
      priority: PRIORITY.upgrade_available,
      detail: { upgradeId: affordableUpgradeId ?? null },
    },
  ];
}

/** Priority 7. One alert PER CATEGORY, not per instance — these are ambient, not urgent, and a
 * pile of dirty tables is one suggestion ("clear a table"), not one alert per table. Excludes
 * whatever this restaurant's higher-priority alerts above already promoted to specific alerts. */
function generalSuggestionAlerts(self) {
  const kinds = (self?.activeBottlenecks ?? []).filter((k) => k === 'kitchen_backlog' || k === 'long_entry_queue' || k === 'dirty_table');
  return kinds.map((kind) => ({
    key: `suggestion:${kind}`,
    category: 'general_suggestion',
    priority: PRIORITY.general_suggestion,
    detail: { bottleneck: kind },
  }));
}

/**
 * Every currently-warranted critical alert for the viewer's own restaurant, ranked in PRD §18
 * order (customer abandonment first) and, within a category, by urgency — but NOT yet capped.
 * Call `capCriticalAlerts` on the result before rendering; kept separate so a check script can
 * assert on the full ranked list AND the capped one independently.
 */
export function buildCriticalAlerts({
  selfRestaurantId,
  restaurants,
  customers,
  orders,
  events,
  canAffordUpgrade,
  affordableUpgradeId,
}) {
  const self = findSelf(restaurants, selfRestaurantId);
  return [
    ...abandonmentAlerts(self, selfRestaurantId, customers),
    ...foodReadyAlerts(self, selfRestaurantId, orders),
    ...shortageAlerts(self),
    // equipment_problem: never produced — see file header.
    ...eventCountdownAlerts(events),
    ...upgradeAvailableAlerts(canAffordUpgrade, affordableUpgradeId),
    ...generalSuggestionAlerts(self),
  ];
}

/** PRD §18 "Limit critical alerts to prevent alarm fatigue": SUPPRESS lower-priority alerts past
 * the cap, never queue them for later — `buildCriticalAlerts` is already priority-ordered, so
 * this is a plain slice, not a scheduler. */
export function capCriticalAlerts(alerts, maxDisplayed) {
  return alerts.slice(0, maxDisplayed);
}
