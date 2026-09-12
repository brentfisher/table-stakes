---
id: STORY-049
title: The numbers — financial/service summary and detailed scorecard
status: pending
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: null
approach_summary: null
created: 2026-09-11
updated: 2026-09-11
---

# The numbers — financial/service summary and detailed scorecard

"The numbers" category (STORY-047's navigation shell): a prioritized financial summary card, a
service-quality card, and a full detailed scorecard available on demand — replacing
`ResultsPanel.tsx`'s current flat `StatColumn` tables and score-breakdown table with the same data,
prioritized rather than dumped in full up front.

Reference: `docs/table-stakes-recap-menu.zip` → `table-stakes-menu-suite/story-screenshots/`
`06-financial-summary.png`, `07-full-scorecard.png`; `RECAP-PREVIEW.md`'s "The numbers" bullet.
See `docs/PRD-recap-screen-redesign.md` for the full slice and its constraints.

## Acceptance Criteria

- [ ] A financial summary card prioritizes net profit, revenue, and expenses (the SAME
  `result.netProfit`/`revenue`/`expenses` fields `ResultsPanel.tsx`'s `StatColumn` already
  renders), with temporary staff (`managerLedger.labor.laborExpenses`) and front-door promotion
  spend (`managerLedger.specials[].spend`, summed, or `result.specialExpenses`) shown explicitly
  as INCLUDED SUBSETS of total expenses, not additional deductions — per `06-financial-summary.png`'s
  own "Staff and promotions are included in total expenses" framing and the PRD's own worked
  example ($174.60 − $544.40 = −$369.80 must still hold with any subset breakdown shown alongside).
- [ ] A separate service-quality card shows guests served, average satisfaction, and average wait
  (`result.guestsServed`/`averageSatisfaction`/`averageWaitTimeMs`) for both this restaurant and
  the rival when `hasRival` — reusing the exact fields `StatColumn` already has, not new
  computation.
- [ ] A rival financial comparison is visible in the summary (net profit/revenue/expenses side by
  side) when `hasRival`; omitted entirely for a co-op match, matching STORY-047's own co-op
  degradation pattern.
- [ ] An "open detailed scorecard" action opens a dialog/modal with a full You/Rival comparison
  table — this can directly reuse/extend `ResultsPanel.tsx`'s existing `StatColumn` table content
  and the score-breakdown table (`selfResult.scoreBreakdown`/`penaltyBreakdown`), just moved
  behind an on-demand affordance instead of always rendered inline. Closing the dialog returns to
  whatever category was showing before it opened.
- [ ] Missing/never-computed figures are not invented — e.g. `complete.turningPoints` may be
  empty, `selfResult.managerLedger.specials` may be empty — every such case already has an honest
  empty-state message in current `ResultsPanel.tsx`; carry those forward rather than silently
  dropping the section or fabricating a placeholder.
- [ ] `npm run check` (including `build:client`) stays green.

## Notes

- Depends on STORY-047 (the category-navigation shell).
- Cites: `client/src/ui/ResultsPanel.tsx`'s `StatColumn` component and its score-breakdown
  table as the exact pre-existing data source and field list to restructure, not recompute.
- Cites: `07-full-scorecard.png`'s "Missing PDF score components and truncated later turning
  points must not be invented" cue — directly reinforces this PRD's own "verbatim from
  match_complete" constraint; a field the server never sends stays absent, not estimated.
