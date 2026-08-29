# Match lifecycle, rooms, and phase clock

## Why

STORY-001 shipped a deliberate placeholder: `server/src/game/match.js` parked every match in a
single `service` phase with no clock, because Milestone 0 only needed somewhere for two owner
avatars to move. Everything after it needs the opposite — a match that *progresses*. PRD §5's
phase structure is what setup, service, events, scoring and the results screen all attach to,
and PRD §12 names the match timer as something the server owns outright.

There is a second, structural reason to do this now. Four stories fan out in parallel
immediately after this one — 004 customers, 005 orders, 009 setup, 011 events — and every one
of them needs to run code on the tick and read the current phase. If each does that by editing
`match.js`, four branches collide in one file and the fan-out fails. So this change ships the
phase machine *and* the seam those four register against.

This corresponds to STORY-003 in the slicing pass.

## What changes

- **The PRD §5 phase machine** in `match.js`: `lobby -> market_reveal -> setup -> service ->
  final_rush -> results`, advanced by the simulation loop's `dtMs`, with `matchPhase` and a
  monotonically decreasing `timeRemainingMs` in every `match_snapshot`. Durations come from
  `PHASE_DURATIONS_MS`; both the `full` and `prototype` presets are selectable.
- **The system-registration seam** on `simulation-loop.js` — `registerSystem({id, phases?,
  update, onPhaseChange?})` plus `server/src/game/systems/index.js` as the single registration
  list. Movement moves out of `match.js` into `systems/movement-system.js`, both because PRD
  §13's layout names that file and because the seam should have one real user on day one.
- **The PRD §12 eleven-step room flow**: seeded market selection, identical public market data
  to both clients, service beginning when both players are ready **or** the setup timer
  expires, and `match_complete` at the end of `results`.
- **Per-viewer snapshots.** `match_snapshot` is now built once per player, with everything
  public at the top level and the viewer's own state under `you` — the boundary PRD §18's "do
  not reveal the opponent's exact menu or prices" needs to exist before there is a menu.
- **Reconnect grace.** A player who drops mid-match is held for `RECONNECT_GRACE_MS`; a
  `join_room` carrying their `playerId` restores them; exceeding the window ends the match with
  a stated reason.
- **The catalogue is loaded at boot.** STORY-002 shipped `loader.js` but nothing imported it.
  `server/src/game/catalogue.js` now does, so a malformed catalogue aborts startup, and
  `GET /api/markets` returns real definitions instead of a 501.
- **`player_ready`**, one new client message type, added to the vocabulary and implemented in
  the router in the same commit (Milestone 0 Decision 7).
- **Two runnable checks** wired into `npm run check`: `scripts/check-match-lifecycle.mjs`
  (in-process, owns the clock arithmetic and the grace window) and `scripts/smoke-phases.mjs`
  (wire-level, owns what only two real sockets can prove).

## Non-goals

No gameplay content. No customers arrive, no menu is submitted, no dish is cooked, no event
fires and nothing is scored. `match_complete.results` is one empty object per player until
STORY-013 fills it in, and `winnerPlayerId` is always null.

**No reconnect UX and no telemetry.** This change guarantees only that the *server* does not
drop the match; deciding when a client retries, and what it shows meanwhile, is STORY-022.

**`setup_submit` is not implemented.** It is the message that carries a menu, and validating
one is STORY-009's job. Half-implementing it here to harvest its readiness bit would be exactly
the silent inaction Decision 7 forbids, which is why readiness got its own message instead.

**No room garbage collection.** Rooms still accumulate in the in-memory store, as they did
after STORY-001. An ended match simply stops advancing.
