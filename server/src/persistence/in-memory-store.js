// In-memory storage. PRD §13 "Server stack": in-memory for MVP; SQLite/Postgres only once
// persistent profiles or match history are actually required. No database here on purpose.

const rooms = new Map();

// STORY-024. A private-invite room must be reachable by its `inviteToken` alone — the guest's
// `/join/:token` URL carries no room id (see routes.js's own comment on why: `roomId` is a
// small sequential counter, `room_0001`, and is NOT the secret; the token is). A second index
// keyed by token, not a scan over `rooms.values()`, keeps that lookup O(1) as the room map
// grows over a long-running server. Kept in lockstep with `rooms` by `createRoom`/`deleteRoom`
// below — there is no third caller of either map.
const roomsByInviteToken = new Map();

export function createRoom(room) {
  rooms.set(room.id, room);
  if (room.inviteToken) roomsByInviteToken.set(room.inviteToken, room.id);
  return room;
}

export function getRoom(roomId) {
  return rooms.get(roomId) ?? null;
}

/** STORY-024. Null for an unrecognized token — the caller reports `invite_not_found`. */
export function getRoomByInviteToken(token) {
  const roomId = roomsByInviteToken.get(token);
  return roomId ? getRoom(roomId) : null;
}

export function listRooms() {
  return [...rooms.values()];
}

export function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (room?.inviteToken) roomsByInviteToken.delete(room.inviteToken);
  return rooms.delete(roomId);
}

export function clear() {
  rooms.clear();
  roomsByInviteToken.clear();
}
