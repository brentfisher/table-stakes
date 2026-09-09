import * as THREE from 'three';

// Bug: the ready-up menu grid mounts one FoodModelPreview per dish card — up to 6 mains, 2
// extras, and 8 pantry-ingredient icons simultaneously (SetupScreen.tsx) — plus the always-on
// main game scene underneath (GameClient's SceneManager, mounted for the whole GameView
// lifetime, never unmounted just because SetupScreen overlays it). Each FoodModelPreview used
// to construct its OWN `THREE.WebGLRenderer`, so a single "choose your mains" screen could hold
// up to 10 simultaneous live WebGL contexts. Browsers cap the number of WebGL contexts a page
// may hold (Chrome ~16, but effectively lower under GPU memory pressure, and much lower on
// integrated/mobile GPUs); once that cap is hit the browser force-loses an existing context to
// make room, and this codebase never listens for `webglcontextlost`/`restored` anywhere, so
// whichever context got evicted — most often the main game's, since it was created first and
// sits hidden behind this very overlay — goes permanently blank with no recovery path. The
// player sees a frozen, unresponsive floor and a HUD that keeps ticking (it's WebSocket-driven,
// unaffected), which reads exactly as "can't move, screen's blank."
//
// Fix: every FoodModelPreview instance shares ONE WebGLRenderer (this module), registering its
// scene/camera/turntable instead of owning a context. The shared renderer round-robins through
// every registered entry once per animation frame, rendering each into one offscreen WebGL
// canvas and blitting the result onto that entry's own plain 2D `<canvas>` — so any number of
// simultaneous dish previews costs exactly one extra WebGL context, not one each.

export interface FoodPreviewEntry {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  turntable: THREE.Group;
  /** The visible element each `FoodModelPreview` owns. Read with a 2D context only — this
   * module owns the one WebGL context and blits into every entry's canvas via `drawImage`. */
  canvas: HTMLCanvasElement;
  reducedMotion: boolean;
}

class FoodPreviewRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly entries = new Map<symbol, FoodPreviewEntry>();
  private frame = 0;

  private ensureRenderer(): THREE.WebGLRenderer | null {
    if (this.renderer) return this.renderer;
    const canvas = document.createElement('canvas');
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      // No WebGL available at all — every FoodModelPreview falls back to its `data-failed`
      // placeholder (same UX a single instance's own construction failure used to produce).
      return null;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    this.renderer = renderer;
    return renderer;
  }

  /** Returns null if no WebGL context could be created — caller should show its own
   * `data-failed` fallback rather than treating a missing registration as a bug. */
  register(entry: FoodPreviewEntry): symbol | null {
    if (!this.ensureRenderer()) return null;
    const id = Symbol('food-preview-entry');
    this.entries.set(id, entry);
    if (this.frame === 0) this.frame = requestAnimationFrame(this.tick);
    return id;
  }

  unregister(id: symbol | null): void {
    if (id === null) return;
    this.entries.delete(id);
    if (this.entries.size > 0) return;
    // Nothing left to draw — tear the shared context down rather than holding a live WebGL
    // context for the lifetime of the page once the ready-up screen has been left.
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.renderer?.dispose();
    this.renderer = null;
  }

  private readonly tick = (time: number): void => {
    const renderer = this.renderer;
    if (!renderer) return;
    for (const entry of this.entries.values()) this.renderEntry(renderer, entry, time);
    if (this.entries.size > 0) this.frame = requestAnimationFrame(this.tick);
    else this.frame = 0;
  };

  private renderEntry(renderer: THREE.WebGLRenderer, entry: FoodPreviewEntry, time: number): void {
    const { scene, camera, turntable, canvas, reducedMotion } = entry;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const pixelRatio = renderer.getPixelRatio();
    const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
    const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!reducedMotion) turntable.rotation.y = time * 0.00022;
    renderer.render(scene, camera);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(renderer.domElement, 0, 0, pixelWidth, pixelHeight, 0, 0, canvas.width, canvas.height);
  }
}

export const foodPreviewRenderer = new FoodPreviewRenderer();
