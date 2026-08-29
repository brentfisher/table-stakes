# Tasks — Seeded event deck

- [x] `server/src/game/systems/event-system.js` — `buildEventTimeline()` drawing from
      `match.createRngStream('events')` (Decision 18) and the active market's `eventPool`, with
      service-relative offsets anchored once at the `service` transition (Decision 20)
- [x] The PRD §9 announcement flow — `event_announce` at `activateAtMs - warningMs` carrying the
      §12 envelope with the countdown in `startsInMs`, and `warning`/`active`/`ended` entries in
      `match_snapshot.events` (Decision 24)
- [x] The §9 two-high-impact-overlap cap enforced while dealing, by swapping cards rather than
      by moving an activation out of the 30–60 s band; a pool with no admissible card throws
      (Decision 23)
- [x] `match.eventEffects` published every tick, every key neutral-defaulted, with the key set
      derived from `events.json` rather than declared in code (Decision 21)
- [x] `dishDemandMultiplier()` — strongest amplifying tag times strongest dampening tag, which
      is what keeps PRD §24's 15–40% band a property of the data (Decision 22)
- [x] `applySegmentWeightOverrides()` — Decision 12's replace-and-redistribute, resolved once
      here rather than in each consumer
- [x] `buildEventForecast()` and `match_snapshot.eventForecast` — PRD §7's setup forecast,
      ordered by id and carrying no firing time (Decision 26)
- [x] `server/src/game/systems/index.js` — one registration line in the pre-assigned slot
- [x] `server/src/game/match.js` — two lines, `events` and `eventForecast` reading optional match
      state in place of a hardcoded `[]`; no constructor change (Decision 25)
- [x] `shared/constants/tuning.js` + `.d.ts` — cadence bounds, tail margin, high-impact
      threshold and cap, ended-visible window, teaser-lead bounds, §24 demand band
- [x] `shared/schemas/messages.d.ts` — `eventForecast` on `MatchSnapshotMessage` and
      `SnapshotEventForecastEntry`; `shared/schemas/game-state.d.ts` — `ActiveEventEffects`
- [x] `scripts/check-events.mjs` + `npm run check:events`, wired into `npm run check`

## Verification

The repo has no test framework (Milestone 0 Decision 8). `npm run check` runs all of the
following; every one was run from a fresh `git clone` of the branch.

- [x] `node scripts/check-events.mjs` — 33/33. Determinism (same seed ⇒ byte-identical timeline
      across 3 markets × 2 presets × 40 seeds); the fairness contract (`events` and
      `eventForecast` byte-identical between both players on all 4,602 ticks of a match); the
      30–60 s cadence across 720 timelines; the high-impact cap across those same 720 plus a
      120-second-event stress deck that forces the enforcement path; all ten events reachable;
      the §9 announcement envelope and its lead; effect resolution for all ten events including
      the Decision 12 extensions; PRD §24's band per event and as a measured A/B run; and the
      forecast carrying no firing time
- [x] `node scripts/check-catalogue.mjs` — 38/38, unchanged
- [x] `node scripts/check-match-lifecycle.mjs` — 28/28, unchanged
- [x] `node scripts/smoke-milestone0.mjs` — 9/9, unchanged
- [x] `node scripts/smoke-phases.mjs` — 12/12, unchanged, with the event system live in the
      registration list
