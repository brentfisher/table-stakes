// Authored arcade-food GLBs shared by the live restaurant and the standalone food gallery.
// Each asset is parsed once, then deep-cloned so every visible instance owns the geometry and
// materials that its scene will eventually dispose. This avoids re-downloading repeated dishes
// without coupling the lifetimes of the game scene and a harness scene.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import manifestData from '../../../shared/game-data/arcade-food.json';

export interface ArcadeFoodAsset {
  id: string;
  modelId: string;
  name: string;
  category: 'dish' | 'ingredient';
  file: string;
  dimensions: { x: number; y: number; z: number };
}

export const ARCADE_FOOD_ASSETS = manifestData.assets as ArcadeFoodAsset[];
export const ARCADE_FOOD_BY_ID = new Map(ARCADE_FOOD_ASSETS.map((asset) => [asset.id, asset]));

// Literal URLs let Vite copy the same source assets into both independent builds. Keeping this
// map explicit also makes a missing model a compile/build failure instead of a late 404 assembled
// from an unchecked runtime string.
export const ARCADE_FOOD_MODEL_URLS: Readonly<Record<string, string>> = Object.freeze({
  smash_burger: new URL('../../../assets/arcade-food/models/smash-burger.glb', import.meta.url).href,
  caesar_salad: new URL('../../../assets/arcade-food/models/caesar-salad.glb', import.meta.url).href,
  pasta_primavera: new URL('../../../assets/arcade-food/models/pasta-primavera.glb', import.meta.url).href,
  chicken_sandwich: new URL('../../../assets/arcade-food/models/chicken-sandwich.glb', import.meta.url).href,
  steak_frites: new URL('../../../assets/arcade-food/models/steak-frites.glb', import.meta.url).href,
  nachos: new URL('../../../assets/arcade-food/models/nachos.glb', import.meta.url).href,
  espresso: new URL('../../../assets/arcade-food/models/espresso.glb', import.meta.url).href,
  cheesecake: new URL('../../../assets/arcade-food/models/cheesecake.glb', import.meta.url).href,
  bun: new URL('../../../assets/arcade-food/models/brioche-bun.glb', import.meta.url).href,
  beef: new URL('../../../assets/arcade-food/models/ground-beef.glb', import.meta.url).href,
  cheese: new URL('../../../assets/arcade-food/models/cheese.glb', import.meta.url).href,
  lettuce: new URL('../../../assets/arcade-food/models/lettuce.glb', import.meta.url).href,
  croutons: new URL('../../../assets/arcade-food/models/croutons.glb', import.meta.url).href,
  dressing: new URL('../../../assets/arcade-food/models/dressing.glb', import.meta.url).href,
  pasta: new URL('../../../assets/arcade-food/models/dry-pasta.glb', import.meta.url).href,
  vegetables: new URL('../../../assets/arcade-food/models/seasonal-vegetables.glb', import.meta.url).href,
  olive_oil: new URL('../../../assets/arcade-food/models/olive-oil.glb', import.meta.url).href,
  chicken: new URL('../../../assets/arcade-food/models/chicken-breast.glb', import.meta.url).href,
  steak: new URL('../../../assets/arcade-food/models/sirloin-steak.glb', import.meta.url).href,
  potatoes: new URL('../../../assets/arcade-food/models/potatoes.glb', import.meta.url).href,
  butter: new URL('../../../assets/arcade-food/models/butter.glb', import.meta.url).href,
  tortilla_chips: new URL('../../../assets/arcade-food/models/tortilla-chips.glb', import.meta.url).href,
  salsa: new URL('../../../assets/arcade-food/models/salsa.glb', import.meta.url).href,
  coffee_beans: new URL('../../../assets/arcade-food/models/coffee-beans.glb', import.meta.url).href,
  cheesecake_base: new URL('../../../assets/arcade-food/models/cheesecake-base.glb', import.meta.url).href,
  berries: new URL('../../../assets/arcade-food/models/berries.glb', import.meta.url).href,
});

const loader = new GLTFLoader();
const sourceCache = new Map<string, Promise<THREE.Object3D>>();

function sourceFor(assetId: string): Promise<THREE.Object3D> {
  const url = ARCADE_FOOD_MODEL_URLS[assetId];
  if (!url) return Promise.reject(new Error(`No arcade food model for ${assetId}`));
  let pending = sourceCache.get(assetId);
  if (!pending) {
    pending = loader.loadAsync(url).then((gltf: GLTF) => gltf.scene);
    sourceCache.set(assetId, pending);
  }
  return pending;
}

/** Clone scene nodes and their render resources. The caller can dispose this clone independently. */
function ownedClone(source: THREE.Object3D): THREE.Object3D {
  const clone = source.clone(true);
  clone.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry = object.geometry.clone();
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => material.clone())
      : object.material.clone();
    object.castShadow = true;
    object.receiveShadow = true;
  });
  return clone;
}

export function disposeFoodObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function belongsToScene(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current?.parent) current = current.parent;
  return current instanceof THREE.Scene;
}

export interface ArcadeFoodProxyOptions {
  scale?: number;
  fallback?: THREE.Object3D;
}

/**
 * Return a synchronous root so gameplay never waits on presentation. An optional procedural
 * fallback remains visible until the GLB arrives, then is replaced atomically. Load failure is
 * recorded on userData and deliberately leaves the playable fallback in place.
 */
export function buildArcadeFoodProxy(assetId: string, options: ArcadeFoodProxyOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = `arcade_food_${assetId}`;
  root.userData.arcadeFoodAssetId = assetId;
  root.userData.arcadeFoodStatus = 'loading';
  if (options.fallback) root.add(options.fallback);

  void sourceFor(assetId).then((source) => {
    if (!belongsToScene(root)) return;
    const model = ownedClone(source);
    model.name = `arcade_food_model_${assetId}`;
    model.scale.setScalar(options.scale ?? 1);
    const fallback = options.fallback;
    if (fallback) {
      root.remove(fallback);
      disposeFoodObject(fallback);
    }
    root.add(model);
    root.userData.arcadeFoodStatus = 'ready';
  }).catch((error: unknown) => {
    root.userData.arcadeFoodStatus = 'fallback';
    root.userData.arcadeFoodError = error instanceof Error ? error.message : String(error);
    console.warn(`Arcade food model ${assetId} could not load; keeping fallback.`, error);
  });

  return root;
}
