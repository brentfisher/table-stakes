#!/usr/bin/env node
// Private invite/lobby check — STORY-024's acceptance criteria, in process.
//
// Same style as `check-match-lifecycle.mjs` (which already owns the CLOCK half of this story —
// the lobby-seat-hold grace timing below reuses its synthetic `dtMs` stepping, not a real
// `setTimeout`, for the same reason: proving a 30-second grace window should not cost 30 real
// seconds). This script owns everything STORY-024 actually ADDS: `matchManager.createRoom`'s
// invite-token/expiry/host-name fields, `validateInvite`/`resolveInvite`/`cancelRoom`'s error
// codes, and the `holdLobbySeatsDuringGrace` opt-in that lets a private-invite room's lobby
// drop behave differently from every existing dev/bot room's (which `check-match-lifecycle.mjs`
// already pins as "releases the seat instead of holding it" and which this script re-confirms
// is UNCHANGED for a room created without `mode: 'private_human'`).
//
// WHAT THIS SCRIPT DOES NOT COVER: the actual WebSocket `join_room`/HTTP `POST /api/rooms`
// wire contract — that is `scripts/smoke-invite-lobby.mjs`, in the style of `smoke-phases.mjs`.
//
// Run: node scripts/check-invite-lobby.mjs

import * as matchManager from '../server/src/game/match-manager.js';
import { RECONNECT_GRACE_MS, INVITE_TOKEN_EXPIRY_MS } from '../shared/constants/tuning.js';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const realLog = console.log;
function quiet(fn) {
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = realLog;
  }
}

console.log('Private invite/lobby check\n');

// --- 1. createRoom({mode: 'private_human'}) mints the invite fields ---------------------
{
  const room = quiet(() =>
    matchManager.createRoom({ mode: 'private_human', hostDisplayName: '  Brent Fisher  ' }),
  );
  check(
    'a private_human room gets a non-guessable inviteToken, an expiry, and a normalized host name',
    typeof room.inviteToken === 'string' &&
      room.inviteToken.length >= 16 &&
      room.inviteExpiresAt === room.createdAt + INVITE_TOKEN_EXPIRY_MS &&
      room.hostDisplayName === 'Brent Fisher',
    `token=${room.inviteToken} expiresAt=${room.inviteExpiresAt} host="${room.hostDisplayName}"`,
  );

  const blank = quiet(() => matchManager.createRoom({ mode: 'private_human', hostDisplayName: '   ' }));
  check(
    'a blank/missing hostDisplayName falls back to "Host" rather than an empty string',
    blank.hostDisplayName === 'Host',
    blank.hostDisplayName,
  );

  const status = matchManager.roomStatus(room);
  const statusWithInvite = matchManager.roomStatus(room, { includeInvite: true });
  check(
    'roomStatus never re-serializes the raw inviteToken unless includeInvite is explicitly passed',
    !('inviteToken' in status) && statusWithInvite.inviteToken === room.inviteToken,
    JSON.stringify({ status, statusWithInvite }),
  );
  check(
    'roomStatus reports the PRD contract fields: waiting_for_opponent status and the room mode',
    status.status === 'waiting_for_opponent' && status.mode === 'private_human',
    JSON.stringify(status),
  );

  const dev = quiet(() => matchManager.createRoom());
  const devStatus = matchManager.roomStatus(dev);
  check(
    'a room created without mode: "private_human" (every pre-existing caller) gets no invite gating at all',
    dev.inviteToken === null &&
      dev.inviteExpiresAt === null &&
      dev.mode === 'dev' &&
      devStatus.hostDisplayName === null &&
      matchManager.validateInvite(dev, {}).ok === true,
    JSON.stringify(devStatus),
  );
}

