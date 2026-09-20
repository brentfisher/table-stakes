---
id: STORY-063
title: Cast export pipeline and a shared rigged-character loader
status: complete
prd_source: null
branch: story/063-cast-export-pipeline-and-shared-loader
worktree_path: null
base_branch: master
pr_url: null
is_architectural: true
approach_summary: >
  Foundation story for wiring the three new cast characters (Monsieur, Vivienne, Aurelia) into the
  game. Produces no visible gameplay change on its own — it builds the export pipeline and
  generalizes the loader that STORY-064/065/066 each consume.

  SOURCE LIVES OUTSIDE THE REPO. `cast-pack.blend` is 135 MB; unlike `chef-blaze.blend` (49 MB,
  committed at `assets/chef-blaze/chef-blaze.blend`), it is NOT committed — this is a deliberate,
  documented deviation from the STORY-060 precedent, taken because the repo has no Git LFS and a
  135 MB blob is permanent in history for every clone. The blend lives at
  `~/asset-sources/table-stakes/chef-blaze-cast-assets/blender/cast-pack.blend`, SHA256
  `43bd1b4b406eef32ef837bc770aedd09d00537633bb596de1e75c0f79cd5f6a2`. Record that hash in every
  manifest this pipeline emits so a rebuild is auditable without the source in-tree. The rest of
  the delivery is extracted beside it and is also out-of-repo — `pipeline/cast/*.py` (the original
  Blender-MCP build scripts), `pipeline/data/` (source texture plates, needed for the lip fix
  below), `renders/`, `references/`, `docs/` and `SHA256SUMS.txt`.
  `assets/*.zip` is already gitignored. Note the delivery zip's `blender/chef-blaze.blend` is
  byte-identical (SHA256 `cc55a94e…`) to the committed one — there is nothing new in it.

  WHAT THE BLEND CONTAINS (verified headless, Blender 5.2.1 LTS). Three new characters, each a
  61-bone FK/IK rig with the SAME bone topology as Chef Blaze's, each parenting 5-7 mesh objects,
  each carrying exactly ONE action — a 120-frame breathing loop. No walk. No seated pose.
    MONSIEUR | French maître d'   1,034,288 tris   action "MONSIEUR | French maître d’ | breathing loop"
    AURELIA  | affluent patron      802,252 tris   action "AURELIA | affluent patron | breathing loop"
    VIVIENNE | luxury concierge     700,828 tris   action "VIVIENNE | luxury concierge | breathing loop"
  Each character also parents a full `… | shared <male|female> body` mesh (141k-153k tris) that sits
  UNDER the tailored outfit and is almost entirely occluded — drop it at export unless a visible
  seam proves otherwise. Aurelia's `removable pearl necklace` is already `hide_render=True`; the
  `ACCESSORY LIBRARY`, `DISPLAY | …`, `BASE MODELS`, `TEMPLATE | …` and studio/camera objects are
  authoring scaffolding and must not export.

  DO NOT ASSUME CHEF BLAZE'S AXES. `build_chef_blaze.py` empirically verified +Z-forward by
  exporting a marker at Blender (0,-2,0) through the exact export settings and confirming it landed
  at glTF (0,0,2). These three came from `assemble_cast.py`, a different pipeline, so repeat that
  marker test PER CHARACTER. Guessing is how characters ship facing backwards.

  KNOWN SOURCE DEFECTS, to fix in the build script (not the exported binary — see
  `docs/kb/model-asset-validation.md`).

  (1) FACE PROJECTION SEAM — diagnosed, and NOT the 2D texture fix it first looks like. At thumbnail
  size both women appear to have a dark moustache. Cropping the delivered render at 7x
  (`renders/cast-pack-hero.png`) shows what it actually is: a horizontal texture DISCONTINUITY
  tearing across the mid-face at nose/upper-lip level, with the nose and mouth smeared and displaced
  below it. The packed source plates were checked directly — `heiress-front-hires.png` and
  `concierge-front-hires.png` (575x1444 and 572x1464, both packed in the blend, both already the
  hi-res variants) have clean, correct faces with no moustache and no smear. **The defect is in the
  front/rear projection, not in the texture**, so there is nothing to repair in 2D.

  Likely cause, and where to look first: `docs/CAST-PACK-README.md` says "Front/back projection is
  selected by surface position to avoid texture flipping across small reconstructed folds", and that
  a later pass moved "the front/rear costume switch" to "an explicit mesh attribute instead of each
  separated module's changing bounding box". The OUTFIT module got that fix; the HEAD AND HAIR
  module appears to still switch positionally — and a nose is exactly the "small reconstructed fold"
  where a positional/normal test flips, so a band around the nose and mouth is classified as
  rear-facing and samples the REAR plate. That is consistent with the tear being horizontal, at nose
  height, on both female heads. Confirm before fixing: dump the head module's UVs / projection
  attribute and check whether the torn band samples rear-plate UVs.

  Fix by reclassifying the head module front/rear on a smoothed or major-axis normal (or an explicit
  mesh attribute, matching what the outfit module already does), then re-projecting — in the build
  script, so a rebuild cannot reintroduce it. `pipeline/cast/assemble_cast.py` and
  `polish_cast_pass2.py` (extracted at `~/asset-sources/table-stakes/chef-blaze-cast-assets/pipeline/cast/`)
  are the original projection code and the place to read the existing logic.

  SCALE THE EFFORT TO THE CAMERA. Measure the on-screen face size at the real gameplay camera
  distance before committing to this. These are a host, a server and seated diners in a
  restaurant-wide view — if a face is only 20-40 px, the seam may be genuinely invisible and the
  right call is to document it and move on. Do that measurement first; do not spend a projection
  rebuild on something no player can see. (2) `cast-pack-pose-check.png`
  shows Monsieur's and Aurelia's forearms shearing apart at a mild elbow bend — the pack README
  concedes "joint deformation… need further production work". Clamp/repair elbow weights at export.
  (3) The pack README also concedes weak side profiles and no facial rig; those stay as accepted
  limitations, documented, not fixed here.

  ANISOTROPY TRAP. `docs/kb/model-asset-validation.md` documents a whole-scene black-flashing
  incident: Chef Blaze's hair material carried Principled `Anisotropic` 0.35, Blender exported
  `KHR_materials_anisotropy`, the sculpt ships no tangents, and `normalize(vec3(0))` NaN'd through
  the bloom pass — 42.2% of frames affected. These characters have their own head/hair materials.
  Clear anisotropy (or ship tangents) IN THE BUILD SCRIPT before exporting, and let
  `npm run check:models` confirm it.

  LOADER. `client/src/scenes/ChefBlazeModel.ts` is the right shape but is hardcoded to one URL and
  two clip names, and clones geometry AND materials per instance. That per-instance clone is
  correct for Chef Blaze (exactly one "self" owner is ever live), and equally fine for Monsieur and
  Vivienne (one instance each), but wrong for Aurelia — up to 24 diners must not each own a copy of
  the same geometry and material. Generalize
  into a parameterized loader taking { url, idleClip, walkClip } and offering a shared-material path
  for crowd instances alongside the existing owned-clone path. Keep `ChefBlazeModel.ts`'s public
  surface working — STORY-060's `upsertOwner` integration must not regress.
