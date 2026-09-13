---
id: STORY-058
title: Setup ready-up countdown should tick from the start and run 10 seconds (dev/prototype pacing)
status: approved
prd_source: null
branch: story/058-setup-ready-up-countdown
worktree_path: null
base_branch: master
pr_url: null
is_architectural: false
approach_summary: >
  Reported (user's own words, clarified via follow-up question to mean the SETUP-phase ready-up
  screen — `SetupScreen.tsx`'s three-stage "Choose your mains/extras/prices" flow): "doesn't count
  down until you choose your dish lineup. the button should [visually] count down. also make the
  countdown 10 seconds." REPRODUCE FIRST — static reading did not find an obvious gating bug: the
  clock (`status.timeRemainingMs`, rendered by `SetupScreen.tsx` line ~196's `.ready-up-clock`) is
  server-authoritative and computed unconditionally as `phaseEndsAtMs - elapsedMs`
  (`server/src/game/match.js` line ~370-373) — it should already be ticking from the moment the
  `setup` phase begins, with no dependency on whether the player has picked a main yet. Before
  writing any fix, run a real match into the setup phase and directly observe: does the clock text
  genuinely not move before the first main is picked (a real bug, root-cause it — check for a
  local React state/memo in `SetupScreen.tsx` that could be stale-closing over an initial value, or
  a message-ordering issue where the first `timeRemainingMs` update the client receives is delayed
  until some other event), or does it move but read as static because nothing about its
  presentation communicates urgency (no color change, no fill/progress treatment) until the number
  gets small? These have different fixes. "the button should largely count down" — read as "the
  button should VISUALLY count down": whichever control the player uses to advance/ready up should
  itself carry a visible countdown treatment (a fill/progress bar, a shrinking ring, or similar —
  match this codebase's existing device for "time is running out on something" rather than
  inventing a new one, e.g. the freshness ring `upsertReadyDish` already uses, or a simple CSS
  width/clip-path transition driven by the same `timeRemainingMs`), not just the small clock text
  in the top bar. TUNING — "make the countdown 10 seconds": apply this to `PHASE_DURATIONS_MS
  .prototype.setup` (currently 45_000ms) ONLY, not `full.setup` (currently 120_000ms) — the
  `prototype` preset is what dev/solo-bot testing runs against (the context this bug was almost
  certainly observed in), and cutting the FULL production setup phase — three real decisions
  (mains, extras, prices) — to 10 seconds would be a much larger, likely-unintended gameplay/pacing
  change than a UI bug fix. If evidence surfaces that the user actually wants `full.setup` changed
  too (e.g. they were testing against a real 2-player match, not solo-bot), say so explicitly and
  ask rather than silently applying the smaller, safer interpretation. Do not touch `smoke.setup`
  (2_000ms) — real smoke scripts depend on that exact preset value, same reasoning STORY-052 used
  to leave `smoke.results` untouched.
created: 2026-09-12
updated: 2026-09-12
---

# Setup ready-up countdown should tick from the start and run 10 seconds (dev/prototype pacing)

Reported: "the 'prepare your restaurant menu' (kitchen command) doesn't count down until you
choose your dish lineup. the button should largely count down. also make the countdown 10
seconds." Clarified with the user: this is about the setup-phase ready-up screen
(`SetupScreen.tsx`'s three-stage mains/extras/prices flow), not the Kitchen Command Board's
service-phase focus-switch cooldown.

Static investigation (see `approach_summary`) did not find an already-confirmed gating bug — the
underlying clock appears to be server-authoritative and unconditional. This story requires
reproducing the actual observed behavior before writing a fix, in case there's a real bug in how
the client renders or receives the countdown that isn't visible from reading the phase-clock code
alone.

## Acceptance Criteria

- [ ] Reproduced first: confirmed whether the countdown text genuinely fails to update before the
  first dish is picked (real bug — root-caused) or updates but doesn't visually read as urgent
  (presentation gap — different fix). State which one was found.
- [ ] The setup-phase countdown counts down from the moment the setup phase begins, regardless of
  whether the player has made any selection yet.
- [ ] The ready-up flow's advance/submit control itself carries a visible countdown treatment
  (not just the existing small clock text), using an existing visual device from this codebase
  rather than a new one.
- [ ] `PHASE_DURATIONS_MS.prototype.setup` is changed to 10 seconds (10_000ms). `full.setup` and
  `smoke.setup` are left untouched unless there's clear evidence the user meant the production
  preset too (if so, say so explicitly rather than silently changing it).
- [ ] `npm run check` stays green — note that shortening `prototype.setup` to 10s may make any
  existing check/smoke script that exercises the ready-up flow under the `prototype` preset
  tighter on timing; verify none of them assumed more headroom than 10 seconds actually gives.

## Notes

- Not part of any PRD slice (`prd_source: null`) — standalone gameplay/UX report.
- Cites: `client/src/ui/SetupScreen.tsx` (`.ready-up-clock`, `formatCountdown`, the three
  `READY_UP_STAGES`), `server/src/game/match.js` (`timeRemainingMs` getter — server-authoritative,
  unconditional), `shared/constants/tuning.js` (`PHASE_DURATIONS_MS.prototype.setup`, and the
  `full`/`smoke` siblings that must NOT change) — same file STORY-052 tuned `results` in, follow
  the same "cite exactly which preset and why" discipline in the diff's comments.
- This is the lowest-confidence-in-root-cause story of this batch — reproduction is the load-
  bearing first step, not optional groundwork.
