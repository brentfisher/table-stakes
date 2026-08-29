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
      room.match.removePlayer(record.playerId);
    }
  }
  connections.delete(ws);
  return record;
}

export function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

export function broadcast(room, message) {
  const payload = JSON.stringify(message);
  for (const ws of room.sockets) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}
