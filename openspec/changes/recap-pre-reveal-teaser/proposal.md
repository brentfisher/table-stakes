# Pre-reveal teaser — publish results early, shorten the dark wait

## Why

When a match ends, the client's 3D backdrop goes dark immediately (`matchPhase` flips to
`'results'`), but the player sees nothing — no score, no recap — for a full 20-30 seconds,
because the server withholds the already-computed final result until its own results-phase
timer expires (`match.js#endMatch` → `matchCompleteMessage()`). Confirmed by reading the real
server code: `scoring-system.js#onPhaseChange` populates `match.finalResults` SYNCHRONOUSLY the
instant the match enters `results` — the numbers exist server-side for the entire dark wait,
just never sent. There is no new computation needed here, only an earlier, privacy-safe
publication point plus a client teaser to fill the gap it opens up.

## What Changes

- **`Match#toSnapshot`'s `you` block gains one new field**, `resultsPreview`: this viewer's own
  already-computed `MatchResult` slice (`this.finalResults?.results?.[viewerRestaurantId] ??
  null`), available from the very first `results`-phase snapshot — well before `match_complete`
  arrives. Never `this.finalResults` wholesale: that also carries `winnerPlayerId`,
  `decidingSegment`, `turningPoints`, `tieBreakDecided`, and the RIVAL's own full `MatchResult`,
  any of which would leak the outcome early or cross PRD §18's privacy boundary. Always `null`
  under the disconnect-triggered end path (`onPhaseChange` never runs there), which is correct —
  `match_complete` follows immediately in that path, so there is nothing to tease.
- **New client component**, `RecapTeaser.tsx`: mounted as a sibling to `<ResultsPanel>` in
  `GameView.tsx`, gated `matchPhase === 'results' && !matchComplete && resultsPreview`. Shows a
  small, progressively-building sequence of facts from the viewer's own result — deliberately
  BEFORE any win/loss/draw heading, inverting STORY-047's normal "outcome first" order for this
  one moment — finishing with the final score tallying up via a new `requestAnimationFrame`
  count-up interpolator (no such mechanism existed anywhere in this codebase before this
  change). Gated by STORY-047's existing `useRecapMotion()` convention, not a second one; with
  motion off, everything appears at its final state immediately. The `!matchComplete` half of
  the gate is what guarantees this component and `<ResultsPanel>` never render at once — no
  shared toggle state needed between them.
- **`shared/constants/tuning.js`**: `PHASE_DURATIONS_MS.prototype.results` (20s → 7s) and
  `.full.results` (30s → 9s) shortened — sized against `RecapTeaser.tsx`'s own fixed sequence
  (three staggered facts, then a 1.4s score tally, finishing around 4.1s) plus a few seconds to
  read the settled number before `match_complete` swaps it out. `smoke.results` (1.2s) is left
  untouched — `scripts/smoke-phases.mjs` sleeps `DURATIONS.results + 600` off that exact preset.
- **New falsified check coverage** in `scripts/check-scoring.mjs` (already in `npm run check`'s
  chain): `resultsPreview` is null before scoring runs, populated straight off the viewer's own
  restaurant once it does, never the rival's, never carries a match-wide field, and never
  appears at the snapshot's top level.

## Capabilities

### New Capabilities
- `recap-pre-reveal-teaser`: the server's early, per-viewer-scoped publication of the
  already-computed match result during the `results` phase, and the client teaser sequence that
  consumes it before the full recap arrives.

### Modified Capabilities
(none — `openspec/specs/` has no archived capability yet for this repo to modify; the wire
contract this change widens has never been formally split into its own spec, same as
`results-screen-narrative`'s own proposal notes)

## Impact

- `server/src/game/match.js` (`toSnapshot`'s `you` block widened by one field)
- `shared/schemas/messages.d.ts` (`SnapshotViewer.resultsPreview`, new)
- `shared/constants/tuning.js` (`PHASE_DURATIONS_MS.prototype.results`/`.full.results` shortened)
- `client/src/game/GameClient.ts` (`GameClientStatus.resultsPreview`, straight off the wire)
- `client/src/ui/recap/RecapTeaser.tsx` (new)
- `client/src/ui/recap/useRecapMotion.ts` (stale STORY-052→STORY-054 comment reference fixed —
  see this change's Notable Findings)
- `client/src/app/GameView.tsx` (mounts `<RecapTeaser>` as a sibling to `<ResultsPanel>`)
- `client/src/styles/app.css` (`.recap-teaser*` rules, reusing the existing `.recap` root class
  and its `--recap-*` tokens)
- `scripts/check-scoring.mjs` (extended, not replaced)
