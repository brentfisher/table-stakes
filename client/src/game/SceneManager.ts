// Owns the renderer and the animation loop. PRD §13: Three.js owns high-frequency scene
// rendering; React owns application UI. Nothing in here touches React state per frame.

import * as THREE from 'three';
import { RestaurantScene } from '../scenes/RestaurantScene';
import { CameraController } from './CameraController';

export class SceneManager {
  readonly restaurant: RestaurantScene;
  readonly cameraController: CameraController;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly container: HTMLElement;
  private frame = 0;
  private lastFrameTime = 0;
  private resizeObserver: ResizeObserver | null = null;

  onFrame: ((dt: number) => void) | null = null;

  constructor(container: HTMLElement, restaurant = new RestaurantScene()) {
    this.container = container;
    this.restaurant = restaurant;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    this.cameraController = new CameraController(aspect);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height);
    this.cameraController.setAspect(width / height);
  }

  start(): void {
    this.lastFrameTime = performance.now();
    const loop = (now: number) => {
      this.frame = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.lastFrameTime) / 1000);
      this.lastFrameTime = now;
      this.onFrame?.(dt);
      this.cameraController.update(dt);
      this.renderer.render(this.restaurant.scene, this.cameraController.camera);
    };
    this.frame = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.restaurant.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
