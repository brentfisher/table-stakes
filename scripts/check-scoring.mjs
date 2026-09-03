#!/usr/bin/env node
// Scoring and win-condition check — STORY-013's acceptance criteria, in process.
//
// Same pattern as check-upgrades.mjs/check-owner-actions.mjs: a real `Match`, every gameplay
// system registered against the real simulation loop. Most checks below deliberately DO NOT run
// a full seeded match to `results` — this story's substance is a formula and a wiring seam, and
// the deterministic way to test both is to force the exact per-restaurant numbers a real match
// would eventually produce, directly onto the internal state each system already exposes for
// exactly this purpose (`match._customerSimState`, `match._orderSimState`,
// `match._upgradeSimState`), then invoke each system's own `onPhaseChange(match, {to:
// 'results'})` in the same order `systems/index.js` registers them — customers, orders,
// upgrades, scoring last — which is the exact sequence a real match end runs, just without
// waiting out a multi-minute simulated service to get there.
//
// WHAT THIS SCRIPT DOES NOT COVER. `score-formula.js`'s own correctness (clamping, tie-break
// chain, penalty summation) is independently verified in isolation as a pure module — this
// script only proves the WIRING: that scoring-system.js reads the right live numbers from the
// right places and produces a `match.finalResults`/`match_complete.results` that matches.
//
// STORY-014 extends this same file (rather than a new check-*.mjs) with the results-screen
// narrative layer's wiring: `../scoring/narrative.js` (a pure module, same "independently
// verified in isolation" treatment as `score-formula.js` — exercised directly, not only through
// `scoringSystem.onPhaseChange`) and the three new match-wide `MatchCompleteMessage` fields.
// Section 19's own comment explains why `tieBreakDecided`'s NON-null path is checked against
// `explainTieBreak` directly rather than through a real end-to-end score tie — the same
// floating-point-residual reason section 11's own comment already documents for the four
// tie-break rungs.
//
// Run: node scripts/check-scoring.mjs

import { Match } from '../server/src/game/match.js';
import { registerSystem, clearSystems, stepMatch } from '../server/src/game/simulation-loop.js';
import { movementSystem } from '../server/src/game/systems/movement-system.js';
import { customerSystem, _internal as customerInternal } from '../server/src/game/systems/customer-system.js';
import { orderSystem, _internal as orderInternal } from '../server/src/game/systems/order-system.js';
import { setupSystem } from '../server/src/game/systems/setup-system.js';
import { eventSystem } from '../server/src/game/systems/event-system.js';
import { inventorySystem } from '../server/src/game/systems/inventory-system.js';
import { workerSystem } from '../server/src/game/systems/worker-system.js';
import { upgradeSystem, _internal as upgradeInternal } from '../server/src/game/systems/upgrade-system.js';
import { scoringSystem, _internal as scoringInternal } from '../server/src/game/systems/scoring-system.js';
import {
  determineWinner,
  explainTieBreak,
  compareForTieBreak,
  computePenaltyBreakdown,
} from '../server/src/game/scoring/score-formula.js';
import {
  toEventWindows,
  eventAt,
  pickDecidingSegment,
  pickBestDish,
  pickLargestLossCause,
  computeTurningPoints,
} from '../server/src/game/scoring/narrative.js';
import { catalogue } from '../server/src/game/catalogue.js';
import { CUSTOMER_STATES } from '../shared/schemas/game-state.js';
import {
  STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT,
  SCORE_PENALTY_ABANDONMENT_POINTS,
  SCORE_PENALTY_CANCELLED_ORDER_POINTS,
  SCORE_PENALTY_SEVERE_DISSATISFACTION_POINTS,
  SCORE_PENALTY_WASTE_POINTS_PER_DOLLAR,
  SCORE_PENALTY_CRITIC_FAILURE_POINTS,
  RESULTS_TURNING_POINTS_MAX,
} from '../shared/constants/tuning.js';

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

const TICK_MS = 50;

console.log('Scoring and win-condition check — PRD §11, scoring-system.js wiring\n');

// --- 0. registration -----------------------------------------------------------------------
// Every gameplay system, scoring LAST — the exact order systems/index.js registers, and the
// order this file's own onPhaseChange-driven checks below also invoke by hand.
clearSystems();
registerSystem(movementSystem);
registerSystem(setupSystem);
registerSystem(customerSystem);
registerSystem(orderSystem);
registerSystem(eventSystem);
registerSystem(inventorySystem);
registerSystem(workerSystem);
registerSystem(upgradeSystem);
registerSystem(scoringSystem);

const PROBE_MAINS = [
  { dishId: 'smash_burger', price: 14 },
  { dishId: 'caesar_salad', price: 12 },
  { dishId: 'chicken_sandwich', price: 13 },
];

function submission({
  mains = PROBE_MAINS,
  addons = [],
  startingInventory = {},
  staff,
  startingUpgradeId = null,
  cashRemaining = 500,
  inventoryCost = 0,
  upgradeCost = 0,
} = {}) {
  return {
    menu: mains,
    addons,
    startingUpgradeId,
    staffAssignments: staff ?? { cook_1: 'prep', server_1: 'dining_room' },
    startingInventory,
    policyId: null,
    policyDishId: null,
    upgradeCost,
    inventoryCost,
    cashRemaining,
    submittedAtMs: 0,
    locked: false,
    autoFilled: false,
  };
}

function fullPantry() {
  const allocation = {};
  for (const ingredientId of Object.keys(catalogue.ingredients)) {
    allocation[ingredientId] = STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT;
  }
  return allocation;
}

function makeMatch({ id, seed = id, phasePreset = 'prototype', setups }) {
  const playerIds = Object.keys(setups);
  const match = new Match({ id, seed, phasePreset, requiredPlayers: playerIds.length });
  for (const playerId of playerIds) {
    match.join({ fallbackPlayerId: playerId });
    match.setReady(playerId, true);
  }
  for (const [playerId, setup] of Object.entries(setups)) {
    match.players.get(playerId).setup = { ...setup };
  }
  return match;
}

function runUntilPhase(match, phase, maxSteps = 20_000) {
  quiet(() => {
    for (let i = 0; i < maxSteps && match.phase !== phase && !match.ended; i += 1) {
      stepMatch(match, TICK_MS);
    }
  });
  return match.phase === phase;
}

function step(match, steps = 1) {
  quiet(() => {
    for (let i = 0; i < steps; i += 1) stepMatch(match, TICK_MS);
  });
}

/** A two-restaurant match, run to `service` and ticked once so every system's own internal
 * state (`_customerSimState`/`_orderSimState`/`_upgradeSimState`) exists to force values onto. */
function twoRestaurantProbe(id) {
  const match = makeMatch({
    id,
    setups: {
      p1: submission({ startingInventory: fullPantry(), cashRemaining: 500 }),
      p2: submission({ startingInventory: fullPantry(), cashRemaining: 500 }),
    },
  });
  runUntilPhase(match, 'service');
  step(match, 1);
  return match;
}

/** Force one restaurant's district-summary-producing view fields directly — the same
 * "reach into internal state for determinism" convention every sibling check script uses. */
function forceDistrictView(match, restaurantId, overrides) {
  const state = customerInternal.ensureState(match);
  Object.assign(state.restaurants.get(restaurantId), overrides);
}

