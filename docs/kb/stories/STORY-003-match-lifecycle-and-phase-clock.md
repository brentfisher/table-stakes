---
id: STORY-003
title: Match lifecycle, rooms, and phase clock
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/003-match-lifecycle-and-phase-clock
worktree_path: /Users/brent/table-stakes-worktrees/story-003-match-lifecycle
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/3
is_architectural: true
approach_summary: "Replaces STORY-001 placeholder match state with the real PRD §5 phase machine (lobby -> market_reveal -> setup -> service -> final_rush -> results), a server-owned clock, the §12 eleven-step room flow, reconnect grace, and market selection from the seed. Also defines the system-registration seam on simulation-loop.js that stories 004/005/009/011 will each register against, so wave three can fan out without colliding on match.js."
created: 2026-08-28
updated: 2026-08-29
---

# Match lifecycle, rooms, and phase clock

STORY-001 gives a room that two clients can join and move around in. This story turns that into a
*match*: the PRD §5 phase structure (lobby → market reveal → setup → service → final rush →
results), the server-side clock that advances it, the §12 room flow that gets two players from
"joined" to "service starting", and the reconnect-tolerant match state that everything else hangs
off.

This is the story that makes the server authoritative over *time*. Every later system reads the
current phase and the remaining milliseconds from match state rather than keeping its own timer,
and the phase transition is the hook the setup, service, and results stories all attach to.

It carries no gameplay content: no customers, no menu validation, no scoring. It should be
demonstrable with two clients watching a countdown advance through every phase and land on a
results phase with an empty result payload.

## Acceptance Criteria

- [x] `server/src/game/match-manager.js` creates and tracks matches; `match.js` owns one match's
      state, including its seed, its selected market id, its phase, and its phase deadline.
- [x] The phase machine implements PRD §5 in order: `lobby`, `market_reveal`, `setup`, `service`,
      `final_rush`, `results`, and `matchPhase` in `match_snapshot` reports the current one.
- [x] Phase durations are read from `shared/constants/tuning.ts`, not hardcoded, and a
      prototype-length preset (§5: setup 45s, service 3–4min, results 20s) is selectable
      alongside the full-length preset.
- [x] The service phase transitions into `final_rush` for its last 60–90 seconds without a gap or
      a re-broadcast of stale time.
- [x] `timeRemainingMs` in the snapshot decreases monotonically within a phase and resets at each
      transition.
- [x] Both clients receive identical **public** market data at market reveal; neither receives the
      other's menu, prices, or setup submission (PRD §18: "Do not reveal the opponent's exact menu
      or prices during setup").
- [x] The service phase begins when both players are ready **or** the setup timer expires,
      whichever comes first (§12 room flow step 7).
- [x] `POST /api/dev/match` creates a development/local match without a second human player.
- [x] A player who disconnects during service is held for a reconnect grace period rather than
      ending the match immediately; reconnecting within the window restores that player to the
      running match (§13 "Server responsibilities").
- [x] The match seed is fixed at creation and drives market selection; two matches created with
      the same seed select the same market and produce the same phase timeline.
- [x] A `match_complete` message is emitted at the end of the results phase with the §12 envelope
      shape, even though `results` is an empty object until STORY-013 fills it in.

## Notes

- **Depends on STORY-001** (server, `ws`, room store) and **STORY-002** (`messages.ts`,
  `game-state.ts`, `tuning.ts`). Do not start before both have landed.
- `conventions.md` **Notable Pattern 1** (server authority): the server owns the match seed, the
  match timer, and the event timeline. The client must not run its own phase clock — it renders
  `matchPhase` and `timeRemainingMs` from the snapshot.
- `conventions.md` "Testing": the simulation must be seeded and reproducible; the seed lives on
  match state from this story onward, and STORY-011's event deck draws from it.
- `key-files.md`: `server/src/game/simulation-loop.js` is the tick this story drives; every later
  system registers against it.
- PRD §5 is the phase table; §12 "Room flow" is the eleven-step sequence; §12 "Server authority"
  is the ownership list.
- Leaves reconnect *UX* and telemetry export to STORY-022 — this story only guarantees the server
  does not drop the match.
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede. Architectural (new
  module owning match state and a public phase contract); record the phase machine and the
  reconnect grace policy as an OpenSpec change.
