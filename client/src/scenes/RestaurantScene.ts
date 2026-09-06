// The restaurant scene graph, built from shared/game-data/restaurant-layout.json.
//
// This module is deliberately free of networking and game rules: it takes a layout and a
// render state and produces/updates Three.js objects. PRD §15 "The key requirement is
// separation: game rules should emit state, and scene-view code should render state." That
// is what lets harnesses/ mount this same scene with mocked state and no backend.

import * as THREE from 'three';
import layout from '../../../shared/game-data/restaurant-layout.json';
import { STATIONS, type Station } from '../../../shared/schemas/messages';
import type {
  CustomerSnapshot,
  OrderSnapshot,
  RestaurantSnapshot,
} from '../../../shared/schemas/game-state';
import type { SnapshotEventEntry } from '../../../shared/schemas/messages';
import {
  ORDER_FRESHNESS_GRACE_MS,
  HUD_LONG_ENTRY_QUEUE_THRESHOLD,
  HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD,
  UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD,
  PATIENCE_RING_ATTENTION_THRESHOLD,
  PATIENCE_RING_BOTTLENECK_THRESHOLD,
  STATION_QUEUE_ATTENTION_THRESHOLD,
} from '../../../shared/constants/tuning';
import { patienceColorBand, stationQueueColorBand } from '../../../shared/game-logic/state-color-bands';
import {
  STATE_COLORS,
  colorForBand,
  WORKER_ROLE_COLORS,
  WORKER_ROLE_COLOR_FALLBACK,
  CUSTOMER_SEGMENT_COLORS,
  CUSTOMER_SEGMENT_COLOR_FALLBACK,
} from '../game/state-colors';
import { createGlyphSprite, createLabelSprite, setGlyphSpriteColor } from './icon-sprites';

export interface OwnerRenderState {
  playerId: string;
  position: { x: number; y: number; z: number };
  facing: number;
  sprinting?: boolean;
  isSelf?: boolean;
}

/** STORY-016. `EntityViewRegistry`'s two new spawn/despawn kinds — customers and workers —
 * reconcile against these. `CustomerRenderState` is a deliberately NARROW slice of
 * `CustomerSnapshot` (just what the ring/posture need), unlike `WorkerRenderState`, which is the
 * wire shape verbatim (extracted via `NonNullable<...>` rather than redeclared, so it can never
 * silently drift from `RestaurantSnapshot.workers[]`'s own shape). */
export interface CustomerRenderState {
  customerId: string;
  position: { x: number; y: number; z: number };
  patienceRemaining: number;
  unhappy: boolean;
  /** §14 MVP entity table "segment-cued customers" — an id in customer-segments.json, tinting
   * the body (see `state-colors.ts#CUSTOMER_SEGMENT_COLORS`); independent of the patience ring. */
  segmentId: string;
}
export type WorkerRenderState = NonNullable<RestaurantSnapshot['workers']>[number];

/** STORY-030. PRD §5.2 "Ready-food clarity" — one dish-specific proxy per ready `OrderSnapshot`
 * at the service pass, replacing STORY-016's generic `foodReadyIcon` glyph. A deliberately
 * NARROW slice of `OrderSnapshot` (same discipline as `CustomerRenderState` above), plus
 * `isOldest`, which is NOT a wire field — it is derived by the caller (`GameClient.ts`, the same
 * place `selfCustomers`/`selfRestaurantForWorkers` are already derived before reconciling) by
 * comparing `readyAgeMs` across every currently-ready ticket for this restaurant. That is a
 * rendering-only ranking of already-published data, not new game state (`conventions.md`
 * Pattern 4/11) — the same category of derivation `updateRivalActivity`'s own `occupiedFraction`
 * already does from public fields. */
export interface ReadyDishRenderState {
  ticketId: string;
  dishId: string;
  tableId: string | null;
  readyAgeMs: number;
  isOldest: boolean;
}

/** A table's derived on-floor badge — PRD §4.4 "Tables show order, meal, payment, and cleanup
 * states". `dirty` always wins (it blocks seating, the most urgent of the four), and is checked
 * before occupancy; see `updateTableBadges`. */
type TableBadgeKind = 'order_taken' | 'meal_delivered' | 'paying' | 'dirty' | null;

const TABLE_BADGE_GLYPHS: Record<Exclude<TableBadgeKind, null>, string> = {
  order_taken: 'O',
  meal_delivered: 'F',
  paying: '$',
  dirty: 'X',
};

/** Table badges use the full six-color vocabulary, not only the four severity bands
 * `colorForBand` maps — "paying" is a revenue MOMENT (§14 blue "opportunity"), not a severity
 * level, so it is looked up here directly rather than forced through `colorForBand`. */
const TABLE_BADGE_COLORS: Record<Exclude<TableBadgeKind, null>, number> = {
  order_taken: STATE_COLORS.attention,
  meal_delivered: STATE_COLORS.healthy,
  paying: STATE_COLORS.opportunity,
  dirty: STATE_COLORS.bottleneck,
};

/** PRD §4.4/§14 "Worker role icon" — one letter per `WorkerRole`, distinct from the table-badge
 * glyphs above so a player never confuses the two vocabularies. */
const WORKER_ROLE_GLYPHS: Record<string, string> = {
  cook: 'C',
  server: 'S',
  prep_worker: 'P',
  host: 'H',
};

/** PRD §17's closed `WorkerTaskKind` vocabulary, one SINGLE-CHARACTER glyph each — a live
 * legibility check on the first cut of this file used two-character codes (`ST`, `TK`, `CL`,
 * `PY`) and found them genuinely hard to read at the default camera height even zoomed in for a
 * screenshot (roughly 6px per character at ~32 units away, fov 46): "legible from the default
 * camera height without zooming" is this story's own AC, not a nice-to-have. One character per
 * task, all seven mutually distinct (collisions with `WORKER_ROLE_GLYPHS` are fine — the two
 * vocabularies render at different heights above the worker and are never read as one glyph). */
const WORKER_TASK_GLYPHS: Record<string, string> = {
  tend_station: 'K',
  restock: 'R',
  deliver_order: 'D',
  seat_party: 'A',
  take_order: 'T',
  clear_table: 'X',
  collect_payment: '$',
};

/** How many queued-ticket boxes a station's indicator shows before it just reads "a lot" —
 * matches `MAX_VISIBLE_CARRY_PLATES`'s own reasoning: a 5th box would be lost behind the other
 * four at this camera distance anyway, and the color band already carries "this is bad" past
 * that point. */
const MAX_VISIBLE_QUEUE_BOXES = 4;

/** Local-space offsets for the two station indicators, relative to the station's own mesh.
 * DELIBERATELY DIFFERENT ANCHORS as well as different shapes/colors — PRD §8 "distinct signals
 * for each" bottleneck, applied literally: the queue bar sits front-left and grows as a stack of
 * boxes, the shortage glyph sits back-right as a single fixed circular icon, so the two bottleneck
 * kinds can never be confused even at a glance from the default camera height. */
