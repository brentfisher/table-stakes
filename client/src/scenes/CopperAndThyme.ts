import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import layout from '../../../shared/game-data/restaurant-layout.json';

// Vite emits the same source asset into both independent builds, including production's
// /assets/ path. No public-directory duplication or runtime dependency on docs/the zip.
const modelUrl = new URL('../../../assets/copper-and-thyme/restaurant.glb', import.meta.url).href;

function disposeModel(model: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

/** Presentation only. Entity roots retain the authoritative coordinates and their existing
 * indicators/upgrade state. A late request cannot attach to a disposed or remounted scene. */
export class CopperAndThyme {
  readonly ready: Promise<boolean>;
  private disposed = false;
  private enabled = true;
  private readonly artwork: THREE.Object3D[] = [];
  private readonly fallbackMaterials = new Set<THREE.Material>();
  /** Untouched GLB hierarchy used to stage the rival's recolored cutaway once the primary
   * restaurant has finished mounting its entity roots. It shares geometry with the live model,
   * while `createRivalVariant` clones materials so the two restaurants can have distinct palettes. */
  private rivalTemplate: THREE.Object3D | null = null;

  constructor(private readonly scene: THREE.Scene) {
    scene.userData.sceneryStatus = 'loading';
    this.ready = this.load();
  }

  private async load(): Promise<boolean> {
    try {
      const gltf: GLTF = await new GLTFLoader().loadAsync(modelUrl);
      if (this.disposed) {
        disposeModel(gltf.scene);
        return false;
      }
      // Generated command furniture belongs to gameplay and is not an authored GLB root.
      // Validate before hiding any gameplay geometry: a malformed export is a fallback,
      // never a half-skinned floor with missing interaction targets.
      const ids = layout.entities.filter((e) => e.type !== 'queue' && !('generated' in e && e.generated)).map((e) => e.id);
      if (ids.some((id) => !gltf.scene.getObjectByName(id))) {
        disposeModel(gltf.scene);
        throw new Error('Copper & Thyme model is missing layout entity roots');
      }
      // Keep one pristine hierarchy before entity roots are re-parented into the gameplay scene.
      // This is a cheap in-memory clone (geometry remains shared) that lets Peek reveal a full
      // second floor without issuing a second 22 MB network request.
      this.rivalTemplate = gltf.scene.clone(true);
      gltf.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.castShadow = true;
        o.receiveShadow = true;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (/Leaf/.test(m.name)) m.side = THREE.DoubleSide;
          if (m instanceof THREE.MeshStandardMaterial) {
            if (/Copper|Brass/.test(m.name)) { m.metalness = 0.78; m.roughness = 0.28; }
            if (/Forest/.test(m.name)) { m.color.setHex(0x496c50); m.roughness = 0.72; }
            if (/Steel/.test(m.name)) { m.metalness = 0.65; m.roughness = 0.36; }
          }
        }
      });
      for (const id of ids) {
        const target = this.scene.getObjectByName(id)!;
        const art = gltf.scene.getObjectByName(id)!;
        // Capture structural materials only, before attaching the imported subtree. The
        // station's queue boxes, shortage icon and pass's ready dishes remain independent.
        if (target instanceof THREE.Mesh) this.rememberMaterials(target);
        else for (const child of target.children) {
          if (child instanceof THREE.Mesh) this.rememberMaterials(child);
        }
        art.removeFromParent();
        art.position.set(0, 0, 0);
        art.name = `copper_${id}`;
        target.add(art);
        this.artwork.push(art);
      }
      const architecture = new THREE.Group();
      architecture.name = 'copper_architecture';
      // The reference's staggered parquet leaves short edge gaps. A recessed wood backing
      // closes them without covering the individual planks or raising the gameplay floor.
      const parquetBacking = new THREE.Mesh(new THREE.PlaneGeometry(18, 11),
        new THREE.MeshStandardMaterial({ color: 0x986942, roughness: 0.85 }));
      parquetBacking.rotation.x = -Math.PI / 2;
      parquetBacking.position.set(0, -0.022, -2.5);
      parquetBacking.receiveShadow = true;
      architecture.add(parquetBacking);
      architecture.add(...[...gltf.scene.children]);
      this.scene.add(architecture);
      this.artwork.push(architecture);
      for (const zone of layout.zones) {
        // The street retains its independent gameplay/queue surface; the model owns the
        // restaurant's parquet and tile floors. Material visibility preserves harness toggles.
        if (zone.id === 'street') continue;
        const floor = this.scene.getObjectByName(`zone_${zone.id}`);
        if (floor instanceof THREE.Mesh) this.rememberMaterials(floor);
      }
      this.scene.userData.sceneryStatus = 'ready';
      this.setVisible(this.enabled);
      return true;
    } catch (error) {
      if (!this.disposed) {
        this.scene.userData.sceneryStatus = 'fallback';
        console.warn('Copper & Thyme could not load; using the playable fallback scene.', error);
      }
      return false;
    }
  }

  private rememberMaterials(mesh: THREE.Mesh): void {
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      this.fallbackMaterials.add(material);
    }
  }

  setVisible(visible: boolean): void {
    this.enabled = visible;
    for (const art of this.artwork) art.visible = visible;
    for (const material of this.fallbackMaterials) material.visible = !visible;
  }

  /** Create a material-isolated rival copy of the authored hierarchy for the Peek cutaway.
   * Entity roots retain their exported coordinates; the caller owns the rival floor transform.
   * Returns null while the primary export is still loading or after disposal. */
  createRivalVariant(): THREE.Group | null {
    if (!this.rivalTemplate || this.disposed) return null;
    const variant = this.rivalTemplate.clone(true) as THREE.Group;
    variant.name = 'rival_authored_scenery';
    const palette: Array<[RegExp, number]> = [
      [/LeafLight/, 0x5aa99f],
      [/Leaf/, 0x2f776e],
      [/Forest/, 0x236a67],
      [/GlassGreen/, 0x174357],
      [/Terracotta/, 0xa34d5b],
      [/Copper/, 0xc65b7c],
      [/Brass/, 0xd67b91],
      [/Glow/, 0xffb347],
      [/Cheese/, 0xf4b45b],
      [/Tomato/, 0xe76c5d],
      [/Ceramic/, 0xf0d7d0],
      [/Linen/, 0xe6c5b5],
      [/Plaster/, 0xc7b9cf],
      [/Brick/, 0x72586f],
      [/OakLight/, 0x875968],
      [/Oak/, 0x4b2d4e],
      [/Walnut/, 0x281b31],
      [/Steel/, 0x8298ac],
      [/Stone/, 0x5d687b],
      [/Grout/, 0x2b3046],
      [/Black/, 0x17172b],
    ];
    variant.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const materials = sourceMaterials.map((source) => {
        const material = source.clone();
        if (!(material instanceof THREE.MeshStandardMaterial)) return material;
        const match = palette.find(([pattern]) => pattern.test(source.name));
        if (match) material.color.setHex(match[1]);
        if (/Glow/.test(source.name)) {
          material.emissive.setHex(0xff8fba);
          material.emissiveIntensity = 1.1;
        }
        if (/Leaf/.test(source.name)) material.side = THREE.DoubleSide;
        if (/Copper|Brass/.test(source.name)) { material.metalness = 0.72; material.roughness = 0.3; }
        if (/Steel/.test(source.name)) { material.metalness = 0.58; material.roughness = 0.34; }
        return material;
      });
      object.material = Array.isArray(object.material) ? materials : materials[0];
    });
    return variant;
  }

  dispose(): void {
    // Attached resources are disposed by RestaurantScene; a pending load disposes itself.
    this.disposed = true;
    this.rivalTemplate = null;
  }
}
