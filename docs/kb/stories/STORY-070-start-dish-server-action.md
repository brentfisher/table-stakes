---
type: Story
id: STORY-070
title: Server-authoritative start_dish action, selecting which dish a station begins
description: A new interact action carrying station, dish and demand/prep intent, validated and resolved server-side, so player intent is preserved instead of collapsing to the oldest eligible ticket.
status: pending
# `status` here is flow's workflow vocabulary (pending/approved/in-progress/ready-for-pr/
# pr-opened/merged/...), not OKF's draft/stable/deprecated lifecycle — kept as-is because
# kickoff and open-prs read/write it directly across every repo using flow. Don't rename it.
prd_source: /Users/brent/table-stakes/docs/cooking-prd-interactive.pdf
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: null
approach_summary: null
created: 2026-09-23
updated: 2026-09-23
---

# Server-authoritative start_dish action, selecting which dish a station begins

PRD Story 3 (pp. 5-7) makes an explicit product decision: the station menu stops being a
"what is needed here" guidance surface and becomes a dish-start surface, which requires "a
server-authoritative selected-dish cooking action so player intent is preserved". Today it is not
preserved at all, and `StationMenu.tsx`'s own header says so in capitals: every enabled row sends
the identical `{targetId: 'station_<x>', action: 'cook'}` payload, and
`action-validator.js#resolveCookOrPlate` always starts the oldest queued ticket at that station
regardless of which row was clicked. Clicking "Truffle Pasta" can start a burger.

This story ships the server half only. The wire shape needs no new message type: `pantry_order`
already established the repo's precedent for an action carrying composite parameters, encoding
them in `targetId` as `pantry:<productId>:<ingredientId>` and splitting on `:` in the validator.
`start_dish` follows it exactly — `station_<name>:<dishId>:<intent>` — so `InteractMessage` keeps
its `{ type, sequence, targetId, action }` shape and the change to `shared/schemas/messages.js` is
one new `InteractAction` member, added in the same commit as its handler per Decision 7.

Validation is the substance. The PRD lists five checks — the station supports the dish, capacity
is available, ingredients are available or reservable, the action is legal in the current phase,
and the player is in range — and every one of them has an existing owner in this codebase
(`LAYOUT_STATIONS`/`dishes.json` for the first, `match.kitchen.stationHasCapacity` for the second,
`match.pantry`/`claimIngredients` for the third, the phase gate `validateInteract` already
applies, and `requireRange` for the fifth). The work is routing to them and returning a
*distinguishable* rejection reason for each, because the client story that follows has to explain
which one blocked.

`intent: "demand"` is the whole of this story. When a matching queued ticket exists, `start_dish`
resolves to it through the same `match.kitchen.startTicket()` path `resolveCookOrPlate` and
`worker-system.js#tend_station` both already use — same timer, same ingredient claim, same
completion. `intent: "prep"` is **STORY-072**; this story must reject it with an explicit
`not_implemented`-style reason rather than half-wiring it, which is the failure mode Decision 7
exists to prevent.

## Acceptance Criteria

**Wire and validation**

- [ ] `InteractAction` in `shared/schemas/messages.d.ts` and `INTERACT_ACTIONS` in
      `shared/schemas/messages.js` gain `start_dish`, appended not re-sorted (the append-only
      convention `IMPLEMENTED_CLIENT_MESSAGE_TYPES` documents), in the same commit as its handler.
- [ ] `action-validator.js#resolveAction` gains a `case 'start_dish'` that parses
      `station_<name>:<dishId>:<intent>` the way the `pantry_order` case parses its own
      colon-delimited `targetId`, rejecting a malformed target as `no_such_target`.
- [ ] Range is checked with the existing `requireRange(player, staticTargetPosition(stationId))`,
      so `start_dish` is legal exactly where `cook`/`plate` already are.
- [ ] Each of the five PRD checks returns its **own** rejection reason, distinguishable on the
      wire: at minimum unsupported dish for that station, station at capacity, missing ingredient
      (carrying the ingredient id, as `resolveCookOrPlate` already does via
      `result.missingIngredientId`), wrong phase, and out of range.

**Resolution**

- [ ] `intent: "demand"` with a matching queued ticket resolves through
      `match.kitchen.startTicket()` — the same call `resolveCookOrPlate` makes — so the timer,
      ingredient claim and completion path are byte-identical to a worker-started ticket. No
      second cooking path.
- [ ] Among several matching queued tickets for the requested dish, which one is chosen is
      documented in a comment with its reason (compare `resolveCookOrPlate`'s own "oldest first,
      same as the queue's own FIFO dispatch" note).
- [ ] `intent: "prep"` is rejected with an explicit reason naming that it is not yet implemented,
      and the rejection is asserted by a check. Nothing half-starts.
- [ ] The existing `cook`/`plate` fast path is unchanged and still legal — PRD Story 3 AC:
      "Existing simple interact-to-cook behavior remains available as a fast path."
- [ ] `OWNER_TASK_DURATIONS_MS` gains an entry for `start_dish` (or documents why it reuses
      `cook`'s), so the post-action cooldown this file's header describes applies here too.

**Verification**

- [ ] A `scripts/check-*.mjs` drives `start_dish` against a stepped `Match` and asserts: the
      requested dish starts and a *different* queued dish does not; each rejection reason fires
      for its own cause; and a started ticket completes exactly once. Per `conventions.md` Testing
      rule 1 it registers `order`, `inventory` and `worker` — the systems this action integrates
      with — not just its own.
- [ ] The new check is falsified before it is trusted: break the dish-selection branch so it
      falls back to oldest-first, confirm the check fails, restore. Say so in the PR body.
- [ ] `npm run check` passes.

## Notes

- **PRD sections:** Story 3 "Station-based dish selection", pp. 5-7 — its "Product decision"
  paragraph, its five-item server validation list, and its `StartDishAction` API concept on p. 7.
  The PRD's TypeScript sketch names `type: "startDish"`; this repo's convention is snake_case
  message and action names (`conventions.md` Naming), hence `start_dish`.
- **This story revises the behaviour `StationMenu.tsx`'s own header documents** — "THIS PANEL DOES
  NOT PICK WHICH TICKET STARTS ... always the oldest queued ticket at the station,
  unconditionally, regardless of which row below was clicked." That constraint was STORY-042's
  AC3, and this PRD's product decision is what supersedes it. Say so in the code comment, so a
  reader of the diff does not think the invariant was broken by accident.
- **This story preserves Decision 2 (server authority)** and **Decision 7** (a declared action
  type ships with a real handler in the same commit, never a silent no-op).
- **This story preserves Decision 35 (`openspec/changes/ingredient-inventory-and-restocking/
  design.md`)** — ingredients are consumed when the first station step is dispatched, not at order
  time and not spread across steps. Routing through `startTicket()` inherits that unchanged; do
  not add a second claim point.
- **`key-files.md`:** `server/src/game/systems/order-system.js` "exposes the `match.kitchen`
  facade that other systems use instead of reaching in", and `toPublicOrderSnapshot` is the only
  function allowed to shape `match.orders`. Anything this action needs to publish goes through
  the facade.
- **Precedent to read first:** the `pantry_order` case in `action-validator.js` (composite
  `targetId`) and `resolveCookOrPlate` immediately below it (range, station validity, the
  `startTicket` call, the `missingIngredientId` rejection shape).
- **Dependency:** none inbound. **STORY-071 (the client menu) depends on this story and must land
  after it** — the menu has nothing to send until this exists. **STORY-072 (speculative prep)
  also depends on this story**, and is what fills in the `intent: "prep"` branch this one stubs.