created: 2026-09-20
updated: 2026-09-20
---

# Cast export pipeline and a shared rigged-character loader

A four-character cast pack was delivered alongside the existing Chef Blaze hero: **Monsieur** (a
French maître d'), **Vivienne** (a luxury concierge) and **Aurelia** (an affluent patron), plus a
copy of Chef Blaze we already have. They arrive as dense authoring meshes in a 135 MB Blender scene
with a breathing loop and nothing else — no walk, no seated pose, no game-ready export.

This story builds the shared machinery the three per-character stories need: a deterministic
export script that turns `cast-pack.blend` into validated per-character GLBs, and a generalized
version of `ChefBlazeModel.ts` that can drive any of them. It deliberately ships **no visible
gameplay change** — STORY-064, STORY-065 and STORY-066 each put one character on screen.

## Acceptance Criteria

- [ ] `assets/cast/build_cast.py` exists, modelled on `assets/chef-blaze/build_chef_blaze.py`
  (deterministic, never writes to its source). It reads `cast-pack.blend` from a path given by
  argument or env var — defaulting to `~/asset-sources/table-stakes/…` — and fails with a clear,
  actionable message when the source is absent, since it is deliberately not in the repo.
- [ ] The script verifies the source blend's SHA256 against
  `43bd1b4b406eef32ef837bc770aedd09d00537633bb596de1e75c0f79cd5f6a2` and refuses to build on a
  mismatch rather than silently exporting from an unknown scene.
- [ ] It exports one GLB per new character under `assets/cast/` — Monsieur, Vivienne, Aurelia —
  decimated to budgets set by each character's ACTUAL live instance count, measured from
  `shared/game-data/restaurant-layout.json` (6 tables, `staff.roster` = one cook, one server, one
  host; `upgrades.json` adds no staff) and `customer-segments.json` (max `partySize` 4):
    - **Monsieur (host)** — exactly 1 instance. Chef Blaze's ~35,000-triangle hero budget is
      affordable; do not over-decimate a character that is only ever on screen once.
    - **Vivienne (server)** — exactly 1 instance. Same budget as Monsieur.
    - **Aurelia (diner)** — up to **24** instances (6 tables x party of 4). Budget **<= 8,000
      triangles**, so a full dining room stays under ~192,000 triangles of skinned geometry.
  The occluded `shared <male|female> body` mesh and all studio/library/template scaffolding are
  excluded from every export.
- [ ] Forward axis and height are verified **empirically per character** with the marker-object
  test `build_chef_blaze.py` used — not assumed from Chef Blaze's result — and the finding is
  recorded per character in the manifest.
- [ ] Each character exports at minimum an idle clip and an in-place walk clip at 30fps, named on
  the `ChefBlaze_Idle` / `ChefBlaze_Walk_InPlace` pattern. Idle comes from the character's own
  breathing loop; the walk is authored by the script, generalizing `build_chef_blaze.py`'s
  `WALK_BONES` / `world_axis_to_local` / `flex_phase` machinery across all three 61-bone rigs.
- [ ] Principled `Anisotropic` is explicitly cleared (or real tangents exported) for every material
  before export, so the STORY-062-era `KHR_materials_anisotropy` black-flashing defect documented in
  `docs/kb/model-asset-validation.md` cannot recur on the new hair/head materials.
- [x] **MEASURED AND ACCEPTED — do not spend a projection rebuild on this.** Rendered at the exact
  `DEFAULT_CAMERA` (height 15, distance 17, fov 37.5, giving a 41.4-degree elevation) at 1920x1080,
  a 1.45 m character occupies ~80 px of screen height and, turned edge-on, is **13 px wide**. Its
  face is ~10 px. The mid-face seam is not resolvable at that size, and neither is the shallow
  silhouette — at 5x magnification the profile still reads as a plausible figure. Both defects are
  below what this game's camera shows, and the camera never orbits (`angle` is a constant in every
  preset in `CameraController.ts`), so this does not change with player input. Recorded in
  `assets/cast/README_ThreeJS.md` under Known limitations.
