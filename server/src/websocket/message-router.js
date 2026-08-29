// Dispatches inbound JSON messages on their `type` field. PRD §12: JSON initially, for
// speed of development and debuggability.
//
// SCOPE: `join_room`, `player_input`, (STORY-003) `player_ready` and (STORY-009)
// `setup_submit` are implemented. Every other declared client message type is rejected with
// `not_implemented` until its story lands — design Decision 7: an unimplemented type must
// never be silently ignored.
//
// STORY-003 left a note here saying `shared/schemas/validation.js` would be wired in by the
// story that needs payload-level rejection, naming `setup_submit`. This is that story, and it
// is wired in FOR `setup_submit` ONLY. `join_room` and `player_input` keep the light coercion
// they already had: changing how an existing message is rejected is a behaviour change no
// story asked for, and `smoke-milestone0.mjs` pins some of it. A setup submission is different
// — it is a structured payload with ten fields, and hand-rolling its shape check next to a
// module that already does it is how the two drift apart.

import { CLIENT_MESSAGE_TYPES, IMPLEMENTED_CLIENT_MESSAGE_TYPES } from '../../../shared/schemas/messages.js';
import { validateClientMessage } from '../../../shared/schemas/validation.js';
import * as connections from './connection-manager.js';
import * as matchManager from '../game/match-manager.js';
import { acceptSetupSubmission } from '../game/validators/setup-validator.js';

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
    case 'setup_submit':
      return handleSetupSubmit(ws, record, message);
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

/**
 * PRD §12 client-to-server example 4, PRD §7 "Setup phase".
 *
 * Two gates, in this order and for this reason (Decision 11): `validation.js` answers "is this
 * a well-formed setup_submit" and a failure is `invalid_payload`; `setup-validator.js` answers
 * "is this menu legal for this catalogue, this layout and this player's cash" and a failure is
 * `setup_rejected` with a `reason`. Collapsing them would report a $99 burger as a malformed
 * message, which tells the player nothing.
 *
 * A rejection mutates no match state — see setup-validator.js.
 */
function handleSetupSubmit(ws, record, message) {
  if (!record.roomId) return;
  const room = matchManager.getRoom(record.roomId);
  if (!room) {
    connections.send(ws, { type: 'error', error: 'room_not_found', roomId: record.roomId });
    return;
  }

  const shape = validateClientMessage(message);
  if (!shape.ok) {
    connections.send(ws, { type: 'error', error: shape.error, detail: shape.detail });
    console.log(`[ws] ${record.playerId} setup_submit malformed: ${shape.detail}`);
    return;
  }

  const result = acceptSetupSubmission(room.match, record.playerId, message);
  if (!result.ok) {
    connections.send(ws, {
      type: 'error',
      error: 'setup_rejected',
      reason: result.reason,
      detail: result.detail,
    });
    console.log(`[ws] ${record.playerId} setup_submit rejected: ${result.reason} — ${result.detail}`);
    return;
  }

  // The acceptance is not announced with a message of its own: the very next snapshot carries
  // it under `you.setup`, and readiness under `you.ready`. One authoritative channel.
  console.log(
    `[ws] ${record.playerId} setup accepted in ${room.id}: ` +
      `${result.submission.menu.map((slot) => `${slot.dishId}@${slot.price}`).join(', ')}`,
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
