#!/usr/bin/env node
import assert from 'node:assert/strict';
import data from '../shared/game-data/kitchen-command.json' with { type: 'json' };
import { rankTicketsForFocus } from '../shared/game-logic/kitchen-focus.js';
import { kitchenCommandSystem } from '../server/src/game/systems/kitchen-command-system.js';
import { handleInteract } from '../server/src/game/validators/action-validator.js';

const TICKETS = [
  { ticketId: 'near', dishId: 'smash_burger', price: 14, currentStepIndex: 2, totalSteps: 3, remainingProductionMs: 9000, completionProgress: .95, specialPressure: 0, scarcityRisk: .5, margin: 5, patienceRisk: .2 },
  { ticketId: 'special', dishId: 'nachos', price: 10, currentStepIndex: 0, totalSteps: 3, remainingProductionMs: 7000, completionProgress: .3, specialPressure: 2, scarcityRisk: .5, margin: 6, patienceRisk: .3 },
  { ticketId: 'short', dishId: 'caesar_salad', price: 12, currentStepIndex: 0, totalSteps: 2, remainingProductionMs: 1000, completionProgress: .2, specialPressure: 0, scarcityRisk: .4, margin: 4, patienceRisk: .1 },
  { ticketId: 'stock', dishId: 'pasta_primavera', price: 22, currentStepIndex: 0, totalSteps: 3, remainingProductionMs: 5000, completionProgress: .4, specialPressure: 0, scarcityRisk: .05, margin: 7, patienceRisk: .4 },
  { ticketId: 'premium', dishId: 'steak_frites', price: 32, currentStepIndex: 0, totalSteps: 3, remainingProductionMs: 8000, completionProgress: .5, specialPressure: 0, scarcityRisk: .8, margin: 24, patienceRisk: .5 },
  { ticketId: 'risk', dishId: 'chicken_sandwich', price: 13, currentStepIndex: 0, totalSteps: 3, remainingProductionMs: 6000, completionProgress: .1, specialPressure: 0, scarcityRisk: .6, margin: 8, patienceRisk: .98 },
];

function fixture() {
  const player = {
    playerId: 'p1', position: { x: 2.5, y: 0, z: 2 }, lastInteractSequence: 0, pendingAction: null,
    setup: { menu: [{ dishId: 'smash_burger' }, { dishId: 'caesar_salad' }, { dishId: 'steak_frites' }], addons: [] },
  };
  const logs = [];
  const match = {
    elapsedMs: 1000, phase: 'service', isServicePhase: true, players: new Map([['p1', player]]),
    kitchen: {
      queueDepth: (_id, station) => ({ prep: 4, grill: 1, oven: 0, plating: 2 })[station] ?? 0,
      readyOrders: () => [{ readyAgeMs: 4500 }],
    },
    floor: {},
    pantry: {
      shortagesFor: () => [], stockOf: () => 20, binLevel: () => 5,
    },
    dishAvailability: { p1: { smash_burger: true, caesar_salad: true, steak_frites: true } },
    events: [{ eventId: 'office_break_starts', state: 'active' }],
    eventEffects: { dishTagDemandMultipliers: {} },
    customers: [],
    frontDoor: { featuredDishId: () => null, stateFor: () => ({ activeSpecialId: null }) },
    logEvent: (category, detail) => logs.push({ category, ...detail }),
  };
  kitchenCommandSystem.onPhaseChange(match, { to: 'service' });
  return { match, player, logs };
}

let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`  ok   ${name}`); };
console.log('Kitchen Command authority and focus comparison\n');

check('six complete data-defined focuses ship with explicit benefit and opportunity cost', () => {
  assert.deepEqual(data.focuses.map((focus) => focus.id), ['rush_pass', 'protect_special', 'clear_queue', 'save_ingredients', 'premium_first', 'recovery_mode']);
  for (const focus of data.focuses) for (const key of ['metric', 'direction', 'bestUse', 'benefit', 'downside']) assert.ok(focus[key]);
});

check('the same ticket mix produces the intended first choice under every focus', () => {
  const expected = { rush_pass: 'near', protect_special: 'special', clear_queue: 'short', save_ingredients: 'stock', premium_first: 'premium', recovery_mode: 'risk' };
  for (const focus of data.focuses) assert.equal(rankTicketsForFocus(focus, TICKETS)[0].ticketId, expected[focus.id]);
});

check('ranking preserves the exact input ticket set and changes priority only', () => {
  for (const focus of data.focuses) assert.deepEqual(rankTicketsForFocus(focus, TICKETS).map((ticket) => ticket.ticketId).sort(), TICKETS.map((ticket) => ticket.ticketId).sort());
});

const run = fixture();
check('one server-authoritative focus is active at service start', () => assert.equal(run.match.kitchenCommand.focusFor('p1').id, data.defaultFocusId));
check('a focus change at the physical pass board succeeds', () => assert.equal(handleInteract(run.match, 'p1', { sequence: 1, targetId: 'kitchen_focus_clear_queue', action: 'kitchen_command' }).ok, true));
check('the active focus is singular and immediately published', () => assert.equal(run.match.kitchenCommand.privateFor('p1').activeFocusId, 'clear_queue'));
check('rapid switching is rejected during the data-defined commitment window', () => assert.equal(run.match.kitchenCommand.command('p1', 'premium_first').reason, 'focus_cooldown'));
run.match.elapsedMs += data.switchCooldownMs;
check('switching becomes available after the commitment expires', () => assert.equal(run.match.kitchenCommand.command('p1', 'premium_first').ok, true));
check('unknown focus ids are rejected without changing the active focus', () => { assert.equal(run.match.kitchenCommand.command('p1', 'magic').reason, 'unknown_kitchen_focus'); assert.equal(run.match.kitchenCommand.focusFor('p1').id, 'premium_first'); });
check('range is revalidated server-side', () => { const far = fixture(); far.player.position = { x: -50, y: 0, z: -50 }; assert.equal(handleInteract(far.match, 'p1', { sequence: 1, targetId: 'kitchen_focus_clear_queue', action: 'kitchen_command' }).reason, 'out_of_range'); });
check('phase is revalidated server-side', () => { const wrong = fixture(); wrong.match.phase = 'setup'; wrong.match.isServicePhase = false; assert.equal(handleInteract(wrong.match, 'p1', { sequence: 1, targetId: 'kitchen_focus_clear_queue', action: 'kitchen_command' }).reason, 'wrong_phase'); });
check('the private overview carries queues, ready age, shortages, menu availability, event pressure, and a qualitative recommendation', () => {
  const view = run.match.kitchenCommand.privateFor('p1');
  assert.equal(view.stationQueues.find((item) => item.station === 'prep').queued, 4);
  assert.equal(view.oldestReadyFoodMs, 4500);
  assert.ok(Array.isArray(view.shortages));
  assert.equal(view.menuAvailability.length, 3);
  assert.deepEqual(view.activeEventIds, ['office_break_starts']);
  assert.equal(typeof view.recommendation.reason, 'string');
});
check('focus changes and worker selections are recorded in telemetry with their reason context', () => {
  run.match.kitchenCommand.recordSelection('p1', 'cook_1', TICKETS[0]);
  assert.ok(run.logs.some((entry) => entry.category === 'kitchen_focus_changed'));
  assert.ok(run.logs.some((entry) => entry.category === 'kitchen_focus_selection' && entry.workerId === 'cook_1'));
});

console.log(`\n${passed}/${passed} checks passed.`);
