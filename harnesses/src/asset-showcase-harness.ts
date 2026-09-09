// STORY-026 Entity model showcase harness.
//
// Purpose: a standalone showcase for player, dish and restaurant models/entities, for visual
// styling work independent of a live match — Player Models, Dish Models, Restaurant Models,
// each in both a focused single-asset inspection mode and a composed in-context scene mode.
//
// Restaurant assets now load through the production CopperAndThyme adapter. The loader and
// RoomEnvironment use the same pinned CDN addon map as the game's Three.js runtime. Focused
// visibility/bounds are reapplied when the asynchronous model arrives.
//
//   - Dish Models uses the authored arcade-food GLBs for all eight catalogue dishes at both the
//     service pass and the real carry socket. This older showcase keeps its abstract carried-count
//     control for testing socket capacity; the Arcade Food Library harness is the item-by-item
//     model inspector. Table badges remain meal-state indicators rather than dish geometry. This
//     category also accounts for which `OrderState` values
//     ('queued', 'ready') have ANY visual at all and which ('placed', 'in_progress', 'delivered',
//     'cancelled') have none.
//   - Wherever a requested preview has no production view to map onto — `OwnerRenderState.
//     sprinting` (carried on the wire, never rendered), `CustomerSnapshot.state`/exit states (no
//     visual beyond the patience ring), `equipment_failure`/`StationSnapshot.broken` (declared
//     in `game-state.d.ts`, never rendered anywhere, and `stations[]` is never even published —
//     see `key-files.md`), or a non-`grill` station's "upgraded" tint (`STATION_COLORS_UPGRADED`
//     only has a `grill` entry) — the Diagnostics box says so in plain language instead of
//     inventing a look this codebase has never shipped. That is this file's answer to the AC's
//     "loading failures, missing textures, unsupported animations, invalid fixture metadata
//     surface as visible diagnostics, not silent failures": there is no loader to fail, so the
//     diagnostic is "this fixture/control has no visual effect in production", which is the
//     honest analogue.
//   - `kitchen-bottleneck-harness.ts` already invented its OWN bespoke "broken station" glyph
//     for its own timing-comparison purposes (see its header) — that is a harness-local
//     invention, not a reusable production view, so it is deliberately NOT duplicated here.
//
// FOCUSED VS COMPOSED, BOTH ON THE SAME `RestaurantScene` INSTANCE. There is exactly one
// `RestaurantScene` per mount, reused for both modes and shared across all three categories —
// never a private copy. "Composed" shows the whole restaurant, exactly as `restaurant-layout-
// harness` does. "Focused" hides every top-level scene child except the one object currently
// being inspected (so the inspected asset fills the frame, product-shot style) — implemented as
// a visibility pass over `scene.scene.children`, not a second scene graph. Swapping the
// inspected asset or toggling modes is therefore just a visibility + camera-target change, never
// a rebuild — satisfying "swapping the inspected asset does not require a page reload" for free.
//
// MOCKED FIXTURES MATCH PRODUCTION SHAPES. `./shared/test-entity-fixtures.ts` builds
// `OwnerRenderState`/`WorkerRenderState`/`CustomerRenderState`/`RestaurantSnapshot`/
// `CustomerSnapshot`/`OrderSnapshot` values using the real interfaces from `scene-primitives.ts`
// and `shared/schemas/game-state`, not ad hoc objects that happen to render.

import * as THREE from 'three';
import { configureRestaurantRenderer } from '../../client/src/scenes/restaurant-rendering';
import type { SceneHarness } from './harness-shell';
import {
  RestaurantScene,
  CameraController,
  DEFAULT_CAMERA,
  type OwnerRenderState,
  type WorkerRenderState,
} from './shared/scene-primitives';
import { DevControls } from './shared/dev-controls';
import {
  SHOWCASE_RESTAURANT_ID,
  SHOWCASE_OWNER_ID,
  SHOWCASE_RIVAL_OWNER_ID,
  layoutTableIds,
  defaultTables,
  mockOwner,
  mockWorker,
  mockCustomerRenderState,
  mockSelfRestaurantSnapshot,
  mockRivalRestaurantSnapshot,
  mockOrder,
  mockDiningCustomer,
} from './shared/test-entity-fixtures';
import { STATE_COLORS } from '../../client/src/game/state-colors';
import dishesData from '../../shared/game-data/dishes.json';
import segmentsData from '../../shared/game-data/customer-segments.json';
import { STATIONS, type Station } from '../../shared/schemas/messages';
import { ADDON_CATEGORIES } from '../../shared/schemas/setup-rules';
import type {
  CustomerState,
  RestaurantSnapshot,
  CustomerSnapshot,
  OrderSnapshot,
  WorkerRole,
  WorkerTaskKind,
} from '../../shared/schemas/game-state';
import {
  ORDER_FRESHNESS_GRACE_MS,
  PATIENCE_RING_ATTENTION_THRESHOLD,
  PATIENCE_RING_BOTTLENECK_THRESHOLD,
  UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD,
} from '../../shared/constants/tuning';

type Category = 'player' | 'dish' | 'restaurant';

interface DishDef {
  id: string;
  name: string;
  category: string;
  suggestedPrice: number;
  stationSteps: { station: Station; durationMs: number }[];
}
const DISHES = dishesData.dishes as unknown as DishDef[];

interface SegmentDef {
  id: string;
  name: string;
}
const SEGMENTS = segmentsData.segments as unknown as SegmentDef[];

// --- Player Models: static preview positions/defs (independent of any one scene instance) -----

const OWNER_SELF_POS = { x: 0, z: -3 } as const;
const OWNER_RIVAL_POS = { x: 2.4, z: -3 } as const;
const WORKER_ROW_Z = 6.6;
const CUSTOMER_ROW_Z = -6.4;

const WORKER_TASK_KINDS: WorkerTaskKind[] = [
  'tend_station',
  'restock',
  'deliver_order',
  'seat_party',
  'take_order',
  'clear_table',
  'collect_payment',
];
const WORKER_TASK_SELECT_OPTIONS: { value: string; label: string }[] = [
  { value: 'idle', label: 'Idle (no task)' },
  { value: 'needs_help', label: 'Needs help (blocked)' },
  ...WORKER_TASK_KINDS.map((k) => ({ value: k, label: k })),
];

/** Turns one `WORKER_TASK_SELECT_OPTIONS` value into the `task`/`needsHelp` pair
 * `RestaurantScene#upsertWorker` reads — the "THREE STATES, NOT TWO" shape `game-state.d.ts`
 * documents on `RestaurantSnapshot.workers[]` itself. */
