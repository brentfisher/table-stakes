// STORY-063. The shared loader behind every rigged character in the scene: the player's own
// Chef Blaze owner avatar (via `ChefBlazeModel.ts`, which is now a thin wrapper over this) and
// the cast-pack workers wired up by `RestaurantScene.ts`'s `upsertWorker`.
//
// This is a generalization of STORY-060's `ChefBlazeModel.ts`, which was correct but hardcoded to
// one URL and two clip names. Two things had to change to serve more than one character:
//
// 1. PARAMETERIZED SOURCE. The GLB URL and the two clip names come in as a `RiggedCharacterSpec`,
//    and the parsed-source cache is keyed by URL instead of being a single module-level promise.
//
// 2. AN OPTIONAL SHARED-RESOURCE PATH — the substantive change. `buildChefBlaze` deep-cloned
//    geometry AND materials per instance. That is exactly right for the owner avatar, where only
//    one "self" owner is ever live, but it does not generalize: `assets/cast/Aurelia.glb` is a
//    seated diner and `shared/game-data/restaurant-layout.json` has 6 tables against a
//    `customer-segments.json` `partySize` cap of 4, so up to 24 of her can be on screen at once.
//    Twenty-four private copies of the same geometry and the same material is pure waste.
//
// WHY A SKINNED MESH CANNOT USE `Object3D.clone()` (inherited from STORY-060, still true): a plain
// clone duplicates the mesh and bone nodes but leaves every clone's `SkinnedMesh` bound to the
// ORIGINAL skeleton, so animating one clone moves them all. `SkeletonUtils.clone` — a three/addons
// utility built for exactly this — clones the skeleton alongside the meshes. Both paths below use
// it; they differ only in whether the geometry and materials it hands back by reference are then
// replaced with private copies.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

export interface RiggedCharacterSpec {
  /** Absolute URL of the GLB, normally built with `new URL('...', import.meta.url).href`. */
  readonly url: string;
  /** Name of the clip played at rest. Required. */
  readonly idleClip: string;
  /**
   * Name of the in-place walk clip, if this character has one.
   *
   * Optional because not every rigged character in this scene moves: a seated diner
   * (`assets/cast/Aurelia.glb`) is exported with a seated idle and NO walk, since shipping a walk
   * clip that must never play is both dead weight and an invitation to play it by mistake. When
   * this is absent, `update()` ignores its `moving` argument and simply advances the idle.
   */
  readonly walkClip?: string;
}

export interface RiggedCharacterOptions {
  /**
   * `true` gives this instance PRIVATE copies of the source's geometry and materials; `false`
   * (the default) shares the cached source's.
   *
   * Pick `true` only for a character whose materials get mutated per instance, or which is the
   * sole instance of its kind and wants independent disposal — the owner avatar's case. Pick
   * `false` for crowd entities. The distinction is not cosmetic: a shared instance MUST NOT
   * dispose what it borrowed (`dispose()` below enforces this), because the cached `gltf.scene`
   * lives for the lifetime of the page and every other instance — present and future — is still
   * pointing at those same objects.
   */
  readonly ownResources?: boolean;
}

/** Idle <-> walk crossfade duration. Long enough that the leg/arm swing amplitude doesn't visibly
 * snap in, short enough that tapping a direction key and releasing it doesn't look like wading
 * through syrup. */
const CROSSFADE_SECONDS = 0.25;

export interface RiggedCharacterInstance {
  /** Add this to the entity's group. Already scaled and oriented per the GLB's own runtime
   * contract (`assets/cast/README_ThreeJS.md`, `assets/chef-blaze/README_ThreeJS.md`) — root at
   * origin, meters, forward +Z, so no corrective transform is needed from the caller. */
  readonly root: THREE.Object3D;
  /** Advance the mixer and crossfade toward idle or walk as `moving` changes. Call once per
   * render frame with the frame's real `dt` in seconds — the same contract as `SceneManager`'s
   * `onFrame`/`cameraController.update`, not a second animation clock. `moving` is expected to be
   * already debounced/thresholded by the caller; a raw per-frame position delta is too noisy to
   * feed straight in (see `RestaurantScene.updateOwnerAnimations`). */
  update(dt: number, moving: boolean): void;
  /** Release this instance. Safe to call more than once. Disposes geometry/materials only when
   * this instance was built with `ownResources: true` — see `RiggedCharacterOptions`. */
  dispose(): void;
}

