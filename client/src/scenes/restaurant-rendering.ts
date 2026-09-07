import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Shared by the actual game and every harness: copper and steel need an environment to
 * reflect, and contact shadows keep furniture and moving avatars anchored to the floor. */
export function configureRestaurantRenderer(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const generator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = generator.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.45;
  // The render target owns the texture; RestaurantScene disposes it with its scene.
  scene.userData.disposeEnvironment = () => environment.dispose();
  room.dispose();
  generator.dispose();
}