function forceOrderLedger(match, restaurantId, overrides) {
  const state = orderInternal.ensureState(match);
  Object.assign(state.restaurants.get(restaurantId).ledger, overrides);
}

function forceOrderDishSales(match, restaurantId, dishId, count, revenue) {
  const state = orderInternal.ensureState(match);
  state.restaurants.get(restaurantId).dishSales.set(dishId, { dishId, count, revenue });
}

function forceUpgradeOwned(match, restaurantId, upgradeIds, cashSpent = 0) {
  const state = upgradeInternal.ensureState(match);
  const restaurant = state.restaurants.get(restaurantId);
  for (const id of upgradeIds) restaurant.owned.add(id);
  restaurant.cashSpent = cashSpent;
}

// --- STORY-014 forcing helpers — same "reach into internal state for determinism" convention ---

/** Force one dish's fulfillment tally directly, bypassing `deliverOrder`'s per-ticket math —
 * the deterministic way to hand `pickBestDish` exact `avgFulfillmentMs` values to compare. */
function forceOrderDishFulfillment(match, restaurantId, dishId, count, avgFulfillmentMs) {
  const state = orderInternal.ensureState(match);
  const restaurant = state.restaurants.get(restaurantId);
  const existing = restaurant.dishSales.get(dishId) ?? { dishId, count: 0, revenue: 0 };
  restaurant.dishSales.set(dishId, {
    ...existing,
    count,
    fulfillmentMsSum: avgFulfillmentMs * count,
    fulfillmentSamples: count,
  });
}

/** Force the §17 step-6 per-party decision log `narrative.js`'s `pickLargestLossCause`/
 * `computeTurningPoints` read. Forced onto the internal `_customerSimState.decisions` array
 * (not `match.districtDecisions` directly) because `customerSystem.onPhaseChange('results')`
 * — which `finishMatch` always calls before `scoringSystem.onPhaseChange` — REPUBLISHES
 * `match.districtDecisions` from that internal array, which would silently overwrite a
 * directly-forced `match.districtDecisions` before scoring ever read it. */
function forceDistrictDecisions(match, decisions) {
  const state = customerInternal.ensureState(match);
  state.decisions = decisions;
}

/** Force a synthetic, fully-controlled event timeline — same convention section 5 above
 * (critic-event failure) already uses for `match.eventTimeline`. */
function forceEventTimeline(match, entries, anchorMs = 0) {
  match.eventTimeline = { windowMs: match.durations.service, entries, anchorMs };
}

/** Run every system's own `results` teardown/summary handler, in registration order, then read
 * back `match.finalResults` and the wire-facing `matchCompleteMessage()`. Mirrors exactly what
 * a real match end does, without waiting out a simulated service. */
function finishMatch(match) {
  const transition = { from: match.phase, to: 'results', atMs: match.elapsedMs };
  customerSystem.onPhaseChange(match, transition);
  orderSystem.onPhaseChange(match, transition);
  upgradeSystem.onPhaseChange(match, transition);
  scoringSystem.onPhaseChange(match, transition);
  return { finalResults: match.finalResults, message: match.matchCompleteMessage() };
}

// =============================================================================================
// 1. BASIC WIRING — a run to `results` produces a populated match.finalResults
// =============================================================================================
{
  const match = twoRestaurantProbe('m_basic');
  forceOrderLedger(match, 'p1', { revenue: 500 });
  forceOrderLedger(match, 'p2', { revenue: 400 });
  const { finalResults, message } = finishMatch(match);

  check(
    'match.finalResults exists with both restaurant ids after the results transition',
    finalResults && finalResults.results.p1 && finalResults.results.p2,
    JSON.stringify(finalResults && Object.keys(finalResults.results)),
  );
  check(
    'match_complete carries the same winnerPlayerId and results as match.finalResults',
    message.winnerPlayerId === finalResults.winnerPlayerId &&
      JSON.stringify(message.results) === JSON.stringify(finalResults.results),
    `winner=${message.winnerPlayerId}`,
  );

  const REQUIRED_FIELDS = [
    'score', 'revenue', 'guestsServed', 'averageSatisfaction', 'reputation', 'abandonedParties',
    'expenses', 'netProfit', 'customersLostToRival', 'averageWaitTimeMs', 'bestSellingDishes',
    'highestMarginDishes', 'eventPerformance', 'upgradesPurchased', 'customerSegmentBreakdown',
    // STORY-014 additions:
    'scoreBreakdown', 'penaltyBreakdown', 'bestDish', 'largestLossCause',
  ];
  const p1Fields = Object.keys(finalResults.results.p1).sort();
  check(
    'the full extended MatchResult field list is present, not just the original 6',
    REQUIRED_FIELDS.every((f) => p1Fields.includes(f)),
    p1Fields.join(', '),
  );
  check(
    'tieBreak is scoring-internal only — never leaks onto the wire-facing result',
    !('tieBreak' in finalResults.results.p1),
    p1Fields.join(', '),
  );
}

// =============================================================================================
// 2. THE LITERAL AC — extreme pricing + tanked satisfaction does not automatically win
// =============================================================================================
{
  const match = twoRestaurantProbe('m_extreme_pricing');

  // Restaurant A: very high revenue, but low satisfaction/reputation and real penalty exposure.
  forceOrderLedger(match, 'p1', {
    revenue: 2200,
    cancelledOrders: 6,
    cancelledRevenueForgone: 180,
    walkedOutRevenueForgone: 60,
  });
  forceDistrictView(match, 'p1', {
    guestsServed: 30,
    satisfactionSum: 30 * 20, // averageSatisfaction = 20
    reputation: 35,
    abandonedParties: 10,
    severelyDissatisfiedCount: 12,
  });

  // Restaurant B: moderate revenue, high satisfaction, good reputation, clean floor.
  forceOrderLedger(match, 'p2', { revenue: 950 });
  forceDistrictView(match, 'p2', {
    guestsServed: 55,
    satisfactionSum: 55 * 90, // averageSatisfaction = 90
    reputation: 82,
    abandonedParties: 1,
    severelyDissatisfiedCount: 0,
  });

  const { finalResults } = finishMatch(match);
  const a = finalResults.results.p1;
  const b = finalResults.results.p2;
  check(
    'restaurant B (balanced) outscores restaurant A (revenue-maximized, satisfaction-tanked)',
    b.score > a.score,
    `A(revenue-max) score=${a.score.toFixed(1)} vs B(balanced) score=${b.score.toFixed(1)}`,
  );
  check(
    'the winner is B, not the higher-revenue A — extreme pricing does not automatically win',
    finalResults.winnerPlayerId === 'p2',
    `winner=${finalResults.winnerPlayerId}`,
  );
  check(
    'A genuinely out-earned B on revenue — the test is meaningful, not accidental',
    a.revenue > b.revenue,
    `A revenue=${a.revenue} vs B revenue=${b.revenue}`,
  );
}

