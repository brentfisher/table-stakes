#!/usr/bin/env node
// Private invite/lobby smoke test — the wire-level half of STORY-024's acceptance criteria.
//
// `scripts/check-invite-lobby.mjs` already owns everything provable in-process (the invite
// error codes, the lobby-seat-hold grace timing). This one proves only what a real HTTP + two
// real sockets can: the actual `POST /api/rooms` response shape (`inviteToken`/`joinUrl`/
// `status: waiting_for_opponent`), that `GET /api/rooms/:roomId` never re-leaks the raw token
// while `GET /api/rooms/by-invite/:token` resolves it, that `join_room`'s new `inviteToken`
// field is actually wired into the router (not just `matchManager.validateInvite` in isolation),
// that both real sockets which join the same room land in the SAME match (identical seed and
// market — the AC's "confirm with a check, don't re-derive it"), and that a host's `POST
// /api/rooms/:roomId/cancel` reaches an already-connected guest's socket as a real `error`
// frame, not just a documented return value.
//
// STARTS ITS OWN SERVER on the port below and kills it again — same `lib/server-process.mjs`
// pattern as every other smoke script. Point it at an already-running server with
// BASE=http://localhost:3000 instead.
//
// Run: node scripts/smoke-invite-lobby.mjs

import { resolveBase, startServer } from './lib/server-process.mjs';

const target = resolveBase(3182);
const BASE = target.base;
const WS_URL = `${BASE.replace('http', 'ws')}/ws`;

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json() };
};
const get = async (path) => {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.json() };
};

/** A minimal client: connects, sends `join_room`, and records every server message. */
function connect({ roomId, playerId, inviteToken } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const state = { ws, snapshots: [], errors: [], joined: null };
    const timer = setTimeout(() => reject(new Error('join timeout')), 5000);

    ws.addEventListener('open', () =>
      ws.send(
        JSON.stringify({
          type: 'join_room',
          ...(roomId ? { roomId } : {}),
          ...(playerId ? { playerId } : {}),
          ...(inviteToken ? { inviteToken } : {}),
        }),
      ),
    );
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      if (msg.type === 'joined') {
        state.joined = msg;
        clearTimeout(timer);
        resolve(state);
      } else if (msg.type === 'match_snapshot') {
        state.snapshots.push(msg);
      } else if (msg.type === 'error') {
        state.errors.push(msg);
        clearTimeout(timer);
        resolve(state); // a refused join still resolves; the caller inspects `errors`
      }
    });
    ws.addEventListener('error', () => reject(new Error('socket error')));
  });
}

/** A live client that stays open to observe LATER server pushes (e.g. a cancel broadcast). */
function connectAndStayOpen({ roomId, inviteToken }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const state = { ws, errors: [], joined: null };
    const timer = setTimeout(() => reject(new Error('join timeout')), 5000);
    ws.addEventListener('open', () =>
      ws.send(JSON.stringify({ type: 'join_room', roomId, inviteToken })),
    );
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      if (msg.type === 'joined') {
        state.joined = msg;
        clearTimeout(timer);
        resolve(state);
      } else if (msg.type === 'error') {
        state.errors.push(msg);
      }
    });
    ws.addEventListener('error', () => reject(new Error('socket error')));
  });
}

