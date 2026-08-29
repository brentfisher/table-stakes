#!/usr/bin/env node
// Milestone 0 end-to-end check (PRD §21 success criteria). The repo has no test framework
// yet, so this is a runnable scratch script per conventions.md "Testing".
//
// Verifies: two clients in one room see each other move; the server — not the client —
// clamps position to the restaurant bounds; and the same seed reproduces configuration.
//
// UPDATED BY STORY-003, which invalidated the assumption this script was written on: a match
// no longer sits permanently in `service`. Three consequences, all of which made checks
// stronger rather than weaker:
//   * the two clients now ready up, so the match leaves `lobby` and the checks below run
//     inside a real phase with a real countdown instead of a parked placeholder;
//   * the determinism check also compares the seeded MARKET selection, which is what
//     STORY-001's placeholder `marketIndex` draw could not do; and
//   * the disconnect check now asserts the reconnect-grace behaviour — the dropped player is
//     HELD in the match as `connected: false`, not removed — which is what STORY-003 promises
//     and what STORY-022's reconnect UX will build on.
// The movement and clamp checks are unchanged: `movement-system.js` registers with no phase
// filter, so an owner walks and is clamped in every phase.
//
// It STARTS ITS OWN SERVER on a high port and kills exactly that child again, so it can run
// unattended from `npm run check`. Set BASE=http://localhost:3000 to run it against a server
// you started yourself instead, which is how it was always used before.
//
// Usage: node scripts/smoke-milestone0.mjs

// Node 18+ ships a global browser-style WebSocket, so this script needs no dependency
// of its own — it talks to the server exactly the way a browser client does.
import { RESTAURANT_BOUNDS } from '../shared/constants/tuning.js';
import { resolveBase, startServer } from './lib/server-process.mjs';

const target = resolveBase(3180);
const BASE = target.base;
const WS = BASE.replace('http', 'ws') + '/ws';

const server = await startServer(target);
// This script's checks run at the top level rather than inside a main(), so cleanup hangs off
// `exit` rather than a `finally`. It is the same guarantee — the handler runs on a normal
// exit, on process.exit(), and after an uncaught rejection — and it kills only our own child,
// never a process matched by name.
process.on('exit', () => server.stop());

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(roomId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const state = { ws, playerId: null, roomId: null, seed: null, snapshots: [] };
    const timer = setTimeout(() => reject(new Error('join timeout')), 5000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'join_room', ...(roomId ? { roomId } : {}) })));
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      if (msg.type === 'joined') {
        Object.assign(state, { playerId: msg.playerId, roomId: msg.roomId, seed: msg.seed });
        clearTimeout(timer);
        resolve(state);
      } else if (msg.type === 'match_snapshot') {
        state.snapshots.push(msg);
      } else if (msg.type === 'error') {
        state.lastError = msg;
      }
    });
    ws.addEventListener('error', () => reject(new Error('socket error')));
  });
}

console.log('Milestone 0 smoke test\n');

// --- determinism -----------------------------------------------------------------
const mk = async (seed) => (await (await fetch(`${BASE}/api/rooms`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seed }),
})).json());
const a = await mk('determinism-seed');
const b = await mk('determinism-seed');
const ra = await (await fetch(`${BASE}/api/rooms/${a.id}`)).json();
const rb = await (await fetch(`${BASE}/api/rooms/${b.id}`)).json();
check('same seed produces distinct rooms with identical seed and market',
  ra.seed === rb.seed && ra.id !== rb.id && ra.marketId === rb.marketId && Boolean(ra.marketId),
  `${ra.id}/${rb.id} seed=${ra.seed} market=${ra.marketId}`);

// --- two clients in one room ----------------------------------------------------
const room = await mk('shared-room');
const p1 = await connect(room.id);
const p2 = await connect(room.id);
check('two clients joined the same room', p1.roomId === p2.roomId && p1.playerId !== p2.playerId,
  `${p1.playerId} + ${p2.playerId} in ${p1.roomId}`);

