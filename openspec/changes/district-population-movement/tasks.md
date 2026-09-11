# Tasks — Real per-tick district movement and full-population rendering

## 1. Server — movement primitive reuse

- [x] 1.1 Promote `stepToward` in `worker-system.js` to a real top-level export (Decision 73),
  generalized with `speed`/`arrivalEpsilon` parameters defaulting to the existing worker
  constants, parameter renamed `worker` -> `entity`; leave `_internal.stepToward` pointing at
  the same function.
- [x] 1.2 Add `CUSTOMER_MOVE_SPEED`, `CUSTOMER_ARRIVAL_EPSILON`, `CUSTOMER_EXIT_OFFSET` to
  `shared/constants/tuning.js` (Decision 76), each with a comment justifying the number.

## 2. Server — destination/position split in customer-system.js

- [x] 2.1 Compute `state.exitPosition` in `ensureState`, derived from `entryPosition`/
  `queuePosition` and `CUSTOMER_EXIT_OFFSET` (Decision 74/76).
- [x] 2.2 Add `party.destinationPosition`, initialized to the birth position in `spawnParty`
  (the one position assignment that stays instant).
- [x] 2.3 Remove the four remaining direct `party.position = {...}` jumps (`collectPayment`,
  `sendToRestaurant`, `tryToSeat`, `exitParty`, and the `PAYING`-state inline duplicate of
  `collectPayment` — five call sites total) — none of them touch position any more.
- [x] 2.4 Add `spreadAcrossCandidates` (Decision 75), generalized from `queueDisplayPosition`'s
  existing grid math; refactor `queueDisplayPosition` to call it.
- [x] 2.5 Add `computeDestination(match, state, party)` (Decision 74), dispatching on
  `party.state` to the loiter/queue/table/exit destination for that state.
- [x] 2.6 Call `computeDestination` + the promoted `stepToward` unconditionally at the end of
  `advanceParty`, for every party on every tick regardless of which switch branch ran.
- [x] 2.7 Remove `toPublicCustomerSnapshot`'s `queueDisplayPosition` override — publish
  `party.position` directly for every state.
- [x] 2.8 Add `computeDestination`/`spreadAcrossCandidates`/`queueDisplayPosition` to
  `_internal` for the new check script.

## 3. Shared — state classification and render predicate

- [x] 3.1 Add `CUSTOMER_FLOOR_BOUND_STATES`/`isFloorBoundState` to `shared/schemas/game-state.js`
  and `.d.ts` (Decision 77).
- [x] 3.2 Create `shared/game-logic/district-population.js` + `.d.ts`:
  `shouldRenderCustomerForViewer(customer, viewerRestaurantId)`.

## 4. Client

- [x] 4.1 Import `shouldRenderCustomerForViewer` in `GameClient.ts` and widen the `customers`
  filter feeding `EntityViewRegistry.reconcile('customers', ...)` (Decision 77) — rename the
  local variable to reflect it is no longer "self-only".
- [x] 4.2 Confirm `RestaurantScene.ts#upsertCustomer`/`CustomerRenderState` need no changes
  (verified — no edit needed).

## 5. Server-side check

- [x] 5.1 Write `scripts/check-district-population.mjs`: real per-tick movement for the queue
  approach, the seating walk, and the exit walk (including the LEAVE_DISTRICT zero-delta case
  from Decision 74); the entrance-loiter spread; `shouldRenderCustomerForViewer` on synthetic
  snapshots and on a real match's own `match.customers`; the exit-distance-budget arithmetic
  against the real layout file.
- [x] 5.2 Wire `check:district-population` into `package.json`'s `check` script chain.
- [x] 5.3 Falsify: break the movement integration (comment out the `stepToward` call), confirm
  the movement sections fail; break `shouldRenderCustomerForViewer` (revert to the old
  equality-only filter), confirm the render sections fail; restore both, confirm all pass again.
  Record this explicitly in the story's Implementation notes.

## 6. Verification

- [x] 6.1 `npm run install:all` in the worktree.
- [x] 6.2 `npm run check` fully green (includes `build:client`, `build:harnesses`).
- [x] 6.3 Update `docs/kb/stories/STORY-044-...md` with Implementation notes and checked ACs.
