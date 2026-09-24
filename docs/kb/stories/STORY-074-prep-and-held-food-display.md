---
type: Story
id: STORY-074
title: Show prep, held stock and aging food in the kitchen
description: Render the four prep states the PRD names — demand-backed cooking, speculative prep, prepared stock available, and stock nearing quality loss — so a co-op partner can tell what was deliberately prepped from what was ordered.
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

# Show prep, held stock and aging food in the kitchen

PRD Story 5 names four states the kitchen display must distinguish: active demand-backed cooking,
active speculative prep, prepared stock currently available, and prepared stock at risk of quality
decay. STORY-072 publishes the first three (production carries a demand-versus-speculative flag,
and held stock is published under `you`), STORY-073 publishes the fourth as a qualitative
freshness band. None of them are drawn. This story draws them, and closes the co-op acceptance
criterion the other two cannot: "Co-op teammates can tell that a dish was intentionally prepped
rather than currently ordered."

There are two surfaces and they carry different weight. In the world, the station indicators
STORY-069 built need a speculative variant of the cooking state, and prepared stock needs
somewhere to live — the PRD's visual-language table (pp. 11-12) suggests "Dish card or held-food
badge" for prep stock and a "Time or freshness band" for aging, and its asset-direction section
lists "held-food shelves, warming zones, or prep-rack props" as a *candidate* for new geometry,
not a requirement. This story uses existing scene primitives, dish cards, icon sprites and
materials; if a legibility gap survives, it is recorded for STORY-077 rather than resolved by
modelling here. In React, `StationMenu.tsx` has a prepared/held-count slot left empty by
STORY-071 that this story fills.

The colour rule is fixed by the PRD's own table and by STORY-016: prep state reads as
blue/neutral — the "opportunity" colour `STATE_COLORS` already carries and `TABLE_BADGE_COLORS`
already uses for a revenue moment rather than a severity level — and aging runs yellow then
orange. Prep is not a severity, so it must not be drawn from `colorForBand`. Aging is, so it must.

## Acceptance Criteria

**The four prep states**

- [ ] A station running speculative prep is distinguishable in-world from one running a
      demand-backed ticket, driven by the flag STORY-072 publishes — not inferred client-side
      from the absence of a matching queued ticket.
- [ ] Prepared stock currently available is visible in the kitchen without opening a panel, using
      existing scene primitives (dish cards, icon sprites, materials) — no new GLB in this story.
- [ ] Prep state uses the neutral/opportunity colour, not a `colorForBand` severity, matching the
      PRD table's "Blue/neutral prep state" row and `TABLE_BADGE_COLORS`' existing precedent for a
      non-severity state.
- [ ] Aging stock shows a freshness band running yellow then orange, sourced from STORY-073's
      published qualitative band — never computed from a timestamp in the view layer.
- [ ] The four states are distinguishable from each other, and from STORY-069's five station
      states, by shape and anchor with colour removed. Demonstrate with a greyscale screenshot.

**Panels and co-op**

- [ ] `StationMenu.tsx`'s prepared/held-count slot (left empty by STORY-071) is filled from the
      published held-food list.
- [ ] A co-op client sees the same prep state as the player who started it — verify with two
      clients in one match, not by reasoning from the snapshot shape.
- [ ] Nothing renders a rival restaurant's prep or held stock; the display reads `you.*` only.

**Verification**

- [ ] `harnesses/src/kitchen-bottleneck-harness.ts` mounts all four prep states in its mocked
      fixture alongside STORY-069's station states — the PRD's p. 15 "side-by-side shortage, long
      queue, active cooking, prep availability, and urgent restock states" fixture.
- [ ] Any legibility gap that existing primitives could not close is written down as a finding for
      STORY-077 — with a screenshot — rather than fixed by adding geometry here.
- [ ] `npm run check` passes; client and harness builds pass.

## Notes

- **PRD sections:** Story 5's display requirements and co-op acceptance criterion, pp. 8-9; the
  "Required indicators" table rows for Prep stock and Aging prep, pp. 11-12; the visual-asset
  direction on p. 12, which says new assets are "not automatically required."
- **Dependency: STORY-072 must land first** (nothing to display otherwise). **STORY-073 should
  land first** for the aging band, but this story can ship the other three states without it —
  say which it shipped against in the PR.
- **Soft dependency: STORY-069** owns the station indicator anchors this story adds to. If both
  are in flight, whichever lands second reconciles the anchor layout; neither should reserve
  space the other has not agreed to.
- **This story preserves STORY-016's visual state language** and extends it with one non-severity
  colour role that `STATE_COLORS.opportunity` already defines — no new palette entry.
- **`conventions.md` Notable Pattern 11:** rules emit state, views render it. Every state here is
  published by STORY-072/073; this story computes none of it.
- **`model-asset-validation.md`** applies only if this story ends up adding a `.blend`/`.glb`,
  which it should not. If that changes, `npm run check:models` is mandatory before the PR — one
  bad vertex or material value blacks out the whole restaurant view through the bloom pass.
