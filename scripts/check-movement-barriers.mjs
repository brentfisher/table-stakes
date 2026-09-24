#!/usr/bin/env node
// STORY-067 pass-counter barrier — the owner may only enter the kitchen through the declared
// opening, not straight through the pickup counter.
//
// The repo has no test framework (Milestone 0 Decision 8), so this is a runnable script in the
// style of check-owner-actions.mjs: a real `Match`, the real `movementSystem` registered against
// the real simulation loop, driven by the same `player.input` shape the wire protocol carries.
// No socket, no client.
//
// ONLY `movement` IS REGISTERED, deliberately — unlike most checks here, which register every
// system they integrate with (conventions.md Testing rule 1). The barrier is a pure function of
// `player.position`, `player.input` and the §14 layout; no other system reads or writes owner
// position, so registering customers/orders/workers would add ticking noise without adding a
// seam. `smoke-milestone0.mjs` already covers the movement system inside a real server.
//
// WHAT THIS DOES NOT COVER: workers. `worker-system.js` moves its own bodies on its own path and
// is deliberately NOT subject to barriers (see `movement-system.js`'s own comment) — the server
// worker has to cross the pass to carry plates. That is a scope cut, and this script asserts it
// stays one rather than silently drifting.
//
// Run: node scripts/check-movement-barriers.mjs

import { Match } from '../server/src/game/match.js';
import { registerSystem, clearSystems, stepMatch } from '../server/src/game/simulation-loop.js';
import { movementSystem } from '../server/src/game/systems/movement-system.js';
import { RESTAURANT_BOUNDS, OWNER_MOVE_SPEED, OWNER_SPRINT_MULTIPLIER } from '../shared/constants/tuning.js';
import { readFileSync } from 'node:fs';

const layout = JSON.parse(readFileSync(new URL('../shared/game-data/restaurant-layout.json', import.meta.url)));
const BARRIER = layout.barriers.find((b) => b.id === 'service_pass_counter');

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('\nSTORY-067 pass-counter barrier\n');

// --- the layout's own declaration -----------------------------------------------------------
check('layout declares the pass-counter barrier', Boolean(BARRIER), JSON.stringify(BARRIER?.openings));
check('barrier sits on the pass line', BARRIER.axis === 'z' && BARRIER.at === 2, `axis=${BARRIER.axis} at=${BARRIER.at}`);
check(
  'exactly one opening, at the left end, inside the floor bounds',
  BARRIER.openings.length === 1 &&
    BARRIER.openings[0].min === RESTAURANT_BOUNDS.minX &&
    BARRIER.openings[0].max < 0,
  JSON.stringify(BARRIER.openings[0]),
);

/** Drive one owner from `from` with a held input for `ticks` 50ms steps, return final position. */
function walk(from, input, ticks = 40, sprint = false) {
  clearSystems();
  registerSystem(movementSystem);
  const match = new Match({ id: 'room_barrier', seed: 'barrier', phasePreset: 'smoke', requiredPlayers: 1 });
  match.join({ fallbackPlayerId: 'player_1' });
  const player = match.players.get('player_1');
  player.position.x = from.x;
  player.position.z = from.z;
  player.input = { x: input.x, z: input.z, sprint };
  for (let i = 0; i < ticks; i += 1) stepMatch(match, 50);
  return { x: player.position.x, z: player.position.z };
}

const OPENING_X = (BARRIER.openings[0].min + BARRIER.openings[0].max) / 2; // -8.5

// --- crossing is blocked where the counter is -----------------------------------------------
for (const x of [0, -4, 4, -7.5, 7.5, 8.5]) {
  const end = walk({ x, z: -1 }, { x: 0, z: 1 });
  check(
    `walking north at x=${x} does not cross the pass`,
    end.z < BARRIER.at,
    `ended z=${end.z.toFixed(3)} (barrier at z=${BARRIER.at})`,
  );
}

// --- crossing is allowed through the opening ------------------------------------------------
{
  const end = walk({ x: OPENING_X, z: -1 }, { x: 0, z: 1 });
  check(
    `walking north through the opening at x=${OPENING_X} reaches the kitchen`,
    end.z > 3,
    `ended z=${end.z.toFixed(3)}`,
  );
}

// --- the barrier is symmetric: it blocks coming BACK out too ---------------------------------
{
  const end = walk({ x: 0, z: 5 }, { x: 0, z: -1 });
  check(
    'walking south from inside the kitchen at x=0 does not cross the pass',
    end.z > BARRIER.at,
    `ended z=${end.z.toFixed(3)}`,
  );
  const out = walk({ x: OPENING_X, z: 5 }, { x: 0, z: -1 });
  check(
    'walking south through the opening leaves the kitchen',
    out.z < BARRIER.at,
    `ended z=${out.z.toFixed(3)}`,
  );
}

// --- a blocked move still slides ALONG the counter --------------------------------------------
{
  const end = walk({ x: 0, z: -1 }, { x: -1, z: 1 });
  check(
    'a diagonal into the counter slides west along it instead of sticking',
    end.z < BARRIER.at && end.x < -1,
    `ended x=${end.x.toFixed(3)} z=${end.z.toFixed(3)}`,
  );
}

// --- sprint cannot tunnel through --------------------------------------------------------------
{
  const perTick = OWNER_MOVE_SPEED * OWNER_SPRINT_MULTIPLIER * 0.05;
  const end = walk({ x: 0, z: -1 }, { x: 0, z: 1 }, 40, true);
  check(
    'a held sprint straight at the counter does not tunnel through it',
    end.z < BARRIER.at,
    `ended z=${end.z.toFixed(3)}, ${perTick.toFixed(3)} units/tick`,
  );
  const diag = walk({ x: 2, z: -1 }, { x: -1, z: 1 }, 40, true);
  check(
    'a diagonal sprint at the counter does not tunnel through it',
    diag.z < BARRIER.at,
    `ended x=${diag.x.toFixed(3)} z=${diag.z.toFixed(3)}`,
  );
}

// --- the pre-existing authority clamp still holds ----------------------------------------------
{
  const end = walk({ x: 0, z: -1 }, { x: 1, z: 0 }, 200);
  check(
    'the RESTAURANT_BOUNDS clamp still holds (smoke-milestone0.mjs depends on it)',
    end.x <= RESTAURANT_BOUNDS.maxX,
    `x=${end.x} maxX=${RESTAURANT_BOUNDS.maxX}`,
  );
}

// --- summary ------------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log(`${failed.length} FAILED:`);
  for (const r of failed) console.log(`  - ${r.name}`);
  process.exit(1);
}
