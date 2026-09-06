#!/usr/bin/env node
// "Play vs Bot" menu-flow smoke test — the wire-level half of STORY-025's acceptance criteria.
//
// `scripts/check-bot-menu.mjs` already owns everything provable in process (the profile tuning,
// the `marketId` override, the `mode: 'solo_bot'`-gated snapshot field, the synthetic-stepped
// abandonment lifecycle). This one proves what only a real HTTP endpoint and a real socket can:
// the actual `POST /api/rooms {mode: 'solo_bot', ...}` response shape (this story's own
// player-facing, non-`/dev/`-prefixed room-creation path — see `routes.js`'s STORY-025 comment
// on why it reuses `matchManager.createRoom` + `attachBot`, the exact `POST /dev/match` path,
// rather than a second attachment mechanism), that a real human WebSocket client can take the
// SECOND seat (the bot already took the first, synchronously, before the HTTP response — same
// as `POST /dev/match`), that `match_snapshot.bots` actually reaches that real socket naming
// the bot's profile, and that the human's own real disconnect (closing the socket, not calling
// any bot-specific teardown) produces the same `match_complete: player_disconnected` a human-vs-
// human abandonment already produces — this story's own "verify by driving it" instruction,
// over the wire this time rather than synthetic-stepped.
//
// The abandonment half here proves only that a REAL socket close reaches a `solo_bot` room's
// human seat (`connection-manager.js#unregister` -> `Match#removePlayer`) — the fast, cheap
// half. `RECONNECT_GRACE_MS` is a flat 30s, NOT shortened by `phasePreset: 'smoke'`, so proving
// the match actually ENDS once that grace elapses is left to `check-bot-menu.mjs`'s synthetic
// `dtMs` stepping (no real 30s wait, and it exercises the identical `match.js` code this real
// disconnect triggers) rather than paying that wait twice in `npm run check`.
//
// STARTS ITS OWN SERVER on the port below and kills it again — same `lib/server-process.mjs`
// pattern as every other smoke script. Point it at an already-running server with
// BASE=http://localhost:3000 instead.
//
// Run: node scripts/smoke-bot-menu.mjs

import { resolveBase, startServer } from './lib/server-process.mjs';

const target = resolveBase(3183);
const BASE = target.base;
const WS = BASE.replace('http', 'ws') + '/ws';

const server = await startServer(target);
process.on('exit', () => server.stop());

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
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

function connect(roomId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const state = { ws, playerId: null, roomId: null, snapshots: [], matchComplete: null, lastError: null };
    const timer = setTimeout(() => reject(new Error('join timeout')), 5000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'join_room', roomId })));
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      if (msg.type === 'joined') {
        Object.assign(state, { playerId: msg.playerId, roomId: msg.roomId });
        clearTimeout(timer);
        resolve(state);
      } else if (msg.type === 'match_snapshot') {
        state.snapshots.push(msg);
      } else if (msg.type === 'match_complete') {
        state.matchComplete = msg;
      } else if (msg.type === 'error') {
        state.lastError = msg;
      }
    });
    ws.addEventListener('error', () => reject(new Error('socket error')));
  });
}

console.log('Play vs Bot menu-flow smoke test\n');

// --- 1. POST /api/rooms {mode: 'solo_bot'} — the player-facing endpoint, not /dev/match -----
const created = await post('/api/rooms', {
  mode: 'solo_bot',
  botDifficulty: 'fast_service',
  phasePreset: 'smoke',
  seed: 'smoke-bot-menu',
});
check(
  'POST /api/rooms {mode: "solo_bot"} (not /dev/match) creates a two-seat room with the bot already connected',
  created.status === 201 &&
    created.body.mode === 'solo_bot' &&
    created.body.requiredPlayers === 2 &&
    created.body.bot === true &&
    created.body.botDifficulty === 'fast_service' &&
    created.body.connectedCount === 1,
  JSON.stringify(created.body),
);

// --- 2. a real human client takes the SECOND seat over a real socket -----------------------
const human = await connect(created.body.id);
check('the human client joins the bot-seeded solo_bot room', human.roomId === created.body.id, human.playerId);

human.ws.send(JSON.stringify({ type: 'player_ready', ready: true }));
await sleep(400);

const lastSnapshot = human.snapshots.at(-1);
check(
  'the real match_snapshot names the bot opponent — the AC this endpoint exists for',
  Array.isArray(lastSnapshot?.bots) &&
    lastSnapshot.bots.length === 1 &&
    lastSnapshot.bots[0].playerId !== human.playerId &&
    lastSnapshot.bots[0].difficulty === 'fast_service',
  JSON.stringify(lastSnapshot?.bots),
);
check(
  'the two `players[]` entries are still shape-identical to each other (STORY-017 AC1, unaffected by `bots`)',
  (() => {
    const players = lastSnapshot?.players ?? [];
    if (players.length !== 2) return false;
    const keysA = Object.keys(players[0]).sort().join(',');
    const keysB = Object.keys(players[1]).sort().join(',');
    return keysA === keysB;
  })(),
  JSON.stringify((lastSnapshot?.players ?? []).map((p) => Object.keys(p).sort())),
);

// --- 3. a bare POST /dev/match bot room still carries NO `bots` field on the wire -----------
// The regression `check-bot-menu.mjs` already proves in process; this confirms it survives the
// real HTTP+WS round trip too, not just the in-process `buildSnapshot()` call.
const devMatch = await post('/api/dev/match', { bot: true, difficulty: 'hard', phasePreset: 'smoke' });
const devHuman = await connect(devMatch.body.id);
devHuman.ws.send(JSON.stringify({ type: 'player_ready', ready: true }));
await sleep(400);
check(
  'a bare /dev/match bot room\'s real snapshot still carries no `bots` key — STORY-017 AC1 unchanged',
  !('bots' in (devHuman.snapshots.at(-1) ?? {})),
  JSON.stringify(Object.keys(devHuman.snapshots.at(-1) ?? {})),
);
devHuman.ws.close();

// --- 4. abandoning the solo_bot match: the human's socket just closes, same as a human would -
// This proves the REAL disconnect path (`connection-manager.js#unregister` -> `Match
// #removePlayer`) actually fires for a `solo_bot` room's human seat — the same call a human-vs-
// human abandonment already goes through, nothing bot-specific in between. Whether the match
// then ENDS once the (flat, real, 30s) grace elapses is `check-bot-menu.mjs`'s job — see this
// script's own header on why that half is synthetic-stepped rather than a second real 30s wait
// here.
human.ws.close();
await sleep(500);
const statusAfterClose = await (await fetch(`${BASE}/api/rooms/${created.body.id}`)).json();
check(
  "closing the human's real socket drops connectedCount to 1 (only the bot remains) — the same signal a human-vs-human disconnect produces",
  statusAfterClose.connectedCount === 1 && statusAfterClose.ended === false,
  JSON.stringify(statusAfterClose),
);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
