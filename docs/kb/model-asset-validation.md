---
type: Reference
title: Model asset validation
description: The vertex/material data hazards that make a single model NaN out the whole restaurant view through the bloom pass, the automated check that catches them, and what to do when adding a .blend or .glb.
generated: { by: claude-opus-5, at: 2026-09-20T02:00:00Z }
sources:
  - id: incident
    resource: assets/chef-blaze/ChefBlaze.glb
    title: "Chef Blaze hair anisotropy — whole-scene black flashing"
---

# Model asset validation

## The rule

**Every new or rebuilt `.glb` under `assets/` must pass `npm run check:models`.** It runs as
part of `npm run check`, globs `assets/` recursively, and needs no per-model registration —
drop a model in and it is covered.

If you author a model from a `.blend`, the build script that exports it is the right place
to fix a failure, not the exported binary. `assets/chef-blaze/build_chef_blaze.py` step 8
is the worked example.

## Why a model defect is a whole-screen bug here

This is the part that makes model validation worth automating in this repo specifically.

The restaurant does not render straight to the canvas. `SceneManager` renders it through an
`EffectComposer`: `RenderPass` → `UnrealBloomPass` → `OutputPass`. `UnrealBloomPass`
high-passes the frame, blurs it across **five mip levels**, and blends the result back
**additively** over the scene.

So a single NaN or Inf fragment is not a local artifact. The high-pass picks it up, each
blur pass smears it across a wider neighbourhood, each mip widens it further, and the
additive blend turns **every texel it reached** black. One bad texel on one model blacks out
the entire restaurant view for that frame.

Because the bad fragment only appears when the offending triangle is visible at the wrong
angle, this presents as intermittent flashing rather than a steady artifact — which is what
makes it so expensive to track down by eye.

## What the check looks for

`scripts/check-model-assets.mjs`, one failure per finding:

1. **`KHR_materials_anisotropy` on a primitive with no `TANGENT` attribute.** three.js only
   uses a vertex tangent frame when the mesh ships `TANGENT`. Otherwise it derives one in
   the fragment shader with `getTangentFrame()`, which guards a *degenerate* frame — edge-on
   or sub-pixel triangles, where the screen-space UV derivatives collapse — by setting its
   scale to `0`, handing back a zero-length T and B. The anisotropy path then runs
   `normalize( tbn[0] * aniso.x + tbn[1] * aniso.y )` on those, and `normalize(vec3(0))` is
   NaN. Fix by shipping tangents **or** dropping the extension.
2. **Non-finite floats** in any float vertex attribute. They reach the shader verbatim.
3. **Zero-length `NORMAL` or `TANGENT` vectors.** The shader normalizes them; `normalize(0)`
   is NaN. Mesh decimation is the usual source.
4. **Skin weights summing to zero**, which collapse the vertex onto the model origin.
5. **Non-finite inverse bind matrices**, which poison every skinned vertex.
6. **Zero node scale components** (singular matrix, so its inverse is non-finite) and
   non-finite node matrices.

## Adding a new model

1. Put the `.glb` under `assets/`, and its build script and `.blend` beside it if it is
   generated (see `assets/chef-blaze/` for the established shape — `.blend` source,
   `build_*.py`, exported `.glb`, `README_ThreeJS.md`).
2. Run `npm run check:models`.
3. On a failure, fix it **in the build script** and re-export, so a future rebuild cannot
   reintroduce it. Blender's glTF exporter emits material extensions straight from the
   Principled BSDF, so a value set in the sculpt travels into the GLB unless the build
   explicitly clears it.

Exporting real vertex tangents is the more faithful fix when a material genuinely needs
anisotropy or a normal map, and it also improves normal-mapped shading. It costs file size
and does not by itself guarantee non-degenerate tangents, so prefer it when the look depends
on the effect and drop the effect when it does not.

## The incident this came from

Chef Blaze's `Hair | sculpted espresso filament` material carried a Principled
`Anisotropic` value of `0.35` in `chef-blaze.blend`, which Blender exported as
`KHR_materials_anisotropy`. The sculpt ships no tangents, so it hit case 1 above.

Symptom: the whole restaurant view flashed black several times a second, in every match
phase, in both the normal and Peek cameras, for as long as the owner avatar was on screen.

Measured with a per-frame `readPixels` probe against the live game: **42.2% of frames
affected** with anisotropy on (489 of 1,159), **0 of 2,221** consecutive frames with it off,
and no visible change to the hair.

It was misdiagnosed several times first — as a shadow-camera frustum bug (STORY-062, which
fixed a real but unrelated defect), as a stale canvas size, and as a compositor presenting a
half-drawn frame. Two things finally localised it: the flash frequency scaling monotonically
with *bloom resolution only* (and not with shadow-map size, which ruled out generic GPU
cost), and hiding the one `SkinnedMesh` in the scene making it stop.

Two traps worth knowing if you ever debug rendering here again:

- **A backgrounded or automated Chrome tab freezes timers entirely** and never delivers
  `ResizeObserver` callbacks, so the render loop does not advance. Any in-browser probe must
  run in a foreground window or its results are meaningless.
- **Always record `innerWidth`/`innerHeight` alongside canvas and container sizes.** Two
  full probe rounds were wasted on data collected at a `150px`-tall viewport, because
  docked DevTools had taken the rest of the window.
