// PRD §13 "Suggested HTTP endpoints". The actual game session uses WebSockets, not REST
// polling — these exist for room creation, health, and development.

import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as matchManager from '../game/match-manager.js';
import { catalogue, publicMarket } from '../game/catalogue.js';
import { attachBot, normalizeBotDifficulty } from '../game/bot/bot-controller.js';
import { buildMatchLog, buildMatchSummary } from '../game/telemetry-export.js';
import * as connections from '../websocket/connection-manager.js';
import { THREE_VERSION, PHASE_DURATIONS_MS, PHASE_PRESETS } from '../../../shared/constants/tuning.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '../../package.json'), 'utf8'));
// Same source of truth `index.js` reads for the listener itself — duplicated here rather than
// imported so this module doesn't need a boot-order dependency on the entry point; both just
// read the identical env var, so there's no drift to worry about.
const PORT = Number(process.env.PORT ?? 3000);

/** Returns the first non-internal IPv4 address of any network interface — i.e. this machine's
 * LAN address, the one another device on the same Wi-Fi/network can actually reach. `null` if
 * there isn't one (offline, or every interface is loopback-only). */
function firstLanIPv4() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

/**
 * STORY-033. `req.get('host')` reflects whatever hostname/port the INVITING player's own
 * browser happened to use to reach the server — exactly right for them, but useless as a
 * SHARED link: "localhost" resolves to whichever device opens it, not this machine, and the
 * dev client's own port (Vite's :5173) may leak through the Host header when the API call was
 * proxied rather than answered directly. Swap in this machine's real LAN IP (and the server's
 * actual listening port, not a possibly-proxied one) whenever the request came in on
 * localhost/127.0.0.1 — a request that already arrived on a real hostname (a LAN IP, a domain
 * behind a real deployment) is left alone and trusted as-is.
 */
function inviteHost(req) {
  const requestHost = req.hostname; // Express's `hostname` getter already strips any port.
  if (requestHost !== 'localhost' && requestHost !== '127.0.0.1') return req.get('host');
  const lanIp = firstLanIPv4();
  return lanIp ? `${lanIp}:${PORT}` : req.get('host');
}