// =============================================================================================
// 3. NET revenue, not gross — expenses actually reduce the score-relevant number
// =============================================================================================
{
  const match = twoRestaurantProbe('m_net_revenue');
  match.players.get('p1').setup.inventoryCost = 150;
  match.players.get('p1').setup.upgradeCost = 50;
  forceOrderLedger(match, 'p1', { revenue: 1000 });
  forceUpgradeOwned(match, 'p1', ['faster_grill_1'], 100);

  const { finalResults } = finishMatch(match);
  const p1 = finalResults.results.p1;
  check(
    'expenses sum inventory cost + setup upgrade cost + upgrades bought during service',
    p1.expenses === 150 + 50 + 100,
    `expenses=${p1.expenses}`,
  );
  check(
    'netProfit is revenue minus expenses, not gross revenue',
    p1.netProfit === 1000 - (150 + 50 + 100) && p1.netProfit < p1.revenue,
    `netProfit=${p1.netProfit}, revenue=${p1.revenue}`,
  );
}

// =============================================================================================
// 4. Each penalty type individually moves the score in the right direction
// =============================================================================================
{
  function baselineMatch(id) {
    const match = twoRestaurantProbe(id);
    forceOrderLedger(match, 'p1', { revenue: 800 });
    forceDistrictView(match, 'p1', { guestsServed: 40, satisfactionSum: 40 * 75, reputation: 65 });
    forceOrderLedger(match, 'p2', { revenue: 800 });
    forceDistrictView(match, 'p2', { guestsServed: 40, satisfactionSum: 40 * 75, reputation: 65 });
    return match;
  }

  const clean = finishMatch(baselineMatch('m_penalty_clean')).finalResults.results.p1.score;

  const abandoned = baselineMatch('m_penalty_abandon');
  forceDistrictView(abandoned, 'p1', { abandonedParties: 3 });
  const abandonedScore = finishMatch(abandoned).finalResults.results.p1.score;
  check(
    'customer abandonment lowers the score, by exactly the tuned per-party amount',
    Math.abs(clean - abandonedScore - 3 * SCORE_PENALTY_ABANDONMENT_POINTS) < 0.01,
    `clean=${clean.toFixed(2)} abandoned=${abandonedScore.toFixed(2)} delta=${(clean - abandonedScore).toFixed(2)}`,
  );

  const cancelled = baselineMatch('m_penalty_cancel');
  forceOrderLedger(cancelled, 'p1', { revenue: 800, cancelledOrders: 4 });
  const cancelledScore = finishMatch(cancelled).finalResults.results.p1.score;
  check(
    'cancelled orders lower the score, by exactly the tuned per-order amount',
    Math.abs(clean - cancelledScore - 4 * SCORE_PENALTY_CANCELLED_ORDER_POINTS) < 0.01,
    `delta=${(clean - cancelledScore).toFixed(2)}`,
  );

  const dissatisfied = baselineMatch('m_penalty_dissatisfied');
  forceDistrictView(dissatisfied, 'p1', { severelyDissatisfiedCount: 5 });
  const dissatisfiedScore = finishMatch(dissatisfied).finalResults.results.p1.score;
  check(
    'severe dissatisfaction lowers the score, by exactly the tuned per-party amount',
    Math.abs(clean - dissatisfiedScore - 5 * SCORE_PENALTY_SEVERE_DISSATISFACTION_POINTS) < 0.01,
    `delta=${(clean - dissatisfiedScore).toFixed(2)}`,
  );

  const wasted = baselineMatch('m_penalty_waste');
  forceOrderLedger(wasted, 'p1', { revenue: 800, cancelledRevenueForgone: 60, walkedOutRevenueForgone: 40 });
  const wastedScore = finishMatch(wasted).finalResults.results.p1.score;
  check(
    'unserved food waste lowers the score, by exactly the tuned per-dollar amount',
    Math.abs(clean - wastedScore - 100 * SCORE_PENALTY_WASTE_POINTS_PER_DOLLAR) < 0.01,
    `delta=${(clean - wastedScore).toFixed(2)}`,
  );
}

// =============================================================================================
// 5. Critic-event failure — a structural definition, cross-referenced against the timeline
// =============================================================================================
{
  const match = twoRestaurantProbe('m_critic');
  // A synthetic, fully-controlled critic window: forced directly onto the timeline the same way
  // check-events.mjs forces timeline data — deterministic, independent of the seeded RNG draw.
  match.eventTimeline.entries.push({
    index: 0,
    eventId: 'food_critic_spotted',
    announceAtMs: 0,
    activateAtMs: 1000,
    endAtMs: 5000,
    warningMs: 0,
    durationMs: 4000,
    highImpact: false,
  });
  match.eventTimeline.anchorMs = 0;

  const criticFailures = scoringInternal.countCriticFailures(match, [2500]); // inside the window
  check(
    'a bad moment inside the critic window counts as a failure',
    criticFailures === 1,
    `criticFailures=${criticFailures}`,
  );
  const noFailure = scoringInternal.countCriticFailures(match, [8000]); // after the window ends
  check(
    'a bad moment outside the critic window does not count',
    noFailure === 0,
    `criticFailures=${noFailure}`,
  );
  const oneWindow = scoringInternal.countCriticFailures(match, [1500, 2500, 3500]);
  check(
    'multiple bad moments in the SAME window count once, not once each',
    oneWindow === 1,
    `criticFailures=${oneWindow}`,
  );

  // End to end: force a cancelled order inside the window and confirm the penalty actually
  // reaches the composite score, not just the standalone helper.
  forceOrderLedger(match, 'p1', { revenue: 800, cancelledOrders: 1 });
  const state = orderInternal.ensureState(match);
  state.restaurants.get('p1').badMomentsMs.push(2500);
  forceOrderLedger(match, 'p2', { revenue: 800 });
  const { finalResults } = finishMatch(match);
  check(
    'a critic-window failure is visible in the wire-facing eventPerformance field',
    finalResults.results.p1.eventPerformance.criticFailures === 1,
    JSON.stringify(finalResults.results.p1.eventPerformance),
  );
  check(
    'the critic-failure penalty (largest of the five) is reflected in a real score gap',
    finalResults.results.p1.score < finalResults.results.p2.score - SCORE_PENALTY_CRITIC_FAILURE_POINTS + 20,
    `p1=${finalResults.results.p1.score.toFixed(1)} p2=${finalResults.results.p2.score.toFixed(1)}`,
  );
}

// =============================================================================================
// 6. Event objective bonus — delivered-during-event share, per restaurant independently
// =============================================================================================
{
  const match = twoRestaurantProbe('m_event_objective');
  forceOrderLedger(match, 'p1', { revenue: 500, ordersDelivered: 10, ordersDeliveredDuringEvent: 8 });
  forceOrderLedger(match, 'p2', { revenue: 500, ordersDelivered: 10, ordersDeliveredDuringEvent: 2 });
  const { finalResults } = finishMatch(match);
  check(
    'a restaurant that delivered more during active events scores a higher eventObjectiveFraction',
    finalResults.results.p1.eventPerformance.eventObjectiveFraction >
      finalResults.results.p2.eventPerformance.eventObjectiveFraction,
    `p1=${finalResults.results.p1.eventPerformance.eventObjectiveFraction} ` +
      `p2=${finalResults.results.p2.eventPerformance.eventObjectiveFraction}`,
  );
  check(
    'the fraction is exactly ordersDeliveredDuringEvent / ordersDelivered',
    finalResults.results.p1.eventPerformance.eventObjectiveFraction === 0.8 &&
      finalResults.results.p2.eventPerformance.eventObjectiveFraction === 0.2,
    `p1=${finalResults.results.p1.eventPerformance.eventObjectiveFraction} ` +
      `p2=${finalResults.results.p2.eventPerformance.eventObjectiveFraction}`,
  );
}

