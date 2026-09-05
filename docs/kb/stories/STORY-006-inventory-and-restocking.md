---
id: STORY-006
title: Inventory, ingredient bins, and restocking
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/006-inventory-and-restocking
worktree_path: /Users/brent/table-stakes-worktrees/story-006-inventory
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/11
is_architectural: false
approach_summary: "Two levels of stock — a pantry seeded from the §7 allocation and a per-station ingredient bin. Ticket production claims a dish's ingredients from its first station step's bin at dispatch. Bin empty with pantry stock blocks tickets and raises a snapshot shortage; bin and pantry empty marks the dish unavailable via the existing match.dishAvailability seam. Restocking is a timed pantry->bin job whose travel half the Pantry Shelves upgrade scales and whose duration the §9 ingredient_shortage event multiplies for one drawn ingredient."
created: 2026-08-28
updated: 2026-08-31
---

# Inventory, ingredient bins, and restocking

Ingredient shortage is one of the eight named operational bottlenecks in PRD §8, and it is the one
that makes the pantry a place the owner has to physically go. This story gives each restaurant an
ingredient stock, per-station bins that deplete as tickets consume them, a pantry/storage location
that refills those bins, and the shortage state that blocks production and can cancel orders.

Setup-phase inventory allocation (§7 step 3) lands here too: the player's starting stock is a
strategic commitment, and running out mid-service is the consequence of getting it wrong.

## Acceptance Criteria

- [x] `server/src/game/systems/restaurant-system.js` (or a dedicated inventory module under
      `systems/`) tracks restaurant-level stock per ingredient plus per-station bin levels.
- [x] Ticket production consumes the dish's `ingredients` quantities from the relevant station
      bin at the correct step, not at order time.
- [x] A station bin at zero blocks the tickets that need it and raises a shortage state visible in
      `match_snapshot`, distinguishable from a merely long queue.
- [x] A dish whose ingredients are unavailable is marked unavailable on the menu, and new orders
      do not select it (§8 "Menu items unavailable, canceled orders").
- [x] Restocking moves stock from pantry to a station bin and takes time; restock travel/handling
      duration comes from `tuning.ts` so the Pantry Shelves upgrade (STORY-012) can modify it.
- [x] Starting inventory allocation is part of the setup submission and is validated
      server-side (STORY-009 owns the UI; this story owns the model and the validator rule).
- [x] Ingredient shortage caused by the `ingredient_shortage` event (slower or costlier restock)
      is expressible through the same model rather than a special case.
- [x] A scratch script can drive a restaurant to a shortage and back to normal production,
      demonstrating block and recovery.

## Notes

- **Depends on STORY-002** (ingredient lists on dishes) and **STORY-005** (tickets consume stock).
- `conventions.md` data-driven content: restock durations and starting stock defaults live in
  data/tuning, not in the system.
- PRD §8 bottleneck table (ingredient shortage row), §7 step 3 (starting inventory allocation),
  §10 (Organized Pantry / Pantry Shelves upgrades depend on this story's timing hook).
- The owner's physical restock *interaction* is STORY-008; the worker's restock behaviour is
  STORY-007. This story owns only the stock model and the shortage state.
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Not architectural on its own beyond extending the restaurant model — but it changes the
  snapshot shape, so coordinate the schema addition with STORY-002's owner if both are in flight.
