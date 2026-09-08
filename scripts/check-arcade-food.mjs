#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'shared/game-data/arcade-food.json'), 'utf8'));
const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'shared/game-data/dishes.json'), 'utf8'));
const loaderSource = fs.readFileSync(path.join(root, 'client/src/scenes/FoodModels.ts'), 'utf8');
const restaurantSource = fs.readFileSync(path.join(root, 'client/src/scenes/RestaurantScene.ts'), 'utf8');
const harnessRegistry = fs.readFileSync(path.join(root, 'harnesses/src/harnesses.ts'), 'utf8');

let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`  ok   ${name}`); };
console.log('Arcade food model library\n');

check('the manifest contains eight dishes and eighteen ingredients', () => {
  assert.equal(manifest.assets.filter((asset) => asset.category === 'dish').length, 8);
  assert.equal(manifest.assets.filter((asset) => asset.category === 'ingredient').length, 18);
});

check('every canonical dish and ingredient has one model', () => {
  const modelIds = new Set(manifest.assets.map((asset) => asset.id));
  assert.deepEqual([...modelIds].sort(), [...catalogue.dishes.map((dish) => dish.id), ...Object.keys(catalogue.ingredients)].sort());
});

check('all model ids and filenames are unique with finite positive dimensions', () => {
  assert.equal(new Set(manifest.assets.map((asset) => asset.id)).size, manifest.assets.length);
  assert.equal(new Set(manifest.assets.map((asset) => asset.file)).size, manifest.assets.length);
  for (const asset of manifest.assets) {
    for (const axis of ['x', 'y', 'z']) assert.ok(Number.isFinite(asset.dimensions[axis]) && asset.dimensions[axis] > 0);
  }
});

check('all 26 files are valid self-contained GLB 2 containers', () => {
  for (const asset of manifest.assets) {
    const bytes = fs.readFileSync(path.join(root, 'assets/arcade-food/models', asset.file));
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'glTF', asset.file);
    assert.equal(bytes.readUInt32LE(4), 2, asset.file);
    assert.equal(bytes.readUInt32LE(8), bytes.length, asset.file);
    const jsonLength = bytes.readUInt32LE(12);
    assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, asset.file);
    const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trim());
    assert.equal(gltf.asset.version, '2.0', asset.file);
    assert.equal(gltf.scenes.length, 1, asset.file);
    assert.ok(gltf.meshes.length >= 1, asset.file);
    assert.ok(gltf.buffers.every((buffer) => !buffer.uri), `${asset.file} has an external buffer`);
    assert.ok((gltf.images ?? []).every((image) => !image.uri), `${asset.file} has an external image`);
  }
});

check('the production URL map explicitly covers every manifest file', () => {
  for (const asset of manifest.assets) {
    assert.match(loaderSource, new RegExp(`\\b${asset.id}: new URL\\([^\\n]+${asset.file.replace('.', '\\.')}\\b`));
  }
});

check('finished dishes and pantry ingredients use the production loader throughout service', () => {
  assert.match(restaurantSource, /buildArcadeFoodProxy\(dishId/);
  assert.match(restaurantSource, /buildArcadeFoodProxy\(ingredient\.ingredientId/);
  assert.match(restaurantSource, /setPantryIngredients/);
  assert.match(restaurantSource, /updateTableDishes/);
});

check('the HTML and Three.js food-library harness is registered', () => {
  assert.match(harnessRegistry, /arcadeFoodHarness/);
  assert.ok(fs.existsSync(path.join(root, 'harnesses/src/arcade-food-harness.ts')));
});

console.log(`\n${passed}/${passed} checks passed.`);
