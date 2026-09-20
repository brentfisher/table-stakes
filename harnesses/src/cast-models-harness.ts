// STORY-063/064/065/066. A lineup of every rigged character in the game, so the cast can be
// inspected without spawning a match and driving the real entities into view.
//
// The existing Asset Showcase harness already reaches the cast through production code paths
// (`upsertOwner`/`upsertWorker`/`upsertCustomer`), which is the right place to check that the
// WIRING works. It is a poor place to check that the MODELS do: its characters stand where the
// restaurant's own layout puts them, so a worker ends up behind the pantry counter and a diner is
// hidden under a tabletop, and its camera is the gameplay camera, at which a 1.45 m character is
// ~80 px tall. This harness exists for the opposite job — an unobstructed, close, turntable view
// of each model and each of its clips.
//
// It owns its own renderer and animation loop rather than reusing `SceneManager`, for the same
// reason `neon-sign-harness.ts` does: none of `RestaurantScene`'s lighting, bloom, shadow or
// camera-follow behaviour is under test here, and going through it would mean fighting all of it.
// The one thing that IS shared is `buildRiggedCharacter` — the actual production loader — so what
// is on screen is loaded exactly the way the game loads it.

import * as THREE from 'three';
import {
  buildRiggedCharacter,
  type RiggedCharacterInstance,
  type RiggedCharacterSpec,
} from '../../client/src/scenes/RiggedCharacterModel';
import { SEATED_DINER_MODEL, WORKER_ROLE_MODELS } from '../../client/src/scenes/CastModels';
import { DevControls } from './shared/dev-controls';
import type { SceneHarness } from './harness-shell';

interface CastEntry {
  readonly id: string;
  readonly label: string;
  readonly spec: RiggedCharacterSpec;
  /** What this character stands in for in the real scene, and how tall it is there. */
  readonly role: string;
}

const CHEF_BLAZE_SPEC: RiggedCharacterSpec = {
  url: new URL('../../assets/chef-blaze/ChefBlaze.glb', import.meta.url).href,
  idleClip: 'ChefBlaze_Idle',
  walkClip: 'ChefBlaze_Walk_InPlace',
};

const CAST: CastEntry[] = [
  { id: 'chef', label: 'Chef Blaze', spec: CHEF_BLAZE_SPEC, role: "player's own owner avatar — 1.86 m" },
  { id: 'monsieur', label: 'Monsieur', spec: WORKER_ROLE_MODELS.host, role: 'host worker — 1.45 m' },
  { id: 'vivienne', label: 'Vivienne', spec: WORKER_ROLE_MODELS.server, role: 'server worker — 1.45 m' },
  { id: 'aurelia', label: 'Aurelia', spec: SEATED_DINER_MODEL, role: 'seated diner — 0.99 m, no walk clip' },
];

/** Spacing between characters. Wide enough that Aurelia's forward-flexed legs do not reach into
 * Vivienne's stand. */
const SPACING = 1.3;

