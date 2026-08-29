// PRD §13 "Suggested HTTP endpoints". The actual game session uses WebSockets, not REST
// polling — these exist for room creation, health, and development.

import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as matchManager from '../game/match-manager.js';
import { THREE_VERSION } from '../../../shared/constants/tuning.js';

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

  // Development/debug market definitions. STORY-002 adds markets.json; until then this
  // reports that the catalogue is not present rather than inventing one.
  router.get('/markets', (_req, res) => {
    res.status(501).json({ error: 'not_implemented', note: 'markets.json lands with STORY-002' });
  });

  router.post('/rooms', (req, res) => {
    const seed = typeof req.body?.seed === 'string' ? req.body.seed : undefined;
    const phasePreset = req.body?.phasePreset === 'full' ? 'full' : 'prototype';
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

  // Development-only local/bot match creation. The bot itself is STORY-017; this endpoint
  // exists now so that story has a defined entry point.
  router.post('/dev/match', (req, res) => {
    const seed = typeof req.body?.seed === 'string' ? req.body.seed : undefined;
    const room = matchManager.createRoom({ ...(seed ? { seed } : {}) });
    res.status(201).json({ ...matchManager.roomStatus(room), bot: false, note: 'bot opponent lands with STORY-017' });
  });

  return router;
}