function taskOptionToTaskAndHelp(
  value: string,
): { task: WorkerRenderState['task']; needsHelp: WorkerRenderState['needsHelp'] } {
  if (value === 'idle') return { task: null, needsHelp: null };
  if (value === 'needs_help') {
    return { task: null, needsHelp: { reason: 'blocked_on_ingredients', station: 'grill', ingredientId: 'ground_beef' } };
  }
  return {
    task: { kind: value as WorkerTaskKind, phase: 'work', targetId: null, station: null, remainingMs: 0 },
    needsHelp: null,
  };
}

interface WorkerPreviewDef {
  /** Scene object name is `worker_${workerId}` — see `RestaurantScene#upsertWorker`. */
  workerId: string;
  role: WorkerRole;
  post: string;
  x: number;
  initialTaskOption: string;
  /** Whether `restaurant-layout.json`'s MVP `staff.roster` actually assigns this role today. */
  rostered: boolean;
}
const WORKER_PREVIEWS: WorkerPreviewDef[] = [
  { workerId: 'cook', role: 'cook', post: 'grill', x: -6, initialTaskOption: 'tend_station', rostered: true },
  { workerId: 'server', role: 'server', post: 'dining_room', x: -2, initialTaskOption: 'deliver_order', rostered: true },
  { workerId: 'prep_worker', role: 'prep_worker', post: 'prep', x: 2, initialTaskOption: 'idle', rostered: false },
  { workerId: 'host', role: 'host', post: 'host_stand', x: 6, initialTaskOption: 'seat_party', rostered: false },
];

/** Representative `patienceRemaining` values for the four §14 ring bands, derived from the same
 * thresholds `RestaurantScene#upsertCustomer` classifies against (`patienceColorBand`) rather
 * than invented cutoffs — the midpoint of each band's own range. */
const PATIENCE_BAND_VALUES: { id: string; label: string; value: number }[] = [
  { id: 'healthy', label: 'Healthy (green)', value: (PATIENCE_RING_ATTENTION_THRESHOLD + 1) / 2 },
  {
    id: 'attention',
    label: 'Attention (yellow)',
    value: (PATIENCE_RING_BOTTLENECK_THRESHOLD + PATIENCE_RING_ATTENTION_THRESHOLD) / 2,
  },
  {
    id: 'bottleneck',
    label: 'Bottleneck (orange)',
    value: (UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD + PATIENCE_RING_BOTTLENECK_THRESHOLD) / 2,
  },
  { id: 'critical', label: 'Critical (red)', value: UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD / 2 },
];

/** `segmentId` here is the BARE segment id (`SegmentDef.id`, e.g. `office_worker`) — the same
 * value used as the customer's `customerId` (see `RestaurantScene#upsertCustomer`'s own
 * `customer_${state.customerId}` naming). It must never be the `customer_`-prefixed variant id
 * `PLAYER_VARIANT_DEFS` uses for its dropdown, or the scene ends up with a doubly-prefixed
 * object name (`customer_customer_office_worker`) that `getObjectByName` can never find. */
function customerXFor(segmentId: string): number {
  const idx = SEGMENTS.findIndex((s) => s.id === segmentId);
  return -8 + Math.max(0, idx) * 4;
}

const PLAYER_VARIANT_DEFS: { id: string; label: string; kind: 'owner' | 'worker' | 'customer' }[] = [
  { id: 'owner_self', label: 'Owner (self)', kind: 'owner' },
  { id: 'owner_rival', label: 'Owner (rival)', kind: 'owner' },
  ...WORKER_PREVIEWS.map((w) => ({ id: `worker_${w.workerId}`, label: `Worker: ${w.role}`, kind: 'worker' as const })),
  ...SEGMENTS.map((s) => ({ id: `customer_${s.id}`, label: `Customer: ${s.name}`, kind: 'customer' as const })),
];

// --- Dish Models: production placement/state variants; the food library owns per-item inspection

const DISH_VARIANT_DEFS: { id: string; label: string }[] = [
  { id: 'carried_1', label: 'Carried by owner — 1 plate' },
  { id: 'carried_2', label: 'Carried by owner — 2 plates' },
  { id: 'carried_3', label: 'Carried by owner — 3 plates (max)' },
  { id: 'table_order_taken', label: 'On table — order taken' },
  { id: 'table_meal_delivered', label: 'On table — meal delivered' },
  { id: 'table_paying', label: 'On table — paying' },
  { id: 'table_dirty', label: 'On table — dirty (cleanup)' },
  { id: 'pass_ready_fresh', label: 'At the pass — ready, fresh' },
  { id: 'pass_ready_stale', label: 'At the pass — ready, stale' },
  { id: 'kitchen_queued_low', label: 'In kitchen — queued (1 ticket)' },
  { id: 'kitchen_queued_high', label: 'In kitchen — queued (4 tickets)' },
  { id: 'state_placed', label: "Order state 'placed' (no visual)" },
  { id: 'state_in_progress', label: "Order state 'in_progress' (no visual)" },
  { id: 'state_delivered', label: "Order state 'delivered' (no visual)" },
  { id: 'state_cancelled', label: "Order state 'cancelled' (no visual)" },
];

// --- Restaurant Models: static variant list, one entry per reusable production entity view ----

const PASS_OPTIONS: { value: string; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fresh', label: 'Ready — fresh' },
  { value: 'stale', label: 'Ready — stale' },
];

const RESTAURANT_VARIANT_DEFS: { id: string; label: string }[] = [
  { id: 'zone_street', label: 'Zone: Street / Entry' },
  { id: 'zone_dining', label: 'Zone: Dining Room' },
  { id: 'zone_pass', label: 'Zone: Service Pass' },
  { id: 'zone_kitchen', label: 'Zone: Kitchen' },
  ...layoutTableIds().map((tid) => ({ id: tid, label: `Table (${tid})` })),
  ...STATIONS.map((s) => ({ id: `station_${s}`, label: `Kitchen station: ${s}` })),
  { id: 'pantry', label: 'Pantry' },
  { id: 'dishwashing', label: 'Dishwashing' },
  { id: 'host_stand', label: 'Host stand' },
  { id: 'upgrade_terminal', label: 'Upgrade terminal' },
  { id: 'queue_line', label: 'Queue line' },
  { id: 'service_pass', label: 'Service pass' },
  { id: 'competitor_restaurant', label: 'Competitor restaurant (rival shell)' },
  { id: 'gap_equipment_failure', label: 'Equipment failure / broken station (no production view)' },
];

/** Toggles `.wireframe` on every material under `root` — applied only to the currently focused
 * asset (never the whole scene), so it reads as "highlight this one object" in composed mode. */
