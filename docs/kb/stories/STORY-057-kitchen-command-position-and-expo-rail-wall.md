---
id: STORY-057
title: Move the kitchen command board off the pass; expo rail becomes a back-wall display
status: approved
prd_source: null
branch: story/057-kitchen-command-position-and-expo-rail-wall
worktree_path: null
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
  PART 2 — expo rail. `kitchen_order_queue_board` (labeled "EXPO RAIL" per `RestaurantScene.ts`
  line ~890-892) currently only reveals its contents as a DOM overlay panel
  (`KitchenQueueBoard.tsx`) when the player walks up and presses E (`GameView.tsx`'s
  `nearKitchenOrderQueueBoard && showKitchenOrderQueueBoard` gate, same toggle-on-E pattern
  `KitchenCommandBoard` uses). The report wants this always-visible instead, as large 2D pictures
  of the needed dishes mounted on the kitchen's back wall — not the current click-to-reveal text
  list, and explicitly 2D pictures rather than the existing 3D dish proxies (`buildDishProxy`) used
  elsewhere (ready-dish pass, carried plates) — a deliberate simplification for at-a-glance
  readability from across the kitchen, consistent with this file's own "bumped 1.6x... hard to
  read from the normal play camera" precedent for wayfinding labels. Data is already published and
  needs no new field: `status.kitchenQueueBoard` (`you.kitchenQueueBoard` on the wire, already
  sorted by priority, `order-system.js#queuedTicketsAcrossStations`) is exactly the same list
  `KitchenQueueBoard.tsx` renders today. Build a new always-visible (during service/final_rush,
  no E-press gating) set of large 2D dish images on the kitchen's back wall — reuse or extend the
  canvas-texture sprite infrastructure already in `client/src/scenes/icon-sprites.ts` (rasterize
  once per distinct glyph/dish, cache, tint per instance — same discipline that file already
  documents) rather than inventing a new texture pipeline; check `shared/game-data/dishes.json` and
  `client/src/scenes/FoodModels.ts`/`food-preview-renderer.ts` for any existing per-dish 2D
  artwork/icon before drawing new ones from scratch. Decide (and justify) whether the existing
  click-to-open `KitchenQueueBoard.tsx` DOM panel should be removed now that the always-visible
  wall exists, or kept as a supplementary detailed view (e.g. exact remaining-seconds/blocked-
  ingredient text the wall's large-picture format can't show at a glance) — the report's intent is
  "I want the big always-visible version", not necessarily "delete the detailed one", so keeping
  both unless they visually conflict is a reasonable default.
created: 2026-09-12
updated: 2026-09-12
---

# Move the kitchen command board off the pass; expo rail becomes a back-wall display

Two grouped reports, both about the kitchen's physical/visual layout:

1. **"the 'rush the pass' and restaurant options are in the middle and sometimes collide with
   food, put the option back deeper in the kitchen"** — the kitchen command board sits at the same
   depth as the service pass, in the middle of the row where ready food appears.
2. **"the expo rail shows the items when you click it. I would rather the entire back wall have
   2d pictures of the dishes we need to make largely"** — replace/supplement the click-to-reveal
   panel with an always-visible, large 2D display.

## Acceptance Criteria

- [ ] `kitchen_command_board`'s world position no longer overlaps the ready-dish slot span at the
  service pass (world x -6.5..6.5 at z=2) — moved meaningfully deeper into the kitchen zone (z > 3).
- [ ] The move is verified against every other kitchen entity's position/`interactionRadius` (not
  just eyeballed) to confirm no new collision was introduced.
- [ ] The kitchen's back wall now shows large, always-visible 2D pictures of the dishes currently
  needed (driven by `status.kitchenQueueBoard`, the same data `KitchenQueueBoard.tsx` already
  reads), visible during service/final_rush without requiring the player to walk up and press E.
- [ ] The 2D display updates live as the queue changes (a dish is completed and leaves the queue,
  a new ticket is queued) — no stale entries.
- [ ] A decision is made and documented about whether the existing click-to-open `KitchenQueueBoard`
  DOM panel is kept alongside the new wall display or removed, with reasoning either way.
- [ ] `npm run check` (including `build:client`) stays green.

## Notes

- Not part of any PRD slice (`prd_source: null`) — standalone gameplay-clarity reports.
- Cites: `shared/game-data/restaurant-layout.json` (`kitchen_command_board`/`service_pass`/station
  positions), `client/src/scenes/RestaurantScene.ts` (`READY_DISH_SLOT_X_RANGE`,
  `readyDishSlotPosition`, `buildWayfinding`'s "EXPO RAIL" label comment), `client/src/ui/
  KitchenQueueBoard.tsx` (today's click-to-reveal panel and its own comment distinguishing it from
  `KitchenCommandBoard`), `client/src/app/GameView.tsx` (the `nearKitchenOrderQueueBoard &&
  showKitchenOrderQueueBoard` toggle-on-E gate), `client/src/scenes/icon-sprites.ts` (existing
  canvas-texture sprite/caching discipline to reuse for the new 2D pictures).
- `KitchenCommandBoard.tsx`'s own focus-selection mechanic (Rush the Pass / Protect the Special /
  etc.) is unrelated to this story and must not change — only the 3D world POSITION of the board
  moves, not its behavior or UI panel contents.
