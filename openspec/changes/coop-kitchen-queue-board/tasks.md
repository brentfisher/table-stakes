# Tasks — Kitchen order queue board, with real dish models

## 1. Layout

- [ ] 1.1 Add `kitchen_order_queue_board` entity to `restaurant-layout.json`
  (`type`, `position`, `interactionRadius`, `generated: true`).

## 2. Server — ranking reuse and facade

- [ ] 2.1 Promote `compareTickets` in `worker-system.js` to a real top-level export
  (Decision 67), with a comment justifying the promotion; leave `_internal.compareTickets`
  pointing at the same function.
- [ ] 2.2 Add `queuedTicketsAcrossStations(restaurantId)` to `order-system.js`'s
  `createKitchenFacade` (Decision 68), importing `compareTickets` from `worker-system.js`.

## 3. Wire contract

- [ ] 3.1 Add `KitchenQueueBoardEntry` interface to `game-state.d.ts`.
- [ ] 3.2 Re-export it and add `you.kitchenQueueBoard: KitchenQueueBoardEntry[]` in
  `messages.d.ts`.
- [ ] 3.3 Wire `you.kitchenQueueBoard` in `match.js#toSnapshot` (Decision 69).

## 4. Client — scene

- [ ] 4.1 Add `buildEntity` case `'kitchen_order_queue_board'` (landmark box) in
  `RestaurantScene.ts`.
- [ ] 4.2 Add `kitchen_order_queue_board` to `COMMAND_POST_IDS`.
- [ ] 4.3 Add `MAX_QUEUE_BOARD_SLOTS` constant and `queueBoardSlotPosition(rank)` helper.
- [ ] 4.4 Add `upsertQueueBoardDish`/`removeQueueBoardDish`/`queueBoardDishIds`, rank-ordered
  (Decision 71), reusing `buildDishProxy`.
- [ ] 4.5 Clear the new pool in the scene's teardown/dispose path.

## 5. Client — status and reconciliation

- [ ] 5.1 Add `kitchenQueueBoard`, `nearKitchenOrderQueueBoard`, `showKitchenOrderQueueBoard` to
  `GameClientStatus` (+ initial state).
- [ ] 5.2 Register the `queueBoardDishes` entity kind and reconcile it from
  `you.kitchenQueueBoard` (rank = array index) every snapshot.
- [ ] 5.3 Add the proximity read (`nearKitchenOrderQueueBoard`) in `handleFrame`, mirroring
  `nearKitchenCommandBoard`.
- [ ] 5.4 Add the `E`-toggle branch for `showKitchenOrderQueueBoard` in `onInteract`.

## 6. Client — UI panel

- [ ] 6.1 Create `client/src/ui/KitchenQueueBoard.tsx` — read-only, rank order, dish name,
  station, blocked-ingredient flag, "priority order" framing (Decision 72).
- [ ] 6.2 Gate it in `GameView.tsx` (panel render + interact-prompt cascade entry).
- [ ] 6.3 Add its styles to `client/src/app/app.css`.

## 7. Server-side check

- [ ] 7.1 Write `scripts/check-kitchen-queue-board.mjs`: ranking matches `compareTickets`
  ordering across stations; viewer scoping excludes the rival's tickets (assert the negative);
  behavior in a non-co-op (staffed) match; queued -> started -> gone live-update transition.
- [ ] 7.2 Wire `check:kitchen-queue-board` into `package.json`'s `check` script chain.
- [ ] 7.3 Falsify: break the ranking, confirm the check fails, restore, confirm it passes again.
  Record this explicitly in the story's Implementation notes.

## 8. Verification

- [ ] 8.1 `npm run install:all` in the worktree.
- [ ] 8.2 `npm run check` fully green (includes `build:client`, `build:harnesses`).
- [ ] 8.3 Update `docs/kb/stories/STORY-043-...md` with Implementation notes and checked ACs.
