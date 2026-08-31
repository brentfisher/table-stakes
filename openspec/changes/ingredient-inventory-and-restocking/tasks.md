# Tasks — Ingredient inventory, station bins and restocking

- [x] `server/src/game/systems/inventory-system.js` — restaurant pantry seeded from
      `player.setup.startingInventory`, per-station ingredient bins, mise en place at the
      setup -> service lock (Decision 34)
- [x] Ingredients consumed at the dish's FIRST `stationSteps` entry, from that station's bin,
      all-or-nothing (Decision 35) — `claimIngredients()` in `order-system.js`'s `dispatchQueues`
      (Decision 38)
- [x] A blocked ticket keeps its place in the station queue and is skipped over rather than
      head-of-line blocking it (Decision 36)
- [x] `match.dishAvailability` published: false only when bin, pantry and in-flight stock are all
      short, so an unavailable dish leaves the menu and its queued tickets are voided
      (Decision 36)
- [x] `match_snapshot.restaurants[].shortages` and `match_snapshot.orders[].blockedByIngredientId`
      — the §8 shortage signal, distinguishable from queue depth (Decisions 36, 39)
- [x] `requestRestock()` on `match.pantry`: a timed pantry -> bin move, one trip at a time, with
      travel and per-unit handling from `tuning.js`, scaled by `restockTravelTimeMultiplier`
      (STORY-012) and `ingredientRestockDurationMultiplier` (PRD §9)
- [x] PRD §9 `ingredient_shortage`: one match-level draw on a rising edge over the union of both
      menus' ingredients (Decision 37)
- [x] `shared/constants/tuning.js` — the INVENTORY block, including the abstracted-restocker flag
      (Decision 40)
- [x] `defaultInventoryAllocation()` in `shared/schemas/setup-rules.js`, used by
      `defaultSubmission()` (Decision 41); every validator rule unchanged
- [x] `systems/index.js` registers `inventory` last (Decision 42)
- [x] `scripts/check-inventory.mjs`, wired in as `npm run check:inventory`, registering
      `setup`/`customers`/`orders`/`events`/`inventory` together
- [x] `scripts/check-orders.mjs`'s OrderSnapshot allowlist widened for `blockedByIngredientId`
