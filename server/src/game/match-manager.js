// Creates and tracks matches, one per room. PRD §12 "Room flow" steps 1-4.

import { randomUUID } from 'node:crypto';
import { Match } from './match.js';
import { randomSeed } from './rng.js';
import {
  PHASE_DURATIONS_MS,
  PLAYERS_PER_MATCH,
  INVITE_TOKEN_EXPIRY_MS,
} from '../../../shared/constants/tuning.js';
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

/**
 * STORY-024. `room.id` (`room_0001`, ...) is a small sequential counter — fine as a lookup
 * key, useless as a secret. `hostDisplayName` is free text a stranger will read on an invite
 * screen, so it is trimmed and capped the same modest length a chat display name would be,
 * never trusted verbatim into HTML by the client (React already escapes it) but still worth
 * bounding here so one room object cannot carry an unbounded string forever.
 */
const HOST_DISPLAY_NAME_MAX = 40;

function normalizeHostDisplayName(value) {
  if (typeof value !== 'string') return 'Host';
  const trimmed = value.trim().slice(0, HOST_DISPLAY_NAME_MAX);
  return trimmed.length > 0 ? trimmed : 'Host';
}

/**
 * @param {object} [options]
 * @param {string} [options.seed]
 * @param {string} [options.phasePreset]
 * @param {number} [options.requiredPlayers]
 * @param {'dev'|'private_human'} [options.mode] STORY-024. `'dev'` (the default) is the
 *   pre-existing bare room — `POST /dev/match`, the bot flow, every `scripts/check-*.mjs`
 *   caller, and `check-match-lifecycle.mjs`'s own "lobby drop frees the seat" assertion all
 *   construct one of these and must keep behaving exactly as before. `'private_human'` is
 *   PRD §12's actual invite flow: it additionally gets a non-guessable `inviteToken`, an
 *   expiry, and `holdLobbySeatsDuringGrace` on its `Match` (see match.js's own comment on
 *   why a lobby drop is NOT simply "somebody else can take that seat" here).
 * @param {string} [options.hostDisplayName] STORY-024. `'private_human'` only.
 * @param {string} [options.marketId] STORY-025. Forwarded to `Match` verbatim — see that
 *   constructor's own comment on the fallback-to-drawn-market behavior for an unknown id.
 */
export function createRoom({
  seed = randomSeed(),
  phasePreset = 'prototype',
  requiredPlayers = PLAYERS_PER_MATCH,
  mode = 'dev',
  hostDisplayName,
  marketId,
} = {}) {
  const id = nextRoomId();
  const isPrivateInvite = mode === 'private_human';
  // One `Date.now()` read, reused for both `createdAt` and `inviteExpiresAt` — two separate
  // reads a statement apart can differ by a millisecond, which would make "expires exactly
  // INVITE_TOKEN_EXPIRY_MS after creation" a lie by a rounding error nobody could reproduce.
  const now = Date.now();
  const match = new Match({
    id,
    seed,
    phasePreset,
    requiredPlayers,
    holdLobbySeatsDuringGrace: isPrivateInvite,
    marketId,
  });
  const room = {
    id,
    seed,
    createdAt: now,
    match,
    sockets: new Set(),
    mode,
    hostDisplayName: isPrivateInvite ? normalizeHostDisplayName(hostDisplayName) : null,
    // `randomUUID()`, NOT `rng.js#randomSeed` — the seed stream is deliberately reproducible
    // from a short string (Decision 6/18's whole point); an invite token is deliberately the
    // opposite of that. Cryptographically strong, `node:crypto`, no new dependency.
    inviteToken: isPrivateInvite ? randomUUID() : null,
    inviteExpiresAt: isPrivateInvite ? now + INVITE_TOKEN_EXPIRY_MS : null,
    // Set by `cancelRoom` below. A canceled room is left in the store (no SQLite yet to persist
    // "this used to exist", and PRD names no room-GC story) so a stale join attempt gets a
    // legible `invite_canceled` rather than `room_not_found`.
    canceled: false,
  };
  store.createRoom(room);
  console.log(
    `[match] created ${id} seed=${seed} preset=${phasePreset} seats=${requiredPlayers} ` +
      `mode=${mode} market=${match.config.marketId}`,
  );
  return room;
}

export function getRoom(roomId) {
  return store.getRoom(roomId);
}

