# Private opponent invite and lobby

## Why

`POST /api/rooms` (`server/src/http/routes.js`) is still the bare dev endpoint STORY-001 shipped:
no invite token, no host/guest distinction, no lobby state, and the client joins purely by
putting a room id in `?room=`. PRD §12's actual room flow is a private invite — a host shares a
link, a guest opens it, both see each other's connection/ready state in a real lobby before the
match starts. This change is that flow, layered onto the existing room-creation path rather than
replacing it, so `POST /api/dev/match` and the bot flow (STORY-017, already merged) keep working
unchanged.

This corresponds to STORY-024 in the slicing pass.

## What Changes

- **`POST /api/rooms` widened**: `{mode: "private_human", hostDisplayName}` mints a non-guessable
  `inviteToken` (`node:crypto randomUUID`), an expiry (`INVITE_TOKEN_EXPIRY_MS`), and a shareable
  `joinUrl`, with `status: "waiting_for_opponent"`. `mode` omitted keeps the EXACT pre-existing
  bare-room shape (additive fields only: `mode: "dev"`, `status`, `hostDisplayName: null`).
- **A new invite-validation gate** (`matchManager.validateInvite`) in front of a FRESH (non-
  reconnect) `join_room`: a mismatched, expired, canceled, already-full, or already-started room
  is refused with a distinct `ERROR_CODES` member. A reconnect redeeming its own `playerId`
  bypasses this entirely — they already hold the seat the invite got them into once.
- **`GET /api/rooms/by-invite/:token`**: read-only resolution of a bare token to its room (no
  `roomId` in the URL — `roomId` is a small sequential counter, guessable in one guess; the
  token is the actual secret). Never mutates anything.
- **`POST /api/rooms/:roomId/cancel`**: the host calling off an unfilled room. Broadcasts
  `{type: "error", error: "invite_canceled"}` to anyone already connected.
- **Lobby-phase reconnect grace, opt-in**: `Match` gains `holdLobbySeatsDuringGrace` (set only
  for `mode: "private_human"` rooms) so a host/guest who drops during `lobby` is held for
  `RECONNECT_GRACE_MS`, the same as a mid-match drop, instead of losing the seat instantly. Every
  other room (dev, bot) keeps the pre-existing "lobby drop frees the seat immediately" behavior.
- **Client**: `LobbyScreen` (two resolved slots, connection/ready state) and `InvitePanel` (join
  link, copy button, `navigator.share` when available), plus a minimal pathname-based
  `AppRouter` (`/`, `/join/:token`, `/lobby/:roomId`, `/game/:roomId`) standing in for STORY-023's
  real route table, which is being built in parallel from the same base commit. The pre-existing
  `?room=` dev/bot flow is untouched.
- **Server SPA fallback**: a fresh tab opening a shared `/join/:token` link is a guest's FIRST
  request, with no earlier page load to have parsed the URL — `server/src/index.js` now serves
  the built client's `index.html` for any non-`/api` GET the static middleware didn't already
  answer.

## Non-Goals

No persistence: invite/room state stays in `match-manager.js`'s existing in-memory room map,
exactly as the existing dev/bot rooms already do — STORY-026/027 is what adds SQLite at this
boundary, not this change. No bot-match invite flow (STORY-025's scope). No account system or
signed session tokens — the reconnect token's own STORY-003 design note already documents this
MVP's trust-on-first-use model, and the cancel endpoint's host check inherits the same limit
(anyone who knows the `roomId` can cancel it; there is no identity to check against yet). No
cosmetic/avatar preview in the lobby — nothing in this codebase publishes one to preview.

## Capabilities

### New Capabilities

- `private-invite-lobby`: the invite token/expiry/cancel data model on top of the existing room
  map, the fresh-join validation gate, the by-invite lookup, and the lobby-phase reconnect-grace
  exception — plus the wire fields and client screens that expose it.

### Modified Capabilities

(none — `openspec/specs/` has no archived capability yet for this repo to modify; the room/match
lifecycle this change extends was never formally split into its own spec)

## Impact

- `shared/constants/tuning.js` / `.d.ts` (`INVITE_TOKEN_EXPIRY_MS`)
- `shared/schemas/messages.js` / `.d.ts` (five new `ERROR_CODES`, `JoinRoomMessage.inviteToken`)
- `server/src/persistence/in-memory-store.js` (invite-token index)
- `server/src/game/match.js` (`holdLobbySeatsDuringGrace`, `#releaseLobbySeatsPastGrace`)
- `server/src/game/match-manager.js` (`createRoom` widened, `validateInvite`, `resolveInvite`,
  `cancelRoom`, `getRoomByInviteToken`)
- `server/src/http/routes.js` (`POST /api/rooms` widened, two new endpoints)
- `server/src/websocket/message-router.js` (`handleJoinRoom` invite gate)
- `server/src/index.js` (SPA fallback route)
- `client/src/game/NetworkClient.ts` / `GameClient.ts` (`inviteToken`, `players[]` status)
- `client/src/ui/LobbyScreen.tsx`, `client/src/ui/InvitePanel.tsx` (new)
- `client/src/app/AppRouter.tsx`, `HomeScreen.tsx`, `JoinInvitePage.tsx`,
  `invite-lobby-types.ts` (new), `App.tsx` (widened), `main.tsx` (repointed)
- `scripts/check-invite-lobby.mjs`, `scripts/smoke-invite-lobby.mjs` (new, wired into
  `npm run check`)
