## 1. Shared tuning and wire contract

- [x] 1.1 `shared/constants/tuning.js` / `.d.ts`: `BOT_DIFFICULTIES` widened with `balanced`,
      `fast_service`, `premium`; each gets its own `BOT_DECISION_INTERVAL_MS` /
      `BOT_MISTAKE_PROBABILITY` / `BOT_SPRINT_ENABLED` entry. `easy`/`hard`/
      `BOT_DEFAULT_DIFFICULTY` left byte-identical to STORY-017.
- [x] 1.2 `shared/schemas/messages.d.ts`: `BotSnapshotEntry` and `MatchSnapshotMessage.bots?`
- [x] 1.3 `server/src/game/bot/bot-controller.js`: JSDoc updated to name the widened difficulty
      type — no behavior change

## 2. Server: market override and bot-gated snapshot

- [x] 2.1 `server/src/game/match.js`: optional `marketId` constructor option; the seed-derived
      market draw still always runs, a valid override substitutes its result, an invalid one
      falls back silently
- [x] 2.2 `server/src/game/match-manager.js`: `createRoom` forwards `marketId`; new
      `buildSnapshot(room, viewerPlayerId)` merges `room.bots` into the snapshot ONLY when
      `room.mode === 'solo_bot'`
- [x] 2.3 `server/src/game/simulation-loop.js`: the one production broadcast site calls
      `matchManager.buildSnapshot` instead of `room.match.toSnapshot` directly

## 3. HTTP endpoint

- [x] 3.1 `server/src/http/routes.js`: `POST /api/rooms` widened with `mode: "solo_bot"` —
      validates `botDifficulty` via `normalizeBotDifficulty`, validates an optional `marketId`
      against the catalogue, creates a two-seat room via the existing `matchManager.createRoom`,
      and calls the existing `attachBot` — the exact `POST /dev/match` sequence. `POST
      /dev/match` itself is untouched.

## 4. Client: configuration screen and menu wiring

- [x] 4.1 `client/src/ui/bot-profiles.ts` (new): profile display metadata keyed by
      `BOT_DIFFICULTIES` ids, `botProfileOptions(includeDevOnly)`, `botProfileLabel(difficulty)`
- [x] 4.2 `client/src/ui/PlayVsBotScreen.tsx` (new): market scenario select (`GET
      /api/markets`), bot profile radio group, dev-only (`import.meta.env.DEV`) fixed-seed
      input, submits `POST /api/rooms {mode: "solo_bot", ...}` and navigates to `/game/:roomId`
- [x] 4.3 `client/src/ui/MainMenu.tsx`: "Play vs Bot" is a real, enabled action opening
      `PlayVsBotScreen` as a menu modal (same pattern as `HowToPlay`/`SettingsPanel`)
- [x] 4.4 `client/src/styles/app.css`: styles for the new modal's profile cards and controls

## 5. Client: bot identity surfaced in-game and in results

- [x] 5.1 `client/src/game/GameClient.ts`: `GameClientStatus.bots`, populated verbatim from
      `match_snapshot.bots` (empty when the field is absent)
- [x] 5.2 `client/src/ui/HudPanel.tsx`, `TacticalOverviewPanel.tsx`: the rival column/header
      label reads `status.bots` and shows "Bot (Profile)" instead of a plain "Rival" when the
      opponent is bot-controlled — same underlying restaurant object, no new rendering path
- [x] 5.3 `client/src/ui/ResultsPanel.tsx`: the opponent's results column is titled with the
      bot's profile instead of the generic "Rival" when `status.bots` names it

## 6. Verification

- [x] 6.1 `scripts/check-bot-menu.mjs` (new, in-process): `normalizeBotDifficulty` over all
      five ids; the three new profiles have distinct, non-`hard`-identical tuning; `easy`/`hard`
      byte-identical to STORY-017; `createRoom({marketId})` override/fallback and its
      non-disturbance of the RNG draw order; `buildSnapshot` gated correctly for a `dev` room
      (no `bots` key) vs. a `solo_bot` room (`bots` present, public, correct); the abandonment
      lifecycle via synthetic `dtMs` stepping (`player_disconnected` after grace, bot seat
      unaffected)
- [x] 6.2 `scripts/smoke-bot-menu.mjs` (new, real HTTP + WS): `POST /api/rooms {mode:
      "solo_bot"}` response shape; a real human socket taking the second seat; the real
      `match_snapshot` naming the bot; `players[]` shape parity preserved (STORY-017 AC1); a
      bare `POST /dev/match` room's real snapshot still carrying no `bots` key; a real socket
      close registering the human's disconnect
- [x] 6.3 Both new scripts wired into `package.json`'s `check` aggregate
      (`check:bot-menu`, `check:bot-menu-smoke`)
- [x] 6.4 Falsified `buildSnapshot`'s `mode === 'solo_bot'` gate (both in-process and over the
      real endpoint) to confirm the new checks actually catch a regression, then restored
- [x] 6.5 `npm run check` passes end to end
- [x] 6.6 Manual verification: a full bot match played through the UI (setup -> service ->
      results — ResultsPanel showed "Rival — Fast Service Bot"; HudPanel/TacticalOverviewPanel
      showed "Bot (Premium)" in a separate run), and a bot match abandoned during
      `market_reveal` (closed the real browser tab) to confirm `GET /api/rooms/:roomId` reports
      `endReason: "player_disconnected"` once `RECONNECT_GRACE_MS` elapses, exactly like an
      abandoned human-vs-human match
