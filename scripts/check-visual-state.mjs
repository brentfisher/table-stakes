#!/usr/bin/env node
// STORY-016 "3D visual state language" — pure color-band classification check, in process.
//
// This is a pure-logic check ONLY. The 3D rendering itself (patience rings, table badges,
// station queue/shortage icons, worker role/task icons, the food-ready icon at the pass, rival
// activity, the event effect) has no in-process test surface — "this repo has no React/Three.js
// test framework" (STORY-015's own check-hud.mjs precedent). It was verified live in a real
// two-tab browser session instead; see this story's `Implementation notes (post-hoc)` section
// in its story file for what was checked there.
//
// What IS pure and in-process-testable is the classification `RestaurantScene.ts` builds every
// indicator's color on: `patienceColorBand`/`stationQueueColorBand`
// (shared/game-logic/state-color-bands.js). This exercises them directly against the exact
// tuning constants the scene imports, the same way check-hud.mjs exercises `classifyBottlenecks`
// directly rather than only through a live `Match`.
//
// Run: node scripts/check-visual-state.mjs

import { patienceColorBand, stationQueueColorBand } from '../shared/game-logic/state-color-bands.js';
import {
  PATIENCE_RING_ATTENTION_THRESHOLD,
  PATIENCE_RING_BOTTLENECK_THRESHOLD,
  UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD,
  STATION_QUEUE_ATTENTION_THRESHOLD,
  HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD,
} from '../shared/constants/tuning.js';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('3D visual state language — color-band classification check (STORY-016)\n');

// =================================================================================================
// 1. patienceColorBand — the customer patience ring's four bands
// =================================================================================================
console.log('1. patienceColorBand (state-color-bands.js)');

const patienceThresholds = {
  attention: PATIENCE_RING_ATTENTION_THRESHOLD,
  bottleneck: PATIENCE_RING_BOTTLENECK_THRESHOLD,
  critical: UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD,
};

check(
  'full patience (1.0) is healthy',
  patienceColorBand(1.0, patienceThresholds) === 'healthy',
);
check(
  'just above the attention threshold is still healthy',
  patienceColorBand(PATIENCE_RING_ATTENTION_THRESHOLD + 0.01, patienceThresholds) === 'healthy',
);
check(
  'exactly at the attention threshold crosses into attention (band boundaries are inclusive going down)',
  patienceColorBand(PATIENCE_RING_ATTENTION_THRESHOLD, patienceThresholds) === 'attention',
);
check(
  'between attention and bottleneck reads attention',
  patienceColorBand((PATIENCE_RING_ATTENTION_THRESHOLD + PATIENCE_RING_BOTTLENECK_THRESHOLD) / 2, patienceThresholds) ===
    'attention',
);
check(
  'exactly at the bottleneck threshold crosses into bottleneck',
  patienceColorBand(PATIENCE_RING_BOTTLENECK_THRESHOLD, patienceThresholds) === 'bottleneck',
);
check(
  'between bottleneck and critical reads bottleneck',
  patienceColorBand((PATIENCE_RING_BOTTLENECK_THRESHOLD + UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD) / 2, patienceThresholds) ===
    'bottleneck',
);
check(
  'exactly at UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD crosses into critical — the SAME line CustomerSnapshot.unhappy uses',
  patienceColorBand(UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD, patienceThresholds) === 'critical',
);
check(
  'zero patience is critical',
  patienceColorBand(0, patienceThresholds) === 'critical',
);
check(
  'the three threshold constants are strictly ordered (attention > bottleneck > critical) — a real balance claim, not assumed',
  PATIENCE_RING_ATTENTION_THRESHOLD > PATIENCE_RING_BOTTLENECK_THRESHOLD &&
    PATIENCE_RING_BOTTLENECK_THRESHOLD > UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD,
  `attention=${PATIENCE_RING_ATTENTION_THRESHOLD} bottleneck=${PATIENCE_RING_BOTTLENECK_THRESHOLD} critical=${UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD}`,
);

// =================================================================================================
// 2. stationQueueColorBand — the station queue indicator's three bands
// =================================================================================================
console.log('\n2. stationQueueColorBand (state-color-bands.js)');

const queueThresholds = {
  attention: STATION_QUEUE_ATTENTION_THRESHOLD,
  bottleneck: HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD,
};

check(
  'an empty queue is healthy',
  stationQueueColorBand(0, queueThresholds) === 'healthy',
);
check(
  'exactly STATION_QUEUE_ATTENTION_THRESHOLD queued tickets crosses into attention',
  stationQueueColorBand(STATION_QUEUE_ATTENTION_THRESHOLD, queueThresholds) === 'attention',
);
check(
  'exactly HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD is still attention (that is the HUD backlog alert line, one past it)',
  stationQueueColorBand(HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD, queueThresholds) === 'attention',
);
check(
  'one past HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD crosses into bottleneck — agrees exactly with hud-bottleneck-system.js#hasKitchenBacklog',
  stationQueueColorBand(HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD + 1, queueThresholds) === 'bottleneck',
);
check(
  'stationQueueColorBand never returns critical — a shortage is a separate signal entirely, never a queue-depth color',
  ['healthy', 'attention', 'bottleneck'].includes(stationQueueColorBand(999, queueThresholds)),
);

// =================================================================================================
console.log('');
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.log(`${failed.length}/${results.length} checks FAILED`);
  process.exit(1);
}
console.log(`All ${results.length} checks passed.`);