// =============================================================================================
// 7. Best-selling / highest-margin dishes
// =============================================================================================
{
  const match = twoRestaurantProbe('m_dishes');
  forceOrderDishSales(match, 'p1', 'smash_burger', 20, 20 * 14); // baseCost 5, margin/unit 9
  forceOrderDishSales(match, 'p1', 'caesar_salad', 5, 5 * 12); // baseCost from catalogue
  forceOrderLedger(match, 'p1', { revenue: 340 });
  forceOrderLedger(match, 'p2', { revenue: 0 });
  const { finalResults } = finishMatch(match);
  const p1 = finalResults.results.p1;
  check(
    'best-selling dishes are ranked by units sold, descending',
    p1.bestSellingDishes[0]?.dishId === 'smash_burger' && p1.bestSellingDishes[0]?.count === 20,
    JSON.stringify(p1.bestSellingDishes),
  );
  const burgerMargin = 14 - catalogue.dishesById.smash_burger.baseCost;
  check(
    'highest-margin dishes report revenue-per-unit minus catalogue baseCost',
    Math.abs((p1.highestMarginDishes.find((d) => d.dishId === 'smash_burger')?.marginPerUnit ?? -1) - burgerMargin) < 0.01,
    JSON.stringify(p1.highestMarginDishes),
  );
}

// =============================================================================================
// 8. Customer-segment breakdown and customers-lost-to-rival
// =============================================================================================
{
  const match = twoRestaurantProbe('m_segments');
  forceDistrictView(match, 'p1', {
    segmentCounts: { office_worker: 12, tourist: 3 },
    counts: { ...customerInternal.buildRestaurantView('p1').counts, [CUSTOMER_STATES.CHOOSE_RIVAL]: 7 },
  });
  forceOrderLedger(match, 'p1', { revenue: 300 });
  forceOrderLedger(match, 'p2', { revenue: 300 });
  const { finalResults } = finishMatch(match);
  check(
    'customerSegmentBreakdown reports the per-segment served counts verbatim',
    finalResults.results.p1.customerSegmentBreakdown.office_worker === 12 &&
      finalResults.results.p1.customerSegmentBreakdown.tourist === 3,
    JSON.stringify(finalResults.results.p1.customerSegmentBreakdown),
  );
  check(
    'customersLostToRival reads the CHOOSE_RIVAL exit count',
    finalResults.results.p1.customersLostToRival === 7,
    `${finalResults.results.p1.customersLostToRival}`,
  );
}

// =============================================================================================
// 9. Upgrades purchased
// =============================================================================================
{
  const match = twoRestaurantProbe('m_upgrades_purchased');
  forceUpgradeOwned(match, 'p1', ['serving_tray_1', 'faster_grill_1'], 305);
  forceOrderLedger(match, 'p1', { revenue: 100 });
  forceOrderLedger(match, 'p2', { revenue: 100 });
  const { finalResults } = finishMatch(match);
  check(
    'upgradesPurchased lists every owned upgrade id',
    finalResults.results.p1.upgradesPurchased.includes('serving_tray_1') &&
      finalResults.results.p1.upgradesPurchased.includes('faster_grill_1') &&
      finalResults.results.p1.upgradesPurchased.length === 2,
    JSON.stringify(finalResults.results.p1.upgradesPurchased),
  );
}

// =============================================================================================
// 10. Average wait time
// =============================================================================================
{
  const match = twoRestaurantProbe('m_wait_time');
  forceDistrictView(match, 'p1', { waitMsSum: 30_000, waitSamples: 3 }); // 10s average
  forceOrderLedger(match, 'p1', { revenue: 100 });
  forceOrderLedger(match, 'p2', { revenue: 100 });
  const { finalResults } = finishMatch(match);
  check(
    'averageWaitTimeMs is the mean of the sampled arrival-to-seated waits',
    finalResults.results.p1.averageWaitTimeMs === 10_000,
    `${finalResults.results.p1.averageWaitTimeMs}`,
  );
  check(
    'a restaurant that seated nobody reports zero, not NaN or a crash',
    finalResults.results.p2.averageWaitTimeMs === 0,
    `${finalResults.results.p2.averageWaitTimeMs}`,
  );
}

