# private-invite-lobby

## ADDED Requirements

### Requirement: Creating a private-invite room mints a non-guessable token and a join link

`POST /api/rooms` with `{mode: "private_human", hostDisplayName}` SHALL create a room whose
`Match` requires two players, and SHALL respond with `id`, a non-guessable `inviteToken`, a
`joinUrl` embedding that token, `status: "waiting_for_opponent"`, and the given
`hostDisplayName` (falling back to `"Host"` when blank). A `POST /api/rooms` call that omits
`mode` SHALL keep the exact pre-existing bare-room response shape, with no invite fields.

#### Scenario: A host creates an invite

- **WHEN** a client calls `POST /api/rooms` with `{mode: "private_human", hostDisplayName: "Ada"}`
- **THEN** the response includes a `roomId`, an `inviteToken` distinct from the `roomId`, a
  `joinUrl` ending in `/join/<inviteToken>`, `status: "waiting_for_opponent"`, and
  `hostDisplayName: "Ada"`

#### Scenario: The pre-existing dev flow is unchanged

- **WHEN** a client calls `POST /api/rooms` with no `mode` (or `{seed, phasePreset}` only, as
  every pre-existing caller does)
- **THEN** the response has no `inviteToken` and no `joinUrl`, `mode` reads `"dev"`, and every
  field the pre-existing caller already reads (`id`, `seed`, `phase`, `requiredPlayers`, ...) is
  present and unchanged

### Requirement: The raw invite token is never re-served by a generic room lookup

`GET /api/rooms/:roomId` and `GET /api/rooms` SHALL NOT include the raw `inviteToken` in their
response, because `roomId` is a small sequential counter and is not itself a secret.

#### Scenario: A guessed roomId cannot recover the invite token

- **WHEN** a client calls `GET /api/rooms/:roomId` for a private-invite room, by any means other
  than the `POST /api/rooms` response that created it
- **THEN** the response body has no `inviteToken` key

### Requirement: A fresh join against a private-invite room is validated against its token

A `join_room` message that is NOT a reconnect (no `playerId` matching a currently-disconnected
seat) against a room created with `mode: "private_human"` SHALL be refused unless its
`inviteToken` matches the room's current one, the room is not canceled, the invite has not
expired, the room's match is still in `lobby`, and the room is not already full. Each failure
SHALL be reported as a distinct error code. A room with no invite token (every room not created
with `mode: "private_human"`) SHALL NOT apply this gate at all.

#### Scenario: The correct token seats a fresh player

- **WHEN** a client sends `join_room` with the room's current `inviteToken` and no reconnect
  `playerId`, and the room has fewer than 2 seated players and is still in `lobby`
- **THEN** the client is seated and receives `joined`

#### Scenario: A mismatched token is refused

- **WHEN** a client sends `join_room` with a token that does not match the room's `inviteToken`
- **THEN** the server responds `{type: "error", error: "invite_token_mismatch"}` and does not
  seat the client

#### Scenario: A canceled room refuses a fresh join

- **WHEN** the host has canceled the room via `POST /api/rooms/:roomId/cancel`
- **THEN** a further fresh `join_room`, even with the correct token, is refused as
  `invite_canceled`

#### Scenario: An expired invite refuses a fresh join

- **WHEN** the current time is past the room's `inviteExpiresAt`
- **THEN** a fresh `join_room` is refused as `invite_expired`

#### Scenario: A room whose match already started refuses a fresh join

- **WHEN** the room's match has left `lobby`
- **THEN** a fresh `join_room` is refused as `already_started`, not `match_full`, even if the
  room also happens to be full

#### Scenario: A full room refuses a third fresh join

- **WHEN** the room already has 2 seated players and is still in `lobby`
- **THEN** a further fresh `join_room` is refused as `match_full`

#### Scenario: A reconnect bypasses the invite gate entirely

- **WHEN** a client sends `join_room` with a `playerId` matching a seat that is currently
  disconnected and within its reconnect grace window, regardless of what (or whether) an
  `inviteToken` is also present
