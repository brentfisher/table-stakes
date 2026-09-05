// PRD §13 "Suggested HTTP endpoints". The actual game session uses WebSockets, not REST
// polling — these exist for room creation, health, and development.

import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as matchManager from '../game/match-manager.js';
import { catalogue, publicMarket } from '../game/catalogue.js';
import { attachBot, normalizeBotDifficulty } from '../game/bot/bot-controller.js';
import { buildMatchLog, buildMatchSummary } from '../game/telemetry-export.js';
import { THREE_VERSION, PHASE_DURATIONS_MS, PHASE_PRESETS } from '../../../shared/constants/tuning.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '../../package.json'), 'utf8'));

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

  router.post('/rooms', (req, res) => {
    const seed = typeof req.body?.seed === 'string' ? req.body.seed : undefined;
    const phasePreset = matchManager.normalizePhasePreset(req.body?.phasePreset);
    const room = matchManager.createRoom({ ...(seed ? { seed } : {}), phasePreset });
    res.status(201).json(matchManager.roomStatus(room));
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