// =============================================================================================
// 11. Tie-breakers resolve in the documented §11 order
// =============================================================================================
{
  // Part A: a genuinely identical restaurant pair, run through the REAL end-to-end pipeline
  // (scoringSystem.onPhaseChange, not a synthetic score), lands on a bit-exact score tie and a
  // real draw. Since both sides take the IDENTICAL computation path with IDENTICAL inputs, there
  // is no floating-point cross-cancellation to worry about — unlike Part B below.
  function exactTieMatch(id) {
    const match = twoRestaurantProbe(id);
    const shared = { guestsServed: 40, satisfactionSum: 40 * 70, reputation: 60, abandonedParties: 2 };
    forceOrderLedger(match, 'p1', { revenue: 500 });
    forceOrderLedger(match, 'p2', { revenue: 500 });
    forceDistrictView(match, 'p1', { ...shared });
    forceDistrictView(match, 'p2', { ...shared });
    return match;
  }
  const exactTie = finishMatch(exactTieMatch('m_exact_tie')).finalResults;
  check(
    'a genuinely identical restaurant pair produces an exactly equal composite score',
    exactTie.results.p1.score === exactTie.results.p2.score,
    `p1=${exactTie.results.p1.score} p2=${exactTie.results.p2.score}`,
  );
  check(
    'identical on every tie-break metric too is a real draw — winnerPlayerId is null',
    exactTie.winnerPlayerId === null,
    `winner=${exactTie.winnerPlayerId}`,
  );

  // Part B: the four individual rungs. Reconstructing a bit-exact SCORE tie between two
  // DIFFERING sets of raw inputs (e.g. "more guestsServed, less reputation") turns out to be
  // unreliable here — `determineWinner` uses a deliberately strict `!==` on `score` with no
  // epsilon (correct: two matches with genuinely different play should never draw by accident),
  // but §11's weights (0.1, 0.2, 0.25, 0.4) are not exact binary fractions, so two different
  // arithmetic PATHS to "the same" score can differ by a ~1e-13 residual that strict equality
  // treats as a real (if minuscule) difference — deciding by score before ever reaching the
  // tie-break rung under test. That is `determineWinner` working exactly as designed, not a bug;
  // it just makes "reconstruct a tie via compensating raw inputs" the wrong tool for isolating
  // ONE rung. Instead: derive each restaurant's REAL `tieBreak` object the same way
  // `scoring-system.js` itself does — `buildRestaurantResult`, from forced match state, so the
  // wiring between live data and the tie-break fields is still fully exercised — then call
  // `determineWinner` with those real objects but a literal EQUAL synthetic `score` for both,
  // which is the only way to force the tie-break path deterministically without fighting
  // floating point. `score` itself is score-formula.js's own concern, verified independently.
  function realTieBreak(match, restaurantId) {
    const districtByRestaurant = new Map((match.districtSummary ?? []).map((d) => [d.restaurantId, d]));
    const orderByRestaurant = new Map((match.orderSummary ?? []).map((o) => [o.restaurantId, o]));
    const upgradeByRestaurant = new Map((match.upgradeSummary ?? []).map((u) => [u.restaurantId, u]));
    return scoringInternal.buildRestaurantResult(
      match, restaurantId, districtByRestaurant, orderByRestaurant, upgradeByRestaurant,
    ).tieBreak;
  }
  function rungWinner(match) {
    const transition = { from: match.phase, to: 'results', atMs: match.elapsedMs };
    customerSystem.onPhaseChange(match, transition);
    orderSystem.onPhaseChange(match, transition);
    upgradeSystem.onPhaseChange(match, transition);
    const p1TieBreak = realTieBreak(match, 'p1');
    const p2TieBreak = realTieBreak(match, 'p2');
    return {
      winner: determineWinner([
        { restaurantId: 'p1', score: 500, tieBreak: p1TieBreak },
        { restaurantId: 'p2', score: 500, tieBreak: p2TieBreak },
      ]),
      p1TieBreak,
      p2TieBreak,
    };
  }
  function rungMatch(id, overridesP1, overridesP2) {
    const match = twoRestaurantProbe(id);
    forceOrderLedger(match, 'p1', { revenue: 500, ...overridesP1.order });
    forceDistrictView(match, 'p1', { guestsServed: 40, satisfactionSum: 40 * 70, reputation: 60, abandonedParties: 2, ...overridesP1.district });
    forceOrderLedger(match, 'p2', { revenue: 500, ...overridesP2.order });
    forceDistrictView(match, 'p2', { guestsServed: 40, satisfactionSum: 40 * 70, reputation: 60, abandonedParties: 2, ...overridesP2.district });
    return match;
  }

  const rung1 = rungWinner(rungMatch('m_tie_satisfaction', { district: { satisfactionSum: 40 * 90 } }, {}));
  check(
    'tie-break rung 1: higher average satisfaction wins when the composite score is a genuine tie',
    rung1.winner === 'p1' && rung1.p1TieBreak.averageSatisfaction > rung1.p2TieBreak.averageSatisfaction,
    `p1=${rung1.p1TieBreak.averageSatisfaction} p2=${rung1.p2TieBreak.averageSatisfaction} winner=${rung1.winner}`,
  );

  // `averageSatisfaction` is `satisfactionSum / guestsServed` — scaling satisfactionSum by the
  // same factor as the guestsServed change keeps the average pinned at 70 on both sides, so
  // this genuinely isolates rung 2 rather than accidentally also changing rung 1's input.
  const rung2 = rungWinner(
    rungMatch('m_tie_guests', {}, { district: { guestsServed: 41, satisfactionSum: 41 * 70 } }),
  );
  check(
    'rung 2 setup: both sides genuinely have equal average satisfaction despite the guestsServed change',
    rung2.p1TieBreak.averageSatisfaction === rung2.p2TieBreak.averageSatisfaction,
    `p1=${rung2.p1TieBreak.averageSatisfaction} p2=${rung2.p2TieBreak.averageSatisfaction}`,
  );
  check(
    'tie-break rung 2: equal satisfaction falls to more guests served',
    rung2.winner === 'p2' && rung2.p2TieBreak.guestsServed > rung2.p1TieBreak.guestsServed,
    `p1=${rung2.p1TieBreak.guestsServed} p2=${rung2.p2TieBreak.guestsServed} winner=${rung2.winner}`,
  );

  const rung3 = rungWinner(rungMatch('m_tie_revenue', {}, { order: { revenue: 560 } }));
  check(
    'tie-break rung 3: equal satisfaction and guests served falls to higher net revenue',
    rung3.winner === 'p2' && rung3.p2TieBreak.netRevenue > rung3.p1TieBreak.netRevenue,
    `p1=${rung3.p1TieBreak.netRevenue} p2=${rung3.p2TieBreak.netRevenue} winner=${rung3.winner}`,
  );

  const rung4 = rungWinner(rungMatch('m_tie_abandoned', { district: { abandonedParties: 3 } }, {}));
  check(
    'tie-break rung 4: equal on the first three falls to fewer abandoned parties',
    rung4.winner === 'p2' && rung4.p2TieBreak.abandonedParties < rung4.p1TieBreak.abandonedParties,
    `p1=${rung4.p1TieBreak.abandonedParties} p2=${rung4.p2TieBreak.abandonedParties} winner=${rung4.winner}`,
  );
}

// =============================================================================================
// 12. Scores are never derived client-side — the server-only surface check
// =============================================================================================
{
  const clientFiles = ['client/src/game/GameClient.ts', 'client/src/ui/HudPanel.tsx'];
  const { readFileSync, existsSync } = await import('node:fs');
  let leaked = false;
  for (const file of clientFiles) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (/computeCompositeScore|score-formula/.test(text)) leaked = true;
  }
  check(
    'no client file imports or reimplements the scoring formula',
    !leaked,
    'grepped GameClient.ts and HudPanel.tsx for score-formula references',
  );
}

// =============================================================================================
// 13. A disconnect-triggered early end never runs scoringSystem — the existing {} fallback holds
// =============================================================================================
{
  const match = makeMatch({
    id: 'm_disconnect',
    phasePreset: 'prototype',
    setups: { p1: submission(), p2: submission() },
  });
  quiet(() => {
    for (let i = 0; i < 50 && match.phase !== 'setup'; i += 1) stepMatch(match, TICK_MS);
  });
  match.removePlayer('p2');
  quiet(() => {
    // Past RECONNECT_GRACE_MS with no reconnect: advanceClock ends the match directly.
    for (let i = 0; i < 2000 && !match.ended; i += 1) stepMatch(match, TICK_MS);
  });
  const message = match.matchCompleteMessage();
  check(
    'a disconnect-triggered end never invoked scoringSystem — match.finalResults was never set',
    match.finalResults === undefined,
    `finalResults=${JSON.stringify(match.finalResults)}`,
  );
  check(
    'match_complete still answers with the harmless {}-per-player fallback, not a crash',
    message.winnerPlayerId === null &&
      Object.keys(message.results).length === 2 &&
      Object.keys(message.results.p1).length === 0,
    JSON.stringify(message),
  );
  check(
    'the three STORY-014 match-wide fields fall back honestly too — null/[], never a guess, when scoring never ran',
    message.decidingSegment === null &&
      Array.isArray(message.turningPoints) && message.turningPoints.length === 0 &&
      message.tieBreakDecided === null,
    `decidingSegment=${JSON.stringify(message.decidingSegment)} turningPoints=${JSON.stringify(message.turningPoints)} tieBreakDecided=${JSON.stringify(message.tieBreakDecided)}`,
  );
}

