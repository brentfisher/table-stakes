// Owns the renderer and the animation loop. PRD §13: Three.js owns high-frequency scene
// rendering; React owns application UI. Nothing in here touches React state per frame.

import * as THREE from 'three';
import { RestaurantScene } from '../scenes/RestaurantScene';
import { ResultsScene } from '../scenes/ResultsScene';
import { CameraController } from './CameraController';

export class SceneManager {
  readonly restaurant: RestaurantScene;
  /** STORY-014. The results-phase backdrop — see ResultsScene.ts's own header. */
  readonly results: ResultsScene;
  readonly cameraController: CameraController;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly container: HTMLElement;
  private frame = 0;
  private lastFrameTime = 0;
  private resizeObserver: ResizeObserver | null = null;
  /** Which scene the render loop draws. Swapped by `setActiveScene` on the `results` phase
   * transition (see GameClient's own call site) — PRD §13's "Three.js owns the scene" applied
   * to a MATCH PHASE, not a per-frame reconciliation; this changes once per match, not per tick. */
  private active: THREE.Scene;

  onFrame: ((dt: number) => void) | null = null;

  constructor(container: HTMLElement, restaurant = new RestaurantScene(), results = new ResultsScene()) {
    this.container = container;
    this.restaurant = restaurant;
    this.results = results;
    this.active = this.restaurant.scene;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    this.cameraController = new CameraController(aspect);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
  }

  /** STORY-014. `'results'` renders the ResultsScene backdrop; every other phase renders the
   * live restaurant floor. Idempotent — GameClient calls this once per `match_snapshot`, not
   * gated on the phase actually having changed, which is fine: swapping a scene reference is
   * far cheaper than the branch to avoid it. */
  setActiveScene(phase: 'results' | 'other'): void {
    this.active = phase === 'results' ? this.results.scene : this.restaurant.scene;
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
      this.renderer.render(this.active, this.cameraController.camera);
    };
    this.frame = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.restaurant.dispose();
    this.results.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
