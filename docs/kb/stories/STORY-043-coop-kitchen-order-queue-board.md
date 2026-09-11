---
id: STORY-043
title: Kitchen order queue board, with real dish models
status: pending
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: null
approach_summary: null
created: 2026-09-10
updated: 2026-09-10
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
