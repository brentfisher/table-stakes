#!/usr/bin/env node
// Match lifecycle check — the in-process half of STORY-003's acceptance criteria.
//
// The repo has no test framework (Milestone 0 Decision 8), so this is a runnable script. It
// needs no server and no sockets: it constructs `Match` directly and steps it with synthetic
// `dtMs` through `stepMatch`, exactly as the simulation loop does. That buys two things the
// wire-level script cannot have — every phase of a FULL-length match in milliseconds of real
// time, and the 30-second reconnect grace window without waiting 30 seconds.
//
// The socket-level behaviour (two clients, identical market payloads, privacy, match_complete
// arriving) is scripts/smoke-phases.mjs. This one owns the clock, the phase order, the
// reconnect policy, the seeded market draw and the system-registration seam.
//
// Run: node scripts/check-match-lifecycle.mjs

import { Match } from '../server/src/game/match.js';
import {
  registerSystem,
  clearSystems,
  registeredSystems,
  stepMatch,
} from '../server/src/game/simulation-loop.js';
import { MATCH_PHASES, MATCH_END_REASONS } from '../shared/schemas/messages.js';
import { PHASE_DURATIONS_MS, RECONNECT_GRACE_MS } from '../shared/constants/tuning.js';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// The match logs every transition. Useful when running the server, noise here.
const realLog = console.log;
function quiet(fn) {
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = realLog;
  }
}

const TICK_MS = 50;

/**
 * Drive a match to completion, sampling a snapshot after every step — the same order the
 * loop uses (advance, then systems, then snapshot), which is what makes "no stale
 * re-broadcast" an assertable property rather than a hope.
 */
function driveToEnd(match, { maxSteps = 40_000, onStep } = {}) {
  const samples = [];
  const outbound = [];
  quiet(() => {
    for (let i = 0; i < maxSteps && !match.ended; i += 1) {
      stepMatch(match, TICK_MS, { onOutbound: (m) => outbound.push(m) });
      samples.push(match.toSnapshot('p1'));
      if (onStep) onStep(match, i);
    }
  });
  return { samples, outbound };
}

function seatBoth(match, ids = ['p1', 'p2']) {
  for (const id of ids) match.join({ fallbackPlayerId: id });
}

console.log('Match lifecycle check\n');

