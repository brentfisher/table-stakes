// Owns the renderer and the animation loop. PRD §13: Three.js owns high-frequency scene
// rendering; React owns application UI. Nothing in here touches React state per frame.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { configureRestaurantRenderer } from '../scenes/restaurant-rendering';
import { RestaurantScene } from '../scenes/RestaurantScene';
import { ResultsScene } from '../scenes/ResultsScene';
import { CameraController } from './CameraController';

export class SceneManager {
  readonly restaurant: RestaurantScene;
  /** STORY-014. The results-phase backdrop — see ResultsScene.ts's own header. */
  readonly results: ResultsScene;
  readonly cameraController: CameraController;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly container: HTMLElement;
  private frame = 0;
  private lastFrameTime = 0;
  private resizeObserver: ResizeObserver | null = null;
  /** Which scene the render loop draws. Swapped by `setActiveScene` on the `results` phase
   * transition (see GameClient's own call site) — PRD §13's "Three.js owns the scene" applied
   * to a MATCH PHASE, not a per-frame reconciliation; this changes once per match, not per tick. */
  private active: THREE.Scene;

  onFrame: ((dt: number) => void) | null = null;
  /**
   * Fired on `webglcontextlost`/`webglcontextrestored` — see this file's own comment on those
   * listeners below for why this codebase needs them at all. `GameClient` patches these into
   * `GameClientStatus` so the HUD can tell a player "reconnecting" instead of leaving a silent,
   * unresponsive-looking black canvas with no explanation.
   */
  onContextLost: (() => void) | null = null;
  onContextRestored: (() => void) | null = null;
  private readonly handleContextLost: (event: Event) => void;
  private readonly handleContextRestored: () => void;

  constructor(container: HTMLElement, restaurant = new RestaurantScene(), results = new ResultsScene()) {
    this.container = container;
    this.restaurant = restaurant;
    this.results = results;
    this.active = this.restaurant.scene;

    // STORY-059: native MSAA (`antialias: true`) and a full-resolution `UnrealBloomPass` were
    // running together every frame — largely wasted cost, since the bloom pass's own blur
    // already hides the AA seams it would otherwise smooth. Antialiasing now comes only from the
    // composer's `OutputPass` + the softness of the bloom pass itself; see the bloom pass
    // construction below for the matching resolution cut.
    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    configureRestaurantRenderer(this.renderer, this.restaurant.scene);
    // STORY-059: was capped at 2 — every rendering cost above (shadow map, bloom, base shading)
    // scales with shaded pixel count, so 2x devicePixelRatio is 4x the fragment work of 1x on a
    // Retina/HiDPI display. `food-preview-renderer.ts` already caps at 1.5 for this exact reason;
    // match that precedent here rather than inventing a new number.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    // A GPU driver reset, an OS putting the tab to sleep, or the browser simply reclaiming a
    // context under memory/GPU pressure over a long play session can all fire
    // `webglcontextlost` at any time — and by default that loss is PERMANENT: the spec requires
    // `event.preventDefault()` on this exact event before the browser will ever fire
    // `webglcontextrestored`, and this codebase previously listened for neither (see
    // `food-preview-renderer.ts`'s header for the first incident this caused, via a different
    // trigger — too many simultaneous WebGL contexts forcing the browser to evict one). Without
    // this listener, the canvas goes black and never comes back; a match that had been running
    // fine for a while, especially once `final_rush`'s extra customers/particles/effects push
    // GPU load higher, is exactly when a starved context is most likely to get reclaimed.
    this.handleContextLost = (event) => {
      event.preventDefault();
      console.warn('[SceneManager] WebGL context lost — waiting for the browser to restore it.');
      this.onContextLost?.();
    };
    this.handleContextRestored = () => {
      // Three.js's own WebGLRenderer re-uploads textures/geometries/shaders for everything
      // still referenced in the scene graph the first time each is rendered again — no manual
      // re-initialization needed here, unlike a raw WebGL app.
      console.info('[SceneManager] WebGL context restored.');
      this.onContextRestored?.();
    };
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored);

    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    this.cameraController = new CameraController(aspect);
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.active, this.cameraController.camera);
    // A restrained threshold keeps practical lights and authored Glow materials luminous while
    // leaving UI sprites and most matte surfaces crisp. The pass is intentionally subtle so the
    // scene gains the warm AAA catchlight from the reference without becoming hazy.
    // STORY-059: `UnrealBloomPass` already halves whatever resolution it's given for its own
    // internal mip chain (see its constructor), so passing the full container size here meant
    // the blur chain's brightest render target was already running at half-container. Passing
    // HALF the container size instead drops that internal target to a quarter of the container's
    // area — ~4x less shader work for the whole 5-mip blur/composite chain — and the effect stays
    // visually identical because bloom is a soft, low-frequency effect by nature: the extra
    // downsample is invisible once blurred back up. `strength`/`radius`/`threshold`
    // (0.28/0.48/0.84) are UNCHANGED — those control the look, this only cuts cost.
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth / 2, container.clientHeight / 2),
      0.28,
      0.48,
      0.84,
    );
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
  }

  /** STORY-014. `'results'` renders the ResultsScene backdrop; every other phase renders the
   * live restaurant floor. Idempotent — GameClient calls this once per `match_snapshot`, not
   * gated on the phase actually having changed, which is fine: swapping a scene reference is
   * far cheaper than the branch to avoid it. */
  setActiveScene(phase: 'results' | 'other'): void {
    this.active = phase === 'results' ? this.results.scene : this.restaurant.scene;
    this.renderPass.scene = this.active;
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    // STORY-059: `EffectComposer.setSize` just reset every pass — including `bloomPass` — to the
    // FULL container resolution (it calls `pass.setSize(width, height)` uniformly for all
    // passes). Re-apply the halved resolution chosen at construction time so a window resize
    // doesn't silently undo the bloom cost cut.
    this.bloomPass.setSize(width / 2, height / 2);
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
      this.composer.render();
    };
    this.frame = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.restaurant.dispose();
    this.results.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
