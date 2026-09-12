---
id: STORY-052
title: Pre-reveal teaser, win celebration, and motion controls
status: pending
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: true
approach_summary: null
created: 2026-09-11
updated: 2026-09-12
---

# Pre-reveal teaser, win celebration, and motion controls

**Expanded 2026-09-12** with a real, separately-reported problem the user identified as related
to this story: the match-end transition into results is a genuine dark, empty wait — not just a
rendering artifact STORY-034 already addressed (the "Game Over" kicker on a dim backdrop). Confirmed
by direct investigation of the real current mechanism:

- `final_rush` ending flips `matchPhase` to `'results'` immediately, which swaps the client's
  3D backdrop to the dim `ResultsScene.ts` stage right away (`GameClient.ts`'s phase-swap call).
- Scoring itself (`scoring-system.js`) runs SYNCHRONOUSLY at that same phase-entry instant — the
  final numbers exist server-side from the very start of the `results` phase.
- But the client is never told. `match_complete` (the message `GameClient.ts` needs before
  `<ResultsPanel>` will mount at all) is only enqueued once the ENTIRE `results` phase's own timer
  expires and `match.js#endMatch` fires — `shared/constants/tuning.js`'s results-phase duration:
  **20 seconds in the live default (`prototype`) preset, 30 seconds in `full`.**
- Net effect: the player stares at an empty dark stage (no recap, no score, `HudPanel` still
  showing a bare "Results" label) for a full 20-30 seconds, then the ENTIRE populated recap
  appears all at once. The data was sitting there, computed, unused, the whole time.

This is genuinely different from this story's original scope (STORY-052 as first written only
covers replaying/celebrating AFTER the recap has already mounted) — it requires a SERVER change
(publish the computed result, or enough of it to tease with, earlier than `endMatch`), which is
why `is_architectural` is now `true`. The user's three asks: (1) show SOME components as a
building teaser before the outcome is formally declared, rather than nothing, (2) tally the score
up slowly as part of that tease, (3) shorten the wait itself, now that dead time isn't needed to
hide anything.

Reference: `docs/table-stakes-recap-menu.zip` → `table-stakes-menu-suite/story-screenshots/`
`10-victory-fireworks.png`; `RECAP-PREVIEW.md`'s "Replay reveal" and "Motion" bullets. See
`docs/PRD-recap-screen-redesign.md` for the full slice and its constraints — especially
constraint 5 (every earlier story's animation must be gateable by one shared convention this
story turns off).

## Acceptance Criteria — Part A: pre-reveal teaser (new 2026-09-12)

- [ ] Investigate and choose a mechanism for the client to receive enough real data to tease with
  BEFORE the formal `match_complete` reveal — e.g. publishing the already-computed final score
  (and/or other headline figures) on the ordinary `match_snapshot` once `matchPhase === 'results'`
  (`you`-scoped, same viewer-privacy discipline every other per-viewer snapshot field already
  follows — PRD §18/Decision 16), rather than waiting for `endMatch`'s one-shot
  `matchCompleteMessage()`. This is a real protocol decision, not a client-only animation choice —
  investigate `server/src/game/match.js`'s `advanceClock`/`enterPhase`/`endMatch` and
  `scoring-system.js`'s `onPhaseChange('results')` before deciding where to attach it, and confirm
  the choice doesn't let a `results`-phase snapshot leak anything PRD §18 currently protects (e.g.
  a rival's still-private figures) earlier than intended.
- [ ] Once real data is available early, the client shows a building teaser sequence during the
  dark transition — some components/facts appearing progressively — BEFORE the outcome heading
  (win/loss/draw) is shown. This deliberately inverts today's/STORY-047's order (outcome first,
  then everything else) for this ONE moment only; the full recap (STORY-047 through STORY-051)
  still declares the outcome and shows everything once the tease finishes.
