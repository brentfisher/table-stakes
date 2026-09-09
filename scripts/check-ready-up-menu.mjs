#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { catalogue } from '../server/src/game/catalogue.js';
import { validateSetupSubmission } from '../server/src/game/validators/setup-validator.js';
import { buildReadyUpPayload, READY_UP_STAGES } from '../shared/game-logic/ready-up-menu.js';
import { inventoryCost, selectableAddons, selectableMains } from '../shared/schemas/setup-rules.js';
import { STARTING_CASH } from '../shared/constants/tuning.js';
import arcadeFood from '../shared/game-data/arcade-food.json' with { type: 'json' };

let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`  ok   ${name}`); };
console.log('Three-stage ready-up menu\n');

const mains = selectableMains(catalogue.dishes, catalogue.layout).slice(0, 3);
const extras = selectableAddons(catalogue.dishes, catalogue.layout);
const prices = Object.fromEntries([...mains, ...extras].map((dish) => [dish.id, dish.suggestedPrice]));
const payload = buildReadyUpPayload({
  mainIds: mains.map((dish) => dish.id),
  extraIds: extras.map((dish) => dish.id),
  prices,
  dishes: catalogue.dishes,
  ingredients: catalogue.ingredients,
  layout: catalogue.layout,
});

check('the flow exposes exactly mains, extras, and prices in order', () => {
  assert.deepEqual(READY_UP_STAGES, ['mains', 'extras', 'prices']);
});

check('every selectable dish has a reusable authored 3D model', () => {
  const modelIds = new Set(arcadeFood.assets.filter((asset) => asset.category === 'dish').map((asset) => asset.id));
  for (const dish of [...selectableMains(catalogue.dishes, catalogue.layout), ...extras]) {
    assert.ok(modelIds.has(dish.id), dish.id);
  }
});

check('every automatically stocked ingredient has a reusable authored 3D model', () => {
  const modelIds = new Set(arcadeFood.assets.filter((asset) => asset.category === 'ingredient').map((asset) => asset.id));
  for (const ingredientId of Object.keys(payload.startingInventory)) assert.ok(modelIds.has(ingredientId), ingredientId);
});

check('the simplified choices build a legal authoritative setup submission', () => {
  const accepted = validateSetupSubmission(payload, {
    catalogue,
    layout: catalogue.layout,
    startingCash: STARTING_CASH,
  });
  assert.equal(accepted.ok, true, accepted.detail);
});

check('the builder assigns the default legal post to every worker', () => {
  for (const worker of catalogue.layout.staff.roster) {
    assert.equal(payload.staffAssignments[worker.id], worker.posts[0]);
  }
});

check('the generated pantry is non-empty, menu-scoped, whole-unit, and affordable', () => {
  const chosenIngredientIds = new Set([...mains, ...extras].flatMap((dish) => Object.keys(dish.ingredients)));
  assert.ok(Object.keys(payload.startingInventory).length > 0);
  for (const [id, units] of Object.entries(payload.startingInventory)) {
    assert.ok(chosenIngredientIds.has(id), id);
    assert.ok(Number.isInteger(units) && units > 0, `${id}:${units}`);
  }
  assert.ok(inventoryCost(payload.startingInventory, catalogue.ingredients) <= STARTING_CASH);
});

check('the hidden setup choices stay neutral', () => {
  assert.equal(payload.startingUpgradeId, null);
  assert.equal(payload.policyId, null);
  assert.equal(payload.policyDishId, null);
});

check('the React screen, model preview, shared builder, and HTML harness are wired', () => {
  const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const setup = read('client/src/ui/SetupScreen.tsx');
  assert.match(setup, /READY_UP_STAGES/);
  assert.match(setup, /FoodModelPreview/);
  assert.match(setup, /buildReadyUpPayload/);
  assert.doesNotMatch(setup, /Opening upgrade|Restaurant policy|Staff assignments/);
  assert.match(read('harnesses/src/harnesses.ts'), /readyUpMenuHarness/);
});

console.log(`\n${passed}/${passed} checks passed.`);
