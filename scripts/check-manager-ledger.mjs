#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { managerLedgerSystem, _internal } from '../server/src/game/systems/manager-ledger-system.js';
import { MANAGER_CONSTRAINT_IDS } from '../shared/game-logic/manager-ledger.js';

let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`  ok   ${name}`); };
console.log("Manager's Ledger authority and evidence check\n");

const match = {
  elapsedMs: 20_000,
  players: new Map([['p1', {}]]),
  restaurants: [{ restaurantId: 'p1', queueLength: 6, averageSatisfaction: 61, tables: [{ dirty: true }], shortages: [{ blockedTickets: 2 }] }],
  districtSummary: [{ restaurantId: 'p1', guestsServed: 9, counts: { chosen: 4, CHOOSE_RIVAL: 6, LEAVE_DISTRICT: 1 } }],
  orders: Array.from({ length: 4 }, (_, index) => ({ restaurantId: 'p1', state: 'queued', blockedByIngredientId: null, ticketId: `ticket_${index}` })),
  customers: [{ restaurantId: 'p1', unhappy: true }],
  frontDoor: {
    publicFor: () => ({ activeSpecialId: 'lunch_express', activeForMs: 11_000 }),
    special: () => ({ cost: 12 }),
  },
  serviceStation: {
    publicFor: () => ({ priorityId: 'ready_food', payrollBurn: 4, laborExpenses: 34, contracts: [{ status: 'active' }, { status: 'arriving' }] }),
    expensesFor: () => ({ laborExpenses: 34, hireFees: 18, wagesPaid: 16 }),
  },
  kitchenCommand: {
    privateFor: () => ({
      activeFocusId: 'premium_first', oldestReadyFoodMs: 18_000,
      menuAvailability: [{ dishId: 'burger', available: false }],
      recommendation: { focusId: 'save_ingredients', reason: 'Ingredients are limiting the menu.' },
      selectionsByFocus: { rush_pass: 2, premium_first: 3 },
    }),
  },
  pantry: { publicFor: () => ({ overallRisk: 'BLOCKING', deliveries: [{}] }) },
  inventorySummary: [{ restaurantId: 'p1', inventoryExpenses: 27, marketPremiumPaid: 6, stockOrdersPlaced: 2, shortageDurationMs: 12_000 }],
  districtDecisions: [{ atMs: 5_000, chosenRestaurantId: 'p1' }, { atMs: 8_000, chosenRestaurantId: 'p2' }],
  telemetry: [
    { atMs: 1_000, category: 'front_door_special_activated', restaurantId: 'p1', specialId: 'lunch_express', cost: 12, durationMs: 30_000 },
    { atMs: 2_000, category: 'service_contract_hired', restaurantId: 'p1', contractId: 'relief_server' },
    { atMs: 3_000, category: 'kitchen_focus_changed', restaurantId: 'p1', focusId: 'premium_first' },
    { atMs: 4_000, category: 'worker_task_completed', restaurantId: 'p1', workerId: 'temp_relief_server_1', taskKind: 'deliver_order' },
    { atMs: 12_000, category: 'order', restaurantId: 'p1', state: 'delivered', placedAtMs: 6_000, revenue: 18 },
  ],
  logEvent(category, payload) { this.telemetry.push({ atMs: this.elapsedMs, category, ...payload }); },
};

_internal.ensure(match);
managerLedgerSystem.update(match, 5_000);
const live = match.managerLedger.privateFor('p1');

check('the private HUD state combines front door, dining room, kitchen, and pantry choices', () => {
  assert.equal(live.chips.frontDoor.activeSpecialId, 'lunch_express');
  assert.equal(live.chips.service.activeContracts, 1);
  assert.equal(live.chips.service.payrollBurn, 4);
  assert.equal(live.chips.kitchen.activeFocusId, 'premium_first');
  assert.equal(live.chips.pantry.risk, 'BLOCKING');
});

check('the tactical diagnosis contains all five required constraint classes exactly once', () => {
  assert.deepEqual(live.constraints.map((item) => item.id), [...MANAGER_CONSTRAINT_IDS]);
  assert.equal(new Set(live.constraints.map((item) => item.id)).size, 5);
  assert.equal(live.dominantConstraint, 'production');
});

