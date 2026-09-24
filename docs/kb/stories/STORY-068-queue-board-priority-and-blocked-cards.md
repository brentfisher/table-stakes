---
type: Story
id: STORY-068
title: Queue-board cards carry priority tier, queue position and blocked-by-stock state in-world
description: Publish a qualitative urgency tier on each queue-board entry and render tier, rank number and blocked state on the back-wall 2D dish cards, which today carry only a picture.
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

# Queue-board cards carry priority tier, queue position and blocked-by-stock state in-world

PRD Story 2 (pp. 4-5) asks that a player "distinguish top-priority dishes from lower-priority
dishes" and "identify a blocked dish through a visually distinct shortage or blocked state"
**without** opening the text-detail panel. Most of Story 2 is already shipped and must not be
re-sliced: STORY-043 built the board on server-ranked `you.kitchenQueueBoard`, STORY-057 replaced
the small 3D dish proxies with big flat 2D picture cards on a 9x4.4 back wall (so the PRD's "do
not show both a compact 3D dish grid and a competing 2D board" requirement is already satisfied,
and `RestaurantScene.ts`'s own comment at the `MAX_QUEUE_BOARD_SLOTS` block says why), and
`KitchenQueueBoard.tsx` already renders rank, station, remaining work and a `blocked: <ingredient>`
line as the click-to-open detail surface.

What is missing is precisely the at-a-glance half. `QueueBoardDishRenderState` is
`{ ticketId, dishId, rank }` and nothing more, so a world card shows a picture and its slot
position carries the only ordering signal there is — a player reading the wall cannot tell a
top-priority ticket from a third-priority one except by counting left to right, and cannot see a
blocked ticket at all until they walk up and press E. This story closes that gap on the cards
themselves: a priority tier badge, an explicit queue-position number, and a blocked-by-stock
treatment.

The priority tier must come from the server. `worker-system.js` already has `urgencyBucket`
(`Math.floor(queueAgeMs / WORKER_TICKET_URGENCY_BUCKET_MS)`), the rule-2 half of `compareTickets`,
and `KitchenQueueBoardEntry` already carries the raw `queueAgeMs`/`patienceRisk` — but a client
that thresholds those itself would be computing priority in the rendering layer, which is what
both this PRD (Story 7: "Recommendations do not compute game logic in the rendering layer") and
`conventions.md` Notable Pattern 1 forbid. So `order-system.js#queuedTicketsAcrossStations` gains
a qualitative `urgency` label per entry, derived from the ranking primitives already in
`worker-system.js`, and the client renders that label. Qualitative, never the number: Notable
Pattern 10, and the PRD's own "must not expose raw utility scores."

## Acceptance Criteria

**Server / shared**

- [ ] `KitchenQueueBoardEntry` in `shared/schemas/game-state.d.ts` gains one qualitative field
      (e.g. `urgency: 'high' | 'medium' | 'low'`), documented with why a label ships and the
      underlying bucket number does not.
- [ ] The label is derived in `server/src/game/systems/order-system.js` from the same primitives
      `worker-system.js#compareTickets` already uses — no second ranking implementation, the
      constraint STORY-043's AC3 set and this story keeps.
- [ ] Any threshold the label needs is a named constant in `shared/constants/tuning.js` in a new
      block for this story, with a docstring saying what it is relative to (compare
      `WORKER_TICKET_URGENCY_BUCKET_MS`).
- [ ] The label is consistent with the published rank order: an entry labelled `high` never sorts
      below one labelled `low` in the same `you.kitchenQueueBoard` array. Assert this in a check.
- [ ] `scripts/check-orders.mjs` (or a new `check-*.mjs` for this story) asserts the label across
      a stepped `Match` — and per `conventions.md` Testing rule 1 registers every system it
      integrates with, including `inventory` for the blocked case.
- [ ] The new check is falsified before it is trusted: break the label derivation, confirm the
      check fails, restore. Say so in the PR body (`conventions.md` Testing rule 2).

**Client**

- [ ] `QueueBoardDishRenderState` in `client/src/scenes/RestaurantScene.ts` carries the urgency
      label and a blocked flag alongside `rank`, and `GameClient.ts`'s `queueBoardDishes`
      reconcile passes them straight through from `you.kitchenQueueBoard` without re-deriving
      either (Pattern 4/11 — the client labels published state, it does not compute it).
- [ ] Each world card shows its queue position as a number, matching the rank the
      `KitchenQueueBoard.tsx` panel already prints for the same ticket.
- [ ] Each world card shows a priority tier badge whose colours come from the existing
      `STATE_COLORS` / `colorForBand` vocabulary, not a new palette (STORY-016's language).
- [ ] A blocked ticket's card is distinguishable from an unblocked one by a treatment that is
      **not colour alone** — the PRD's Story 6 AC and STORY-016 both require shape, position or
      geometry to carry it too.
- [ ] The blocked card treatment is visually distinct from the station-front shortage glyph
      (`stationIndicators.shortageIcon`) — the board says "this ticket is stuck", the station
      glyph says "this bin is dry", and they must not read as the same signal.
- [ ] Badges and numbers stay inside the board's existing geometry: no overlap with the
      `EXPO RAIL` label at `QUEUE_BOARD_LABEL_Y` or the `E` badge at `QUEUE_BOARD_BADGE_Y`, and
      nothing new poking through the back wall.
- [ ] Legible in a screenshot from `harnesses/src/kitchen-bottleneck-harness.ts` at both
      `DEFAULT_CAMERA` and, if STORY-067 has landed, the kitchen framing.
- [ ] The board stays restaurant-private — no change to the `you`-scoping STORY-043 established.
- [ ] `npm run check` passes; client and harness builds pass.

## Notes

- **PRD sections:** Story 2 "Kitchen queue board readability", pp. 4-5. Note its "Existing
  foundation" paragraph — the PRD itself says the board "already renders live queue state and has
  been expanded to a larger 2D-picture display", so this story is the delta, not the board.
- **Companion art:** `docs/Kitchen indicator concept sheet` panel 1 shows exactly the target: a
  per-card `HIGH`/`MED`/`LOW` badge, a per-card position chip (`#1`..`#6`), and a `Queue 6` count
  with a three-colour legend in the header.
- **Already satisfied, do not redo:** the PRD's "do not show both a compact 3D dish grid and a
  competing 2D board" requirement. STORY-057 already replaced `buildDishProxy` cards with
  `createDishPictureSprite` 2D cards on this board and documented why it replaced rather than
  added. Verify it still holds; do not reintroduce a second representation.
- **Already satisfied, do not redo:** blocked-ingredient text in the click-to-open panel.
  `client/src/ui/KitchenQueueBoard.tsx` renders `blocked: <ingredientId>` and an `is-blocked`
  class today. This story is about the world cards, which show none of it.
- **This story extends Decision 68 (`openspec/changes/coop-kitchen-queue-board/design.md`)** —
  that decision established `queuedTicketsAcrossStations` as an unfiltered concat-and-sort that
  passes `blockedByIngredientId` through unchanged so the board can render a blocked state. This
  story is the consumer that decision anticipated, plus one added qualitative field. It does not
  change what the facade filters or how it sorts.
- **This story preserves Decision 67 (`openspec/changes/coop-kitchen-queue-board/design.md`)** —
  `compareTickets` stays the single ranking implementation. If the urgency label needs
  `urgencyBucket`, promote or reuse it the same deliberate way Decision 67 promoted
  `compareTickets`, and write down the same justification; do not copy the expression.
- **This story preserves Decision 70 (same file)** — no server-side cap on the published list.
  `MAX_QUEUE_BOARD_SLOTS = 10` remains a client rendering-layout constant, not a data cap.
- **`conventions.md` Notable Pattern 10:** "Players see qualitative guidance, never simulation
  math." That is the whole argument for a label rather than a number on the wire.
- **No dependency on another story in this PRD.** STORY-067's camera makes this more valuable but
  is not required; verify at `DEFAULT_CAMERA` regardless so this story stands alone.
