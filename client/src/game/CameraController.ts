// PRD §14 "Camera": a high-angle third-person/isometric camera that follows the owner with
// soft bounds. Rotation is deliberately limited in the initial version to preserve
// readability — a free camera looks impressive and makes restaurant state hard to read.

import * as THREE from 'three';

export interface CameraSettings {
  height: number;
  distance: number;
  angle: number; // radians, around Y
  fov: number;
}

// Framed so the whole PRD §14 footprint — street/entry through to the pantry and
// dishwashing at the back of house — is visible at once. Readability of queues, tables,
// stations and staff from one view is the §4.4 requirement the camera exists to satisfy.
export const DEFAULT_CAMERA: CameraSettings = {
  height: 24,
  distance: 21,
  angle: 0,
  fov: 46,
};

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  private settings: CameraSettings = { ...DEFAULT_CAMERA };
  private readonly target = new THREE.Vector3(0, 0, -2);
  private readonly smoothed = new THREE.Vector3(0, 0, -2);

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, aspect, 0.1, 400);
    this.applySettings();
  }

  setSettings(partial: Partial<CameraSettings>): void {
    this.settings = { ...this.settings, ...partial };
    this.applySettings();
  }

  getSettings(): CameraSettings {
    return { ...this.settings };
  }

  setTarget(x: number, z: number): void {
    this.target.set(x, 0, z);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Soft follow — the camera lags the owner so the frame does not jitter with input. */
  update(dt: number): void {
    this.smoothed.lerp(this.target, Math.min(1, dt * 3.2));
    this.applySettings();
  }

  private applySettings(): void {
    const { height, distance, angle, fov } = this.settings;
    this.camera.fov = fov;
    this.camera.position.set(
      this.smoothed.x + Math.sin(angle) * distance,
      height,
      this.smoothed.z + Math.cos(angle) * distance,
    );
    this.camera.lookAt(this.smoothed.x, 0, this.smoothed.z);
    this.camera.updateProjectionMatrix();
  }
}
