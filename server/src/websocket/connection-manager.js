// Tracks socket <-> player <-> room association and broadcasts to a room's sockets.

const connections = new Map(); // ws -> { playerId, roomId }

let playerCounter = 0;
function nextPlayerId() {
  playerCounter += 1;
  return `player_${playerCounter}`;
}

export function register(ws) {
  const record = { playerId: nextPlayerId(), roomId: null };
  connections.set(ws, record);
  return record;
}

export function get(ws) {
  return connections.get(ws) ?? null;
}

/**
 * Re-point a socket at an existing player id. Used when a reconnecting client redeems its
 * `join_room.playerId` token: the socket is new, the player is not.
 */
export function setPlayerId(ws, playerId) {
  const record = connections.get(ws);
  if (!record) return null;
  record.playerId = playerId;
  return record;
}

export function attachToRoom(ws, room) {
  const record = connections.get(ws);
  if (!record) return null;
  record.roomId = room.id;
  room.sockets.add(ws);
  return record;
}

export function unregister(ws, { getRoom }) {
  const record = connections.get(ws);
  if (!record) return null;
  if (record.roomId) {
    const room = getRoom(record.roomId);
    if (room) {
      room.sockets.delete(ws);
      // Holds the player through the reconnect grace period rather than dropping them.
      room.match.removePlayer(record.playerId);
    }
  }
  connections.delete(ws);
  return record;
}

export function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

/** One identical payload to every socket in the room. For public messages only. */
export function broadcast(room, message) {
  const payload = JSON.stringify(message);
  for (const ws of room.sockets) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

/**
 * One payload PER VIEWER, built from that socket's player id. This is how `match_snapshot`
 * is sent: PRD §18 forbids one player seeing another's setup, so the snapshot is composed
 * per player rather than composed once and sent to everyone (see `Match#toSnapshot`).
 */
export function broadcastPerViewer(room, build) {
  for (const ws of room.sockets) {
    if (ws.readyState !== ws.OPEN) continue;
    const record = connections.get(ws);
    ws.send(JSON.stringify(build(record?.playerId ?? null)));
  }
}