function setWireframe(root: THREE.Object3D, value: boolean): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      if ('wireframe' in m) (m as THREE.MeshStandardMaterial).wireframe = value;
    }
  });
}

/** Disposes every geometry/material under `root` — the same two lines `RestaurantScene#dispose`
 * itself runs per object, reused here because `removeOwner`/`removeCustomer`/`removeWorker`
 * only detach (see `teardownCategoryEntities`'s own comment). Deliberately does NOT touch
 * `Sprite.material.map` — `icon-sprites.ts`'s glyph textures are cached at module scope and
 * shared by every `RestaurantScene` instance, including other harnesses'; disposing one here
 * would break every future sprite requesting that same glyph, anywhere. */
function disposeSubtree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}

const FOCUSED_CAMERA = { height: 2.6, distance: 3.8, angle: 0.6, fov: 42 };

export const assetShowcaseHarness: SceneHarness = createAssetShowcaseHarness();

function createAssetShowcaseHarness(): SceneHarness {
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: RestaurantScene | null = null;
  let camera: CameraController | null = null;
  let frame = 0;
  let observer: ResizeObserver | null = null;

  return {
    id: 'asset-showcase',
    title: 'Asset Showcase',
    description:
      'Player, dish and restaurant models/entities — reused from the real RestaurantScene, ' +
      'focused single-asset and composed in-context modes, with honest diagnostics where no ' +
      'production view exists for a category.',

    mount(container: HTMLElement): void {
      const viewport = document.createElement('div');
      viewport.className = 'harness-viewport';
      const panel = new DevControls('Asset showcase controls');
      container.append(viewport, panel.element);

      scene = new RestaurantScene({ showDebugGrid: false, showCompetitor: false, night: false });
      renderer = new THREE.WebGLRenderer({ antialias: true });
      configureRestaurantRenderer(renderer, scene.scene);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(viewport.clientWidth, Math.max(1, viewport.clientHeight));
      viewport.appendChild(renderer.domElement);

      camera = new CameraController(viewport.clientWidth / Math.max(1, viewport.clientHeight));

      // --- harness-local mutable state, fresh every mount ------------------------------------
      let category: Category = 'player';
      let composed = false;
      let wireframeOn = false;
      let boundsOn = false;
      let currentTarget: THREE.Object3D | null = null;
      let boundsHelper: THREE.Box3Helper | null = null;
      const homePosition = new THREE.Vector3();
      let homeScale = 1;

      let spawnedOwnerIds: string[] = [];
      let spawnedCustomerIds: string[] = [];
      let spawnedWorkerIds: string[] = [];
      /** STORY-030. Ready-dish proxies are NOT part of `applyFloorState`'s `updateFloorState`
       * call (production reconciles them through `EntityViewRegistry`, outside that method —
       * see `RestaurantScene.ts`'s own comment on `updateFloorState`), so `applyFloorState({})`
       * alone does not clear a previously showcased one; both call sites below must track and
       * clear their own ticket id, same discipline as `spawnedCustomerIds`/`spawnedWorkerIds`. */
      let spawnedReadyDishIds: string[] = [];
      let activeOwnerState: OwnerRenderState | null = null;
      let activeWorkerDef: WorkerPreviewDef | null = null;
      let activeCustomerId: string | null = null;
      let activeRestaurantVariantId: string | null = null;
      let rivalFraction = 0;
      let rivalQueueLength = 0;

      // --- shared floor-state helper (Dish/Restaurant categories) ----------------------------
      function applyFloorState(opts: {
        selfOverrides?: Partial<RestaurantSnapshot>;
        rivalOverrides?: Partial<RestaurantSnapshot>;
        customers?: CustomerSnapshot[];
        orders?: OrderSnapshot[];
      }): void {
        if (!scene) return;
        scene.updateFloorState({
          selfRestaurantId: SHOWCASE_RESTAURANT_ID,
          restaurants: [mockSelfRestaurantSnapshot(opts.selfOverrides), mockRivalRestaurantSnapshot(opts.rivalOverrides)],
          customers: opts.customers ?? [],
          orders: opts.orders ?? [],
          events: [],
        });
      }

      /** STORY-030. `removeReadyDish` only detaches (see `teardownCategoryEntities`'s own
       * comment on why `removeOwner`/`removeCustomer`/`removeWorker` never dispose geometry) —
       * this disposes each proxy's own subtree first, same pattern as every other showcased
       * entity. Called before spawning a NEW ready-dish showcase item too, so switching
       * fresh→stale never leaves the old proxy behind under a second ticket id. */
      function clearShowcaseReadyDishes(): void {
        if (!scene) return;
        for (const ticketId of spawnedReadyDishIds) {
          const group = scene.scene.getObjectByName(`ready_dish_${ticketId}`);
          if (group) disposeSubtree(group);
          scene.removeReadyDish(ticketId);
        }
        spawnedReadyDishIds = [];
      }

      // --- visibility / bounds / camera: the focused-vs-composed mechanism -------------------
      function applyVisibility(): void {
        if (!scene) return;
        for (const child of scene.scene.children) {
          if (child instanceof THREE.Light) continue;
          if (child instanceof THREE.GridHelper) continue;
          if (child.name === 'competitor_restaurant') continue;
          if (boundsHelper && child === boundsHelper) continue;
          child.visible = composed ? true : currentTarget !== null && child === currentTarget;
        }
        const showCompetitor =
          currentTarget !== null && currentTarget.name === 'competitor_restaurant'
            ? true
            : composed && category === 'restaurant';
        scene.setCompetitorVisible(showCompetitor);
      }

      function applyBounds(): void {
        if (!scene) return;
        if (boundsHelper) {
          scene.scene.remove(boundsHelper);
          boundsHelper = null;
        }
        if (!boundsOn || !currentTarget) return;
        const box = new THREE.Box3().setFromObject(currentTarget);
        boundsHelper = new THREE.Box3Helper(box, new THREE.Color(STATE_COLORS.opportunity));
        scene.scene.add(boundsHelper);
      }

      function syncCameraSliders(settings: { height: number; distance: number; angle: number; fov: number }): void {
        setCamHeight(settings.height);
        setCamDistance(settings.distance);
        setCamAngle(settings.angle);
        setCamFov(settings.fov);
      }

      /** Focused mode's whole point is inspecting ONE asset at a time, and the showcase spans a
       * 0.3-unit plate through an 18×4 zone plane — a single fixed camera distance/height can
       * frame a customer and crop a zone (or vice versa). So the focused camera is derived from
       * `currentTarget`'s own world-space bounding box (the same `Box3` `applyBounds` already
       * computes) rather than a constant: distance/height scale with the asset's footprint and
       * height, and the look-at target is the box's CENTER, not the object's origin — the origin
       * alone crops anything whose geometry sits mostly above it (a table's badge sprite at
       * y≈1.7-1.95, a worker's role/task glyphs). Composed mode keeps the fixed `DEFAULT_CAMERA`
       * restaurant-layout-harness already established — it needs to show the whole floor, not
       * one asset. */
      function focusedCameraForTarget(target: THREE.Object3D): { height: number; distance: number; angle: number; fov: number } {
        const box = new THREE.Box3().setFromObject(target);
        const size = box.getSize(new THREE.Vector3());
        const groundSpan = Math.max(size.x, size.z, 0.5);
        const verticalSpan = Math.max(size.y, 0.5);
        const clamp = (v: number) => Math.min(34, Math.max(1, v));
        return {
          // The `groundSpan * 0.35` term matters for near-flat wide objects (a zone plane has
          // ~zero `size.y`, so without it `box.max.y * 1.15 + 0.6` alone clamps to the 1-unit
          // floor — a camera at ground level looking almost edge-on across an 18-unit-wide
          // plane, which reads as a thin sliver rather than the zone).
          height: clamp(Math.max(box.max.y * 1.15 + 0.6, verticalSpan * 0.9, groundSpan * 0.35)),
          distance: clamp(Math.max(groundSpan * 1.3 + verticalSpan * 0.4, verticalSpan * 1.8, groundSpan * 1.8)),
          angle: FOCUSED_CAMERA.angle,
          fov: FOCUSED_CAMERA.fov,
        };
      }

      function applyCameraForMode(): void {
        if (!camera) return;
        if (composed) {
          camera.setSettings(DEFAULT_CAMERA);
          camera.setTarget(0, -1);
          syncCameraSliders(DEFAULT_CAMERA);
        } else if (currentTarget) {
          const box = new THREE.Box3().setFromObject(currentTarget);
          const center = box.getCenter(new THREE.Vector3());
          const settings = focusedCameraForTarget(currentTarget);
          camera.setSettings(settings);
          camera.setTarget(center.x, center.z);
          syncCameraSliders(settings);
        } else {
          camera.setSettings(FOCUSED_CAMERA);
          camera.setTarget(0, -1);
          syncCameraSliders(FOCUSED_CAMERA);
        }
      }

      /** The single entry point every category's "select a variant" handler calls once it has
       * applied its own scene-state changes. Resets the transform sliders to neutral (a stale
       * offset from the PREVIOUS asset must never silently apply to this one), and clears
       * wireframe off the outgoing target before it (possibly) becomes invisible or reused. */
      function focusOn(target: THREE.Object3D | null, diagnostics: string[]): void {
        if (currentTarget) setWireframe(currentTarget, false);
        currentTarget = target;
        if (target) {
          homePosition.copy(target.position);
          homeScale = target.scale.x || 1;
          setWireframe(target, wireframeOn);
        } else {
          homePosition.set(0, 0, 0);
          homeScale = 1;
        }
        setPosX(0);
        setPosY(0);
        setPosZ(0);
        setScaleSlider(1);
        applyVisibility();
        applyBounds();
        applyCameraForMode();
        setDiagnostics(diagnostics);
      }

      // --- Player Models ----------------------------------------------------------------------

      function selectPlayerVariant(id: string): void {
        if (!scene) return;
        const def = PLAYER_VARIANT_DEFS.find((d) => d.id === id);
        if (!def) return;
        ownerControls.hidden = def.kind !== 'owner';
        workerControls.hidden = def.kind !== 'worker';
        customerControls.hidden = def.kind !== 'customer';

        let diagnostics: string[] = [];
        let targetName = id;

        if (def.kind === 'owner') {
          const isSelf = id === 'owner_self';
          const ownerId = isSelf ? SHOWCASE_OWNER_ID : SHOWCASE_RIVAL_OWNER_ID;
          targetName = `owner_${ownerId}`;
          activeOwnerState = isSelf
            ? mockOwner(SHOWCASE_OWNER_ID, OWNER_SELF_POS.x, OWNER_SELF_POS.z, true)
            : mockOwner(SHOWCASE_RIVAL_OWNER_ID, OWNER_RIVAL_POS.x, OWNER_RIVAL_POS.z, false, Math.PI);
          setCarrySlider(0);
          setSprintingToggle(false);
          scene.setCarrying(ownerId, 0);
          diagnostics = [
            "OwnerRenderState.sprinting is carried on the wire and by this fixture's own shape, " +
              'but RestaurantScene#upsertOwner never reads it — there is no run-cycle animation ' +
              "for the owner avatar in production. Toggling 'Sprinting' below changes state, not " +
              'pixels; that is the honest result of this control, not a bug.',
          ];
        } else if (def.kind === 'worker') {
          activeWorkerDef = WORKER_PREVIEWS.find((w) => `worker_${w.workerId}` === id) ?? null;
          if (activeWorkerDef) {
            setTaskSelect(WORKER_TASK_SELECT_OPTIONS, activeWorkerDef.initialTaskOption);
            const { task, needsHelp } = taskOptionToTaskAndHelp(activeWorkerDef.initialTaskOption);
            scene.upsertWorker(
              mockWorker(activeWorkerDef.workerId, activeWorkerDef.role, activeWorkerDef.post, activeWorkerDef.x, WORKER_ROW_Z, task, needsHelp),
            );
            if (!activeWorkerDef.rostered) {
              diagnostics = [
                `'${activeWorkerDef.role}' is declared in WORKER_ROLES and fully renderable here ` +
                  "(role color + glyph), but restaurant-layout.json's MVP staff.roster only ever " +
                  "assigns 'cook' and 'server' — a live match never actually spawns this role yet. " +
                  'Shown here for visual coverage, not as evidence it appears in a real match.',
              ];
            }
          }
        } else {
          // `id` is the `customer_`-prefixed variant id; the customer's OWN id (and the scene
          // object name's suffix) is the bare segment id — see `customerXFor`'s own comment.
          const segmentId = id.replace('customer_', '');
          activeCustomerId = segmentId;
          setPatienceSelect(
            PATIENCE_BAND_VALUES.map((b) => ({ value: b.id, label: b.label })),
            'healthy',
          );
          scene.upsertCustomer(mockCustomerRenderState(segmentId, segmentId, customerXFor(segmentId), CUSTOMER_ROW_Z, PATIENCE_BAND_VALUES[0].value));
          diagnostics = [
            'CustomerSnapshot.state (SEATED/EATING/PAYING/LEAVING, exit states like ' +
              "CHOOSE_RIVAL, …) has no visual on the customer's own body — only patienceRemaining " +
              '(the ring color/band) and segmentId (the body tint) are ever rendered per-customer. ' +
              "See Dish Models > table placements for the table's own badge instead.",
          ];
        }

        focusOn(scene.scene.getObjectByName(targetName) ?? null, diagnostics);
      }

      function populatePlayerCategory(): void {
        if (!scene) return;
        scene.upsertOwner(mockOwner(SHOWCASE_OWNER_ID, OWNER_SELF_POS.x, OWNER_SELF_POS.z, true));
        scene.upsertOwner(mockOwner(SHOWCASE_RIVAL_OWNER_ID, OWNER_RIVAL_POS.x, OWNER_RIVAL_POS.z, false, Math.PI));
        spawnedOwnerIds = [SHOWCASE_OWNER_ID, SHOWCASE_RIVAL_OWNER_ID];

        for (const w of WORKER_PREVIEWS) {
          const { task, needsHelp } = taskOptionToTaskAndHelp(w.initialTaskOption);
          scene.upsertWorker(mockWorker(w.workerId, w.role, w.post, w.x, WORKER_ROW_Z, task, needsHelp));
          spawnedWorkerIds.push(w.workerId);
        }

        for (const s of SEGMENTS) {
          scene.upsertCustomer(mockCustomerRenderState(s.id, s.id, customerXFor(s.id), CUSTOMER_ROW_Z, PATIENCE_BAND_VALUES[0].value));
          spawnedCustomerIds.push(s.id);
        }

        selectPlayerVariant(PLAYER_VARIANT_DEFS[0].id);
      }

      // --- Dish Models --------------------------------------------------------------------------

      function selectDishVariant(id: string): void {
        if (!scene) return;
        applyFloorState({});
        for (const station of STATIONS) scene.setStationUpgraded(station, false);

        let target: THREE.Object3D | null = null;
        let diagnostics: string[] = [];

        const noVisualNote = (state: string) =>
          `OrderState '${state}' has no distinct visual anywhere in this codebase. ` +
          "RestaurantScene only ever visually distinguishes 'queued' (a station's queue-box " +
          "stack), 'ready' (a dish-specific plated proxy at the pass), and 'delivered' (the " +
          "authored plate on its table) — 'placed', 'in_progress' and 'cancelled' render as " +
          'nothing beyond the station/' +
          'table\'s own static geometry. Nothing is spawned for this selection; that is the ' +
          'honest result, not a bug.';

        if (id === 'carried_1' || id === 'carried_2' || id === 'carried_3') {
          const count = Number(id.split('_')[1]);
          scene.setCarrying(SHOWCASE_OWNER_ID, count);
          target = scene.scene.getObjectByName(`owner_${SHOWCASE_OWNER_ID}`) ?? null;
          diagnostics = [
            'This legacy capacity control toggles the owner socket markers. Live carried orders ' +
              'use RestaurantScene#setCarriedDishes and the authored model for each dish; inspect ' +
              'those item models in the Arcade Food Library harness.',
          ];
        } else if (id.startsWith('table_')) {
          const tableId = layoutTableIds()[0];
          const dirty = id === 'table_dirty';
          const stateByBadge: Record<string, CustomerState> = {
            table_order_taken: 'ORDERING',
            table_meal_delivered: 'EATING',
            table_paying: 'PAYING',
          };
          const showsMeal = id === 'table_meal_delivered' || id === 'table_paying';
          applyFloorState({
            selfOverrides: {
              tables: defaultTables().map((t) => (t.id === tableId ? { ...t, occupiedBy: dirty ? null : 'showcase_customer', dirty } : t)),
            },
            customers: dirty ? [] : [mockDiningCustomer('showcase_customer', { tableId, state: stateByBadge[id] })],
            orders: showsMeal
              ? [mockOrder('showcase_table_order', DISHES[0].id, { state: 'delivered', tableId })]
              : [],
          });
          target = scene.scene.getObjectByName(tableId) ?? null;
          diagnostics = [
            dirty
              ? "'Dirty' is a cleanup state, not an order state — it is included here because it " +
                "is the table's 4th real badge and the natural end of a dish's lifecycle at the " +
                'table.'
              : showsMeal
                ? 'The delivered dish uses the same authored model shown at the pass and in the ' +
                  'carry socket, with the table badge still showing meal/payment state.'
                : 'The table badge shows that an order was taken; its dish appears here after delivery.',
          ];
        } else if (id === 'pass_ready_fresh' || id === 'pass_ready_stale') {
          const stale = id === 'pass_ready_stale';
          applyFloorState({});
          clearShowcaseReadyDishes();
          const ticketId = 'showcase_pass_order_ticket';
          scene.upsertReadyDish({
            ticketId,
            dishId: DISHES[0].id,
            tableId: layoutTableIds()[0] ?? null,
            readyAgeMs: stale ? ORDER_FRESHNESS_GRACE_MS + 1000 : 0,
            isOldest: true,
          });
          spawnedReadyDishIds = [ticketId];
          target = scene.scene.getObjectByName('service_pass') ?? null;
          diagnostics = [
            // STORY-030. Supersedes the old single-glyph `foodReadyIcon` — every ready ticket
            // now gets its own dish-specific proxy (`RestaurantScene#upsertReadyDish`), keyed
            // off `dishId`, with a READY/GOING COLD label and table chip, tinted healthy/
            // bottleneck by how long it has sat past `ORDER_FRESHNESS_GRACE_MS`.
            'The dish-specific plated proxy at the pass is the production visual for OrderState ' +
              "'ready' (PRD §5.2/§10.1) — geometry is chosen by `dishId`, not by state; freshness " +
              'is carried by the ring color and the READY/GOING COLD chip, never by recoloring ' +
              'the food itself.',
          ];
        } else if (id === 'kitchen_queued_low' || id === 'kitchen_queued_high') {
          const depth = id === 'kitchen_queued_low' ? 1 : 4;
          const orders = Array.from({ length: depth }, (_, i) =>
            mockOrder(`showcase_queue_${i}`, DISHES[0].id, { state: 'queued', station: 'grill' }),
          );
          applyFloorState({ orders });
          target = scene.scene.getObjectByName('station_grill') ?? null;
          diagnostics = [
            'The colored box stack represents how many queued tickets (any dish) are waiting at ' +
              "this station — a per-station count, not a per-dish shape. OrderState 'in_progress' " +
              '(a ticket actively being worked) has no visual distinct from the station simply ' +
              'existing.',
          ];
        } else if (id.startsWith('state_')) {
          diagnostics = [noVisualNote(id.replace('state_', ''))];
        }

        focusOn(target, diagnostics);
      }

      function populateDishCategory(): void {
        if (!scene) return;
        scene.upsertOwner(mockOwner(SHOWCASE_OWNER_ID, OWNER_SELF_POS.x, OWNER_SELF_POS.z, true));
        spawnedOwnerIds = [SHOWCASE_OWNER_ID];
        selectDishVariant(DISH_VARIANT_DEFS[0].id);
      }

      // --- Restaurant Models --------------------------------------------------------------------

      function selectRestaurantVariant(id: string): void {
        if (!scene) return;
        activeRestaurantVariantId = id;

        for (const station of STATIONS) scene.setStationUpgraded(station, false);
        scene.setPantryUpgraded(false);
        rivalFraction = 0;
        rivalQueueLength = 0;
        applyFloorState({});
        clearShowcaseReadyDishes();

        const isStation = id.startsWith('station_');
        const isTable = layoutTableIds().includes(id);
        stationControls.hidden = !isStation;
        pantryControls.hidden = id !== 'pantry';
        servicePassControls.hidden = id !== 'service_pass';
        competitorControls.hidden = id !== 'competitor_restaurant';
        tableControls.hidden = !isTable;

        if (isStation) {
          setStationUpgradedToggle(false);
          setStationQueueSlider(0);
        }
        if (id === 'service_pass') setPassSelect(PASS_OPTIONS, 'none');
        if (id === 'competitor_restaurant') {
          setCompetitorFractionSlider(0);
          setCompetitorQueueSlider(0);
        }
        if (isTable) setTableDirtyToggle(false);

        let target: THREE.Object3D | null = null;
        let diagnostics: string[] = [];

        if (id === 'gap_equipment_failure') {
          diagnostics = [
            "BottleneckKind 'equipment_failure' and StationSnapshot.broken are both declared in " +
              'shared/schemas/game-state.d.ts, but RestaurantScene has no production visual for a ' +
              'broken/malfunctioning station, and the server never publishes stations[] at all (a ' +
              "per-station view is a later story's, per module-map.md). kitchen-bottleneck-" +
              "harness.ts already invented its own bespoke glyph badge for a 'broken' state, but " +
              "that is that harness's own instrumentation for timing comparisons, not a reusable " +
              'production view — per this story\'s own Notes, the gap is flagged here rather than ' +
              'duplicating or inventing a look this codebase has never shipped.',
          ];
        } else {
          target = scene.scene.getObjectByName(id) ?? null;
          if (isStation) {
            const station = id.replace('station_', '');
            if (station !== 'grill') {
              diagnostics = [
                `No upgraded tint is defined for '${station}' — STATION_COLORS_UPGRADED only has ` +
                  "a 'grill' entry (STORY-012's Faster Grill I). The 'Upgraded tint' toggle below " +
                  'will have no visible effect on this station.',
              ];
            }
          } else if (id === 'dishwashing' || id === 'host_stand' || id === 'queue_line') {
            diagnostics = [
              `No RestaurantSnapshot field publishes live state for '${id}' — the static box ` +
                'above is the entirety of its production representation; nothing here is being ' +
                'simplified for this showcase.',
            ];
          } else if (id === 'upgrade_terminal') {
            diagnostics = [
              "The terminal's interaction-range ring and purchase flow are upgrade-preview-" +
                "harness's own scope (PRD §15.5) — this view shows only the static terminal " +
                'fixture, not duplicated here.',
            ];
          }
        }

        focusOn(target, diagnostics);
      }

      function populateRestaurantCategory(): void {
        selectRestaurantVariant(RESTAURANT_VARIANT_DEFS[0].id);
      }

      // --- category switching -------------------------------------------------------------------

      function teardownCategoryEntities(): void {
        if (!scene) return;
        // `RestaurantScene#removeOwner/removeCustomer/removeWorker` only detach the group from
        // the scene graph — unlike `dispose()` (which traverses the WHOLE scene once, at harness
        // teardown), they never free geometry/materials, because nothing in production calls
        // them more than once per entity's whole lifetime. This harness calls them every category
        // switch, so it disposes each entity's own subtree itself first (geometry + material
        // only — never the glyph sprites' textures, which `icon-sprites.ts` caches at MODULE
        // scope and shares across every `RestaurantScene` instance, including other harnesses').
        for (const ownerId of spawnedOwnerIds) {
          const group = scene.scene.getObjectByName(`owner_${ownerId}`);
          if (group) disposeSubtree(group);
          scene.removeOwner(ownerId);
        }
        for (const customerId of spawnedCustomerIds) {
          const group = scene.scene.getObjectByName(`customer_${customerId}`);
          if (group) disposeSubtree(group);
          scene.removeCustomer(customerId);
        }
        for (const workerId of spawnedWorkerIds) {
          const group = scene.scene.getObjectByName(`worker_${workerId}`);
          if (group) disposeSubtree(group);
          scene.removeWorker(workerId);
        }
        spawnedOwnerIds = [];
        spawnedCustomerIds = [];
        spawnedWorkerIds = [];
        clearShowcaseReadyDishes();
        activeOwnerState = null;
        activeWorkerDef = null;
        activeCustomerId = null;
        activeRestaurantVariantId = null;
        for (const station of STATIONS) scene.setStationUpgraded(station, false);
        scene.setPantryUpgraded(false);
        rivalFraction = 0;
        rivalQueueLength = 0;
        applyFloorState({});
      }

      function setCategory(next: Category): void {
        teardownCategoryEntities();
        category = next;
        playerSection.hidden = category !== 'player';
        dishSection.hidden = category !== 'dish';
        restaurantSection.hidden = category !== 'restaurant';
        if (category === 'player') populatePlayerCategory();
        else if (category === 'dish') populateDishCategory();
        else populateRestaurantCategory();
      }

      // --- panel: global controls ----------------------------------------------------------------

      panel.addSelect(
        'Category',
        [
          { value: 'player', label: 'Player Models' },
          { value: 'dish', label: 'Dish Models' },
          { value: 'restaurant', label: 'Restaurant Models' },
        ],
        (v) => setCategory(v as Category),
      );

      panel.addToggle('Composed scene (in context) — off is focused single-asset mode', false, (v) => {
        composed = v;
        applyVisibility();
        applyCameraForMode();
      });

      panel.addSeparator();

      // --- panel: Player Models section -----------------------------------------------------------

      const playerSection = panel.section();
      const playerHeading = document.createElement('h3');
      playerHeading.className = 'section-heading';
      playerHeading.textContent = 'Player Models';
      playerSection.appendChild(playerHeading);

      panel.addSelect(
        'Asset / variant',
        PLAYER_VARIANT_DEFS.map((d) => ({ value: d.id, label: d.label })),
        selectPlayerVariant,
        playerSection,
      );

      const ownerControls = document.createElement('div');
      playerSection.appendChild(ownerControls);
      const setCarrySlider = panel.addSlider(
        'Carried plates',
        { min: 0, max: 3, step: 1, value: 0 },
        (v) => {
          if (activeOwnerState) scene?.setCarrying(activeOwnerState.playerId, Math.round(v));
        },
        ownerControls,
      );
      const setSprintingToggle = panel.addToggle(
        'Sprinting (state flag — no visual in production)',
        false,
        (v) => {
          if (activeOwnerState && scene) {
            activeOwnerState = { ...activeOwnerState, sprinting: v };
            scene.upsertOwner(activeOwnerState);
          }
        },
        ownerControls,
      );

      const workerControls = document.createElement('div');
      playerSection.appendChild(workerControls);
      const setTaskSelect = panel.addSelect(
        'Task / state',
        WORKER_TASK_SELECT_OPTIONS,
        (v) => {
          if (!activeWorkerDef || !scene) return;
          const { task, needsHelp } = taskOptionToTaskAndHelp(v);
          scene.upsertWorker(
            mockWorker(activeWorkerDef.workerId, activeWorkerDef.role, activeWorkerDef.post, activeWorkerDef.x, WORKER_ROW_Z, task, needsHelp),
          );
        },
        workerControls,
      );

      const customerControls = document.createElement('div');
      playerSection.appendChild(customerControls);
      const setPatienceSelect = panel.addSelect(
        'Patience band',
        PATIENCE_BAND_VALUES.map((b) => ({ value: b.id, label: b.label })),
        (v) => {
          if (!activeCustomerId || !scene) return;
          const band = PATIENCE_BAND_VALUES.find((b) => b.id === v);
          if (!band) return;
          // `activeCustomerId` is already the bare segment id (see `selectPlayerVariant`).
          scene.upsertCustomer(mockCustomerRenderState(activeCustomerId, activeCustomerId, customerXFor(activeCustomerId), CUSTOMER_ROW_Z, band.value));
        },
        customerControls,
      );

      // --- panel: Dish Models section --------------------------------------------------------------

      const dishSection = panel.section();
      const dishHeading = document.createElement('h3');
      dishHeading.className = 'section-heading';
      dishHeading.textContent = 'Dish Models';
      dishSection.appendChild(dishHeading);

      panel.addSelect(
        'Asset / variant',
        DISH_VARIANT_DEFS.map((d) => ({ value: d.id, label: d.label })),
        selectDishVariant,
        dishSection,
      );

      panel.addSeparator(dishSection);
      const setDishInfo = panel.addReadout('Dish details', dishSection);
      panel.addSelect(
        'Dish catalogue (inspect models in Arcade Food Library)',
        DISHES.map((d) => ({ value: d.id, label: `${d.name} (${d.category})` })),
        (v) => {
          const dish = DISHES.find((d) => d.id === v);
          if (dish) setDishInfo(`$${dish.suggestedPrice} · steps: ${dish.stationSteps.map((s) => s.station).join(' → ')}`);
        },
        dishSection,
      );
      setDishInfo(`$${DISHES[0].suggestedPrice} · steps: ${DISHES[0].stationSteps.map((s) => s.station).join(' → ')}`);
      const addonDishNames = DISHES.filter((d) => (ADDON_CATEGORIES as readonly string[]).includes(d.category)).map((d) => d.name);
      const addonNote = document.createElement('p');
      addonNote.className = 'muted';
      addonNote.textContent =
        `This list includes ${addonDishNames.length ? addonDishNames.join(', ') : 'the'} — the ` +
        `${ADDON_CATEGORIES.join('/')} add-on categories per setup-rules.js's own ADDON_CATEGORIES ` +
        '— alongside every main course. Every add-on and entree has its own authored GLB in the ' +
        'Arcade Food Library harness.';
      dishSection.appendChild(addonNote);

      // --- panel: Restaurant Models section --------------------------------------------------------

      const restaurantSection = panel.section();
      const restaurantHeading = document.createElement('h3');
      restaurantHeading.className = 'section-heading';
      restaurantHeading.textContent = 'Restaurant Models';
      restaurantSection.appendChild(restaurantHeading);

      panel.addSelect(
        'Asset / variant',
        RESTAURANT_VARIANT_DEFS.map((d) => ({ value: d.id, label: d.label })),
        selectRestaurantVariant,
        restaurantSection,
      );

      const stationControls = document.createElement('div');
      restaurantSection.appendChild(stationControls);
      const setStationUpgradedToggle = panel.addToggle(
        'Upgraded tint',
        false,
        (v) => {
          if (!scene || !activeRestaurantVariantId?.startsWith('station_')) return;
          scene.setStationUpgraded(activeRestaurantVariantId.replace('station_', '') as Station, v);
        },
        stationControls,
      );
      const setStationQueueSlider = panel.addSlider(
        'Queue depth (tickets)',
        { min: 0, max: 4, step: 1, value: 0 },
        (v) => {
          if (!activeRestaurantVariantId?.startsWith('station_')) return;
          const station = activeRestaurantVariantId.replace('station_', '') as Station;
          const orders = Array.from({ length: Math.round(v) }, (_, i) => mockOrder(`showcase_rq_${i}`, DISHES[0].id, { state: 'queued', station }));
          applyFloorState({ orders });
        },
        stationControls,
      );

      const pantryControls = document.createElement('div');
      restaurantSection.appendChild(pantryControls);
      panel.addToggle('Upgraded (Pantry Shelves)', false, (v) => scene?.setPantryUpgraded(v), pantryControls);

      const servicePassControls = document.createElement('div');
      restaurantSection.appendChild(servicePassControls);
      const setPassSelect = panel.addSelect(
        // STORY-030. Was "Food-ready icon" — this now toggles a dish-specific plated proxy
        // (`RestaurantScene#upsertReadyDish`), not a single generic glyph.
        'Ready-dish proxy',
        PASS_OPTIONS,
        (v) => {
          clearShowcaseReadyDishes();
          if (v === 'none' || !scene) return;
          const ticketId = 'showcase_pass_order_ticket';
          scene.upsertReadyDish({
            ticketId,
            dishId: DISHES[0].id,
            tableId: layoutTableIds()[0] ?? null,
            readyAgeMs: v === 'stale' ? ORDER_FRESHNESS_GRACE_MS + 1000 : 0,
            isOldest: true,
          });
          spawnedReadyDishIds = [ticketId];
        },
        servicePassControls,
      );

      const competitorControls = document.createElement('div');
      restaurantSection.appendChild(competitorControls);
      function applyCompetitorState(): void {
        applyFloorState({ rivalOverrides: { seatsTotal: 12, seatsAvailable: Math.round(12 * (1 - rivalFraction)), queueLength: rivalQueueLength } });
      }
      const setCompetitorFractionSlider = panel.addSlider(
        'Occupied fraction',
        { min: 0, max: 1, step: 0.1, value: 0 },
        (v) => {
          rivalFraction = v;
          applyCompetitorState();
        },
        competitorControls,
      );
      const setCompetitorQueueSlider = panel.addSlider(
        'Queue length',
        { min: 0, max: 6, step: 1, value: 0 },
        (v) => {
          rivalQueueLength = Math.round(v);
          applyCompetitorState();
        },
        competitorControls,
      );

      const tableControls = document.createElement('div');
      restaurantSection.appendChild(tableControls);
      const setTableDirtyToggle = panel.addToggle(
        'Dirty',
        false,
        (v) => {
          if (!activeRestaurantVariantId) return;
          applyFloorState({
            selfOverrides: { tables: defaultTables().map((t) => (t.id === activeRestaurantVariantId ? { ...t, dirty: v } : t)) },
          });
        },
        tableControls,
      );

      panel.addSeparator();
      const setDiagnostics = panel.addDiagnostics('Diagnostics');

      panel.addSeparator();
      panel.addToggle('Debug grid', false, (v) => scene?.setDebugGrid(v));
      panel.addToggle('Night lighting', false, (v) => scene?.setNight(v));
      panel.addToggle('Shadows', false, (v) => {
        if (renderer) renderer.shadowMap.enabled = v;
        scene?.scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = v;
            mesh.receiveShadow = v;
          }
          const light = obj as THREE.DirectionalLight;
          if (light.isDirectionalLight) {
            light.castShadow = v;
            // THREE.DirectionalLight's default shadow camera is an orthographic ±5 box centered
            // on the light's target — far smaller than `restaurant-layout.json`'s 18×24 floor
            // (`bounds`), so most of the floor would silently receive no shadow at all. Widen it
            // once to cover the real footprint with margin, rather than shipping a toggle that
            // only visibly does anything near the origin.
            const cam = light.shadow.camera;
            cam.left = -16;
            cam.right = 16;
            cam.top = 16;
            cam.bottom = -16;
            cam.updateProjectionMatrix();
          }
        });
      });
      panel.addToggle('Wireframe (selected asset)', false, (v) => {
        wireframeOn = v;
        if (currentTarget) setWireframe(currentTarget, v);
      });
      panel.addToggle('Bounds box (selected asset)', false, (v) => {
        boundsOn = v;
        applyBounds();
      });

      panel.addSeparator();
      const setPosX = panel.addSlider('Position offset X', { min: -4, max: 4, step: 0.1, value: 0 }, (v) => {
        if (currentTarget) currentTarget.position.x = homePosition.x + v;
      });
      const setPosY = panel.addSlider('Position offset Y', { min: -2, max: 3, step: 0.1, value: 0 }, (v) => {
        if (currentTarget) currentTarget.position.y = homePosition.y + v;
      });
      const setPosZ = panel.addSlider('Position offset Z', { min: -4, max: 4, step: 0.1, value: 0 }, (v) => {
        if (currentTarget) currentTarget.position.z = homePosition.z + v;
      });
      const setScaleSlider = panel.addSlider('Scale', { min: 0.3, max: 2.5, step: 0.1, value: 1 }, (v) => {
        if (currentTarget) currentTarget.scale.setScalar(homeScale * v);
      });
      panel.addButton('Reset transform', () => {
        setPosX(0);
        setPosY(0);
        setPosZ(0);
        setScaleSlider(1);
        if (currentTarget) {
          currentTarget.position.copy(homePosition);
          currentTarget.scale.setScalar(homeScale);
        }
      });

      panel.addSeparator();
      const setCamHeight = panel.addSlider('Camera height', { min: 1, max: 34, step: 0.5, value: FOCUSED_CAMERA.height }, (v) => camera?.setSettings({ height: v }));
      const setCamDistance = panel.addSlider('Camera distance', { min: 1, max: 34, step: 0.5, value: FOCUSED_CAMERA.distance }, (v) => camera?.setSettings({ distance: v }));
      const setCamAngle = panel.addSlider('Camera angle', { min: -Math.PI, max: Math.PI, step: 0.02, value: FOCUSED_CAMERA.angle }, (v) => camera?.setSettings({ angle: v }));
      const setCamFov = panel.addSlider('Field of view', { min: 20, max: 80, step: 1, value: FOCUSED_CAMERA.fov }, (v) => camera?.setSettings({ fov: v }));
      panel.addButton('Reset camera', () => applyCameraForMode());

      const fpsReadout = panel.addReadout('FPS');

      // --- resize + render loop -------------------------------------------------------------------

      const resize = () => {
        const w = viewport.clientWidth;
        const h = Math.max(1, viewport.clientHeight);
        renderer?.setSize(w, h);
        camera?.setAspect(w / h);
      };
      observer = new ResizeObserver(resize);
      observer.observe(viewport);

      setCategory('player');
      const mountedScene = scene;
      void scene.sceneryReady.then(() => {
        if (scene !== mountedScene) return;
        applyVisibility();
        applyBounds();
        applyCameraForMode();
      });

      let elapsedTotal = 0;
      let last = performance.now();
      let fpsAccum = 0;
      let fpsFrames = 0;

      const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        elapsedTotal += dt;

        fpsAccum += dt;
        fpsFrames += 1;
        if (fpsAccum >= 0.5) {
          fpsReadout((fpsFrames / fpsAccum).toFixed(0));
          fpsAccum = 0;
          fpsFrames = 0;
        }

        if (scene && camera) {
          scene.updateCustomerAnimations(elapsedTotal);
          // STORY-030. Same per-frame split as `updateCustomerAnimations` — pulses whichever
          // showcased ready-dish proxy is marked `isOldest` (see the two `upsertReadyDish` call
          // sites below).
          scene.updateReadyDishAnimations(elapsedTotal);
          scene.updateWorkerAnimations();
          if (boundsOn && boundsHelper && currentTarget) boundsHelper.box.setFromObject(currentTarget);
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
      scene?.dispose();
      scene = null;
      renderer?.dispose();
      renderer = null;
      camera = null;
    },
  };
}
