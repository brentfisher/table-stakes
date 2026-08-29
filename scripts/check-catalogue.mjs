#!/usr/bin/env node
// Catalogue integrity check — the executable acceptance criterion for STORY-002.
//
// The repo has no test framework (design Decision 8), so this is the runnable script that
// proves the shipped shared/game-data/ catalogue is internally consistent, and that
// shared/schemas/validation.js accepts the PRD §12 client message examples and rejects
// malformed ones.
//
// Run: node scripts/check-catalogue.mjs

import { readCatalogueFiles, validateCatalogue, loadCatalogue, SEGMENT_WEIGHT_TOLERANCE }
  from '../shared/game-data/loader.js';
import { validateClientMessage } from '../shared/schemas/validation.js';
import { CUSTOMER_EXIT_STATES, CUSTOMER_STATES } from '../shared/schemas/game-state.js';
import { CLIENT_MESSAGE_TYPES, IMPLEMENTED_CLIENT_MESSAGE_TYPES } from '../shared/schemas/messages.js';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('Catalogue and schema check\n');

// --- 1. the shipped catalogue is internally consistent -------------------------------
const raw = readCatalogueFiles();
const errors = validateCatalogue(raw);
check('shipped catalogue reports zero integrity errors', errors.length === 0,
  errors.length === 0 ? '' : `\n      ${errors.join('\n      ')}`);

const catalogue = errors.length === 0 ? loadCatalogue() : null;
if (catalogue) {
  check('dish count is within the PRD §7 range of 8-10',
    catalogue.dishes.length >= 8 && catalogue.dishes.length <= 10, `${catalogue.dishes.length} dishes`);
  check('the three PRD §6 MVP markets are present',
    ['downtown_lunch', 'uptown_pre_theater', 'stadium_district'].every((id) => id in catalogue.marketsById),
    Object.keys(catalogue.marketsById).join(', '));
  check('the five PRD §6 customer segments are present', catalogue.segments.length === 5,
    catalogue.segments.map((s) => s.id).join(', '));
  check('at least five PRD §9 events are present', catalogue.events.length >= 5,
    `${catalogue.events.length} events`);
  check('at least five PRD §10 upgrades are present', catalogue.upgrades.length >= 5,
    `${catalogue.upgrades.length} upgrades`);

  // §16 worked examples must survive verbatim — later stories' criteria cite these values.
  const burger = catalogue.dishesById.smash_burger;
  check('smash_burger matches the PRD §16 example field for field',
    burger?.baseCost === 5 && burger?.suggestedPrice === 14 && burger?.baseSatisfaction === 65 &&
    burger?.stationSteps.length === 3 && burger.stationSteps[1].station === 'grill' &&
    burger.stationSteps[1].durationMs === 6000 && burger.marketAffinity.stadium_district === 1.25);
  const downtown = catalogue.marketsById.downtown_lunch;
  check('downtown_lunch matches the PRD §16 example field for field',
    downtown?.priceSensitivity === 1.2 && downtown?.baseFootTrafficPerMinute === 14 &&
    downtown?.segmentWeights.office_worker === 0.55 && downtown?.eventPool.length === 4);
  const baseball = catalogue.eventsById.baseball_game_ends;
  check('baseball_game_ends matches the PRD §16 example field for field',
    baseball?.warningMs === 15000 && baseball?.durationMs === 60000 &&
    baseball?.effects.footTrafficMultiplier === 1.8 &&
    baseball?.effects.partySizeMultiplier === 1.4 &&
    baseball?.effects.segmentWeightOverrides.event_fan === 0.65 &&
    baseball?.effects.dishTagDemandMultipliers.stadium === 1.35);
}

// --- 2. the loader fails loudly on each inconsistency the story names ------------------
const clone = () => JSON.parse(JSON.stringify(raw));
const breaks = (label, mutate) => {
  const bad = clone();
  mutate(bad);
  const found = validateCatalogue(bad);
  check(`loader rejects ${label}`, found.length > 0, found[0] ?? 'NO ERROR REPORTED');
};

breaks('an unknown ingredient', (c) => { c.dishes.dishes[0].ingredients.unobtainium = 1; });
breaks('an unknown station', (c) => { c.dishes.dishes[0].stationSteps[0].station = 'sous_vide'; });
breaks('an unknown segment in segmentWeights', (c) => {
  c.markets.markets[0].segmentWeights.food_critic = 0;
});
breaks('an unknown event in an eventPool', (c) => { c.markets.markets[0].eventPool[0] = 'meteor'; });
breaks('segmentWeights that do not sum to 1.0', (c) => {
  c.markets.markets[0].segmentWeights.office_worker += 0.05;
});
breaks('a non-snake_case id', (c) => { c.dishes.dishes[0].id = 'smashBurger'; });
breaks('a duplicate id', (c) => { c.events.events[1].id = c.events.events[0].id; });
breaks('an unknown market in marketAffinity', (c) => {
  c.dishes.dishes[0].marketAffinity.arts_nightlife = 1.1;
});
breaks('a missing durationMs on a station step', (c) => {
  delete c.dishes.dishes[0].stationSteps[0].durationMs;
});

