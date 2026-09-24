---
type: Story
id: STORY-073
title: Held-food freshness, decay and waste, with explicit visible rules
description: Age held prep stock through a stated hold window into a quality-reduced and then discarded state, with the thresholds authored as tuning constants and published rather than hidden.
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

# Held-food freshness, decay and waste, with explicit visible rules

PRD Story 5 permits, and constrains, the downside half of speculative prep: "The system may apply
hold-time decay, waste, freshness penalties, or an eventual discard state, but these rules must be
explicit and visible." Without it, prep is free — the p. 9 balancing table's "Risk if demand does
not arrive" and "Higher waste or freshness downside" trade-offs have no mechanism behind them, and
the strategic decision the PRD is built around collapses into "always fill every station."

This story adds that mechanism to the held-food store STORY-072 creates. Held stock ages from its
completion timestamp through a fresh window, into an aging window where it still fulfils orders
but carries a quality cost, and eventually into discard. Every boundary is an authored constant in
`shared/constants/tuning.js` with a docstring explaining its value — the house style
`conventions.md` describes ("tuning-constant docstrings now routinely explain *why* a number is
what it is") and the PRD's own "explicit" requirement, which is a requirement about the code and
the wire as much as about the UI.

"Visible" is the other half, and it is split deliberately. This story publishes the freshness
state on the viewer's own snapshot slice in a form the player can be shown — a qualitative band
plus the time remaining in the current one — and STORY-074 renders it. Publishing a raw decay
multiplier and letting the client threshold it would violate `conventions.md` Notable Pattern 10
and PRD Story 7's prohibition on exposing simulation math.

What the quality penalty actually costs needs a decision, and the honest options differ a lot in
blast radius. A satisfaction penalty on the served order touches `customer-system.js` (1,824
lines, the largest module) and through it scoring; a pure discard model touches nothing but the
held store. This story should take the smallest mechanism that makes the trade-off real and say
in its own notes what it deliberately left out — the same discipline Decision 37 used when it
documented `ingredientCostMultiplier` as unwired rather than inventing a consumer for it.

## Acceptance Criteria

**Decay model**

- [ ] Held-food records age from their completion timestamp through named windows defined in
      `shared/constants/tuning.js` in a new block, each constant carrying a docstring with its
      reasoning and an `Ms` suffix.
- [ ] Aging is driven by match time on the normal tick, not wall-clock, so a seeded match stays
      reproducible (`conventions.md` Notable Pattern 4 / Decision 18's determinism contract).
- [ ] Held stock past the discard threshold is removed and recorded as waste, and the waste count
      is retrievable per restaurant for STORY-079's telemetry to aggregate.
- [ ] A quality penalty applies to an order fulfilled from aging stock, and what it costs is
      stated in one place with its reasoning. If a cost path is deliberately not wired, say so
      explicitly in the code rather than leaving a dead constant.

**Publishing**

- [ ] The viewer's own snapshot carries a qualitative freshness band per held item plus time
      remaining in the current band — never a raw decay multiplier or threshold number
      (`conventions.md` Notable Pattern 10).
- [ ] Freshness state is published under `you` only, matching STORY-072's held-food scoping.
- [ ] Decay never removes stock that is already assigned to an order — an assigned dish completes
      its service; only unassigned held stock ages out.

**Verification**

- [ ] A `scripts/check-*.mjs` steps a `Match` past each boundary and asserts: stock fulfils orders
      while fresh, still fulfils while aging with the penalty applied, and is gone after discard;
      and that an assigned dish is never discarded out from under its order.
- [ ] The check is falsified before it is trusted (disable the discard sweep; confirm failure;
      restore). Say so in the PR body.
- [ ] Balance is **measured, not asserted**: report the actual waste rate across at least three
      full seeded matches with a plausible prep pattern, and report it even if it looks wrong
      (`conventions.md` Testing rule 3, and `measure-district-crowd-density.mjs` as the model).
- [ ] `npm run check` passes.

## Notes

- **PRD sections:** Story 5 requirements and acceptance criteria, pp. 8-9, especially "these rules
  must be explicit and visible" and "A player receives clear feedback when prep expires, loses
  quality, or blocks needed capacity"; the balancing-principles table on p. 9.
- **Dependency: STORY-072 must land first** — there is no held-food store to age without it.
  **STORY-074 depends on this story** for the freshness band it renders, but can ship the other
  three prep states without it.
- **This story extends Decision 37 (`openspec/changes/ingredient-inventory-and-restocking/
  design.md`)** in spirit, not in fact: that decision documented `ingredientCostMultiplier` as
  having no consumer rather than inventing one, and explicitly preferred saying so. Apply the same
  rule here to any quality-penalty path this story decides not to wire.
- **This story preserves Decision 18 / `conventions.md` Notable Pattern 4** — determinism. Decay
  must not introduce a wall-clock read or an unseeded draw; if it needs randomness at all, it uses
  `match.createRngStream(name)` with its own named stream.
- **`conventions.md` Open Balance Gaps** is where an unresolved number from this story belongs if
  the measured waste rate misses its intent — report it there rather than tuning it away, the
  precedent STORY-046 set.
- **`key-files.md`:** `server/src/game/systems/customer-system.js` is the largest module and owns
  satisfaction. Touching it is allowed but is a scope decision worth stating at the kickoff gate,
  not discovering mid-implementation.