// Ready up so the match leaves the lobby (PRD §12 room-flow step 7). Everything below then
// runs inside `market_reveal`, which the prototype preset gives 15 seconds — far longer than
// this script needs, and long enough that the reconnect-grace check at the end is real.
p1.ws.send(JSON.stringify({ type: 'player_ready', ready: true }));
p2.ws.send(JSON.stringify({ type: 'player_ready', ready: true }));

await sleep(400);
const seen = p1.snapshots.at(-1)?.players ?? [];
check('each client sees both owners in the snapshot', seen.length === 2, `players=${seen.length}`);

// --- replicated movement --------------------------------------------------------
const startX = seen.find((p) => p.playerId === p2.playerId)?.position.x ?? 0;
for (let i = 1; i <= 30; i += 1) {
  p2.ws.send(JSON.stringify({ type: 'player_input', sequence: i, move: { x: 1, z: 0, sprint: false }, facing: 1.57 }));
  await sleep(20);
}
await sleep(300);
const afterOnP1 = p1.snapshots.at(-1).players.find((p) => p.playerId === p2.playerId);
check("player 2's movement is visible to player 1", Math.abs(afterOnP1.position.x - startX) > 0.5,
  `x ${startX.toFixed(2)} -> ${afterOnP1.position.x.toFixed(2)}`);
check('facing replicates', Math.abs(afterOnP1.facing - 1.57) < 0.001, `facing=${afterOnP1.facing}`);

// --- SERVER AUTHORITY: out-of-bounds intent must not escape ---------------------
for (let i = 100; i <= 260; i += 1) {
  p2.ws.send(JSON.stringify({ type: 'player_input', sequence: i, move: { x: 999, z: 999, sprint: true }, facing: 0 }));
  await sleep(6);
}
await sleep(400);
const clamped = p1.snapshots.at(-1).players.find((p) => p.playerId === p2.playerId).position;
const inBounds =
  clamped.x <= RESTAURANT_BOUNDS.maxX + 1e-6 && clamped.x >= RESTAURANT_BOUNDS.minX - 1e-6 &&
  clamped.z <= RESTAURANT_BOUNDS.maxZ + 1e-6 && clamped.z >= RESTAURANT_BOUNDS.minZ - 1e-6;
check('server clamps an out-of-bounds movement intent', inBounds,
  `pos=(${clamped.x.toFixed(2)}, ${clamped.z.toFixed(2)}) bounds x[${RESTAURANT_BOUNDS.minX},${RESTAURANT_BOUNDS.maxX}] z[${RESTAURANT_BOUNDS.minZ},${RESTAURANT_BOUNDS.maxZ}]`);

// --- unimplemented message types are rejected, not ignored ---------------------
p2.ws.send(JSON.stringify({ type: 'purchase_upgrade', sequence: 999, upgradeId: 'faster_grill_1' }));
await sleep(200);
check('unimplemented message type is explicitly rejected', p2.lastError?.error === 'not_implemented',
  JSON.stringify(p2.lastError ?? null));

// --- broadcast rate --------------------------------------------------------------
const before = p1.snapshots.length;
await sleep(1000);
const rate = p1.snapshots.length - before;
check('broadcast rate is ~10 Hz', rate >= 8 && rate <= 12, `${rate} snapshots/sec`);

// --- disconnect ------------------------------------------------------------------
// STORY-003: the dropped player is HELD for the reconnect grace period, so the snapshot must
// show them still in the match and marked disconnected — not silently gone, and not an ended
// match. `phase` is asserted too, because a stale `service` here would mean the phase machine
// never ran.
p2.ws.close();
await sleep(400);
const last = p1.snapshots.at(-1);
const remaining = last.players.filter((p) => p.connected);
const held = last.players.find((p) => p.playerId === p2.playerId);
check('disconnect is reflected in the snapshot and the dropped player is held for reconnect',
  remaining.length === 1 && held !== undefined && held.connected === false &&
  last.matchPhase === 'market_reveal' && last.timeRemainingMs > 0,
  `connected=${remaining.length} held=${held?.playerId} phase=${last.matchPhase} timeRemainingMs=${last.timeRemainingMs}`);

p1.ws.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