export const castModelsHarness: SceneHarness = (() => {
  let renderer: THREE.WebGLRenderer | null = null;
  let disposed = false;
  const instances: RiggedCharacterInstance[] = [];

  return {
    id: 'cast-models',
    title: 'Cast Models',
    description:
      'Turntable lineup of every rigged character, loaded through the production loader. Idle/walk clips, ground grid and per-character notes.',

    mount(container: HTMLElement): void {
      disposed = false;
      const viewport = document.createElement('div');
      viewport.className = 'harness-viewport';
      const panel = new DevControls('Cast model controls');
      container.append(viewport, panel.element);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x11141b);

      const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
      const localRenderer = new THREE.WebGLRenderer({ antialias: true });
      localRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      localRenderer.shadowMap.enabled = true;
      localRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
      viewport.appendChild(localRenderer.domElement);
      renderer = localRenderer;

      scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x35302c, 1.5));
      const key = new THREE.DirectionalLight(0xfff4e2, 2.4);
      key.position.set(2.6, 4.2, 3.4);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.near = 0.5;
      key.shadow.camera.far = 20;
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x9fc4ff, 0.8);
      rim.position.set(-3.0, 2.2, -3.4);
      scene.add(rim);

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(24, 24),
        new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.95 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);
      const grid = new THREE.GridHelper(24, 48, 0x4a5366, 0x333a47);
      grid.position.y = 0.002;
      scene.add(grid);

      // One pivot per character so the turntable can spin each in place. The model root is added
      // as a child at the origin — the GLBs already put their feet at y=0 and are scaled to
      // metres, so nothing here adjusts their transform (that is the point of the runtime
      // contract in assets/cast/README_ThreeJS.md).
      const pivots = new Map<string, THREE.Group>();
      CAST.forEach((entry, index) => {
        const pivot = new THREE.Group();
        pivot.position.x = (index - (CAST.length - 1) / 2) * SPACING;
        scene.add(pivot);
        pivots.set(entry.id, pivot);
      });

      const status = panel.addDiagnostics('Cast');
      const lines = CAST.map((c) => `${c.label}: loading…`);
      status(lines);

      let moving = false;
      let spin = 0.35;
      let showGrid = true;
      let camHeight = 1.2;
      let camDistance = 4.6;

      CAST.forEach((entry, index) => {
        void buildRiggedCharacter(entry.spec)
          .then((instance) => {
            if (disposed) {
              instance.dispose();
              return;
            }
            pivots.get(entry.id)?.add(instance.root);
            instances.push(instance);
            const clips = entry.spec.walkClip
              ? `${entry.spec.idleClip}, ${entry.spec.walkClip}`
              : `${entry.spec.idleClip} (no walk)`;
            lines[index] = `${entry.label} — ${entry.role} · ${clips}`;
            status(lines);
          })
          .catch((error: unknown) => {
            lines[index] = `${entry.label} — FAILED: ${String(error)}`;
            status(lines);
          });
      });

      panel.addToggle('Walking (idle ⇄ walk)', false, (value) => { moving = value; });
      panel.addSlider('Turntable speed', { min: 0, max: 1.5, step: 0.05, value: spin }, (v) => { spin = v; });
      panel.addSlider('Camera height', { min: 0.2, max: 4, step: 0.05, value: 1.2 }, (v) => { camHeight = v; });
      panel.addSlider('Camera distance', { min: 1.5, max: 12, step: 0.1, value: 4.6 }, (v) => { camDistance = v; });
      panel.addToggle('Ground grid', true, (value) => { showGrid = value; grid.visible = value; });
      panel.addSeparator();
      panel.addButton('Reset turntable', () => {
        for (const pivot of pivots.values()) pivot.rotation.y = 0;
      });

      grid.visible = showGrid;

      const clock = new THREE.Clock();
      localRenderer.setAnimationLoop(() => {
        const width = viewport.clientWidth || 1;
        const height = viewport.clientHeight || 1;
        if (localRenderer.domElement.width !== width || localRenderer.domElement.height !== height) {
          localRenderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        }
        const dt = Math.min(clock.getDelta(), 0.1);
        for (const pivot of pivots.values()) pivot.rotation.y += dt * spin;
        // `moving` is passed to every instance, including Aurelia's. Her spec has no walk clip, so
        // the loader ignores the flag — this is the documented behaviour, not an oversight here.
        for (const instance of instances) instance.update(dt, moving);
        camera.position.set(0, camHeight, camDistance);
        camera.lookAt(0, camHeight * 0.62, 0);
        localRenderer.render(scene, camera);
      });
    },

    dispose(): void {
      disposed = true;
      for (const instance of instances) instance.dispose();
      instances.length = 0;
      renderer?.setAnimationLoop(null);
      renderer?.dispose();
      renderer = null;
    },
  };
})();
