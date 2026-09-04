// PRD §15.2 Customer flow harness.
//
// Purpose: visualize customers entering the district, choosing a restaurant, queuing, seating,
// eating, paying and leaving — and give a human enough control to tune pathing and crowd
// density and to judge whether the §8 state machine reads as understandable on screen. §22
// counts this as harness #2 of the three MVP requires (restaurant-layout-harness is #1,
// STORY-019's kitchen-bottleneck harness will be #3).
//
// NO LIVE SIMULATION. Every party here is a plain object this file owns and mutates directly
// from the control panel — there is no ticking customer-system.js state machine underneath.
// That is the whole point of a harness (PRD §15, conventions.md Notable Pattern 4/11): the
// scene/entity/view layer (`RestaurantScene.upsertCustomer`, the patience ring, the segment
// tint) is the SAME code the live game drives, just fed positions and patience values a human
// dialed in rather than ones a match produced. Route lines and the on-screen state label are
// NOT part of that shared rendering surface — the live game never needed either — so they are
// built here, as harness-only Three.js objects added straight to `scene.scene` (a public field),
// never by reaching into `RestaurantScene`'s private state or forking its customer/table code.

import * as THREE from 'three';
import type { SceneHarness } from './harness-shell';
import {
  RestaurantScene,
  CameraController,
  type CustomerRenderState,
} from './shared/scene-primitives';
import { DevControls } from './shared/dev-controls';
import layout from '../../shared/game-data/restaurant-layout.json';
import segmentsData from '../../shared/game-data/customer-segments.json';
import {
  CUSTOMER_STATE_LIST,
  isExitState,
} from '../../shared/schemas/game-state';
import type { CustomerState, DecisionReason, Vec3 } from '../../shared/schemas/game-state';
import { UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD } from '../../shared/constants/tuning';
import { STATE_COLORS } from '../../client/src/game/state-colors';

// --- Spatial reference points -----------------------------------------------------------------
// `layout.json`'s own entities give the player restaurant's door, queue line and host stand
// (read from the SAME file `RestaurantScene` builds its geometry from, so these never drift out
// of sync with it). `DISTRICT_ENTRY`, `DECISION_POINT` and `RIVAL_DOOR` have no layout entry —
// PRD §6/§8's "district" is bigger than one restaurant's own footprint — so they are this
// harness's own dramaturgy, chosen to sit just beyond the street zone (`layout.zones.street`
// spans z -12..-8) and just in front of the rival storefront `RestaurantScene#buildCompetitor`
// draws at z ≈ -21 to -26, the same way that method's own header calls its shell "simplified".

type LayoutEntity = { id: string; type: string; position: number[] };
const entities = layout.entities as LayoutEntity[];
const customerEntry = layout.spawn.customerEntry as number[];

function entityPos(id: string): Vec3 {
  const entity = entities.find((e) => e.id === id);
  if (!entity) throw new Error(`layout entity not found: ${id}`);
  const [x, , z] = entity.position;
  return { x, y: 0, z };
}

const PLAYER_DOOR: Vec3 = { x: customerEntry[0], y: 0, z: customerEntry[2] };
const QUEUE_POS: Vec3 = entityPos('queue_line');
const HOST_STAND: Vec3 = entityPos('host_stand');
const DISTRICT_ENTRY: Vec3 = { x: 0, y: 0, z: -19 };
const DECISION_POINT: Vec3 = { x: 0, y: 0, z: -14 };
const RIVAL_DOOR: Vec3 = { x: 0, y: 0, z: -22 };

const TABLES: { id: string; position: Vec3 }[] = entities
  .filter((e) => e.type === 'table')
  .map((e) => ({ id: e.id, position: entityPos(e.id) }));

// --- Segments ------------------------------------------------------------------------------

interface SegmentInfo {
  id: string;
  name: string;
  partySize: number;
}
const SEGMENTS: SegmentInfo[] = segmentsData.segments.map((s) => ({
  id: s.id,
  name: s.name,
  partySize: s.partySize,
}));
function segmentName(id: string): string {
  return SEGMENTS.find((s) => s.id === id)?.name ?? id;
}

