#!/usr/bin/env node
// Phase-lifecycle smoke test — the wire-level half of STORY-003's acceptance criteria.
//
// This one asserts only what a real socket can prove: that two clients driven through a whole
// PRD §5 match receive identical public market data, that neither can see the other's private
// state, that readiness and the setup timer both start service, that `match_complete` actually
// arrives, and that a dropped client can reconnect into a running match.
//
// The clock arithmetic, the full-length preset and the 30-second reconnect grace window are
// checked in-process by scripts/check-match-lifecycle.mjs, which needs no server and no waiting.
//
// It STARTS ITS OWN SERVER on PORT below and kills it again, so `npm run check` can run it
// unattended. Point it at an already-running server with BASE=http://localhost:3000 instead.
//
// Run: node scripts/smoke-phases.mjs

import { resolveBase, startServer } from './lib/server-process.mjs';
import { PHASE_DURATIONS_MS } from '../shared/constants/tuning.js';
import { MATCH_PHASES } from '../shared/schemas/messages.js';

const target = resolveBase(3179);
const BASE = target.base;
const WS_URL = `${BASE.replace('http', 'ws')}/ws`;
const PRESET = 'smoke';
const DURATIONS = PHASE_DURATIONS_MS[PRESET];

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- a client ---------------------------------------------------------------------------

function connect({ roomId, playerId } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const state = { ws, snapshots: [], errors: [], complete: null, joined: null };
    const timer = setTimeout(() => reject(new Error('join timeout')), 5000);

    ws.addEventListener('open', () =>
      ws.send(JSON.stringify({ type: 'join_room', ...(roomId ? { roomId } : {}), ...(playerId ? { playerId } : {}) })),
    );
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      if (msg.type === 'joined') {
        state.joined = msg;
        clearTimeout(timer);
        resolve(state);
      } else if (msg.type === 'match_snapshot') {
        state.snapshots.push(msg);
      } else if (msg.type === 'match_complete') {
        state.complete = msg;
      } else if (msg.type === 'error') {
        state.errors.push(msg);
        clearTimeout(timer);
        resolve(state); // a refused join still resolves; the caller inspects `errors`
      }
    });
    ws.addEventListener('error', () => reject(new Error('socket error')));
  });
}

const ready = (client, value = true) =>
  client.ws.send(JSON.stringify({ type: 'player_ready', ready: value }));

/** Wait until a client's latest snapshot satisfies `predicate`, or give up. */
async function until(client, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const latest = client.snapshots.at(-1);
    if (latest && predicate(latest, client)) return latest;
    await sleep(25);
  }
  return null;
}

const post = async (path, body) =>
  (await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })).json();

// --- the run -----------------------------------------------------------------------------