const STATION_QUEUE_ANCHOR = { x: -0.9, y: 0.7, z: -0.5 } as const;
const STATION_SHORTAGE_ANCHOR = { x: 0.9, y: 1.1, z: 0.5 } as const;

// PRD §14 "Visual state language" — the shared palette. STORY-016 extends this to the full
// green/yellow/orange/red/blue/purple semantics; Milestone 0 needs only structural colors.
export const ZONE_COLORS: Record<string, number> = {
  street: 0x3a4046,
  dining: 0x54606b,
  pass: 0x6b7480,
  kitchen: 0x474f58,
};

const STATION_COLORS: Record<string, number> = {
  prep: 0x4a90d9,
  grill: 0xd9734a,
  oven: 0xd9a74a,
  plating: 0x7ac74f,
};

/** STORY-012 "Faster Grill I": a brighter, hotter-reading tint of the same station color, not
 * a new palette entry — full state-driven visual language is STORY-016's job (see this file's
 * header comment on `ZONE_COLORS`), this is a single targeted swap. */
const STATION_COLORS_UPGRADED: Record<string, number> = {
  grill: 0xff8a4a,
};

/** PRD §7 baseline before any Serving Tray upgrade. */
const MAX_VISIBLE_CARRY_PLATES = 3;

// --- STORY-030: PRD §5.2/§10.1 dish-specific ready-food proxies at the service pass ----------
//
// Supersedes STORY-016's single generic `foodReadyIcon` glyph sprite (removed by this story —
// see `updateFloorState`'s own comment on why this is a full replacement, not an addition).

/** How many ready tickets the pass can show at once without any two proxies overlapping — a
 * fixed slot layout (like `MAX_VISIBLE_QUEUE_BOXES`/`MAX_VISIBLE_CARRY_PLATES` above) rather
 * than a dynamic reflow, so an already-visible dish never jumps sideways just because a NEWER
 * ticket became ready. 8 comfortably outpaces kitchen throughput for the MVP's 4-station,
 * single-cook line; a 9th simultaneous ready ticket (never observed in practice) falls back to
 * slot 0, the same "past this point the exact position stops mattering" call
 * `MAX_VISIBLE_QUEUE_BOXES`'s own comment makes for its 5th box. */
const MAX_READY_DISH_SLOTS = 8;
/** Local-space X range across the service pass's own 16-unit width (`buildEntity`'s
 * `service_pass` box), leaving a margin so a plate's own radius never clips past the pass edge. */
const READY_DISH_SLOT_X_RANGE = 6.5;

function readyDishSlotPosition(slot: number): number {
  if (MAX_READY_DISH_SLOTS <= 1) return 0;
  const t = slot / (MAX_READY_DISH_SLOTS - 1); // 0..1
  return -READY_DISH_SLOT_X_RANGE + t * (READY_DISH_SLOT_X_RANGE * 2);
}

/** PRD §5.2 "target table chip, for example T04" — `OrderSnapshot.tableId` is the layout's own
 * `table_<n>` id (`restaurant-layout.json`), never itself formatted for display; this is the
 * ONE place that formatting happens; `null` (a party with no table yet) reads as a dash rather
 * than a misleading table number. */
function formatTableChip(tableId: string | null): string {
  if (!tableId) return '—';
  const n = tableId.replace(/^table_/, '');
  return `T${n.padStart(2, '0')}`;
}

/** Food-part colors — a plate's own dish identity, DELIBERATELY DISTINCT from the six
 * `STATE_COLORS` semantic hues (PRD §14) so a diner's actual food is never mistaken for a
 * freshness/urgency signal; freshness is carried entirely by `readyDishStateRing`/the
 * READY/GOING COLD chip below, never by recoloring the food geometry itself. */
const DISH_COLORS = {
  plate: 0xece5d4,
  bunTan: 0xd9a860,
  pattyBrown: 0x5a3826,
  cheeseYellow: 0xf2c230,
  lettuceGreen: 0x6fbf3f,
  bowlCeramic: 0xe4dcc8,
  saladLeaf: 0x5fd13a,
  chickenTan: 0xdba86a,
  chipGold: 0xe0c060,
  nachoTopping: 0xe3a83b,
  cupWhite: 0xf5f2ea,
  coffeeDark: 0x2b1c14,
  genericFood: 0xc9a15a,
} as const;

/** One flat plate mesh, shared shape under every dish proxy below (PRD §10.1 "plate proxy") —
 * built fresh per call (not cached/instanced) since `buildDishProxy` itself is only called once
 * per ready-dish ENTITY (`upsertReadyDish`, on first sight of a `ticketId`), never per frame. */
function buildPlate(radius = 0.5): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.05, 24),
    new THREE.MeshStandardMaterial({ color: DISH_COLORS.plate, roughness: 0.5 }),
  );
}

/** PRD §10.1 "Smash Burger: bun, patty, cheese, lettuce stack on a plate". */
function buildSmashBurgerProxy(): THREE.Group {
  const group = new THREE.Group();
  const plate = buildPlate();
  plate.position.y = 0.025;
  group.add(plate);
  const bunBottom = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.32, 0.12, 16),
    new THREE.MeshStandardMaterial({ color: DISH_COLORS.bunTan, roughness: 0.6 }),
  );
  bunBottom.position.y = 0.11;
  group.add(bunBottom);
  const patty = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.26, 0.08, 16),
    new THREE.MeshStandardMaterial({ color: DISH_COLORS.pattyBrown, roughness: 0.7 }),
  );
  patty.position.y = 0.21;
  group.add(patty);
  // Diamond-rotated so its corners peek past the patty's circular edge — the single detail that
  // reads as "cheese slice" rather than "another patty" at the default camera height.
  const cheese = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.02, 0.46),
    new THREE.MeshStandardMaterial({ color: DISH_COLORS.cheeseYellow, roughness: 0.4 }),
  );
  cheese.position.y = 0.26;
  cheese.rotation.y = Math.PI / 4;
  group.add(cheese);
  const lettuce = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.3, 0),
    new THREE.MeshStandardMaterial({ color: DISH_COLORS.lettuceGreen, roughness: 0.8 }),
  );
  lettuce.scale.y = 0.35;
  lettuce.position.y = 0.3;
  group.add(lettuce);
  const bunTop = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: DISH_COLORS.bunTan, roughness: 0.6 }),
  );
  bunTop.position.y = 0.38;
  group.add(bunTop);
  return group;
}

/** PRD §10.1 "Caesar Salad: bowl with bright green leaf cluster". */
function buildCaesarSaladProxy(): THREE.Group {
  const group = new THREE.Group();
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.24, 0.22, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: DISH_COLORS.bowlCeramic, roughness: 0.5, side: THREE.DoubleSide }),
  );
  bowl.position.y = 0.11;
  group.add(bowl);
  const bowlBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.24, 0.03, 20),
    new THREE.MeshStandardMaterial({ color: DISH_COLORS.bowlCeramic, roughness: 0.5 }),
  );
  bowlBase.position.y = 0.015;
  group.add(bowlBase);
  // A small cluster of squashed icosahedra rather than one big blob — "leaf cluster" reads as
  // many individual leaves catching light differently, which one uniform mound would not.
  const leafOffsets: [number, number][] = [
    [0, 0], [0.14, 0.1], [-0.13, 0.08], [0.05, -0.14], [-0.08, -0.1],
  ];
  for (const [ox, oz] of leafOffsets) {
    const leaf = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.14, 0),
      new THREE.MeshStandardMaterial({ color: DISH_COLORS.saladLeaf, roughness: 0.85 }),
    );
    leaf.scale.y = 0.5;
    leaf.position.set(ox, 0.24, oz);
    group.add(leaf);
  }
  return group;
}

