---
id: STORY-052
title: Pre-reveal teaser — publish results-phase data early and shorten the dark wait
status: pending
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: true
approach_summary: >
  Confirmed directly (not assumed): `match.finalResults` is populated SYNCHRONOUSLY inside
  `scoring-system.js#onPhaseChange(match, transition)` the instant `transition.to === 'results'`
  fires (`server/src/game/systems/scoring-system.js` line ~288-391) — it exists for the entire
  20-30s the player currently stares at a dark screen. `match.js#matchCompleteMessage()` (called
  only from `#endMatch`, only once the results-phase TIMER expires) does nothing but package that
  same already-existing `match.finalResults` into the one-shot `match_complete` message — there is
  no new computation to add, only an earlier PUBLICATION point.
  SERVER CHANGE: add one new field to `Match#toSnapshot`'s existing `you` block (never top-level —
  `scripts/smoke-bot-menu.mjs`'s own check asserts the exact top-level snapshot key list, so a new
  top-level field fails a check; `you` is the one block that already varies per viewer, same
  precedent as `you.cash`/`you.revenue`): `resultsPreview: this.finalResults?.results?.
  [viewerRestaurantId] ?? null`. NEVER publish `this.finalResults` wholesale — it also carries
  `winnerPlayerId`, `turningPoints`, `decidingSegment`, and the RIVAL's own full `MatchResult`;
  shipping any of those early breaks PRD §18's privacy boundary AND reveals the outcome before
  AC2 says it may show. The disconnect-end path (`#endMatch(reason !== 'completed')` sets
  `phase = 'results'` directly, `onPhaseChange` never fires, `finalResults` stays undefined) is
  correct-by-construction here: the field is naturally null, and `match_complete` follows
  immediately in that path anyway, so there is nothing to tease. Mirror this new field into
  `shared/schemas/messages.d.ts`'s `SnapshotViewer` interface (alongside `cash`/`revenue`) and into
  `GameClientStatus` in `client/src/game/GameClient.ts` (straight off `you.resultsPreview`, same
  pattern every other `you.*` field already follows there).
  CLIENT CHANGE: new component (name your own, e.g. `RecapTeaser.tsx`), mounted in
  `client/src/app/GameView.tsx` as a SIBLING to the existing `<ResultsPanel>` mount (around its
  `status?.matchComplete ?` condition), gated `status.matchPhase === 'results' &&
  !status.matchComplete && status.resultsPreview`. The `!status.matchComplete` half is what
  guarantees the teaser and the full recap can never both render at once — no shared toggle state
  needed between them. Shows a progressive sequence of facts from the viewer's OWN
  `resultsPreview` (a real `MatchResult`) BEFORE any win/loss/draw heading — this one moment
  deliberately inverts STORY-047's normal "outcome first" order. The score tally-up is NEW logic
  (confirmed: no existing count-up/interpolator anywhere in this codebase) — build a small
  `requestAnimationFrame` or fixed-step interpolator, gated by STORY-047's ALREADY-BUILT
  `useRecapMotion()` hook (reuse it, don't reinvent a second motion gate) — jump straight to the
  final number with motion off. The tally lives ONLY in this new teaser component — do NOT touch
  `ResultsPanel`'s own hero score card, which remounts nothing on category-tab switches today and
  must stay that way (adding a tally there would re-animate on every tab click).
  DURATION CHANGE: reduce `shared/constants/tuning.js`'s `PHASE_DURATIONS_MS.prototype.results`
  (currently 20_000) and `.full.results` (currently 30_000) — pick a number long enough for the
  teaser to read at a comfortable pace, no longer, and say so in a comment. Leave `smoke.results`
  (1_200) untouched — `scripts/smoke-phases.mjs` sleeps `DURATIONS.results + 600` off that preset
  specifically. This does NOT time-box reading the recap afterward: `GameView.tsx` keeps
  `<ResultsPanel>` mounted for as long as `status.matchComplete` stays truthy, with nothing tearing
  it down on a timer — the duration only controls how soon `match_complete` (and the full recap)
  arrives. Grep for every other reader of `PHASE_DURATIONS_MS.*.results`/results-phase-derived
  `phaseEndsAtMs` assumptions before changing it (my own spot-check found 20+ files matching the
  literal `20_000`/`30_000` constants, mostly for OTHER phases' durations or unrelated `dtMs` step
  sizes in test setups — do not trust that spot-check, confirm directly which ones, if any, are
  actually results-phase reads).
  OPENSPEC: `openspec/` is already committed to this repo's `master` (`openspec/changes/<slug>/`
  each with `proposal.md`/`design.md`/`tasks.md`/`README.md`/`specs/`, no `archive/` subfolder) —
  a worktree branched from master already has it, no separate init script needed. Add a new change
  here with a Mermaid diagram in `design.md` of the actual new mechanism (the `you.resultsPreview`
  field's timing relative to `match_complete`), not a generic diagram.
created: 2026-09-11
updated: 2026-09-12
---

# Pre-reveal teaser — publish results-phase data early and shorten the dark wait

**Split 2026-09-12 from the original combined STORY-052** ("Pre-reveal teaser, win celebration,
and motion controls"). This story keeps ONLY the part the user separately reported as a real bug:
the match-end transition into results is a genuine dark, empty wait, not just a rendering artifact
STORY-034 already addressed (the "Game Over" kicker on a dim backdrop). The other half of the
original story — post-reveal win celebration, Replay Reveal, and the Motion on/off control — is
now its own story, STORY-054, because it is pure client animation/motion-toggle work with no
server dependency, a meaningfully different kind and risk of change from this story's server
protocol decision. **STORY-054 does not depend on this story** — see its own Notes for why.

Confirmed by direct investigation of the real current mechanism:

- `final_rush` ending flips `matchPhase` to `'results'` immediately, which swaps the client's
  3D backdrop to the dim `ResultsScene.ts` stage right away (`GameClient.ts`'s phase-swap call).
- Scoring itself (`scoring-system.js#onPhaseChange('results')`) runs SYNCHRONOUSLY at that same
  phase-entry instant, populating `match.finalResults` — the final numbers exist server-side from
  the very first tick of the `results` phase.
- But the client is never told. `match_complete` (the message `GameClient.ts` needs before
  `<ResultsPanel>` will mount at all) is only enqueued once the ENTIRE `results` phase's own timer
  expires and `match.js#endMatch('completed', ...)` fires — `shared/constants/tuning.js`'s
  results-phase duration: **20 seconds in the live default (`prototype`) preset, 30 seconds in
  `full`.**
- Net effect: the player stares at an empty dark stage (no recap, no score, `HudPanel` still
  showing a bare "Results" label) for a full 20-30 seconds, then the ENTIRE populated recap
  appears all at once. The data was sitting there, computed, unused, the whole time.

The user's three asks: (1) show SOME components as a building teaser before the outcome is
formally declared, rather than nothing, (2) tally the score up slowly as part of that tease, (3)
shorten the wait itself, now that dead time isn't needed to hide anything.

Reference: `docs/PRD-recap-screen-redesign.md` for the full slice and its constraints —
especially constraint 5 (every earlier story's animation must be gateable by one shared
convention STORY-047 established; this story's tally-up reuses that same gate, it does not
invent a second one).

## Acceptance Criteria

- [ ] Publish the viewer's OWN already-computed result early, under `you` on the ordinary
  `match_snapshot` (never top-level — `you` is the one per-viewer-scoped key; a new top-level
  field would also fail `scripts/check-bot-menu-smoke.mjs`'s exact-key-list assertion on the
  snapshot's shape). The exact value: `this.finalResults?.results?.[viewerRestaurantId] ?? null`,
  computed once `this.phase === 'results'` — NEVER `this.finalResults` wholesale, which carries
  `winnerPlayerId`, `turningPoints`, `decidingSegment`, and the RIVAL's own full `MatchResult`.
  Shipping any of those early would both break PRD §18's privacy boundary and reveal the outcome
  before AC2 below says it may be. A disconnect-triggered end (`#endMatch` with any reason other
  than `'completed'`) sets `phase = 'results'` directly without `onPhaseChange` ever firing, so
  `finalResults` stays undefined and this field is correctly null there — `match_complete` follows
  immediately in that path anyway, so there is nothing for a teaser to show.
- [ ] Once this field is available, the client shows a building teaser sequence during the dark
  transition — some components/facts from the viewer's OWN result appearing progressively —
  BEFORE the outcome heading (win/loss/draw) is shown. Mount this as a new component, a sibling to
  `<ResultsPanel>` in `GameView.tsx`, gated `matchPhase === 'results' && !matchComplete &&
  resultsPreview` (the `!matchComplete` half is what guarantees the teaser and the full recap
  never both render at once). This deliberately inverts today's/STORY-047's order (outcome first,
  then everything else) for this ONE moment only; the full recap (STORY-047 through STORY-051)
  still declares the outcome and shows everything once `match_complete` actually arrives.
- [ ] The final score tallies up (an animated count from 0, or from a plausible running total, to
  the real final number) as part of the tease — this is new client logic; there is no existing
  count-up/tally mechanism in this codebase to reuse (confirmed by search), so it must be built
  (a small interpolator, e.g. `requestAnimationFrame`-driven or a fixed-step timer), gated by
  STORY-047's EXISTING shared motion convention (`useRecapMotion()` — already seeded from
  `prefers-reduced-motion`, already returns an unused `setMotionEnabled` precisely so a later
  consumer like this one can read it) — no tally animation when motion is off, jump straight to
  the final number instead. This tally lives in the teaser component ONLY — do not add it to
  `ResultsPanel`'s own hero score card, which re-renders on every category tab switch and would
  re-animate the tally on every click.
- [ ] The results-phase wait itself is measurably SHORTER than today's 20s (`prototype` preset)/
  30s (`full` preset) — tune `shared/constants/tuning.js`'s `PHASE_DURATIONS_MS.prototype.results`
  and `.full.results` down, per this repo's own comment-with-reasoning convention (state what the
  new duration was chosen against — e.g. "long enough for the teaser sequence to play out at a
  readable pace, no longer"). Leave `smoke.results` (`1_200`) untouched —
  `scripts/smoke-phases.mjs` sleeps `DURATIONS.results + 600` off that preset specifically, not
  the ones being changed. Shortening this duration does not time-box READING the recap:
  `GameView.tsx` keeps `<ResultsPanel>` mounted for as long as `status.matchComplete` stays
  truthy, and nothing tears it down on a timer — the duration only controls how soon
  `match_complete` (and therefore the full recap) arrives. Grep for every other reader of
  `PHASE_DURATIONS_MS.*.results`/`phaseEndsAtMs` derived specifically from the results phase
  before changing it — do not trust a spot check; confirm directly.
- [ ] `npm run check` stays green, including any timing-sensitive existing check touched by the
  duration change.

## Notes

- Depends on STORY-047 for the shared motion-gating convention (`useRecapMotion()`) the tally
  reuses — NOT on STORY-054 (the split sibling), which this story has no dependency on in either
  direction.
- This is a server+client story, unlike the rest of this PRD's slice — `is_architectural: true`.
  `openspec/` is already committed to this repo's `master` (confirmed: `openspec/changes/*` exists
  with `proposal.md`/`design.md`/`tasks.md`/`README.md`/`specs/` per change, no `archive/`
  subfolder — decisions live directly under `changes/`), so a worktree branched from master already
  has it; no separate init step is needed the way a repo without a committed `openspec/` would
  require. Add a new change under `openspec/changes/<slug>/` following the existing structure,
  with a Mermaid diagram in `design.md` of the actual new mechanism (the new `you.resultsPreview`
  field and its timing relative to `match_complete`), not a generic diagram.
- Cites: `server/src/game/match.js`'s `advanceClock`/`#enterPhase`/`#endMatch`/`matchCompleteMessage`
  and `toSnapshot` (the `you`-scoping precedent, e.g. `you.cash`/`you.revenue`), and
  `server/src/game/systems/scoring-system.js`'s `onPhaseChange('results')` (where `finalResults`
  is actually populated) — all read directly, not assumed, before writing this story's
  `approach_summary`.