// --- Camera --------------------------------------------------------------------------------
// The customer's journey spans from the street (z ≈ -19) to the rival across the way (z ≈ -22)
// to the back of the player's own dining room (z ≈ -1) — a wider span than the restaurant
// footprint alone, so this harness's own default framing pulls back further than
// `DEFAULT_CAMERA` (which is tuned for `restaurant-layout-harness`'s footprint-only view).
const CUSTOMER_FLOW_CAMERA = { height: 30, distance: 34, angle: 0, fov: 50 } as const;

// --- Mock party model ------------------------------------------------------------------------

interface MockCustomer {
  customerId: string;
  segmentId: string;
  partySize: number;
  state: CustomerState;
  patienceRemaining: number;
  unhappy: boolean;
  tableId: string | null;
  decisionReason: DecisionReason | null;
  /** A stable per-party number, assigned once at spawn, used only to spread parties that share a
   * state so they don't render on top of one another — has no gameplay meaning. */
  laneSeed: number;
  /** Marks the "simulate queue size" filler parties (§15.2) so they stay out of the "Selected
   * party" dropdown — they exist purely to test crowd density, not to be individually posed. */
  isQueueGhost: boolean;
}

/** Where a party sits/stands for a given §8 state, and the route line(s) — plural for
 * `EVALUATE_RESTAURANTS`, which is genuinely comparing two destinations — that show its
 * intended path. `lineColor` doubles as the route's color and the on-screen label's tint: a
 * simple three-way read (blue = still a live prospect, yellow = left without choosing, red =
 * patience-driven exit, purple = went to the rival) that a glance at either the line or the
 * label confirms.
 */
