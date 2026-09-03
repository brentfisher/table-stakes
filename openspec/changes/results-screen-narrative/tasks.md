## 1. Wire contract

- [x] 1.1 Widen `MatchResult` in `shared/schemas/messages.d.ts`: `scoreBreakdown`,
      `penaltyBreakdown`, `bestDish`, `largestLossCause`
- [x] 1.2 Widen `MatchCompleteMessage` in `shared/schemas/messages.d.ts`: `decidingSegment`,
      `turningPoints`, `tieBreakDecided`
- [x] 1.3 Add `RESULTS_TURNING_POINTS_MAX` to `shared/constants/tuning.js` and its `.d.ts`
      sibling

## 2. Pure math

- [x] 2.1 `server/src/game/scoring/score-formula.js`: add `computePenaltyBreakdown` (sibling to
      `computePenaltyPoints`, same inputs, per-term output)
- [x] 2.2 `server/src/game/scoring/score-formula.js`: add `explainTieBreak` (sibling to
      `compareForTieBreak`, names the first differing criterion instead of a signed comparator)
- [x] 2.3 New file `server/src/game/scoring/narrative.js`: `toEventWindows`, `eventAt`,
      `pickDecidingSegment`, `pickBestDish`, `pickLargestLossCause`, `computeTurningPoints` — all
      pure, no `match` knowledge, no live state

## 3. One new server-side accumulation

- [x] 3.1 `server/src/game/systems/order-system.js`: `dishSales` entries gain
      `fulfillmentMsSum`/`fulfillmentSamples`, accumulated in `deliverOrder` from
      `ticket.readyAtMs - order.placedAtMs`
- [x] 3.2 `orderSummary`'s `results`-transition builder emits a new, un-sliced `dishFulfillment`
      array (existing `bestSellingDishes`/`highestMarginDishes` untouched)

## 4. Scoring-system wiring

- [x] 4.1 `buildRestaurantResult` destructures `components` from `computeCompositeScore` and
      calls `computePenaltyBreakdown`, `pickBestDish`, `pickLargestLossCause`
- [x] 4.2 `onPhaseChange('results')` builds `eventWindows` once, computes match-wide
      `decidingSegment`/`turningPoints`/`tieBreakDecided`, and stores all three on
      `match.finalResults` alongside the existing `winnerPlayerId`/`results`
- [x] 4.3 `match.js#matchCompleteMessage()` widened with the same three fields, falling back to
      `null`/`null`/`[]` on the pre-existing disconnect path

## 5. Server-side verification

- [x] 5.1 Extend `scripts/check-scoring.mjs` (already in `npm run check`'s chain) rather than add
      a new script: score/penalty breakdown sums, best-dish selection, largest-loss-cause
      majority rule, deciding-segment differential, turning-point ranking and event/phase
      tagging, explicit tie-break (including rung ORDER, not just outcome), and the disconnect
      fallback for all three new match-wide fields
- [x] 5.2 Falsify each new assertion individually (break the code, confirm the check fails,
      restore) — see the story's commit history for the falsify/restore pairs
- [x] 5.3 Full `npm run check` green (565 assertions, 0 failures) after every change

## 6. Client

- [x] 6.1 `client/src/scenes/ResultsScene.ts`: static Three.js backdrop, no props, no match data
- [x] 6.2 `client/src/game/SceneManager.ts`: add `results` scene instance and
      `setActiveScene('results' | 'other')`
- [x] 6.3 `client/src/game/GameClient.ts`: `GameClientStatus.matchComplete` stores the whole
      `match_complete` payload verbatim; `handleMessage` patches it and calls
      `scene.setActiveScene(...)` on the phase transition
- [x] 6.4 `client/src/ui/ResultsPanel.tsx`: renders every §11 field plus the narrative sentences,
      turning points, score/penalty breakdown, and a rematch button — every number sourced from
      `status.matchComplete`, name lookups only from static catalogue JSON
- [x] 6.5 `client/src/app/App.tsx`: mount `ResultsPanel` when `status.matchComplete` exists (not
      gated on `matchPhase === 'results'`, to cover the disconnect path too)
- [x] 6.6 `client/src/styles/app.css`: `.results` full-bleed overlay + regions, matching the
      existing `.setup` pattern
- [x] 6.7 `npm run build:client` and `npm run build:harnesses` both clean (`tsc --noEmit` +
      `vite build`)

## 7. OpenSpec

- [x] 7.1 `proposal.md`, `design.md` (with Mermaid data-flow diagram), `tasks.md` (this file),
      `specs/results-narrative/spec.md`
