---
type: Story
id: STORY-077
title: Kitchen readability audit, and Blender assets only where primitives could not close the gap
description: Audit the finished kitchen from both cameras against the PRD's readability bar, then either author the few props that are genuinely needed or record with evidence that existing primitives suffice.
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

# Kitchen readability audit, and Blender assets only where primitives could not close the gap

Rollout step 5 (p. 15) is "visual polish and optional Blender assets — only [for] an unmet
readability problem", and the PRD's visual-asset direction (p. 12) is unusually firm about it:
"New visual assets are not automatically required. The existing queue board uses programmatically
rendered 2D dish cards rather than a hand-authored illustration set, and this is likely still the
best first implementation path for station and restock indicators." So this story is an audit
first and a modelling task only conditionally. **Closing it with "no new assets were needed",
backed by evidence, is a legitimate and possibly the correct outcome** — it is not a story that
fails by producing nothing.

The audit runs against the kitchen as it stands once STORY-067 through STORY-076 have landed, from
both the default camera and STORY-067's kitchen framing, and against the PRD's own candidate list:
a stronger frame or light treatment for the queue wall, station-top signage where stations are
hard to tell apart, a pantry or restock callout prop, held-food shelves or warming zones, and new
dish-state models where ready/held/aging/spoiled cannot be told apart with existing food assets
plus colour and material treatment. Each candidate gets a verdict with a screenshot behind it.

Anything that does get modelled inherits a strict checklist the PRD spells out and this repo
enforces: reuse the existing production loaders and asset-catalogue workflow, match the low-poly
Copper & Thyme direction, preserve scale, pivots, naming, materials and transform conventions,
carry state variants as documented metadata rather than bespoke scene code, and validate in the
asset showcase harness *and* in a real kitchen composition. `model-asset-validation.md` is not
optional reading here: one bad vertex or material value blacks out the entire restaurant view
through the bloom pass, and `npm run check:models` is what catches it.

The PRD adds one rule that outranks the art: "Avoid visual-only state distinctions for critical
gameplay information; pair assets with durable icon, color, or text signals." A prop may make a
state prettier or more findable. It may never be the only thing that carries it.

## Acceptance Criteria

**Audit**

- [ ] A written audit lands in the repo (a story-notes section or a `docs/` note) covering each of
      the PRD's five asset candidates with a verdict — needed, or closed by existing primitives —
      and a screenshot behind each verdict, from both `DEFAULT_CAMERA` and the kitchen framing.
- [ ] The audit incorporates any legibility findings STORY-074 recorded rather than re-deriving
      them.
- [ ] If the verdict is "no new assets needed", the story closes on the audit alone. That is an
      accepted outcome and the PR says so plainly.

**If assets are authored**

- [ ] For each asset that *is* authored:
  - [ ] It loads through the existing production loader and is registered in the existing asset
        catalogue — no bespoke loading path.
  - [ ] It matches the low-poly Copper & Thyme direction (see `copper-and-thyme-integration.md`).
  - [ ] Scale, pivot, naming, materials and transform conventions match the existing cast/prop
        conventions.
  - [ ] State variants are documented metadata, not scene-code special cases.
  - [ ] `npm run check:models` passes. Run it before the PR, not after review asks.
  - [ ] License metadata exists in `assets/licenses/` if anything external was reused
        (`conventions.md`: "Every reused external asset needs license metadata").
  - [ ] It is shown in `harnesses/src/asset-showcase-harness.ts` in isolation **and** in an
        in-context kitchen composition, with a screenshot of each.
  - [ ] It is legible from both the default and the kitchen-operations cameras.

**Constraints and verification**

- [ ] No gameplay-critical state is carried by geometry alone: every state a new prop expresses is
      also carried by an icon, colour or text signal that survives the prop failing to load.
- [ ] Scene performance is unchanged or better — check against STORY-059's tab-gate/scene-perf
      work rather than assuming a few props are free.
- [ ] `npm run check` passes; client and harness builds pass.

## Notes

- **PRD sections:** "Visual asset direction" and "Blender MCP acceptance requirements", p. 12;
  rollout step 5, p. 15.
- **Dependency: this story runs last among the presentation stories.** STORY-067, 068, 069, 074
  and 075 all change what the kitchen looks like; auditing before they land measures the wrong
  kitchen. It does not block any of them.
- **`model-asset-validation.md`** is the mandatory pre-read: why one bad vertex or material value
  blacks out the whole restaurant view through the bloom pass, what `npm run check:models`
  catches, and what to do when adding a `.blend` or `.glb`.
- **`copper-and-thyme-integration.md`** covers how the adapted GLB composites into
  `RestaurantScene` and its harnesses, and where authoritative layout still lives in `shared/`.
- **STORY-063's cast export pipeline and shared loader** (merged, PR #94) is the current
  precedent for adding models through a shared loader rather than a per-asset path. Follow it.
- **This story preserves `conventions.md` Notable Pattern 11** — a prop is view layer. Nothing
  here may become a source of game state.
- **Scope note:** this story deliberately does not carry "make the kitchen look better" in
  general. Its bar is the PRD's: an *unmet readability problem*, evidenced.