check('each live constraint carries a qualitative band and observed evidence', () => {
  for (const constraint of live.constraints) {
    assert.match(constraint.status, /^(clear|watch|limiting)$/);
    assert.ok(constraint.evidence.length > 20);
  }
});

check('constraint telemetry records the full score set and dominant limitation', () => {
  const sample = match.telemetry.find((event) => event.category === 'manager_constraint_sample');
  assert.equal(sample.dominantConstraint, 'production');
  assert.deepEqual(Object.keys(sample.scores), [...MANAGER_CONSTRAINT_IDS]);
});

managerLedgerSystem.onPhaseChange(match, { to: 'results' });
const result = match.managerLedgerSummary[0];

check('results report observed special-window decisions, orders, revenue, check, satisfaction, queue, and spend', () => {
  assert.deepEqual(result.specials[0], {
    specialId: 'lunch_express', activations: 1, spend: 12,
    observedDecisions: 2, observedConversions: 1, observedConversionRate: 0.5,
    deliveredOrders: 1, observedRevenue: 18, averageCheck: 18, averageSatisfaction: 61, peakQueue: 6,
  });
});

check('results separate temporary labor outcomes, costs, restock expense, and market premium', () => {
  assert.deepEqual(result.labor, {
    contractsHired: 1, laborExpenses: 34, hireFees: 18, wagesPaid: 16,
    taskCompletions: 1, taskCompletionsByKind: { deliver_order: 1 },
  });
  assert.deepEqual(result.restocking, { expense: 27, marketPremiumPaid: 6, ordersPlaced: 2, shortageDurationMs: 12_000 });
});

check('kitchen changes, focus selections, and recommendation mismatch are tracked', () => {
  assert.equal(result.kitchen.focusChanges, 1);
  assert.equal(result.kitchen.finalFocusId, 'premium_first');
  assert.deepEqual(result.kitchen.selectionsByFocus, { rush_pass: 2, premium_first: 3 });
  assert.equal(result.kitchen.recommendationMismatchMs, 5_000);
});

check('every narrative observation is backed by a value present in the frozen result', () => {
  assert.ok(result.insights.length >= 4);
  assert.ok(result.insights.some((item) => item.observation.includes('$12.00')));
  assert.ok(result.insights.some((item) => item.observation.includes('$34.00')));
  assert.ok(result.insights.some((item) => item.observation.includes('$27.00')));
});

check('results observations do not claim unmeasured causality', () => {
  const text = result.insights.map((item) => item.observation).join(' ').toLowerCase();
  for (const unsupported of ['caused', 'increased', 'decreased', 'improved', 'reduced', 'led to']) assert.ok(!text.includes(unsupported), unsupported);
});

check('the React HUD, tactical overview, results ledger, and HTML harness are wired', () => {
  const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.match(read('client/src/ui/HudPanel.tsx'), /manager-chips/);
  assert.match(read('client/src/ui/TacticalOverviewPanel.tsx'), /Constraint diagnosis/);
  // STORY-047 restructured the results screen into a category shell (`ResultsPanel.tsx`) plus
  // per-category section components under `client/src/ui/recap/`. The full "Manager's ledger"
  // breakdown (dominant constraint, cost articles, specials) no longer renders anywhere until
  // STORY-049/050 add it back under their own categories — only the single lead
  // `managerLedger.insights[0]` takeaway survives into this story's "opening highlights". This
  // assertion now checks that the LEAD TAKEAWAY DATA is still wired into the recap's highlights
  // section, rather than pinning a specific heading string in a file this redesign moved the
  // heading out of. If STORY-050 ("Next shift — coaching game plan") relocates the lead
  // takeaway under its own category, repoint this `read()` call to wherever it lands — the
  // point is that SOME recap file still reads `managerLedger.insights`, not that this exact
  // path is permanent.
  assert.match(read('client/src/ui/recap/RecapHighlights.tsx'), /managerLedger\.insights/);
  assert.match(read('harnesses/src/harnesses.ts'), /managerLedgerHarness/);
  assert.match(read('server/src/game/systems/scoring-system.js'), /managerLedgerSummary/);
  assert.match(read('server/src/game/systems/scoring-system.js'), /specialExpenses/);
  assert.match(read('server/src/game/systems/worker-system.js'), /worker_task_completed/);
});

console.log(`\n${passed}/${passed} checks passed.`);
