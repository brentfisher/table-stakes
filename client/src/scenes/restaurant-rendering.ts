import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Shared by the actual game and every harness: copper and steel need an environment to
 * reflect, and contact shadows keep furniture and moving avatars anchored to the floor. */
export function configureRestaurantRenderer(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // STORY-059: nudged down from 1.05 — a small overall darkening pass to go with the
  // ambient/hemisphere cut in `RestaurantScene.ts`'s constructor, so the practical point lights
  // and bloom read with more contrast against the base scene.
  renderer.toneMappingExposure = 0.97;
  const generator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = generator.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.6;
  // The render target owns the texture; RestaurantScene disposes it with its scene.
  scene.userData.disposeEnvironment = () => environment.dispose();
  room.dispose();
  generator.dispose();
}