// --- 1. the PRD §5 phase machine, in order -------------------------------------------
{
  const match = new Match({ id: 'm_order', seed: 'lifecycle', phasePreset: 'prototype' });
  seatBoth(match);
  for (const id of ['p1', 'p2']) match.setReady(id, true);

  const { samples, outbound } = driveToEnd(match);
  const visited = [];
  for (const s of samples) if (visited.at(-1) !== s.matchPhase) visited.push(s.matchPhase);

  check(
    'phases run in PRD §5 order and every one is visited',
    JSON.stringify(visited) === JSON.stringify(MATCH_PHASES.slice(1)) && samples[0].matchPhase !== 'lobby',
    visited.join(' -> '),
  );

  // --- 2. monotonic within a phase, reset at the transition -------------------------
  // Grouped by phase: timeRemainingMs resets UPWARD at a boundary by design, so a naive
  // "never increases" assertion over the whole stream would be wrong.
  let monotonic = true;
  let resetsMatchTuning = true;
  const durations = PHASE_DURATIONS_MS.prototype;
  let previous = null;
  for (const s of samples) {
    if (previous && previous.matchPhase === s.matchPhase) {
      if (s.timeRemainingMs > previous.timeRemainingMs) monotonic = false;
    } else if (previous) {
      // First sample of a new phase: at most one tick has been consumed from it.
      const expected = durations[s.matchPhase];
      if (expected !== null && Math.abs(expected - s.timeRemainingMs) > TICK_MS + 1) {
        resetsMatchTuning = false;
      }
    }
    previous = s;
  }
  check('timeRemainingMs decreases monotonically within every phase', monotonic);
  check(
    'timeRemainingMs resets at each transition to the tuning.js duration for that phase',
    resetsMatchTuning,
    'PHASE_DURATIONS_MS.prototype',
  );

  // --- 3. service flows into final_rush with no gap and no stale time ----------------
  const boundary = samples.findIndex((s) => s.matchPhase === 'final_rush');
  const before = samples[boundary - 1];
  const first = samples[boundary];
  const noStale = !samples.some(
    (s, i) => i >= boundary && s.matchPhase === 'service',
  );
  const gapMs = first.serverTime - before.serverTime;
  check(
    'service transitions into final_rush with no gap and no stale re-broadcast',
    noStale && gapMs === TICK_MS && first.timeRemainingMs >= durations.final_rush - TICK_MS - 1,
    `${before.matchPhase}(${before.timeRemainingMs}ms) -> ${first.matchPhase}(${first.timeRemainingMs}ms), gap ${gapMs}ms`,
  );

  // --- 4. the phase timeline does not drift ------------------------------------------
  // Every phase after the lobby starts exactly one phase-duration after the previous one
  // started, because a transition carries the deadline forward rather than restarting at
  // "now". Over a whole match that is the difference between an exact timeline and one that
  // has slipped by a tick per phase.
  const firstOf = new Map();
  for (const s of samples) if (!firstOf.has(s.matchPhase)) firstOf.set(s.matchPhase, s.serverTime);
  let exact = true;
  const ordered = MATCH_PHASES.slice(1);
  for (let i = 1; i < ordered.length; i += 1) {
    const span = firstOf.get(ordered[i]) - firstOf.get(ordered[i - 1]);
    if (span !== durations[ordered[i - 1]]) exact = false;
  }
  check('phase boundaries are exact — the clock carries the overshoot, it does not drift', exact,
    ordered.map((p) => `${p}@${firstOf.get(p)}`).join(' '));

  // --- 5. match_complete, PRD §12 envelope --------------------------------------------
  const complete = outbound.filter((m) => m.type === 'match_complete');
  const envelope = complete[0];
  check(
    'exactly one match_complete is emitted, at the end of results, with the §12 envelope',
    complete.length === 1 &&
      envelope.winnerPlayerId === null &&
      MATCH_END_REASONS.includes(envelope.reason) &&
      envelope.reason === 'completed' &&
      Object.keys(envelope.results).sort().join(',') === 'p1,p2' &&
      Object.values(envelope.results).every((r) => typeof r === 'object' && Object.keys(r).length === 0),
    JSON.stringify(envelope),
  );
}

// --- 6. both presets are selectable and both come from tuning.js ----------------------
for (const preset of ['full', 'prototype']) {
  const match = new Match({ id: `m_${preset}`, seed: 'presets', phasePreset: preset });
  seatBoth(match);
  for (const id of ['p1', 'p2']) match.setReady(id, true);

  const spans = new Map();
  const firstAt = new Map();
  quiet(() => {
    while (!match.ended) {
      stepMatch(match, TICK_MS);
      if (!firstAt.has(match.phase)) firstAt.set(match.phase, match.elapsedMs);
    }
  });
  const ordered = MATCH_PHASES.slice(1);
  for (let i = 1; i < ordered.length; i += 1) {
    spans.set(ordered[i - 1], firstAt.get(ordered[i]) - firstAt.get(ordered[i - 1]));
  }
  const expected = PHASE_DURATIONS_MS[preset];
  const matches = ordered.slice(0, -1).every((p) => spans.get(p) === expected[p]);
  check(
    `the "${preset}" preset's phase lengths are exactly PHASE_DURATIONS_MS.${preset}`,
    matches,
    ordered.slice(0, -1).map((p) => `${p}=${spans.get(p)}`).join(' '),
  );
}