// --- 2. validateInvite: each rejection gets its own, specific code ----------------------
{
  const room = quiet(() => matchManager.createRoom({ mode: 'private_human' }));
  const goodToken = room.inviteToken;

  check(
    'a mismatched token is refused as invite_token_mismatch',
    matchManager.validateInvite(room, { inviteToken: 'not-the-real-token' }).error ===
      'invite_token_mismatch',
  );
  check(
    'the correct token is accepted',
    matchManager.validateInvite(room, { inviteToken: goodToken }).ok === true,
  );

  // Seat both players (host + one guest) directly on the match, the same way message-router.js
  // does after validateInvite passes — this script owns the invite gate, not Match#join's own
  // seat bookkeeping (check-match-lifecycle.mjs already owns that).
  room.match.join({ fallbackPlayerId: 'host' });
  room.match.join({ fallbackPlayerId: 'guest' });
  check(
    'a third, fresh join against a full 1v1 room is refused as match_full, not invite_token_mismatch',
    matchManager.validateInvite(room, { inviteToken: goodToken }).error === 'match_full',
  );

  const reconnecting = quiet(() => matchManager.createRoom({ mode: 'private_human' }));
  reconnecting.match.join({ fallbackPlayerId: 'host' });
  reconnecting.match.removePlayer('host');
  check(
    'a disconnected seat-holder redeeming their OWN reconnect token bypasses the invite gate entirely',
    matchManager.validateInvite(reconnecting, {
      requestedPlayerId: 'host',
      inviteToken: 'wrong-token-does-not-matter',
    }).ok === true,
  );

  const canceled = quiet(() => matchManager.createRoom({ mode: 'private_human' }));
  matchManager.cancelRoom(canceled);
  check(
    'a canceled room refuses a fresh join as invite_canceled',
    matchManager.validateInvite(canceled, { inviteToken: canceled.inviteToken }).error ===
      'invite_canceled',
  );

  const expired = quiet(() => matchManager.createRoom({ mode: 'private_human' }));
  expired.inviteExpiresAt = Date.now() - 1;
  check(
    'an expired invite refuses a fresh join as invite_expired',
    matchManager.validateInvite(expired, { inviteToken: expired.inviteToken }).error ===
      'invite_expired',
  );

  const started = quiet(() => matchManager.createRoom({ mode: 'private_human', phasePreset: 'smoke' }));
  started.match.join({ fallbackPlayerId: 'host' });
  started.match.join({ fallbackPlayerId: 'guest' });
  started.match.setReady('host', true);
  started.match.setReady('guest', true);
  started.match.advanceClock(1);
  check(
    'a room whose match already left lobby refuses a further fresh join as already_started, not match_full',
    started.match.phase !== 'lobby' &&
      matchManager.validateInvite(started, { inviteToken: started.inviteToken }).error ===
        'already_started',
    `phase=${started.match.phase}`,
  );
}

// --- 3. resolveInvite: the /join/:token HTTP lookup, token-agnostic once it has the room ----
{
  check(
    'an unrecognized token resolves to invite_not_found',
    matchManager.resolveInvite('no-such-token').error === 'invite_not_found',
  );

  const room = quiet(() => matchManager.createRoom({ mode: 'private_human' }));
  const resolved = matchManager.resolveInvite(room.inviteToken);
  check(
    'the correct token resolves to the room itself',
    resolved.ok === true && resolved.room.id === room.id,
  );

  const canceled = quiet(() => matchManager.createRoom({ mode: 'private_human' }));
  matchManager.cancelRoom(canceled);
  check(
    'resolveInvite reflects a cancellation the same way validateInvite does',
    matchManager.resolveInvite(canceled.inviteToken).error === 'invite_canceled',
  );
}

// --- 4. cancelRoom: host-initiated, only while unfilled/lobby ----------------------------
{
  const dev = quiet(() => matchManager.createRoom());
  check(
    'a dev/bot room (no inviteToken) cannot be canceled — the endpoint is invite-flow-only',
    matchManager.cancelRoom(dev).error === 'not_cancelable',
  );

  const room = quiet(() => matchManager.createRoom({ mode: 'private_human' }));
  const first = matchManager.cancelRoom(room);
  const second = matchManager.cancelRoom(room);
  check(
    'canceling twice is refused the second time, not silently re-accepted',
    first.ok === true && second.ok === false && second.error === 'invite_canceled',
  );

  const started = quiet(() => matchManager.createRoom({ mode: 'private_human', phasePreset: 'smoke' }));
  started.match.join({ fallbackPlayerId: 'host' });
  started.match.join({ fallbackPlayerId: 'guest' });
  started.match.setReady('host', true);
  started.match.setReady('guest', true);
  started.match.advanceClock(1);
  check(
    'a room whose match already started cannot be canceled',
    matchManager.cancelRoom(started).error === 'already_started',
    `phase=${started.match.phase}`,
  );
}

