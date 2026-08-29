// Dispatches inbound JSON messages on their `type` field. PRD §12: JSON initially, for
// speed of development and debuggability.
//
// SCOPE (STORY-001): only `join_room` and `player_input` are implemented. Every other
// declared client message type is rejected with a clear error until its story lands —
// an unimplemented type must not be silently ignored.

import { CLIENT_MESSAGE_TYPES, IMPLEMENTED_CLIENT_MESSAGE_TYPES } from '../../../shared/schemas/messages.js';
import * as connections from './connection-manager.js';
import * as matchManager from '../game/match-manager.js';

export function routeMessage(ws, raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    connections.send(ws, { type: 'error', error: 'invalid_json' });
    return;
  }

  if (!message || typeof message.type !== 'string') {
    connections.send(ws, { type: 'error', error: 'missing_type' });
    return;
  }
  if (!CLIENT_MESSAGE_TYPES.includes(message.type)) {
    connections.send(ws, { type: 'error', error: 'unknown_type', receivedType: message.type });
    return;
  }
  if (!IMPLEMENTED_CLIENT_MESSAGE_TYPES.includes(message.type)) {
    connections.send(ws, { type: 'error', error: 'not_implemented', receivedType: message.type });
    return;
  }

  const record = connections.get(ws);
  if (!record) return;

  switch (message.type) {
    case 'join_room':
      return handleJoinRoom(ws, record, message);
    case 'player_input':
      return handlePlayerInput(record, message);
    default:
      return undefined;
  }
}

function handleJoinRoom(ws, record, message) {
  const room = message.roomId ? matchManager.getRoom(message.roomId) : matchManager.createRoom();
  if (!room) {
    connections.send(ws, { type: 'error', error: 'room_not_found', roomId: message.roomId });
    return;
  }
  connections.attachToRoom(ws, room);
  room.match.addPlayer(record.playerId);
  connections.send(ws, {
    type: 'joined',
    roomId: room.id,
    playerId: record.playerId,
    seed: room.seed,
    layoutId: room.match.config.layoutId,
  });
  console.log(`[ws] ${record.playerId} joined ${room.id} (${room.match.players.size} in match)`);
}

function handlePlayerInput(record, message) {
  if (!record.roomId) return;
  const room = matchManager.getRoom(record.roomId);
  if (!room) return;
  room.match.applyInput(record.playerId, message);
}