// --- 7. PRD §12 step 7: ready OR timer, whichever comes first --------------------------
{
  // Both ready during setup -> service starts immediately, well before the setup deadline.
  const match = new Match({ id: 'm_ready', seed: 'ready', phasePreset: 'prototype' });
  seatBoth(match);
  for (const id of ['p1', 'p2']) match.setReady(id, true);
  quiet(() => {
    while (match.phase !== 'setup') stepMatch(match, TICK_MS);
  });
  const setupStartedAt = match.elapsedMs;
  quiet(() => {
    stepMatch(match, TICK_MS);
    for (const id of ['p1', 'p2']) match.setReady(id, true);
    stepMatch(match, TICK_MS);
  });
  check(
    'service begins as soon as both players are ready, without waiting out setup',
    match.phase === 'service' && match.elapsedMs - setupStartedAt < PHASE_DURATIONS_MS.prototype.setup,
    `service at +${match.elapsedMs - setupStartedAt}ms of a ${PHASE_DURATIONS_MS.prototype.setup}ms setup`,
  );
}
{
  // Only one ready -> setup runs to its deadline and service starts anyway.
  const match = new Match({ id: 'm_timer', seed: 'timer', phasePreset: 'prototype' });
  seatBoth(match);
  for (const id of ['p1', 'p2']) match.setReady(id, true);
  quiet(() => {
    while (match.phase !== 'setup') stepMatch(match, TICK_MS);
  });
  const setupStartedAt = match.elapsedMs;
  quiet(() => {
    match.setReady('p1', true);
    while (match.phase === 'setup') stepMatch(match, TICK_MS);
  });
  check(
    'service begins when the setup timer expires even though one player never readied',
    match.phase === 'service' &&
      match.elapsedMs - setupStartedAt >= PHASE_DURATIONS_MS.prototype.setup,
    `service at +${match.elapsedMs - setupStartedAt}ms`,
  );
}
{
  // And the lobby does NOT advance on its own — it has no deadline (tuning: lobby === null).
  const match = new Match({ id: 'm_lobby', seed: 'lobby', phasePreset: 'prototype' });
  seatBoth(match);
  quiet(() => {
    for (let i = 0; i < 200; i += 1) stepMatch(match, TICK_MS);
  });
  const stuck = match.phase === 'lobby' && match.timeRemainingMs === null;
  quiet(() => {
    for (const id of ['p1', 'p2']) match.setReady(id, true);
    stepMatch(match, TICK_MS);
  });
  check(
    'lobby has no deadline and ends only when every seat is filled and ready',
    stuck && match.phase === 'market_reveal',
    `held for 10s in lobby, then ${match.phase} once both readied`,
  );
}

// --- 8. the market is seeded, and public only from the reveal --------------------------
{
  const a = new Match({ id: 'm_a', seed: 'market-seed', phasePreset: 'prototype' });
  const b = new Match({ id: 'm_b', seed: 'market-seed', phasePreset: 'prototype' });
  check(
    'the same seed selects the same market from markets.json',
    a.config.marketId === b.config.marketId && typeof a.market?.name === 'string',
    `${a.config.marketId} === ${b.config.marketId}`,
  );

  // A placeholder index would not be an id in the catalogue; this is what proves the
  // STORY-001 `marketIndex` draw is really gone.
  const seeds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
  const picked = new Set(
    seeds.map((s) => new Match({ id: `m_${s}`, seed: s, phasePreset: 'prototype' }).config.marketId),
  );
  check(
    'market selection draws real markets.json ids and different seeds reach more than one',
    picked.size > 1 && [...picked].every((id) => typeof id === 'string' && id.includes('_')),
    [...picked].join(', '),
  );

  const lobby = a.toSnapshot('p1');
  seatBoth(a);
  quiet(() => {
    for (const id of ['p1', 'p2']) a.setReady(id, true);
    stepMatch(a, TICK_MS);
  });
  const revealed = a.toSnapshot('p1');
  check(
    'the market is withheld during lobby and public from market_reveal, minus its eventPool',
    lobby.market === null &&
      revealed.market?.id === a.config.marketId &&
      !('eventPool' in revealed.market),
    `lobby=null reveal=${revealed.market?.id} keys=${Object.keys(revealed.market).join(',')}`,
  );

  // PRD §12 step 5 / §18: both players see the same public data, and differ only in `you`.
  const forP1 = a.toSnapshot('p1');
  const forP2 = a.toSnapshot('p2');
  const strip = (s) => JSON.stringify({ ...s, you: null });
  check(
    'two viewers of one match receive identical public snapshots, differing only in `you`',
    strip(forP1) === strip(forP2) &&
      forP1.you.playerId === 'p1' &&
      forP2.you.playerId === 'p2',
    'match_snapshot is built per viewer',
  );
}

