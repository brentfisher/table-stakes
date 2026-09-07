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

// Framed around the actual restaurant rather than the surrounding street. The owner can still
// see the whole dining room and kitchen, while dishes, customers, and task labels read without
// needing an overview toggle.
export const DEFAULT_CAMERA: CameraSettings = {
  height: 19,
  distance: 17,
  angle: Math.PI - 0.28,
  fov: 40,
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
    this.applySettings();
  }

  /** Soft follow — the camera lags the owner so the frame does not jitter with input. */
  update(dt: number): void {
    this.smoothed.lerp(this.target, Math.min(1, dt * 3.2));
    this.applySettings();
  }

  private applySettings(): void {
    const { height, distance, angle, fov } = this.settings;
    // Preserve the floor's horizontal coverage on narrow windows too.
    this.camera.fov = this.camera.aspect < 1.25
      ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * 1.25 / this.camera.aspect))
      : fov;
    this.camera.position.set(
      this.smoothed.x + Math.sin(angle) * distance,
      height,
      this.smoothed.z + Math.cos(angle) * distance,
    );
    this.camera.lookAt(this.smoothed.x, 0, this.smoothed.z);
    this.camera.updateProjectionMatrix();
  }
}
