// PRD §13 "Suggested HTTP endpoints". The actual game session uses WebSockets, not REST
// polling — these exist for room creation, health, and development.

import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as matchManager from '../game/match-manager.js';
import { catalogue, publicMarket } from '../game/catalogue.js';
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
   * PRD §13 "Development-only bot/local match creation". A dev match seats ONE player, so a
   * single developer can drive the whole PRD §5 lifecycle without a second human: the lobby
   * ends as soon as that one player readies up. The bot that would occupy the other seat is
   * STORY-017; when it lands it takes the second seat and `requiredPlayers` goes back to 2.
   */
  router.post('/dev/match', (req, res) => {
    const seed = typeof req.body?.seed === 'string' ? req.body.seed : undefined;
    const phasePreset = matchManager.normalizePhasePreset(req.body?.phasePreset);
    const room = matchManager.createRoom({
      ...(seed ? { seed } : {}),
      phasePreset,
      requiredPlayers: 1,
    });
    res.status(201).json({
      ...matchManager.roomStatus(room),
      bot: false,
      note: 'single-seat development match; the bot opponent lands with STORY-017',
    });
  });

  return router;
}
