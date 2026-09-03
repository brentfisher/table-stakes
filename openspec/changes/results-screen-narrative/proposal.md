# Results screen with explanation layer

## Why

PRD §11 sets the bar for the results screen at "turns each match into a learning loop rather
than a black-box simulation", and §21 Milestone 4 makes it a measurable target: "most players
understand why they lost." A table of raw §11 fields does not clear that bar by itself — a
player needs to be told *which* number decided the match, not just shown all of them.

STORY-013 shipped every §11 results field (revenue, expenses, customer-segment breakdown, and
so on) but explicitly deferred the one §11 results bullet with no numeric field of its own: "Key
turning points" (see `scoring-system.js`'s own header). It also left `tieBreak` stripped from
the wire payload entirely and computed the composite score's own component breakdown only to
throw it away. This change is STORY-014: it builds the narrative layer on top of what STORY-013
already accumulates — decision reasons customer-system.js has recorded since STORY-004/013 for
exactly this purpose (Notable Pattern 9) — and ships the client screen that renders it.

## What Changes

- **`MatchResult` widened** (never renamed, per Decision 7) with four new per-restaurant
  fields: `scoreBreakdown` (the composite score's own component contributions, previously
  computed and discarded), `penaltyBreakdown` (which individual penalty term did the damage),
  `bestDish` (the player's own fastest-fulfillment dish), and `largestLossCause` (this
  restaurant's largest single §17 decision-reason loss bucket, tied to an event only when that
  event covers a real majority of the bucket's occurrences).
- **`MatchCompleteMessage` widened** with three new match-wide fields, alongside the existing
  `winnerPlayerId`: `decidingSegment` (the customer segment with the largest served-count
  differential between the two restaurants — PRD §11's own worked example), `turningPoints` (up
  to `RESULTS_TURNING_POINTS_MAX` largest swings in cumulative party-acquisition margin, each
  tied to the event window or service/final_rush phase it happened in), and `tieBreakDecided`
  (stated explicitly, only when the §11 tie-break chain — not a genuine draw — decided the
  match).
- **A new pure module**, `server/src/game/scoring/narrative.js`, computing all of the above from
  data other systems already publish — `match.districtDecisions` (customer-system.js's §17
  decision log), `district.segmentCounts`/`district.lostByReason` (customer-system.js's
  districtSummary), and `match.eventTimeline` (event-system.js) — retroactively, once, at the
  `results` transition. No new per-tick sampler exists anywhere in this change;
  `scoring-system.js` still owns no live simulation state.
- **One new server-side accumulation**: order-system.js's per-dish `dishSales` entries gain a
  running `fulfillmentMsSum`/`fulfillmentSamples` (order-placed to that dish's ticket going
  `ready`), published as a new, un-sliced `dishFulfillment` array on `orderSummary` — the only
  number in this whole change that did not already exist somewhere in the codebase.
- **`score-formula.js` gains two new exports** (`computePenaltyBreakdown`, `explainTieBreak`) as
  siblings to the existing `computePenaltyPoints`/`compareForTieBreak`/`determineWinner` —
  neither existing export's contract changes.
- **Client**: `client/src/scenes/ResultsScene.ts` (a static Three.js backdrop for the `results`
  phase — no match data reaches it, by design) and `client/src/ui/ResultsPanel.tsx` (the React
  panel that renders every field above, plus the original §11 fields, as plain-language
  sentences and a per-restaurant stat comparison). `SceneManager` gains a swappable active-scene
  reference; `GameClient`'s `match_complete` handler now stores the whole message verbatim.
- **BREAKING for nothing** — every change to `MatchResult`/`MatchCompleteMessage` is additive.
  No existing field is renamed, removed, or reinterpreted.

## Capabilities

### New Capabilities
- `results-narrative`: server-computed narrative derivation (deciding segment, best dish,
  largest loss cause, turning points, explicit tie-break statement, score/penalty breakdown)
  from already-recorded match data, and the wire fields that carry it.

### Modified Capabilities
(none — `openspec/specs/` has no archived capability yet for this repo to modify; the §12
message contract this change widens has never been formally split into its own spec)

## Impact

- `shared/schemas/messages.d.ts` (wire contract, widened)
- `shared/constants/tuning.js` / `.d.ts` (`RESULTS_TURNING_POINTS_MAX`)
- `server/src/game/scoring/score-formula.js` (two new exports)
- `server/src/game/scoring/narrative.js` (new file)
- `server/src/game/systems/scoring-system.js` (reads the new inputs, assembles the new fields)
- `server/src/game/systems/order-system.js` (per-dish fulfillment accumulation)
- `server/src/game/match.js` (`matchCompleteMessage()` widened)
- `scripts/check-scoring.mjs` (extended, not replaced — `check:scoring` is already in `npm run
  check`'s chain)
- `client/src/scenes/ResultsScene.ts` (new), `client/src/ui/ResultsPanel.tsx` (new),
  `client/src/game/SceneManager.ts`, `client/src/game/GameClient.ts`, `client/src/app/App.tsx`,
  `client/src/styles/app.css`