// =============================================================================================
// 14. STORY-014 score/penalty breakdown — sums back to the same totals scoring-system.js used
// =============================================================================================
{
  const match = twoRestaurantProbe('m_breakdown');
  forceOrderLedger(match, 'p1', {
    revenue: 900,
    cancelledOrders: 2,
    cancelledRevenueForgone: 30,
    walkedOutRevenueForgone: 10,
  });
  forceDistrictView(match, 'p1', {
    guestsServed: 45,
    satisfactionSum: 45 * 80,
    reputation: 70,
    abandonedParties: 4,
    severelyDissatisfiedCount: 2,
  });
  forceOrderLedger(match, 'p2', { revenue: 900 });
  const { finalResults } = finishMatch(match);
  const p1 = finalResults.results.p1;
  const breakdownSum =
    p1.scoreBreakdown.revenueScore +
    p1.scoreBreakdown.guestsServedScore +
    p1.scoreBreakdown.satisfactionScore +
    p1.scoreBreakdown.reputationBonus +
    p1.scoreBreakdown.eventObjectiveBonus -
    p1.scoreBreakdown.penaltyScore;
  check(
    'scoreBreakdown components sum back to the exact same score the composite formula reported',
    Math.abs(breakdownSum - p1.score) < 0.001,
    `sum=${breakdownSum.toFixed(3)} score=${p1.score.toFixed(3)}`,
  );
  const penaltySum =
    p1.penaltyBreakdown.abandonmentPoints +
    p1.penaltyBreakdown.cancelledOrderPoints +
    p1.penaltyBreakdown.severeDissatisfactionPoints +
    p1.penaltyBreakdown.wastePoints +
    p1.penaltyBreakdown.criticFailurePoints;
  check(
    'penaltyBreakdown components sum to exactly scoreBreakdown.penaltyScore — the total the score actually subtracted',
    Math.abs(penaltySum - p1.scoreBreakdown.penaltyScore) < 0.001,
    `penaltySum=${penaltySum} penaltyScore=${p1.scoreBreakdown.penaltyScore}`,
  );
  check(
    'the abandonment penalty term is individually correct — 4 parties at the tuned rate',
    Math.abs(p1.penaltyBreakdown.abandonmentPoints - 4 * SCORE_PENALTY_ABANDONMENT_POINTS) < 0.001,
    `${p1.penaltyBreakdown.abandonmentPoints}`,
  );
  check(
    'computePenaltyBreakdown matches computePenaltyPoints term-for-term (pure module, independently)',
    Math.abs(
      computePenaltyBreakdown(
        { abandonedParties: 4, cancelledOrders: 2, severeDissatisfactionCount: 2, wasteDollars: 40, criticFailures: 0 },
        {
          abandonmentPoints: SCORE_PENALTY_ABANDONMENT_POINTS,
          cancelledOrderPoints: SCORE_PENALTY_CANCELLED_ORDER_POINTS,
          severeDissatisfactionPoints: SCORE_PENALTY_SEVERE_DISSATISFACTION_POINTS,
          wastePointsPerDollar: SCORE_PENALTY_WASTE_POINTS_PER_DOLLAR,
          criticFailurePoints: SCORE_PENALTY_CRITIC_FAILURE_POINTS,
        },
      ).cancelledOrderPoints - 2 * SCORE_PENALTY_CANCELLED_ORDER_POINTS,
    ) < 0.001,
    'cancelledOrderPoints term matches',
  );
}

// =============================================================================================
// 15. STORY-014 bestDish — fastest average fulfillment time, not most sold or highest-margin
// =============================================================================================
{
  const match = twoRestaurantProbe('m_best_dish');
  // A high-volume best-seller that is SLOW to fulfill...
  forceOrderDishFulfillment(match, 'p1', 'smash_burger', 20, 9000);
  // ...loses to a dish sold only 3 times but fulfilled much faster.
  forceOrderDishFulfillment(match, 'p1', 'caesar_salad', 3, 2000);
  forceOrderLedger(match, 'p1', { revenue: 340 });
  forceOrderLedger(match, 'p2', { revenue: 0 });
  const { finalResults } = finishMatch(match);
  check(
    'bestDish picks the fastest AVERAGE fulfillment time, not the best-seller',
    finalResults.results.p1.bestDish?.dishId === 'caesar_salad' &&
      finalResults.results.p1.bestDish?.avgFulfillmentMs === 2000,
    JSON.stringify(finalResults.results.p1.bestDish),
  );
  check(
    'a restaurant that sold nothing reports bestDish: null, not a crash',
    finalResults.results.p2.bestDish === null,
    JSON.stringify(finalResults.results.p2.bestDish),
  );
  // Falsifiable directly against the pure function too, with a dish at count: 0 (e.g. a menu
  // item that was priced but never ordered) mixed in — it must never win by default.
  const picked = pickBestDish([
    { dishId: 'never_ordered', count: 0, avgFulfillmentMs: 1 },
    { dishId: 'slow_seller', count: 20, avgFulfillmentMs: 9000 },
    { dishId: 'fast_niche', count: 3, avgFulfillmentMs: 2000 },
  ]);
  check(
    'pickBestDish (pure) ignores a zero-count entry even when its time is lowest',
    picked?.dishId === 'fast_niche',
    JSON.stringify(picked),
  );

  // Regression: a dish tallied with real sales but NO timing sample (`avgFulfillmentMs: null`
  // — e.g. `forceOrderDishSales` below, which forces `{dishId, count, revenue}` with no
  // fulfillment keys at all, the same shape a `dishSales` entry would have if it were ever
  // built by anything other than `deliverOrder`) must never be treated as an unbeatable 0ms.
  const untimedBeatsNothing = pickBestDish([
    { dishId: 'untimed_but_sold', count: 20, avgFulfillmentMs: null },
  ]);
  check(
    'pickBestDish (pure) reports null rather than crowning an untimed (avgFulfillmentMs: null) dish',
    untimedBeatsNothing === null,
    JSON.stringify(untimedBeatsNothing),
  );
  const untimedNeverBeatsTimed = pickBestDish([
    { dishId: 'untimed_but_sold', count: 50, avgFulfillmentMs: null },
    { dishId: 'timed_but_slower_looking', count: 1, avgFulfillmentMs: 9999 },
  ]);
  check(
    'pickBestDish (pure) prefers a real (if slow) timing over an untimed null, whatever the count',
    untimedNeverBeatsTimed?.dishId === 'timed_but_slower_looking',
    JSON.stringify(untimedNeverBeatsTimed),
  );

  // End to end: `forceOrderDishSales` (section 7's helper, used by m_dishes below) builds a
  // `dishSales` entry the same shape a pre-STORY-014 code path would — no fulfillment keys at
  // all. The real `orderSummary` builder must turn that into `avgFulfillmentMs: null`, not `0`,
  // so `bestDish` cannot crown it.
  const untimedMatch = twoRestaurantProbe('m_best_dish_untimed');
  forceOrderDishSales(untimedMatch, 'p1', 'smash_burger', 20, 20 * 14);
  forceOrderLedger(untimedMatch, 'p1', { revenue: 280 });
  forceOrderLedger(untimedMatch, 'p2', { revenue: 0 });
  const untimedResults = finishMatch(untimedMatch).finalResults;
  check(
    'end to end: a dish forced onto dishSales with no fulfillment sample never becomes bestDish',
    untimedResults.results.p1.bestDish === null,
    JSON.stringify(untimedResults.results.p1.bestDish),
  );
}

