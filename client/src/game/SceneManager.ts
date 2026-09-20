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

    // STORY-059: `antialias: true` on the base renderer was pure wasted cost, not a real
    // trade-off — this whole scene ALWAYS renders through `EffectComposer` below (`start()`
    // calls `composer.render()`, never `renderer.render()` directly), and `EffectComposer`'s own
    // render targets are plain `WebGLRenderTarget`s created with no multisample `samples` option
    // (see its constructor: `new WebGLRenderTarget(width, height, { type: HalfFloatType })`).
    // `RenderPass` draws the scene into that non-multisampled target, so the canvas's own MSAA
    // (what `antialias: true` buys) was never actually applied to the composited output in the
    // first place — this flag was silently inert the whole time. Turning it off is a free win,
    // not a quality trade.
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
    // `EffectComposer` sizes its own render targets as `cssWidth * pixelRatio` and — unlike
    // `WebGLRenderer.setSize`, which floors — does NOT round that product to whole pixels. So
    // STORY-059's non-integer `min(devicePixelRatio, 1.5)` cap left the composer a HALF PIXEL
    // wider than the canvas it composites into on any `devicePixelRatio >= 1.5` display: at a
    // 1667px-wide viewport the canvas drawing buffer is `floor(1667 * 1.5)` = 2500, while every
    // composer target carried 2500.5. Confirmed live with a `gl.viewport` trace, which showed
    // `0,0,2500.5,693` for the composer's targets against `0,0,2500,693` for the final
    // to-screen pass. WebGL truncates the fractional size when it actually allocates the texture,
    // so the two agreed by luck rather than by construction — a latent unit mismatch, with no
    // observed rendering symptom, that any later math reading `renderTarget.viewport` inherits.
    //
    // Fix: take pixel-ratio scaling away from the composer entirely and size it in DEVICE pixels
    // straight off the canvas, which `WebGLRenderer.setSize` has already floored. The composer's
    // targets are then exactly the canvas's drawing buffer by definition, on every display and at
    // every viewport width. `handleResize` keeps the same basis.
    this.composer.setPixelRatio(1);
    this.composer.setSize(this.renderer.domElement.width, this.renderer.domElement.height);
    this.renderPass = new RenderPass(this.active, this.cameraController.camera);
    // A restrained threshold keeps practical lights and authored Glow materials luminous while
    // leaving UI sprites and most matte surfaces crisp. The pass is intentionally subtle so the
    // scene gains the warm AAA catchlight from the reference without becoming hazy.
    // STORY-059: whatever `resolution` this is constructed with barely mattered pre-fix — see
    // the comment right after `addPass` below on why `EffectComposer` immediately overrides it
    // to its own FULL effective (pixelRatio-scaled) resolution regardless of what's passed here.
    // The actual cost cut is in that later `bloomPass.setSize(...)` call: it deliberately passes
    // HALF of `EffectComposer`'s effective resolution instead of the full amount `addPass` would
    // otherwise leave in place. `UnrealBloomPass.setSize` then halves THAT again for its own
    // internal 5-mip render-target chain (`resx = Math.round(width / 2)`), so the net effect is a
    // real, if devicePixelRatio-dependent, reduction in the internal render targets' area versus
    // the FULL effective resolution the old code was actually running at — not the "already
    // half-size" a bare reading of the pre-story constructor argument would suggest (that halving
    // never survived `addPass`). Stays visually identical either way because bloom is a soft,
    // low-frequency effect by nature: the extra downsample is invisible once blurred back up.
    // `strength`/`radius`/`threshold` (0.28/0.48/0.84) are UNCHANGED — those control the look,
    // this and the devicePixelRatio cap below are the only pure cost cuts.
    // Read off the canvas's own (already-floored) drawing buffer rather than recomputing
    // `cssSize * pixelRatio`, for the same whole-pixel reason as the `composer.setSize` call
    // above — and so this and the composer stay in ONE basis instead of two that agree by
    // arithmetic coincidence. Numerically all but identical to what it replaces (2500/2 = 1250
    // against 2500.5/2 = 1250.25 at a 1667px viewport), so the bloom cost cut is unchanged.
    const bloomResolution = new THREE.Vector2(
      this.renderer.domElement.width / 2,
      this.renderer.domElement.height / 2,
    );
    this.bloomPass = new UnrealBloomPass(bloomResolution, 0.28, 0.48, 0.84);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    // `EffectComposer.addPass` immediately calls `pass.setSize(effectiveWidth, effectiveHeight)`
    // on whatever's just been added — using the composer's FULL effective resolution, which
    // would silently override the halved size passed to the constructor above the moment
    // `addPass(this.bloomPass)` ran, before this class's own `ResizeObserver` ever fires. Re-set
    // it explicitly right here so the cost cut is in effect from the very first rendered frame,
    // not only after whatever async timing the initial resize observation happens to land on.
    this.bloomPass.setSize(bloomResolution.x, bloomResolution.y);

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
    // Device pixels, off the canvas `setSize` just floored — the composer runs at
    // `pixelRatio` 1 and does its own scaling nowhere, so CSS pixels here would silently
    // shrink every render target to 1/pixelRatio of the canvas. See the constructor's own
    // comment on `composer.setPixelRatio(1)` for why the composer is in this basis at all.
    const bufferWidth = this.renderer.domElement.width;
    const bufferHeight = this.renderer.domElement.height;
    this.composer.setSize(bufferWidth, bufferHeight);
    // STORY-059: `EffectComposer.setSize` internally resizes every pass, `bloomPass` included,
    // to whatever it was just given — so re-apply the halved resolution afterwards, in that same
    // device-pixel basis, or a window resize silently undoes the bloom cost saving.
    this.bloomPass.setSize(bufferWidth / 2, bufferHeight / 2);
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
