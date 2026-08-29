// Creates and tracks matches, one per room. PRD §12 "Room flow".

import { Match } from './match.js';
import { randomSeed } from './rng.js';
import * as store from '../persistence/in-memory-store.js';

let roomCounter = 0;

function nextRoomId() {
  roomCounter += 1;
  return `room_${roomCounter.toString().padStart(4, '0')}`;
}

export function createRoom({ seed = randomSeed(), phasePreset = 'prototype' } = {}) {
  const id = nextRoomId();
  const match = new Match({ id, seed, phasePreset });
  const room = { id, seed, createdAt: Date.now(), match, sockets: new Set() };
  store.createRoom(room);
  console.log(`[match] created ${id} seed=${seed} preset=${phasePreset} config=${JSON.stringify(match.config)}`);
  return room;
}

export function getRoom(roomId) {
  return store.getRoom(roomId);
}

export function roomStatus(room) {
  return {
    id: room.id,
    seed: room.seed,
    createdAt: room.createdAt,
    phase: room.match.phase,
    playerCount: room.match.players.size,
    connectedCount: [...room.match.players.values()].filter((p) => p.connected).length,
  };
}

export function listRoomStatuses() {
  return store.listRooms().map(roomStatus);
}