async function main() {
  console.log('Phase lifecycle smoke test\n');

  // --- 1. GET /api/markets is real now ---------------------------------------------
  const markets = await (await fetch(`${BASE}/api/markets`)).json();
  check(
    'GET /api/markets returns real definitions from markets.json, without the event pool',
    Array.isArray(markets.markets) &&
      markets.markets.length >= 3 &&
      markets.markets.every((m) => typeof m.id === 'string' && Array.isArray(m.preferredTags)) &&
      markets.markets.every((m) => !('eventPool' in m)),
    markets.markets?.map((m) => m.id).join(', '),
  );

  // --- 2. the seed picks the market, over the wire ----------------------------------
  const a = await post('/api/rooms', { seed: 'wire-determinism', phasePreset: PRESET });
  const b = await post('/api/rooms', { seed: 'wire-determinism', phasePreset: PRESET });
  check(
    'two rooms created with the same seed select the same market',
    a.marketId === b.marketId && a.id !== b.id && markets.markets.some((m) => m.id === a.marketId),
    `${a.id}/${b.id} -> ${a.marketId}`,
  );

  const dev = await post('/api/dev/match', { seed: 'wire-dev', phasePreset: PRESET });
  check(
    'POST /api/dev/match creates a single-seat development match',
    dev.requiredPlayers === 1 && dev.phase === 'lobby',
    `${dev.id} seats=${dev.requiredPlayers}`,
  );

  // --- 3. two clients, one room ------------------------------------------------------
  const room = await post('/api/rooms', { seed: 'wire-lifecycle', phasePreset: PRESET });
  const p1 = await connect({ roomId: room.id });
  const p2 = await connect({ roomId: room.id });

  const third = await connect({ roomId: room.id });
  check(
    'a third socket is refused with match_full rather than silently seated',
    third.errors.at(-1)?.error === 'match_full' && third.joined === null,
    JSON.stringify(third.errors.at(-1) ?? null),
  );
  third.ws.close();

  await until(p1, (s) => s.players.length === 2);
  const inLobby = p1.snapshots.at(-1);
  check(
    'the match waits in lobby with no deadline until both players ready up',
    inLobby.matchPhase === 'lobby' && inLobby.timeRemainingMs === null && inLobby.market === null,
    `phase=${inLobby.matchPhase} timeRemainingMs=${inLobby.timeRemainingMs} market=${inLobby.market}`,
  );

  // --- 4. market reveal: identical public data --------------------------------------
  ready(p1);
  ready(p2);
  const reveal1 = await until(p1, (s) => s.matchPhase === 'market_reveal');
  const reveal2 = await until(p2, (s) => s.matchPhase === 'market_reveal');
  check(
    'both clients receive identical public market data at market reveal',
    reveal1 !== null &&
      reveal2 !== null &&
      JSON.stringify(reveal1.market) === JSON.stringify(reveal2.market) &&
      reveal1.market.id === room.marketId,
    `${reveal1?.market?.id} === ${reveal2?.market?.id}`,
  );

  // --- 5. privacy ---------------------------------------------------------------------
  // Nothing that could carry a menu, a price or a setup submission may appear anywhere in a
  // snapshot except the viewer's own `you`. STORY-009 must keep this passing.
  const leaked = (snapshot, selfId) => {
    const opponentVisible = JSON.stringify(snapshot.players.filter((p) => p.playerId !== selfId));
    const forbidden = ['menu', 'price', 'addons', 'staffAssignments', 'startingUpgradeId', 'setup'];
    return (
      forbidden.some((key) => opponentVisible.toLowerCase().includes(key.toLowerCase())) ||
      snapshot.you?.playerId !== selfId
    );
  };
  check(
    'neither client receives the other player’s menu, prices or setup submission',
    !leaked(reveal1, p1.joined.playerId) &&
      !leaked(reveal2, p2.joined.playerId) &&
      reveal1.you.playerId !== reveal2.you.playerId,
    `you=${reveal1.you.playerId}/${reveal2.you.playerId}; opponent entries carry position, facing, connected, ready only`,
  );

  // --- 6. readiness starts service early ---------------------------------------------
  await until(p1, (s) => s.matchPhase === 'setup');
  const setupAt = p1.snapshots.at(-1).serverTime;
  ready(p1);
  ready(p2);
  const service = await until(p1, (s) => s.matchPhase === 'service');
  check(
    'service begins when both players are ready, before the setup timer expires',
    service !== null && service.serverTime - setupAt < DURATIONS.setup,
    `service at +${service ? service.serverTime - setupAt : '?'}ms of a ${DURATIONS.setup}ms setup`,
  );

  // --- 7. the whole timeline, and match_complete -------------------------------------
  await until(p1, (s) => s.matchPhase === 'results', 20000);
  await sleep(DURATIONS.results + 600);

  const phasesSeen = [];
  for (const s of p1.snapshots) if (phasesSeen.at(-1) !== s.matchPhase) phasesSeen.push(s.matchPhase);
  check(
    'both clients see every PRD §5 phase in order, service into final_rush included',
    JSON.stringify(phasesSeen) === JSON.stringify([...MATCH_PHASES]),
    phasesSeen.join(' -> '),
  );

  // Monotonic per phase, across the real broadcast stream.
  let monotonic = true;
  let previous = null;
  for (const s of p1.snapshots) {
    if (previous && previous.matchPhase === s.matchPhase && s.timeRemainingMs !== null) {
      if (s.timeRemainingMs > previous.timeRemainingMs) monotonic = false;
    }
    previous = s;
  }
  check('broadcast timeRemainingMs never runs backwards within a phase', monotonic,
    `${p1.snapshots.length} snapshots`);

  // STORY-013: `results` is no longer empty — `scoring-system.js` populates a full `MatchResult`
  // per player at the `results` transition. Neither client here ever plays (both just ready up
  // and wait), so both restaurants are identically empty and genuinely tie — `winnerPlayerId`
  // stays null for that reason, not because scoring never ran.
  const REQUIRED_RESULT_FIELDS = ['score', 'revenue', 'guestsServed', 'averageSatisfaction', 'reputation', 'abandonedParties'];
  const envelopeOk = (m) =>
    m &&
    m.winnerPlayerId === null &&
    m.reason === 'completed' &&
    Object.keys(m.results).length === 2 &&
    Object.values(m.results).every((r) => REQUIRED_RESULT_FIELDS.every((f) => f in r));
  check(
    'match_complete reaches both clients with the PRD §12 envelope and a populated MatchResult per player',
    envelopeOk(p1.complete) && envelopeOk(p2.complete),
    JSON.stringify(p1.complete),
  );

  p1.ws.close();
  p2.ws.close();

  // --- 8. reconnect into a running match ----------------------------------------------
  const rcRoom = await post('/api/rooms', { seed: 'wire-reconnect', phasePreset: PRESET });
  const r1 = await connect({ roomId: rcRoom.id });
  const r2 = await connect({ roomId: rcRoom.id });
  const droppedId = r2.joined.playerId;

  await until(r1, (s) => s.players.length === 2);
  ready(r1);
  ready(r2);
  await until(r1, (s) => s.matchPhase === 'setup');
  ready(r1);
  ready(r2);
  await until(r1, (s) => s.matchPhase === 'service');

  r2.ws.close();
  await until(r1, (s) => s.players.some((p) => p.playerId === droppedId && !p.connected), 3000);
  const held = r1.snapshots.at(-1);

  const r2b = await connect({ roomId: rcRoom.id, playerId: droppedId });
  const afterRejoin = await until(
    r1,
    (s) => s.players.some((p) => p.playerId === droppedId && p.connected),
    3000,
  );
  check(
    'a client that drops mid-match is held and reconnects into the still-running match',
    held?.players.length === 2 &&
      r2b.joined?.reconnected === true &&
      r2b.joined?.playerId === droppedId &&
      afterRejoin !== null &&
      r1.complete === null,
    `dropped in ${held?.matchPhase}, rejoined as ${r2b.joined?.playerId} in ${afterRejoin?.matchPhase}`,
  );

  r1.ws.close();
  r2b.ws.close();
  await sleep(100);
}

// Kill only the child we started, on every exit path — including an assertion throwing.
const server = await startServer(target);
try {
  await main();
} finally {
  server.stop();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
