## 1. Wire contract

- [x] 1.1 `shared/constants/tuning.js` / `.d.ts`: `INVITE_TOKEN_EXPIRY_MS`
- [x] 1.2 `shared/schemas/messages.js` / `.d.ts`: five new `ERROR_CODES`
      (`invite_token_mismatch`, `invite_expired`, `invite_canceled`, `already_started`,
      `invite_not_found`) and `JoinRoomMessage.inviteToken`

## 2. Server data model

- [x] 2.1 `server/src/persistence/in-memory-store.js`: `roomsByInviteToken` index,
      `getRoomByInviteToken`, kept in lockstep by `createRoom`/`deleteRoom`
- [x] 2.2 `server/src/game/match.js`: `holdLobbySeatsDuringGrace` constructor option;
      `removePlayer` only frees a `lobby` seat immediately when it is `false`;
      `#releaseLobbySeatsPastGrace` frees a held seat once `RECONNECT_GRACE_MS` actually elapses
- [x] 2.3 `server/src/game/match-manager.js`: `createRoom` widened with `mode`/`hostDisplayName`,
      mints `inviteToken`/`inviteExpiresAt` for `mode: "private_human"`; `roomStatus` widened
      with `mode`/`status`/`hostDisplayName`/`canceled`/`inviteExpiresAt`, and an
      `includeInvite` option gating the raw token; `validateInvite`, `resolveInvite`,
      `cancelRoom`, `getRoomByInviteToken`

## 3. HTTP endpoints

- [x] 3.1 `POST /api/rooms`: accepts `mode`/`hostDisplayName`, returns `inviteToken`/`joinUrl`
      for a private room, unchanged shape (plus three additive null fields) otherwise
- [x] 3.2 `GET /api/rooms/by-invite/:token`: read-only, via `resolveInvite`
- [x] 3.3 `POST /api/rooms/:roomId/cancel`: via `cancelRoom`, broadcasts `invite_canceled` to
      connected sockets

## 4. WebSocket join path

- [x] 4.1 `message-router.js#handleJoinRoom`: reads `message.inviteToken`, calls
      `matchManager.validateInvite` before `Match#join`, refuses with the specific error code

## 5. Server-side verification

- [x] 5.1 `scripts/check-invite-lobby.mjs` (in-process): invite-field minting, every
      `validateInvite`/`resolveInvite`/`cancelRoom` rejection reason, the lobby-seat-hold grace
      timing (synthetic `dtMs`, no real waiting), and that a dev/bot room is unaffected
- [x] 5.2 `scripts/smoke-invite-lobby.mjs` (wire-level): real HTTP + two real sockets — the
      actual `POST /api/rooms` response shape, that `GET /api/rooms/:roomId` never re-leaks the
      token, `GET /api/rooms/by-invite/:token`, `join_room`'s `inviteToken` field wired through
      the real router, identical seed/market for both real sockets, and a live cancel broadcast
- [x] 5.3 Both wired into `npm run check` (`check:invite-lobby`, `check:invite-lobby-smoke`)
- [x] 5.4 Falsify: broke the lobby-seat-hold guard, the token-mismatch check, and the cancel
      broadcast one at a time, confirmed each break fails the check that covers it, restored
- [x] 5.5 Full `npm run check` green after every change

## 6. Client

- [x] 6.1 `client/src/game/NetworkClient.ts`: `joinRoom` gains an `inviteToken` parameter
- [x] 6.2 `client/src/game/GameClient.ts`: `start(roomId, inviteToken)`; `GameClientStatus`
      gains `players: LobbySlot[]` (identity/connection/ready only, never position)
- [x] 6.3 `client/src/ui/InvitePanel.tsx`: join link, copy button, `navigator.share` when
      available
- [x] 6.4 `client/src/ui/LobbyScreen.tsx`: two resolved slots, connection/ready state,
      `InvitePanel` while waiting for the second seat; reuses `ReconnectOverlay` for the
      viewer's own drop rather than duplicating it
- [x] 6.5 `client/src/app/App.tsx`: `roomId`/`inviteToken`/`lobbyUi`/`invite` props; renders
      `LobbyScreen` during `lobby` only for the invite/lobby entry points; rewrites the URL to
      `/game/:roomId` once the match leaves `lobby` (guarded against the pre-snapshot `null`
      phase — this guard was added after a manual browser test caught the unguarded version
      rewriting the URL the instant `joined` arrived, before `LobbyScreen` ever showed)
- [x] 6.6 `client/src/app/AppRouter.tsx`, `HomeScreen.tsx`, `JoinInvitePage.tsx`,
      `invite-lobby-types.ts`: minimal pathname-based route shell (`/`, `/join/:token`,
      `/lobby/:roomId`, `/game/:roomId`); `main.tsx` repointed at it
- [x] 6.7 `server/src/index.js`: SPA-fallback route so a fresh tab on `/join/:token` or
      `/lobby/:roomId` gets the app shell instead of a 404
- [x] 6.8 `client/src/styles/app.css`: `.lobby`/`.home-screen`/`.join-invite`/`.invite-panel`
      styles, following the existing `.setup`/`.results` full-bleed pattern
- [x] 6.9 `npm run build:client` clean (`tsc --noEmit` + `vite build`)

## 7. Manual end-to-end verification

- [x] 7.1 Two real browser tabs: host creates an invite, copies the link, guest opens it in a
      fresh tab, both reach the lobby, both ready up, match starts and both URLs rewrite to
      `/game/:roomId`
- [x] 7.2 `/join/:token` with an invalid token shows the specific error screen and a working
      "Back to menu" link

## 8. OpenSpec

- [x] 8.1 `proposal.md`, `design.md` (with Mermaid sequence diagram of the actual invite/lobby
      data flow), `tasks.md` (this file), `specs/private-invite-lobby/spec.md`
