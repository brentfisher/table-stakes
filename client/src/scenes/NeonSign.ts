// The "TABLE / STAKES" neon marquee shown above the main menu (STORY-032). Ported from a
// standalone prototype (`docs/table-stakes-neon-menu.zip`, five design revisions deep — colors,
// stroke widths and the flourish geometry below are already-tuned output from that process, not
// values to re-derive) into this repo's TypeScript/Three.js conventions: CDN-pinned `three` +
// `three/addons/postprocessing/*` (see `shared/build/three-cdn-external.ts`), no bundled runtime.
//
// Self-contained on purpose: owns its own renderer, scene, camera, bloom compositor and a pooled
// particle system, and drives its own `requestAnimationFrame` loop via
// `renderer.setAnimationLoop`. `NeonSignHero.tsx` is the only consumer today (the main menu
// hero), but nothing here assumes React — `mount(container)`/`dispose()` is the same shape a
// harness or any other host can use directly (see `harnesses/src/neon-sign-harness.ts`).
//
// Never instantiate more than one WebGLRenderer per visible sign — see `food-preview-renderer.ts`
// for why a shared/pooled renderer matters once there is ever a SECOND sign on screen at once;
// today there is exactly one, so a dedicated renderer here is fine.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** One glyph's outline, traced from the source lettering as SVG-style path commands — the
 * subset `buildTitle` below actually interprets (move/line/quadratic/cubic/close). */
type GlyphCommand = ['M' | 'L' | 'Q' | 'C' | 'Z', ...number[]];

interface WordmarkWord {
  text: string;
  /** [minX, minY, width, height] in the source trace's own coordinate space — `buildTitle`
   * normalizes every glyph against this so "Table" and "STAKES" sit on their authored baseline
   * and relative scale rather than each being independently centered. */
  bounds: [number, number, number, number];
  sourceFace: string;
  glyphs: GlyphCommand[][];
}

interface WordmarkData {
  description: string;
  words: WordmarkWord[];
}

const DEFAULT_WORDMARKS_URL = new URL('../../../assets/menu-sign/title-wordmarks.json', import.meta.url).href;

const SPARK_COLORS = [0xffb34f, 0x5ce5ed, 0xff719c, 0xffe4a0, 0xb59aff];
const nextSparkDelay = () => 3 + Math.random() * 2;

export interface NeonSignOptions {
  wordmarksUrl?: string;
  reducedMotion?: boolean;
  sparks?: boolean;
  /** UnrealBloomPass strength. The prototype's revision history settled on 0.6 as the default
   * after several passes (0.8 read as overexposed, 0.5 as flat) — see this file's own header. */
  bloom?: number;
}

interface Particle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  total: number;
}

/** Self-contained sign scene: extruded lettering, neon tube outlines, brick backing, warm
 * marquee bulbs, bloom postprocessing, and a pooled sparkler particle system emitted from points
 * sampled off the actual letter contours. No DOM menu markup or game-state dependency. */
export class NeonRestaurantSign {
  readonly pointer = new THREE.Vector2();
  readonly ready: Promise<void>;

  private readonly options: Required<Pick<NeonSignOptions, 'reducedMotion' | 'sparks' | 'bloom'>>;
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly root: THREE.Group;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly resizeObserver: ResizeObserver;
  private readonly warmBulbGlow: THREE.PointLight;

  /** Points sampled off the actual rendered letter contours — `spark()` picks a random one as a
   * burst origin, so sparks always read as coming FROM the sign rather than a fixed emitter. */
  private readonly emitters: THREE.Vector3[] = [];

  // Particle pool: fixed-size, reused forever (never allocated per-spark) — see `spark()`.
  private readonly poolSize = 320;
  private readonly particles: Particle[];
  private readonly positions: Float32Array;
  private readonly sparkColors: Float32Array;
  private readonly ages: Float32Array;
  private readonly sizes: Float32Array;
  private readonly trailPositions: Float32Array;
  private readonly trailColors: Float32Array;
  private points!: THREE.Points;
  private trails!: THREE.LineSegments;
  private cursor = 0;