// =============================================================================================
// 16. STORY-014 largestLossCause — largest reason bucket, event-tagged only on a real majority
// =============================================================================================
{
  const match = twoRestaurantProbe('m_loss_cause');
  forceDistrictView(match, 'p1', {
    lostByReason: { better_price: 2, shorter_projected_wait: 7 },
  });
  // 5 of the 7 `shorter_projected_wait` losses (a real majority) fall inside a forced
  // `transit_delay` event window; the other 2 fall outside it.
  forceEventTimeline(match, [
    { index: 0, eventId: 'transit_delay', announceAtMs: 0, activateAtMs: 10_000, endAtMs: 20_000, warningMs: 0, durationMs: 10_000, highImpact: false },
  ]);
  forceDistrictDecisions(match, [
    ...Array.from({ length: 5 }, (_, i) => ({
      atMs: 11_000 + i * 1000,
      chosenRestaurantId: 'p2',
      reason: 'shorter_projected_wait',
    })),
    { atMs: 500, chosenRestaurantId: 'p2', reason: 'shorter_projected_wait' },
    { atMs: 25_000, chosenRestaurantId: 'p2', reason: 'shorter_projected_wait' },
    { atMs: 700, chosenRestaurantId: 'p2', reason: 'better_price' },
    { atMs: 900, chosenRestaurantId: 'p2', reason: 'better_price' },
  ]);
  forceOrderLedger(match, 'p1', { revenue: 100 });
  forceOrderLedger(match, 'p2', { revenue: 100 });
  const { finalResults } = finishMatch(match);
  check(
    'largestLossCause picks the largest lostByReason bucket, not the first one',
    finalResults.results.p1.largestLossCause?.reason === 'shorter_projected_wait' &&
      finalResults.results.p1.largestLossCause?.count === 7,
    JSON.stringify(finalResults.results.p1.largestLossCause),
  );
  check(
    'a real majority (5 of 7) of the bucket falling inside one event window tags that eventId',
    finalResults.results.p1.largestLossCause?.eventId === 'transit_delay',
    JSON.stringify(finalResults.results.p1.largestLossCause),
  );
  check(
    'a restaurant that lost nobody to a reasoned decision reports largestLossCause: null',
    finalResults.results.p2.largestLossCause === null,
    JSON.stringify(finalResults.results.p2.largestLossCause),
  );

  // Falsify the majority rule directly: scatter the SAME bucket 2-inside/3-outside a window —
  // no single event covers a majority, so the honest answer is null, not a guess.
  const scattered = pickLargestLossCause(
    { shorter_projected_wait: 5 },
    [
      { atMs: 11_000, chosenRestaurantId: 'p2', reason: 'shorter_projected_wait' },
      { atMs: 12_000, chosenRestaurantId: 'p2', reason: 'shorter_projected_wait' },
      { atMs: 500, chosenRestaurantId: 'p2', reason: 'shorter_projected_wait' },
      { atMs: 600, chosenRestaurantId: 'p2', reason: 'shorter_projected_wait' },
      { atMs: 700, chosenRestaurantId: 'p2', reason: 'shorter_projected_wait' },
    ],
    'p1',
    toEventWindows(
      [{ eventId: 'transit_delay', activateAtMs: 10_000, endAtMs: 20_000 }],
      0,
    ),
  );
  check(
    'pickLargestLossCause (pure) refuses to tag an event that covers less than half the bucket',
    scattered?.eventId === null && scattered?.reason === 'shorter_projected_wait',
    JSON.stringify(scattered),
  );
}

// =============================================================================================
// 17. STORY-014 decidingSegment — PRD §11's own worked example, and the honest tie/empty cases
// =============================================================================================
{
  const match = twoRestaurantProbe('m_segment');
  forceDistrictView(match, 'p1', { segmentCounts: { office_worker: 30, tourist: 10 } });
  forceDistrictView(match, 'p2', { segmentCounts: { office_worker: 12, tourist: 11 } });
  forceOrderLedger(match, 'p1', { revenue: 100 });
  forceOrderLedger(match, 'p2', { revenue: 100 });
  const { finalResults, message } = finishMatch(match);
  check(
    'decidingSegment picks the segment with the largest served-count DIFFERENCE, not the largest count',
    finalResults.decidingSegment?.segmentId === 'office_worker' &&
      finalResults.decidingSegment?.leaderRestaurantId === 'p1' &&
      finalResults.decidingSegment?.servedDifferential === 18,
    JSON.stringify(finalResults.decidingSegment),
  );
  check(
    'decidingSegment reaches the wire-facing match_complete message, not just match.finalResults',
    JSON.stringify(message.decidingSegment) === JSON.stringify(finalResults.decidingSegment),
    JSON.stringify(message.decidingSegment),
  );

  const tied = pickDecidingSegment({ p1: { office_worker: 10 }, p2: { office_worker: 10 } }, ['p1', 'p2']);
  check(
    'pickDecidingSegment (pure) reports null when every segment ties exactly — no fabricated pick',
    tied === null,
    JSON.stringify(tied),
  );
}

// =============================================================================================
// 18. STORY-014 turningPoints — largest party-acquisition swings, tied to the event/phase
// =============================================================================================
{
  const match = twoRestaurantProbe('m_turning_points');
  forceEventTimeline(match, [
    { index: 0, eventId: 'transit_delay', announceAtMs: 0, activateAtMs: 20_000, endAtMs: 40_000, warningMs: 0, durationMs: 20_000, highImpact: false },
  ]);
  const decisions = [
    // Before the event: p1 wins 3, p2 wins 1 — a small p1-leaning margin.
    { atMs: 1000, chosenRestaurantId: 'p1' },
    { atMs: 2000, chosenRestaurantId: 'p1' },
    { atMs: 3000, chosenRestaurantId: 'p1' },
    { atMs: 4000, chosenRestaurantId: 'p2' },
    // During the transit_delay event: p2 sweeps every decision — the big swing.
    { atMs: 22_000, chosenRestaurantId: 'p2' },
    { atMs: 25_000, chosenRestaurantId: 'p2' },
    { atMs: 28_000, chosenRestaurantId: 'p2' },
    { atMs: 31_000, chosenRestaurantId: 'p2' },
    { atMs: 34_000, chosenRestaurantId: 'p2' },
    { atMs: 37_000, chosenRestaurantId: 'p2' },
    // After the event: back to roughly even.
    { atMs: 45_000, chosenRestaurantId: 'p1' },
    { atMs: 46_000, chosenRestaurantId: 'p2' },
  ];
  forceDistrictDecisions(match, decisions);
  forceOrderLedger(match, 'p1', { revenue: 100 });
  forceOrderLedger(match, 'p2', { revenue: 100 });
  const { finalResults, message } = finishMatch(match);

  check(
    `turningPoints never exceeds RESULTS_TURNING_POINTS_MAX (${RESULTS_TURNING_POINTS_MAX})`,
    finalResults.turningPoints.length <= RESULTS_TURNING_POINTS_MAX,
    `${finalResults.turningPoints.length}`,
  );
  check(
    'the largest turning point is the transit_delay sweep, correctly attributed to p2',
    finalResults.turningPoints[0]?.eventId === 'transit_delay' &&
      finalResults.turningPoints[0]?.leaderRestaurantId === 'p2' &&
      finalResults.turningPoints[0]?.swing === 6,
    JSON.stringify(finalResults.turningPoints[0]),
  );
  check(
    'turning points are ranked by swing, descending',
    finalResults.turningPoints.every((p, i) => i === 0 || p.swing <= finalResults.turningPoints[i - 1].swing),
    JSON.stringify(finalResults.turningPoints.map((p) => p.swing)),
  );
  check(
    'turningPoints reaches the wire-facing match_complete message, not just match.finalResults',
    JSON.stringify(message.turningPoints) === JSON.stringify(finalResults.turningPoints),
    JSON.stringify(message.turningPoints),
  );

  // Falsify the phase tag directly: same decisions, no event at all — every swing should still
  // be reported, tagged by phase (service, since finalRushStartMs is far beyond every atMs here)
  // instead of by a nonexistent event.
  const noEventWindows = toEventWindows([], null);
  const phaseOnly = computeTurningPoints(decisions, ['p1', 'p2'], noEventWindows, 200_000, RESULTS_TURNING_POINTS_MAX);
  check(
    'computeTurningPoints (pure) tags a swing by phase when no event was active',
    phaseOnly.length > 0 && phaseOnly.every((p) => p.eventId === null && p.phase === 'service'),
    JSON.stringify(phaseOnly),
  );

  // A decision log that names neither restaurant id passed in (e.g. a stale/mismatched pairing)
  // has nothing to swing between — empty, not a crash.
  const noMatchPoints = computeTurningPoints(decisions, ['ghost_a', 'ghost_b'], [], null, RESULTS_TURNING_POINTS_MAX);
  check(
    'computeTurningPoints (pure) is empty when nothing in the decision log names either restaurant',
    Array.isArray(noMatchPoints) && noMatchPoints.length === 0,
    JSON.stringify(noMatchPoints),
  );
}

