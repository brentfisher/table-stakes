// The restaurant scene graph, built from shared/game-data/restaurant-layout.json.
//
// This module is deliberately free of networking and game rules: it takes a layout and a
// render state and produces/updates Three.js objects. PRD §15 "The key requirement is
// separation: game rules should emit state, and scene-view code should render state." That
// is what lets harnesses/ mount this same scene with mocked state and no backend.

import * as THREE from 'three';
import layout from '../../../shared/game-data/restaurant-layout.json';

export interface OwnerRenderState {
  playerId: string;
  position: { x: number; y: number; z: number };
  facing: number;
  sprinting?: boolean;
  isSelf?: boolean;
}

// PRD §14 "Visual state language" — the shared palette. STORY-016 extends this to the full
// green/yellow/orange/red/blue/purple semantics; Milestone 0 needs only structural colors.
export const ZONE_COLORS: Record<string, number> = {
  street: 0x3a4046,
  dining: 0x54606b,
  pass: 0x6b7480,
  kitchen: 0x474f58,
};

const STATION_COLORS: Record<string, number> = {
  prep: 0x4a90d9,
  grill: 0xd9734a,
  oven: 0xd9a74a,
  plating: 0x7ac74f,
};

/** STORY-012 "Faster Grill I": a brighter, hotter-reading tint of the same station color, not
 * a new palette entry — full state-driven visual language is STORY-016's job (see this file's
 * header comment on `ZONE_COLORS`), this is a single targeted swap. */
const STATION_COLORS_UPGRADED: Record<string, number> = {
  grill: 0xff8a4a,
};

/** PRD §7 baseline before any Serving Tray upgrade. */
const MAX_VISIBLE_CARRY_PLATES = 3;

export interface RestaurantSceneOptions {
  showDebugGrid?: boolean;
  showCompetitor?: boolean;
  night?: boolean;
}

export class RestaurantScene {
  readonly scene = new THREE.Scene();
  readonly layout = layout;

  private readonly owners = new Map<string, THREE.Group>();
  private readonly grid: THREE.GridHelper;
  private readonly competitor: THREE.Group;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly ambient: THREE.AmbientLight;

  constructor(options: RestaurantSceneOptions = {}) {
    this.scene.background = new THREE.Color(0x1b1f24);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(this.ambient);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
    this.keyLight.position.set(8, 16, 6);
    this.scene.add(this.keyLight);

    this.buildZones();
    this.buildEntities();

    this.grid = new THREE.GridHelper(28, 28, 0x7fd4ff, 0x38424c);
    this.grid.position.y = 0.02;
    this.grid.visible = options.showDebugGrid ?? false;
    this.scene.add(this.grid);

    this.competitor = this.buildCompetitor();
    this.competitor.visible = options.showCompetitor ?? true;
    this.scene.add(this.competitor);

    this.setNight(options.night ?? false);
  }

  private buildZones(): void {
    for (const zone of this.layout.zones) {
      const [minX, minZ] = zone.min;
      const [maxX, maxZ] = zone.max;
      const width = maxX - minX;
      const depth = maxZ - minZ;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, depth),
        new THREE.MeshStandardMaterial({ color: ZONE_COLORS[zone.id] ?? 0x505860, roughness: 0.95 }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(minX + width / 2, 0, minZ + depth / 2);
      mesh.name = `zone_${zone.id}`;
      this.scene.add(mesh);
    }
  }

  private buildEntities(): void {
    for (const entity of this.layout.entities) {
      const mesh = this.buildEntity(entity);
      if (!mesh) continue;
      const [x, y, z] = entity.position as number[];
      mesh.position.set(x, y, z);
      mesh.name = entity.id;
      this.scene.add(mesh);
    }
  }

