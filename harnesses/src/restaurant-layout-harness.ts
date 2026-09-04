// PRD §15.1 Restaurant layout harness.
//
// Purpose: test the restaurant footprint, camera framing, object placement, navigation
// space, and line-of-sight readability.
//
// Controls required by §15.1: toggle kitchen/dining layouts, toggle day/night lighting,
// toggle competitor visibility, enable a debug grid, spawn owner and staff, adjust camera
// height/angle/zoom, and test blocked path locations.

import * as THREE from 'three';
import type { SceneHarness } from './harness-shell';
import { RestaurantScene, CameraController, DEFAULT_CAMERA } from './shared/scene-primitives';
import { DevControls } from './shared/dev-controls';
import { mockOwner, orbitOwner, mockShortageVsQueueDemo } from './shared/test-entities';

export const restaurantLayoutHarness: SceneHarness = createRestaurantLayoutHarness();

function createRestaurantLayoutHarness(): SceneHarness {
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: RestaurantScene | null = null;
  let camera: CameraController | null = null;
  let frame = 0;
  let observer: ResizeObserver | null = null;
  let blockers: THREE.Group | null = null;
  let staff: THREE.Group | null = null;

  return {
    id: 'restaurant-layout',
    title: 'Restaurant Layout',
    description:
      'Footprint, camera framing, object placement, navigation space and readability. ' +
      'PRD §15.1.',

    mount(container: HTMLElement): void {
      const viewport = document.createElement('div');
      viewport.className = 'harness-viewport';
      const panel = new DevControls('Layout controls');
      container.append(viewport, panel.element);

      scene = new RestaurantScene({ showDebugGrid: true, showCompetitor: true });
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(viewport.clientWidth, Math.max(1, viewport.clientHeight));
      viewport.appendChild(renderer.domElement);

      camera = new CameraController(viewport.clientWidth / Math.max(1, viewport.clientHeight));

      const owner = mockOwner('harness_owner', 0, -3, 0, true);
      scene.upsertOwner(owner);

      // Staff stand-ins: one cook at the grill, one server at the pass (PRD §7 MVP roster).
      staff = new THREE.Group();
      staff.visible = false;
      for (const [x, z, color] of [
        [-2, 3.4, 0x4a90d9],
        [0, 0.6, 0xd94a8c],
      ] as const) {
        const worker = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.3, 0.7, 6, 12),
          new THREE.MeshStandardMaterial({ color }),
        );
        worker.position.set(x, 0.8, z);
        staff.add(worker);
      }
      scene.scene.add(staff);

      // Blocked-path probes (§15.1 "Test blocked path locations").
      blockers = new THREE.Group();
      blockers.visible = false;
      for (const [x, z] of [[-4, 1.6], [4, 1.6], [0, -7]] as const) {
        const probe = new THREE.Mesh(
          new THREE.BoxGeometry(1.2, 2, 1.2),
          new THREE.MeshStandardMaterial({ color: 0xc75f5f, transparent: true, opacity: 0.55 }),
        );
        probe.position.set(x, 1, z);
        blockers.add(probe);
      }
      scene.scene.add(blockers);

      const kitchen = scene.scene.getObjectByName('zone_kitchen');
      const dining = scene.scene.getObjectByName('zone_dining');

      panel.addToggle('Debug grid', true, (v) => scene?.setDebugGrid(v));
      panel.addToggle('Competitor visible', true, (v) => scene?.setCompetitorVisible(v));
      panel.addToggle('Night lighting', false, (v) => scene?.setNight(v));
      panel.addToggle('Kitchen zone', true, (v) => { if (kitchen) kitchen.visible = v; });
      panel.addToggle('Dining zone', true, (v) => { if (dining) dining.visible = v; });
      panel.addToggle('Spawn staff', false, (v) => { if (staff) staff.visible = v; });
      panel.addToggle('Blocked path probes', false, (v) => { if (blockers) blockers.visible = v; });

      // STORY-016 PRD §8 "distinct signals for each" bottleneck — see
      // `mockShortageVsQueueDemo`'s own header on why a harness fixture, not a live match, is
      // the right instrument for this specific comparison.
      panel.addToggle('Shortage vs queue demo (prep backlog, grill shortage)', false, (v) => {
        if (!scene) return;
        const demo = mockShortageVsQueueDemo('harness_owner');
        scene.updateFloorState({
          selfRestaurantId: 'harness_owner',
          restaurants: v ? demo.restaurants : [],
          customers: [],
          orders: v ? demo.orders : [],
          events: [],
        });
      });

      let orbiting = false;
      panel.addToggle('Owner walks a circle', false, (v) => { orbiting = v; });

      panel.addSlider('Camera height', { min: 6, max: 34, step: 0.5, value: DEFAULT_CAMERA.height },
        (v) => camera?.setSettings({ height: v }));
      panel.addSlider('Camera distance', { min: 4, max: 34, step: 0.5, value: DEFAULT_CAMERA.distance },
        (v) => camera?.setSettings({ distance: v }));
      panel.addSlider('Camera angle', { min: -Math.PI, max: Math.PI, step: 0.02, value: DEFAULT_CAMERA.angle },
        (v) => camera?.setSettings({ angle: v }));
      panel.addSlider('Field of view', { min: 20, max: 80, step: 1, value: DEFAULT_CAMERA.fov },
        (v) => camera?.setSettings({ fov: v }));
      panel.addButton('Reset camera', () => camera?.setSettings({ ...DEFAULT_CAMERA }));

      const fpsReadout = panel.addReadout('FPS');

      const resize = () => {
        const w = viewport.clientWidth;
        const h = Math.max(1, viewport.clientHeight);
        renderer?.setSize(w, h);
        camera?.setAspect(w / h);
      };
      observer = new ResizeObserver(resize);
      observer.observe(viewport);

      const started = performance.now();
      let last = started;
      let fpsAccum = 0;
      let fpsFrames = 0;

      const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;

        fpsAccum += dt;
        fpsFrames += 1;
        if (fpsAccum >= 0.5) {
          fpsReadout((fpsFrames / fpsAccum).toFixed(0));
          fpsAccum = 0;
          fpsFrames = 0;
        }

        if (scene && camera) {
          const state = orbiting ? orbitOwner(owner, (now - started) / 1000) : owner;
          scene.upsertOwner(state);
          // Frame the restaurant, not the owner: this harness exists to judge the whole
          // footprint (§15.1). Follow the owner only while the walk toggle is on.
          if (orbiting) camera.setTarget(state.position.x, state.position.z);
          else camera.setTarget(0, -1);
          camera.update(dt);
          renderer?.render(scene.scene, camera.camera);
        }
      };
      frame = requestAnimationFrame(loop);
    },

    dispose(): void {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      observer = null;
      scene?.dispose();
      scene = null;
      renderer?.dispose();
      renderer = null;
      camera = null;
      blockers = null;
      staff = null;
    },
  };
}
