#!/usr/bin/env node
// Validates every shipped model asset (`assets/**/*.glb`) against the vertex/material data
// hazards that produce a NaN or Inf fragment at runtime.
//
// WHY THIS EXISTS. A single NaN fragment is not a local artifact in this game, because the
// restaurant renders through `SceneManager`'s EffectComposer: `UnrealBloomPass` high-passes
// the frame, blurs it across five mip levels — smearing the NaN over an ever-larger area —
// then blends the result back additively, turning every texel it reached black. So one bad
// texel on one model flashes the WHOLE restaurant view black. That shipped once already
// (Chef Blaze's hair material, see check 1 below): the symptom was the entire scene
// strobing several times a second in every match phase, and it survived a shadow-camera
// investigation, a resize investigation and a compositing investigation before anyone
// suspected the model. These checks are the cheap version of that hunt.
//
// Run: node scripts/check-model-assets.mjs
//
// Add a new .glb (or rebuild one from a .blend) and this runs over it automatically — it
// globs `assets/`, there is no per-model registration list to update. See
// `docs/kb/model-asset-validation.md`.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const checks = [];
const ok = (m) => checks.push(`  ok   ${m}`);
const fail = (m) => { failures.push(m); checks.push(`  FAIL ${m}`); };

const COMPONENT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const COMPONENTS_PER = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function listModels(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...listModels(p));
    else if (entry.toLowerCase().endsWith('.glb')) out.push(p);
  }
  return out;
}

/** Parse a .glb container into its JSON chunk and its binary chunk. */
function parseGlb(buf) {
  if (buf.length < 12 || buf.readUInt32LE(0) !== 0x46546c67) return null;
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const chunk = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    if (type === 0x004e4942) bin = chunk;
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  return json ? { json, bin } : null;
}

/** Read one accessor's values, honouring the bufferView's byteStride (interleaved data). */
function readAccessor(json, bin, index) {
  const accessor = json.accessors[index];
  const per = COMPONENTS_PER[accessor.type];
  const Ctor = COMPONENT[accessor.componentType];
  const out = new Ctor(accessor.count * per);
  if (accessor.bufferView === undefined || !bin) return { accessor, values: out, per };
  const view = json.bufferViews[accessor.bufferView];
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const stride = view.byteStride || per * Ctor.BYTES_PER_ELEMENT;
  for (let element = 0; element < accessor.count; element++) {
    for (let component = 0; component < per; component++) {
      const at = base + element * stride + component * Ctor.BYTES_PER_ELEMENT;
      out[element * per + component] =
        Ctor === Float32Array ? bin.readFloatLE(at)
          : Ctor === Uint32Array ? bin.readUInt32LE(at)
            : Ctor === Uint16Array ? bin.readUInt16LE(at)
              : Ctor === Int16Array ? bin.readInt16LE(at)
                : Ctor === Int8Array ? bin.readInt8(at)
                  : bin.readUInt8(at);
    }
  }
  return { accessor, values: out, per };
}

const models = listModels(join(root, 'assets'));
if (models.length === 0) fail('no .glb files found under assets/ — has the layout changed?');

for (const path of models) {
  const label = relative(root, path);
  const parsed = parseGlb(readFileSync(path));
  if (!parsed) { fail(`${label} is not a parseable .glb`); continue; }
  const { json, bin } = parsed;
  const problems = [];

  // 1. KHR_materials_anisotropy on a primitive with no TANGENT attribute.
  //    three.js only uses a vertex tangent frame when the mesh ships TANGENT; otherwise it
  //    derives one in the fragment shader with `getTangentFrame()`, which guards a
  //    DEGENERATE frame (edge-on or sub-pixel triangles, where the screen-space UV
  //    derivatives collapse) by zeroing its scale — handing back a zero-length T and B. The
  //    anisotropy path then runs `normalize( tbn[0] * aniso.x + tbn[1] * aniso.y )` on
  //    those, and `normalize(vec3(0))` is NaN. Either ship TANGENTs or drop the extension;
  //    `assets/chef-blaze/build_chef_blaze.py` step 8 shows the latter.
  const anisotropic = new Set();
  (json.materials || []).forEach((material, i) => {
    if (material.extensions?.KHR_materials_anisotropy) anisotropic.add(i);
  });

  for (const mesh of json.meshes || []) {
    for (const [i, primitive] of mesh.primitives.entries()) {
      const where = `mesh "${mesh.name || '?'}" primitive ${i}`;
      const attributes = primitive.attributes || {};

      if (primitive.material !== undefined && anisotropic.has(primitive.material) && attributes.TANGENT === undefined) {
        const name = json.materials[primitive.material].name || `#${primitive.material}`;
        problems.push(`${where}: material "${name}" uses KHR_materials_anisotropy but the mesh has no TANGENT attribute (NaN in three.js)`);
      }

      // 2. Non-finite floats anywhere in the vertex data reach the shader verbatim.
      // 3. Zero-length NORMALs — the shader normalizes them, and normalize(0) is NaN.
      // 4. Zero-sum skin weights collapse the vertex onto the model origin.
      for (const [name, index] of Object.entries(attributes)) {
        const { accessor, values, per } = readAccessor(json, bin, index);
        if (accessor.componentType !== 5126 && !name.startsWith('WEIGHTS')) continue;
        let nonFinite = 0;
        let zeroLength = 0;
        let zeroWeight = 0;
        for (let e = 0; e < accessor.count; e++) {
          let squared = 0;
          let sum = 0;
          for (let c = 0; c < per; c++) {
            const v = values[e * per + c];
            if (!Number.isFinite(v)) nonFinite++;
            squared += v * v;
            sum += v;
          }
          if ((name === 'NORMAL' || name === 'TANGENT') && squared < 1e-12) zeroLength++;
          if (name.startsWith('WEIGHTS') && Math.abs(sum) < 1e-9) zeroWeight++;
        }
        if (nonFinite) problems.push(`${where}: ${name} has ${nonFinite} non-finite value(s)`);
        if (zeroLength) problems.push(`${where}: ${name} has ${zeroLength} zero-length vector(s) (normalize() -> NaN)`);
        if (zeroWeight) problems.push(`${where}: ${name} has ${zeroWeight} vertex/vertices whose weights sum to 0`);
      }
    }
  }

  // 5. Inverse bind matrices feed every skinned vertex — one bad value poisons the mesh.
  for (const [i, skin] of (json.skins || []).entries()) {
    if (skin.inverseBindMatrices === undefined) continue;
    const { values } = readAccessor(json, bin, skin.inverseBindMatrices);
    let bad = 0;
    for (const v of values) if (!Number.isFinite(v)) bad++;
    if (bad) problems.push(`skin ${i} "${skin.name || '?'}": ${bad} non-finite inverse-bind-matrix value(s)`);
  }

  // 6. A zero scale component makes the node matrix singular, so its inverse is non-finite.
  for (const node of json.nodes || []) {
    if (node.scale && node.scale.some((v) => v === 0)) problems.push(`node "${node.name || '?'}" has a zero scale component (singular matrix)`);
    if (node.matrix && node.matrix.some((v) => !Number.isFinite(v))) problems.push(`node "${node.name || '?'}" has a non-finite matrix`);
  }

  if (problems.length > 0) for (const problem of problems) fail(`${label}: ${problem}`);
  else ok(`${label}`);
}

console.log(`Model asset validation — ${models.length} .glb file(s) under assets/\n${checks.join('\n')}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s). A NaN fragment from any of these blacks out the whole scene through the bloom pass — see docs/kb/model-asset-validation.md.`);
  process.exit(1);
}
console.log('\nAll model asset checks passed.');
