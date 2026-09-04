// PRD §18 "Critical alerts" and the alert-priority order. This file's ONLY job is to fill in
// `RestaurantSnapshot.activeBottlenecks` — a field `shared/schemas/game-state.d.ts` has declared
// since STORY-002/007 but that no system has ever written to (grep the tree before this story:
// zero writers). It reads what earlier systems already published this same tick and classifies
// it into the closed `BottleneckKind` vocabulary; it invents no new category and computes no new
// simulation number.
//
// THIS FILE OWNS NO SIMULATION STATE OF ITS OWN, same shape as `scoring-system.js`: no
// `match._hudSimState`, no per-tick accumulator, nothing to tear down at `results`. Every input
// it reads (`match.restaurants[].shortages`/`.tables`/`.queueLength`, `match.customers`,
// `match.orders`) is a value another system already computed and published THIS tick; this file
// only re-reads and re-labels it.
//
// REGISTRATION ORDER: between `upgrades` and `scoring` (see `systems/index.js`'s header). After
// `upgrades` because `long_entry_queue`/`kitchen_backlog` etc. want the same freshly-decorated
// `match.restaurants[]` every other late system reads; before `scoring` because `scoring` MUST
// stay last (its own header explains why) and this system adds nothing scoring reads.
//
// WHAT IS DELIBERATELY NEVER POPULATED, and why (Notable Pattern 9 — no fabricated signal):
//
//   `equipment_failure`  No station is EVER marked broken anywhere in this codebase.
//                        `action-validator.js`'s own comment says so explicitly: `repair` is a
//                        legal `INTERACT_ACTIONS` member that is ALWAYS rejected
//                        `no_failure_state`, because nothing sets `StationSnapshot.broken` true.
//                        Pushing this kind here with no station ever satisfying it would be
//                        indistinguishable from a bug; leaving it out is the honest position,
//                        the same one `scoring-system.js#countCriticFailures` takes returning 0
//                        when a critic event never fired — "never happened" is not an error.
//
//   `cash_opportunity`   PRD §14 lists purple as "premium/high-value opportunity", a 3D visual
//                        cue STORY-016 owns, not an HUD alert category — §18's own alert-
//                        priority list has no "cash opportunity" entry to rank it against. The
//                        HUD's own upgrade-availability signal (AC bullet 1, priority-6 "upgrade
//                        available" in the alert list) is already served by the client's
//                        existing `canAffordUpgrade` — computed from public catalogue JSON plus
//                        the viewer's own private `you.cash`, the same STORY-012 precedent
//                        `GameClient.ts#canAffordAnyUpgrade` already established. Adding a
//                        second, server-side copy of that same judgment here would be the exact
//                        kind of duplicated threshold the tuning block above this file warns
//                        against, for a field this story's own AC does not ask this file to fill.
//
// ORDER PUSHED, PER RESTAURANT: the §18 priority order, restaurant-operational categories only
// (event countdown and upgrade availability are not restaurant bottlenecks — they come from
// `match.events`/`you.cash` directly, read by the client). A restaurant with nothing wrong gets
// `[]`, not a padded list.

import { isExitState } from '../../../../shared/schemas/game-state.js';
import {
  HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD,
  HUD_LONG_ENTRY_QUEUE_THRESHOLD,
  ORDER_FRESHNESS_GRACE_MS,
} from '../../../../shared/constants/tuning.js';

/**
 * PRD §18 alert-priority item 1, "Customer abandonment imminent". Reuses `CustomerSnapshot
 * .unhappy` verbatim — game-state.d.ts's own comment on that field names this exact story as
 * the reader ("STORY-015 ranks it as an alert"), so this is not a second threshold on top of
 * `UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD`, it is the same one, read where it already lives.
 */
function hasUnhappyCustomer(restaurantId, customers) {
  return customers.some((c) => c.restaurantId === restaurantId && c.unhappy && !isExitState(c.state));
}