// --- 5. the lobby-seat-hold grace period only applies to a private-invite room ------------
{
  // A private_human room: a lobby drop is HELD, not released, until RECONNECT_GRACE_MS elapses
  // — the AC this story adds ("reconnect grace ... exposed to the lobby ... not just mid-match").
  const room = quiet(() =>
    matchManager.createRoom({ mode: 'private_human', phasePreset: 'prototype' }),
  );
  room.match.join({ fallbackPlayerId: 'host' });
  room.match.join({ fallbackPlayerId: 'guest' });
  room.match.removePlayer('guest');

  const heldStillFull = matchManager.validateInvite(room, { inviteToken: room.inviteToken });
  check(
    'immediately after a lobby drop, the seat is still held — a fresh join still sees match_full',
    room.match.players.size === 2 &&
      room.match.players.get('guest')?.connected === false &&
      heldStillFull.error === 'match_full',
    JSON.stringify(heldStillFull),
  );

  // Reclaiming within the grace window works exactly like a mid-match reconnect.
  const reclaim = room.match.join({ requestedPlayerId: 'guest', fallbackPlayerId: 'someone-else' });
  check(
    'the disconnected guest can reclaim their own slot within the grace window, before the match starts',
    reclaim.ok === true && reclaim.reconnected === true && reclaim.player.playerId === 'guest',
    JSON.stringify(reclaim),
  );

  // Now let the grace window actually elapse (synthetic dtMs, same technique
  // check-match-lifecycle.mjs uses for its 30-second window) and confirm the seat frees up.
  room.match.removePlayer('guest');
  quiet(() => room.match.advanceClock(RECONNECT_GRACE_MS + 1000));
  const afterGrace = matchManager.validateInvite(room, { inviteToken: room.inviteToken });
  check(
    'once the grace window actually elapses, the seat is freed for a fresh join — the room did not end',
    room.match.players.size === 1 && !room.match.ended && afterGrace.ok === true,
    `players=${[...room.match.players.keys()].join(',')} ended=${room.match.ended} afterGrace=${JSON.stringify(afterGrace)}`,
  );

  // A plain dev/bot room is completely unaffected — same assertion check-match-lifecycle.mjs's
  // own "a drop during lobby releases the seat instead of holding it" makes, re-confirmed here
  // because it is the one behaviour this story's new `holdLobbySeatsDuringGrace` flag could
  // regress for every OTHER kind of room if the default were wrong.
  const dev = quiet(() => matchManager.createRoom());
  dev.match.join({ fallbackPlayerId: 'p1' });
  dev.match.join({ fallbackPlayerId: 'p2' });
  dev.match.removePlayer('p2');
  const replacement = dev.match.join({ fallbackPlayerId: 'p3' });
  check(
    'a dev/bot room lobby drop still releases the seat instantly, unaffected by holdLobbySeatsDuringGrace',
    replacement.ok === true && dev.match.players.size === 2 && dev.match.players.has('p3'),
    [...dev.match.players.keys()].join(', '),
  );
}

// --- 6. both seats of one private_human room share one seed/market -----------------------
// AC: "confirm with a check, don't re-derive it" — `matchManager.createRoom` builds exactly one
// `Match` per room regardless of `mode`, so this is a structural invariant, not new logic; the
// assertion exists so a future refactor that gave a private room a second internal Match (e.g.
// per-seat) would fail loudly here.
{
  const room = quiet(() => matchManager.createRoom({ mode: 'private_human' }));
  const host = room.match.join({ fallbackPlayerId: 'host' });
  const guest = room.match.join({ fallbackPlayerId: 'guest' });
  check(
    'the host and guest join the SAME Match instance — identical seed and market by construction',
    host.ok &&
      guest.ok &&
      room.match.seed === room.seed &&
      room.match.players.has('host') &&
      room.match.players.has('guest'),
    `seed=${room.seed} market=${room.match.config.marketId}`,
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
