// STORY-060. The first rigged character in the game — everything else in the scene is still
// primitives (`RestaurantScene.ts`'s customers/workers/rival owner) or a static environment GLB
// (`CopperAndThyme.ts`) or unrigged food props (`FoodModels.ts`). This follows the same
// "parse the source once, clone per instance" shape those two use (see `FoodModels.ts`'s
// `sourceFor`/`ownedClone`), but a SKINNED mesh can't use `Object3D.clone()` for the clone step —
// plain clone duplicates the mesh/bone nodes but leaves every clone's `SkinnedMesh` bound to the
// ORIGINAL skeleton, so animating one clone would move them all. `SkeletonUtils.clone` (a
// three/addons utility built exactly for this) clones the skeleton along with the meshes.
//
// In practice only one "self" owner exists per client at a time (`RestaurantScene.ts`'s
// `upsertOwner` only takes this path for `state.isSelf`), so today there is only ever one clone
// live. The clone-per-instance shape is kept anyway so a reconnect (remove + re-add of the same
// playerId) or any future multi-instance use doesn't silently share animation state.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const modelUrl = new URL('../../../assets/chef-blaze/ChefBlaze.glb', import.meta.url).href;

const IDLE_CLIP_NAME = 'ChefBlaze_Idle';
const WALK_CLIP_NAME = 'ChefBlaze_Walk_InPlace';
// Idle <-> walk crossfade duration. Long enough that the leg/arm swing amplitude (see
// `build_chef_blaze.py`'s WALK_BONES comment) doesn't visibly snap in, short enough that an
// owner who taps a direction key and releases it doesn't look like it's wading through syrup.
const CROSSFADE_SECONDS = 0.25;

let sourcePromise: Promise<GLTF> | null = null;

function loadSource(): Promise<GLTF> {
  if (!sourcePromise) sourcePromise = new GLTFLoader().loadAsync(modelUrl);
  return sourcePromise;
}

export interface ChefBlazeInstance {
  /** Add this to the owner's group. Already scaled/oriented per the GLB's own runtime
   * contract (see `assets/chef-blaze/README_ThreeJS.md`) — root at origin, meters, no
   * extra transform needed from the caller. */
  root: THREE.Object3D;
  /** Advance the mixer and crossfade toward the idle or walk clip as `moving` changes.
   * Call once per render frame with the frame's real `dt` (seconds) — same contract as
   * `SceneManager`'s own `onFrame`/`cameraController.update`, not a second animation
   * clock. `moving` is expected to already be debounced/thresholded by the caller (see
   * `RestaurantScene.updateOwnerAnimations`'s own comment on why a raw per-frame position
   * delta is too noisy to feed straight into this). */
  update(dt: number, moving: boolean): void;
}

function disposeObject(root: THREE.Object3D): void {
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

/** Load (once, cached) and instantiate an independently-animatable Chef Blaze. Rejects if the
 * GLB fails to load or is missing either named clip — the caller (`upsertOwner`) already keeps
 * the primitive placeholder in place until/unless this resolves, so a rejection just means the
 * self owner stays on the placeholder, same as `buildArcadeFoodProxy`'s own fallback contract. */
export async function buildChefBlaze(): Promise<ChefBlazeInstance> {
  const gltf = await loadSource();
  // `SkeletonUtils.clone` gives each instance its own skeleton/skin binding (see this file's
  // header comment on why plain `Object3D.clone()` can't do that), but — like a plain clone —
  // it still REUSES the source's geometry/material objects rather than copying them. Clone
  // those too, the same way `FoodModels.ts`'s `ownedClone` does for its (unskinned) props: the
  // cached `gltf.scene` from `loadSource()` lives for the lifetime of the page, so disposing an
  // instance's geometry/material without this would corrupt that shared source the moment
  // ANY instance is disposed (`RestaurantScene.dispose()`'s generic scene traversal, or a future
  // `removeOwner` cleanup) — and every clone made after that point would render broken.
  const root = cloneSkeleton(gltf.scene) as THREE.Object3D;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.SkinnedMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      object.geometry = object.geometry.clone();
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => material.clone())
        : object.material.clone();
    }
  });

  const idleClip = THREE.AnimationClip.findByName(gltf.animations, IDLE_CLIP_NAME);
  const walkClip = THREE.AnimationClip.findByName(gltf.animations, WALK_CLIP_NAME);
  if (!idleClip || !walkClip) {
    disposeObject(root);
    throw new Error(`ChefBlaze.glb is missing ${!idleClip ? IDLE_CLIP_NAME : WALK_CLIP_NAME}`);
  }

  const mixer = new THREE.AnimationMixer(root);
  const idleAction = mixer.clipAction(idleClip);
  const walkAction = mixer.clipAction(walkClip);
  idleAction.play();
  let moving = false;
  let disposed = false;

  return {
    root,
    update(dt, nextMoving) {
      if (disposed) return;
      if (nextMoving !== moving) {
        moving = nextMoving;
        const from = moving ? idleAction : walkAction;
        const to = moving ? walkAction : idleAction;
        to.reset().play();
        // `warp: false` — the two clips have very different lengths (Idle is 120 frames,
        // Walk_InPlace is 30, a 4:1 ratio). `crossFadeFrom`'s `warp` argument retimes BOTH
        // actions' `timeScale` so they line up over the fade duration, which at this ratio means
        // the breathing loop visibly ramps to ~4x speed mid-transition — exactly the "visible
        // pop" this crossfade exists to avoid. `warp: true` is fine when both clips are close in
        // length (the prior branches' demo used it for 75-vs-30-frame clips, a much milder
        // ratio); here it isn't.
        to.crossFadeFrom(from, CROSSFADE_SECONDS, false);
      }
      mixer.update(dt);
    },
  };
}

export { disposeObject as disposeChefBlaze };
