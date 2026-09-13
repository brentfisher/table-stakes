---
id: STORY-055
title: Fix results-screen outcome mismatch (loss heading, win somewhere else)
status: approved
prd_source: null
branch: story/055-results-outcome-mismatch
worktree_path: null
base_branch: master
pr_url: null
is_architectural: false
approach_summary: >
  Reported: "I lost on the final menu, but when you dig in, it says I won." Investigated the
  obvious candidates before assuming any of them is the cause — none is confirmed yet, so this
  story's first job is REPRODUCTION, not a guess-fix. Ruled out by direct reading: `ResultsPanel
  .tsx`'s `outcome` (line ~141-142, `complete.winnerPlayerId === null ? 'draw' : complete
  .winnerPlayerId === selfId ? 'win' : 'loss'`) is computed exactly once and threaded as the SAME
  value into the outcome heading (`outcomeHeading`, line ~153), `RecapMascot`, and
  `RecapArcadeStage` (which itself never invents its own outcome — it only reveals the prop it's
  given, per its own "Presentation only" comment) — no second, independently-computed win/loss
  exists in `RecapNumbers.tsx`, `RecapScorecard.tsx`, or `RecapHighlights.tsx` (grepped for a
  local `score >`/`beat`/`ahead of` comparison; none found). `selfId` (`status.restaurantId ??
  status.playerId`) is compared against `winnerPlayerId`, which despite its name is actually a
  RESTAURANT id (`scoring-system.js` line ~327, `determineWinner([{restaurantId: aId, ...},
  {restaurantId: bId, ...}])`) — so the comparison is apples-to-apples in the normal case where
  `status.restaurantId` is populated; only degrades to a real mismatch if `status.restaurantId` is
  ever null for a seated player in a real (non-dev, 2-restaurant) match, which is itself worth
  checking. REPRODUCE FIRST: play (or script, via a bot match / `check-scoring.mjs`-style harness)
  a real match to a clear, unambiguous loss, then open every recap category — Highlights, Numbers,
  Scorecard, Menu Stars, Next Shift, Arrange — and find the EXACT screen/label that disagrees with
  the top-line "You lost" heading, screenshotting or quoting it verbatim before writing any fix.
  Once reproduced, trace that specific label back to its data source and root-cause it (candidates
  worth checking once you have a concrete repro: a per-category or per-segment "you led here" chip
  inside Scorecard/Numbers being misread as the overall outcome; a rounding/formatting mismatch
  between the score `determineWinner` actually compared and the score displayed; or a genuine
  server-side scoring bug in `buildRestaurantResult`/tie-break resolution). Do not ship a fix for
  an unreproduced guess — if reproduction fails after a good-faith effort (e.g. several forced
  bot-match losses all show consistent, correct results everywhere), report that honestly with
  what was tried rather than fabricating a fix.
created: 2026-09-12
updated: 2026-09-12
---

# Fix results-screen outcome mismatch (loss heading, win somewhere else)

Reported: "I lost on the final menu, but when you dig in, it says I won." This is a correctness/
trust bug in the results screen — the single most important property of a competitive scoring
screen is that it never contradicts itself about who won. Treated as highest priority among this
batch of reports for that reason.

Initial investigation (see `approach_summary`) did not find an obvious, already-confirmed root
cause by static reading alone — `ResultsPanel.tsx` threads one `outcome` value everywhere it
appears to matter. This story requires **reproducing the actual disagreement first**, then fixing
whatever concrete thing is found, rather than patching a plausible-sounding guess.

## Acceptance Criteria

- [ ] The exact contradictory label/screen is reproduced and identified concretely (quote it, name
  the file/line producing it) before any fix is written.
- [ ] Root cause is identified and explained (not just patched around) — is it a display bug (two
  different values shown as if they were the same fact), a data bug (server disagrees with
  itself), or a user-legible-but-ambiguous label being misread as the overall outcome?
- [ ] After the fix, every recap category (Highlights, Numbers, Scorecard, Menu Stars, Next Shift,
  Arrange) is consistent with the single authoritative `outcome` (win/loss/draw) for the match —
  no screen states or implies the opposite result.
- [ ] If the root cause turns out to be a genuinely ambiguous but not-technically-wrong label (e.g.
  a per-category "you led on X" badge that isn't the same thing as the overall winner), it is
  reworded or visually distinguished so it can't be mistaken for the overall outcome, rather than
  removed outright (unless removal is clearly the right call — implementer's judgment, explained).
- [ ] `npm run check` stays green; add a falsified check if the root cause is server-side scoring
  logic (per house convention, any non-trivial derivation gets an assertion).

## Notes

- Not part of any PRD slice (`prd_source: null`) — a standalone correctness bug report.
- Cites: `client/src/ui/ResultsPanel.tsx` (`outcome`, `outcomeHeading`, `selfId`), `client/src/ui/
  recap/RecapArcadeStage.tsx` ("Presentation only" comment), `server/src/game/systems/
  scoring-system.js` (`determineWinner`, `winnerPlayerId` semantics — it's a restaurantId despite
  the name), `server/src/game/scoring/score-formula.js` (score computation, worth checking for a
  rounding/formatting mismatch between the compared value and the displayed one).
- If reproduction points at the server's scoring/tie-break logic rather than a client display bug,
  that's still in scope for this story — don't artificially restrict the fix to the client just
  because the report came from the results screen.
