# Design — Pre-reveal teaser

Continues the repo's running Decision numbering — the highest existing number found across
`openspec/changes/*/design.md` is Decision 46 (`results-screen-narrative`), so this file starts
at Decision 47.

## Context

See proposal.md for the full motivation. The relevant current-state facts, confirmed by reading
the real server code rather than assumed:

- `scoring-system.js#onPhaseChange(match, transition)` runs SYNCHRONOUSLY the instant
  `transition.to === 'results'` fires, and is the ONLY place that sets `match.finalResults` — a
  match-wide object carrying `winnerPlayerId`, per-restaurant `results` (each a full
  `MatchResult`), `decidingSegment`, `turningPoints`, and `tieBreakDecided`.
- `match.js#matchCompleteMessage()` (called only from `#endMatch`, only once the results-phase
  TIMER expires) does nothing but package that already-existing `match.finalResults` into the
  one-shot `match_complete` message. There is no new computation anywhere in this change — only
  an earlier publication point for data that already exists.
- `Match#toSnapshot(viewerPlayerId)`'s `you` block is the established, already-precedented seam
  for anything that must differ per viewer (`you.cash`/`you.revenue`/`you.pantry`, etc. — see
  that method's own header comment on the PRD §18 privacy boundary). Everything else on the
  snapshot is identical for both players.
- `Match#toSnapshot`'s TOP-LEVEL key set is asserted exactly by `scripts/smoke-bot-menu.mjs`
  (`!('bots' in snapshot)` plus an exact top-level key list logged and compared elsewhere in
  `npm run check`'s chain) — a new top-level field is a real risk of breaking that check; `you`
  is the one block built to vary.
- The disconnect-triggered end path (`#endMatch` called with any reason other than
  `'completed'`) sets `phase = 'results'` DIRECTLY, never through `advanceClock`'s normal
  transition machinery — so `onPhaseChange` never fires for that path and `match.finalResults`
  stays `undefined`. `match_complete` is enqueued immediately in that same call, so there is
  nothing for a teaser to fill in that path anyway.
- STORY-047 already built `useRecapMotion()` (`client/src/ui/recap/useRecapMotion.ts`) as the
  one shared motion-gating convention for everything under `.recap` — PRD-recap-screen-redesign
  constraint 5 requires reusing it, not inventing a second gate.

## Goals / Non-Goals

**Goals:**
- Publish the viewer's own already-computed result the instant it exists, without ever
  publishing the rival's result or any match-wide (outcome-revealing) field early.
- Give the player something to look at and read during what is currently dead time, without
  changing what `match_complete`/`<ResultsPanel>` themselves do or when they arrive relative to
  the (now-shorter) results-phase timer.
- Make the results-phase wait measurably shorter, sized against a real, measured client-side
  timeline rather than a guessed "feels about right" number.

**Non-Goals:**
- No change to `scoring-system.js` itself, or to what `match.finalResults`/`match_complete`
  contain — this change is purely an earlier, narrower publication of data that already exists,
  plus a client consumer for it.
- No new shared motion convention. The teaser's count-up either runs or doesn't, gated by the
  exact same `useRecapMotion()` boolean `<ResultsPanel>` already reads.
- No tally-up capability added to `<ResultsPanel>`'s own hero score card. That card lives for
  the whole results screen and re-renders on every category-tab switch; adding a tally there
  would re-animate it on every click, which is a real regression, not a feature.
- No change to how long the FULL recap stays on screen after `match_complete` arrives —
  `<ResultsPanel>` is unmounted only by `GameView.tsx`'s own `status.matchComplete` gate, which
  this change does not touch.

## Decisions

## Decision 47 — `resultsPreview` is a plain per-viewer read, not a new message type

`this.finalResults?.results?.[viewerRestaurantId] ?? null`, computed inline in `toSnapshot`,
exactly where `you.cash`/`you.revenue` are already computed the same way from other
match-attached state (`this.upgrades`/`this.kitchen`). No new WebSocket message type, no new
per-tick accumulator, no new match-attached field beyond reading one that
`scoring-system.js` already writes.

**Alternative rejected**: a dedicated `results_preview` push message, sent once, the instant
`finalResults` is set. Rejected because it duplicates `toSnapshot`'s existing per-viewer
broadcast machinery (BROADCAST_HZ already carries `you` to both clients 10x/second) for no
benefit, and reintroduces exactly the kind of "second protocol path with its own edge cases"
Decision 15 (cited in `match.js`'s own header) warns against — later systems attach data to
`match`, they do not open new wire paths.

## Decision 48 — The teaser is a sibling component gated by the full recap's own inverse condition, not shared toggle state

`RecapTeaser` mounts in `GameView.tsx` alongside (not inside, not wrapping) `<ResultsPanel>`,
gated `matchPhase === 'results' && !matchComplete && resultsPreview`. `<ResultsPanel>`'s own
gate is `matchComplete` (unchanged). Because `!matchComplete` is exactly the logical inverse of
`<ResultsPanel>`'s own gate, the two conditions are mutually exclusive by construction — no
handoff state, no "hide the teaser when the recap is ready" effect, nothing that could race.

**Alternative rejected**: a single parent component owning both, switching between them
internally on an `isComplete` flag. Rejected because `<ResultsPanel>`'s existing mount site in
`GameView.tsx` is untouched by this change (lower risk — one new sibling block, zero edits to
the existing one), and the mutually-exclusive gate already gives the same guarantee without
introducing a new stateful parent.

## Decision 49 — The count-up interpolator is new, local, hand-rolled, and gated by the existing motion hook

No existing count-up/tally mechanism was found anywhere in this codebase (confirmed by search
before writing this). `RecapTeaser.tsx` adds one, `useCountUp(target, durationMs, active)`: a
`requestAnimationFrame` loop, eased (ease-out cubic) from 0 to `target`, local to this file only
— not exported, not added to `shared/game-logic/` or any cross-cutting module, because it has
exactly one caller and no server-side twin (a pure client-presentation concern, unlike e.g.
`hud-cash-feedback.js`, which is dual-imported by a check script). `active` is
`motionEnabled` (STORY-047's `useRecapMotion()`), not a second gate — when `false`, the hook
sets the value to `target` immediately, no animation frame requested at all.

The fact reveal sequence (which facts are visible yet) uses the SAME `motionEnabled` boolean via
a plain `setTimeout` stagger, not `requestAnimationFrame` — a staged appearance has no continuous
value to interpolate, so a timer is the right tool, and reusing the identical boolean (rather
than a second derived flag) keeps "is motion on" answerable by reading one hook call.

**Alternative rejected**: a general-purpose `useCountUp` promoted to `client/src/ui/hooks/` for
future reuse. Rejected as speculative — this change has exactly one consumer, and promoting an
abstraction before a second caller exists is exactly the kind of premature generalization this
codebase's existing single-purpose `recap/*` modules (`format.ts`, `match-result.ts`) avoid.

## Decision 50 — The new `results` duration is sized against the teaser's own measured timeline, not guessed

`RecapTeaser.tsx`'s sequence is fixed and enumerable: three facts appear staggered
`REVEAL_STEP_MS` (900ms) apart (the third at t=2700ms), then the score section mounts and its
own `TALLY_DURATION_MS` (1400ms) count-up runs, finishing at ~4100ms. `PHASE_DURATIONS_MS
.prototype.results` (7000ms) and `.full.results` (9000ms) both clear that with a few seconds to
read the settled final number before `match_complete` swaps the teaser for the full recap —
see `tuning.js`'s own inline comments for the exact arithmetic. `smoke.results` (1200ms) is
UNCHANGED; it is not long enough for the teaser sequence to complete and was never meant to be
(see that field's own comment: `scripts/smoke-phases.mjs` sleeps `DURATIONS.results + 600` off
that exact preset, a wire-lifecycle smoke concerned with `match_complete` arriving at all, not
with a human ever reading the teaser).

**Alternative rejected**: making the teaser's own pacing read the configured `results` duration
and stretch/compress to fit it. Rejected because it would make the ANIMATION duration a function
of a tuning constant nothing else reads that way, coupling a presentation timing to a balance
lever for no real benefit — the reverse (a fixed teaser timeline informing the duration choice)
is simpler and matches how every other phase duration in `tuning.js` was chosen (a target
experience length, not a formula).

## Decision 51 — CSS reuses the existing `.recap` root class rather than a parallel token set

`RecapTeaser`'s root element carries both `recap` and `recap-teaser` classes. `.recap` already
defines the `--recap-*` custom properties, the fully-opaque full-bleed overlay positioning, and
(critically) the `.recap--motion-off`/`prefers-reduced-motion` blanket animation-kill rule this
change's own entrance animation should respect. No rule in `app.css` is scoped narrower than a
dedicated `.recap-*` class (confirmed by search — no `.recap .foo` descendant selector exists),
so sharing the root class costs nothing and both components get the same bright-card visual
language for free, rather than a second copy of the same nine custom properties.

## Risks / Trade-offs

- **[Risk]** The teaser's fixed client-side pacing (900ms/900ms/900ms/1400ms) could feel slow or
  fast depending on how many facts a future story adds to it, silently drifting out of sync with
  the `tuning.js` duration this change chose against today's three-fact/one-tally sequence. →
  **Mitigation**: `tuning.js`'s own comments state exactly what the current duration was sized
  against, so a future change to `RecapTeaser.tsx`'s sequence has an explicit pointer to also
  reconsider the duration, rather than the two silently drifting apart.
- **[Risk]** Shortening `results` from 20s/30s to 7s/9s is a real behavior change for anyone who
  wanted to linger on the dark screen before the recap appeared (unlikely, since there was
  nothing to look at, but a genuine change in wall-clock pacing). → **Mitigation**: this is the
  story's entire point — the wait existed only to withhold data that is now shown progressively
  instead; nothing about reading the FULL recap afterward is time-boxed by this constant (see
  Non-Goals).
- **[Risk]** A future story could be tempted to add more `you`-scoped early-preview fields
  following this same pattern, each independently reasoning about what's safe to leak early. →
  **Mitigation**: `match.js#toSnapshot`'s own header comment (predating this change) already
  states the general privacy-boundary rule this field follows; this change adds one more
  worked, in-place example of applying it correctly (own-restaurant-only, never a match-wide
  field) rather than a new abstraction.

## Data flow / timing

The core mechanism this change adds: `you.resultsPreview` becomes available on the very next
ordinary `match_snapshot` after `results` begins — not a new message, not a delayed one — while
`match_complete` still waits for the (now-shorter) results-phase timer.

```mermaid
sequenceDiagram
    participant SS as scoring-system.js
    participant M as match.js
    participant C as GameClient.ts (client)
    participant T as RecapTeaser.tsx
    participant R as ResultsPanel.tsx

    Note over M: service/final_rush -> results transition
    M->>SS: onPhaseChange(match, {to: 'results'})
    activate SS
    SS->>M: match.finalResults = {winnerPlayerId, results, ...}
    deactivate SS
    Note over M: results-phase timer starts (7s prototype / 9s full)

    loop every ordinary snapshot (10 Hz, BROADCAST_HZ)
        M->>C: match_snapshot { matchPhase: 'results',<br/>you: { ..., resultsPreview } }
    end
    Note over C: resultsPreview = finalResults.results[viewerRestaurantId]<br/>— THIS viewer's own slice only, never the rival's

    C->>T: status.matchPhase==='results' &&<br/>!status.matchComplete && status.resultsPreview
    activate T
    Note over T: facts build up (0, 900, 1800ms)<br/>then score tallies up (finishes ~4100ms)
    Note over T: sits readable until match_complete arrives

    Note over M: results-phase timer expires
    M->>C: match_complete { winnerPlayerId, results: {...},<br/>decidingSegment, turningPoints, tieBreakDecided }
    deactivate T
    C->>R: status.matchComplete is now truthy
    activate R
    Note over R: RecapTeaser unmounts (its own gate is<br/>now false); ResultsPanel takes over —<br/>outcome heading, full recap, stays mounted<br/>until the player leaves
```

## Migration Plan

Purely additive on the wire (Decision 7 "widen, never rename" applies here too): `you` gains one
new field, nothing existing changes shape. No persistence involved (in-memory only, MVP). A
stale cached client predating this change simply ignores the new field and behaves exactly as
before (still gets the dark wait, now shorter) — no version-skew hazard beyond the repo's usual
"redeploy both together" assumption.
