# Cast pack — game-ready package (STORY-063)

Real-time exports of the three cast characters delivered alongside Chef Blaze: **Monsieur** (a
French maître d'), **Vivienne** (a luxury concierge) and **Aurelia** (an affluent patron). Built by
`build_cast.py` from `cast-pack.blend`.

Read `assets/chef-blaze/README_ThreeJS.md` first — this package deliberately follows its shape, and
only the genuine differences are documented here.

## Files

- `build_cast.py` — deterministic Blender build script. Never writes to its source.
- `Monsieur.glb`, `Vivienne.glb`, `Aurelia.glb` — the runtime assets.
- `<Name>.manifest.json` — machine-readable runtime contract, **emitted by the build** so its
  numbers cannot drift from the binary they describe.

## The source blend is NOT in this repo

`cast-pack.blend` is 129 MiB. This repo has no Git LFS, so committing it would put a 129 MiB blob
in every clone's history, permanently. STORY-060 committed the 49 MiB `chef-blaze.blend`; **this is
a deliberate, documented departure from that precedent.**

Expected location (override with `--source`):

```
~/asset-sources/table-stakes/chef-blaze-cast-assets/blender/cast-pack.blend
SHA256  43bd1b4b406eef32ef837bc770aedd09d00537633bb596de1e75c0f79cd5f6a2
```

The build verifies that hash before doing anything and refuses to run on a mismatch, so a rebuild
stays auditable with the source out of tree. Every manifest records it too.

Note the delivery zip's `blender/chef-blaze.blend` is **byte-identical** (SHA256 `cc55a94e…`) to the
already-committed `assets/chef-blaze/chef-blaze.blend`. There is nothing new in it.

## Build

```
/Applications/Blender.app/Contents/MacOS/Blender --background \
    ~/asset-sources/table-stakes/chef-blaze-cast-assets/blender/cast-pack.blend \
    --python assets/cast/build_cast.py -- --character Monsieur
```

One character per invocation (`Monsieur` | `Vivienne` | `Aurelia`). Blender 5.2.1 LTS.

## Runtime contract

Identical to `ChefBlaze.glb`'s in every respect that matters to calling code:

- Meters, Blender Z-up exported Y-up, root at `(0, 0, 0)`.
- **Forward is +Z** in the model's own local space — the same convention `RestaurantScene.ts`'s
  avatars already use, so **no corrective rotation is needed**.
- The meters conversion lives in a baked scale on the root node. No vertex data and no animation
  curve is touched.
- Two named clips per character, both 30 fps, both in-place (moving the entity is the caller's job):
  `<Name>_Idle` (the character's own authored breathing loop, renamed) and `<Name>_Walk_InPlace`
  (30 frames, authored by the build — `cast-pack.blend` ships no walk animation).
- One mesh, one skin, 52 deform joints, one material, one UV set.

### Heights are derived, not chosen

Each character is scaled to match the primitive it replaces in `RestaurantScene.ts`, the same way
`build_chef_blaze.py` derived 1.86 m from the owner's capsule rather than picking a number:

| Character | Replaces | Source height | Export height |
|---|---|---|---|
| Monsieur | `host` worker — `CapsuleGeometry(0.3, 0.7)` at `y=0.8`, spanning 0.15–1.45 | 6.706 bu | 1.45 m |
| Vivienne | `server` worker — same primitive | 6.738 bu | 1.45 m |
| Aurelia | seated diner (STORY-066 re-derives this against the seated silhouette) | 6.547 bu | 1.45 m |

The measurement method was validated against Chef Blaze, which measures 7.300 bu — exactly the
"7.3 Blender units tall" its own `RIG-README.md` states.

### Triangle budgets come from live instance counts

From `shared/game-data/restaurant-layout.json` (6 tables; `staff.roster` is exactly one cook, one
server and one host, and no upgrade in `upgrades.json` adds staff) and `customer-segments.json`
(max `partySize` 4):

| Character | Live instances | Budget | Actual |
|---|---|---|---|
| Monsieur | 1 | hero-tier | 35,597 |
| Vivienne | 1 | hero-tier | 35,675 |
| Aurelia | **up to 24** (6 tables x 4) | ≤ 8,000 | 7,995 |

Aurelia is the only real crowd in this scene, and the only character where the shared-material
loader path is load-bearing rather than a formality. At 8,000 triangles a full dining room is
~192,000 triangles of skinned geometry rather than ~833,000 at hero-tier.

## The albedo bake, and why it is not optional

Each costume material in `cast-pack.blend` feeds a **front plate and a rear plate** into a Mix node
whose factor is a **per-vertex attribute** (`costume_rear`). glTF's PBR model cannot express that —
a base-colour slot takes one texture and one UV set. Blender's exporter keeps the front image,
**silently drops the rear**, emits no warning, and produces a GLB that validates cleanly.

The symptom is unmistakable once you look: the first exported Monsieur showed his bow tie,
waistcoat, watch chain and moustache again — mirrored round onto his back. It is invisible in a
front-on turnaround, which is how it survived into the delivered renders.

`build_cast.py` therefore bakes. Cycles evaluates the real node graph (mix factor, vertex attribute,
both plates) into a flat image, which glTF represents natively. A Smart UV Project is generated
first rather than reusing the authored `Generated front rear projection` UVs, because those were
built for a projection pair and **deliberately overlap** — front and rear texels share coordinates
and are told apart only by the attribute, so baking into them would fight itself.

Baked as DIFFUSE with direct/indirect passes off (colour only), not EMIT: the mix is wired to
Emission Color on the costume materials, but the gold monocle and chain are plain Principled
surfaces with no emission, and an EMIT bake would render those black.

## Known limitations — measured, and deliberately not fixed

Carried from `docs/CAST-PACK-README.md` and confirmed by rendering the actual exports. **Both
visual defects below were then measured against the real gameplay camera and accepted.**

The measurement: rendered at `DEFAULT_CAMERA` exactly (height 15, distance 17, fov 37.5 — a
41.4-degree elevation) at 1920x1080, a 1.45 m character occupies **~80 px of screen height**, and
turned edge-on is **13 px wide**. Its face is ~10 px. Neither defect is resolvable at that size; at
5x magnification the edge-on view still reads as a plausible figure. The camera never orbits
(`angle` is a constant in every preset in `CameraController.ts`), so this does not change with
player input. Fixing either would be effort spent below the resolution the game displays.

- **Side profile is weak.** These are front/rear image-projected volumetric reconstructions, so the
  silhouette is shallow and the texture stretches into vertical streaks along the side transition
  band. Rendering Monsieur's export in pure profile makes this plain. It matters most for a
  character crossing open floor — i.e. Vivienne on `server` duty (STORY-065 calls this out).
- **Both female heads carry a front/rear projection seam** tearing horizontally across the mid-face.
  At thumbnail size it reads as a moustache. The packed source plates were checked directly and are
  clean, so this is a projection defect, not a texture one — see STORY-063 for the full diagnosis.
- **No facial animation rig** is supplied by the source.

## Validation

`npm run check:models` covers every GLB under `assets/` with no per-model registration. All three
pass. See `docs/kb/model-asset-validation.md` for why a model defect is a whole-screen bug in this
renderer, and fix any failure **in the build script**, never in the exported binary.
