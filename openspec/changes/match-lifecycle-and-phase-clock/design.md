# Design — Match lifecycle and phase clock

Decisions later work must preserve or explicitly supersede. Numbering continues from
`shared-contracts/design.md`, whose Decision 6 this change refines (Decision 18).

## Decision 14 — The phase clock is server-owned and advanced by the tick, not by wall time

PRD §12 "Server authority" lists the match timer among the things the server owns, and PRD §5
gives the phase table. `match.js` holds both: an `elapsedMs` accumulator, the current phase, and
that phase's deadline expressed in the same clock.

**`elapsedMs` accumulates the loop's `dtMs`.** It is deliberately not `Date.now()`. The loop
already owns the cadence (Decision 3), so a system that integrates over `dtMs` and a clock that
advances by something else would disagree about how much time passed in a tick — and the whole
point of a single authoritative timeline is that they cannot. The snapshot's `serverTime` is
this same value, so `serverTime` rising and `timeRemainingMs` falling are two views of one clock.

**A transition carries the deadline forward, it does not restart at "now".** When a phase's
deadline falls mid-tick, the next phase begins at *the deadline*, not at the elapsed time when
the loop noticed. Restarting at "now" would leak up to one tick per phase, so a full-length
match would finish visibly late and the two clients' phase boundaries would be the loop's
jitter rather than the tuning table. This is what "the service phase transitions into
`final_rush` without a gap" means concretely, and
`scripts/check-match-lifecycle.mjs` asserts each boundary lands on the exact millisecond.

**The clock advances before any system runs and before the snapshot is built.** So no system
can observe a phase it has already left, and no broadcast can carry a phase's time after that
phase ended. A stale re-broadcast is not merely avoided here; it is unrepresentable.

**A `null` duration means "no deadline, ends on a condition".** Only `lobby` has one. PRD §5
calls the lobby "Variable", and modelling that as a null rather than a very large number is
what lets `timeRemainingMs` be honestly null in the snapshot instead of counting down toward a
number nobody chose.

**`final_rush` is an additional phase, not a relabelled tail of `service`.** PRD §5's
10-minute breakdown lists "Main service: 6 minutes" and "Final rush: 1 minute" as separate line
items, and `PHASE_DURATIONS_MS` gives them separate keys.

### An observation for the balance story, not fixed here

`PHASE_DURATIONS_MS.full` sums to 540 s, while PRD §5's pacing target is a 600 s match, and §5's
table calls the service phase "6–8 min" against the shipped 300 s. The `full` preset's numbers
were set by STORY-002 and are left exactly as they are: this change owns the machine, not the
balance, and quietly rewriting a merged story's tuning values is how balance work becomes
untraceable. A story that owns pacing should reconcile them.

## Decision 15 — Systems register against the simulation loop; adding one never edits `match.js`

**This is the heading stories 004, 005, 009 and 011 should cite.**

`simulation-loop.js` exports `registerSystem(system)`. A system is a plain object:

```js
// server/src/game/systems/customer-system.js
export const customerSystem = {
  id: 'customers',                        // unique, snake_case
  phases: ['service', 'final_rush'],      // OMIT the key to run in every phase
  update(match, dtMs) { /* ... */ },      // required
  onPhaseChange(match, { from, to, atMs }) { /* optional */ },
};
```

and `server/src/game/systems/index.js` is the single place they are registered:

```js
import { customerSystem } from './customer-system.js';
// ...
export function registerAllSystems() {
  registerSystem(movementSystem);
  registerSystem(customerSystem);   // <- STORY-004 adds this one line
}
```

That is the whole cost of a new system: **one new file, one import, one registration line.**
No edit to `match.js`, none to `simulation-loop.js`, none to the message router. Four stories
can do it at once and conflict only on adjacent lines of a list, which is a conflict a reviewer
can actually resolve.

The contract:

- **Reading the phase** is `match.phase`, `match.timeRemainingMs` (null in `lobby`) and
  `match.isServicePhase`. Declaring `phases` is that same check written once — a system with a
  `phases` filter is simply not called outside them and needs no guard of its own.
- **Sending a message** is `match.enqueue(message)`. The loop drains the outbox after the
  systems run and broadcasts it. A system never touches a socket. STORY-011's `event_announce`
  wants exactly this.
- **Deterministic draws** are `match.createRngStream('your_system')` — see Decision 18.
- **Order is the contract.** Systems run in the order registered, identically for every match
  and every tick, so a system may rely on an earlier one having already run *this* tick.
  STORY-005 will care that customers ticked before orders; the array in `systems/index.js` is
  where that is expressed, and a story inserting itself should say in its PR why it goes where
  it goes.
- **Wiring mistakes fail at boot.** `registerSystem` throws on a duplicate id, a non-snake_case
  id, a missing `update`, or an unknown phase name. The only good time to discover a
  misregistered system is before the listener opens.

