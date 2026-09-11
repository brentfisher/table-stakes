// STORY-038. One source for the choices the simplified three-stage ready-up flow does not ask
// the player to make. The UI still owns navigation and presentation; this pure builder owns the
// legal default crew and pantry that accompany the player's mains, extras, and prices.

import {
  defaultInventoryAllocation,
  rosterOf,
  toCents,
} from '../schemas/setup-rules.js';
import {
  STARTING_CASH,
  STARTING_INVENTORY_DEFAULT_CASH_SHARE,
  STARTING_INVENTORY_DEFAULT_SERVINGS,
  STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT,
} from '../constants/tuning.js';

export const READY_UP_STAGES = Object.freeze(['mains', 'extras', 'prices']);

export function buildReadyUpPayload({
  mainIds,
  extraIds,
  prices,
  dishes,
  ingredients,
  layout,
  // STORY-040. A co-op restaurant (`Match#sharedRestaurant`) has no roster at all — the two
  // players ARE the staff — so it gets an empty `staffAssignments` instead of one post per
  // `rosterOf(layout)` entry. Defaults to `false` so every pre-existing (non-coop) caller of
  // this builder is byte-identical to before this story.
  sharedRestaurant = false,
}) {
  const dishById = new Map(dishes.map((dish) => [dish.id, dish]));
  const selected = [...mainIds, ...extraIds]
    .map((id) => dishById.get(id))
    .filter(Boolean);
  const startingInventory = defaultInventoryAllocation(selected, ingredients, {
    cash: STARTING_CASH,
    cashShare: STARTING_INVENTORY_DEFAULT_CASH_SHARE,
    servings: STARTING_INVENTORY_DEFAULT_SERVINGS,
    maxUnitsPerIngredient: STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT,
  });
  const slot = (id) => ({
    dishId: id,
    price: toCents(prices[id] ?? dishById.get(id)?.suggestedPrice ?? 0),
  });

  return {
    menu: mainIds.map(slot),
    addons: extraIds.map(slot),
    startingUpgradeId: null,
    // STORY-040. Empty roster in, empty assignments out — see the `sharedRestaurant` param
    // comment above. `setup-validator.js`'s `worker_unassigned` rejection is co-op-aware for
    // exactly the same reason, so this empty object is a legal submission, not an incomplete one.
    staffAssignments: sharedRestaurant
      ? {}
      : Object.fromEntries(rosterOf(layout).map((worker) => [worker.id, worker.posts[0]])),
    startingInventory,
    policyId: null,
    policyDishId: null,
  };
}
