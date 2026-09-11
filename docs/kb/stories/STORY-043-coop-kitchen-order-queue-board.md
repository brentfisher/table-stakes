---
id: STORY-043
title: Kitchen order queue board, with real dish models
status: in-progress
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: story/043-coop-kitchen-order-queue-board
worktree_path: /Users/brent/table-stakes-story-043
base_branch: master
pr_url: null
is_architectural: true
approach_summary: >
  A new `kitchen_order_queue_board` entity in `restaurant-layout.json`, modeled directly on
  `kitchen_command_board`'s own entry (same `type`/`position`/`interactionRadius` shape, and
  critically `generated: true` — this sidesteps needing a hand-authored GLB node entirely, since
  `check-scenery.mjs` only requires GLB alignment for non-generated entities; the board is built
  procedurally in `RestaurantScene.ts` the same way `kitchen_command_board` already is). Server
  side: a new small facade method (on `match.kitchen`, alongside `queuedTicketsAt`, or a thin new
  one) that concatenates `queuedTicketsAt(restaurantId, station)` across every station and sorts
  with `worker-system.js`'s already-exported `compareTickets` (module.exports line ~1002) — no
  new priority logic, direct reuse, matching the AC's explicit constraint. Published on the
  snapshot as a new field (e.g. `kitchenQueueBoard: TicketBoardEntry[]`), viewer-scoped like
  `kitchenCommand: this.kitchenCommand?.privateFor(viewerRestaurantId)` already is in
  `match.js` (~line 647) — never the rival's queue. Client: `RestaurantScene.ts` gets a new
  `buildEntity`/`case 'kitchen_order_queue_board'` following the `kitchen_command_board` case as
  direct precedent, rendering each entry's real dish model via `FoodModels.ts`'s existing
  `buildArcadeFoodProxy` (same GLBs `readyDishes`/`carriedDishes` already use — no new assets).
  A new `status.nearKitchenOrderQueueBoard`/board-panel pair follows the same `nearX`/`showXBoard`
  convention `KitchenCommandBoard` uses in `GameView.tsx`, not `UpgradeTerminal`'s simpler
  ungated pattern, since this needs the co-op-primary but non-co-op-harmless behavior AC4 asks
  for (render read-only in every mode; the AI cook already acts on the identical ranking, so a
  non-co-op board is a truthful mirror, not a dead affordance). AC2's REAL 3D dish models are NOT
  the `kitchen_command_board` case (that's a flat box + a 2D React panel, no in-world dish props)
  — the right precedent is `RestaurantScene.ts`'s existing `readyDishes` pool
  (`upsertReadyDish`/`readyDishSlotPosition`/`MAX_READY_DISH_SLOTS`, ~line 1315), a fixed-slot
  pool of real `buildArcadeFoodProxy` props placed at stable world positions near a fixed
  landmark and reconciled per-ticket-id on snapshot diff. This story adds an analogous second
  pool (e.g. `queueBoardDishes`) anchored near the new board entity's position instead of the
  service pass. Files: `restaurant-layout.json`,
  `server/src/game/systems/order-system.js` or `worker-system.js` (new facade export),
  `server/src/game/match.js` (snapshot wiring), `shared/schemas/messages.d.ts`,
  `client/src/scenes/RestaurantScene.ts`, `client/src/game/GameClient.ts`, `client/src/ui/`
  (new board component), `client/src/app/GameView.tsx`. `is_architectural: true` — new snapshot
  field is a public data-model change (Decision-worthy, needs an OpenSpec change proposal).
created: 2026-09-10
updated: 2026-09-11
---

# Kitchen order queue board, with real dish models

A physical board in the kitchen — in the spirit of `kitchen_command_board`'s existing "walk up,
read state, act" pattern — listing outstanding tickets in priority order across every station, for
human cooks in co-op mode (STORY-040/041/042) to read at a glance: what SHOULD be cooking right
now, and where. Each entry shows the real 3D dish model, not just a text label.

## Acceptance Criteria

- [ ] A new kitchen entity (`restaurant-layout.json`, following `kitchen_command_board`'s existing
  shape: `type`, `position`, `interactionRadius`) renders a board listing outstanding tickets,
  ranked the same way `worker-system.js#compareTickets` already ranks them for the AI cook (queue-
  age bucket, then patience risk), across ALL stations — not scoped to one station the way
  STORY-042's per-station menu is.
- [ ] Each queue entry shows the real per-dish 3D model — reuse `FoodModels.ts`'s existing
  `buildArcadeFoodProxy`/GLB assets (the same ones `readyDishes`/`carriedDishes` already use in
  `RestaurantScene.ts`), not a new asset or a text-only card.
- [ ] The board updates live as tickets are queued, started, and completed — driven from existing
  `kitchen.queuedTicketsAt`/ticket state, no new server-side ticket-priority computation beyond
  what `compareTickets` already does (reuse or extract it if it's not already exported for this).
- [ ] Visible/relevant primarily in co-op mode (no automated cook to already be acting on this
  ranking), but should not break or look wrong if built generally — confirm behavior in a
  non-co-op match too (either hidden, or a harmless read-only mirror of what the AI cook is doing).

## Notes

- Depends on STORY-040 (co-op mode, no automated cook); can land in parallel with STORY-042 (both
  read the same underlying ticket-priority data, one per-station, one restaurant-wide) — no hard
  ordering between the two beyond both depending on STORY-040.
- Cites: `shared/game-data/restaurant-layout.json`'s `kitchen_command_board` entity and
  `client/src/scenes/RestaurantScene.ts`'s existing `buildEntity` `case 'kitchen_command_board'`
  as the direct structural precedent — this story EXTENDS that "board entity you walk up to and
  read" pattern with a new entity, not a modification of the existing kitchen command board (which
  is about `kitchen_focus_*` policy, a different concern).
- Cites: `client/src/scenes/FoodModels.ts` — dish models are ALREADY authored and loaded per dish
  id; this story is presentation/placement only, no new asset authoring.