// --- 9. reconnect grace ----------------------------------------------------------------
{
  const match = new Match({ id: 'm_grace', seed: 'grace', phasePreset: 'full' });
  seatBoth(match);
  quiet(() => {
    for (const id of ['p1', 'p2']) match.setReady(id, true);
    while (match.phase !== 'service') {
      stepMatch(match, TICK_MS);
      for (const id of ['p1', 'p2']) match.setReady(id, true);
    }
  });

  match.removePlayer('p2');
  quiet(() => {
    // Well inside the window: a quarter of the grace period.
    for (let i = 0; i < RECONNECT_GRACE_MS / 4 / TICK_MS; i += 1) stepMatch(match, TICK_MS);
  });
  const heldDuringService = match.phase === 'service' && !match.ended && match.players.has('p2');

  const rejoin = match.join({ requestedPlayerId: 'p2', fallbackPlayerId: 'player_99' });
  check(
    'a player who drops during service is held, and reconnecting inside the grace window restores them',
    heldDuringService &&
      rejoin.ok &&
      rejoin.reconnected &&
      rejoin.player.playerId === 'p2' &&
      match.players.get('p2').connected &&
      !match.ended,
    `held ${RECONNECT_GRACE_MS / 4}ms into a ${RECONNECT_GRACE_MS}ms window, phase=${match.phase}`,
  );

  // Now let one expire.
  const outbound = [];
  match.removePlayer('p2');
  quiet(() => {
    for (let i = 0; i < (RECONNECT_GRACE_MS + 1000) / TICK_MS && !match.ended; i += 1) {
      stepMatch(match, TICK_MS, { onOutbound: (m) => outbound.push(m) });
    }
  });
  const complete = outbound.find((m) => m.type === 'match_complete');
  check(
    'exceeding the reconnect grace ends the match cleanly with a stated reason',
    match.ended &&
      match.endReason === 'player_disconnected' &&
      match.phase === 'results' &&
      match.timeRemainingMs === 0 &&
      complete?.reason === 'player_disconnected' &&
      complete?.disconnectedPlayerId === 'p2',
    JSON.stringify(complete),
  );

  // And a late token is refused rather than silently reseating them. STORY-022: the match is
  // already `ended` by this point, so the honest refusal is `match_ended` (with the reason the
  // match itself ended for), not `match_full` — a live-full roster and a dead room are
  // different facts, and only one of them means "the client should keep retrying".
  const late = match.join({ requestedPlayerId: 'p2', fallbackPlayerId: 'player_100' });
  check(
    'a reconnect token presented after the grace window is told the match ended, not that it is full',
    !late.ok && late.error === 'match_ended' && late.reason === 'player_disconnected',
    JSON.stringify(late),
  );
}

// --- 10. seats, and the reconnect token cannot evict a live player ---------------------
{
  const match = new Match({ id: 'm_seats', seed: 'seats', phasePreset: 'prototype' });
  seatBoth(match);
  const third = match.join({ fallbackPlayerId: 'p3' });
  const steal = match.join({ requestedPlayerId: 'p1', fallbackPlayerId: 'p4' });
  check(
    'a 1v1 match refuses a third player, and a token cannot take a connected seat',
    !third.ok && third.error === 'match_full' && !steal.ok && steal.error === 'match_full',
    `third=${third.error} steal=${steal.error}`,
  );

  // A drop in the lobby frees the seat — nothing is under way to abandon.
  match.removePlayer('p2');
  const replacement = match.join({ fallbackPlayerId: 'p5' });
  check(
    'a drop during lobby releases the seat instead of holding it',
    replacement.ok && match.players.size === 2 && match.players.has('p5'),
    [...match.players.keys()].join(', '),
  );
}

