---
id: STORY-027
title: Low-poly city environment and interactive camera for the default harness
status: pending
prd_source: null
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: null
approach_summary: null
created: 2026-09-05
updated: 2026-09-05
---

# Low-poly city environment and interactive camera for the default harness

The six dev harnesses all mount the production `RestaurantScene` into what is effectively a dark
void (`0x1b1f24` background, one ambient light, one directional light). That was fine when the
harnesses existed only to prove primitives could render, but they now serve as the primary
surface for reviewing dev tooling, tuning gameplay visuals, and demoing work-in-progress features.
Mounting real gameplay geometry into empty blackness makes those reviews feel sterile, makes it
hard to judge scale, lighting, and readability against anything resembling a real setting, and
makes casual demos underwhelming.

At the same time, the default harness — `restaurant-layout-harness`, the first one anyone sees —
is the most natural place to walk around the restaurant footprint and inspect it from arbitrary
angles, but it currently exposes only the same deliberately-constrained slider-based camera the
production game uses. The production `CameraController` limits rotation on purpose to keep
restaurant state legible during real play, and that constraint should stay untouched in
production. A harness, however, is exactly the right place to layer an opt-in free-look camera on
top of those sliders for inspection purposes.

This story adds a shared, procedural, low-poly city block that frames the restaurant as the
default backdrop for every harness, and adds mouse-driven orbit and zoom controls to the default
harness — both as purely additive, harness-local changes that never fork `RestaurantScene` and
never modify the production camera.

## Acceptance Criteria

- [ ] A new shared module `harnesses/src/shared/city-environment.ts` exists and exports a function
      that, given a `RestaurantScene` instance, adds a procedural low-poly city block into
      `RestaurantScene.scene` as sibling geometry without subclassing, forking, copying, or
      otherwise modifying `RestaurantScene` itself.
- [ ] The city environment is composed entirely of procedural Three.js primitives with
      solid-color/flat-shaded materials — no `GLTFLoader`, no imported 3D models, no textures, no
      new npm dependencies, and no changes to the CDN pin or bundler config (Decision 1 /
      `check-threejs-pin.mjs` continues to pass).
- [ ] The environment includes all of: a street (flat plane with simple lane and curb markings),
      grass treelawns between the street and the sidewalk, low-poly flower-bed clusters placed
      between buildings, a handful of simple low-poly building blocks flanking the restaurant
      footprint, and subtle non-flat ground terrain variation (e.g. a displaced plane or tiled
      height variation) framing the block — not a single flat infinite plane.
- [ ] Atmospheric lighting is layered in as sibling additions to `RestaurantScene.scene` (e.g. a
      sky-colored background, a hemisphere light, and fog for depth) to produce a bright daytime
      mood, without editing, replacing, or disabling `RestaurantScene`'s internal
      `keyLight`/`ambient` — those must remain untouched so `updateFloorState` day/night logic
      continues to work.
- [ ] The city environment is applied as the default backdrop to all 6 harnesses
      (`restaurant-layout-harness`, `customer-flow-harness`, `kitchen-bottleneck-harness`,
      `event-visualization-harness`, `upgrade-preview-harness`, `asset-showcase-harness`) via a
      single shared mount path (e.g. `harness-shell.ts` or a shared helper each harness calls),
      not duplicated per file.
- [ ] The city geometry surrounds and frames the restaurant footprint at a distance and does not
      visually obscure or overlap the restaurant floor, customer/station/event primitives, or any
      harness's DOM UI overlays; each harness's own scene content remains fully readable.
- [ ] `restaurant-layout-harness.ts` imports `OrbitControls` from
      `three/addons/controls/OrbitControls.js` (using the existing import map — no new dependency,
      no bundling change) and enables mouse-drag orbit plus scroll-to-zoom on the harness's active
      camera.
- [ ] The interactive orbit/zoom controls are additive: the harness's existing `DevControls`
      sliders for camera height, angle, and zoom continue to function, and the user can drive the
      camera with either the sliders or the mouse in the same session.
- [ ] A visible dev toggle or button (added via `DevControls`, consistent with other harnesses)
      resets the camera to the default framed `DEFAULT_CAMERA` view.
- [ ] The production `CameraController` class and all real client gameplay camera behavior are
      unchanged; the free-look camera exists only inside `restaurant-layout-harness` and is not
      wired into any other harness or into production code.
- [ ] Each harness's `dispose()` fully tears down everything this story adds — all new geometries,
      materials, lights, fog, background changes, `OrbitControls` instances, and any DOM/window
      event listeners `OrbitControls` attaches — with no leaked Three.js objects or listeners,
      consistent with the repo-wide harness cleanup expectation.
- [ ] All 6 harnesses continue to load and run with no backend server running, matching existing
      harness behavior.

## Notes

- No PRD source. This is a supplemental dev-tooling and aesthetics enhancement with no upstream
  product requirement; `prd_source` is intentionally `null` in the frontmatter.
- Additive-sibling-geometry constraint: the new environment must be composed into
  `RestaurantScene.scene` as sibling objects rather than by subclassing, copying, or modifying
  `RestaurantScene`. This is enforced by the documented rule in
  `harnesses/src/shared/scene-primitives.ts` that harnesses reuse the real production scene rather
  than forking it, so that harnesses continue to exercise the same gameplay code path.
- Lighting-layering constraint: do not edit `RestaurantScene`'s internal `keyLight` or `ambient`.
  Those lights are consumed by `updateFloorState` for day/night gameplay logic, so the harness
  backdrop must add its own hemisphere/fog/background as siblings alongside them rather than
  replacing them.
- Harness-local-camera constraint: interactive orbit and zoom controls live only in
  `restaurant-layout-harness.ts` and are layered alongside the existing `CameraController` — never
  as a modification of it. The production `CameraController` deliberately limits rotation ("a free
  camera looks impressive and makes restaurant state hard to read"), and that constraint must
  remain intact in real gameplay.
- **Depends on STORY-001** (repo scaffold, which introduced `restaurant-layout-harness.ts` and the
  §14/§15.1 camera requirements it already implements via sliders) and the harness shell/`dispose`
  lifecycle it also established.
- Out of scope: any change to production `RestaurantScene` internals or its lights, any change to
  production `CameraController` or real gameplay camera behavior, any imported 3D models or
  textures, any new npm dependency, any bundling of Three.js, and any change to the scene content
  of harnesses other than receiving the shared city backdrop.
- **Not architectural.** No OpenSpec decision or spec change is required — this is additive
  harness-local scenery and dev tooling, not a change to `openspec/specs/`.
