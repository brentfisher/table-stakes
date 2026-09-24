---
type: Story
id: STORY-075
title: Ingredient risk readable from inside the kitchen, without the pantry panel
description: Surface the per-ingredient risk levels you.pantry already publishes as an in-kitchen readout, mapped onto the four state colours and kept visually distinct from queue depth and waiting-to-cook.
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

# Ingredient risk readable from inside the kitchen, without the pantry panel

PRD Story 6's first requirement (pp. 9-10) is to "show ingredient health in the kitchen view
without requiring the pantry/restock panel", on the established four-colour language: green
healthy, yellow attention soon, orange operational bottleneck, red critical. Today a player
standing at the grill has exactly two ingredient signals: the fixed-red `shortageIcon` at a
station whose bin is already dry, and — if they walk to the pantry and open it — `PantryBoard.tsx`.
There is nothing between "fine" and "already blocked", which is precisely the gap the PRD is
describing: risk should be visible *before* it becomes a service failure.

The data is already on the wire and does not need inventing. `inventory-system.js#publicFor`
publishes `you.pantry` with, per ingredient, a `count`, `incomingUnits`, `blockedTickets`,
`ordersRemaining`, `affectedDishIds` and a four-level `risk` of `STOCKED` / `WATCH` / `AT RISK` /
`BLOCKING`, plus an `overallRisk`. That vocabulary maps one-to-one onto the PRD's four colours and
onto `STATE_COLORS`' healthy/attention/bottleneck/critical — so this story is a presentation
story over published state, with no server change at all.

The constraint that makes it non-trivial is the PRD's own: shortage iconography must stay
"visually distinct from queue depth and waiting-to-cook indicators", and the Story 6 acceptance
criterion spells out how — "through shape, position, and color, not color alone." The kitchen
already has three station-front signals (queue boxes, shortage glyph, waiting glyph) and
STORY-069 adds two more. A fourth family competing for the same anchor would undo the exact
distinction `updateStationIndicators`' own comments were written to protect. Choosing a different
anchor — the pantry itself, a wall readout, or an at-risk badge on the affected station rather
than another glyph in the same stack — is the design work here, and the decision belongs in a
comment.

## Acceptance Criteria

**The readout**

- [ ] Per-ingredient risk is readable from inside the kitchen without opening `PantryBoard`, using
      `you.pantry`'s existing `risk` levels — no new server field and no client-side thresholding
      of `count`.
- [ ] `STOCKED`/`WATCH`/`AT RISK`/`BLOCKING` map onto the four existing `STATE_COLORS` bands, with
      the mapping written once in one place, not repeated per call site.
- [ ] The readout is distinguishable from station queue depth and from the waiting-to-cook glyph
      by **shape and anchor position**, not only colour — verify with a greyscale screenshot
      showing all of them at once.
- [ ] It does not add a fourth competing glyph to the station-front stack that
      `updateStationIndicators` comments describe; whatever anchor is chosen, the reason is in a
      comment next to it.
- [ ] Which ingredient is at risk, and roughly how bad, is legible without a text-heavy overlay
      (PRD Story 2's framing, applied here) and without reading a number.

**Scope and verification**

- [ ] Readable at `DEFAULT_CAMERA` and at STORY-067's kitchen framing if it has landed.
- [ ] Nothing leaks a rival's inventory: the readout reads `you.pantry` only, preserving the
      scoping that keeps stock levels off `restaurants[]`.
- [ ] `PantryBoard.tsx` remains fully functional and unchanged in scope — PRD Story 6: "Preserve
      the full pantry interface for advanced selection, broader shopping, and cost control."
- [ ] Verified in `harnesses/src/pantry-board-harness.ts` and
      `harnesses/src/kitchen-bottleneck-harness.ts` across all four risk levels, with a screenshot
      per level or one fixture showing all four.
- [ ] `npm run check` passes; client and harness builds pass.

## Notes

- **PRD sections:** Story 6 "Ingredient risk and quick restock", pp. 9-10 — the ingredient-health
  requirement, the four-colour mapping, and the "shape, position, and color — not color alone"
  acceptance criterion.
- **Companion art:** `docs/Kitchen indicator concept sheet` panel 3's left half — a `LOW STOCK`
  warning with per-ingredient badges (`Tomatoes CRITICAL`, `Lettuce LOW`, `Beef LOW`,
  `Cheese OK`), each carrying a count. The footer legend fixes the four colours.
- **The data already exists.** Read `inventory-system.js#publicFor` (around line 654) before
  designing anything: `risk` is already computed there from bin + pantry + in-flight units against
  `perServing`, and `overallRisk` is already the max. Re-deriving any of it client-side would
  violate `conventions.md` Notable Pattern 1 and would drift from the server's own thresholds.
- **This story preserves Decision 39 (`openspec/changes/ingredient-inventory-and-restocking/
  design.md`)** — "the shortage is public; the priced menu and the stock levels are not." That
  decision forbids stock in the shared `restaurants[]` array, and `check-district-choice.mjs`
  asserts it. It does not forbid the viewer seeing their own stock: `you.pantry` already carries
  exactly that and has since STORY-033. This story reads `you.pantry` and adds nothing to
  `restaurants[]`, so the decision holds unchanged — say so in the PR body, because a diff that
  makes stock more visible reads as overturning it.
- **This story preserves STORY-016's visual state language** and the deliberate distinction
  `updateStationIndicators` documents between a queue-depth colour band and a fixed-severity
  shortage glyph.
- **Dependency:** none inbound. **STORY-076 depends on this story** — the quick-restock action is
  the thing a player does once this readout tells them to.