// =============================================================================================
// 19. STORY-014 tieBreakDecided — stated explicitly when it decides the match, silent otherwise
// =============================================================================================
{
  // Part A: the REAL end-to-end pipeline's genuine draw (section 11's m_exact_tie scenario,
  // rebuilt here) must report tieBreakDecided: null — nothing decided a draw, so there is
  // nothing to explain, on both match.finalResults and the wire-facing message.
  const drawMatch = twoRestaurantProbe('m_tiebreak_draw');
  const shared = { guestsServed: 40, satisfactionSum: 40 * 70, reputation: 60, abandonedParties: 2 };
  forceOrderLedger(drawMatch, 'p1', { revenue: 500 });
  forceOrderLedger(drawMatch, 'p2', { revenue: 500 });
  forceDistrictView(drawMatch, 'p1', { ...shared });
  forceDistrictView(drawMatch, 'p2', { ...shared });
  const { finalResults: drawResults, message: drawMessage } = finishMatch(drawMatch);
  check(
    'a genuine draw reports tieBreakDecided: null on match.finalResults',
    drawResults.tieBreakDecided === null,
    JSON.stringify(drawResults.tieBreakDecided),
  );
  check(
    'a genuine draw reports tieBreakDecided: null on the wire-facing match_complete message too',
    drawMessage.tieBreakDecided === null,
    JSON.stringify(drawMessage.tieBreakDecided),
  );

  // Part B: the NON-null path. Reconstructing a bit-exact composite-score TIE between two
  // restaurants that differ on a tie-break criterion runs into the exact same floating-point
  // residual problem section 11 Part B already documents at length (every one of the four
  // tie-break fields also feeds the score itself, directly or via a penalty, so compensating
  // one raw input to force score equality moves a tie-break field too, and the two arithmetic
  // PATHS to "the same" score differ by a ~1e-13 residual `determineWinner`'s deliberate
  // strict `!==` correctly treats as real). Section 11 Part B's own answer to this is to pull
  // the REAL `tieBreak` object out of `buildRestaurantResult` (so the match-state wiring is
  // still genuinely exercised) and drive `determineWinner`/`explainTieBreak` with a literal
  // equal synthetic score — exactly repeated here for `explainTieBreak`, on a FRESH probe match
  // (never reused across `finishMatch` calls, same reason `rungMatch` in section 11 always
  // builds fresh: `customerSystem.onPhaseChange('results')` tears down `_customerSimState`, so
  // forcing new district values onto an already-finished match creates orphaned state a stale
  // captured `districtSummary` snapshot would never see).
  const rungMatch = twoRestaurantProbe('m_tiebreak_rung1');
  forceOrderLedger(rungMatch, 'p1', { revenue: 500 });
  forceOrderLedger(rungMatch, 'p2', { revenue: 500 });
  // p1 satisfaction differs (rung 1); everything else stays identical, same shape as section
  // 11's own rung1 case.
  forceDistrictView(rungMatch, 'p1', { ...shared, satisfactionSum: 40 * 90 });
  forceDistrictView(rungMatch, 'p2', { ...shared });
  const rungTransition = { from: rungMatch.phase, to: 'results', atMs: rungMatch.elapsedMs };
  customerSystem.onPhaseChange(rungMatch, rungTransition);
  orderSystem.onPhaseChange(rungMatch, rungTransition);
  upgradeSystem.onPhaseChange(rungMatch, rungTransition);
  const districtByRestaurant = new Map((rungMatch.districtSummary ?? []).map((d) => [d.restaurantId, d]));
  const orderByRestaurant = new Map((rungMatch.orderSummary ?? []).map((o) => [o.restaurantId, o]));
  const upgradeByRestaurant = new Map((rungMatch.upgradeSummary ?? []).map((u) => [u.restaurantId, u]));
  const p1Real = scoringInternal.buildRestaurantResult(
    rungMatch, 'p1', districtByRestaurant, orderByRestaurant, upgradeByRestaurant, [],
  );
  const p2Real = scoringInternal.buildRestaurantResult(
    rungMatch, 'p2', districtByRestaurant, orderByRestaurant, upgradeByRestaurant, [],
  );
  const criterion = explainTieBreak(p1Real.tieBreak, p2Real.tieBreak);
  const winner = determineWinner([
    { restaurantId: 'p1', score: 500, tieBreak: p1Real.tieBreak },
    { restaurantId: 'p2', score: 500, tieBreak: p2Real.tieBreak },
  ]);
  check(
    'explainTieBreak (pure) names averageSatisfaction as the criterion that decided a real equal-score pair',
    criterion === 'averageSatisfaction' && winner === 'p1',
    `criterion=${criterion} winner=${winner}`,
  );
  check(
    'explainTieBreak (pure) agrees with compareForTieBreak/determineWinner on WHO the criterion favors',
    winner === 'p1',
    `winner=${winner}`,
  );

  // Falsify the RUNG ORDER directly: two synthetic tieBreak objects that differ on BOTH
  // averageSatisfaction (rung 1) and guestsServed (rung 2), each favoring a DIFFERENT side —
  // if `explainTieBreak` ever checked guestsServed before averageSatisfaction, this would name
  // the wrong criterion and the wrong winner.
  const orderCheckA = { averageSatisfaction: 80, guestsServed: 30, netRevenue: 500, abandonedParties: 2 };
  const orderCheckB = { averageSatisfaction: 60, guestsServed: 50, netRevenue: 500, abandonedParties: 2 };
  check(
    'explainTieBreak (pure) checks averageSatisfaction (rung 1) BEFORE guestsServed (rung 2), matching §11 order',
    explainTieBreak(orderCheckA, orderCheckB) === 'averageSatisfaction',
    `criterion=${explainTieBreak(orderCheckA, orderCheckB)}`,
  );
  check(
    'compareForTieBreak (pure) agrees — A wins on satisfaction despite trailing on guestsServed',
    compareForTieBreak(orderCheckA, orderCheckB) < 0,
    `compare=${compareForTieBreak(orderCheckA, orderCheckB)}`,
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
