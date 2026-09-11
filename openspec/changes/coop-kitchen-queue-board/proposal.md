# Proposal — Kitchen order queue board, with real dish models

## Why

STORY-040 removed the automated cook from co-op mode: a human at a station now decides what to
start with nothing but their own eyes on that one station's queue. STORY-042 already gave a
station-local "what to cook here" read, but the AI cook's own priority rule
(`worker-system.js#compareTickets` — PRD §17 rules 2/3, queue-age bucket then patience risk) is
computed restaurant-wide, across all four stations, and nothing on the client currently shows a
co-op crew that whole-kitchen picture. A player standing at the grill has no way to know a plating
ticket three minutes old is more urgent than anything in front of them. This change adds a second,
restaurant-wide board — the kitchen's own physical "expo rail" — that shows every outstanding
ticket in the AI cook's own priority order, with its real dish model, so a co-op crew can
coordinate who covers what next without a shared voice channel.

## What Changes

- New kitchen entity `kitchen_order_queue_board` in `restaurant-layout.json`
  (`generated: true`, same as `kitchen_command_board` — no hand-authored GLB node required).
- New restaurant-wide ranking facade, `match.kitchen.queuedTicketsAcrossStations(restaurantId)`
  (`order-system.js`), concatenating the existing per-station `queuedTicketsAt` across every
  `LAYOUT_STATIONS` entry and sorting with `worker-system.js`'s `compareTickets` — promoted from
  `_internal`-only (test-script use) to a real top-level export, since it is a pure function over
  ticket-shaped data with no `match`/`state` closure, and this change makes its ordering a
  published wire contract, not just an internal AI implementation detail.
- New `match_snapshot.you.kitchenQueueBoard: KitchenQueueBoardEntry[]` field — viewer-scoped
  exactly like `you.kitchenCommand` (own restaurant's queue only, never the rival's — PRD §18 /
  Decision 16). **BREAKING**: none — purely additive to the snapshot shape.
- New client scene entity (`RestaurantScene.ts` `buildEntity` case) rendering the board as a
  landmark box, plus a second fixed-slot real-dish-model pool (`queueBoardDishes`, alongside the
  existing `readyDishes` pool) anchored near it, reconciled by rank order every snapshot.
- New `status.nearKitchenOrderQueueBoard`/`showKitchenOrderQueueBoard` pair (`GameClient.ts`),
  following the `kitchen_command_board` proximity/toggle precedent.
- New read-only UI panel, `client/src/ui/KitchenQueueBoard.tsx`, gated in `GameView.tsx` the same
  way `KitchenCommandBoard` is.
- New server-side check script, `scripts/check-kitchen-queue-board.mjs`, proving the ranking
  matches `compareTickets` ordering and that the snapshot field is scoped to the viewer's own
  restaurant only.

## Capabilities

- **New Capabilities**: `coop-kitchen-queue-board` — the restaurant-wide ranked ticket board
  (entity, facade method, snapshot field, scene pool, UI panel) described above.
- **Modified Capabilities**: none. This change does not alter the requirements of
  `coop-no-staff`/`coop-match-mode` (it reads their existing state) or of STORY-042's per-station
  menu — both keep behaving exactly as already specified.

## Impact

- `shared/game-data/restaurant-layout.json` — new entity.
- `server/src/game/systems/worker-system.js` — `compareTickets` promoted to a real export.
- `server/src/game/systems/order-system.js` — new facade method on `match.kitchen`.
- `server/src/game/match.js` — new viewer-scoped snapshot field.
- `shared/schemas/game-state.d.ts`, `shared/schemas/messages.d.ts` — new `KitchenQueueBoardEntry`
  type and wire field.
- `client/src/scenes/RestaurantScene.ts` — new entity case, new dish-model pool.
- `client/src/game/GameClient.ts` — new status fields, new registry entity kind.
- `client/src/app/GameView.tsx`, `client/src/ui/KitchenQueueBoard.tsx` (new), `client/src/app/app.css`
  — new panel and its gating.
- `scripts/check-kitchen-queue-board.mjs` (new), `package.json` — new check wired into `npm run check`.
- No new runtime dependency, no change to the WebSocket message envelope, no database (none
  exists), no change to any other capability's requirements.