// A drift of exactly the stated tolerance must still pass; anything larger must not.
{
  const nearly = clone();
  nearly.markets.markets[0].segmentWeights.office_worker += SEGMENT_WEIGHT_TOLERANCE / 2;
  check(`segmentWeight drift within the stated tolerance (${SEGMENT_WEIGHT_TOLERANCE}) is accepted`,
    validateCatalogue(nearly).length === 0);
}

// --- 3. customer state enum, PRD §8 -----------------------------------------------------
check('all five PRD §8 exit states are declared',
  ['CHOOSE_RIVAL', 'LEAVE_DISTRICT', 'ABANDON_QUEUE', 'CANCEL_ORDER', 'LEAVE_ANGRY']
    .every((s) => CUSTOMER_EXIT_STATES.includes(s) && CUSTOMER_STATES[s] === s),
  CUSTOMER_EXIT_STATES.join(', '));
check('the PRD §8 main-path states are declared',
  ['ENTER_DISTRICT', 'EVALUATE_RESTAURANTS', 'APPROACH_OR_QUEUE', 'SEATED', 'ORDERING',
    'WAITING_FOR_FOOD', 'EATING', 'PAYING', 'LEAVING', 'REVIEW']
    .every((s) => CUSTOMER_STATES[s] === s));

// --- 4. message validation, PRD §12 -----------------------------------------------------
// The §12 JSON examples, verbatim. Shape validation runs with requireImplemented:false so
// this exercises every validator; the router's not_implemented gate is checked separately.
const examples = [
  { type: 'player_input', sequence: 482, move: { x: 0.0, z: 1.0, sprint: false }, facing: 1.57 },
  { type: 'interact', sequence: 483, targetId: 'station_grill_1', action: 'cook' },
  { type: 'purchase_upgrade', sequence: 484, upgradeId: 'faster_grill_1' },
  {
    type: 'setup_submit',
    menu: [
      { dishId: 'smash_burger', price: 14 },
      { dishId: 'chicken_sandwich', price: 13 },
      { dishId: 'nachos', price: 16 },
    ],
    addons: [{ dishId: 'espresso', price: 5 }],
    startingUpgradeId: 'serving_tray_1',
    staffAssignments: { cook_1: 'grill', server_1: 'dining_room' },
  },
];
for (const example of examples) {
  const result = validateClientMessage(example, { requireImplemented: false });
  check(`PRD §12 example \`${example.type}\` validates`, result.ok === true,
    result.ok ? '' : `${result.error}: ${result.detail}`);
}

// Every §12 example also names ids that must exist in the shipped catalogue.
if (catalogue) {
  const setup = examples[3];
  check('PRD §12 setup_submit example references only real catalogue ids',
    [...setup.menu, ...setup.addons].every((s) => s.dishId in catalogue.dishesById) &&
    setup.startingUpgradeId in catalogue.upgradesById);
  check('PRD §12 purchase_upgrade example references a real upgrade id',
    'faster_grill_1' in catalogue.upgradesById);
}

const rejections = [
  ['a message with no type', {}, 'missing_type'],
  ['an undeclared type', { type: 'teleport' }, 'unknown_type'],
  ['a malformed player_input', { type: 'player_input', sequence: 1, move: { x: 0 }, facing: 0 }, 'invalid_payload'],
  ['a negative sequence', { type: 'player_input', sequence: -1, move: { x: 0, z: 0, sprint: false }, facing: 0 }, 'invalid_payload'],
  ['a client-supplied position', { type: 'player_input', sequence: 1, move: { x: 0, z: 0, sprint: false }, facing: 0, position: { x: 5, y: 0, z: 5 } }, 'invalid_payload'],
  ['an unknown interact action', { type: 'interact', sequence: 1, targetId: 't', action: 'teleport' }, 'invalid_payload'],
  ['too many addons', { type: 'setup_submit', menu: [{ dishId: 'a', price: 1 }], addons: [{ dishId: 'b', price: 1 }, { dishId: 'c', price: 1 }, { dishId: 'd', price: 1 }], staffAssignments: {} }, 'invalid_payload'],
  ['a duplicated dish across menu slots', { type: 'setup_submit', menu: [{ dishId: 'a', price: 1 }], addons: [{ dishId: 'a', price: 1 }], staffAssignments: {} }, 'invalid_payload'],
];
for (const [label, message, expected] of rejections) {
  const result = validateClientMessage(message, { requireImplemented: false });
  check(`validation rejects ${label} as ${expected}`, result.ok === false && result.error === expected,
    result.ok ? 'ACCEPTED' : `${result.error}: ${result.detail ?? ''}`);
}

// --- 5. design Decision 7 ---------------------------------------------------------------
check('every implemented client message type is also declared',
  IMPLEMENTED_CLIENT_MESSAGE_TYPES.every((t) => CLIENT_MESSAGE_TYPES.includes(t)));
check('a declared-but-unimplemented type is rejected as not_implemented, never ignored',
  CLIENT_MESSAGE_TYPES.filter((t) => !IMPLEMENTED_CLIENT_MESSAGE_TYPES.includes(t))
    .every((t) => validateClientMessage({ type: t }).error === 'not_implemented'),
  CLIENT_MESSAGE_TYPES.filter((t) => !IMPLEMENTED_CLIENT_MESSAGE_TYPES.includes(t)).join(', '));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
