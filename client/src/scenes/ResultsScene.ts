// The results-phase backdrop, PRD §13/§15's "Three.js owns the scene, React owns UI" split
// applied to the results screen: this file draws the calm, dimmed stage the results camera sits
// in front of; every NUMBER on that stage (score, revenue, the narrative sentences) is React's
// job in `client/src/ui/ResultsPanel.tsx`, reading `match_complete` verbatim. This scene reads
// NOTHING off the match — it has no props, no update method that takes match state, and never
// will: PRD §11's "nothing on this screen is recomputed client-side" would be trivially violated
// by a bar or podium sized from a raw score number, so this deliberately draws only static
// ambience, the same restraint RestaurantScene.ts's own zone/station meshes apply to STRUCTURE
// (never to a live number).
//
// Same shape as RestaurantScene.ts (a `scene` property, a `dispose()`), so `SceneManager` can
// hold one instance of each and switch which one it renders — see `SceneManager#setActiveScene`.

import * as THREE from 'three';

const STAGE_COLOR = 0x11151a;
const FLOOR_COLOR = 0x232a33;
const ACCENT_COLOR = 0x7fd4ff;

export class ResultsScene {
  readonly scene = new THREE.Scene();

  private readonly ambient: THREE.AmbientLight;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly floor: THREE.Mesh;
  private readonly podiumA: THREE.Mesh;
  private readonly podiumB: THREE.Mesh;

  constructor() {
    this.scene.background = new THREE.Color(STAGE_COLOR);
    this.scene.fog = new THREE.Fog(STAGE_COLOR, 12, 30);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(this.ambient);

    // A single soft key light, angled low — a "curtain call" read rather than the flat,
    // functional lighting `RestaurantScene`'s service-floor lighting needs.
    this.keyLight = new THREE.DirectionalLight(ACCENT_COLOR, 0.9);
    this.keyLight.position.set(-4, 9, 6);
    this.scene.add(this.keyLight);

    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 48),
      new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 0.85 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.scene.add(this.floor);

    // Two fixed-height podium blocks — a stage, not a chart. Their size is a constant, not the
    // score: see this file's own header comment on why no dimension here is ever match-derived.
    this.podiumA = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.2, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x2f3946 }),
    );
    this.podiumA.position.set(-2.6, 0.6, 0);
    this.scene.add(this.podiumA);

    this.podiumB = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.2, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x2f3946 }),
    );
    this.podiumB.position.set(2.6, 0.6, 0);
    this.scene.add(this.podiumB);
  }

  dispose(): void {
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.scene.clear();
  }
}
