---
id: STORY-060
title: Rig the new Chef Blaze hero model into the player's owner character
status: pending
prd_source: null
branch: story/060-chef-blaze-owner-model
worktree_path: null
base_branch: master
pr_url: null
is_architectural: false
approach_summary: >
  A new hero-quality Chef Blaze asset landed as two UNTRACKED files at the repo root:
  `chef-blaze.blend` (per its `RIG-README.md`, a 1,091,556-triangle sculpt — main body + fitted
  eyes + facial hair — with packed PBR textures, a full humanoid FK/IK armature, and a 1–120
  breathing loop at 30fps) and `RIG-README.md` itself. RIG-README.md is explicit: "efficient
  gameplay use needs retopology and texture baking" — this cannot be loaded into the live scene
  as-is. First move: relocate both files into `assets/chef-blaze/` (they don't belong loose at
  root) as the checked-in source, not final runtime asset.

  There are two PRIOR, UNMERGED attempts at a game-ready Chef Blaze export, both stale relative to
  this new sculpt: `feat/chef-blaze-character` (commit 2aeb5bb, `assets/chef-blaze/ChefBlaze.glb` +
  `ChefBlaze_Master.blend` + `build_chef_blaze.py` + `README_ThreeJS.md`, 4 in-place clips) and
  `feat/chef-blaze-turnaround-rebuild` (commit 00fbc60, "rebuild from polished turnaround"). Do
  NOT reuse either GLB — they were built from an earlier/different character version, not this
  sculpt. DO reuse the *pipeline pattern* `feat/chef-blaze-character`'s README_ThreeJS.md
  documents: a deterministic Blender-MCP build script producing a single retopo'd, single-bone-
  weighted-per-component GLB with baked PBR textures, in-place named animation clips at 30fps,
  meters, root at origin, and a `README_ThreeJS.md` + `manifest.json` describing the runtime
  contract. Follow that same documentation discipline for the new export.

  Target integration point: `client/src/scenes/RestaurantScene.ts`'s `upsertOwner()` (~line
  1645-1685) currently builds every owner — both the player's own ("self", green `0x7ac74f`) and
  the rival's ("rival", orange `0xd98c4a`) — as a `THREE.Group` of primitives: a
  `CapsuleGeometry` body, `SphereGeometry` head, `ConeGeometry` nose (facing indicator), and up to
  `MAX_VISIBLE_CARRY_PLATES` cylinder "plates" toggled visible when carrying food. There is
  currently NO GLTFLoader usage anywhere for characters (only for the `CopperAndThyme.ts`
  environment model and `FoodModels.ts` food items) and NO `AnimationMixer` anywhere in
  `client/src` — this is the first character rig in the game. Scope is the PLAYER'S OWN owner only
  ("self" case); the rival owner keeps its current primitive placeholder — do not touch it in this
  story. Movement is driven purely by position lerping (`positionTarget` + per-frame smoothing,
  `RestaurantScene.ts` ~line 2383, via the interpolator also used at ~1688-1694), not by any
  existing state machine that maps cleanly to animation states — deriving idle-vs-walking for the
  `AnimationMixer` will likely mean thresholding recent position delta, not reading a ready-made
  flag.

  Two things the primitive group currently encodes that the new model must still communicate:
  facing direction (today's nose cone) and carrying food (today's plate cylinders). Don't lose
  either — attach the plate meshes to a hand/hold point on the new rig (or another visible
  attachment) rather than dropping the carry-visual silently.

  Performance: STORY-059 already had to tune shadow/bloom/pixel-ratio cost on this scene because it
  was over budget on the base primitives. A retopo'd single character adds one draw call plus
  skeletal skinning per frame — check actual frame cost after wiring it in, not just at export
  time; this is a repeat of the same budget concern STORY-059 fought, not a hypothetical one.
created: 2026-09-19
updated: 2026-09-19
---

# Rig the new Chef Blaze hero model into the player's owner character

