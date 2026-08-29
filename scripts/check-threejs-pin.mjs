#!/usr/bin/env node
// Verifies the PRD §13 Three.js rule, which PRD §22 makes a pass/fail acceptance criterion:
//
//   1. The pinned version lives in exactly one place (shared/constants/tuning.js).
//   2. Every import map uses THAT version, for both `three` and `three/addons/`, same CDN.
//   3. No package.json anywhere declares `three` as a dependency.
//   4. The built client contains no Three.js bundle.
//
// Run: node scripts/check-threejs-pin.mjs

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { THREE_VERSION } from '../shared/constants/tuning.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const checks = [];

function ok(message) { checks.push(`  ok   ${message}`); }
function fail(message) { failures.push(message); checks.push(`  FAIL ${message}`); }

// 1 + 2: import maps agree with tuning.js
for (const htmlPath of ['client/index.html', 'harnesses/index.html']) {
  const full = join(root, htmlPath);
  if (!existsSync(full)) { fail(`${htmlPath} is missing`); continue; }
  const html = readFileSync(full, 'utf8');

  const expectedThree = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`;
  const expectedAddons = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/`;

  if (!html.includes('<script type="importmap">')) fail(`${htmlPath} has no import map`);
  else if (!html.includes(expectedThree)) fail(`${htmlPath} does not pin three to ${THREE_VERSION}`);
  else if (!html.includes(expectedAddons)) fail(`${htmlPath} does not pin three/addons/ to ${THREE_VERSION}`);
  else ok(`${htmlPath} pins three and three/addons/ to ${THREE_VERSION}`);

  // An unversioned or mismatched URL anywhere in the file is a compatibility hazard.
  for (const match of html.matchAll(/three@([^/"']+)/g)) {
    if (match[1] !== THREE_VERSION) fail(`${htmlPath} references three@${match[1]}, expected ${THREE_VERSION}`);
  }
  if (/three@latest|cdn\.jsdelivr\.net\/npm\/three\//.test(html.replace(/three@[^/"']+/g, ''))) {
    fail(`${htmlPath} contains an unversioned three URL`);
  }
}

// 3: three must not be an npm dependency
for (const pkgPath of ['package.json', 'server/package.json', 'client/package.json', 'harnesses/package.json']) {
  const full = join(root, pkgPath);
  if (!existsSync(full)) continue;
  const pkg = JSON.parse(readFileSync(full, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  // The RUNTIME package must never be a dependency — that is the PRD §22 criterion.
  const offenders = Object.keys(deps).filter((d) => d === 'three' || d.startsWith('three/'));
  if (offenders.length > 0) fail(`${pkgPath} declares ${offenders.join(', ')} — Three.js must not be an npm dependency`);
  else ok(`${pkgPath} declares no three runtime dependency`);

  // @types/three is allowed (types are erased at compile time and never reach the bundle)
  // but it MUST be pinned to exactly THREE_VERSION, or the types describe a different
  // library than the one the browser actually loads.
  const types = deps['@types/three'];
  if (types !== undefined) {
    if (!pkg.devDependencies?.['@types/three']) {
      fail(`${pkgPath} lists @types/three outside devDependencies`);
    } else if (types !== THREE_VERSION) {
      fail(`${pkgPath} pins @types/three@${types}, expected exactly ${THREE_VERSION}`);
    } else {
      ok(`${pkgPath} pins @types/three to exactly ${THREE_VERSION} (devDependency, types only)`);
    }
  }
}

// 4: the build output must not contain Three.js
const buildDir = join(root, 'server/public/client-build');
if (existsSync(buildDir)) {
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|mjs)$/.test(entry)) files.push(p);
    }
  })(buildDir);

  if (files.length === 0) {
    ok('build output present but contains no JS yet (run `npm run build:client`)');
  } else {
    const bundled = files.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return src.includes('WebGLRenderer') && src.includes('BufferGeometry') && src.includes('ShaderChunk');
    });
    if (bundled.length > 0) {
      fail(`Three.js appears bundled into: ${bundled.map((f) => relative(root, f)).join(', ')}`);
    } else {
      ok(`${files.length} built JS file(s) contain no Three.js bundle`);
    }
  }
} else {
  ok('no client build present yet (run `npm run build:client` to check the bundle rule)');
}

console.log(`Three.js pin check — expected version ${THREE_VERSION}\n${checks.join('\n')}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s).`);
  process.exit(1);
}
console.log('\nAll Three.js pin checks passed.');
