// Creates and tracks matches, one per room. PRD §12 "Room flow" steps 1-4.

import { Match } from './match.js';
import { randomSeed } from './rng.js';
import { PHASE_DURATIONS_MS, PLAYERS_PER_MATCH } from '../../../shared/constants/tuning.js';
import * as store from '../persistence/in-memory-store.js';

let roomCounter = 0;

function nextRoomId() {
  roomCounter += 1;
  return `room_${roomCounter.toString().padStart(4, '0')}`;
}

/** A phase preset name the caller may have made up, coerced to one that exists. */
export function normalizePhasePreset(value, fallback = 'prototype') {
  return typeof value === 'string' && PHASE_DURATIONS_MS[value] ? value : fallback;
}

export function createRoom({
  seed = randomSeed(),
  phasePreset = 'prototype',
  requiredPlayers = PLAYERS_PER_MATCH,
} = {}) {
  const id = nextRoomId();
  const match = new Match({ id, seed, phasePreset, requiredPlayers });
  const room = { id, seed, createdAt: Date.now(), match, sockets: new Set() };
  store.createRoom(room);
  console.log(
    `[match] created ${id} seed=${seed} preset=${phasePreset} seats=${requiredPlayers} ` +
      `market=${match.config.marketId}`,
  );
  return room;
}

export function getRoom(roomId) {
  return store.getRoom(roomId);
}

export function roomStatus(room) {
  const { match } = room;
  return {
    id: room.id,
    seed: room.seed,
    createdAt: room.createdAt,
    phase: match.phase,
    phasePreset: match.phasePreset,
    // PRD §12 step 4, and the reproducibility criterion: same seed, same market.
    marketId: match.config.marketId,
    timeRemainingMs: match.timeRemainingMs,
    serverTime: Math.round(match.elapsedMs),
    requiredPlayers: match.requiredPlayers,
    playerCount: match.players.size,
    connectedCount: [...match.players.values()].filter((p) => p.connected).length,
    readyCount: [...match.players.values()].filter((p) => p.ready).length,
    ended: match.ended,
    endReason: match.endReason,
  };
}

export function listRoomStatuses() {
  return store.listRooms().map(roomStatus);
}
