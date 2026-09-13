---
id: STORY-055
title: Fix results-screen outcome mismatch (loss heading, win somewhere else)
status: pr-opened
prd_source: null
branch: story/055-results-outcome-mismatch
worktree_path: /Users/brent/table-stakes-worktrees/story-055-results-outcome-mismatch
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/78
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

- [x] The exact contradictory label/screen is reproduced and identified concretely (quote it, name
  the file/line producing it) before any fix is written.
- [x] Root cause is identified and explained (not just patched around) — is it a display bug (two
  different values shown as if they were the same fact), a data bug (server disagrees with
  itself), or a user-legible-but-ambiguous label being misread as the overall outcome?
- [x] After the fix, every recap category (Highlights, Numbers, Scorecard, Menu Stars, Next Shift,
  Arrange) is consistent with the single authoritative `outcome` (win/loss/draw) for the match —
  no screen states or implies the opposite result.
- [x] If the root cause turns out to be a genuinely ambiguous but not-technically-wrong label (e.g.
  a per-category "you led on X" badge that isn't the same thing as the overall winner), it is
  reworded or visually distinguished so it can't be mistaken for the overall outcome, rather than
  removed outright (unless removal is clearly the right call — implementer's judgment, explained).
- [x] `npm run check` stays green; add a falsified check if the root cause is server-side scoring
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

## Implementation notes

### Reproduction (server-side, real production code path)

The pre-existing static reading (`approach_summary`) was correct: `ResultsPanel.tsx`'s single
`outcome` value is genuinely threaded everywhere, and no second win/loss ternary exists anywhere
in `client/src/ui/recap/*.tsx`. The contradiction lives one level down: in the **detailed
scorecard's "Key turning points" list**, which reads real match data but presents it in a way
that can flatly disagree with the outcome heading.

Reproduced with a script built on the exact same harness pattern `scripts/check-scoring.mjs`
already uses (a real `Match`, the real `customerSystem`/`orderSystem`/`upgradeSystem`/
`scoringSystem`, `district` decisions and score-determining fields forced onto internal state the
same way that script's own `forceDistrictDecisions`/`forceOrderLedger`/`forceDistrictView`
helpers do) — not guessed from reading code. Setup: restaurant `p1` (self) wins the first 6
district decisions outright (a big early swing, no rival competition at all), then restaurant
`p2` sweeps the next 4 late in the match; `p2` also has far better revenue/satisfaction/
reputation, so `p2` wins on composite score. Real output:

```
p1 (self) score: 164.21   p2 (rival) score: 758.46
winnerPlayerId: p2   →  client outcome for p1 = 'loss'  →  heading = "You lost"
turningPoints (server, ranked by swing desc):
  [{ leaderRestaurantId: 'p1', swing: 5, phase: 'service' }, { leaderRestaurantId: 'p2', swing: 4, phase: 'final_rush' }]
Pre-fix RecapScorecard.tsx would render as the FIRST, most prominent bullet:
  "You pulled ahead by 5 parties."
```

**Exact contradiction** (`client/src/ui/recap/RecapScorecard.tsx`, "Key turning points" list,
inside the "Additional management detail" disclosure of the detailed scorecard dialog, reached
via "The numbers" → "Open detailed scorecard"): under a "You lost" heading, the top bullet read
"You pulled ahead by 5 parties" — exactly the reported "I lost ... but when you dig in, it says I
won."

### Root cause

`computeTurningPoints` (`server/src/game/scoring/narrative.js`) is working exactly as designed —
its own header says it ranks "the largest swings ... ", nothing about "the ones that decided the
match." The bug is downstream: `RecapScorecard.tsx` rendered every point as an unqualified
"{You/Your rival} pulled ahead by N parties," with:
1. **No ranking caveat** — points are sorted by swing MAGNITUDE, not chronologically and not by
   which side actually won, so a single lopsided EARLY swing belonging to the eventual LOSER can
   easily outrank the smaller swings that actually decided the match, landing as the first,
   loudest bullet under the opposite heading.
2. **A factual overstatement, caught in review before shipping, not after**: my first fix kept
   "pulled ahead"/"led by" wording. A stronger reviewer (`advisor`) caught that `swing`/
   `leaderRestaurantId` are a WINDOWED DELTA — `narrative.js`: `swing = margin - previousMargin`,
   the CHANGE in cumulative party-acquisition margin across one window, not a standing lead. A
   restaurant can gain ground in one window while trailing the whole match; "pulled ahead"/"led
   by" asserts a standing lead that was never computed. This is genuinely
   `client/src/ui/recap/RecapScorecard.tsx` — **a display bug**: real, correctly-computed server
   data (a windowed delta) rendered as if it were a different, more final fact (a standing lead,
   or the outcome itself) — not a data bug and not server-side scoring logic, so no
   `check-scoring.mjs` change was warranted.

Verbatim before → after, checked against the real repro's own data (`p1` self, real loss):
- Before: `"You pulled ahead by 5 parties."` (asserts a standing lead; contradicts "You lost")
- After: `"You won 5 more parties than your rival in service — but the match still ended the
  other way."` (states the real, narrower fact — a windowed delta — and explicitly flags that it
  did not decide the match)

### The fix

`shared/game-logic/turning-point-outcome.js` (+ `.d.ts`) — plain-JS-plus-`.d.ts`, same precedent
`recap-highlights.js` set (Decision 4) — exports `turningPointFavoredWinner(leaderIsSelf,
outcome)`: true when a turning point's windowed swing direction favored the side that also won
the match, reusing `ResultsPanel.tsx`'s own already-authoritative `outcome` rather than
re-deriving a winner id (a second, independently-computed win/loss value anywhere on this screen
is the exact failure mode this story exists to close). `RecapScorecard.tsx` now:
- Prefaces "Key turning points" with a one-line ranking caveat ("ranked by size, not by which one
  decided the final result above").
- Renders each bullet as "{You/Your rival} won N more {party/parties} than {other} during/in
  {context}", never "ahead"/"led" — an accurate windowed-delta statement that can't be misread as
  a standing lead or the outcome.
- Appends "— but the match still ended the other way." only when `turningPointFavoredWinner` is
  false (visually distinguished too, via `.recap-scorecard-turning-point--against-outcome`,
  reusing the screen's own `--recap-loss` color) — never claims a swing "held," since nothing
  here ever asserted a lead in the first place.
- `outcome` is threaded `ResultsPanel.tsx` → `RecapNumbers.tsx` → `RecapScorecard.tsx` (new prop
  on each), the same value already driving the heading/mascot/arcade stage.

### A second, adjacent bug found LIVE (not scripted) — silent tie-break

While verifying the fix by actually playing a real match in a browser (dev bot match, `smoke`
phasePreset, server+client run from this worktree), a genuinely different results-screen
inconsistency turned up organically: the match ended "You won" with the hero score card showing
**"53.8 vs 53.8"** — an apparently tied score under a decisive heading, with nothing on screen
explaining why. Server log for that match: `[scoring] tie-break decided on netRevenue`. The two
composite scores were EXACTLY equal; `determineWinner` (`score-formula.js`) correctly fell
through to the §11 tie-break chain and picked a winner on net revenue. `MatchCompleteMessage
.tieBreakDecided` exists on the wire specifically for this (`messages.d.ts`'s own comment: PRD
§11 "state tie-break resolution explicitly rather than silently") — but `grep -rn "tieBreak"
client/src` before this fix returned only the type declaration itself. No component ever read
it. The PRD's own explicit anti-silence requirement was unmet, and the practical consequence is
exactly the same FAMILY of bug as the reported one: a results-screen fact left unexplained,
inviting the reader to conclude the numbers don't add up.

Fixed in `client/src/ui/ResultsPanel.tsx`'s hero score card (`client/src/ui/recap/format.ts`'s
new `tieBreakCriterionLabel`): when `complete.tieBreakDecided` is set, a small note now reads
"Scores tied exactly — decided by net revenue." (or whichever of the four §11 criteria decided
it). A second, narrower branch (advisor-caught before shipping) covers the case
`tieBreakDecided` does NOT reach: two genuinely UNEQUAL raw scores that both round to the same
`formatPoints` string (e.g. 700.04 vs 700.06 both display "700.0") — `determineWinner` compares
raw scores directly, so no tie-break chain runs and `tieBreakDecided` stays null, but the card
would still show an apparently-tied score with no explanation. That branch is gated on the
*formatted strings* matching (a display-level fact), not the raw scores, and reads "Too close to
call at this precision — {you/your rival} finished ahead by less than 0.1."

Live-verified in a real browser (two separate dev-bot `smoke`-preset matches, `room_0001`/
`room_0002`, server+client started from this worktree): the "Scores tied exactly — decided by net
revenue." note rendered correctly under "You won" / "53.8 vs 53.8" in both matches. The
near-tie-but-unequal branch was verified only via a standalone precision check
(`formatPoints(700.04) → "700.0"`, `formatPoints(700.02) → "700.0"`, raw values unequal, note
condition fires; `formatPoints(700.0)`/`formatPoints(700.0)`, raw values equal, condition
correctly stays silent — that case is genuine-tie territory already covered by the
`tieBreakDecided` branch or an honest 'draw'), not observed live (no real match naturally landed
there during testing).

### What was verified, and how (measure, don't assert)

- **Server-side repro of the exact reported contradiction**: via the real `Match`/
  `customerSystem`/`orderSystem`/`scoringSystem`/`narrative.js` code path (not a guess, not a
  read-only trace) — see "Reproduction" above.
- **`turningPointFavoredWinner`**: 6 unit assertions in `scripts/check-recap-turning-points.mjs`
  (self-led-but-lost, rival-led-and-won, both directions of a win, both directions of a draw).
  Falsified: broke it to `return true` unconditionally → 4/6 FAIL, exit 1; restored → 6/6 pass,
  exit 0.
- **TypeScript**: `npm run build:client` (`tsc --noEmit && vite build`) green after every change.
- **Full suite**: `npm run check` green at exit 0 (zero `FAIL` lines) after all changes, including
  `build:client`/`build:harnesses` and every existing `check:*` script.
- **Live browser pass** (real server + real Vite dev client, both started from this worktree; two
  dev-bot matches via `POST /api/dev/match {bot:true, phasePreset:"smoke"}`, joined via
  `?room=<id>`): confirmed the hero heading/score card/tie-break note, and walked every recap
  category — The highlights, Next shift, Menu stars, The numbers (including opening the detailed
  scorecard dialog and expanding "Additional management detail"), and Arrange — all rendered
  correctly and consistently with the "You won" outcome. **Caveat, stated plainly**: `smoke`
  preset (~8s total) is too fast for any customer to arrive and choose a restaurant, so both live
  matches had zero district decisions and an EMPTY `turningPoints` array — the live pass confirms
  the "Key turning points" empty state ("No single moment swung this match enough to call out.")
  and the surrounding JSX/CSS structure render correctly, but did **not** render the populated,
  reworded caveat bullet itself in a browser. That specific branch's correctness rests on the
  server-side production-code repro above plus the 6 unit assertions plus `tsc`, not on a browser
  screenshot — a populated `turningPoints` array needs real customer district decisions, which
  needs the `prototype` phasePreset's ~4.5-minute real-time match length, judged disproportionate
  to run live for a pure-function-plus-JSX-branch change already covered by the other three
  verification layers.
- Confirmed no cross-session contamination: `git status` in this worktree never showed
  `EventBanner.tsx`/`HudPanel.tsx`/`KitchenCommandBoard.tsx`/`CommandScorecard.tsx` (files known
  to be mid-edit in the main checkout by a different, concurrent session) at any point.
- `node_modules` symlinks (added for local `npm run check`) removed before commit; `git status`
  confirmed clean of them.
