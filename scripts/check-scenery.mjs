#!/usr/bin/env node
// Real export contract + the input consumer used by GameClient. No Blender needed in CI.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const layout = JSON.parse(readFileSync(new URL('../shared/game-data/restaurant-layout.json', import.meta.url)));
const glb = readFileSync(process.argv[2] ?? new URL('../assets/copper-and-thyme/restaurant.glb', import.meta.url));
assert.equal(glb.readUInt32LE(0), 0x46546c67, 'valid GLB magic');
assert.equal(glb.readUInt32LE(4), 2, 'glTF 2');
assert.equal(glb.readUInt32LE(8), glb.length, 'complete file');
const model = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
for (const entity of layout.entities.filter((e) => e.type !== 'queue' && !e.generated)) {
  const node = model.nodes.find((n) => n.name === entity.id);
  assert.ok(node, `export contains ${entity.id}`);
  const position = node.translation ?? [0, 0, 0];
  position.forEach((v, i) => assert.ok(Math.abs(v - entity.position[i]) < 0.001,
    `${entity.id} anchor axis ${i}: ${v} != ${entity.position[i]}`));
  assert.ok(node.children?.length, `${entity.id} contains authored geometry`);
}
assert.ok(!model.nodes.some((n) => /^(Chef|Server|Guest)(_|$)/.test(n.name)), 'no baked demo actors');
assert.ok(glb.length < 30_000_000, 'bounded asset transfer');
const triangles = model.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((n, primitive) =>
  n + model.accessors[primitive.indices].count / 3, 0), 0);
assert.ok(triangles < 600_000, 'bounded triangle count');
console.log(`Scene export: ${layout.entities.filter((e) => e.type !== 'queue' && !e.generated).length} aligned entities, ${Math.round(triangles)} triangles, ${(glb.length / 1e6).toFixed(1)} MB`);

const require = createRequire(new URL('../client/package.json', import.meta.url));
const ts = require('typescript');
const compiled = ts.transpileModule(readFileSync(new URL('../client/src/game/InputController.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { InputController } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const target = new EventTarget();
const input = new InputController(target);
function key(type, code) { const event = new Event(type); event.code = code; event.repeat = false; target.dispatchEvent(event); }
key('keydown', 'KeyW');
assert.equal(input.getMoveIntent().z, -1, 'legacy camera moves forward');
assert.ok(input.getMoveIntent(Math.PI).z > .999, 'cutaway camera W goes toward kitchen');
key('keydown', 'KeyD');
for (const angle of [0, Math.PI - .28, -Math.PI / 2]) {
  const move = input.getMoveIntent(angle);
  assert.ok(Math.abs(move.x) <= 1 && Math.abs(move.z) <= 1, 'wire bounds');
  assert.ok(Math.abs(Math.hypot(move.x, move.z) - 1) < 1e-9, 'diagonal movement normalized');
  const screenRight = move.x * Math.cos(angle) - move.z * Math.sin(angle);
  const screenBack = move.x * Math.sin(angle) + move.z * Math.cos(angle);
  assert.ok(screenRight > 0 && screenBack < 0, 'W+D projects up and right');
}
key('keydown', 'ShiftLeft');
assert.equal(input.getMoveIntent().sprint, true);
target.dispatchEvent(new Event('blur'));
assert.deepEqual(input.getMoveIntent(), { x: 0, z: 0, sprint: false }, 'blur releases movement');
input.dispose();
console.log('Camera-relative movement: direction, diagonal wire bounds, sprint and blur passed');
