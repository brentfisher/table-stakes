---
type: Story
id: STORY-071
title: Station menu becomes a dish-start surface
description: Rebuild StationMenu from a read-only "what is needed here" list into the panel that starts a chosen dish, showing cook time, station, ingredient availability, queued demand and why an unavailable dish is blocked.
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

# Station menu becomes a dish-start surface

This is the client half of PRD Story 3 (pp. 5-7): the panel a player actually uses to make a
production decision. `client/src/ui/StationMenu.tsx` exists (STORY-042, 164 lines) and already
solves the hard half of the read — which dishes this station can produce, which have queued
demand, and a patience-based ordering that mirrors as much of `compareTickets` as the public
snapshot allowed. What it cannot do is start what you picked, and its header says why at length.
STORY-070 supplies the `start_dish` action; this story rebuilds the panel on top of it.

The panel's required content grows well past today's `{dishId, name, queuedCount, hasDemand}`:
the PRD asks for a visual dish card, station type, estimated cook duration, ingredient
availability, current queued demand, prepared/held count where applicable, and an explicit
demand-versus-speculative indication. Most of that is already reachable —
`shared/game-data/dishes.json` carries `stationSteps` with `durationMs` (the panel already imports
it), `you.pantry` carries per-ingredient counts and a four-level risk label, and
`you.kitchenQueueBoard` carries queued demand per dish. The prepared/held count has no source yet
and is STORY-072's; this story leaves the slot and shows nothing rather than faking it.

The ranking constraint from STORY-042 is unchanged and must stay unchanged: demanded dishes sort
first, ties break on patience then queued count then alphabetically, and the panel does not
attempt rule 2 because `queueAgeMs` is not published per order. The one thing that changes is
that the row now carries a real payload. Speculative rows (no queued demand) become selectable
rather than disabled — but `intent: "prep"` is rejected by the server until STORY-072 lands, so
this story shows those rows with an honest "prep not yet available" state rather than a button
that returns an error. When STORY-072 lands it flips that state on with no further client work.

The `sharedRestaurant` gate is worth re-deciding explicitly. STORY-042 made this panel co-op only
(AC4), because a solo player has an AI cook already choosing for them. This PRD's target modes
line says "Co-op first; presentation improvements may benefit solo and bot modes" — so the gate
may stay or may widen, but the choice must be stated in a comment with its reason, the way
Decision 72 stated the equivalent choice for the queue board.

## Acceptance Criteria

**Panel content and ordering**

- [ ] Each row renders: a dish picture card, the dish name, the station, an estimated cook
      duration derived from `dishes.json`'s `stationSteps[].durationMs`, ingredient availability,
      and the current queued-demand count.
- [ ] A row with queued demand is visually emphasised and sorts above rows without, preserving
      STORY-042's documented ordering (patience, then queued count, then alphabetical) and its
      documented refusal to attempt rule 2.

**Starting a dish**

- [ ] Selecting a row sends `start_dish` with that row's `dishId` and the correct `intent`, via a
      new `GameClient` method alongside the existing `cookOrPlateAt` — never the old generic
      `cook` payload.
- [ ] Starting a demanded dish starts **that** dish: verify in a running match (or the harness)
      that picking a lower-priority row does not start the oldest ticket instead. This is the
      single defect the whole story exists to fix.
- [ ] A row the server would reject shows *why* — ingredients, station occupancy, phase, or
      another authoritative reason — sourced from `start_dish`'s distinct rejection reasons
      (STORY-070), not re-derived client-side.
- [ ] A rejection returned by the server surfaces to the player rather than failing silently,
      reusing the existing toast/error path (`ArcadeToast.tsx` or whatever `GameView.tsx` already
      wires for `interact_rejected`).
- [ ] Speculative rows (no queued demand) are shown and marked as speculative; until STORY-072
      lands they present an explicit "not yet available" state rather than a button that errors.
- [ ] A slot exists for prepared/held count but renders nothing while no source publishes it —
      no placeholder number, no client-computed stand-in.

**Constraints and verification**

- [ ] The panel never sorts or scores anything the server published: no client-side priority
      computation (`conventions.md` Notable Pattern 1, and PRD Story 7's "Recommendations do not
      compute game logic in the rendering layer").
- [ ] The `status.sharedRestaurant` co-op gate is either kept or widened, with a comment stating
      which and why, referencing STORY-042 AC4 and this PRD's target-modes line.
- [ ] The panel is keyboard reachable and its rows are real buttons with accessible names — PRD
      technical-architecture table, React UI row: "accessibility and keyboard navigation".
- [ ] `buildStationMenuItems` stays pure and exported, and its shape change is reflected in its
      docstring.
- [ ] Verified in `harnesses/src/kitchen-bottleneck-harness.ts` against mocked station/demand/
      shortage states, and in a real co-op match end to end. Screenshot both.
- [ ] `npm run check` passes; client and harness builds pass.

## Notes

- **PRD sections:** Story 3, pp. 5-7 — the menu-content list and the acceptance criteria,
  including "An unavailable dish clearly explains whether the block is ingredients, station
  occupancy, phase, or another authoritative reason."
- **Companion art:** `docs/Kitchen indicator concept sheet` panel 2, "STATION INTERACTION CARD",
  is this panel's target: dish card, `HIGH PRIORITY` badge, `Cook Time 2m 30s`, `Station Stove`,
  the ingredient list, and one prominent `START COOK` action.
- **Dependency: STORY-070 must land first.** This panel has no action to send until `start_dish`
  exists. Do not stub a client-side start.
- **Soft dependency: STORY-072** supplies the prepared/held count and makes `intent: "prep"`
  legal. This story ships without it and must not block on it.
- **This story revises STORY-042's AC3** — "no new action type, no per-item selection on the
  wire" — which was correct for that story and is exactly what this PRD's product decision
  overturns. Update `StationMenu.tsx`'s header rather than leaving the old capitalised claim in
  place contradicting the code beneath it.
- **This story preserves Decision 2 and Decision 16 / PRD §18** — the panel reads only `you.*`
  and public state; it never sees the rival's kitchen.
- **`conventions.md` Notable Pattern 10:** qualitative guidance only. An estimated cook duration
  is a real published authored number and is fine; a computed "priority score" is not.
- **Precedent:** `UpgradeTerminal.tsx` for the proximity-panel pattern and its action send,
  `PantryBoard.tsx` for a panel whose rows send a composite-`targetId` interact (`pantry_order`).