// --- 11. the dev match runs the whole lifecycle with one player ------------------------
{
  const match = new Match({ id: 'm_dev', seed: 'dev', phasePreset: 'prototype', requiredPlayers: 1 });
  match.join({ fallbackPlayerId: 'solo' });
  match.setReady('solo', true);
  const { outbound } = driveToEnd(match);
  check(
    'a single-seat development match advances through every phase and completes',
    match.ended &&
      match.endReason === 'completed' &&
      outbound.some((m) => m.type === 'match_complete'),
    'POST /api/dev/match seats one player',
  );
}

// --- 12. the system-registration seam --------------------------------------------------
{
  clearSystems();
  const seen = { ticks: 0, phases: [], dts: new Set(), transitions: [] };

  registerSystem({
    id: 'probe_all',
    update: (match, dtMs) => {
      seen.ticks += 1;
      seen.dts.add(dtMs);
      if (seen.phases.at(-1) !== match.phase) seen.phases.push(match.phase);
    },
    onPhaseChange: (_match, transition) => seen.transitions.push(`${transition.from}->${transition.to}`),
  });

  const serviceOnly = { ticks: 0, phases: new Set() };
  registerSystem({
    id: 'probe_service',
    phases: ['service', 'final_rush'],
    update: (match) => {
      serviceOnly.ticks += 1;
      serviceOnly.phases.add(match.phase);
    },
  });

  const match = new Match({ id: 'm_seam', seed: 'seam', phasePreset: 'prototype' });
  seatBoth(match);
  for (const id of ['p1', 'p2']) match.setReady(id, true);
  driveToEnd(match);

  check(
    'a registered system is called with (match, dtMs) on every tick',
    seen.ticks > 0 && seen.dts.size === 1 && seen.dts.has(TICK_MS),
    `${seen.ticks} calls, dtMs=${[...seen.dts].join(',')}`,
  );
  check(
    'a system reads the phase for THIS tick — the clock advances before any system runs',
    JSON.stringify(seen.phases) === JSON.stringify(MATCH_PHASES.slice(1)),
    seen.phases.join(' -> '),
  );
  check(
    'onPhaseChange fires once per transition, in order',
    JSON.stringify(seen.transitions) ===
      JSON.stringify(['lobby->market_reveal', 'market_reveal->setup', 'setup->service',
        'service->final_rush', 'final_rush->results']),
    seen.transitions.join(', '),
  );
  check(
    'a `phases` filter means the system is simply not called outside them',
    serviceOnly.ticks > 0 && [...serviceOnly.phases].sort().join(',') === 'final_rush,service',
    `${serviceOnly.ticks} calls in ${[...serviceOnly.phases].join(', ')}`,
  );
  check(
    'systems run in registration order, which is the contract systems/index.js states',
    registeredSystems().map((s) => s.id).join(',') === 'probe_all,probe_service',
    registeredSystems().map((s) => s.id).join(', '),
  );

  const rejects = (system) => {
    try {
      registerSystem(system);
      return false;
    } catch {
      return true;
    }
  };
  check(
    'registerSystem refuses a duplicate id, a missing update, and an unknown phase',
    rejects({ id: 'probe_all', update() {} }) &&
      rejects({ id: 'no_update' }) &&
      rejects({ id: 'bad_phase', phases: ['brunch'], update() {} }) &&
      rejects({ id: 'NotSnakeCase', update() {} }),
    'wiring mistakes fail at boot, not at runtime',
  );
  clearSystems();
}

// --- 13. named RNG streams -------------------------------------------------------------
{
  const a = new Match({ id: 'm_r1', seed: 'stream-seed', phasePreset: 'prototype' });
  const b = new Match({ id: 'm_r2', seed: 'stream-seed', phasePreset: 'prototype' });
  const draw = (m, name) => [m.createRngStream(name)(), m.createRngStream(name)()];
  const events = draw(a, 'event_deck');
  const sameAgain = draw(b, 'event_deck');
  const customers = draw(a, 'customer_arrivals');
  check(
    'named RNG streams are seed-derived, identical across matches, and independent of each other',
    JSON.stringify(events) === JSON.stringify(sameAgain) &&
      JSON.stringify(events) !== JSON.stringify(customers),
    'match.createRngStream(name)',
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