export function apiRouter() {
  const router = Router();

  router.get('/version', (_req, res) => {
    res.json({
      server: pkg.version,
      threeVersion: THREE_VERSION,
      protocol: 1,
    });
  });

  /**
   * PRD §13 "Development/debug market definitions". STORY-001 answered 501 because there was
   * no catalogue; STORY-002 shipped one and STORY-003 loads it at boot, so this now returns
   * the real definitions — the same PUBLIC projection a client receives at market reveal.
   * `eventPool` is withheld for the reason given in catalogue.js.
   */
  router.get('/markets', (_req, res) => {
    res.json({ markets: catalogue.markets.map(publicMarket) });
  });

  /** The phase timeline a client can expect, so a HUD need not hardcode phase durations. */
  router.get('/phases', (_req, res) => {
    res.json({ presets: PHASE_PRESETS, durationsMs: PHASE_DURATIONS_MS });
  });

  /**
   * PRD §12 room-flow steps 1-2. STORY-024 widened this from a bare dev endpoint into the
   * PRD's real private-invite flow: `{mode: 'private_human', hostDisplayName}` mints a
   * non-guessable `inviteToken` and a shareable `joinUrl`, and the response's `status` reads
   * `waiting_for_opponent`. `mode` omitted (or anything else BUT `'solo_bot'` below) keeps the
   * EXACT pre-STORY-024 behaviour — a bare dev room with no invite gating — since
   * `POST /dev/match` and every `scripts/check-*.mjs` caller construct a room through
   * `matchManager.createRoom()` directly and never hit this branch either way; this endpoint's
   * own old callers (a plain `POST /api/rooms` with just `seed`/`phasePreset`) get the same
   * room shape as before, plus three new always-`null` fields (`mode: 'dev'`, `status`,
   * `hostDisplayName: null`) — additive, not breaking.
   *
   * STORY-025 `{mode: 'solo_bot', botDifficulty, marketId}` is the player-facing "Play vs Bot"
   * menu's room-creation path — the AC's requirement for a NON-`/dev/`-prefixed endpoint that
   * seats a real bot. It deliberately reuses the exact `matchManager.createRoom` +
   * `attachBot` sequence `POST /dev/match` already uses (that story's own header: "The bot
   * itself is attached and JOINS its seat before this handler returns") rather than a second
   * attachment mechanism — the only things this branch adds are validating `botDifficulty`
   * through the SAME `normalizeBotDifficulty` STORY-017 shipped (never a parallel enum) and
   * threading an optional `marketId` through to `Match` (see that constructor's own comment).
   * `POST /dev/match` itself is UNCHANGED and still exists — this is an additive sibling, not a
   * replacement; scripts and developers keep using the raw dev endpoint, and this one is what
   * the menu screen calls.
   *
   * `includeInvite: true` is passed for every mode, same as before STORY-025 — a `solo_bot`
   * room never mints an `inviteToken` (only `mode === 'private_human'` does, in `createRoom`),
   * so the flag is simply a no-op for it, not a second branch to keep in sync.
   */
  router.post('/rooms', (req, res) => {
    const seed = typeof req.body?.seed === 'string' ? req.body.seed : undefined;
    const phasePreset = matchManager.normalizePhasePreset(req.body?.phasePreset);
    const requestedMode = req.body?.mode;
    const mode =
      requestedMode === 'private_human' ? 'private_human' : requestedMode === 'solo_bot' ? 'solo_bot' : 'dev';
    // PRD §12 step 4's own market data — reused here as the validity check for an explicit
    // player-chosen scenario (the STORY-025 menu's "market scenario" field): a real catalogue
    // id passes through, anything else (omitted, mistyped, an id from a different catalogue
    // version) is left `undefined` so `Match` falls back to its normal seed-drawn market rather
    // than ever throwing on a client-supplied string.
    const requestedMarketId = req.body?.marketId;
    const marketId =
      typeof requestedMarketId === 'string' && catalogue.marketsById[requestedMarketId]
        ? requestedMarketId
        : undefined;
    const room = matchManager.createRoom({
      ...(seed ? { seed } : {}),
      phasePreset,
      mode,
      ...(mode === 'private_human' ? { hostDisplayName: req.body?.hostDisplayName } : {}),
      ...(mode === 'solo_bot' ? { requiredPlayers: 2, marketId } : {}),
    });
    let botDifficulty = null;
    if (mode === 'solo_bot') {
      botDifficulty = normalizeBotDifficulty(req.body?.botDifficulty);
      attachBot(room, { difficulty: botDifficulty });
    }
    const status = matchManager.roomStatus(room, { includeInvite: true });
    res.status(201).json({
      ...status,
      ...(room.inviteToken
        ? { joinUrl: `${req.protocol}://${inviteHost(req)}/join/${room.inviteToken}` }
        : {}),
      ...(mode === 'solo_bot' ? { bot: true, botDifficulty } : {}),
    });
  });

  router.get('/rooms', (_req, res) => {
    res.json({ rooms: matchManager.listRoomStatuses() });
  });

  router.get('/rooms/:roomId', (req, res) => {
    const room = matchManager.getRoom(req.params.roomId);
    if (!room) {
      res.status(404).json({ error: 'room_not_found' });
      return;
    }
    res.json(matchManager.roomStatus(room));
  });

  /**
   * STORY-024. The `/join/:token` route's OWN lookup — a guest's URL carries only the token,
   * never a `roomId` (that would defeat the whole point: `roomId` is a small sequential
   * counter, guessable in one guess from any other room's id). Read-only: this endpoint
   * creates and mutates nothing, matching the Notes' "the new HTTP endpoints only
   * create/validate/cancel rooms" — validating here is answering "is this link still good",
   * not seating anyone; the actual seat is claimed over the WebSocket `join_room` path, same
   * as every other join (Decision 2).
   */
  router.get('/rooms/by-invite/:token', (req, res) => {
    const result = matchManager.resolveInvite(req.params.token);
    if (!result.ok) {
      res.status(404).json({ error: result.error });
      return;
    }
    res.json(matchManager.roomStatus(result.room));
  });

  /**
   * STORY-024. The host calling off an unfilled invite. No account system exists to verify
   * the caller really is the host (see `matchManager.cancelRoom`'s own header) — MVP trust
   * level, same as the reconnect token's. Connected sockets in the room are told immediately
   * (`error`/`invite_canceled` is already a real `ERROR_CODES` member a client can render),
   * rather than only ever finding out from a REFUSED future join attempt.
   */
  router.post('/rooms/:roomId/cancel', (req, res) => {
    const room = matchManager.getRoom(req.params.roomId);
    if (!room) {
      res.status(404).json({ error: 'room_not_found' });
      return;
    }
    const result = matchManager.cancelRoom(room);
    if (!result.ok) {
      res.status(409).json({ error: result.error });
      return;
    }
    connections.broadcast(room, { type: 'error', error: 'invite_canceled', roomId: room.id });
    res.json(matchManager.roomStatus(room));
  });

  /**
   * PRD §20/§21 Milestone 4 "match telemetry dashboard or log export". The structured event
   * log — seed, event schedule, every customer decision, every order's lifecycle, every
   * validated and rejected client action, every upgrade purchase — in the diffable shape
   * `telemetry-export.js`'s own header explains. Available for a running OR ended match; a
   * `results`-phase room's log is the complete, final one.
   */
  router.get('/rooms/:roomId/log', (req, res) => {
    const room = matchManager.getRoom(req.params.roomId);
    if (!room) {
      res.status(404).json({ error: 'room_not_found' });
      return;
    }
    res.json(buildMatchLog(room.match));
  });

  /** PRD §24 balance figures, derived from the same match — see `buildMatchSummary`'s header. */
  router.get('/rooms/:roomId/summary', (req, res) => {
    const room = matchManager.getRoom(req.params.roomId);
    if (!room) {
      res.status(404).json({ error: 'room_not_found' });
      return;
    }
    res.json(buildMatchSummary(room.match));
  });

  /**
   * PRD §13 "Development-only bot/local match creation". `bot: true` (STORY-017) seats a bot
   * opponent in the second seat, so a single developer — or a solo player, PRD §12's other
   * named use for this — gets a real 1v1 match without a second human. `smoke-phases.mjs` and
   * `check-match-lifecycle.mjs` both pin the OLD default (`bot` omitted or `false`: a single
   * seat, `requiredPlayers: 1`, lobby ends the instant that one player readies up) — that
   * default is UNCHANGED, so this is a strictly additive, opt-in widening (design Decision 7's
   * own append-never-rename spirit, applied to an endpoint instead of a message type).
   *
   * The bot itself is attached and JOINS its seat before this handler returns, through the
   * same `join_room` -> `message-router.js` path any real client uses (`bot-controller.js`'s
   * own header) — so by the time this response reaches the caller, `playerCount`/
   * `connectedCount` in the body already count the bot, exactly as they would a second human
   * who had already connected.
   */
  router.post('/dev/match', (req, res) => {
    const seed = typeof req.body?.seed === 'string' ? req.body.seed : undefined;
    const phasePreset = matchManager.normalizePhasePreset(req.body?.phasePreset);
    const bot = req.body?.bot === true;
    const difficulty = bot ? normalizeBotDifficulty(req.body?.difficulty) : null;
    const room = matchManager.createRoom({
      ...(seed ? { seed } : {}),
      phasePreset,
      requiredPlayers: bot ? 2 : 1,
    });
    if (bot) attachBot(room, { difficulty });
    res.status(201).json({
      ...matchManager.roomStatus(room),
      bot,
      ...(bot ? { botDifficulty: difficulty } : {}),
      note: bot
        ? 'development match with a bot opponent seated (STORY-017)'
        : 'single-seat development match; pass {"bot": true} for a bot opponent',
    });
  });

  return router;
}
