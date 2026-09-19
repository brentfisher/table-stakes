# Chef Blaze — game-ready package (STORY-060)

Retopologized, real-time-budget export of the Chef Blaze hero sculpt (`chef-blaze.blend` /
`RIG-README.md`, ~1,091,556 triangles), built for the player's own owner avatar in
`client/src/scenes/RestaurantScene.ts`.

## Files

- `chef-blaze.blend` — the original hero sculpt (source material, checked in unmodified).
- `RIG-README.md` — the sculpt's own authoring notes (rig controls, pose ranges, validation).
- `build_chef_blaze.py` — deterministic Blender build script; reads `chef-blaze.blend`, writes
  `ChefBlaze.glb` beside itself. Never overwrites `chef-blaze.blend`.
- `ChefBlaze.glb` — the runtime asset.
- `manifest.json` — machine-readable runtime contract (this file's numbers, structured).

## Not reused

Two earlier, unmerged branches (`feat/chef-blaze-character` @ `2aeb5bb`,
`feat/chef-blaze-turnaround-rebuild` @ `00fbc60`) already built game-ready Chef Blaze exports —
but of an EARLIER, DIFFERENT sculpt (their own procedurally-authored low-poly character, not a
retopo of this file). Their meshes are not part of this package. Their documentation *pattern*
(a deterministic Blender-MCP build script, named in-place clips, a runtime-contract
README+manifest) is what this package follows.

## Runtime contract

- Units are meters; the exported character is 1.86 m tall (matches the CapsuleGeometry(0.34,
  0.75) + SphereGeometry(0.26) primitive `upsertOwner()` used before this story — see
  `build_chef_blaze.py`'s `TARGET_HEIGHT_M` comment for why matching that footprint specifically,
  rather than picking a number independently, was the right call).
- Blender is Z-up; the glTF export uses Y-up. Root is at `(0, 0, 0)`.
- **Forward is +Z** in the exported model's own (unrotated) local space — empirically verified
  by exporting a marker object placed at Blender `(0, -2, 0)` (2 units in front of the face, the
  sculpt's own -Y-forward convention) through the exact same exporter settings this package uses,
  and confirming it lands at glTF `(0, 0, 2)`. This is NOT the "usual" Three.js/glTF -Z-forward
  camera convention — but it IS exactly what `RestaurantScene.ts`'s existing owner avatar already
  used (the old primitive's nose cone sits at `+Z`), so the model needs **no corrective rotation**
  to read correctly once `group.rotation.y = state.facing` turns the whole avatar.
- The root node (`ChefBlaze_Rig`) carries a baked `(0.25479, 0.25479, 0.25479)` scale — this is
  where the Blender-units-to-meters conversion lives (source sculpt is 7.3 Blender units tall
  per `RIG-README.md`; `1.86 / 7.3 ≈ 0.25479`). Nothing else (no vertex data, no animation
  curves) is scaled — see `build_chef_blaze.py`'s module docstring, point 7, for why baking the
  conversion into a plain node scale rather than touching vertex/keyframe data was the safer
  choice.
- Two named clips, both 30 fps, both in-place (no root motion — moving the entity is the calling
  code's job, same as every other entity in this scene):
  - `ChefBlaze_Idle`: frames 1–120 (4 s loop). The sculpt's own authored breathing action,
    renamed only — untouched otherwise.
  - `ChefBlaze_Walk_InPlace`: frames 1–30 (1 s loop). Authored from scratch by
    `build_chef_blaze.py` (the source file had no walk animation) — alternating thigh/knee/foot
    swing with a contralateral (opposite-side) arm/elbow swing and a subtle pelvis bob/counter-
    rotated chest, all driven by rotating each bone around the WORLD X axis converted into that
    bone's own rest-local frame (see `build_chef_blaze.py`'s `world_axis_to_local` and the module
    docstring for why a plain local-X rotation doesn't work uniformly across this rig — the arms
    in particular have enough rest-pose roll that it would swing off-axis). The knee and elbow
    (one-way hinges) are driven by a phase-led sine CLAMPED to its non-negative half
    (`flex_phase` in `build_chef_blaze.py`) rather than the raw signed sine the hip/shoulder use —
    a signed drive would bend them backward (hyperextend) for half of every cycle.
- 34,706 triangles total (from ~1,091,556) across ONE mesh object / one skin, 52 deform joints
  (IK control/pole bones — 9 of them, no vertex weights — are excluded from the export via
  `export_def_bones`), 7 material primitives (body, 5 eye-detail materials, hair). See
  `manifest.json` for the exact per-part breakdown.
- Skinning: the body mesh (one continuous 621,506-vertex retopo, NOT a set of disjoint
  primitives) uses bounded smooth skinning — at most 4 bone influences per vertex, normalized.
  The eye-detail and facial-hair meshes are genuinely single-bone (100% weighted to `head`,
  verified against the source before this build ever touched them). **This is a deliberate,
  documented deviation from the acceptance criteria's literal "single-bone-weighted-per-component"
  phrasing** — see `build_chef_blaze.py`'s module docstring, point 3, for why: that phrasing
  describes the PRIOR branches' disjoint-primitive pipeline (a cylinder per limb, safe to weight
  rigidly because each piece is its own island), and forcing it onto this continuous retopologized
  skin would tear the mesh open at every elbow/knee/shoulder the instant a limb bends. Verified by
  posing the walk cycle's mid-swing frame and re-rendering (see the story's PR description).
- Textures: the sculpt's packed diffuse/metallic-roughness/normal maps, downsized from 2048x2048
  to 1024x1024 (UVs are untouched by decimation, so no re-bake/re-atlas was needed — just a
  resolution cut proportional to the geometry cut).

## Three.js integration

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const gltf = await new GLTFLoader().loadAsync('/assets/chef-blaze/ChefBlaze.glb');
// Plain Object3D.clone() does NOT correctly clone a skinned mesh's skeleton binding — use
// SkeletonUtils.clone for any second (or later) instance.
const model = cloneSkeleton(gltf.scene);

const mixer = new THREE.AnimationMixer(model);
const idle = mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, 'ChefBlaze_Idle'));
const walk = mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, 'ChefBlaze_Walk_InPlace'));
idle.play();
// walk.reset().play(); walk.crossFadeFrom(idle, 0.25, false); // on transition to moving
// `warp: false` — Idle (120f) and Walk_InPlace (30f) are a 4:1 length ratio; `warp: true`
// retimes both actions' timeScale to sync over the fade, which at this ratio visibly ramps
// the breathing loop to ~4x speed mid-transition (see ChefBlazeModel.ts's own comment).

// in your render loop:
mixer.update(dt);
```

See `client/src/scenes/ChefBlazeModel.ts` for the actual in-game wiring (cached GLB parse,
per-instance clone including geometry/material — not just the skeleton, so a disposed instance
never corrupts the shared cached source — and the idle/walk crossfade), and
`RestaurantScene.ts`'s `upsertOwner`/`updateOwnerAnimations` for how it's driven from the
self-owner's actual per-frame movement.

## Rebuilding

With Blender 5.2+ installed:

```
/Applications/Blender.app/Contents/MacOS/Blender --background \
  assets/chef-blaze/chef-blaze.blend --python assets/chef-blaze/build_chef_blaze.py
```

Writes `assets/chef-blaze/ChefBlaze.glb`. Does not modify `chef-blaze.blend`. Decimation ratios,
the target height, and the walk-cycle amplitudes are all named constants at the top of
`build_chef_blaze.py`, each with a comment explaining why that specific number — re-run after
changing any of them to see the effect (the script logs the resulting triangle counts).
