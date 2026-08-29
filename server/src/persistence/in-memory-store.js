// In-memory storage. PRD §13 "Server stack": in-memory for MVP; SQLite/Postgres only once
// persistent profiles or match history are actually required. No database here on purpose.

const rooms = new Map();

export function createRoom(room) {
  rooms.set(room.id, room);
  return room;
}

export function getRoom(roomId) {
  return rooms.get(roomId) ?? null;
}

export function listRooms() {
  return [...rooms.values()];
}

export function deleteRoom(roomId) {
  return rooms.delete(roomId);
}

export function clear() {
  rooms.clear();
}