/**
 * PRD §18 alert-priority item 2, "Food ready but undelivered" — PRD §17's server rule 1
 * ("Deliver food that is ready") not being kept up with. `ORDER_FRESHNESS_GRACE_MS` is reused
 * rather than a new constant: it is already the exact line order-system.js draws between "just
 * plated, still fine" and "sitting out" for the dish's own quality score, so a ticket past it is
 * legitimately starting to suffer, not merely young.
 */
function hasUndeliveredReadyFood(restaurantId, orders) {
  return orders.some(
    (o) => o.restaurantId === restaurantId && o.state === 'ready' && o.readyAgeMs > ORDER_FRESHNESS_GRACE_MS,
  );
}

/**
 * PRD §18 alert-priority item 3, "Ingredient shortage blocks active order". `shortages[]` is
 * already the exact §8 shortage signal (`inventory-system.js#toPublicShortages`); this only asks
 * whether one of them currently has a ticket sitting behind it, which is what "blocks an ACTIVE
 * order" means as opposed to a shortage that has not cost anyone a place in line yet.
 */
function hasBlockingShortage(restaurant) {
  return (restaurant.shortages ?? []).some((s) => s.blockedTickets > 0);
}

/**
 * Not one of the seven named alert priorities, but a real PRD §8 bottleneck row: a station with
 * more `queued`, NOT ingredient-blocked, tickets than `HUD_KITCHEN_BACKLOG_QUEUED_TICKETS
 * _THRESHOLD` is falling behind on cooking, distinct from `ingredient_shortage` above by
 * `order-system.js`'s own documented rule (`blockedByIngredientId === null` is what separates a
 * kitchen backlog from a shortage on an otherwise identical queued ticket).
 */
function hasKitchenBacklog(restaurantId, orders) {
  const backlogged = orders.filter(
    (o) => o.restaurantId === restaurantId && o.state === 'queued' && o.blockedByIngredientId === null,
  );
  return backlogged.length > HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD;
}

/** PRD §8 `long_entry_queue` row, off the restaurant's own already-published `queueLength`. */
function hasLongEntryQueue(restaurant) {
  return (restaurant.queueLength ?? 0) > HUD_LONG_ENTRY_QUEUE_THRESHOLD;
}

/** PRD §8 `dirty_table` row — any table blocking a seating, off the already-published `tables[]`. */
function hasDirtyTable(restaurant) {
  return (restaurant.tables ?? []).some((t) => t.dirty);
}

/**
 * Classifies one restaurant's already-published state into the `BottleneckKind` vocabulary, in
 * PRD §18 priority order. Exported standalone (not only reachable via the system's `update`) so
 * `scripts/check-hud.mjs` can drive it directly against constructed snapshot fragments, the same
 * pattern `scoring-system.js`'s `_internal` exports use.
 */
export function classifyBottlenecks(restaurant, customers, orders) {
  const kinds = [];
  if (hasUnhappyCustomer(restaurant.restaurantId, customers)) kinds.push('unhappy_customer');
  if (hasUndeliveredReadyFood(restaurant.restaurantId, orders)) kinds.push('server_overload');
  if (hasBlockingShortage(restaurant)) kinds.push('ingredient_shortage');
  // equipment_failure: never — see file header.
  if (hasKitchenBacklog(restaurant.restaurantId, orders)) kinds.push('kitchen_backlog');
  if (hasLongEntryQueue(restaurant)) kinds.push('long_entry_queue');
  if (hasDirtyTable(restaurant)) kinds.push('dirty_table');
  // cash_opportunity: never — see file header.
  return kinds;
}

export const hudBottleneckSystem = {
  id: 'hud_bottlenecks',
  phases: ['service', 'final_rush'],

  update(match) {
    const customers = match.customers ?? [];
    const orders = match.orders ?? [];
    for (const restaurant of match.restaurants ?? []) {
      restaurant.activeBottlenecks = classifyBottlenecks(restaurant, customers, orders);
    }
  },

  // No `onPhaseChange`: nothing here to set up or tear down. `activeBottlenecks` simply stops
  // being written once `update` stops running for this phase — `match.js#toSnapshot` already
  // defaults every restaurant array field to whatever the system last wrote or `[]`, and a
  // restaurant snapshot outside `service`/`final_rush` legitimately has nothing active.
};