A new Chef Blaze character sculpt (`chef-blaze.blend`, with its `RIG-README.md`) landed at the
repo root as untracked files. It's a dense hero asset (over a million triangles) with a full
humanoid rig and a breathing animation, built for rendering/animation reference — not for
real-time use as-is. This story takes it from hero sculpt to a game-ready model driving the
player's own owner avatar in the shared restaurant scene, replacing today's capsule-and-cone
placeholder.

Two earlier, unmerged branches (`feat/chef-blaze-character`, `feat/chef-blaze-turnaround-rebuild`)
already built game-ready GLB exports of an *older* Chef Blaze version, using a documented
Blender-MCP build pipeline. Their output meshes are stale and should not be reused directly, but
their pipeline pattern and runtime-contract documentation style are worth following for this new
export.

## Acceptance Criteria

- [ ] `chef-blaze.blend` and `RIG-README.md` are moved from the repo root into `assets/chef-blaze/`
  (as source material) and committed — nothing hero-asset-sized is left untracked at root.
- [ ] The sculpt is retopologized and its textures baked down to a real-time-appropriate budget
  (single-digit-thousands to low tens-of-thousands of triangles, not ~1,000,000), with a single
  humanoid skeleton and single-bone-weighted-per-component skinning for stable, predictable
  browser draw calls — following the pattern `feat/chef-blaze-character`'s
  `README_ThreeJS.md`/`build_chef_blaze.py` used, not reusing that branch's actual output mesh.
- [ ] At minimum an idle clip and a walk (or walk-in-place) clip are authored/exported, named and
  documented the way the prior attempt's `ChefBlaze_Idle` / `ChefBlaze_Walk_InPlace` clips were.
- [ ] The export is a single GLB under `assets/chef-blaze/` (e.g. `ChefBlaze.glb`), meters, Y-up,
  root at `(0,0,0)`, alongside a `README_ThreeJS.md` and `manifest.json` documenting the runtime
  contract (units, orientation, clip names/lengths/fps) for whoever touches this next.
- [ ] `RestaurantScene.ts`'s `upsertOwner()` loads this GLB via `GLTFLoader` and drives it with an
  `AnimationMixer` for the **player's own ("self") owner only** — the rival owner keeps its
  current primitive placeholder, untouched by this story.
- [ ] The model switches between idle and walk clips based on the owner's actual movement (derived
  from position-lerp state, since there's no existing "is moving" flag to read) with a reasonable
  crossfade — no visible pop between clips.
- [ ] Facing direction remains visible (the model's own forward orientation stands in for today's
  nose-cone indicator) and the carry-food visual (today's plate cylinders) is preserved, attached
  to a sensible point on the new rig rather than dropped.
- [ ] Frame cost is checked with the model actually loaded and animating in the live scene (not
  just at export) — this scene already needed perf tuning once in STORY-059; confirm this addition
  doesn't reopen that budget.
- [ ] `npm run check` stays green.

## Notes

- Not part of any PRD slice (`prd_source: null`) — a direct asset-integration request.
- Cites: `chef-blaze.blend` + `RIG-README.md` (new source, currently untracked at repo root),
  `feat/chef-blaze-character` commit `2aeb5bb` (`assets/chef-blaze/README_ThreeJS.md`,
  `build_chef_blaze.py` — pipeline pattern to follow, mesh NOT to reuse),
  `feat/chef-blaze-turnaround-rebuild` commit `00fbc60` (same caveat),
  `client/src/scenes/RestaurantScene.ts` (`upsertOwner`, `MAX_VISIBLE_CARRY_PLATES`, the
  position-lerp/interpolator block), `client/src/scenes/CopperAndThyme.ts` and
  `client/src/scenes/FoodModels.ts` (existing `GLTFLoader` usage patterns to follow for a
  character instead of scenery/props).
- Explicitly out of scope: the rival owner's model, worker/cook avatars, and customer avatars —
  all keep their current primitive rendering. A follow-up story can extend the rig to them once
  this one lands.
- The two prior unmerged Chef Blaze branches are left as-is (not deleted, not merged) — this story
  produces an independent, current export rather than resurrecting either.