  private buildEntity(entity: { type: string; station?: string; seats?: number }): THREE.Object3D | null {
    switch (entity.type) {
      case 'table': {
        const group = new THREE.Group();
        const top = new THREE.Mesh(
          new THREE.CylinderGeometry(0.9, 0.9, 0.12, 20),
          new THREE.MeshStandardMaterial({ color: 0xcbb79a, roughness: 0.7 }),
        );
        top.position.y = 0.75;
        group.add(top);
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.12, 0.75, 10),
          new THREE.MeshStandardMaterial({ color: 0x6b5b47 }),
        );
        leg.position.y = 0.375;
        group.add(leg);
        for (let i = 0; i < (entity.seats ?? 2); i += 1) {
          const angle = (i / (entity.seats ?? 2)) * Math.PI * 2;
          const chair = new THREE.Mesh(
            new THREE.BoxGeometry(0.42, 0.5, 0.42),
            new THREE.MeshStandardMaterial({ color: 0x8b7a63 }),
          );
          chair.position.set(Math.cos(angle) * 1.45, 0.25, Math.sin(angle) * 1.45);
          group.add(chair);
        }
        return group;
      }
      case 'station': {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 1.0, 1.4),
          new THREE.MeshStandardMaterial({
            color: STATION_COLORS[entity.station ?? ''] ?? 0x808890,
            roughness: 0.55,
            metalness: 0.25,
          }),
        );
        mesh.position.y = 0.5;
        return mesh;
      }
      case 'service_pass':
        return this.box(16, 0.9, 0.8, 0xb9c2cc);
      case 'pantry':
        return this.box(2.6, 2.0, 1.2, 0x9c7d55);
      case 'dishwashing':
        return this.box(2.6, 1.1, 1.2, 0x6f7d8c);
      case 'host_stand':
        return this.box(1.1, 1.1, 0.7, 0xb08a5e);
      case 'upgrade_terminal':
        return this.box(1.0, 1.2, 0.8, 0x5fbf9e);
      case 'queue':
        return this.box(3.4, 0.06, 1.2, 0x2f3843);
      default:
        return null;
    }
  }

  private box(w: number, h: number, d: number, color: number): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
    );
    mesh.position.y = h / 2;
    return mesh;
  }

  /**
   * PRD §4.4 / §14: the competitor's restaurant must be visible in some form. Milestone 0
   * ships a simplified mirrored shell across the street; STORY-016 gives it live activity.
   */
  private buildCompetitor(): THREE.Group {
    const group = new THREE.Group();
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(18, 0.3, 10),
      new THREE.MeshStandardMaterial({ color: 0x3f464e, roughness: 0.95 }),
    );
    slab.position.set(0, 0.15, -26);
    group.add(slab);
    for (let i = 0; i < 6; i += 1) {
      const t = this.box(1.6, 0.7, 1.6, 0x7d868f);
      t.position.set(-6 + (i % 3) * 4.5, 0.65, -24 + Math.floor(i / 3) * 3.5);
      group.add(t);
    }
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(6, 1.2, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xc75f5f, emissive: 0x521f1f }),
    );
    sign.position.set(0, 3, -21);
    group.add(sign);
    group.name = 'competitor_restaurant';
    return group;
  }

  /** Create or update one owner avatar. Position always comes from server state. */
  upsertOwner(state: OwnerRenderState): void {
    let group = this.owners.get(state.playerId);
    if (!group) {
      group = new THREE.Group();
      const color = state.isSelf ? 0x7ac74f : 0xd98c4a;
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.34, 0.75, 6, 12),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
      );
      body.position.y = 0.85;
      group.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.26, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0xf0d5b8 }),
      );
      head.position.y = 1.6;
      group.add(head);
      // Facing indicator — reads clearly from the high-angle camera of PRD §14.
      const nose = new THREE.Mesh(
        new THREE.ConeGeometry(0.14, 0.4, 8),
        new THREE.MeshStandardMaterial({ color: 0x2b2f35 }),
      );
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, 1.15, 0.42);
      group.add(nose);
      group.name = `owner_${state.playerId}`;
      // STORY-012 §10 "Serving Tray": up to 3 small plates, hidden until `setCarrying` shows
      // as many as the owner is actually holding. Built once here, alongside the avatar, so
      // `setCarrying` (called at snapshot cadence from `GameClient`, not every render frame)
      // only ever toggles visibility rather than allocating geometry on the hot path.
      for (let i = 0; i < MAX_VISIBLE_CARRY_PLATES; i += 1) {
        const plate = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.16, 0.04, 16),
          new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.4 }),
        );
        plate.name = `plate_${i}`;
        plate.position.set(0.3, 1.35 + i * 0.12, 0);
        plate.visible = false;
        group.add(plate);
      }
      this.owners.set(state.playerId, group);
      this.scene.add(group);
    }
    group.position.set(state.position.x, state.position.y, state.position.z);
    group.rotation.y = state.facing;
  }

  /** STORY-012. Public: `carrying` already is (§8 §14, PlayerSnapshot). One small plate mesh
   * per carried order, up to `MAX_VISIBLE_CARRY_PLATES` — no upgrade currently raises capacity
   * past that, and a 4th plate would just be lost behind the other three at this scale anyway. */
  setCarrying(playerId: string, count: number): void {
    const group = this.owners.get(playerId);
    if (!group) return;
    for (let i = 0; i < MAX_VISIBLE_CARRY_PLATES; i += 1) {
      const plate = group.getObjectByName(`plate_${i}`);
      if (plate) plate.visible = i < count;
    }
  }

  /** STORY-012 "Faster Grill I": a hotter tint on the OWNER'S OWN grill mesh once purchased.
   * Ownership can change mid-match (unlike everything `buildAll()` builds once from static
   * layout JSON), so this is looked up by name rather than rebuilt — the one live per-entity
   * update path this file has; see the header comment on why it stays this narrow rather than
   * growing into a general visual-state system (that generalization is STORY-016's). */
  setStationUpgraded(station: string, upgraded: boolean): void {
    const mesh = this.scene.getObjectByName(`station_${station}`) as THREE.Mesh | undefined;
    if (!mesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.color.setHex(
      upgraded ? (STATION_COLORS_UPGRADED[station] ?? STATION_COLORS[station]) : (STATION_COLORS[station] ?? 0x808890),
    );
  }

  /** STORY-012 "Pantry Shelves": read as "more storage" with a taller box and a darker,
   * shelf-like tint rather than modeling actual shelf geometry — see `setStationUpgraded`'s
   * comment on scope. */
  setPantryUpgraded(upgraded: boolean): void {
    const mesh = this.scene.getObjectByName('pantry') as THREE.Mesh | undefined;
    if (!mesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.color.setHex(upgraded ? 0x6b4f30 : 0x9c7d55);
    mesh.scale.y = upgraded ? 1.3 : 1;
  }

  removeOwner(playerId: string): void {
    const group = this.owners.get(playerId);
    if (!group) return;
    this.scene.remove(group);
    this.owners.delete(playerId);
  }

  ownerIds(): string[] {
    return [...this.owners.keys()];
  }

  setDebugGrid(visible: boolean): void {
    this.grid.visible = visible;
  }

  setCompetitorVisible(visible: boolean): void {
    this.competitor.visible = visible;
  }

  setNight(night: boolean): void {
    this.ambient.intensity = night ? 0.28 : 0.75;
    this.keyLight.intensity = night ? 0.45 : 1.15;
    this.scene.background = new THREE.Color(night ? 0x0d1015 : 0x1b1f24);
  }

  dispose(): void {
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.owners.clear();
    this.scene.clear();
  }
}