- [ ] The final score tallies up (an animated count from 0, or from a plausible running total, to
  the real final number) as part of the tease — this is new client logic; there is no existing
  count-up/tally mechanism in this codebase to reuse (confirmed by search), so it must be built
  (a small interpolator, e.g. `requestAnimationFrame`-driven or a fixed-step timer, gated by this
  story's own Motion convention below — no tally animation when motion is off, jump straight to
  the final number instead).
- [ ] The results-phase wait itself is measurably SHORTER than today's 20s (`prototype` preset)/
  30s (`full` preset) — tune `shared/constants/tuning.js`'s results-phase duration down, per this
  story's own comment-with-reasoning convention (state what the new duration was chosen against —
  e.g. "long enough for the teaser sequence to play out at a readable pace, no longer"). Confirm
  this doesn't break any existing timing assumption elsewhere (`check-phases.mjs`/`smoke-phases.mjs`
  or similar — search for the current constant's other readers before changing it).
- [ ] `npm run check` stays green, including any timing-sensitive existing check touched by the
  duration change.

## Acceptance Criteria — Part B: post-reveal celebration and motion (original scope)

- [ ] On a win (`complete.winnerPlayerId === selfId`), a short, finite celebratory effect plays
  once when the highlights section first appears — the prototype uses colored particle bursts
  with trails over an ~8 second spawn window, then lets remaining particles expire
  (`10-victory-fireworks.png`); the exact visual is this story's own call (particles, confetti,
  a simpler CSS-only treatment) as long as it is genuinely FINITE (stops on its own, does not
  loop indefinitely) and reads as a celebration distinct from the mascot's own win reaction
  (STORY-047).
- [ ] A "Replay Reveal" control restarts the category-entrance animations (the staggered card
  drop-in STORY-047/048/049/050 each use) and, on a win, replays the celebration effect too.
- [ ] A single Motion control (on/off) disables every animated element the recap redesign added
  across ALL stories in this slice: card entrance/settle animations, mascot idle/reaction motion,
  and the win celebration — via the ONE shared convention STORY-047 established (constraint 5 of
  the PRD), not by this story individually patching each earlier story's component. If STORY-047
  did not actually leave a clean single hook, that's this story's finding to report back, not to
  silently work around with a scattered per-component fix.
- [ ] The system `prefers-reduced-motion: reduce` preference sets the Motion control's INITIAL
  state to off (matching `RECAP-PREVIEW.md`'s own "The system reduced-motion preference is
  respected initially" line) — the player can still explicitly turn motion back on.
- [ ] With Motion off (whether by explicit toggle or by `prefers-reduced-motion`), no card
  animates in, the mascot holds a static pose, and no celebration plays regardless of outcome —
  every panel's DATA still renders normally, only motion is suppressed.
- [ ] `npm run check` (including `build:client`) stays green.

## Notes

- Depends on STORY-047 (the mascot component and, critically, the shared motion-gating
  convention constraint 5 asks STORY-047 to establish).
- Cites: `table-stakes-menu-suite/src/recap-scene.js`'s finite-particle fireworks implementation
  as a mechanism reference (spawn window, particle lifetime, trail rendering) — port the APPROACH
  (finite, capped particle count, respects a motion-off flag), not the literal vanilla-Three.js
  code, into whatever rendering context STORY-047 chose for the mascot (this story's own file
  header note applies: confirm where STORY-047 actually put the mascot/celebration canvas before
  assuming a location).
- **Part A specifically**: this is a server+client story, not client-only like the rest of this
  PRD's slice — flag this explicitly at kickoff (`is_architectural: true` is already set above).
  The exact mechanism (new snapshot field vs. reusing/relocating an existing one) is this story's
  own investigation to complete, not prescribed here; the one hard constraint is that a rival's
  still-private figures must not leak earlier than PRD §18 already allows elsewhere.
- Given Part A's real server-side scope is a meaningfully different kind of work from Part B's
  pure client animation/motion-toggle work, consider whether splitting them into two stories
  (kept as one here per the user's own direction to fold this into "the related story") makes
  more sense once actually scoping the OpenSpec change — implementer/kickoff's call to raise back
  if the combined scope proves awkward for one branch/PR.