- [ ] Elbow deformation is repaired/clamped so a bent arm does not shear the sleeve open, verified by
  posing a mid-swing walk frame and rendering, the way STORY-060 verified the same thing.
- [ ] `npm run check:models` passes for all three new GLBs.
- [ ] `assets/cast/README_ThreeJS.md` and one `manifest.json` per character document the runtime
  contract (units, orientation, height, clip names/lengths/fps, triangle counts, source SHA256) in
  the style of `assets/chef-blaze/README_ThreeJS.md`, **including** an explicit note that the source
  blend is intentionally out-of-repo and where to obtain it.
- [ ] `ChefBlazeModel.ts` is generalized into a parameterized rigged-character loader — URL plus
  clip names — with a shared-geometry/shared-material path for many-instance crowd use alongside the
  existing per-instance owned-clone path used by the single owner avatar.
- [ ] STORY-060's owner integration still works unchanged: the self owner still loads, idles,
  walks and crossfades exactly as before.
- [ ] `npm run check` stays green.

## Notes

- Sequenced first and deliberately invisible. STORY-064 (Monsieur → `host` worker), STORY-065
  (Vivienne → `server` worker) and STORY-066 (Aurelia → seated customer) all depend on it.
- The pack's own `docs/CAST-PACK-README.md` states these three are "dense image-projected
  volumetric prototypes" whose "side profiles, joint deformation, topology and facial animation need
  further production work before gameplay use". Proceeding knowingly: this story fixes the two
  defects that read at gameplay distance (lip smear, elbow shearing) and documents the rest.
- Out of scope: any `RestaurantScene.ts` change, the rival owner's avatar, and a seated pose
  (STORY-066 owns that problem).