/** PRD §10.1 "Chicken Sandwich: long bun with tan filling and green accent". */
function buildChickenSandwichProxy(): THREE.Group {
  const group = new THREE.Group();
  const plate = buildPlate(0.52);
  plate.position.y = 0.025;
  group.add(plate);
  const bun = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.14, 0.42, 4, 10),
    new THREE.MeshStandardMaterial({ color: DISH_COLORS.bunTan, roughness: 0.6 }),
  );
  bun.rotation.z = Math.PI / 2;
  bun.position.y = 0.19;
  group.add(bun);
  const filling = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.07, 0.22),
    new THREE.MeshStandardMaterial({ color: DISH_COLORS.chickenTan, roughness: 0.6 }),
  );
  filling.position.y = 0.19;
  group.add(filling);
  // The "green accent" — a thin strip peeking out from both long edges of the filling, exactly
  // the way real sandwich lettuce overhangs the bun.
  for (const oz of [-0.11, 0.11]) {
    const accent = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.03, 0.05),
      new THREE.MeshStandardMaterial({ color: DISH_COLORS.lettuceGreen, roughness: 0.8 }),
    );
    accent.position.set(0, 0.225, oz);
    group.add(accent);
  }
  return group;
}

/** PRD §10.1 "Nachos: wide bowl/plate with angular chips and orange topping". */
function buildNachosProxy(): THREE.Group {
  const group = new THREE.Group();
  const plate = buildPlate(0.56);
  plate.position.y = 0.025;
  group.add(plate);
  // "Angular chips" — flat rotated boxes (not cones/cylinders, which read as round) piled at
  // varying heights/rotations so the cluster silhouette itself looks jagged from above.
  const chipSpots: [number, number, number][] = [
    [0, 0, 0], [0.14, 0.03, 0.1], [-0.15, 0.03, 0.08], [0.08, 0.06, -0.12],
    [-0.1, 0.06, -0.1], [0.02, 0.09, 0.02],
  ];
  for (const [ox, oy, oz] of chipSpots) {
    const chip = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.02, 0.13),
      new THREE.MeshStandardMaterial({ color: DISH_COLORS.chipGold, roughness: 0.6 }),
    );
    chip.position.set(ox, 0.06 + oy, oz);
    chip.rotation.y = (ox + oz) * 3.1;
    chip.rotation.x = oy * 2.4;
    group.add(chip);
  }
  // Orange topping — small melted-cheese/salsa blobs scattered across the chip pile.
  const toppingSpots: [number, number][] = [[0.05, 0.02], [-0.08, -0.03], [0.1, -0.1], [-0.03, 0.11]];
  for (const [ox, oz] of toppingSpots) {
    const topping = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 8, 6),
      new THREE.MeshStandardMaterial({ color: DISH_COLORS.nachoTopping, roughness: 0.5 }),
    );
    topping.scale.y = 0.6;
    topping.position.set(ox, 0.13, oz);
    group.add(topping);
  }
  return group;
}

/** PRD §10.1 "Espresso: small white cup with dark circular coffee surface". */
function buildEspressoProxy(): THREE.Group {
  const group = new THREE.Group();
  const saucer = buildPlate(0.32);
  saucer.position.y = 0.025;
  group.add(saucer);
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.14, 0.2, 16, 1, true),
    new THREE.MeshStandardMaterial({ color: DISH_COLORS.cupWhite, roughness: 0.35, side: THREE.DoubleSide }),
  );
  cup.position.y = 0.15;
  group.add(cup);
  const cupBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.03, 16),
    new THREE.MeshStandardMaterial({ color: DISH_COLORS.cupWhite, roughness: 0.35 }),
  );
  cupBase.position.y = 0.065;
  group.add(cupBase);
  const coffee = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 0.02, 16),
    new THREE.MeshStandardMaterial({ color: DISH_COLORS.coffeeDark, roughness: 0.25 }),
  );
  coffee.position.y = 0.25;
  group.add(coffee);
  const handle = new THREE.Mesh(
    new THREE.TorusGeometry(0.07, 0.018, 8, 16, Math.PI),
    new THREE.MeshStandardMaterial({ color: DISH_COLORS.cupWhite, roughness: 0.35 }),
  );
  handle.rotation.z = Math.PI / 2;
  handle.rotation.y = Math.PI / 2;
  handle.position.set(0, 0.15, 0.17);
  group.add(handle);
  return group;
}

/** Any catalogue dish PRD §10.1's asset table does not (yet) name a proxy for — `dishes.json`
 * has 8 entries, the table names 5; rather than crash or silently render nothing for
 * `pasta_primavera`/`steak_frites`/`cheesecake`, this reuses the plate-plus-mound shape every
 * other proxy is built from, in a neutral tan that reads as "some dish" without impersonating
 * any of the five named silhouettes. Matches `WORKER_ROLE_COLOR_FALLBACK`/
 * `CUSTOMER_SEGMENT_COLOR_FALLBACK`'s own precedent for a catalogue that may grow. */
function buildGenericDishProxy(): THREE.Group {
  const group = new THREE.Group();
  const plate = buildPlate();
  plate.position.y = 0.025;
  group.add(plate);
  const mound = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 14, 10),
    new THREE.MeshStandardMaterial({ color: DISH_COLORS.genericFood, roughness: 0.7 }),
  );
  mound.scale.y = 0.5;
  mound.position.y = 0.16;
  group.add(mound);
  return group;
}

/** PRD §5.2 "keyed off `shared/game-data/`'s real dish ids" — every key below is a literal
 * `dishes.json` `id`, not an invented string; `buildDishProxy` falls back to
 * `buildGenericDishProxy` for any id not listed (see that function's own comment). */
const DISH_PROXY_BUILDERS: Record<string, () => THREE.Group> = {
  smash_burger: buildSmashBurgerProxy,
  caesar_salad: buildCaesarSaladProxy,
  chicken_sandwich: buildChickenSandwichProxy,
  nachos: buildNachosProxy,
  espresso: buildEspressoProxy,
};

function buildDishProxy(dishId: string): THREE.Group {
  const builder = DISH_PROXY_BUILDERS[dishId] ?? buildGenericDishProxy;
  return builder();
}

export interface RestaurantSceneOptions {
  showDebugGrid?: boolean;
  showCompetitor?: boolean;
  night?: boolean;
}

export class RestaurantScene {
  readonly scene = new THREE.Scene();
  readonly layout = layout;

