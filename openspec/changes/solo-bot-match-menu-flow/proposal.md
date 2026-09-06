# Solo bot match menu flow

## Why

STORY-017 (merged) already implements the bot opponent itself — `bot-controller.js#attachBot`
and `POST /api/dev/match` with `{bot: true, difficulty}` create a real authoritative room with a
server-controlled second player. What is still missing is the PRD §12 "solo/development
fallback" as a real PLAYER-FACING feature: a "Play vs Bot" entry on the main menu (STORY-023,
merged) currently renders disabled, and the only way to actually start a bot match is the
dev-only, raw-JSON `/dev/match` endpoint. This change is that menu path — a configuration screen
plus a non-`/dev/`-prefixed room-creation endpoint that seats a real player against a real bot,
on the exact same authoritative match lifecycle `/dev/match` already uses.

This corresponds to STORY-025 in the slicing pass.

## What Changes

- **A "Play vs Bot" configuration screen** (`PlayVsBotScreen.tsx`), opened from `MainMenu.tsx`'s
  now-real "Play vs Bot" button: market scenario (from `GET /api/markets`, or "Random"), a bot
  profile picker, and — development builds only (`import.meta.env.DEV`) — a fixed-seed input.
- **`POST /api/rooms` widened with `mode: "solo_bot"`**: `{mode: "solo_bot", botDifficulty,
  marketId?, seed?}` creates a two-seat room and calls `attachBot` on it — the exact
  `matchManager.createRoom` + `attachBot` sequence `POST /api/dev/match` already uses, not a
  second attachment mechanism. `POST /api/dev/match` itself is untouched and still exists for
  developers/scripts. `mode` omitted (or `"private_human"`) keeps every pre-existing `POST
  /api/rooms` behavior exactly as STORY-024 left it.
- **Three new real bot profiles** — `balanced`, `fast_service`, `premium` — added to
  `BOT_DIFFICULTIES`/`BOT_DECISION_INTERVAL_MS`/`BOT_MISTAKE_PROBABILITY`/`BOT_SPRINT_ENABLED`
  (`shared/constants/tuning.js`), each with its own distinct tuning rather than three display
  names for STORY-017's existing `hard` value. `easy`/`hard`/`BOT_DEFAULT_DIFFICULTY` are
  byte-identical to what STORY-017 shipped. The menu's dev-only "Practice" profile is a display
  label for the EXISTING `easy` value (`client/src/ui/bot-profiles.ts`), not a sixth
  `BOT_DIFFICULTIES` member — `normalizeBotDifficulty` remains the one gate, never a parallel
  enum.
- **An optional `marketId` override on `Match`/`matchManager.createRoom`**, for the menu's
  "market scenario" picker. The seeded market draw still always happens (draw order, and every
  other seed-derived value after it, is unchanged); a valid override replaces the drawn market,
  an invalid/missing one falls back to it silently.
- **Bot identity on the wire, gated to `solo_bot` rooms only**: `matchManager.buildSnapshot`
  merges the room's bot roster (`playerId`, `difficulty`) into `match_snapshot.bots[]`, but ONLY
  when `room.mode === 'solo_bot'`. A bare `POST /dev/match` room's snapshot is untouched —
  STORY-017 AC1 ("the human client cannot tell from the protocol that the opponent is a bot")
  stays true for that endpoint.
- **`ResultsPanel`/`HudPanel`/`TacticalOverviewPanel` name the bot** ("Bot (Premium)", "Rival —
  Fast Service Bot") when `status.bots` is non-empty, instead of the generic "Rival" label they
  already show for a human opponent — no new rendering path, no new score-generation path, the
  bot is the same restaurant/rival object every existing surface already reads.

## Non-Goals

No change to bot decision policy, reaction cadence logic, target selection, or scoring —
`bot-controller.js`'s decision loop is untouched; this only widens the DATA it is parameterized
by (five difficulty ids instead of two). No server-side environment gate (dev vs. production) —
this repo has none anywhere today, and inventing one here for the seed/Practice fields alone
would be new, out-of-scope infrastructure; the dev-only fields are a client-side UI affordance
only, same trust model `POST /api/dev/match` already documents for itself. No matchmaking queue
or bot-vs-bot spectator mode.

## Capabilities

### New Capabilities

- `solo-bot-match-menu`: the player-facing "Play vs Bot" configuration screen, the `mode:
  "solo_bot"` room-creation path built on the existing `matchManager.createRoom`/`attachBot`
  seam, the three new bot profiles, the `marketId` override, and the gated bot-identity wire
  field the results/HUD surfaces read.

### Modified Capabilities

(none — `openspec/specs/` has no archived capability yet for this repo to modify; the bot
opponent STORY-017 shipped and the room-creation endpoint STORY-024 widened were never formally
split into their own specs)

## Impact

- `shared/constants/tuning.js` / `.d.ts` (three new `BOT_DIFFICULTIES` members and their tuning)
- `shared/schemas/messages.d.ts` (`BotSnapshotEntry`, `MatchSnapshotMessage.bots?`)
- `server/src/game/match.js` (`marketId` constructor option)
- `server/src/game/match-manager.js` (`createRoom` widened, new `buildSnapshot`)
- `server/src/game/simulation-loop.js` (broadcasts via `buildSnapshot`, not `Match#toSnapshot`
  directly)
- `server/src/game/bot/bot-controller.js` (JSDoc only — no behavior change)
- `server/src/http/routes.js` (`POST /api/rooms` widened with the `solo_bot` branch)
- `client/src/ui/PlayVsBotScreen.tsx`, `client/src/ui/bot-profiles.ts` (new)
- `client/src/ui/MainMenu.tsx` (real "Play vs Bot" affordance)
- `client/src/game/GameClient.ts` (`GameClientStatus.bots`)
- `client/src/ui/ResultsPanel.tsx`, `HudPanel.tsx`, `TacticalOverviewPanel.tsx` (bot naming)
- `client/src/styles/app.css` (the new screen's styles)
- `scripts/check-bot-menu.mjs`, `scripts/smoke-bot-menu.mjs` (new, wired into `npm run check`)
