---
id: STORY-043
title: Kitchen order queue board, with real dish models
status: merged
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: story/043-coop-kitchen-order-queue-board
worktree_path: /Users/brent/table-stakes-story-043
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/62
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

- [x] A new kitchen entity (`restaurant-layout.json`, following `kitchen_command_board`'s existing
  shape: `type`, `position`, `interactionRadius`) renders a board listing outstanding tickets,
  ranked the same way `worker-system.js#compareTickets` already ranks them for the AI cook (queue-
  age bucket, then patience risk), across ALL stations — not scoped to one station the way
  STORY-042's per-station menu is.
- [x] Each queue entry shows the real per-dish 3D model — reuse `FoodModels.ts`'s existing
  `buildArcadeFoodProxy`/GLB assets (the same ones `readyDishes`/`carriedDishes` already use in
  `RestaurantScene.ts`), not a new asset or a text-only card.
- [x] The board updates live as tickets are queued, started, and completed — driven from existing
  `kitchen.queuedTicketsAt`/ticket state, no new server-side ticket-priority computation beyond
  what `compareTickets` already does (reuse or extract it if it's not already exported for this).
- [x] Visible/relevant primarily in co-op mode (no automated cook to already be acting on this
  ranking), but should not break or look wrong if built generally — confirm behavior in a
  non-co-op match too (either hidden, or a harmless read-only mirror of what the AI cook is doing).

## Implementation notes

**OpenSpec.** `is_architectural: true` (new public snapshot field) — `openspec/changes/
coop-kitchen-queue-board/` carries `proposal.md`, `design.md` (Decisions 67-72, continuing the
repo's numbering from `coop-no-staff`'s Decision 66, with a Mermaid diagram of the real new
components: `compareTickets`'s promotion, `queuedTicketsAcrossStations`, the snapshot field, the
scene entity/dish pool, the UI panel), `tasks.md`, and a delta spec at
`specs/coop-kitchen-queue-board/spec.md`. `openspec validate coop-kitchen-queue-board --strict`
passes.

**AC1 — the ranking, and where it lives.** The approach_summary's own citation of
`worker-system.js`'s `compareTickets` as "already-exported (module.exports line ~1002)" turned out
to be a misread of the actual code: that export is `_internal.compareTickets`, and `_internal`'s
own header is explicit — "not part of the system's contract, and no other system or route may
import it." Reaching into it from `order-system.js` would have violated that on day one. Instead,
`compareTickets` (and the `urgencyBucket` helper it calls) was promoted to a REAL top-level export
at its existing definition site (`worker-system.js:327`) — justified, not a workaround: it is a
pure function over ticket-shaped data (`queueAgeMs`, `patienceRisk`, `ticketId`) with no closure
over `match`/`state`, and this story is the reason the promotion is now warranted — publishing its
exact ordering on the wire makes PRD §17 rules 2/3 a snapshot contract other code legitimately
depends on, not an internal AI implementation detail `_internal` exists to protect.
`_internal.compareTickets` still points at the identical function reference, so
`scripts/check-workers.mjs` needed no change (verified: `check:workers` still passes).

The new facade method, `queuedTicketsAcrossStations(restaurantId)`, lands on `match.kitchen`
(`order-system.js`'s `createKitchenFacade`, next to `queuedTicketsAt`) rather than on
`worker-system.js`'s own `workerSystem` export — that export is shaped as a registered system
(`id`/`phases`/`update`/`onPhaseChange`), not a per-restaurant query facade, and every existing
"ask about restaurant state" method already lives on `match.kitchen`. It is exactly
`LAYOUT_STATIONS.flatMap((station) => this.queuedTicketsAt(restaurantId, station)).sort
(compareTickets)` — no duplicated priority math, confirmed by `check-kitchen-queue-board.mjs`'s
own assertion that the facade's output is byte-identical to an independently hand-sorted
concatenation.

Deliberately NOT filtered by `isBlockedNow`/`stationHasCapacity` the way `selectCookTask`'s own
candidate list is — this board answers "what is outstanding, in priority order", not "what can
start right now", so a blocked ticket stays on the board (`blockedByIngredientId` carries through)
instead of silently vanishing the way it would from the AI cook's own selection.

**AC1 caveat, recorded rather than chased.** `selectCookTask` actually picks via
`match.kitchenCommand?.rankTickets(restaurantId, startable, compareTickets) ?? startable.sort
(compareTickets)` — under a non-default `kitchen_focus_*` selection, the AI cook can legitimately
start a different ticket than this board's own top row (the focus reprioritizes; this board uses
plain `compareTickets`, per the AC's own explicit wording, and per this story's own notes that
`kitchen_command_board`/its focus policy is a different concern this story does not touch). The
panel's copy says "priority order", never "what the cook will do next", so this is a documented
scope boundary (`design.md` Decision 72), not a bug.

**AC2 — real 3D dish models.** `RestaurantScene.ts` gets a second fixed-slot dish-proxy pool,
`queueBoardDishes`, reusing the existing `buildDishProxy(dishId)` (which already wraps
`FoodModels.ts`'s `buildArcadeFoodProxy` with a procedural fallback — the same function
`readyDishes` calls). It is deliberately NOT `readyDishes`' own held-slot discipline
(`claimReadyDishSlot` claims a slot once and keeps it so an already-visible dish never jumps
sideways when a newer one arrives — see that constant's own comment): this board's entire point is
PRIORITY ORDER, so slot index IS rank index, recomputed every snapshot from
`you.kitchenQueueBoard`'s own array position. A prop visibly moves toward the front as its
ticket's priority rises — the feature, not a bug the way pass-side jumping would be
(`design.md` Decision 71). `GameClient.ts` computes `rank` as a plain array index (Pattern 4/11 —
the client labels already-server-ranked state, it does not compute order); `RestaurantScene.ts`
never sorts anything.

**AC2 — dish-pool sizing.** `MAX_QUEUE_BOARD_SLOTS = 10`, a new LOCAL scene constant (not
`shared/constants/tuning.js`) — same choice `MAX_READY_DISH_SLOTS` already made for the identical
reason: this is a rendering-layout number (how many slots this scene lays out), not a gameplay
tunable. 10 rather than `MAX_READY_DISH_SLOTS`'s 8: this list is restaurant-wide across all 4
stations (`queuedTicketsAcrossStations`), not one station's approximation of the pass, so a
busier worst case is plausible. Laid out as a 5-column x 2-row grid (`queueBoardSlotPosition`),
not `readyDishSlotPosition`'s single row — the board's own landmark box is only 3.4 units wide
(far narrower than the 16-unit service pass a single row was designed to span), so a grid avoids
overlap. The server-side list is deliberately NOT capped (`design.md` Decision 70) — the MVP's
4-station kitchen cannot produce a payload-sized list, and a server-side truncation would read as
a second, undocumented priority rule on top of `compareTickets`; only the client's RENDERING pool
is capped, past which a ticket is hidden rather than overlapped (same discipline
`claimReadyDishSlot`'s own comment documents).

**AC3 — live updates, no new priority computation.** `you.kitchenQueueBoard` is wired in
`match.js#toSnapshot` as `this.kitchen?.queuedTicketsAcrossStations(viewerRestaurantId) ?? []`,
under `you` (private, viewer-scoped) alongside `kitchenCommand` — `[]`, not `null`, unlike
`kitchenCommand`: there is no meaningful distinction here between "nothing queued" and "kitchen
system not yet attached" for a consumer to need. `client/src/scenes/RestaurantScene.ts`'s pool and
`client/src/ui/KitchenQueueBoard.tsx`'s panel both read this one array, reconciled every snapshot
by `EntityViewRegistry` under a new `'queueBoardDishes'` kind — a ticket appears the instant it's
queued, and disappears the instant `match.kitchen.startTicket` moves it off the station's queue
(proven, not just asserted, by `check-kitchen-queue-board.mjs`'s own queued->started->gone
assertion, checked at both the facade level and through the full `match.toSnapshot` wire path).

**AC4 — renders in every mode.** Chosen over hiding outside co-op, matching `approach_summary`: a
staffed match's board is a truthful, harmless mirror of PRD §17 rules 2/3 at the default kitchen
focus (see the AC1 caveat above for the one place that stops being exactly true). Gated in
`GameView.tsx` the same `nearX && showXBoard && (service || final_rush)` way
`KitchenCommandBoard` is — not `StationMenu`'s `sharedRestaurant`-gated pattern — since this board
is meant to be visible, just not the only thing driving play, outside co-op. Verified directly by
`check-kitchen-queue-board.mjs`'s own assertion that a plain (non-`sharedRestaurant`) match's
`you.kitchenQueueBoard` populates identically to a co-op match's.

**New check script: `scripts/check-kitchen-queue-board.mjs`.** This story adds real server-side
logic (a new ranked-snapshot facade), so — per this story's own instructions and unlike
STORY-042's pure client-only surface — a new check was warranted. It registers the real
`setup`/`customer`/`order` systems against a real two-restaurant `Match` (no `workerSystem`, so
nothing auto-dispatches queued tickets out from under the test) and injects ticket state directly
into `order-system.js`'s own internal station queues — the same "direct-state-injection
technique" `check-owner-actions.mjs`/`check-workers.mjs` use, chosen over routing through
`match.kitchen.placeOrder`'s probabilistic dish draw, since this story adds no new dish-selection
logic and exact `queueAgeMs`/`patienceRisk` combinations across specific stations are what needed
proving. 15 checks: `compareTickets`'s promotion didn't fork the function; the facade's ranking is
byte-identical to an independently hand-sorted concatenation across grill/prep/plating with no
ties (four engineered tickets, one unambiguous order); a blocked ticket still appears, carrying
its `blockedByIngredientId`; `you.kitchenQueueBoard` is scoped to the viewer's own restaurant —
the NEGATIVE is asserted directly (a rival's ticket ids are never present in either direction),
not inferred from the positive case alone; the field populates in both a plain and a co-op match
(AC4); and the queued->started->gone live-update transition, checked at both the facade and the
full snapshot wire path (AC3). Wired into `package.json` as `check:kitchen-queue-board`, in the
`npm run check` chain (before `check:scenery`).

**Falsified per house rule.** After committing, `queuedTicketsAcrossStations`'s `.sort
(compareTickets)` was removed (leaving the plain `LAYOUT_STATIONS` concatenation order). Re-running
the new check: 3 of 15 checks FAILED as expected (the ranking-order check, the "byte-identical to
independently hand-sorted" check, and the snapshot-matches-facade check) — `12/15 checks passed`,
exit code 1. Restored with `git checkout -- server/src/game/systems/order-system.js`; re-ran the
check: `15/15 checks passed`, exit code 0. `git diff`/`git status` confirmed the worktree matched
the committed state exactly before and after.

**Verification.** `npm run install:all` (fresh worktree). `npm run build:client` and `npm run
build:harnesses` both type-check and build clean with every new type (`KitchenQueueBoardEntry`,
`QueueBoardDishRenderState`) and every new field/method. Full `npm run check` — all `check-*.mjs`
scripts (including the new one), both builds, and the smoke suites — passes green, run twice
end to end (one run's `smoke-phases.mjs` reconnection check failed once on a re-run in isolation
and then passed cleanly on the next two runs with no code changes in between — a timing-sensitive,
pre-existing real-socket smoke test unrelated to this story's own diff, not a regression this
story introduced).

**Layout entity placement.** `kitchen_order_queue_board` sits at `[-3, 0, 10.8]`, `interactionRadius:
1.8`, `generated: true` (the `kitchen_command_board` precedent — `check-scenery.mjs` only requires
GLB alignment for non-`generated` entities, so no GLB re-export was needed). Positioned off-center
in the kitchen's back area, away from the `COPPER & THYME` title sign at `(0, 3.6, 11.8)` and clear
of the prep/pantry corner, rather than dead-center, purely to avoid visual clutter with existing
wayfinding — no gameplay significance to the exact coordinates.

**Honest visual-verification limitation** (same as STORY-041/042): this environment's browser
automation cannot run the WebGL render loop (`document.visibilityState` reports `hidden` in the
automated Chrome tab, which blocks `requestAnimationFrame`), so the board's actual on-screen
appearance (the dish-prop grid, its rank-reorder motion, the panel's styling) was never
screenshotted or visually confirmed live. Verification here is type-checking, the real-`Match`
check script, and the falsify/restore cycle above — not a live render.

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