Deliberately *not* a plugin framework: no priorities, no dependency graph, no dynamic
discovery, no enable/disable. Five systems in one ordered list, in one file a person can read.

## Decision 16 — The snapshot is built per viewer, and `you` is the privacy boundary

PRD §18 says: "Do not reveal the opponent's exact menu or prices during setup." A snapshot
composed once and broadcast to everyone cannot honour that, so `match_snapshot` is composed
**per socket**: `Match#toSnapshot(viewerPlayerId)`, sent through
`connection-manager.broadcastPerViewer`.

Everything at the top level is public and both players receive it identically — including
`market`, which PRD §12 room-flow step 5 requires be identical. Anything one player alone may
see goes under **`you`**, the only key that differs between the two snapshots.

The boundary exists now, before there is anything private to put behind it, because retrofitting
it later means auditing every field added in between. **STORY-009's setup submission belongs
under `you`.** Putting it anywhere else leaks it, and `scripts/smoke-phases.mjs` fails if a
menu, a price or a staff assignment ever appears in an opponent's snapshot entry.

Two public exceptions, both required by the PRD rather than convenient:

- **`players[].ready` is public.** PRD §18's setup UI shows "opponent-ready status". Readiness
  is the whole of what one player learns about the other's setup.
- **`market` omits `eventPool`.** The pool is the draw pile STORY-011's seeded event deck reads
  from; publishing it hands both players the event timeline before the first customer arrives.
  Everything else about the market is public — PRD §5 wants the reveal to show the district, its
  segments and the forecast.

## Decision 17 — A dropped player is held for the grace period; exceeding it ends the match

PRD §13 "Server responsibilities" requires a reconnect grace period. `removePlayer` marks the
player `connected: false` and stamps the match clock; it does not remove them. The match keeps
running, and every tick checks whether anyone has been gone longer than `RECONNECT_GRACE_MS`.

- **Reconnecting** is a `join_room` carrying the `playerId` from the previous `joined` message.
  It is honoured **only** for a player who is currently disconnected and still inside the
  window, so a token can never evict a live socket. The reconnecting owner's movement intent is
  cleared, so they do not inherit the direction they were holding when the socket dropped.
- **Exceeding it** ends the match with `reason: 'player_disconnected'` and lands it on `results`
  with an empty clock — one coherent terminal state rather than a phase frozen mid-countdown.
  `match_complete` names the player who dropped.
- **Only during `market_reveal` … `final_rush`.** A drop in `lobby` releases the seat instead
  (nothing is under way to abandon), and a drop during `results` is ignored because the match is
  already decided.

**Security assumption, stated so it is not forgotten: the reconnect token is just the
`playerId`.** The MVP has no authentication, so this is trust-on-first-use — anyone who learns a
`playerId` could reclaim that seat while it is empty. That is acceptable for local and private
play and **must become a signed session token before any public deployment.** Milestone 0
Decision 2's threat model was a browser that lies about its own position, not a third party
impersonating a player; this is the first place the difference matters.

## Decision 18 — Named RNG sub-streams, refining Decision 6

Decision 6 says a match is reproducible from its seed and that STORY-011's event deck draws from
"this same seeded stream". Taken literally — one shared generator — that couples every system to
every other: once STORY-004 draws a customer between two of STORY-011's event draws, neither
sequence is reproducible on its own, and adding a system silently changes the behaviour of the
systems beside it.

`match.createRngStream(name)` returns an independent generator seeded from `${seed}:${name}`.
Still entirely seed-derived, still identical for both players, still reproducible — and stable
under a new system being added next to it. Same seed plus same name is always the same sequence.

The match's own configuration stream is drawn from only at construction (market, then spawn
jitter), so no system can shift the market selection. **Inserting a draw above an existing one
changes every match with that seed**, which is why the order is written down in `match.js`.

## Decision 19 — Readiness is its own message, not a side effect of `setup_submit`

PRD §12's four client-to-server examples carry no readiness signal, yet §5 ("ready up"), §12
room-flow step 7 ("once both players are ready or timer expires") and §18 ("opponent-ready
status") all require one. The candidates were to overload `setup_submit` or to add a message.

`setup_submit` carries a menu, and validating a menu is STORY-009's story. Implementing it here
well enough to extract "this player is done" would mean accepting a message and ignoring most of
it — the silent inaction Milestone 0 Decision 7 exists to prevent. So `player_ready` is a new
type, added to `CLIENT_MESSAGE_TYPES` **and** `IMPLEMENTED_CLIENT_MESSAGE_TYPES` in the same
commit as its handler, which is exactly the discipline Decision 7 asks for.

It is accepted only in `lobby` and `setup`, the two phases that consult it, and readiness resets
at every transition — readying up in the lobby is not a promise about a menu. A ready sent in
any other phase is refused, and the client sees that in the very next snapshot, whose
`you.ready` still reads false. That is an observable answer rather than silence.

When STORY-009 lands, a `setup_submit` may reasonably imply readiness; that is a widening of
this rule, not a contradiction of it.
