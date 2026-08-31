# Ingredient inventory, station bins and restocking

## Why

Nothing tracked stock. Every dish on a locked menu was permanently available, every ticket was
cookable forever, and the pantry in the §14 layout was a prop. That made one of PRD §8's eight
named operational bottlenecks — `Ingredient shortage`, whose visible signal is "Empty ingredient
icon", whose intervention is "Retrieve/restock ingredients" and whose consequence is "Menu items
unavailable, canceled orders" — impossible to reach, and it is the one bottleneck that gives the
owner a reason to physically walk to the back of the restaurant.

It also left two shipped things wired to nothing. STORY-009 validates, prices and stores a
`startingInventory` allocation (PRD §7 item 3) that no system read. `events.json`'s
`ingredient_shortage` card carries `affectedIngredientCount` and
`ingredientRestockDurationMultiplier` that no consumer looked at. `upgrades.json`'s Pantry
Shelves ($150, "restock travel time -25%") scaled a duration that did not exist.

This corresponds to STORY-006 in the slicing pass.

## What changes

- **Two levels of stock per restaurant**: a pantry seeded from the player's own §7 allocation,
  and a small working bin per kitchen station per ingredient.
- **Consumption at the station step**, not at order time: a ticket pulls its dish's ingredients
  out of a bin the instant its first `stationSteps` entry is dispatched.
- **A blocked state and an unavailable state**, from one rule about where the stock is.
  Bin empty with stock in the pantry blocks the tickets that need it and raises a shortage the
  snapshot reports as its own thing. Bin and pantry both empty makes the dish unavailable: it
  leaves the menu for new orders and its queued tickets are voided, which cancels the order.
- **Restocking as a timed job** that moves units pantry -> bin, with travel and per-unit handling
  in `tuning.js` so STORY-012's Pantry Shelves upgrade scales it and PRD §9's
  `ingredient_shortage` multiplies it.
- **`match_snapshot.restaurants[].shortages`**, the §8 signal, distinct from queue depth; and
  `match_snapshot.orders[].blockedByIngredientId`, which separates the two §8 bottlenecks at the
  ticket level.
- **`defaultSubmission()` allocates a pantry**: an empty allocation was a correct default while
  nothing read it and a restaurant that cannot cook once something does.

## Non-goals

- **The restock ACTIONS.** The owner's physical restock interaction is STORY-008 and the worker's
  restock behaviour is STORY-007. This change owns the model and the state; `requestRestock()` is
  the call both of those stories make. `INVENTORY_AUTO_RESTOCK` is an explicitly abstracted
  stand-in for the §7 prep worker, in the same spirit as `ORDER_PASS_HANDOFF_MS`.
- **Buying ingredients mid-service.** `ingredientCostMultiplier` therefore still has no consumer;
  the pantry is a fixed reserve for the match. See Decision 37.
- **Spoilage and waste.** PRD §7 lists "Waste/spoilage risk" as a dish property and §11 counts
  "Unserved food waste"; neither is modelled here, and no placeholder pretends otherwise.
- **Publishing the priced menu or stock levels** in `restaurants[]`. See Decision 39.