async function main() {
  console.log('Private invite/lobby smoke test\n');

  // --- 1. POST /api/rooms mints the PRD-contract invite shape ---------------------------
  const created = await post('/api/rooms', { mode: 'private_human', hostDisplayName: 'Ada' });
  check(
    'POST /api/rooms {mode: private_human} returns roomId, inviteToken, joinUrl, waiting_for_opponent',
    created.status === 201 &&
      typeof created.body.id === 'string' &&
      typeof created.body.inviteToken === 'string' &&
      typeof created.body.joinUrl === 'string' &&
      created.body.joinUrl.endsWith(`/join/${created.body.inviteToken}`) &&
      created.body.status === 'waiting_for_opponent' &&
      created.body.hostDisplayName === 'Ada',
    JSON.stringify(created.body),
  );

  // --- 2. the raw token is never re-leaked by the generic room lookup -------------------
  const plainLookup = await get(`/api/rooms/${created.body.id}`);
  check(
    'GET /api/rooms/:roomId (guessable roomId) never re-serializes the raw inviteToken',
    plainLookup.status === 200 && !('inviteToken' in plainLookup.body),
    JSON.stringify(plainLookup.body),
  );

  // --- 3. GET /api/rooms/by-invite/:token is how a /join/:token page actually resolves it -
  const byInvite = await get(`/api/rooms/by-invite/${created.body.inviteToken}`);
  const byInviteBad = await get('/api/rooms/by-invite/not-a-real-token');
  check(
    'GET /api/rooms/by-invite/:token resolves the room for a good token and 404s a bad one',
    byInvite.status === 200 &&
      byInvite.body.id === created.body.id &&
      byInviteBad.status === 404 &&
      byInviteBad.body.error === 'invite_not_found',
    `good=${byInvite.status}/${byInvite.body.id} bad=${byInviteBad.status}/${byInviteBad.body.error}`,
  );

  // --- 4. two real sockets join the SAME private room and land in the SAME match ---------
  const host = await connect({ roomId: created.body.id, inviteToken: created.body.inviteToken });
  const guest = await connect({ roomId: created.body.id, inviteToken: created.body.inviteToken });
  check(
    'host and guest both join successfully, with distinct player ids',
    host.joined && guest.joined && host.joined.playerId !== guest.joined.playerId,
    JSON.stringify({ host: host.joined, guest: guest.joined }),
  );
  check(
    'host and guest receive the identical seed and market — one Match, not re-derived per seat',
    host.joined?.seed === guest.joined?.seed && host.joined?.marketId === guest.joined?.marketId,
    `host=${host.joined?.seed}/${host.joined?.marketId} guest=${guest.joined?.seed}/${guest.joined?.marketId}`,
  );

  // --- 5. a third join, even with the correct token, is refused: the room already has 2 --
  const third = await connect({ roomId: created.body.id, inviteToken: created.body.inviteToken });
  check(
    'a third join against a full 1v1 private room is refused as match_full',
    third.errors[0]?.error === 'match_full',
    JSON.stringify(third.errors),
  );

  // --- 6. a fresh join with the WRONG token is refused, over the real router path --------
  const wrongTokenRoom = await post('/api/rooms', { mode: 'private_human' });
  const wrongToken = await connect({ roomId: wrongTokenRoom.body.id, inviteToken: 'not-the-real-token' });
  check(
    'join_room with the wrong inviteToken is refused as invite_token_mismatch',
    wrongToken.errors[0]?.error === 'invite_token_mismatch',
    JSON.stringify(wrongToken.errors),
  );

  // --- 7. a dev room (no mode) is completely unaffected by any of the above --------------
  const devRoom = await post('/api/rooms', { seed: 'invite-lobby-smoke-dev' });
  check(
    'POST /api/rooms with no mode keeps the exact pre-STORY-024 dev shape',
    devRoom.status === 201 && devRoom.body.mode === 'dev' && !('inviteToken' in devRoom.body),
    JSON.stringify(devRoom.body),
  );
  const devJoin = await connect({ roomId: devRoom.body.id });
  check(
    'a dev room join_room with no inviteToken at all still succeeds, unchanged',
    devJoin.joined?.roomId === devRoom.body.id,
    JSON.stringify(devJoin.joined),
  );

  // --- 8. host cancels an unfilled room; the ALREADY-CONNECTED guest hears about it live --
  const cancelRoom = await post('/api/rooms', { mode: 'private_human' });
  const cancelHost = await connectAndStayOpen({
    roomId: cancelRoom.body.id,
    inviteToken: cancelRoom.body.inviteToken,
  });
  const cancelResult = await post(`/api/rooms/${cancelRoom.body.id}/cancel`, {});
  await sleep(150);
  check(
    'POST /api/rooms/:roomId/cancel succeeds and pushes invite_canceled to the connected host live',
    cancelResult.status === 200 &&
      cancelResult.body.status === 'canceled' &&
      cancelHost.errors.some((e) => e.error === 'invite_canceled'),
    JSON.stringify({ cancelResult: cancelResult.body, hostErrors: cancelHost.errors }),
  );
  const joinAfterCancel = await connect({
    roomId: cancelRoom.body.id,
    inviteToken: cancelRoom.body.inviteToken,
  });
  check(
    'a fresh join against a canceled room is refused as invite_canceled',
    joinAfterCancel.errors[0]?.error === 'invite_canceled',
    JSON.stringify(joinAfterCancel.errors),
  );
  const doubleCancel = await post(`/api/rooms/${cancelRoom.body.id}/cancel`, {});
  check(
    'canceling an already-canceled room over HTTP is refused, not silently re-accepted',
    doubleCancel.status === 409 && doubleCancel.body.error === 'invite_canceled',
    JSON.stringify(doubleCancel.body),
  );

  // --- 9. ready both real players and the private match actually starts ------------------
  host.ws.send(JSON.stringify({ type: 'player_ready', ready: true }));
  guest.ws.send(JSON.stringify({ type: 'player_ready', ready: true }));
  const deadline = Date.now() + 5000;
  let started = false;
  while (Date.now() < deadline && !started) {
    const latest = guest.snapshots.at(-1);
    if (latest && latest.matchPhase !== 'lobby') started = true;
    await sleep(50);
  }
  check(
    'once both real players ready up, the private invite match leaves the lobby',
    started,
    `last phase seen: ${guest.snapshots.at(-1)?.matchPhase}`,
  );

  for (const c of [host, guest, third, wrongToken, devJoin, cancelHost, joinAfterCancel]) {
    c.ws?.close();
  }
  await sleep(100);
}

const server = await startServer(target);
try {
  await main();
} finally {
  server.stop();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