/** Parsed-source cache, keyed by URL so each distinct GLB is fetched and parsed at most once per
 * page regardless of how many instances are built from it. */
const sourcePromises = new Map<string, Promise<GLTF>>();

function loadSource(url: string): Promise<GLTF> {
  let promise = sourcePromises.get(url);
  if (!promise) {
    promise = new GLTFLoader().loadAsync(url);
    sourcePromises.set(url, promise);
  }
  return promise;
}

/** Dispose every geometry and material reachable from `root`. Only ever called for instances that
 * own their resources — calling it on a shared instance would corrupt the cached source and break
 * every clone made from it, including ones not yet created. */
export function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.SkinnedMesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

/**
 * Load (once, cached per URL) and instantiate an independently-animatable rigged character.
 *
 * Rejects if the GLB fails to load or is missing either named clip. Callers are expected to keep
 * whatever placeholder they already have in place until this resolves, so a rejection degrades to
 * "the primitive stays" rather than to a hole in the scene — the same fallback contract
 * `buildArcadeFoodProxy` (`FoodModels.ts`) uses for food props.
 */
export async function buildRiggedCharacter(
  spec: RiggedCharacterSpec,
  options: RiggedCharacterOptions = {},
): Promise<RiggedCharacterInstance> {
  const ownResources = options.ownResources ?? false;
  const gltf = await loadSource(spec.url);

  const root = cloneSkeleton(gltf.scene) as THREE.Object3D;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.SkinnedMesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    if (!ownResources) return;
    // `SkeletonUtils.clone` gives each instance its own skeleton/skin binding, but — like a plain
    // clone — it still REUSES the source's geometry and material objects. Replace them here when
    // this instance is meant to own its resources, the same way `FoodModels.ts`'s `ownedClone`
    // does for its unskinned props.
    object.geometry = object.geometry.clone();
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => material.clone())
      : object.material.clone();
  });

  const idleClip = THREE.AnimationClip.findByName(gltf.animations, spec.idleClip);
  // A missing walk is only an error when one was ASKED for. A spec with no `walkClip` is a
  // character that genuinely cannot walk, not an incomplete one.
  const walkClip = spec.walkClip
    ? THREE.AnimationClip.findByName(gltf.animations, spec.walkClip)
    : null;
  if (!idleClip || (spec.walkClip && !walkClip)) {
    if (ownResources) disposeObject(root);
    const missing = !idleClip ? spec.idleClip : spec.walkClip;
    throw new Error(`${spec.url} is missing animation clip ${missing}`);
  }

  const mixer = new THREE.AnimationMixer(root);
  const idleAction = mixer.clipAction(idleClip);
  const walkAction = walkClip ? mixer.clipAction(walkClip) : null;
  idleAction.play();
  let moving = false;
  let disposed = false;

  return {
    root,
    update(dt, nextMoving) {
      if (disposed) return;
      if (walkAction !== null && nextMoving !== moving) {
        moving = nextMoving;
        const from = moving ? idleAction : walkAction;
        const to = moving ? walkAction : idleAction;
        to.reset().play();
        // `warp: false` — the two clips have very different lengths (Idle is 120 frames,
        // Walk_InPlace is 30, a 4:1 ratio across every character this loads). `crossFadeFrom`'s
        // `warp` argument retimes BOTH actions' `timeScale` so they line up over the fade, which
        // at this ratio means the breathing loop visibly ramps to ~4x speed mid-transition —
        // exactly the pop this crossfade exists to avoid.
        to.crossFadeFrom(from, CROSSFADE_SECONDS, false);
      }
      mixer.update(dt);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Always release the mixer's own per-root bookkeeping, shared resources or not — leaving it
      // cached keeps this instance's clip bindings (and the root they reference) alive.
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      if (ownResources) disposeObject(root);
    },
  };
}
