## 1. Wire contract

- [x] 1.1 Add `resultsPreview` to `Match#toSnapshot`'s `you` block in
      `server/src/game/match.js`: `this.finalResults?.results?.[viewerRestaurantId] ?? null`
- [x] 1.2 Mirror `resultsPreview` into `SnapshotViewer` in `shared/schemas/messages.d.ts`,
      alongside `cash`/`revenue`
- [x] 1.3 Mirror `resultsPreview` into `GameClientStatus` in `client/src/game/GameClient.ts`,
      straight off `you.resultsPreview`, following the existing `you.*` -> `status.*` pattern

## 2. Server-side verification

- [x] 2.1 Extend `scripts/check-scoring.mjs` (already in `npm run check`'s chain): null before
      scoring runs; populated straight off the viewer's own restaurant once scoring runs;
      matches `match.finalResults.results[viewerRestaurantId]` exactly; never equals the rival's
      own slice; never carries `winnerPlayerId`/`decidingSegment`/`turningPoints`/
      `tieBreakDecided`; never appears at the snapshot's top level; stays null on the
      disconnect-triggered end path
- [x] 2.2 Falsify the new checks (break the lookup key, confirm the new assertions fail cleanly
      without crashing the script, restore, confirm green again)

## 3. Client teaser component

- [x] 3.1 New file `client/src/ui/recap/RecapTeaser.tsx`: reads `useRecapMotion()` directly (its
      own call, not a prop — never mounted at the same time as `ResultsPanel`, so there is
      nothing to keep in sync)
- [x] 3.2 Progressive fact reveal: a small `setTimeout` stagger showing guests served, revenue,
      and district reputation from `resultsPreview` one at a time; all at once when motion is
      disabled
- [x] 3.3 `useCountUp` — a local, `requestAnimationFrame`-driven, eased count-up interpolator
      from 0 to the real score, gated by `motionEnabled`; jumps straight to the final value when
      motion is disabled
- [x] 3.4 Mount `<RecapTeaser>` in `client/src/app/GameView.tsx` as a sibling to
      `<ResultsPanel>`, gated `matchPhase === 'results' && !matchComplete && resultsPreview`
- [x] 3.5 `client/src/styles/app.css`: `.recap-teaser*` rules, reusing the existing `.recap` root
      class and its `--recap-*` tokens/`.recap--motion-off` override rather than a parallel set

## 4. Duration tuning

- [x] 4.1 Grep the whole repo for other readers of `PHASE_DURATIONS_MS.*.results` and any
      results-phase-specific duration assumption before changing anything — confirmed the only
      real dependency is `scripts/smoke-phases.mjs`'s `DURATIONS.results + 600` sleep, fixed to
      the `smoke` preset specifically; every other `20_000`/`30_000` literal found in the repo is
      an unrelated `maxSteps` loop-guard count or a different tuning constant entirely
- [x] 4.2 Shorten `PHASE_DURATIONS_MS.prototype.results` (20s -> 7s) and `.full.results` (30s ->
      9s) in `shared/constants/tuning.js`, with an inline comment stating the exact arithmetic
      (`RecapTeaser.tsx`'s own fixed timeline) each was chosen against
- [x] 4.3 Leave `PHASE_DURATIONS_MS.smoke.results` (1.2s) unchanged

## 5. Full-suite verification

- [x] 5.1 `npm run build:client` and `npm run build:harnesses` both clean (`tsc --noEmit` +
      `vite build`)
- [x] 5.2 `npm run check:lifecycle` green — proves the shortened durations still satisfy every
      existing phase-timing assertion (all of which read `PHASE_DURATIONS_MS` dynamically, never
      a hardcoded literal)
- [x] 5.3 Full `npm run check` green end to end, including the real-socket smokes
      (`check:phases`, `check:bot-smoke`, `check:invite-lobby-smoke`, `check:bot-menu-smoke`)

## 6. OpenSpec

- [x] 6.1 `proposal.md`, `design.md` (with Mermaid sequence diagram of the actual new
      `resultsPreview`/teaser/`match_complete` timing), `tasks.md` (this file),
      `specs/recap-pre-reveal-teaser/spec.md`, `README.md`