  private readonly owners = new Map<string, THREE.Group>();
  private readonly grid: THREE.GridHelper;
  private readonly competitor: THREE.Group;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly ambient: THREE.AmbientLight;
  private readonly ambientBaseColor = 0xffffff;

  // --- STORY-016: 3D visual state language --------------------------------------------------
  /** Live customers and workers — spawn/despawn entities, reconciled by `EntityViewRegistry`
   * the same way `owners` is, one kind each ('customers', 'workers'), from `GameClient.ts`. */
  private readonly customers = new Map<string, THREE.Group>();
  private readonly workers = new Map<string, THREE.Group>();
  /** One lazily-built badge sprite per table id — tables themselves are static (built once from
   * `layout.entities`), so only the badge shown above one needs to change per snapshot. */
  private readonly tableBadges = new Map<string, THREE.Sprite>();
  /** One queue-box stack + one shortage glyph per station — built once in the constructor,
   * since the station set is fixed (`STATIONS`), unlike tables/customers/workers. */
  private readonly stationIndicators = new Map<
    Station,
    { queueBoxes: THREE.Mesh[]; shortageIcon: THREE.Sprite }
  >();
  /** STORY-030. Spawn/despawn ready-dish proxies at the service pass, one per ready ticket —
   * same seam as `customers`/`workers` above (`GameClient.ts` reconciles a 'readyDishes' kind
   * through `EntityViewRegistry`), unlike the fixed-count `tableBadges`/`stationIndicators`
   * above. Supersedes STORY-016's single `foodReadyIcon` sprite (removed). */
  private readonly readyDishes = new Map<string, THREE.Group>();
  /** Which of `MAX_READY_DISH_SLOTS` fixed pass positions each live ticket currently occupies —
   * see `readyDishSlotPosition`'s own comment on why slots are stable, not reflowed. */
  private readonly readyDishSlots = new Map<string, number>();
  private readonly readyDishSlotUsed: boolean[] = new Array(MAX_READY_DISH_SLOTS).fill(false);
  /** The rival's own "table" boxes and sign, captured from `buildCompetitor()` so
   * `updateRivalActivity` can recolor them without rebuilding the shell. */
  private readonly competitorTables: THREE.Mesh[] = [];
  private readonly competitorSign: THREE.Mesh;
  constructor(options: RestaurantSceneOptions = {}) {
    this.scene.background = new THREE.Color(0x1b1f24);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.75);
    this.scene.add(this.ambient);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.15);
    this.keyLight.position.set(8, 16, 6);
    this.scene.add(this.keyLight);

    this.buildZones();
    this.buildEntities();
    this.buildStationIndicators();

    this.grid = new THREE.GridHelper(28, 28, 0x7fd4ff, 0x38424c);
    this.grid.position.y = 0.02;
    this.grid.visible = options.showDebugGrid ?? false;
    this.scene.add(this.grid);

    this.competitor = this.buildCompetitor();
    this.competitor.visible = options.showCompetitor ?? true;
    this.scene.add(this.competitor);
    this.competitorSign = this.competitor.getObjectByName('competitor_sign') as THREE.Mesh;

    this.setNight(options.night ?? false);
  }

  private buildZones(): void {
    for (const zone of this.layout.zones) {
      const [minX, minZ] = zone.min;
      const [maxX, maxZ] = zone.max;
      const width = maxX - minX;
      const depth = maxZ - minZ;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, depth),
        new THREE.MeshStandardMaterial({ color: ZONE_COLORS[zone.id] ?? 0x505860, roughness: 0.95 }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(minX + width / 2, 0, minZ + depth / 2);
      mesh.name = `zone_${zone.id}`;
      this.scene.add(mesh);
    }
  }

  private buildEntities(): void {
    for (const entity of this.layout.entities) {
      const mesh = this.buildEntity(entity);
      if (!mesh) continue;
      const [x, y, z] = entity.position as number[];
      mesh.position.set(x, y, z);
      mesh.name = entity.id;
      this.scene.add(mesh);
    }
  }

  private buildEntity(entity: { type: string; station?: string; seats?: number }): THREE.Object3D | null {
    switch (entity.type) {
      case 'table': {
        const group = new THREE.Group();
        const top = new THREE.Mesh(
          new THREE.CylinderGeometry(0.9, 0.9, 0.12, 20),
          new THREE.MeshStandardMaterial({ color: 0xcbb79a, roughness: 0.7 }),
        );
        top.position.y = 0.75;
        group.add(top);
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.12, 0.75, 10),
          new THREE.MeshStandardMaterial({ color: 0x6b5b47 }),
        );
        leg.position.y = 0.375;
        group.add(leg);
        for (let i = 0; i < (entity.seats ?? 2); i += 1) {
          const angle = (i / (entity.seats ?? 2)) * Math.PI * 2;
          const chair = new THREE.Mesh(
            new THREE.BoxGeometry(0.42, 0.5, 0.42),
            new THREE.MeshStandardMaterial({ color: 0x8b7a63 }),
          );
          chair.position.set(Math.cos(angle) * 1.45, 0.25, Math.sin(angle) * 1.45);
          group.add(chair);
        }
        return group;
      }
      case 'station': {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(2.4, 1.0, 1.4),
          new THREE.MeshStandardMaterial({
            color: STATION_COLORS[entity.station ?? ''] ?? 0x808890,
            roughness: 0.55,
            metalness: 0.25,
          }),
        );
        mesh.position.y = 0.5;
        return mesh;
      }
      case 'service_pass':
        return this.box(16, 0.9, 0.8, 0xb9c2cc);
      case 'pantry':
        return this.box(2.6, 2.0, 1.2, 0x9c7d55);
      case 'dishwashing':
        return this.box(2.6, 1.1, 1.2, 0x6f7d8c);
      case 'host_stand':
        return this.box(1.1, 1.1, 0.7, 0xb08a5e);
      case 'upgrade_terminal':
        return this.box(1.0, 1.2, 0.8, 0x5fbf9e);
      case 'queue':
        return this.box(3.4, 0.06, 1.2, 0x2f3843);
      default:
        return null;
    }
  }

  private box(w: number, h: number, d: number, color: number): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
    );
    mesh.position.y = h / 2;
    return mesh;
  }

  /**
   * PRD §4.4 / §14: the competitor's restaurant must be visible in some form. Milestone 0
   * ships a simplified mirrored shell across the street; STORY-016 gives it live activity.
   */
  private buildCompetitor(): THREE.Group {
    const group = new THREE.Group();
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(18, 0.3, 10),
      new THREE.MeshStandardMaterial({ color: 0x3f464e, roughness: 0.95 }),
    );
    slab.position.set(0, 0.15, -26);
    group.add(slab);
    // STORY-016. These 6 boxes double as the rival's own "occupied table" activity readout —
    // `updateRivalActivity` lights up however many of them the rival's own occupied-seat
    // fraction implies, reusing this existing geometry rather than building a second one. AC:
    // "the rival restaurant is visible in some form ... showing at least its activity level".
    for (let i = 0; i < 6; i += 1) {
      const t = this.box(1.6, 0.7, 1.6, 0x7d868f);
      t.position.set(-6 + (i % 3) * 4.5, 0.65, -24 + Math.floor(i / 3) * 3.5);
      group.add(t);
      this.competitorTables.push(t);
    }
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(6, 1.2, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xc75f5f, emissive: 0x521f1f }),
    );
    sign.position.set(0, 3, -21);
    sign.name = 'competitor_sign';
    group.add(sign);
    group.name = 'competitor_restaurant';
    return group;
  }

  /** Create or update one owner avatar. Position always comes from server state. */
  upsertOwner(state: OwnerRenderState): void {
    let group = this.owners.get(state.playerId);
    if (!group) {
      group = new THREE.Group();
      const color = state.isSelf ? 0x7ac74f : 0xd98c4a;
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.34, 0.75, 6, 12),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
      );
      body.position.y = 0.85;
      group.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.26, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0xf0d5b8 }),
      );
      head.position.y = 1.6;
      group.add(head);
      // Facing indicator — reads clearly from the high-angle camera of PRD §14.
      const nose = new THREE.Mesh(
        new THREE.ConeGeometry(0.14, 0.4, 8),
        new THREE.MeshStandardMaterial({ color: 0x2b2f35 }),
      );
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, 1.15, 0.42);
      group.add(nose);
      group.name = `owner_${state.playerId}`;
      // STORY-012 §10 "Serving Tray": up to 3 small plates, hidden until `setCarrying` shows
      // as many as the owner is actually holding. Built once here, alongside the avatar, so
      // `setCarrying` (called at snapshot cadence from `GameClient`, not every render frame)
      // only ever toggles visibility rather than allocating geometry on the hot path.
      for (let i = 0; i < MAX_VISIBLE_CARRY_PLATES; i += 1) {
        const plate = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.16, 0.04, 16),
          new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.4 }),
        );
        plate.name = `plate_${i}`;
        plate.position.set(0.3, 1.35 + i * 0.12, 0);
        plate.visible = false;
        group.add(plate);
      }
      this.owners.set(state.playerId, group);
      this.scene.add(group);
    }
    group.position.set(state.position.x, state.position.y, state.position.z);
    group.rotation.y = state.facing;
  }

  /** STORY-012. Public: `carrying` already is (§8 §14, PlayerSnapshot). One small plate mesh
   * per carried order, up to `MAX_VISIBLE_CARRY_PLATES` — no upgrade currently raises capacity
   * past that, and a 4th plate would just be lost behind the other three at this scale anyway. */
  setCarrying(playerId: string, count: number): void {
    const group = this.owners.get(playerId);
    if (!group) return;
    for (let i = 0; i < MAX_VISIBLE_CARRY_PLATES; i += 1) {
      const plate = group.getObjectByName(`plate_${i}`);
      if (plate) plate.visible = i < count;
    }
  }

  /** STORY-012 "Faster Grill I": a hotter tint on the OWNER'S OWN grill mesh once purchased.
   * Ownership can change mid-match (unlike everything `buildAll()` builds once from static
   * layout JSON), so this is looked up by name rather than rebuilt — the one live per-entity
   * update path this file has; see the header comment on why it stays this narrow rather than
   * growing into a general visual-state system (that generalization is STORY-016's). */
  setStationUpgraded(station: string, upgraded: boolean): void {
    const mesh = this.scene.getObjectByName(`station_${station}`) as THREE.Mesh | undefined;
    if (!mesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.color.setHex(
      upgraded ? (STATION_COLORS_UPGRADED[station] ?? STATION_COLORS[station]) : (STATION_COLORS[station] ?? 0x808890),
    );
  }

  /** STORY-012 "Pantry Shelves": read as "more storage" with a taller box and a darker,
   * shelf-like tint rather than modeling actual shelf geometry — see `setStationUpgraded`'s
   * comment on scope. */
  setPantryUpgraded(upgraded: boolean): void {
    const mesh = this.scene.getObjectByName('pantry') as THREE.Mesh | undefined;
    if (!mesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.color.setHex(upgraded ? 0x6b4f30 : 0x9c7d55);
    mesh.scale.y = upgraded ? 1.3 : 1;
  }

  // --- STORY-016: stations built once, indicators toggled/recolored per snapshot -------------

  /** One queue-box stack (front-left) + one shortage glyph (back-right) per station, attached
   * as children of that station's already-built mesh — see the module-level anchor constants'
   * own comment on why the two live at different anchors with different shapes. */
  private buildStationIndicators(): void {
    for (const station of STATIONS) {
      const stationMesh = this.scene.getObjectByName(`station_${station}`);
      if (!stationMesh) continue;
      const queueBoxes: THREE.Mesh[] = [];
      for (let i = 0; i < MAX_VISIBLE_QUEUE_BOXES; i += 1) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.2, 0.28),
          new THREE.MeshStandardMaterial({ color: STATE_COLORS.healthy, roughness: 0.5 }),
        );
        box.position.set(STATION_QUEUE_ANCHOR.x, STATION_QUEUE_ANCHOR.y + i * 0.24, STATION_QUEUE_ANCHOR.z);
        box.visible = false;
        stationMesh.add(box);
        queueBoxes.push(box);
      }
      const shortageIcon = createGlyphSprite('!', STATE_COLORS.critical, 0.55);
      shortageIcon.position.set(STATION_SHORTAGE_ANCHOR.x, STATION_SHORTAGE_ANCHOR.y, STATION_SHORTAGE_ANCHOR.z);
      shortageIcon.visible = false;
      stationMesh.add(shortageIcon);
      this.stationIndicators.set(station, { queueBoxes, shortageIcon });
    }
  }

  // --- STORY-030: ready-dish proxies — spawn/despawn, reconciled by EntityViewRegistry
  // ('readyDishes') --------------------------------------------------------------------------

  /** First free pass slot for a NEWLY seen ticket — see `readyDishSlotPosition`'s own comment
   * on why slots are claimed once and held, not recomputed every snapshot. Falls back to slot 0
   * past `MAX_READY_DISH_SLOTS` live tickets simultaneously (see that constant's own comment). */
  private claimReadyDishSlot(ticketId: string): number {
    const existing = this.readyDishSlots.get(ticketId);
    if (existing !== undefined) return existing;
    let slot = this.readyDishSlotUsed.findIndex((used) => !used);
    if (slot === -1) slot = 0;
    this.readyDishSlotUsed[slot] = true;
    this.readyDishSlots.set(ticketId, slot);
    return slot;
  }

  private releaseReadyDishSlot(ticketId: string): void {
    const slot = this.readyDishSlots.get(ticketId);
    if (slot !== undefined) this.readyDishSlotUsed[slot] = false;
    this.readyDishSlots.delete(ticketId);
  }

  /** Create or update one ready-dish proxy. PRD §5.2: dish geometry is built ONCE per ticket
   * (`dishId`/`tableId` never change for a ticket's ready lifetime) — every subsequent call for
   * the same `ticketId` only retints the freshness ring/toggles the READY vs GOING COLD chip and
   * the oldest-ticket highlight, the same "build once, toggle per snapshot" discipline
   * `upsertWorker`'s job glyphs already use. */
  upsertReadyDish(state: ReadyDishRenderState): void {
    const stale = state.readyAgeMs > ORDER_FRESHNESS_GRACE_MS;
    const band: 'healthy' | 'bottleneck' = stale ? 'bottleneck' : 'healthy';
    const ringColor = colorForBand(band);

    let group = this.readyDishes.get(state.ticketId);
    if (!group) {
      group = new THREE.Group();
      group.add(buildDishProxy(state.dishId));

      // PRD §5.2 "use green for fresh ready food and orange for stale" — a ring on the pass
      // surface beneath the dish, same visual device as a customer's patience ring, so freshness
      // reads instantly without recoloring the food itself (see `DISH_COLORS`'s own comment).
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.62, 0.76, 28),
        new THREE.MeshBasicMaterial({ color: ringColor, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.01;
      ring.name = 'state_ring';
      group.add(ring);

      // PRD §5.2 "target table chip" — always the §4.3 blue "opportunity" tone (target-table
      // guidance), independent of freshness, exactly as the reference composition
      // (`docs/rival-restaurant-arcade-legibility-ui.png`) shows a blue T04 chip regardless of
      // how green/orange the plate's own glow reads.
      const tableChip = createLabelSprite(formatTableChip(state.tableId), STATE_COLORS.opportunity, 0.42);
      tableChip.position.set(0, 0.95, 0);
      tableChip.name = 'table_chip';
      group.add(tableChip);

      // PRD §5.2 "compact state label — READY while fresh, GOING COLD once exceeded". Both built
      // once, each already tinted its own fixed semantic color, and toggled by visibility —
      // never recolored at runtime, matching `WORKER_TASK_GLYPHS`'s "build every option once"
      // discipline above.
      const readyLabel = createLabelSprite('READY', STATE_COLORS.healthy, 0.34);
      readyLabel.position.set(0, 0.62, 0);
      readyLabel.name = 'label_ready';
      group.add(readyLabel);
      const coldLabel = createLabelSprite('GOING COLD', STATE_COLORS.bottleneck, 0.34);
      coldLabel.position.set(0, 0.62, 0);
      coldLabel.name = 'label_cold';
      group.add(coldLabel);

      group.name = `ready_dish_${state.ticketId}`;
      this.readyDishes.set(state.ticketId, group);
      const passMesh = this.scene.getObjectByName('service_pass');
      if (passMesh) passMesh.add(group);
      else this.scene.add(group); // defensive: layout has always declared exactly one service_pass
    }

    const slot = this.claimReadyDishSlot(state.ticketId);
    // Local space, relative to `service_pass`'s own box mesh (16w × 0.9h, centered at its own
    // origin — see `buildEntity`'s `service_pass` case): y=0.45 sits exactly on the top surface.
    group.position.set(readyDishSlotPosition(slot), 0.45, 0);

    const ring = group.getObjectByName('state_ring') as THREE.Mesh;
    (ring.material as THREE.MeshBasicMaterial).color.setHex(ringColor);
    // PRD §5.2 "highlight or pulse the oldest ready ticket first" — a static size/opacity boost
    // stands whether or not `updateReadyDishAnimations` has run yet this frame (so a single
    // screenshot still shows it, not only a running match); the per-frame pulse on top of this
    // is `updateReadyDishAnimations`'s job.
    const ringBaseScale = state.isOldest ? 1.25 : 1;
    ring.scale.set(ringBaseScale, ringBaseScale, 1);
    (ring.material as THREE.MeshBasicMaterial).opacity = state.isOldest ? 1 : 0.7;
    group.userData.isOldest = state.isOldest;

    const readyLabel = group.getObjectByName('label_ready') as THREE.Sprite;
    const coldLabel = group.getObjectByName('label_cold') as THREE.Sprite;
    readyLabel.visible = !stale;
    coldLabel.visible = stale;
  }

  removeReadyDish(ticketId: string): void {
    const group = this.readyDishes.get(ticketId);
    if (!group) return;
    group.parent?.remove(group);
    this.readyDishes.delete(ticketId);
    this.releaseReadyDishSlot(ticketId);
  }

  readyDishIds(): string[] {
    return [...this.readyDishes.keys()];
  }

  /** PRD §5.2 "highlight or pulse the oldest ready ticket first" — the per-frame half of
   * `upsertReadyDish`'s static highlight, same split `updateCustomerAnimations` makes between a
   * per-snapshot band color and a per-frame posture animation. Only the current oldest ticket's
   * group ever has non-zero amplitude, so an idle pass (nothing ready, or only one ready dish
   * with nothing to rank against) costs nothing beyond the `userData` read. */
  updateReadyDishAnimations(elapsedSeconds: number): void {
    for (const group of this.readyDishes.values()) {
      const ring = group.getObjectByName('state_ring') as THREE.Mesh | undefined;
      if (!ring) continue;
      if (!group.userData.isOldest) {
        ring.scale.set(1, 1, 1);
        continue;
      }
      const pulse = 1.25 + Math.sin(elapsedSeconds * 3.2) * 0.12;
      ring.scale.set(pulse, pulse, 1);
    }
  }

  // --- STORY-016: customers — spawn/despawn, reconciled by EntityViewRegistry ('customers') ---

  /** Create or update one customer party's body + patience ring. PRD §14 "customer patience
   * ring beneath them that tracks the server's patience value and crosses the colour bands as
   * it depletes" — `patienceColorBand` is the ONE place that classification happens; this only
   * paints the band it returns. */
  upsertCustomer(state: CustomerRenderState): void {
    const band = patienceColorBand(state.patienceRemaining, {
      attention: PATIENCE_RING_ATTENTION_THRESHOLD,
      bottleneck: PATIENCE_RING_BOTTLENECK_THRESHOLD,
      critical: UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD,
    });
    const ringColor = colorForBand(band);

    // §14 MVP "segment-cued customers" — a fixed identity tint for the party's whole visit,
    // independent of the patience band above (see `CUSTOMER_SEGMENT_COLORS`'s own comment on
    // why this is a second, separate visual channel rather than folded into the ring color).
    const segmentColor = CUSTOMER_SEGMENT_COLORS[state.segmentId] ?? CUSTOMER_SEGMENT_COLOR_FALLBACK;

    let group = this.customers.get(state.customerId);
    if (!group) {
      group = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.26, 0.55, 5, 10),
        new THREE.MeshStandardMaterial({ color: segmentColor, roughness: 0.7 }),
      );
      body.position.y = 0.62;
      body.name = 'body';
      group.add(body);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.4, 0.52, 24),
        new THREE.MeshBasicMaterial({ color: ringColor, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      ring.name = 'patience_ring';
      group.add(ring);
      group.name = `customer_${state.customerId}`;
      this.customers.set(state.customerId, group);
      this.scene.add(group);
    }
    group.position.set(state.position.x, state.position.y, state.position.z);
    const ring = group.getObjectByName('patience_ring') as THREE.Mesh;
    (ring.material as THREE.MeshBasicMaterial).color.setHex(ringColor);
    // PRD §4.4 "visibly look impatient" — `updateCustomerAnimations` (per render frame) reads
    // this band straight off `userData` rather than re-deriving it from a raw patience number a
    // second time.
    group.userData.band = band;
  }

  removeCustomer(customerId: string): void {
    const group = this.customers.get(customerId);
    if (!group) return;
    this.scene.remove(group);
    this.customers.delete(customerId);
  }

  customerIds(): string[] {
    return [...this.customers.keys()];
  }

  /** PRD §4.4 "Hungry/waiting customers visibly look impatient" — a posture/sway animation
   * whose amplitude and speed scale with the patience band. Called every render frame from
   * `GameClient#handleFrame`, never from React (Notable Pattern 3/11): cheap (one `Math.sin`
   * per live customer), and a healthy party is perfectly still (amplitude 0), so this costs
   * nothing extra for the common case of a floor with no one impatient yet. */
  updateCustomerAnimations(elapsedSeconds: number): void {
    const amplitudeByBand: Record<string, number> = { healthy: 0, attention: 0.03, bottleneck: 0.07, critical: 0.13 };
    const speedByBand: Record<string, number> = { healthy: 0, attention: 2.2, bottleneck: 3.4, critical: 5.0 };
    for (const group of this.customers.values()) {
      const band = (group.userData.band as string) ?? 'healthy';
      const amplitude = amplitudeByBand[band] ?? 0;
      const body = group.getObjectByName('body');
      if (!body) continue;
      if (amplitude === 0) {
        body.rotation.z = 0;
        body.position.y = 0.62;
        continue;
      }
      const speed = speedByBand[band] ?? 0;
      body.rotation.z = Math.sin(elapsedSeconds * speed) * amplitude;
      body.position.y = 0.62 + Math.abs(Math.sin(elapsedSeconds * speed * 1.7)) * amplitude * 0.4;
    }
  }

  // --- STORY-016: workers — spawn/despawn, reconciled by EntityViewRegistry ('workers') ------

  /** Create or update one worker: a role-colored body, a role glyph, and one of the
   * §17 `WorkerTaskKind` glyphs (or the "needs help" glyph) built once and toggled thereafter —
   * `game-state.d.ts`'s own "THREE STATES, NOT TWO" comment on `RestaurantSnapshot.workers[]`
   * is exactly what the visibility branch below implements: task/idle/needsHelp are mutually
   * exclusive, and needsHelp gets the §14 orange "active bottleneck" language (never red — this
   * scene reserves red for the customer-abandonment-imminent band). */
  upsertWorker(state: WorkerRenderState): void {
    let group = this.workers.get(state.workerId);
    if (!group) {
      group = new THREE.Group();
      const color = WORKER_ROLE_COLORS[state.role] ?? WORKER_ROLE_COLOR_FALLBACK;
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.3, 0.7, 6, 12),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
      );
      body.position.y = 0.8;
      group.add(body);
      // 0.6, not 0.4 — see WORKER_TASK_GLYPHS's own comment on the live legibility check that
      // caught these reading too small at the default camera height.
      const roleGlyph = createGlyphSprite(WORKER_ROLE_GLYPHS[state.role] ?? '?', color, 0.6);
      roleGlyph.position.set(0, 1.55, 0);
      group.add(roleGlyph);
      // One glyph per possible task kind, plus one "needs help", all built once and toggled —
      // see this method's own header on why only one is ever visible at a time.
      for (const kind of Object.keys(WORKER_TASK_GLYPHS)) {
        const jobGlyph = createGlyphSprite(WORKER_TASK_GLYPHS[kind], STATE_COLORS.opportunity, 0.6);
        jobGlyph.position.set(0, 1.95, 0);
        jobGlyph.visible = false;
        jobGlyph.name = `job_${kind}`;
        group.add(jobGlyph);
      }
      const helpGlyph = createGlyphSprite('!', STATE_COLORS.bottleneck, 0.6);
      helpGlyph.position.set(0, 1.95, 0);
      helpGlyph.visible = false;
      helpGlyph.name = 'job_help';
      group.add(helpGlyph);
      group.name = `worker_${state.workerId}`;
      this.workers.set(state.workerId, group);
      this.scene.add(group);
    }
    group.position.set(state.position.x, state.position.y, state.position.z);

    for (const kind of Object.keys(WORKER_TASK_GLYPHS)) {
      const sprite = group.getObjectByName(`job_${kind}`) as THREE.Sprite | undefined;
      if (sprite) sprite.visible = false;
    }
    const helpGlyph = group.getObjectByName('job_help') as THREE.Sprite | undefined;
    if (helpGlyph) helpGlyph.visible = false;

    if (state.needsHelp) {
      if (helpGlyph) helpGlyph.visible = true;
    } else if (state.task) {
      const active = group.getObjectByName(`job_${state.task.kind}`) as THREE.Sprite | undefined;
      if (active) active.visible = true;
    }
  }

  removeWorker(workerId: string): void {
    const group = this.workers.get(workerId);
    if (!group) return;
    this.scene.remove(group);
    this.workers.delete(workerId);
  }

  workerIds(): string[] {
    return [...this.workers.keys()];
  }

  // --- STORY-016: tables / stations / pass / rival / event — updated once per snapshot -------

  private tableBadgeFor(
    table: { id: string; occupiedBy: string | null; dirty: boolean },
    customers: CustomerSnapshot[],
  ): TableBadgeKind {
    // Dirty always wins: it is what blocks the NEXT seating, the most urgent of the four states,
    // and can be true even while nothing (yet) occupies the table.
    if (table.dirty) return 'dirty';
    if (!table.occupiedBy) return null;
    const party = customers.find((c) => c.tableId === table.id);
    if (!party) return null;
    switch (party.state) {
      case 'SEATED':
      case 'ORDERING':
      case 'WAITING_FOR_FOOD':
        return 'order_taken';
      case 'EATING':
        return 'meal_delivered';
      case 'PAYING':
        return 'paying';
      default:
        return null;
    }
  }

  /** PRD §4.4 "Tables show order, meal, payment, and cleanup states" — `customers` must already
   * be filtered to THIS restaurant (see `updateFloorState`): table ids are shared literal
   * strings across both restaurants' own internal layouts (`customer-system.js`'s own comment),
   * so an unfiltered lookup would paint the rival's diner onto your own table. */
  private updateTableBadges(tables: RestaurantSnapshot['tables'], customers: CustomerSnapshot[]): void {
    for (const table of tables ?? []) {
      const badge = this.tableBadgeFor(table, customers);
      const existing = this.tableBadges.get(table.id);
      if (!badge) {
        if (existing) existing.visible = false;
        continue;
      }
      const color = TABLE_BADGE_COLORS[badge];
      if (!existing || existing.userData.badgeKind !== badge) {
        existing?.parent?.remove(existing);
        const sprite = createGlyphSprite(TABLE_BADGE_GLYPHS[badge], color, 0.45);
        sprite.position.set(0, 1.7, 0);
        sprite.userData.badgeKind = badge;
        this.scene.getObjectByName(table.id)?.add(sprite);
        this.tableBadges.set(table.id, sprite);
      } else {
        existing.visible = true;
        setGlyphSpriteColor(existing, color);
      }
    }
  }

  /**
   * PRD §8 "distinct signals for each" bottleneck. `orders`/`shortages` must already be
   * filtered/scoped to THIS restaurant (see `updateFloorState`). Queue depth is DERIVED from
   * `orders[]` exactly the way `game-state.d.ts`'s own `OrderSnapshot` header documents
   * (`RestaurantSnapshot.stations[]` is declared but never published — STORY-005's kitchen only
   * ever publishes ticket state through `orders[]`), never read off a `stations[]` field that
   * would silently render nothing.
   */
  private updateStationIndicators(orders: OrderSnapshot[], shortages: RestaurantSnapshot['shortages']): void {
    const shortageStations = new Set(
      (shortages ?? []).filter((s) => s.blockedTickets > 0).map((s) => s.station),
    );
    for (const station of STATIONS) {
      const indicator = this.stationIndicators.get(station);
      if (!indicator) continue;
      const queueDepth = orders.filter(
        (o) => o.station === station && o.state === 'queued' && o.blockedByIngredientId === null,
      ).length;
      const band = stationQueueColorBand(queueDepth, {
        attention: STATION_QUEUE_ATTENTION_THRESHOLD,
        bottleneck: HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD,
      });
      const color = colorForBand(band);
      indicator.queueBoxes.forEach((box, i) => {
        box.visible = i < Math.min(queueDepth, MAX_VISIBLE_QUEUE_BOXES);
        (box.material as THREE.MeshStandardMaterial).color.setHex(color);
      });
      // The shortage glyph is a fixed-severity icon (always the critical red — a bin that ran
      // dry is always worth stopping for), never colored by the queue band: that would blur the
      // exact "two different bottlenecks" distinction §8 requires back together.
      indicator.shortageIcon.visible = shortageStations.has(station);
    }
  }

  /**
   * PRD §4.4 / §14 "the rival restaurant is visible ... showing at least its activity level".
   * Reuses the 6 "table" boxes and the sign `buildCompetitor()` already built rather than adding
   * new geometry: however many of the 6 boxes light up tracks the rival's own occupied-seat
   * fraction (an already-public field, `RestaurantSnapshot.seatsAvailable`/`seatsTotal`), and
   * the sign recolors off `queueLength` past `HUD_LONG_ENTRY_QUEUE_THRESHOLD` — the same "a
   * passerby would notice" line the HUD's own `long_entry_queue` bottleneck already uses.
   */
  private updateRivalActivity(rival: RestaurantSnapshot | null): void {
    if (!rival) {
      for (const t of this.competitorTables) (t.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
      if (this.competitorSign) (this.competitorSign.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3;
      return;
    }
    const occupiedFraction =
      rival.seatsTotal > 0 ? (rival.seatsTotal - rival.seatsAvailable) / rival.seatsTotal : 0;
    const litCount = Math.round(occupiedFraction * this.competitorTables.length);
    this.competitorTables.forEach((t, i) => {
      const material = t.material as THREE.MeshStandardMaterial;
      const lit = i < litCount;
      material.emissive.setHex(lit ? STATE_COLORS.opportunity : 0x000000);
      material.emissiveIntensity = lit ? 0.7 : 0;
    });
    const band: 'healthy' | 'bottleneck' = rival.queueLength > HUD_LONG_ENTRY_QUEUE_THRESHOLD ? 'bottleneck' : 'healthy';
    if (this.competitorSign) {
      const material = this.competitorSign.material as THREE.MeshStandardMaterial;
      material.emissive.setHex(colorForBand(band));
      material.emissiveIntensity = 0.5;
    }
  }

  /** PRD §14 "event banner ... with a district-level visual effect" — the banner TEXT is a
   * small React overlay in `App.tsx` reading `match_snapshot.events` directly (Notable Pattern
   * 11: React owns UI); this is the scene-wide half, a whole-scene ambient light tint toward
   * §14's blue "opportunity" color while ANY event is active, reverted the instant none are. */
  private updateEventEffect(events: SnapshotEventEntry[]): void {
    const active = events.some((e) => e.state === 'active');
    this.ambient.color.setHex(active ? STATE_COLORS.opportunity : this.ambientBaseColor);
  }

  /**
   * The single per-snapshot entry point for everything in this section: tables, stations, rival
   * activity and the event effect. Customers, workers, and (STORY-030) ready-dish proxies are
   * NOT handled here — they are spawn/despawn entities reconciled through `EntityViewRegistry`
   * in `GameClient.ts` ('customers'/'workers'/'readyDishes'), the same seam `players` already
   * uses for owners.
   *
   * Filters `customers`/`orders` to `selfRestaurantId` internally (see `updateTableBadges`'s own
   * comment on why an unfiltered lookup would render the rival's floor onto this one) so
   * `GameClient.ts` can pass the raw, verbatim snapshot arrays through unchanged.
   */
  updateFloorState(params: {
    selfRestaurantId: string | null;
    restaurants: RestaurantSnapshot[];
    customers: CustomerSnapshot[];
    orders: OrderSnapshot[];
    events: SnapshotEventEntry[];
  }): void {
    const self = params.restaurants.find((r) => r.restaurantId === params.selfRestaurantId) ?? null;
    const rival = params.restaurants.find((r) => r.restaurantId !== params.selfRestaurantId) ?? null;
    const selfOrders = params.orders.filter((o) => o.restaurantId === params.selfRestaurantId);
    const selfCustomers = params.customers.filter((c) => c.restaurantId === params.selfRestaurantId);

    this.updateTableBadges(self?.tables ?? [], selfCustomers);
    this.updateStationIndicators(selfOrders, self?.shortages ?? []);
    this.updateRivalActivity(rival);
    this.updateEventEffect(params.events);
  }

  removeOwner(playerId: string): void {
    const group = this.owners.get(playerId);
    if (!group) return;
    this.scene.remove(group);
    this.owners.delete(playerId);
  }

  ownerIds(): string[] {
    return [...this.owners.keys()];
  }

  setDebugGrid(visible: boolean): void {
    this.grid.visible = visible;
  }

  setCompetitorVisible(visible: boolean): void {
    this.competitor.visible = visible;
  }

  setNight(night: boolean): void {
    this.ambient.intensity = night ? 0.28 : 0.75;
    this.keyLight.intensity = night ? 0.45 : 1.15;
    this.scene.background = new THREE.Color(night ? 0x0d1015 : 0x1b1f24);
  }

  dispose(): void {
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.owners.clear();
    this.customers.clear();
    this.workers.clear();
    this.tableBadges.clear();
    this.stationIndicators.clear();
    this.readyDishes.clear();
    this.readyDishSlots.clear();
    this.readyDishSlotUsed.fill(false);
    this.scene.clear();
  }
}