function routePlanFor(
  state: CustomerState,
  laneSeed: number,
  tablePosition: Vec3 | null,
): { position: Vec3; paths: Vec3[][]; lineColor: number } {
  // `* 3` (coprime with the modulus 7), not a bare `laneSeed % 7` — consecutively spawned
  // parties have consecutive `laneSeed`s, and forcing two of them into the SAME state (a
  // realistic manual-testing pattern: spawn, force a state, inspect; spawn another, force the
  // same state again) is exactly when a bare modulo puts them one lane apart — closer than the
  // label sprite's own 2.2-unit width, so the two labels still overlapped in a live check even
  // after widening the multipliers below. This permutes lane order (0,3,6,2,5,1,4,0,3,…) so
  // adjacent seeds land 3 lanes apart instead of 1.
  const lane = (laneSeed * 3) % 7;
  const spread = (lane - 3) * 1.3;

  switch (state) {
    case 'ENTER_DISTRICT': {
      const position: Vec3 = { x: DISTRICT_ENTRY.x + spread, y: 0, z: DISTRICT_ENTRY.z };
      return { position, paths: [[position, DECISION_POINT]], lineColor: STATE_COLORS.opportunity };
    }
    case 'EVALUATE_RESTAURANTS': {
      const position: Vec3 = { x: DECISION_POINT.x + spread * 0.6, y: 0, z: DECISION_POINT.z };
      // PRD §6: the choice is genuinely between two restaurants — showing both candidate paths
      // is the "pathing problems visible" AC applied to the decision itself, not just to
      // movement.
      return {
        position,
        paths: [
          [position, PLAYER_DOOR],
          [position, RIVAL_DOOR],
        ],
        lineColor: STATE_COLORS.opportunity,
      };
    }
    case 'APPROACH_OR_QUEUE': {
      const position: Vec3 = { x: QUEUE_POS.x + spread * 0.6, y: 0, z: QUEUE_POS.z };
      const destination = tablePosition ?? HOST_STAND;
      return { position, paths: [[position, HOST_STAND, destination]], lineColor: STATE_COLORS.opportunity };
    }
    case 'SEATED':
    case 'ORDERING':
    case 'WAITING_FOR_FOOD':
    case 'EATING':
    case 'PAYING': {
      const position = tablePosition ?? { x: spread, y: 0, z: -3 };
      return { position, paths: [], lineColor: STATE_COLORS.opportunity };
    }
    case 'LEAVING': {
      const position: Vec3 = { x: HOST_STAND.x - 1 + spread * 0.3, y: 0, z: -9.4 };
      return { position, paths: [[position, PLAYER_DOOR]], lineColor: STATE_COLORS.opportunity };
    }
    case 'REVIEW': {
      // `spread` here, not a bare copy of `PLAYER_DOOR` — an earlier pass had every REVIEW
      // party stack on the exact same point (no lane term at all), the same collision the
      // ABANDON_QUEUE case above already had to fix once. A live check with two REVIEW parties
      // found even `spread * 0.3` still too tight — labels overlapped at this camera distance —
      // so this uses the full, unscaled spread.
      const position: Vec3 = { x: PLAYER_DOOR.x + spread, y: 0, z: PLAYER_DOOR.z };
      return { position, paths: [[position, DISTRICT_ENTRY]], lineColor: STATE_COLORS.opportunity };
    }
    case 'CHOOSE_RIVAL': {
      const position: Vec3 = { x: DECISION_POINT.x + spread * 0.5, y: 0, z: -19 };
      return { position, paths: [[position, RIVAL_DOOR]], lineColor: STATE_COLORS.premium };
    }
    case 'LEAVE_DISTRICT': {
      const position: Vec3 = { x: DECISION_POINT.x + spread, y: 0, z: -16 };
      return { position, paths: [[position, DISTRICT_ENTRY]], lineColor: STATE_COLORS.attention };
    }
    case 'ABANDON_QUEUE': {
      // A touch further back (z) than APPROACH_OR_QUEUE's own spot, and a wider spread — an
      // abandoning party has stepped OUT of the queue line proper, and the two states'
      // labels/lines would otherwise collide at the default camera angle since both cluster
      // around the same queue entity.
      const position: Vec3 = { x: QUEUE_POS.x + spread * 0.9 - 1.2, y: 0, z: QUEUE_POS.z - 1.4 };
      return { position, paths: [[position, DISTRICT_ENTRY]], lineColor: STATE_COLORS.critical };
    }
    case 'CANCEL_ORDER': {
      // NOT an at-table state (see `syncCustomer`'s `atTable` set) — `tablePosition` is always
      // null here, so `tableFallback ?? HOST_STAND` alone would put every CANCEL_ORDER party on
      // the identical point. The spread term is load-bearing, not decoration (a live check with
      // a partial multiplier still let two adjacent-lane parties' labels overlap, the same
      // lesson REVIEW above learned — this uses the full spread now); z is nudged apart from
      // LEAVE_ANGRY below so the two exits don't collide with EACH OTHER either.
      const position: Vec3 = tablePosition ?? { x: HOST_STAND.x + spread, y: 0, z: HOST_STAND.z - 0.8 };
      return { position, paths: [[position, PLAYER_DOOR]], lineColor: STATE_COLORS.critical };
    }
    case 'LEAVE_ANGRY': {
      const position: Vec3 = tablePosition ?? { x: HOST_STAND.x + spread, y: 0, z: HOST_STAND.z + 0.8 };
      return { position, paths: [[position, PLAYER_DOOR]], lineColor: STATE_COLORS.critical };
    }
    default: {
      // Exhaustiveness guard: `CustomerState` is a closed §8 vocabulary, so a new state added
      // there without a case here is a bug this harness should surface loudly, not silently
      // mis-render.
      const exhaustive: never = state;
      throw new Error(`customer-flow-harness: no route plan for state ${String(exhaustive)}`);
    }
  }
}

// --- On-screen state label -------------------------------------------------------------------
// Deliberately just the state name, nothing appended — the same live-legibility lesson
// `RestaurantScene.ts`'s own `WORKER_TASK_GLYPHS` comment documents: cramming party size or a
// decision reason into this sprite too made it unreadable at the default camera height in an
// early pass. Party size shows instead as a body-scale cue (`syncCustomer` below) and in the
// "Selected party" dropdown's own label text; decision reason shows in the selected-party
// readout. One sprite, one job.

const labelTextureCache = new Map<string, THREE.CanvasTexture>();

function labelTexture(text: string): THREE.CanvasTexture {
  const cached = labelTextureCache.get(text);
  if (cached) return cached;
  const width = 320;
  const height = 64;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.fillStyle = 'rgba(12, 15, 19, 0.82)';
  ctx.fillRect(4, 4, width - 8, height - 8);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px ui-monospace, SFMono-Regular, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  labelTextureCache.set(text, texture);
  return texture;
}

