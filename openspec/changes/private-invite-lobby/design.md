# Design — Private opponent invite and lobby

Decisions continue the repo-wide numbering (last was Decision 46, `results-screen-narrative`).

## Context

`server/src/game/match-manager.js#createRoom` already builds one `Match` per room and stores it
in `server/src/persistence/in-memory-store.js`'s in-memory map; `server/src/websocket/
message-router.js#handleJoinRoom` already seats a player via `Match#join`, including its
existing reconnect-token bypass. This change adds an authorization layer IN FRONT OF that
existing seat-taking, plus the token/expiry/cancel state it checks — it does not replace or
re-derive anything `Match#join` or the seed-selection path already do (see proposal.md's Why).

## Goals / Non-Goals

**Goals:**
- A real PRD §12 invite/lobby lifecycle: create, share, validate, join, cancel, expire.
- Every existing room-creation caller (`POST /api/dev/match`, the bot flow, every
  `scripts/check-*.mjs`) keeps behaving exactly as before — this is additive, gated on
  `mode: "private_human"`, never a default-on behavior change.
- A minimal, self-contained client route shell that STORY-023's real route table can absorb
  without this story blocking on it landing first.

**Non-Goals:**
- Persistence (STORY-026/027's boundary, not this one's).
- An account system or signed session tokens — the reconnect token's existing trust-on-first-use
  model is the ceiling here too.
- A bot invite flow (STORY-025) or a cosmetic/avatar preview (nothing publishes one yet).

## Decisions

### Decision 47 — The invite gate lives in `matchManager`, not in `Match`

`validateInvite`/`resolveInvite`/`cancelRoom` are free functions in `match-manager.js` that read
a `room` object (`{inviteToken, inviteExpiresAt, canceled, match}`), not methods on `Match`
itself. `Match#join`'s own `match_full`/`match_ended` checks are generic 1v1-seating rules every
room already had; the invite gate is a room-level concern layered in front of that, one level up
— `Match` has no idea what an "invite" is, and should not need to. `message-router.js#handleJoinRoom`
calls `validateInvite` BEFORE `Match#join`, so a `Match` used outside this HTTP/WS pairing (every
`check-*.mjs` script constructing one directly) never has to know this gate exists.

**Alternative considered:** push the token/expiry fields onto `Match` itself. Rejected — `Match`
already documents itself as holding no gameplay-adjacent policy beyond the phase clock and
players; an invite token is neither.

### Decision 48 — `inviteToken` is `node:crypto randomUUID()`, never derived from the seed stream

`rng.js#randomSeed()` (`Math.random().toString(36)...`) exists for the match SEED, which is
deliberately reproducible and short. An invite token needs the opposite property — unguessable,
long, and never fed back into anything deterministic. Reusing the seed generator for both would
conflate two constants that must never be confused: one is meant to be typed/shared and re-derive
identical matches; the other must never be guessable and never influences match content.
`randomUUID()` is a Node builtin — no new dependency, no pin to manage.

### Decision 49 — Lobby-seat-hold is an opt-in `Match` constructor flag, not a phase-wide behavior change

`removePlayer`'s pre-existing rule — a `lobby`-phase drop frees the seat immediately — is pinned
by `check-match-lifecycle.mjs`'s own "a drop during lobby releases the seat instead of holding
it" and is the right default for an open dev/bot room (nothing under way to abandon, so first-
come-first-served on the freed seat is reasonable). A private-invite room needs the opposite:
the seat belongs to a SPECIFIC person until they explicitly give it up, so a blip should not
hand it to a stranger who happens to load the link in that window. Making this a constructor
flag (`holdLobbySeatsDuringGrace`, default `false`) rather than branching on `room.mode` inside
`match.js` keeps `Match` ignorant of "invite" as a concept (Decision 47's same reasoning) while
still letting `match-manager.js#createRoom` wire it up for exactly the one mode that needs it.

**Alternative considered:** always hold lobby seats through grace, for every room. Rejected —
it would change dev/bot-room behavior every existing check and the bot-controller depend on,
for a property only the new invite flow needs.

### Decision 50 — The raw `inviteToken` is served exactly once, never re-serialized generically

`room.id` (`room_0001`, `room_0002`, ...) is a small sequential counter — a trivially guessable
lookup key, not a secret. If `GET /api/rooms/:roomId` echoed `inviteToken` back, ANY caller who
guessed a `roomId` could read the one thing that is supposed to gate entry, defeating the whole
feature. `roomStatus(room, {includeInvite: true})` is called ONLY from the `POST /api/rooms`
handler that just minted the token; every other reader of `roomStatus` (`GET /api/rooms/:roomId`,
`GET /api/rooms`, `GET /api/rooms/by-invite/:token`) gets the default (`false`), and the raw
token never appears in their response bodies.

### Decision 51 — `GET /api/rooms/by-invite/:token` resolves, it does not seat

The Notes ask that new HTTP endpoints "create/validate/cancel rooms" and never perform match
state mutation that belongs on the socket path (Decision 2 reaffirmed). This endpoint answers
"is this link still good, and which room does it point at" — read-only, no `Match#join` call,
no side effect on `room.match.players`. The actual seat is claimed exactly one way, same as
every other join: the client's `NetworkClient.joinRoom` sending `join_room` over `/ws`. This is
why `JoinInvitePage.tsx` calls this endpoint BEFORE ever constructing a `GameClient` — a bad
link gets a clear answer without ever opening a socket that would just be refused a moment later.

### Decision 52 — `AppRouter.tsx` is a deliberately temporary pathname switch

STORY-023 (the main menu, the real route table) is being built in parallel from the same base
commit and was explicitly not to be waited on. Rather than invent a heavier routing abstraction
this repo has never used (conventions.md: "avoid introducing a large UI system early"),
`AppRouter.tsx` is a four-branch `switch` over `window.location.pathname`, matching the
`react-router`-shaped mental model (a `Route` union, one component per branch) without the
dependency, so replacing it with STORY-023's real table is a mechanical swap, not a rewrite.
`HomeScreen.tsx` is explicitly documented as the piece STORY-023 replaces outright — everything
downstream of it (`LobbyScreen`, `InvitePanel`, `JoinInvitePage`) is unaffected by that swap.

## Data Flow

The actual sequence this change adds — a host creating an invite, a guest redeeming it, both
reaching the lobby, and the two paths (cancel, lobby-drop-and-reclaim) that can interrupt it:

```mermaid
sequenceDiagram
    participant H as Host browser<br/>(HomeScreen -> AppRouter -> App)
    participant HTTP as server/http/routes.js
    participant MM as match-manager.js<br/>(room map + invite state)
    participant WS as message-router.js<br/>(join_room)
    participant G as Guest browser<br/>(JoinInvitePage -> App)

    H->>HTTP: POST /api/rooms {mode: private_human, hostDisplayName}
    HTTP->>MM: createRoom({mode: "private_human", ...})
    MM-->>MM: new Match({holdLobbySeatsDuringGrace: true})<br/>inviteToken = randomUUID()<br/>inviteExpiresAt = now + INVITE_TOKEN_EXPIRY_MS
    HTTP-->>H: 201 {id, inviteToken, joinUrl, status: waiting_for_opponent}
    Note over H: AppRouter navigates to /lobby/:roomId<br/>(pushState, no reload)

    H->>WS: join_room {roomId, inviteToken}
    WS->>MM: validateInvite(room, {inviteToken})
    MM-->>WS: ok (token matches, room in lobby, not full)
    WS-->>H: joined {playerId, seed, marketId}
    Note over H: LobbyScreen renders:<br/>Host slot connected, Guest slot waiting,<br/>InvitePanel shows joinUrl

    H-->>G: joinUrl shared out of band (copy link / navigator.share)
    G->>HTTP: GET /api/rooms/by-invite/:token
    HTTP->>MM: resolveInvite(token)
    MM-->>HTTP: ok {room} (not canceled/expired/started/full)
    HTTP-->>G: 200 {id, status, hostDisplayName, ...} (no raw token echoed back)
    Note over G: AppRouter navigates to /lobby/:roomId

    G->>WS: join_room {roomId, inviteToken}
    WS->>MM: validateInvite(room, {inviteToken})
    MM-->>WS: ok
    WS-->>G: joined {playerId, seed, marketId}
    Note over G: LobbyScreen renders:<br/>both slots connected

    par host readies up
        H->>WS: player_ready {ready: true}
    and guest readies up
        G->>WS: player_ready {ready: true}
    end
    Note over H,G: Match#advanceClock sees both seats<br/>filled and ready -> lobby -> market_reveal
    Note over H,G: LobbyScreen unmounts (matchPhase !== lobby);<br/>App rewrites URL to /game/:roomId

    rect rgb(40, 30, 30)
    Note over H: Alt path: host cancels before guest joins
    H->>HTTP: POST /api/rooms/:roomId/cancel
    HTTP->>MM: cancelRoom(room)
    MM-->>HTTP: ok (room.canceled = true)
    HTTP-->>G: connections.broadcast: error invite_canceled<br/>(if already connected)
    G->>WS: join_room {roomId, inviteToken} (a later attempt)
    WS-->>G: error invite_canceled
    end

    rect rgb(30, 35, 45)
    Note over G: Alt path: guest drops mid-lobby, reclaims within grace
    G--xWS: socket closes
    WS->>MM: Match#removePlayer(guestId)<br/>(holdLobbySeatsDuringGrace: seat held, not freed)
    G->>WS: join_room {roomId, playerId: guestId} (reconnect token)
    WS->>MM: validateInvite bypasses (own disconnected seat)
    WS-->>G: joined {reconnected: true}
    end
```

## Risks / Trade-offs

- **No identity check on cancel** → anyone who learns a `roomId` (sequential, guessable) can
  cancel that room, same trust level the reconnect token already documents. Mitigation: this is
  explicitly out of scope (see proposal.md's Non-Goals) until an account system exists; the
  blast radius is "an unfilled lobby gets canceled," not data loss or a live match ending.
- **`sessionStorage` invite-link recovery is best-effort** → a host who hard-reloads
  `/lobby/:roomId` in a private window, or on a different device, cannot recover their own share
  link (the raw token is never re-served — Decision 50). Mitigation: this matches the app's
  pre-existing "nothing else persists across a reload" limitation (see `ResultsPanel`'s own
  rematch-handler comment); a future story that adds real sessions removes the gap for
  everything at once rather than this one inventing a one-off fix.
- **`INVITE_TOKEN_EXPIRY_MS` (15 min) is a usability guess, not a measured figure** → PRD names
  no invite lifetime. Mitigation: it is one named constant in `tuning.js`, trivially retuned by a
  later story with real usage data.

## Migration Plan

Purely additive on the server (new fields, new endpoints, an opt-in `Match` flag) and on the
client (new components, a new route shell that falls back to the exact pre-existing behavior
for `?room=`). No data migration to worry about either way: there is no persistence yet (the
room map is in-memory and empty on every restart), so there is no existing stored room to
reconcile against the widened shape — every room a running server holds was created after this
change deployed. No rollback concern beyond reverting the branch: nothing here changes what a
pre-existing client or check script sends or expects. Since STORY-023's real route table
lands separately, whichever of the two PRs merges second is expected to rebase onto the other's
`App.tsx`/`main.tsx` changes.
