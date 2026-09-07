#!/usr/bin/env node
import specialsData from '../shared/game-data/front-door-specials.json' with { type: 'json' };
import { frontDoorSystem } from '../server/src/game/systems/front-door-system.js';
import { handleInteract } from '../server/src/game/validators/action-validator.js';

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function fixture({ marketId = 'downtown_lunch', queueLength = 3, activeEvent = true, cash = 100 } = {}) {
  const player = {
    playerId: 'p1', position: { x: 3, y: 0, z: -9 }, lastInteractSequence: 0, pendingAction: null,
    setup: { menu: [{ dishId: 'smash_burger', price: 14 }, { dishId: 'caesar_salad', price: 12 }], addons: [] },
  };
  const match = {
    elapsedMs: 1_000, phase: 'service', isServicePhase: true,
    players: new Map([['p1', player]]), market: { id: marketId },
    events: activeEvent ? [{ eventId: 'fixture_event', state: 'active' }] : [],
    eventEffects: { dishTagDemandMultipliers: { office: 1.35, stadium: 1.1 } },
    restaurants: [{ restaurantId: 'p1', queueLength }],
    kitchen: {}, floor: {}, pantry: {}, upgrades: { cashAvailable: () => cash },
  };
  frontDoorSystem.onPhaseChange(match, { to: 'service' });
  return { match, player };
}

console.log('Front-door policy harness\n');
const required = ['id', 'name', 'durationMs', 'cooldownMs', 'cost', 'eligibility', 'benefit', 'downside', 'effects'];
check('all six PRD specials carry complete data', specialsData.specials.length === 6 && specialsData.specials.every((s) => required.every((key) => key in s)), specialsData.specials.map((s) => s.name).join(', '));

const { match, player } = fixture();
player.position = { x: 20, y: 0, z: 20 };
const far = handleInteract(match, 'p1', { sequence: 1, targetId: 'special_lunch_express', action: 'activate_special' });
check('activation requires physical host-stand range', !far.ok && far.reason === 'out_of_range', JSON.stringify(far));
player.position = { x: 3, y: 0, z: -9 };
const activated = handleInteract(match, 'p1', { sequence: 2, targetId: 'special_lunch_express', action: 'activate_special' });
check('eligible activation succeeds server-side', activated.ok === true);
check('one active special is enforced', match.frontDoor.activate('p1', 'happy_hour').reason === 'special_unavailable');
check('cost is recorded for shared available cash', match.frontDoor.spentFor('p1') === 12, `$${match.frontDoor.spentFor('p1')}`);
check('public state exposes active time and eligibility', match.frontDoor.publicFor('p1').activeSpecialId === 'lunch_express' && match.frontDoor.publicFor('p1').activeForMs === 30_000);

match.elapsedMs += 30_000;
frontDoorSystem.update(match);
check('special expires at its data-defined duration', match.frontDoor.activeSpecial('p1') === null);
check('cooldown blocks immediate reuse', match.frontDoor.activate('p1', 'lunch_express').reason === 'special_unavailable');
match.elapsedMs += 45_000;
check('activation returns after the data-defined cooldown', match.frontDoor.activate('p1', 'lunch_express').ok === true);
check('server rejects context-ineligible specials', fixture({ marketId: 'uptown_pre_theater', activeEvent: false, queueLength: 0 }).match.frontDoor.activate('p1', 'game_day_combo').reason === 'special_ineligible');
check('server rejects unaffordable specials', fixture({ cash: 0 }).match.frontDoor.activate('p1', 'lunch_express').reason === 'insufficient_cash');
const chef = fixture();
check("Chef's Feature promotes the strongest available event-fit dish", chef.match.frontDoor.activate('p1', 'chefs_feature').ok && chef.match.frontDoor.publicFor('p1').featuredDishId === 'caesar_salad');

const failed = results.filter((pass) => !pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
if (failed) process.exitCode = 1;