function syncLabel(group: THREE.Object3D, text: string, colorHex: number, visible: boolean): void {
  let sprite = group.getObjectByName('harness_label') as THREE.Sprite | undefined;
  if (!sprite) {
    const material = new THREE.SpriteMaterial({ depthTest: false, transparent: true });
    sprite = new THREE.Sprite(material);
    sprite.name = 'harness_label';
    sprite.scale.set(2.2, 0.44, 1);
    sprite.position.set(0, 1.7, 0);
    sprite.renderOrder = 11;
    group.add(sprite);
  }
  const material = sprite.material as THREE.SpriteMaterial;
  if (sprite.userData.text !== text) {
    material.map = labelTexture(text);
    material.needsUpdate = true;
    sprite.userData.text = text;
  }
  material.color.setHex(colorHex);
  sprite.visible = visible;
}

export const customerFlowHarness: SceneHarness = createCustomerFlowHarness();

function createCustomerFlowHarness(): SceneHarness {
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: RestaurantScene | null = null;
  let camera: CameraController | null = null;
  let frame = 0;
  let observer: ResizeObserver | null = null;

  let customers = new Map<string, MockCustomer>();
  let routeLines = new Map<string, THREE.Line[]>();
  let selectedId: string | null = null;
  let showRoutes = true;
  let showLabels = true;
  let nextLaneSeed = 0;

  function assignTable(customerId: string): string {
    const occupied = new Set<string>();
    for (const c of customers.values()) {
      if (c.customerId !== customerId && c.tableId) occupied.add(c.tableId);
    }
    const free = TABLES.find((t) => !occupied.has(t.id));
    // Every table full is itself a real §8 condition (a party stuck at APPROACH_OR_QUEUE) —
    // round-robin onto a shared table rather than crash the harness; two bodies briefly
    // overlapping is a visible, honest signal of "you spawned more parties than seats", not a
    // rendering bug.
    return free ? free.id : TABLES[customers.size % TABLES.length].id;
  }

  function syncRoutes(customerId: string, paths: Vec3[][], colorHex: number, visible: boolean): void {
    const old = routeLines.get(customerId);
    if (old) {
      for (const line of old) {
        scene?.scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
    }
    const lines: THREE.Line[] = [];
    for (const path of paths) {
      const points = path.map((p) => new THREE.Vector3(p.x, p.y + 0.05, p.z));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.85 });
      const line = new THREE.Line(geometry, material);
      line.name = `route_${customerId}`;
      line.visible = visible;
      scene?.scene.add(line);
      lines.push(line);
    }
    if (lines.length > 0) routeLines.set(customerId, lines);
    else routeLines.delete(customerId);
  }

  /** The one place a party's §8 state (or table assignment) turns into rendered pixels: scene
   * position via the SAME `RestaurantScene.upsertCustomer` the live game calls, plus this
   * harness's own route line(s) and label. Never called for a patience-only change — see the
   * "Patience remaining" slider below, which updates the ring directly instead. */
  function syncCustomer(customer: MockCustomer): void {
    const atTable =
      customer.state === 'SEATED' ||
      customer.state === 'ORDERING' ||
      customer.state === 'WAITING_FOR_FOOD' ||
      customer.state === 'EATING' ||
      customer.state === 'PAYING';
    if (!atTable) customer.tableId = null;
    else if (!customer.tableId) customer.tableId = assignTable(customer.customerId);

    const tablePos = customer.tableId ? TABLES.find((t) => t.id === customer.tableId)!.position : null;
    const plan = routePlanFor(customer.state, customer.laneSeed, tablePos);

    const renderState: CustomerRenderState = {
      customerId: customer.customerId,
      position: plan.position,
      patienceRemaining: customer.patienceRemaining,
      unhappy: customer.unhappy,
      segmentId: customer.segmentId,
    };
    scene?.upsertCustomer(renderState);

    const group = scene?.scene.getObjectByName(`customer_${customer.customerId}`);
    if (group) {
      // §15.2 "change party size" — the shared entity mesh itself has no notion of party size
      // (one capsule per `CustomerSnapshot`, regardless of headcount), so a modest scale bump
      // is this harness's own crowd-size cue; it never touches `RestaurantScene`'s geometry.
      group.scale.setScalar(1 + (customer.partySize - 1) * 0.12);
      syncLabel(group, customer.state, plan.lineColor, showLabels);
    }
    syncRoutes(customer.customerId, plan.paths, plan.lineColor, showRoutes);
  }

  function despawn(customerId: string): void {
    scene?.removeCustomer(customerId);
    const lines = routeLines.get(customerId);
    if (lines) {
      for (const line of lines) {
        scene?.scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
      routeLines.delete(customerId);
    }
    customers.delete(customerId);
  }

  return {
    id: 'customer-flow',
    title: 'Customer Flow',
    description:
      'Customers entering, choosing a restaurant, queuing, seating, eating, paying and ' +
      'leaving — every §8 state (including all five exits) forceable on demand. PRD §15.2.',

    mount(container: HTMLElement): void {
      const viewport = document.createElement('div');
      viewport.className = 'harness-viewport';
      const panel = new DevControls('Customer flow controls');
      container.append(viewport, panel.element);

      scene = new RestaurantScene({ showDebugGrid: false, showCompetitor: true });
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(viewport.clientWidth, Math.max(1, viewport.clientHeight));
      viewport.appendChild(renderer.domElement);

      camera = new CameraController(viewport.clientWidth / Math.max(1, viewport.clientHeight));
      camera.setSettings(CUSTOMER_FLOW_CAMERA);
      camera.setTarget(-2, -10);

      customers = new Map();
      routeLines = new Map();
      selectedId = null;
      showRoutes = true;
      showLabels = true;
      nextLaneSeed = 0;

      function addCustomer(
        segmentId: string,
        partySize: number,
        state: CustomerState,
        patienceRemaining = 1,
      ): MockCustomer {
        const id = `harness_customer_${nextLaneSeed}`;
        const customer: MockCustomer = {
          customerId: id,
          segmentId,
          partySize,
          state,
          patienceRemaining,
          unhappy: patienceRemaining <= UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD,
          tableId: null,
          decisionReason: null,
          laneSeed: nextLaneSeed,
          isQueueGhost: false,
        };
        nextLaneSeed += 1;
        customers.set(id, customer);
        syncCustomer(customer);
        return customer;
      }

      // --- Spawn config ------------------------------------------------------------------
      let spawnSegment = SEGMENTS[0].id;
      let spawnPartySize = SEGMENTS[0].partySize;
      const setSpawnPartySizeSlider = panel.addSlider(
        'Spawn party size',
        { min: 1, max: 6, step: 1, value: spawnPartySize },
        (v) => { spawnPartySize = v; },
      );
      panel.addSelect(
        'Segment to spawn',
        SEGMENTS.map((s) => ({ value: s.id, label: s.name })),
        (v) => {
          spawnSegment = v;
          const seg = SEGMENTS.find((s) => s.id === v);
          if (seg) {
            spawnPartySize = seg.partySize;
            setSpawnPartySizeSlider(spawnPartySize);
          }
        },
      );
      panel.addButton('Spawn customer (ENTER_DISTRICT)', () => {
        const c = addCustomer(spawnSegment, spawnPartySize, 'ENTER_DISTRICT');
        selectedId = c.customerId;
        refreshSelectedList();
        syncSelectedControls();
      });

      panel.addSeparator();

      // --- Selected-party controls --------------------------------------------------------
      const readSelected = () => (selectedId ? readoutText(customers.get(selectedId)) : 'None selected');
      const setSelectedReadout = panel.addReadout('Selected');
      function readoutText(c: MockCustomer | undefined): string {
        if (!c) return 'None selected';
        const reason = c.decisionReason ? ` (${c.decisionReason})` : '';
        return `${segmentName(c.segmentId)} ×${c.partySize} — ${c.state}${reason}`;
      }

      const setSelectedListOptions = panel.addSelect('Selected party', [], (v) => {
        selectedId = v;
        syncSelectedControls();
      });
      function refreshSelectedList(): void {
        const options = [...customers.values()]
          .filter((c) => !c.isQueueGhost)
          .map((c) => ({ value: c.customerId, label: `${segmentName(c.segmentId)} ×${c.partySize} — ${c.state}` }));
        if (!options.some((o) => o.value === selectedId)) selectedId = options[0]?.value ?? null;
        setSelectedListOptions(options, selectedId ?? undefined);
      }

      function withSelected(fn: (c: MockCustomer) => void): void {
        if (!selectedId) return;
        const c = customers.get(selectedId);
        if (!c) return;
        fn(c);
      }

      function afterSelectedMutation(): void {
        refreshSelectedList();
        syncSelectedControls();
      }

      const setSelectedPartySizeSlider = panel.addSlider(
        'Selected party size',
        { min: 1, max: 6, step: 1, value: 1 },
        (v) => withSelected((c) => { c.partySize = v; syncCustomer(c); afterSelectedMutation(); }),
      );

      panel.addButton('Decision → your restaurant', () =>
        withSelected((c) => {
          c.state = 'APPROACH_OR_QUEUE';
          c.decisionReason = 'shorter_projected_wait';
          syncCustomer(c);
          afterSelectedMutation();
        }));
      panel.addButton('Decision → rival', () =>
        withSelected((c) => {
          c.state = 'CHOOSE_RIVAL';
          c.decisionReason = 'higher_reputation';
          syncCustomer(c);
          afterSelectedMutation();
        }));
      panel.addButton('Decision → abandon', () =>
        withSelected((c) => {
          c.state = 'ABANDON_QUEUE';
          c.decisionReason = 'customer_abandoned_queue';
          syncCustomer(c);
          afterSelectedMutation();
        }));

      const setPatienceSlider = panel.addSlider(
        'Patience remaining',
        { min: 0, max: 1, step: 0.01, value: 1 },
        (v) => withSelected((c) => {
          c.patienceRemaining = v;
          c.unhappy = v <= UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD;
          // Patience never moves position or route — recolor the ring in place via the same
          // `upsertCustomer` call `syncCustomer` uses, without rebuilding route lines/label.
          scene?.upsertCustomer({
            customerId: c.customerId,
            position: c.tableId
              ? TABLES.find((t) => t.id === c.tableId)!.position
              : routePlanFor(c.state, c.laneSeed, null).position,
            patienceRemaining: c.patienceRemaining,
            unhappy: c.unhappy,
            segmentId: c.segmentId,
          });
          setSelectedReadout(readSelected());
        }),
      );

      let forcedState: CustomerState = CUSTOMER_STATE_LIST[0];
      panel.addSelect(
        'Force customer state (all 15, incl. 5 exits)',
        CUSTOMER_STATE_LIST.map((s) => ({ value: s, label: isExitState(s) ? `${s} (exit)` : s })),
        (v) => { forcedState = v as CustomerState; },
      );
      panel.addButton('Apply forced state', () =>
        withSelected((c) => {
          c.state = forcedState;
          if (isExitState(forcedState) && c.patienceRemaining > UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD) {
            // A forced exit with full patience left (e.g. jumping straight to LEAVE_ANGRY from
            // a fresh spawn) would render a green ring under a red exit label — recolor the
            // ring to match so the AC ("labelled on screen") and the patience channel never
            // visibly disagree about the same party.
            c.patienceRemaining = 0.1;
            c.unhappy = true;
          }
          syncCustomer(c);
          afterSelectedMutation();
        }));

      panel.addButton('Remove selected', () =>
        withSelected((c) => {
          despawn(c.customerId);
          selectedId = null;
          afterSelectedMutation();
        }));

      function syncSelectedControls(): void {
        const c = selectedId ? customers.get(selectedId) : undefined;
        setSelectedPartySizeSlider(c ? c.partySize : 1);
        setPatienceSlider(c ? c.patienceRemaining : 1);
        setSelectedReadout(readoutText(c));
      }

      panel.addSeparator();

      // --- Queue-size simulation -----------------------------------------------------------
      // §15.2 "simulate queue size" — a pure crowd-density control: N filler parties stacked
      // along the queue line, distinct from any user-spawned party (see `isQueueGhost`'s own
      // comment) so dialing this up and down never disturbs whatever the user is inspecting.
      function setQueueGhostCount(n: number): void {
        const current = [...customers.values()].filter((c) => c.isQueueGhost);
        if (n < current.length) {
          for (const c of current.slice(n)) despawn(c.customerId);
        } else {
          for (let i = current.length; i < n; i += 1) {
            const seg = SEGMENTS[i % SEGMENTS.length];
            const id = `harness_queue_ghost_${nextLaneSeed}`;
            const ghost: MockCustomer = {
              customerId: id,
              segmentId: seg.id,
              partySize: seg.partySize,
              state: 'APPROACH_OR_QUEUE',
              patienceRemaining: 0.85,
              unhappy: false,
              tableId: null,
              decisionReason: null,
              laneSeed: nextLaneSeed,
              isQueueGhost: true,
            };
            nextLaneSeed += 1;
            customers.set(id, ghost);
            syncCustomer(ghost);
          }
        }
      }
      panel.addSlider('Simulate queue size (extra parties)', { min: 0, max: 8, step: 1, value: 0 }, setQueueGhostCount);

      panel.addSeparator();

      panel.addToggle('Route lines', showRoutes, (v) => {
        showRoutes = v;
        for (const lines of routeLines.values()) for (const l of lines) l.visible = v;
      });
      panel.addToggle('State labels', showLabels, (v) => {
        showLabels = v;
        for (const c of customers.values()) {
          const group = scene?.scene.getObjectByName(`customer_${c.customerId}`);
          const label = group?.getObjectByName('harness_label');
          if (label) label.visible = v;
        }
      });

      panel.addSeparator();

      panel.addSlider('Camera height', { min: 10, max: 46, step: 0.5, value: CUSTOMER_FLOW_CAMERA.height },
        (v) => camera?.setSettings({ height: v }));
      panel.addSlider('Camera distance', { min: 10, max: 52, step: 0.5, value: CUSTOMER_FLOW_CAMERA.distance },
        (v) => camera?.setSettings({ distance: v }));
      panel.addSlider('Camera angle', { min: -Math.PI, max: Math.PI, step: 0.02, value: CUSTOMER_FLOW_CAMERA.angle },
        (v) => camera?.setSettings({ angle: v }));
      panel.addSlider('Field of view', { min: 20, max: 80, step: 1, value: CUSTOMER_FLOW_CAMERA.fov },
        (v) => camera?.setSettings({ fov: v }));
      panel.addButton('Reset camera', () => camera?.setSettings({ ...CUSTOMER_FLOW_CAMERA }));

      const fpsReadout = panel.addReadout('FPS');

      // --- Seed a few parties so the harness is immediately demonstrative, not an empty street
      // — spanning the main path AND several exits, matching the AC's "multiple customers in
      // different §8 states" bar for what a screenshot of this harness must show.
      addCustomer('office_worker', 1, 'ENTER_DISTRICT');
      addCustomer('tourist', 2, 'EVALUATE_RESTAURANTS');
      const queued = addCustomer('event_fan', 4, 'APPROACH_OR_QUEUE');
      addCustomer('affluent_couple', 2, 'EATING', 0.6);
      addCustomer('neighborhood_regular', 2, 'PAYING');
      addCustomer('office_worker', 1, 'LEAVING');
      addCustomer('tourist', 2, 'CHOOSE_RIVAL');
      addCustomer('event_fan', 3, 'ABANDON_QUEUE', 0.08);
      addCustomer('affluent_couple', 2, 'LEAVE_ANGRY', 0.05);
      selectedId = queued.customerId;
      refreshSelectedList();
      syncSelectedControls();

      const resize = () => {
        const w = viewport.clientWidth;
        const h = Math.max(1, viewport.clientHeight);
        renderer?.setSize(w, h);
        camera?.setAspect(w / h);
      };
      observer = new ResizeObserver(resize);
      observer.observe(viewport);

      const started = performance.now();
      let last = started;
      let fpsAccum = 0;
      let fpsFrames = 0;

      const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;

        fpsAccum += dt;
        fpsFrames += 1;
        if (fpsAccum >= 0.5) {
          fpsReadout((fpsFrames / fpsAccum).toFixed(0));
          fpsAccum = 0;
          fpsFrames = 0;
        }

        if (scene && camera) {
          // Reuse the live game's own patience-sway animation (PRD §4.4 "visibly look
          // impatient") — the exact function `GameClient#handleFrame` calls every frame, so an
          // impatient mock party sways here exactly the way it would in a real match.
          scene.updateCustomerAnimations((now - started) / 1000);
          camera.update(dt);
          renderer?.render(scene.scene, camera.camera);
        }
      };
      frame = requestAnimationFrame(loop);
    },

    dispose(): void {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      observer = null;
      // `scene.dispose()` traverses its whole THREE.Scene disposing every geometry/material it
      // finds, then clears it — this sweeps up the route-line objects and label sprites too,
      // since both were added as descendants of `scene.scene` (route lines directly, labels as
      // children of the customer groups `upsertCustomer` owns), never tracked in a second scene
      // graph of this harness's own. See `restaurant-layout-harness.ts`'s identical pattern.
      scene?.dispose();
      scene = null;
      renderer?.dispose();
      renderer = null;
      camera = null;
      customers = new Map();
      routeLines = new Map();
      selectedId = null;
    },
  };
}