- **THEN** the client reclaims that seat and receives `joined` with `reconnected: true`

### Requirement: A bare invite token resolves to its room without seating anyone

`GET /api/rooms/by-invite/:token` SHALL resolve a token to its room's status (applying the same
canceled/expired/already-started/full checks as a fresh join, but not the token-match check,
since reaching the room at all already required the correct token) without creating, joining, or
otherwise mutating any match state.

#### Scenario: A good token resolves

- **WHEN** a client calls `GET /api/rooms/by-invite/:token` with a token that owns a room still
  accepting a fresh join
- **THEN** the response is 200 with that room's status, and no player is seated as a side effect

#### Scenario: An unrecognized token is reported distinctly

- **WHEN** a client calls `GET /api/rooms/by-invite/:token` with a token no room owns
- **THEN** the response is 404 with `{error: "invite_not_found"}`, distinct from
  `invite_canceled`/`invite_expired`

### Requirement: The host can cancel an unfilled invite room

`POST /api/rooms/:roomId/cancel` SHALL mark a private-invite room canceled, provided its match
is still in `lobby` and it has not already been canceled or ended, and SHALL broadcast
`{type: "error", error: "invite_canceled"}` to every socket already connected to that room. A
room with no invite token (not created with `mode: "private_human"`) SHALL refuse cancellation.

#### Scenario: Canceling notifies an already-connected player live

- **WHEN** the host has joined their own room and then calls
  `POST /api/rooms/:roomId/cancel` before a guest joins
- **THEN** the cancel succeeds, the room's `status` reads `"canceled"`, and the host's own open
  socket receives `{type: "error", error: "invite_canceled"}` without needing to attempt another
  join first

#### Scenario: Canceling twice is refused

- **WHEN** `POST /api/rooms/:roomId/cancel` is called a second time against an already-canceled
  room
- **THEN** the second call is refused (409) rather than silently re-accepted

#### Scenario: A dev/bot room cannot be canceled

- **WHEN** `POST /api/rooms/:roomId/cancel` is called against a room with no `inviteToken`
- **THEN** the call is refused, since this endpoint is invite-flow-only

### Requirement: A private-invite room holds a lobby-phase drop through the reconnect grace window

For a room created with `mode: "private_human"`, a player who disconnects while the match is
still in `lobby` SHALL have their seat held (marked disconnected, not removed) for
`RECONNECT_GRACE_MS`, exactly as a mid-match disconnect already is, rather than having the seat
freed for a new player immediately. Once that window elapses without a reconnect, the seat SHALL
be freed for a new player, WITHOUT ending the match (a `lobby`-phase timeout is not an
abandonment the way a mid-match one is). A room not created with `mode: "private_human"` SHALL
keep the pre-existing behavior: a `lobby`-phase drop frees the seat immediately.

#### Scenario: A dropped seat survives a brief lobby disconnect

- **WHEN** a seated player in a private-invite room's `lobby` disconnects, and a fresh join
  attempt (correct token, no reconnect `playerId`) arrives before `RECONNECT_GRACE_MS` elapses
- **THEN** the fresh join is refused as `match_full` — the seat is still held

#### Scenario: The original player reclaims their held seat

- **WHEN** the disconnected player reconnects with their own `playerId` before the grace window
  elapses
- **THEN** they are reseated with `reconnected: true`, exactly as a mid-match reconnect works

#### Scenario: An unreclaimed seat frees after the grace window, without ending the match

- **WHEN** the grace window elapses with no reconnect
- **THEN** the seat is freed for a new fresh join, and the match's `ended`/`endReason` are
  unaffected — the match is not treated as abandoned the way a mid-match grace-window expiry is

#### Scenario: A dev/bot room's lobby drop is unaffected

- **WHEN** a player in a room NOT created with `mode: "private_human"` disconnects during
  `lobby`
- **THEN** the seat is freed for a new player immediately, exactly as before this capability
  existed
