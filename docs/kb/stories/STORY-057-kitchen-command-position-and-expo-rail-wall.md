---
id: STORY-057
title: Move the kitchen command board off the pass; expo rail becomes a back-wall display
status: in-progress
prd_source: null
branch: story/057-kitchen-command-position-and-expo-rail-wall
worktree_path: /Users/brent/table-stakes-worktrees/story-057-kitchen-command-position-and-expo-rail-wall
base_branch: master
pr_url: null
is_architectural: false
approach_summary: >
  Two grouped reports, both about kitchen/back-of-house 3D layout and rendering. Neither needs a
  new server field — both work from data already published.
  PART 1 — kitchen command board position. Confirmed by reading `shared/game-data/
  restaurant-layout.json`: `kitchen_command_board` sits at `[2.5, 0, 2]`, THE SAME z-depth as
  `service_pass` at `[0, 0, 2]` (the "pass" zone spans z 1-3 per the layout's own `zones[]`; the
  "kitchen" zone proper is z 3-12). `RestaurantScene.ts`'s `readyDishSlotPosition` (line ~283-288)
  spans ready-dish proxies across local x ±`READY_DISH_SLOT_X_RANGE` (6.5) relative to
  `service_pass`'s own origin — i.e. world x -6.5..6.5 at that same z=2 — which fully covers
  `kitchen_command_board`'s x=2.5. This is a real, quantified overlap: the "RUSH THE PASS" command
  post (and its `kitchen-focus-options` panel, `KitchenCommandBoard.tsx`) sits dead center in the
  same physical row ready food appears in, confirmed not assumed. Fix: move `kitchen_command_board`
  deeper into the kitchen zone (increase z well past 3, e.g. to sit alongside `station_prep`/
  `station_grill`/etc. at z=5, or between the pass and those stations) — pick a concrete new
  position, verify it doesn't newly collide with any station or the `kitchen_order_queue_board`
  (currently at `[-3, 0, 10.8]`), and that its `interactionRadius: 1.6` doesn't overlap another
  interactable's trigger radius (same distance-check discipline STORY-053 used for
  `.upgrade-terminal`). Only reposition this ONE entity — `service_pass`, the stations, and
  `kitchen_order_queue_board` are not part of this report and should not move.
  PART 2 — expo rail. CORRECTION to this story's own original premise, found by reading the
  CURRENT codebase (STORY-043, already merged before this story was written — the original
  approach_summary missed it): the expo rail is NOT click-gated-only. `kitchen_order_queue_board`
  already carries a live, ALWAYS-VISIBLE 3D display — `upsertQueueBoardDish`/`queueBoardDishes`
  (`RestaurantScene.ts` ~line 1717-1764), driven by `GameClient.ts`'s unconditional (no proximity/
  E-press gate) `registry.reconcile('queueBoardDishes', kitchenQueueBoard.map(...))` (~line
  959-968) every snapshot. It renders real 3D dish-proxy models (`buildDishProxy`, the SAME
  low-poly models used at the pass/in carried hands) in a 5-column×2-row grid
  (`QUEUE_BOARD_COLUMNS`/`QUEUE_BOARD_ROW_Y`, ~line 340-358) mounted directly on the board's own
  3.4×1.8×0.22 box (`buildEntity`'s `kitchen_order_queue_board` case, ~line 1167-1168), ranked by
  priority, moving toward the front as rank changes. What actually IS click-gated (E-press,
  `GameView.tsx`'s `nearKitchenOrderQueueBoard && showKitchenOrderQueueBoard`) is ONLY the
  SUPPLEMENTARY text-detail DOM panel (`KitchenQueueBoard.tsx`) showing station/remaining-seconds/
  blocked-ingredient text the 3D proxies can't convey. So the report ("shows the items when you
  click it... I would rather the entire back wall have 2d pictures... largely") is best read as:
  the EXISTING always-visible 3D display is too small/hard to read at a glance (a 3.4-unit-wide
  board, real-scale 3D dish models, at the far end of the kitchen) — not that nothing is visible
  without clicking. The fix is to ENLARGE/replace this existing display, not build a new one from
  nothing: swap the compact 3D dish-proxy grid for large, flat 2D dish pictures on a much bigger
  mounted surface at/around the same landmark (deep in the kitchen zone, near
  `kitchen_order_queue_board`'s current z≈10.8, close to the z=12 kitchen-zone boundary) — note
  there is no literal wall geometry anywhere in this scene (it's an open floor-plan cutaway, no
  `buildWalls`-style mesh exists), so "the entire back wall" means enlarging/replacing this board's
  own mesh into a large flat panel, not attaching to pre-existing wall geometry. Keep using
  `status.kitchenQueueBoard` (`you.kitchenQueueBoard` on the wire, already sorted by priority,
  `order-system.js#queuedTicketsAcrossStations`) — no new field needed, same data
  `upsertQueueBoardDish` and `KitchenQueueBoard.tsx` already both read. Build large, flat 2D dish
  images (canvas-textured planes/sprites, reusing or extending `client/src/scenes/icon-sprites.ts`'s
  rasterize-once-cache-forever discipline) rather than continuing with 3D proxy models — the
  report explicitly asks for 2D pictures, a deliberate simplification for at-a-glance readability
  from across the kitchen, consistent with this file's own "bumped 1.6x... hard to read from the
  normal play camera" precedent for wayfinding labels. Decide explicitly whether to keep the
  existing 3D dish-proxy grid AND add the new large 2D wall (redundant, probably not warranted) or
  replace the 3D grid with the new 2D wall entirely (likely the right call — same data, one visual
  treatment, avoids two competing representations of the same list). Either way, the existing
  click-gated `KitchenQueueBoard.tsx` text-detail panel can stay as a supplementary detail view
  (station/seconds-remaining/blocked-ingredient text a picture can't show) unless it now visually
  conflicts with the enlarged wall — rasterize once per distinct dish, cache, tint per instance,
  the same discipline `icon-sprites.ts` already documents, rather than inventing a new texture
  pipeline; check `shared/game-data/dishes.json` and `client/src/scenes/FoodModels.ts`/
  `food-preview-renderer.ts` for any existing per-dish 2D artwork/icon before drawing new ones
  from scratch.
created: 2026-09-12
updated: 2026-09-12
---

# Move the kitchen command board off the pass; expo rail becomes a back-wall display

Two grouped reports, both about the kitchen's physical/visual layout:

1. **"the 'rush the pass' and restaurant options are in the middle and sometimes collide with
   food, put the option back deeper in the kitchen"** — the kitchen command board sits at the same
   depth as the service pass, in the middle of the row where ready food appears.
2. **"the expo rail shows the items when you click it. I would rather the entire back wall have
   2d pictures of the dishes we need to make largely"** — CORRECTED after re-reading the current
   codebase (see `approach_summary`): the queue board already has a live, always-visible 3D
   dish-model display (STORY-043) — it's not click-gated. Only a supplementary text-detail panel
   is click-gated. The real gap is that the existing always-visible display is small (a compact
   3.4-unit board with small 3D models) and hard to read at a glance — the fix is to enlarge/
   replace it with a much bigger, 2D-picture-based display, not to build visibility from scratch.

## Acceptance Criteria

- [ ] `kitchen_command_board`'s world position no longer overlaps the ready-dish slot span at the
  service pass (world x -6.5..6.5 at z=2) — moved meaningfully deeper into the kitchen zone (z > 3).
- [ ] The move is verified against every other kitchen entity's position/`interactionRadius` (not
  just eyeballed) to confirm no new collision was introduced.
- [ ] The kitchen shows large, always-visible 2D pictures of the dishes currently needed (driven by
  `status.kitchenQueueBoard`, the same data both `upsertQueueBoardDish` and `KitchenQueueBoard.tsx`
  already read) — replacing or substantially enlarging the existing small 3D dish-proxy grid on
  `kitchen_order_queue_board`, visible at a glance from across the kitchen without walking up.
- [ ] A decision is made and documented on whether the existing 3D dish-proxy grid is replaced
  entirely by the new 2D display or kept alongside it (replacing is the default expectation —
  justify explicitly if keeping both).
- [ ] The 2D display updates live as the queue changes (a dish is completed and leaves the queue,
  a new ticket is queued, priority order shifts) — no stale entries.
- [ ] A decision is made and documented about whether the existing click-to-open `KitchenQueueBoard`
  text-detail DOM panel is kept alongside the new large display or removed, with reasoning either
  way.
- [ ] `npm run check` (including `build:client`) stays green.

## Notes

- Not part of any PRD slice (`prd_source: null`) — standalone gameplay-clarity reports.
- Cites: `shared/game-data/restaurant-layout.json` (`kitchen_command_board`/`service_pass`/station
  positions), `client/src/scenes/RestaurantScene.ts` (`READY_DISH_SLOT_X_RANGE`,
  `readyDishSlotPosition`, `buildWayfinding`'s "EXPO RAIL" label comment), `client/src/ui/
  KitchenQueueBoard.tsx` (today's click-to-reveal TEXT-DETAIL panel and its own comment
  distinguishing it from `KitchenCommandBoard`), `client/src/app/GameView.tsx` (the
  `nearKitchenOrderQueueBoard && showKitchenOrderQueueBoard` toggle-on-E gate — scoped to the
  text-detail panel only, not the 3D display), `client/src/scenes/icon-sprites.ts` (existing
  canvas-texture sprite/caching discipline to reuse for the new 2D pictures).
- Cites (correction source): `RestaurantScene.ts`'s `upsertQueueBoardDish`/`queueBoardDishes`
  (STORY-043) and `GameClient.ts`'s unconditional `registry.reconcile('queueBoardDishes', ...)` —
  the ALREADY-EXISTING always-visible 3D dish-model display this story's Part 2 enlarges/replaces,
  not builds from nothing. Re-verify this is still current before starting; it was confirmed
  present on 2026-09-13, one merge after this story was originally drafted.
- `KitchenCommandBoard.tsx`'s own focus-selection mechanic (Rush the Pass / Protect the Special /
  etc.) is unrelated to this story and must not change — only the 3D world POSITION of the board
  moves, not its behavior or UI panel contents.
