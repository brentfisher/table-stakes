---
id: STORY-049
title: The numbers — financial/service summary and detailed scorecard
status: merged
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: story/049-recap-numbers-and-scorecard
worktree_path: /Users/brent/table-stakes-story-049
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/68
is_architectural: false
approach_summary: >
  CORRECTION to this story's own Notes: `StatColumn`/the score-breakdown table/turning-points
  section this story cites as "ResultsPanel.tsx's existing" content NO LONGER EXIST in the
  current file — STORY-047 (merged) rewrote `ResultsPanel.tsx` into a category shell and removed
  all of that old inline content, on the explicit understanding that STORY-049 (this story) and
  STORY-050 would bring it back, restructured, under their own categories. The real reference is
  `git show 5fde531:client/src/ui/ResultsPanel.tsx` (the last commit before STORY-047's rewrite,
  `5fde531` = STORY-039's merge) — read THAT version for the exact pre-existing `StatColumn`
  component, its full field list (score/revenue/expenses/labor/specials/restocking/stock-orders/
  shortage/guests/satisfaction/wait/event-performance/critic-failures/best-sellers/highest-margin/
  segments/upgrades), the score-breakdown table (`scoreBreakdown`/`penaltyBreakdown`), and the
  turning-points list (`complete.turningPoints`) — none of this is new data or new computation,
  it is the SAME content, moved into this story's two new pieces: a prioritized financial/service
  summary always visible under "The numbers," and a full detailed-scorecard dialog for everything
  else (including turning points and any manager's-ledger diagnostic detail — dominant constraint,
  kitchen-direction/specials performance — as the screenshot's own "additional management detail,
  expandable below the visible table" cue asks for). SCOPE BOUNDARY WITH STORY-050 (not yet
  built): `managerLedger.insights` (the browsable "what to change next match" takeaways) belongs
  to STORY-050's "next shift" category, not this one — do not add an insights list here even
  though the old removed code had one; this story owns financial/service NUMBERS and the
  diagnostic scorecard detail, not actionable coaching text. `is_architectural: false` — restores
  existing data under a new structure, no new snapshot field.
created: 2026-09-11
updated: 2026-09-12
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

- [x] A financial summary card prioritizes net profit, revenue, and expenses (the SAME
  `result.netProfit`/`revenue`/`expenses` fields `ResultsPanel.tsx`'s `StatColumn` already
  renders), with temporary staff (`managerLedger.labor.laborExpenses`) and front-door promotion
  spend (`managerLedger.specials[].spend`, summed, or `result.specialExpenses`) shown explicitly
  as INCLUDED SUBSETS of total expenses, not additional deductions — per `06-financial-summary.png`'s
  own "Staff and promotions are included in total expenses" framing and the PRD's own worked
  example ($174.60 − $544.40 = −$369.80 must still hold with any subset breakdown shown alongside).
- [x] A separate service-quality card shows guests served, average satisfaction, and average wait
  (`result.guestsServed`/`averageSatisfaction`/`averageWaitTimeMs`) for both this restaurant and
  the rival when `hasRival` — reusing the exact fields `StatColumn` already has, not new
  computation.
- [x] A rival financial comparison is visible in the summary (net profit/revenue/expenses side by
  side) when `hasRival`; omitted entirely for a co-op match, matching STORY-047's own co-op
  degradation pattern.
- [x] An "open detailed scorecard" action opens a dialog/modal with a full You/Rival comparison
  table — this can directly reuse/extend `ResultsPanel.tsx`'s existing `StatColumn` table content
  and the score-breakdown table (`selfResult.scoreBreakdown`/`penaltyBreakdown`), just moved
  behind an on-demand affordance instead of always rendered inline. Closing the dialog returns to
  whatever category was showing before it opened.
- [x] Missing/never-computed figures are not invented — e.g. `complete.turningPoints` may be
  empty, `selfResult.managerLedger.specials` may be empty — every such case already has an honest
  empty-state message in current `ResultsPanel.tsx`; carry those forward rather than silently
  dropping the section or fabricating a placeholder.
- [x] `npm run check` (including `build:client`) stays green.

## Notes

- Depends on STORY-047 (the category-navigation shell).
- Cites: `client/src/ui/ResultsPanel.tsx`'s `StatColumn` component and its score-breakdown
  table as the exact pre-existing data source and field list to restructure, not recompute.
- Cites: `07-full-scorecard.png`'s "Missing PDF score components and truncated later turning
  points must not be invented" cue — directly reinforces this PRD's own "verbatim from
  match_complete" constraint; a field the server never sends stays absent, not estimated.

## Implementation notes

**CORRECTION confirmed by direct reading before writing any code.** `git show
5fde531:client/src/ui/ResultsPanel.tsx` is exactly as the approach_summary describes: the full
pre-STORY-047 `StatColumn` component (score/revenue/expenses/labor/specials/restocking/stock-
orders/shortage/guests/lost-to-rival/satisfaction/wait/event-performance/critic-failures/best-
sellers/highest-margin/segments/upgrades), the manager's-ledger block (dominant constraint, temp
labor, restocking, kitchen direction + trade-off, specials performance, `insights`), the score-
breakdown/penalty-detail tables, and the turning-points list. Every field this story uses was
re-confirmed against the CURRENT `shared/schemas/messages.d.ts` (not assumed from the old file or
from this story's own prompt paraphrase) before use — `MatchResult.laborExpenses`/
`specialExpenses`/`netProfit`/`revenue`/`expenses`/`guestsServed`/`averageSatisfaction`/
`averageWaitTimeMs`/`scoreBreakdown`/`penaltyBreakdown`/`bestDish` and `ManagerLedgerResult`'s
`dominantConstraint`/`kitchen`/`specials` all still have the exact shape the old code read; only
`insights` is deliberately never touched (see scope boundary below). `MatchCompleteMessage.
turningPoints` is unchanged too, still keyed off `leaderRestaurantId`/`swing`/`eventId`/`phase`.

**Two new files, following `RecapHighlights.tsx`/`RecapMenuStars.tsx`'s own directory
convention.** `client/src/ui/recap/RecapNumbers.tsx` is the always-visible content mounted for
`category === 'numbers'` (wired into `ResultsPanel.tsx`'s router the same way STORY-048 wired
`RecapMenuStars`): a "business end" financial card (net profit headline, revenue/expenses,
temp-staff/promotion subset rows, the rival's own receipt when `hasRival`) and a "how the floor
felt" service card (guests/satisfaction/wait, plus a rival comparison sentence), matching
`06-financial-summary.png`'s layout closely. It owns one piece of state — `scorecardOpen` — and
mounts `client/src/ui/recap/RecapScorecard.tsx` (a new sibling file, not inlined into
`RecapNumbers.tsx`) only while that's true. Splitting the dialog into its own file kept
`RecapNumbers.tsx` to the always-visible content only and gave the sizeable dialog (full
comparison table + four expandable diagnostic sub-sections) its own scannable file, the same way
`RecapMenuStars.tsx` split `RecapMenuStarsContent` out for a different reason (hook-ordering
safety) — here it's pure file-size/readability, no hook constraint forced it.

**AC4 "closing returns to whatever category was showing before it opened" is automatic, not
implemented state.** `ResultsPanel.tsx`'s own `category` state (`useState<RecapCategory>`) is
never touched by opening or closing the scorecard — `RecapScorecard` is a conditionally-mounted
child of `RecapNumbers`, so closing it just unmounts that subtree. There was no "remember and
restore the previous category" logic to write because the category was never left in the first
place.

**Dialog pattern reused from `HowToPlay.tsx`/`SettingsPanel.tsx`/`PlayVsBotScreen.tsx`, confirmed
identical across all three before assuming it, not just the one file grepped first.** All three
share exactly: `role="dialog"` + `aria-modal="true"` + `aria-labelledby`, a backdrop `div` with
`role="presentation"` and `onClick={onClose}`, `stopPropagation` on the card itself so a click
inside doesn't bubble to the backdrop, an Escape-key listener via `useEffect`, and a close `×`
button — none of the three do any focus-on-mount or focus-trap beyond that (checked
`SettingsPanel.tsx`/`PlayVsBotScreen.tsx` specifically, not assumed from `HowToPlay.tsx` alone,
since a real focus-management convention would have been worth matching too). `RecapScorecard.tsx`
reproduces exactly this behavior. It does NOT reuse the literal `.menu-modal*` CSS classes,
though: those are the app's one dark theme, and `.recap` is deliberately the app's one bright
surface (`app.css`'s own comment on why `--recap-*` tokens are scoped, not shared) — this dialog
gets its own `.recap-scorecard-*` rules built on the same `--recap-*` custom properties instead,
so it visually belongs to "the numbers" card layout rather than looking like a menu popup dropped
onto a bright screen.

**AC1 — a real bug caught before it shipped: two different accumulation paths for the same
number.** The first draft read temp-staff/promotion spend from `managerLedger.labor.
laborExpenses` and a locally re-summed `managerLedger.specials[].spend` reduce in
`RecapNumbers.tsx`, while `RecapScorecard.tsx`'s main table read the top-level `result.
laborExpenses`/`result.specialExpenses` fields for the identically-labeled rows. Both paths
happen to agree today (`scoring-system.js` derives the top-level fields FROM the ledger's own
recorded costs), but that is exactly the kind of "two call sites, one accidental invariant" this
codebase's own "verbatim from match_complete" discipline exists to prevent — if the two paths
ever diverged, the always-visible card and the dialog one click away would silently disagree
about the same dollar figure, and nothing in `tsc --noEmit` or any existing check would notice
(both are valid `number` values). Caught in review before commit: both files now read the same
`result.laborExpenses`/`result.specialExpenses` top-level fields — the ones `check-scoring.mjs`
already asserts sum correctly into `expenses` (`p1.expenses === 150 + 50 + 100 + 25 &&
p1.specialExpenses === 25`, `netProfit === revenue - expenses`) — and the local `specialSpend`
reduce was deleted from `RecapNumbers.tsx` entirely, since it was the only derived arithmetic
this story had.

**SCOPE BOUNDARY WITH STORY-050, decided and applied consistently.** `managerLedger.insights` is
never imported, read, or rendered by `RecapNumbers.tsx` or `RecapScorecard.tsx` — grepped both
files to confirm before calling this done. Everything else the old `StatColumn`/manager's-ledger
block held is treated as fair game per the task's own framing ("the old `insights` array
specifically is the one clear STORY-050 boundary"), with one deliberate exception:
`bestSellingDishes`/`highestMarginDishes` are NOT repeated in the scorecard even though old
`StatColumn` showed them, because `PRD-recap-screen-redesign.md`'s "Why" section explicitly names
both fields as STORY-048's own reuse target, and `RecapMenuStars.tsx` already gives them a richer
3D treatment — showing them a third time as plain text would be pure duplication, not a scope
gap. `customerSegmentBreakdown` and `upgradesPurchased`, by contrast, have no other owner
anywhere in this six-story slice and are named by no AC/screenshot for this story specifically —
first pass dropped them as "not asked for and this whole PRD is about prioritizing, not dumping
everything," but on reflection that reasoning only applies to the ALWAYS-VISIBLE summary, not an
opt-in disclosure a player chooses to open; leaving two real, already-computed `MatchResult`
fields rendered NOWHERE in the app is a bigger gap than a redundant list would have been. Both
now render in the scorecard's "additional management detail" `<details>`, self-restaurant only
(matching the scoping the old per-column `StatColumn` gave them), each behind its own `.length >
0`/`Object.keys(...).length > 0` honest-empty-state guard.

**AC5 — a second real bug caught: the turning-points empty state was true, but not honestly the
whole truth, for a co-op match.** `MatchCompleteMessage.turningPoints`'s own `.d.ts` comment
states it is empty both when nothing swung the match AND "on any match with other than exactly 2
restaurants" (the co-op case) — two different facts collapsed into one empty array. The first
draft's empty-state text, "No single moment swung this match enough to call out," is true in the
first case and misleading in the second: it implies a rival existed and simply never opened a
gap, when there was no rival to compare against at all. `RecapScorecard.tsx`'s turning-points
block now checks `!hasRival` first and renders "No rival to compare against this shift." for that
case, falling through to the original sentence only when `hasRival` is true and the array is
still empty. This is the same PRD constraint 3 (co-op degrades honestly) every other recap section
already respects, applied to one more place it had been missed.

**`catalogue.ts` extended, not re-declared per-file.** The old `ResultsPanel.tsx`'s inline
`EVENT_TITLES`/`SPECIAL_NAMES`/`KITCHEN_FOCUSES`/`CONSTRAINT_LABELS` maps and
`SEGMENT_NAMES`/`UPGRADE_INFO` maps are now `eventTitle`/`specialName`/`kitchenFocus`/
`constraintLabel`/`segmentName`/`upgradeName`/`upgradeInfo` exports from `client/src/ui/recap/
catalogue.ts` (STORY-047's shared static-lookup module, previously holding only `dishName`) —
`RecapScorecard.tsx` imports all seven rather than re-declaring any of them, keeping this one
file the sole place a recap section resolves a catalogue id to a display name, per that file's
own header rationale.

**No new `check-*.mjs` script**, following STORY-042/045/047's precedent for client-rendering-only
stories in this codebase. This story's only candidate for new pure logic — the temp-staff/
promotion "included subset" framing — turned out to need no derivation at all once the AC1 bug
above was fixed: both display sites read pre-computed top-level `MatchResult` fields directly,
with zero arithmetic of this story's own. `build:client`'s `tsc --noEmit` is the whole
verification surface for the new/changed TSX, exactly as STORY-048's own notes argue.

**Verification.** `npm run install:all` in the fresh worktree, then `npm run build:client` (`tsc
--noEmit` + `vite build`) clean, `npm run build:harnesses` clean, and the full `npm run check`
(every `check-*.mjs` plus both smokes) exits 0. The worked-arithmetic AC1 claim is verified by
`check-scoring.mjs` (67/67 passing), not a new assertion: `p1.netProfit === 1000 - (150 + 50 +
100 + 25) && p1.netProfit < p1.revenue` together with `p1.expenses === 150 + 50 + 100 + 25 &&
p1.specialExpenses === 25` is exactly "revenue minus expenses equals net profit, with the labor/
special subsets summing to no more than total expenses," just at different literal numbers than
the PRD's own $174.60/$544.40/−$369.80 example (never copied into code or comments here, per the
PRD's own "never copy this fixture's specific numbers" instruction). `check:manager-ledger`
(10/10) separately covers the `managerLedger.specials[]`/`labor` shapes this story's dialog
renders. **No live-render/screenshot verification was attempted, stated as a deliberate choice
rather than an environment limitation**: unlike STORY-048's WebGL content, nothing in
`RecapNumbers.tsx`/`RecapScorecard.tsx` is rAF-driven or otherwise needs a live paint to confirm
correctness — every value is a direct field read or a plain conditional, so a clean `tsc --noEmit`
against the real `MatchResult`/`MatchCompleteMessage` shapes plus a careful line-by-line read of
both new files against `messages.d.ts` was judged sufficient, matching STORY-042/045's own
precedent for this class of story rather than STORY-047's heavier temporary-harness treatment
(which that story needed because it was the shell/nav mechanism itself, a higher-risk surface).