  private time = 0;
  private nextBurst: number;
  private lastFrameMs = 0;
  private disposed = false;

  // Shared neon materials, built once in `buildFacade`/`buildTitle` and referenced by name below
  // rather than re-created per mesh.
  private neonCream!: THREE.MeshBasicMaterial;
  private neonCyan!: THREE.MeshBasicMaterial;
  private neonPink!: THREE.MeshBasicMaterial;
  private neonScriptCore!: THREE.MeshBasicMaterial;
  private neonStakes!: THREE.MeshBasicMaterial;
  private neonRedPink!: THREE.MeshBasicMaterial;

  constructor(container: HTMLElement, options: NeonSignOptions = {}) {
    this.container = container;
    this.options = {
      reducedMotion: options.reducedMotion ?? false,
      sparks: options.sparks ?? true,
      bloom: options.bloom ?? 0.6,
    };
    this.nextBurst = nextSparkDelay();

    this.particles = Array.from({ length: this.poolSize }, () => ({
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      life: 0,
      total: 1,
    }));
    this.positions = new Float32Array(this.poolSize * 3);
    this.sparkColors = new Float32Array(this.poolSize * 3);
    this.ages = new Float32Array(this.poolSize);
    this.sizes = new Float32Array(this.poolSize);
    this.trailPositions = new Float32Array(this.poolSize * 6);
    this.trailColors = new Float32Array(this.poolSize * 6);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.setClearColor(0x0c151c, 0);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0.2, 0.4, 18.4);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0x90b9c8, 0x1a1210, 1.1));

    this.warmBulbGlow = new THREE.PointLight(0xff852f, 65, 15, 2);
    this.warmBulbGlow.position.set(-2, 1, 2);
    this.scene.add(this.warmBulbGlow);
    const coolFill = new THREE.PointLight(0x37dce9, 45, 14, 2);
    coolFill.position.set(3, -2, 2);
    this.scene.add(coolFill);

    this.root = new THREE.Group();
    this.root.rotation.y = -0.045;
    this.scene.add(this.root);

    this.buildFacade();
    this.buildParticles();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(800, 600), this.options.bloom, 0.42, 1.05);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.renderer.setAnimationLoop((now) => this.tick(now));

    const wordmarksUrl = options.wordmarksUrl ?? DEFAULT_WORDMARKS_URL;
    this.ready = new THREE.FileLoader()
      .setResponseType('json')
      .loadAsync(wordmarksUrl)
      .then((wordmarks) => {
        if (this.disposed) return;
        this.buildTitle(wordmarks as unknown as WordmarkData);
        // Letter contours don't exist until this resolves — hold the first automatic burst
        // until there's something for it to emit from.
        this.nextBurst = this.time + nextSparkDelay();
        container.classList.add('sign-ready');
      });
  }

  // --- facade: brick backing, perimeter tube, marquee bulbs, bottom flourish -------------------

  private material(color: number, metalness = 0, roughness = 0.6): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, metalness, roughness });
  }

  private box(
    w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    this.root.add(mesh);
    return mesh;
  }

  /** A neon tube along `points` — smooth (Catmull-Rom, for the perimeter/flourish) or sharp
   * (straight segments, for letter-contour outlines where a smoothed curve would round off real
   * corners in the traced glyphs). */
  private tube(points: THREE.Vector3[], radius: number, material: THREE.Material, smooth = true): THREE.Mesh {
    let curve: THREE.Curve<THREE.Vector3>;
    if (smooth) {
      curve = new THREE.CatmullRomCurve3(points);
    } else {
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 1; i < points.length; i++) path.add(new THREE.LineCurve3(points[i - 1], points[i]));
      curve = path;
    }
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.max(10, points.length * 2), radius, 6, false),
      material,
    );
    this.root.add(mesh);
    return mesh;
  }

  private buildFacade(): void {
    const brickGeometry = new THREE.BoxGeometry(0.84, 0.31, 0.16);
    const brickMaterial = this.material(0x283038, 0.1, 0.87);
    const bricks = new THREE.InstancedMesh(brickGeometry, brickMaterial, 28 * 21);
    const dummy = new THREE.Object3D();
    let brickIndex = 0;
    for (let y = 0; y < 21; y++) {
      for (let x = 0; x < 28; x++) {
        dummy.position.set((x - 14) * 0.9 + (y % 2) * 0.45, (y - 10) * 0.36, -0.61);
        dummy.updateMatrix();
        bricks.setMatrixAt(brickIndex, dummy.matrix);
        const shade = new THREE.Color(0x333940).multiplyScalar(0.6 + ((x * 17 + y * 11) % 13) / 25);
        bricks.setColorAt(brickIndex, shade);
        brickIndex += 1;
      }
    }
    this.root.add(bricks);

    this.box(10.4, 5.7, 0.22, 0, 0, -0.27, this.material(0x123d42, 0.35, 0.38));
    this.box(10.62, 0.075, 0.3, 0, 2.89, -0.1, this.material(0x7a7060, 0.8, 0.3));
    this.box(10.62, 0.075, 0.3, 0, -2.89, -0.1, this.material(0x7a7060, 0.8, 0.3));

    // Local HDR intensities (well above 1) brighten the lettering under bloom without washing
    // out the whole sign — see this file's own header on why these exact multipliers are fixed.
    this.neonCream = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.71, 0.35).multiplyScalar(2), toneMapped: false });
    this.neonCyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.025, 0.72, 1).multiplyScalar(1.8), toneMapped: false });
    this.neonPink = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.045, 0.32).multiplyScalar(5.5), toneMapped: false });
    this.neonScriptCore = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.72, 0.25).multiplyScalar(3.2), toneMapped: false });
    this.neonStakes = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.25, 0.055).multiplyScalar(6.5), toneMapped: false });
    this.neonRedPink = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.035, 0.16).multiplyScalar(8), toneMapped: false });

    const border: THREE.Vector3[] = [];
    for (let i = 0; i <= 160; i++) {
      const angle = (i / 160) * Math.PI * 2;
      const cx = Math.cos(angle);
      const sy = Math.sin(angle);
      border.push(new THREE.Vector3(
        Math.sign(cx) * Math.pow(Math.abs(cx), 0.28) * 4.92,
        Math.sign(sy) * Math.pow(Math.abs(sy), 0.35) * 2.48,
        0.02,
      ));
    }
    this.tube(border, 0.055, this.neonCyan);

    const screwMaterial = this.material(0x77746a, 0.9, 0.35);
    for (const x of [-5.03, 5.03]) {
      for (const y of [-2.64, 2.64]) {
        const screw = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), screwMaterial);
        screw.position.set(x, y, -0.1);
        this.root.add(screw);
      }
    }

    const railMaterial = this.material(0x252c30, 0.7, 0.4);
    for (const x of [-3.7, 3.7]) this.box(0.065, 2, 0.12, x, 3.55, -0.35, railMaterial);

    for (let i = 0; i < 17; i++) {
      const x = -5.1 + i * 0.64;
      const y = 3.35 + Math.cos(x * 0.4) * 0.12;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), this.neonCream);
      bulb.position.set(x, y, 0);
      this.root.add(bulb);
    }
    this.tube(
      Array.from({ length: 30 }, (_, i) => {
        const x = -5.4 + (i / 29) * 10.8;
        return new THREE.Vector3(x, 3.4 + Math.cos(x * 0.4) * 0.12, -0.04);
      }),
      0.015,
      railMaterial,
    );

    // Warm marquee bulbs continue down both sides of the sign.
    const sideBulbGeometry = new THREE.SphereGeometry(0.045, 12, 8);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 10; i++) {
        const bulb = new THREE.Mesh(sideBulbGeometry, this.neonCream);
        bulb.position.set(side * 5.35, 2.72 - i * 0.64, 0);
        bulb.name = `side-marquee-${side}-${i}`;
        this.root.add(bulb);
      }
      this.tube(
        [
          new THREE.Vector3(side * 5.25, 3.34, -0.04),
          new THREE.Vector3(side * 5.35, 3.12, -0.04),
          new THREE.Vector3(side * 5.35, -3.14, -0.04),
        ],
        0.015,
        railMaterial,
      );
    }

    // A continuous, hand-drawn neon flourish along the bottom (revision 5 — replaced two
    // separate bracket tubes with one curved sweep, see this file's own header).
    const flourishPoints: [number, number][] = [
      [-4.4, -3.42], [-3.8, -3.15], [-3, -3.54], [-2.1, -3.27], [-1.15, -3.57],
      [-0.2, -3.31], [0.65, -3.13], [1.65, -3.52], [2.65, -3.23], [3.55, -3.49], [4.4, -3.16],
    ];
    const flourish = this.tube(
      flourishPoints.map(([x, y]) => new THREE.Vector3(x, y, 0.08)),
      0.047,
      this.neonRedPink,
    );
    flourish.name = 'pink-red-neon-flourish';

    const flourishSpill = new THREE.PointLight(0xff286a, 24, 7, 2);
    flourishSpill.position.set(0, -3.15, 0.65);
    this.root.add(flourishSpill);
    const scriptSpill = new THREE.PointLight(0xff5297, 13, 5, 2);
    scriptSpill.position.set(0, 1.3, 0.65);
    this.root.add(scriptSpill);
  }

  // --- title: extruded lettering traced from `title-wordmarks.json`, plus neon outline tubes ---

  private buildTitle(wordmarks: WordmarkData): void {
    // Fixed artwork from a lighter weight of the heading family and a semibold sign-painter
    // script (see NEON-START-MENU.md's typography revision notes) — preserve the original
    // lettering proportions, kerning and connected strokes rather than re-deriving them here.
    const face = new THREE.MeshBasicMaterial({ color: 0xffedcc });
    const sides = this.material(0xb34e38, 0.25, 0.4);

    for (const word of wordmarks.words) {
      const isScript = word.text === 'Table';
      const rowY = isScript ? 0.32 : -1.5;
      const [minX, minY, width, height] = word.bounds;
      const scale = Math.min((isScript ? 6.8 : 8.5) / width, (isScript ? 1.95 : 1.72) / height);
      const toX = (v: number) => (v - minX - width / 2) * scale;
      const toY = (v: number) => (v - minY) * scale + rowY;

      word.glyphs.forEach((commands, glyphIndex) => {
        const path = new THREE.ShapePath();
        for (const [op, ...v] of commands) {
          if (op === 'M') path.moveTo(toX(v[0]), toY(v[1]));
          if (op === 'L') path.lineTo(toX(v[0]), toY(v[1]));
          if (op === 'Q') path.quadraticCurveTo(toX(v[0]), toY(v[1]), toX(v[2]), toY(v[3]));
          if (op === 'C') path.bezierCurveTo(toX(v[0]), toY(v[1]), toX(v[2]), toY(v[3]), toX(v[4]), toY(v[5]));
          if (op === 'Z') path.currentPath?.closePath();
        }
        // `toShapes` needs a winding-order hint — pick it from whichever subpath encloses the
        // most area (the outer contour), so holes (the bowl of an "a", "S", etc.) resolve
        // correctly regardless of how the original trace wound each subpath.
        const outer = path.subPaths.reduce((a, b) =>
          Math.abs(THREE.ShapeUtils.area(a.getPoints(16))) > Math.abs(THREE.ShapeUtils.area(b.getPoints(16))) ? a : b);
        const shapes = path.toShapes(!THREE.ShapeUtils.isClockWise(outer.getPoints(16)));
        const geometry = new THREE.ExtrudeGeometry(shapes, {
          depth: 0.115,
          curveSegments: 16,
          bevelEnabled: true,
          bevelThickness: 0.012,
          bevelSize: isScript ? 0.014 : 0.009,
          bevelSegments: 2,
        });
        geometry.translate(0, 0, 0.08);
        const mesh = new THREE.Mesh(geometry, [face, sides]);
        mesh.name = `neon-sign-letter-${word.text}-${glyphIndex}`;
        this.root.add(mesh);

        for (const shape of shapes) {
          for (const contour of [shape, ...shape.holes]) {
            const points = contour.getPoints(16).map((v) => new THREE.Vector3(v.x, v.y, 0.22));
            if (points.length < 3) continue;
            points.push(points[0].clone());
            if (isScript) {
              // "Table": a pink outer glow halo plus a warm yellow neon core, per revision 5.
              const halo = this.tube(points.map((p) => new THREE.Vector3(p.x, p.y, p.z - 0.022)), 0.039, this.neonPink, false);
              halo.name = 'table-pink-glow';
              const core = this.tube(points, 0.014, this.neonScriptCore, false);
              core.name = 'table-yellow-core';
            } else {
              // "STAKES": a single higher-intensity stroke, per revision 5.
              const stroke = this.tube(points, 0.042, this.neonStakes, false);
              stroke.name = 'stakes-neon-stroke';
            }
            // Sample every other contour point as a spark emitter — enough coverage for bursts
            // to read as coming from all over the letters without one emitter per vertex.
            for (let i = 0; i < points.length; i += 2) this.emitters.push(points[i].clone());
          }
        }
      });
    }

    const starShape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const angle = (i * Math.PI) / 5 + Math.PI / 2;
      const radius = i % 2 ? 0.065 : 0.16;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) starShape.moveTo(x, y); else starShape.lineTo(x, y);
    }
    const starGeometry = new THREE.ShapeGeometry(starShape);
    for (const x of [-0.47, 0, 0.47]) {
      const star = new THREE.Mesh(starGeometry, this.neonCream);
      star.position.set(x, -2.1, 0.05);
      this.root.add(star);
    }
  }

  // --- pooled sparkler particles -----------------------------------------------------------

  private buildParticles(): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('sparkColor', new THREE.BufferAttribute(this.sparkColors, 3));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(this.ages, 1));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

    // A small custom shader rather than `PointsMaterial`: per-particle color AND per-particle
    // fade-alpha both need to be vertex attributes, and the additive core+glow falloff (see the
    // fragment shader below) is what gives a spark its "hot center, soft glow" look.
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: { pixelRatio: { value: this.renderer.getPixelRatio() } },
      vertexShader: `
        attribute float alpha;
        attribute float size;
        attribute vec3 sparkColor;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float pixelRatio;
        void main() {
          vColor = sparkColor;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * pixelRatio * (18.0 / -mv.z);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float r = length(uv);
          float core = 1.0 - smoothstep(0.04, 0.22, r);
          float glow = exp(-r * r * 20.0);
          float a = (core + glow * 0.5) * vAlpha;
          gl_FragColor = vec4(vColor * 2.5, a);
        }
      `,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.root.add(this.points);

    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 3));
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trails = new THREE.LineSegments(
      trailGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }),
    );
    this.trails.frustumCulled = false;
    this.root.add(this.trails);
  }

  /** Emit `amount` sparks from one randomly chosen letter-contour point. A no-op before
   * `ready` resolves (no emitters yet), with sparks disabled, or under reduced motion. */
  spark(amount = 40): void {
    if (!this.emitters.length || !this.options.sparks || this.options.reducedMotion) return;
    const source = this.emitters[Math.floor(Math.random() * this.emitters.length)];
    const colorOffset = Math.floor(Math.random() * SPARK_COLORS.length);
    for (let i = 0; i < amount; i++) {
      const index = this.cursor++ % this.poolSize;
      const particle = this.particles[index];
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 2.5;
      particle.position.copy(source);
      particle.velocity.set(Math.cos(angle) * speed, Math.sin(angle) * speed + 0.8, 0.2 + Math.random() * 0.6);
      particle.life = particle.total = 0.4 + Math.random() * 0.7;
      this.sizes[index] = 1.5 + Math.random() * 3;
      const color = new THREE.Color(SPARK_COLORS[(i + colorOffset) % SPARK_COLORS.length]);
      color.toArray(this.sparkColors, index * 3);
      color.toArray(this.trailColors, index * 6);
      color.toArray(this.trailColors, index * 6 + 3);
    }
  }

  /** Merge new settings over the current ones. Turning sparks off (or reduced motion on)
   * immediately kills every live particle rather than letting the current burst finish, since a
   * user who just asked for "steady" shouldn't see one more burst tail off. */
  configure(next: Partial<NeonSignOptions>): void {
    Object.assign(this.options, next);
    this.bloomPass.strength = this.options.bloom;
    if (!this.options.sparks || this.options.reducedMotion) {
      for (const particle of this.particles) particle.life = 0;
    }
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    // Widen the shot for a narrower container so the full sign stays in frame at a fixed FOV,
    // rather than letting a narrow host crop the letters.
    this.camera.position.z = Math.max(15.9, 10.95 / (2 * Math.tan(THREE.MathUtils.degToRad(17.5)) * this.camera.aspect));
    this.camera.updateProjectionMatrix();
  }

  private tick(now: number): void {
    if (this.disposed) return;
    const elapsed = Math.max(0, (now - (this.lastFrameMs || now)) / 1000);
    const dt = Math.min(elapsed, 0.04);
    this.lastFrameMs = now;
    if (document.hidden) return;
    this.time += elapsed;

    if (!this.options.reducedMotion) {
      this.root.rotation.y = THREE.MathUtils.lerp(this.root.rotation.y, -0.045 + this.pointer.x * 0.075, 0.035);
      this.root.rotation.x = THREE.MathUtils.lerp(this.root.rotation.x, this.pointer.y * 0.025, 0.035);
      if (this.time > this.nextBurst) {
        this.spark(18 + Math.floor(Math.random() * 22));
        this.nextBurst = this.time + nextSparkDelay();
      }
      this.warmBulbGlow.intensity = 65 + Math.sin(this.time * 2.5) * 2;
    } else {
      this.root.rotation.set(0, -0.045, 0);
      this.warmBulbGlow.intensity = 65;
    }

    for (let i = 0; i < this.poolSize; i++) {
      const particle = this.particles[i];
      if (particle.life > 0) {
        particle.life -= dt;
        particle.velocity.y -= 3.7 * dt;
        particle.position.addScaledVector(particle.velocity, dt);
      }
      const alive = Math.max(0, particle.life / particle.total);
      this.ages[i] = alive;
      this.positions.set([particle.position.x, particle.position.y, particle.position.z], i * 3);
      const tailLength = 0.022 * alive;
      this.trailPositions.set(
        [
          particle.position.x, particle.position.y, particle.position.z,
          particle.position.x - particle.velocity.x * tailLength,
          particle.position.y - particle.velocity.y * tailLength,
          particle.position.z - particle.velocity.z * tailLength,
        ],
        i * 6,
      );
    }
    this.points.geometry.attributes.sparkColor.needsUpdate = true;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.alpha.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;
    this.trails.geometry.attributes.color.needsUpdate = true;
    this.trails.geometry.attributes.position.needsUpdate = true;

    this.composer.render(dt);
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) for (const material of ([] as THREE.Material[]).concat(mesh.material)) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const pass of this.composer.passes) pass.dispose?.();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
