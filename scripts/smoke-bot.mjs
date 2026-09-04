#!/usr/bin/env node
// Bot opponent smoke test — STORY-017 AC1 over a REAL socket: "A match can be created with one
// human and one bot via POST /api/dev/match, and the human client cannot tell from the
// protocol that the opponent is a bot."
//
// `scripts/check-bot.mjs` proves the bot's own decision-making and its balance/reproducibility
// properties in process, driving the room's match directly. This script proves the other half:
// a genuinely separate process (a real server, spawned by `scripts/lib/server-process.mjs`,
// exactly as `smoke-milestone0.mjs` spawns one) answering `POST /api/dev/match` with
// `{"bot": true}`, and one real browser-shaped WebSocket client (Node's global `WebSocket`,
// same as `smoke-milestone0.mjs` uses) joining that room and playing it out. Nothing here reads
// server internals — everything is read off the wire, the same way a browser would.
//
// It STARTS ITS OWN SERVER on a high port and kills exactly that child again. Set
// BASE=http://localhost:3000 to run it against a server you started yourself instead.
//
// Usage: node scripts/smoke-bot.mjs

import { resolveBase, startServer } from './lib/server-process.mjs';

const target = resolveBase(3181);
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

function connect(roomId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const state = { ws, playerId: null, roomId: null, seed: null, snapshots: [], lastError: null };
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
      } else if (msg.type === 'match_complete') {
        state.matchComplete = msg;
      } else if (msg.type === 'error') {
        state.lastError = msg;
      }
    });
    ws.addEventListener('error', () => reject(new Error('socket error')));
  });
}

console.log('Bot opponent smoke test — STORY-017 AC1 over a real socket\n');

// --- 1. POST /api/dev/match with {bot: true} seats a bot immediately -----------------------
const dev = await (
  await fetch(`${BASE}/api/dev/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seed: 'smoke-bot', phasePreset: 'smoke', bot: true, difficulty: 'hard' }),
  })
).json();
check(
  'POST /api/dev/match {bot:true} creates a two-seat match with the bot already connected',
  dev.requiredPlayers === 2 && dev.bot === true && dev.connectedCount === 1 && dev.phase === 'lobby',
  `${dev.id} seats=${dev.requiredPlayers} connected=${dev.connectedCount} bot=${dev.bot}`,
);

// The room-creation HTTP RESPONSE is allowed to say `bot: true` — that is the creator's own
// admin-facing acknowledgement, not the game protocol two players exchange (see routes.js's own
// comment on this endpoint). What must never happen is the marker reaching a WebSocket message.

// --- 2. a real human client joins the SAME room over a real socket -------------------------
const human = await connect(dev.id);
check('the human client joins the bot-seeded room', human.roomId === dev.id, human.playerId);

human.ws.send(JSON.stringify({ type: 'player_ready', ready: true }));
await sleep(500);

const seen = human.snapshots.at(-1)?.players ?? [];
check(
  'the human sees exactly two players in the snapshot — itself and the bot, indistinguishable in shape',
  seen.length === 2,
  `players=${seen.length}`,
);
if (seen.length === 2) {
  const keysA = Object.keys(seen[0]).sort().join(',');
  const keysB = Object.keys(seen[1]).sort().join(',');
  check(
    "both player entries have the IDENTICAL key set — the wire protocol carries no isBot-shaped field",
    keysA === keysB && !seen.some((p) => Object.keys(p).some((k) => /^(isbot|bot|botcontrolled|iscpu|aicontrolled)$/i.test(k))),
    `keys=${keysA}`,
  );
}

// --- 3. a third real socket is still refused — the bot really occupies a seat --------------
const third = await connect(dev.id).catch(() => null);
await sleep(300);
check(
  'a third socket is refused with match_full — the bot is a real occupant, not a placeholder seat',
  third === null || third.lastError?.error === 'match_full',
  third ? JSON.stringify(third.lastError) : 'connect rejected outright',
);
third?.ws.close();

// --- 4. the match plays itself out to a real match_complete, over the wire -----------------
let waited = 0;
while (!human.matchComplete && waited < 20_000) {
  // eslint-disable-next-line no-await-in-loop
  await sleep(200);
  waited += 200;
}
check(
  'the match reaches match_complete over the real socket within the smoke preset\'s short timeline',
  Boolean(human.matchComplete),
  human.matchComplete ? JSON.stringify(human.matchComplete) : `gave up after ${waited}ms`,
);

human.ws.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