/** STORY-024. Null when no room owns that token — the caller reports `invite_not_found`. */
export function getRoomByInviteToken(token) {
  return store.getRoomByInviteToken(token);
}

/**
 * STORY-024. One word summarizing a room for a client that has no reason to interpret
 * `match.phase`/`ended`/`canceled` separately. Not authoritative on its own — `roomStatus()`
 * below still carries every underlying field too, this is a convenience projection of them.
 */
function deriveStatus(room) {
  if (room.canceled) return 'canceled';
  if (room.match.ended) return 'ended';
  if (room.match.phase !== 'lobby') return 'active';
  return room.match.players.size < room.match.requiredPlayers ? 'waiting_for_opponent' : 'ready';
}

/**
 * @param {object} room
 * @param {object} [options]
 * @param {boolean} [options.includeInvite] STORY-024. `inviteToken`/`joinUrl` are secrets —
 *   the whole point of a private-invite room is that only someone holding the token can take
 *   the open seat. `roomId` is sequential and guessable (`room_0001`), so a generic
 *   `GET /api/rooms/:roomId` (or `by-invite/:token`, which already required the correct token
 *   to reach this room in the first place) must NOT re-serialize the raw token on every call —
 *   only the one response that mints it, `POST /api/rooms`, passes `includeInvite: true`.
 */
export function roomStatus(room, { includeInvite = false } = {}) {
  const { match } = room;
  return {
    id: room.id,
    seed: room.seed,
    createdAt: room.createdAt,
    mode: room.mode,
    status: deriveStatus(room),
    hostDisplayName: room.hostDisplayName,
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
    canceled: room.canceled,
    inviteExpiresAt: room.inviteExpiresAt,
    ...(includeInvite && room.inviteToken ? { inviteToken: room.inviteToken } : {}),
  };
}

export function listRoomStatuses() {
  return store.listRooms().map((room) => roomStatus(room));
}

/**
 * STORY-025. The real `match_snapshot` a viewer receives, PLUS the room's own bot roster —
 * the one fact `Match#toSnapshot` cannot supply on its own, since a bot (`bot-controller.js
 * #attachBot`) is attached to the ROOM (`room.bots`), not to the `Match`. Kept as a thin
 * wrapper rather than teaching `match.js` about bots at all: that file's own header is explicit
 * that later stories register a SYSTEM rather than editing it directly, and `room.bots` already
 * lives entirely outside `Match` for exactly the "bot is a client, not a privileged branch"
 * reason `bot-controller.js`'s header gives.
 *
 * `bots` IS ONLY EVER ADDED FOR A `mode: 'solo_bot'` ROOM — every other room (`'dev'`,
 * `'private_human'`) gets `Match#toSnapshot`'s own output back UNTOUCHED, byte-identical to
 * before this story. This gate is load-bearing, not cosmetic: `scripts/smoke-bot.mjs`'s own
 * comment on `POST /dev/match` is explicit that "What must never happen is the marker
 * [bot: true] reaching a WebSocket message" — STORY-017 AC1 requires a bare dev/bot room to be
 * indistinguishable, ON THE WIRE, from two real humans, so a developer/tester exercises the
 * identical client code path a real match would. Merging `bots` into EVERY room's snapshot
 * would silently break that guarantee the instant this story landed. A `mode: 'solo_bot'` room
 * is the opposite case ON PURPOSE: the player who created it explicitly chose "Play vs Bot" from
 * the menu, so naming the bot IS this story's own AC ("identifies the bot opponent by name/
 * profile rather than showing generic 'Player 2'"). `POST /dev/match` is untouched by this
 * story and still creates `mode: 'dev'` rooms exclusively, so this gate can never fire for it.
 *
 * `bots` is top-level, not under `you`, for the rooms it DOES apply to — both viewers see the
 * identical array (which playerId is a bot, and its difficulty/profile id), the same public/
 * private split every other top-level `match_snapshot` field already follows.
 *
 * `simulation-loop.js`'s real broadcast calls this; so does `scripts/check-bot-menu.mjs`, so
 * the shape a check exercises and the shape a client actually receives can never quietly
 * diverge (the same reasoning `match.toSnapshot` itself documents for why it is called from
 * exactly one production site).
 */
