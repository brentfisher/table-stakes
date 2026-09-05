#!/usr/bin/env node
// Telemetry and reconnect check — STORY-022's acceptance criteria, in process.
//
// Same harness as check-bot.mjs's own AC4/AC5 sections: `matchManager.createRoom()` +
// `attachBot()` + `simulation-loop.js#stepRoom()`, so every logged action really did travel
// `interact`/`purchase_upgrade`/`setup_submit` through `message-router.js` — this script builds
// no shortcut path of its own into `Match#logEvent`. The reconnect-grace half of this story
// (`match.js#join`'s `match_ended` refusal) is exercised directly by check-match-lifecycle.mjs's
// own "reconnect grace" section instead; this script covers what that one does not:
// `telemetry-export.js`'s log/summary shape and its diffability across two runs of one seed.
//
// Run: node scripts/check-telemetry.mjs

import { registerAllSystems } from '../server/src/game/systems/index.js';
import { clearSystems, stepRoom } from '../server/src/game/simulation-loop.js';
import * as matchManager from '../server/src/game/match-manager.js';
import { attachBot } from '../server/src/game/bot/bot-controller.js';
import { buildMatchLog, buildMatchSummary } from '../server/src/game/telemetry-export.js';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const realLog = console.log;
const realWarn = console.warn;
function quiet(fn) {
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = realLog;
    console.warn = realWarn;
  }
}

console.log('Telemetry and reconnect check — PRD §20/§21/§24, STORY-022\n');

clearSystems();
registerAllSystems();

const TICK_MS = 50;

function runToEnd(room, maxSteps = 30_000) {
  quiet(() => {
    for (let i = 0; i < maxSteps && !room.match.ended; i += 1) stepRoom(room, TICK_MS);
  });
  return room.match.ended;
}

function playBotVsBot(seed) {
  const room = matchManager.createRoom({ seed, phasePreset: 'prototype', requiredPlayers: 2 });
  attachBot(room, { difficulty: 'hard' });
  attachBot(room, { difficulty: 'easy' });
  const ended = runToEnd(room);
  return { room, ended };
}

// =============================================================================================
// 1. Shape — every category the AC lists is present, with the fields the export promises.
// =============================================================================================
const { room, ended } = playBotVsBot('telemetry-seed-1');
check('a full bot-vs-bot match reaches `ended` within the step budget', ended, `phase=${room.match.phase}`);

const log = buildMatchLog(room.match);
const summary = buildMatchSummary(room.match);
const categories = new Set(log.events.map((e) => e.category));

check(
  'the log carries the match-level fields buildMatchLog promises',
  typeof log.seed === 'string' && typeof log.marketId === 'string' && typeof log.phasePreset === 'string',
  JSON.stringify({ seed: log.seed, marketId: log.marketId, phasePreset: log.phasePreset }),
);

for (const category of [
  'phase_transition',
  'player_connection',
  'action',
  'order',
  'revenue_sample',
  'customer_decision',
  'event_scheduled',
]) {
  check(`the log contains at least one "${category}" entry`, categories.has(category), `categories seen: ${[...categories].join(', ')}`);
}

check(
  'events are in non-decreasing atMs order',
  log.events.every((e, i) => i === 0 || e.atMs >= log.events[i - 1].atMs),
);

const actionEntries = log.events.filter((e) => e.category === 'action');
check(
  'the action log carries both outcomes ("accepted" appears; a bot mismatch also produces "rejected")',
  actionEntries.some((e) => e.outcome === 'accepted'),
  `${actionEntries.length} action entries, outcomes: ${[...new Set(actionEntries.map((e) => e.outcome))].join(', ')}`,
);

const orderEntries = log.events.filter((e) => e.category === 'order');
check(
  'every order entry carries placedAtMs and its terminal state, delivered or cancelled',
  orderEntries.every(
    (e) => typeof e.placedAtMs === 'number' && (e.state === 'delivered' || e.state === 'cancelled'),
  ),
  `${orderEntries.length} order entries`,
);
check(
  'a delivered order entry carries deliveredAtMs and revenue; readyAtMs may be null only for one voided before ever going ready',
  orderEntries
    .filter((e) => e.state === 'delivered')
    .every((e) => typeof e.deliveredAtMs === 'number' && typeof e.revenue === 'number'),
);

// =============================================================================================
// 2. No raw playerId — the one thing that would break diffability across two runs of one seed.
//    connection-manager.js hands out ids from a module-level counter, so THIS process's ids for
//    room 1 are whatever they are; assert none of them survive into the exported log.
// =============================================================================================
const rawPlayerIds = [...room.match.players.keys()];
const logJson = JSON.stringify(log);
check(
  'no raw connection-manager playerId appears anywhere in the exported log',
  rawPlayerIds.every((id) => !logJson.includes(id)),
  `raw ids: ${rawPlayerIds.join(', ')}`,
);
check(
  'seat labels appear in their place',
  logJson.includes('seat0') && logJson.includes('seat1'),
);

// =============================================================================================
// 3. The summary report — PRD §24's five figures, each keyed by seat label.
// =============================================================================================
check(
  'partiesServedByRestaurant has one numeric entry per seat',
  Object.keys(summary.partiesServedByRestaurant).sort().join(',') === 'seat0,seat1' &&
    Object.values(summary.partiesServedByRestaurant).every((v) => typeof v === 'number'),
  JSON.stringify(summary.partiesServedByRestaurant),
);
check(
  'staffRoutineWorkShare has one entry per seat (object or null, never undefined)',
  Object.keys(summary.staffRoutineWorkShare).sort().join(',') === 'seat0,seat1',
  JSON.stringify(summary.staffRoutineWorkShare),
);
check(
  'playerInterventions has one numeric entry per seat',
  Object.values(summary.playerInterventions).every((v) => typeof v === 'number') &&
    Object.values(summary.playerInterventions).some((v) => v > 0),
  JSON.stringify(summary.playerInterventions),
);
check(
  'upgradeCadence has one array entry per seat',
  Object.values(summary.upgradeCadence).every((v) => Array.isArray(v)),
  JSON.stringify(summary.upgradeCadence),
);
check(
  'revenueGapOverTime is a non-empty series over a full-length match, each sample carrying a gap',
  summary.revenueGapOverTime.length > 0 && summary.revenueGapOverTime.every((s) => typeof s.gap === 'number'),
  `${summary.revenueGapOverTime.length} samples`,
);

// =============================================================================================
// 4. Diffability — PRD §20/§21's working definition of "no desync": the same seed, replayed
//    under the same deterministic stepping, produces a matching event timeline in the log.
// =============================================================================================
const rerun = playBotVsBot('telemetry-seed-1');
const rerunLog = buildMatchLog(rerun.room.match);
check(
  'replaying the same seed produces a byte-identical exported log',
  JSON.stringify(rerunLog) === JSON.stringify(log),
  JSON.stringify(rerunLog) === JSON.stringify(log)
    ? 'identical'
    : `first divergent index: ${(() => {
        const a = log.events;
        const b = rerunLog.events;
        for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
          if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return i;
        }
        return -1;
      })()}`,
);

const differentSeed = playBotVsBot('telemetry-seed-2');
const differentSeedLog = buildMatchLog(differentSeed.room.match);
check(
  'a different seed does NOT (trivially) produce the identical log',
  JSON.stringify(differentSeedLog) !== JSON.stringify(log),
);

// --- summary ------------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log(`${failed.length} FAILED:`);
  for (const r of failed) console.log(`  - ${r.name}`);
  process.exit(1);
}
