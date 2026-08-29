// Dispatches inbound JSON messages on their `type` field. PRD §12: JSON initially, for
// speed of development and debuggability.
//
// SCOPE: `join_room`, `player_input` and (STORY-003) `player_ready` are implemented. Every
// other declared client message type is rejected with `not_implemented` until its story lands
// — design Decision 7: an unimplemented type must never be silently ignored.
//
// This router still does its own light coercion rather than calling
// `shared/schemas/validation.js`. That module is wired in by the story that needs payload-level
// rejection (`interact`, `setup_submit`); doing it here as a side effect of the phase clock
// would change how every existing message is rejected without a story asking for it.

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
    case 'player_ready':
      return handlePlayerReady(record, message);
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

  // Reconnect token. Honoured only for a player who is disconnected and still inside the
  // grace window — Match#join enforces that, so a token can never evict a live socket.
  const requestedPlayerId =
    typeof message.playerId === 'string' && message.playerId.length > 0 ? message.playerId : null;

  const result = room.match.join({ requestedPlayerId, fallbackPlayerId: record.playerId });
  if (!result.ok) {
    connections.send(ws, { type: 'error', error: result.error, roomId: room.id });
    console.log(`[ws] ${record.playerId} refused by ${room.id}: ${result.error}`);
    return;
  }

  connections.setPlayerId(ws, result.player.playerId);
  connections.attachToRoom(ws, room);

  connections.send(ws, {
    type: 'joined',
    roomId: room.id,
    playerId: result.player.playerId,
    seed: room.seed,
    layoutId: room.match.config.layoutId,
    marketId: room.match.config.marketId,
    phasePreset: room.match.phasePreset,
    reconnected: result.reconnected,
  });
  console.log(
    `[ws] ${result.player.playerId} ${result.reconnected ? 'reconnected to' : 'joined'} ` +
      `${room.id} (${room.match.players.size}/${room.match.requiredPlayers} in match, phase=${room.match.phase})`,
  );
}

function handlePlayerInput(record, message) {
  if (!record.roomId) return;
  const room = matchManager.getRoom(record.roomId);
  if (!room) return;
  room.match.applyInput(record.playerId, message);
}

/**
 * PRD §12 room-flow step 7 / §5 "ready up". A ready sent in a phase that does not consult
 * readiness is refused by the match; the client learns that from the very next snapshot,
 * whose `you.ready` still reads false. That is an observable answer, not silent inaction.
 */
function handlePlayerReady(record, message) {
  if (!record.roomId) return;
  const room = matchManager.getRoom(record.roomId);
  if (!room) return;
  const ready = message.ready !== false; // a bare {type:'player_ready'} means ready
  const accepted = room.match.setReady(record.playerId, ready);
  if (!accepted) {
    console.log(`[ws] ${record.playerId} ready=${ready} ignored in phase ${room.match.phase}`);
    return;
  }
  console.log(`[ws] ${record.playerId} ready=${ready} in ${room.id} (${room.match.phase})`);
}