export function buildSnapshot(room, viewerPlayerId = null) {
  const snapshot = room.match.toSnapshot(viewerPlayerId);
  if (room.mode !== 'solo_bot') return snapshot;
  return {
    ...snapshot,
    bots: (room.bots ?? []).map((bot) => ({ playerId: bot.playerId, difficulty: bot.difficulty })),
  };
}

/**
 * STORY-024. The gate a FRESH (non-reconnect) `join_room` — or the read-only
 * `GET /api/rooms/by-invite/:token` lookup — must pass before `Match#join` ever runs. Kept
 * entirely separate from `Match#join`'s own `match_full`/`match_ended` checks: those are
 * generic 1v1-seating rules every room (dev, bot, private) has always had; this is the
 * invite-specific layer PRD §12's private flow adds on top, and a `'dev'`/bot room (no
 * `inviteToken`) skips it outright — `join_room` without a token keeps working for every
 * existing caller (`bot-controller.js`, every `scripts/check-*.mjs`, `POST /dev/match`)
 * exactly as before.
 *
 * A player who already holds a disconnected seat and is presenting THEIR OWN reconnect token
 * bypasses this: they were already let in once, by the invite that got them their seat in the
 * first place. Checked before every other reason so a legitimate reclaim is never blocked by,
 * say, the invite having since expired — a race that is about the room's INVITE, not about
 * whether this particular seat-holder may come back to a seat they already have.
 *
 * Order below is deliberately specific-fact-first: `canceled`/`expired`/`already_started` are
 * facts about the ROOM regardless of what token was presented, so they are checked before the
 * token itself is compared — a client should learn "this invite is dead" rather than "you
 * typed the code wrong" when both are true.
 *
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateInvite(room, { inviteToken = null, requestedPlayerId = null } = {}) {
  if (!room.inviteToken) return { ok: true };

  if (requestedPlayerId) {
    const existing = room.match.players.get(requestedPlayerId);
    if (existing && !existing.connected) return { ok: true };
  }

  if (room.canceled) return { ok: false, error: 'invite_canceled' };
  if (Date.now() > room.inviteExpiresAt) return { ok: false, error: 'invite_expired' };
  if (room.match.phase !== 'lobby') return { ok: false, error: 'already_started' };
  if (room.match.players.size >= room.match.requiredPlayers) return { ok: false, error: 'match_full' };
  if (inviteToken !== room.inviteToken) return { ok: false, error: 'invite_token_mismatch' };
  return { ok: true };
}

/**
 * STORY-024. `GET /api/rooms/by-invite/:token` — resolve a bare token (no `roomId`, per the
 * `/join/:token` route's own URL shape) to its room, applying the same room-level facts
 * `validateInvite` does MINUS the reconnect bypass and the token-match check (redundant: the
 * caller only reached this room by presenting the right token in the first place).
 *
 * @returns {{ok: true, room: object} | {ok: false, error: string}}
 */
export function resolveInvite(token) {
  const room = getRoomByInviteToken(token);
  if (!room) return { ok: false, error: 'invite_not_found' };
  if (room.canceled) return { ok: false, error: 'invite_canceled' };
  if (Date.now() > room.inviteExpiresAt) return { ok: false, error: 'invite_expired' };
  if (room.match.phase !== 'lobby') return { ok: false, error: 'already_started' };
  if (room.match.players.size >= room.match.requiredPlayers) return { ok: false, error: 'match_full' };
  return { ok: true, room };
}

/**
 * STORY-024. The host changing their mind before anyone (or before a still-lobby-phase guest)
 * finishes joining. No account system exists to check "is this caller really the host" against
 * (PRD's MVP has none) — the same trust level `join_room`'s reconnect token already documents
 * as "trust-on-first-use... MUST become a signed session token before any public deployment".
 * Canceling does not delete the room (no room-GC story exists yet either): a stale join
 * attempt against a canceled room should see `invite_canceled`, not `room_not_found`, which is
 * a different, more confusing claim ("did I even have the right link?").
 *
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function cancelRoom(room) {
  if (!room.inviteToken) return { ok: false, error: 'not_cancelable' };
  if (room.canceled) return { ok: false, error: 'invite_canceled' };
  if (room.match.ended) return { ok: false, error: 'match_ended' };
  if (room.match.phase !== 'lobby') return { ok: false, error: 'already_started' };
  room.canceled = true;
  console.log(`[match] canceled ${room.id}`);
  return { ok: true };
}
