---
id: STORY-052
title: Pre-reveal teaser — publish results-phase data early and shorten the dark wait
status: merged
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: story/052-recap-pre-reveal-teaser
worktree_path: /Users/brent/table-stakes-worktrees/story-052-recap-pre-reveal-teaser
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/73
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

## Implementation notes

**Real bugs caught and fixed before committing:**

- Two stale comment references survived this story's 2026-09-12 split: `client/src/ui/recap/
  useRecapMotion.ts` and `client/src/ui/ResultsPanel.tsx` both said "STORY-052 owns the Motion
  toggle control", and `client/src/ui/recap/RecapMenuStars.tsx` said the same about wiring
  `motionEnabled` through `FoodModelPreview`. All three predate the split and were written when
  STORY-052 was still the combined "teaser + win celebration + motion controls" story; the
  Motion toggle itself now belongs to STORY-054, not this one. Left uncorrected, a reviewer
  reading this story's own diff would find `useRecapMotion()` used but no Motion toggle shipped,
  with a comment claiming this very story owns it — confusing at best. Fixed all three to name
  STORY-054 and note the split, rather than leaving a partially-stale trail.
- Caught and reverted my own comment error before committing: an early draft of
  `RecapTeaser.tsx` claimed `reputation` was "the same number `RecapNumbers.tsx` shows in the
  full recap" — I hadn't actually checked. `RecapNumbers.tsx` doesn't show reputation at all;
  `RecapScorecard.tsx` shows `result.scoreBreakdown.reputationBonus` (a derived score
  contribution), a DIFFERENT number from the raw `result.reputation` (25-90 band) the teaser
  actually displays. Verified both fields exist and differ (`scoring-system.js`'s
  `buildRestaurantResult` keeps both on the wire), then rewrote the comment to state the real
  distinction instead of a false "matches an existing display" claim.
- The teaser's score label originally read "Your score, so far" — factually wrong, since
  `TeaserScore` tallies the DISPLAYED value toward the real, final `MatchResult.score`, which
  never changes mid-animation; only its reveal is animated. "So far" reads as "this is a partial/
  running total", which this codebase's never-fabricate convention (`narrative.js`'s own header)
  would not tolerate on the wire and shouldn't tolerate in a label either. Relabeled to "Your
  score", with a comment explaining why.

**Deliberate deviations from the approach_summary:** none of substance. The server field, its
exact expression (`this.finalResults?.results?.[viewerRestaurantId] ?? null`), the `you`-only
placement, the sibling-mount client gate, and the "no shared toggle state needed" reasoning all
match the approach_summary as written. The one addition beyond its literal text: I built a
falsified `check-scoring.mjs` extension (seven new assertions) that the approach_summary didn't
spell out in detail, since the story's own "falsify any new check" house convention and the
privacy-sensitivity of this exact field made it the obvious thing to cover, and `check-scoring.mjs`
already had the exact harness (`twoRestaurantProbe`/`finishMatch`/`forceOrderLedger`) needed to
prove it without a new script.

**Duration chosen, and the arithmetic behind it:** `PHASE_DURATIONS_MS.prototype.results`
20s → 7s, `.full.results` 30s → 9s (`smoke.results` untouched at 1.2s). `RecapTeaser.tsx`'s own
sequence is fixed and fully enumerable: three facts appear staggered 900ms apart (`REVEAL_STEP_MS`),
the third landing at t=2700ms; the score section mounts at that same instant and its own
1400ms count-up (`TALLY_DURATION_MS`) runs, settling at ~4100ms. 7s (prototype) and 9s (full)
both clear that with roughly 2.9s/4.9s left over for the settled final number to sit readable
before `match_complete` swaps the teaser out — not a guess, the exact numbers are in `tuning.js`'s
own inline comments next to each value. `full` is kept a little longer than `prototype`, matching
this file's existing ~2/3 `prototype`:`full` ratio across every other phase, though the teaser's
own pacing is identical in both presets (nothing in `RecapTeaser.tsx` reads a preset).

**What I found grepping for other `PHASE_DURATIONS_MS.*.results` readers:** confirmed directly,
not spot-checked. `grep -rn "PHASE_DURATIONS_MS"` across the whole repo turns up exactly one real
dependency on a specific `results` value: `scripts/smoke-phases.mjs` line 187-188, which sleeps
`DURATIONS.results + 600` off `PHASE_DURATIONS_MS.smoke.results` (1.2s) specifically — untouched
by this change. `scripts/check-match-lifecycle.mjs` reads `PHASE_DURATIONS_MS.prototype`/
`PHASE_DURATIONS_MS[preset]` in several assertions, but every one of them reads the CONSTANT
itself dynamically (`durations.results`, `expected[p]`, etc.), never a hardcoded `20_000`/
`30_000` literal, so it self-adjusts to whatever the constant says and needed no changes — ran it
directly after the tuning change and all 28/28 checks stayed green. Every OTHER `20_000`/`30_000`
literal found across `scripts/*.mjs` (there are ~25 of them) is either a `runUntilPhase(match,
phase, maxSteps = 20_000)` step-count safety bound (independent of any phase's actual configured
duration — it's a loop-guard, not a timer) or an unrelated tuning constant entirely (event
durations, patience windows, `RECONNECT_GRACE_MS`, `ORDER_FRESHNESS_WINDOW_MS`, etc.) — confirmed
by reading each hit, not assumed from the grep alone.

**Check coverage / falsification:** `scripts/check-scoring.mjs` gained seven new assertions
(null before scoring; populated from the right restaurant once scoring runs; matches
`match.finalResults.results[viewerRestaurantId]` exactly; never equals the rival's own slice;
never carries `winnerPlayerId`/`decidingSegment`/`turningPoints`/`tieBreakDecided`; never appears
at the snapshot's top level; stays null on the disconnect-triggered end path). Falsified by
temporarily changing the real lookup to a wrong key (`this.finalResults?.results?.
['__wrong_key__']`) — confirmed 4 of the 7 new checks failed cleanly (no crash, thanks to a
follow-up defensive fix using `?.` instead of a bare property read after the first falsify run
crashed the script before its summary printed), restored the real lookup, confirmed 74/74 green
again. The client teaser/`useCountUp` interpolator has NO automated check — this repo has no
client test framework (per its own conventions, client verification is `tsc --noEmit` + `vite
build` + diff review, not a runnable assertion script), and there is no existing precedent for a
script-driven client-animation check anywhere in `scripts/`. I judged this acceptable rather than
inventing a first-of-its-kind DOM/timing test harness for one small interpolator: the data it
animates (`resultsPreview`/`score`) is exactly what the seven new server-side checks already
verify end-to-end over a real socket (`check:phases`/`check:bot-smoke`), and the animation logic
itself is a straightforward, visually-inspectable `requestAnimationFrame` loop with no branching
worth a dedicated script. `npm run build:client`/`build:harnesses` (both clean `tsc --noEmit` +
`vite build`) is this codebase's actual verification bar for new TSX, and both passed.

**Full suite:** ran `npm run check` twice end to end after all changes (once before the
`ResultsPanel.tsx`/`RecapMenuStars.tsx` comment fixes, once after) — both runs green, exit 0,
every one of the 37 check sections (including `check:phases`, `check:bot-smoke`,
`check:invite-lobby-smoke`, `check:bot-menu-smoke`, all real-socket) reporting all assertions
passed. `check:bot-menu-smoke`'s own top-level-key-list assertion (the one AC1 specifically
warns about) printed the exact top-level snapshot key list with `resultsPreview` correctly
absent from it — confirms the new field never leaked past `you`.
