#!/usr/bin/env node
import assert from 'node:assert/strict';
import data from '../shared/game-data/service-station.json' with { type: 'json' };
import { serviceStationSystem } from '../server/src/game/systems/service-station-system.js';
import { handleInteract } from '../server/src/game/validators/action-validator.js';

function fixture(startingCash = 100) {
  const player = { playerId: 'p1', position: { x: 7, y: 0, z: -1 }, lastInteractSequence: 0, pendingAction: null };
  const added = []; const removed = []; const log = [];
  const match = {
    elapsedMs: 1000, phase: 'service', isServicePhase: true, players: new Map([['p1', player]]),
    kitchen: {}, floor: {}, pantry: {},
    brigade: {
      addTemporaryWorker: (id, workerId, role, taskPriorities) => { added.push({ id, workerId, role, taskPriorities }); return true; },
      removeTemporaryWorker: (id, workerId) => { removed.push({ id, workerId }); return true; },
    },
    logEvent: (category, details) => log.push({ category, details }),
  };
  match.upgrades = { cashAvailable: (id) => startingCash - (match.serviceStation?.spentFor(id) ?? 0) };
  serviceStationSystem.onPhaseChange(match, { to: 'service' });
  return { match, player, added, removed, log };
}

let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`  ok   ${name}`); };
console.log('Service Station authority check\n');

check('two complete match-scoped contracts are data-defined', () => {
  assert.deepEqual(data.contracts.map((item) => item.id), ['relief_server', 'busser']);
  for (const item of data.contracts) for (const key of ['taskPriorities', 'hireFee', 'wage', 'wageIntervalMs', 'arrivalDelayMs', 'maxCount', 'durationMs', 'commitmentMs', 'benefit', 'downside']) assert.ok(key in item);
});
check('four explicit service priorities are data-defined', () => assert.deepEqual(data.priorities.map((item) => item.id), ['balanced', 'ready_food', 'turnover', 'guest_recovery']));

const run = fixture();
check('hire intent is range-checked and accepted by the server', () => assert.equal(handleInteract(run.match, 'p1', { sequence: 1, targetId: 'service_hire_relief_server', action: 'service_command' }).ok, true));
check('hire fee is deducted immediately and separately accounted', () => assert.deepEqual(run.match.serviceStation.expensesFor('p1'), { laborExpenses: 18, hireFees: 18, wagesPaid: 0 }));
check('worker remains in arriving state for the authored delay', () => { serviceStationSystem.update(run.match); assert.equal(run.added.length, 0); assert.equal(run.match.serviceStation.publicFor('p1').contracts[0].status, 'arriving'); });
run.match.elapsedMs = 6000; serviceStationSystem.update(run.match);
check('worker visibly joins with data-defined role priorities after arrival delay', () => assert.deepEqual(run.added[0], { id: 'p1', workerId: 'temp_relief_server_1', role: 'server', taskPriorities: ['deliver_order', 'take_order', 'seat_party', 'collect_payment', 'clear_table'] }));
run.match.elapsedMs = 16000; serviceStationSystem.update(run.match);
check('recurring wage burn is server-accounted', () => assert.deepEqual(run.match.serviceStation.expensesFor('p1'), { laborExpenses: 22, hireFees: 18, wagesPaid: 4 }));
check('one priority is authoritative and rapid switching is blocked', () => { assert.equal(run.match.serviceStation.command('p1', 'priority_turnover').ok, true); assert.equal(run.match.serviceStation.command('p1', 'priority_guest_recovery').reason, 'priority_cooldown'); assert.equal(run.match.serviceStation.priorityFor('p1'), 'turnover'); });
check('commitment prevents an instant release/refund loop', () => assert.equal(run.match.serviceStation.command('p1', 'release_relief_server').reason, 'contract_committed'));
run.match.elapsedMs = 22000;
check('release succeeds after commitment and removes the worker without refund', () => { assert.equal(run.match.serviceStation.command('p1', 'release_relief_server').ok, true); assert.equal(run.removed.length, 1); assert.equal(run.match.serviceStation.spentFor('p1'), 22); });
check('cash authority rejects an unaffordable hire', () => assert.equal(fixture(0).match.serviceStation.command('p1', 'hire_busser').reason, 'insufficient_cash'));

console.log(`\n${passed}/${passed} checks passed.`);
