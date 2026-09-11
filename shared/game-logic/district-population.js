// STORY-044. Reported: "it seems like [customers] just show up at yours" — `GameClient.ts` was
// filtering `match.customers` to `c.restaurantId === restaurantId` BEFORE ever reconciling
// through `EntityViewRegistry`, so a party not yet assigned to a restaurant (still deciding) or
// assigned to the RIVAL never rendered at all. This is the ONE predicate that decides whether a
// given customer snapshot belongs on THIS viewer's floor — pulled out as its own pure,
// dual-imported module (Decision 4's plain-JS-plus-`.d.ts` shape, same reasoning
// `hud-alerts.js`/`hud-cash-feedback.js` give for living under `shared/`: `GameClient.ts` and
// `scripts/check-district-population.mjs` are its only two callers, and neither can import the
// other's runtime) specifically so the client's render filter and this story's own check can
// never quietly diverge.

import { isFloorBoundState } from '../schemas/game-state.js';

/**
 * `customer.restaurantId === viewerRestaurantId` is the pre-existing, still-necessary half: both
 * restaurants in a match share one `restaurant-layout.json` (identical table ids and
 * coordinates — see `customer-system.js#buildRestaurantView`'s own comment), so a party actually
 * QUEUED OR SEATED at the rival must stay excluded, exactly as before this story — rendering it
 * would place it on top of this viewer's own furniture.
 *
 * `!isFloorBoundState(customer.state)` is the new half (an OR, not a replacement — the existing
 * equality check is never removed). A party in one of those states hasn't reached any
 * restaurant-specific floor space yet, or has already left it behind: it is standing in the
 * shared, restaurant-agnostic district street (`customer-system.js`'s own
 * `entryPosition`/`exitPosition` landmarks, identical in both restaurants' local layouts), which
 * is safe — and, per this story's AC, required — to render for either viewer regardless of
 * `restaurantId`.
 *
 * @param {{ restaurantId: string | null, state: string }} customer
 * @param {string | null} viewerRestaurantId
 * @returns {boolean}
 */
export function shouldRenderCustomerForViewer(customer, viewerRestaurantId) {
  return customer.restaurantId === viewerRestaurantId || !isFloorBoundState(customer.state);
}
