// The restaurant scene graph, built from shared/game-data/restaurant-layout.json.
//
// This module is deliberately free of networking and game rules: it takes a layout and a
// render state and produces/updates Three.js objects. PRD §15 "The key requirement is
// separation: game rules should emit state, and scene-view code should render state." That
// is what lets harnesses/ mount this same scene with mocked state and no backend.

import * as THREE from 'three';
import { CopperAndThyme } from './CopperAndThyme';
import layout from '../../../shared/game-data/restaurant-layout.json';
// STORY-057. Same "look up the real catalogue name off the real id, don't invent a string"
// precedent `InteractionController.ts`/`KitchenQueueBoard.tsx` already established for
// `you.kitchenQueueBoard` entries — the big picture cards need the dish's display NAME, which
// isn't part of `QueueBoardDishRenderState` (only `dishId` is), so this file reads the catalogue
// directly rather than threading `name` through the wire shape for one rendering-only need.
import dishesData from '../../../shared/game-data/dishes.json';
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
  OWNER_MOVE_SPEED,
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
import {
  createGlyphSprite,
  createLabelSprite,
  createOrderLabelSprite,
  setGlyphSpriteColor,
  setLabelSpriteText,
  createDishPicturePanel,
} from './icon-sprites';
import { buildArcadeFoodProxy, disposeFoodObject } from './FoodModels';
import { buildChefBlaze, disposeChefBlaze, type ChefBlazeInstance } from './ChefBlazeModel';
import { SEATED_DINER_MODEL, WORKER_ROLE_MODELS } from './CastModels';
import { buildRiggedCharacter, type RiggedCharacterInstance } from './RiggedCharacterModel';

export interface OwnerRenderState {
  playerId: string;
  position: { x: number; y: number; z: number };
  facing: number;
  sprinting?: boolean;
  isSelf?: boolean;
  /** STORY-034. Opt-in, defaulting false — see `upsertOwner`'s own comment for what this does
   * and why it is a separate flag from `isSelf` rather than inferred from it: harness previews
   * (`asset-showcase-harness.ts` places a mock rival right next to the self avatar on purpose,
   * for a side-by-side comparison) construct `isSelf: false` avatars that must NOT be moved.
   * Only `GameClient.ts`'s real call site sets this. */
  remapToRivalFloor?: boolean;
}

/** STORY-016. `EntityViewRegistry`'s two new spawn/despawn kinds — customers and workers —
 * reconcile against these. `CustomerRenderState` is a deliberately NARROW slice of
 * `CustomerSnapshot` (just what the ring/posture need), unlike `WorkerRenderState`, which is the
 * wire shape verbatim (extracted via `NonNullable<...>` rather than redeclared, so it can never
 * silently drift from `RestaurantSnapshot.workers[]`'s own shape). */
export interface CustomerRenderState {
  customerId: string;
  position: { x: number; y: number; z: number };
  /** A party is one server entity but should read as several diners once seated. */
  partySize?: number;
  /** Set after ordering from the authoritative public order tickets. */
  orderLabel?: string | null;
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
  /** STORY-053. True iff at least one sibling ticket on this same order (same `orderId`, not
   * carried on this narrow render-state shape — see `GameClient.ts`'s own `kitchenStaging` call)
   * is still `queued`/`in_progress`. Derived client-side, same Pattern 4/11 discipline as
   * `isOldest` above: `upsertReadyDish` renders this, it does not decide it. */
  staged: boolean;
  /** STORY-053. How many such outstanding siblings there are — the "waiting on N more" count the
   * staged label shows. Meaningless (and unused) while `staged` is false. */
  waitingOnCount: number;
}

/** STORY-031 PRD §5.3/§10.2. One entry per DISH the owner is physically carrying, keyed by
 * `ticketId` — same identity discipline as `ReadyDishRenderState` above (`orderId` is shared by
 * every dish a party's order decomposed into; `ticketId` is the one unique per-dish key). The
 * caller (`GameClient.ts`) resolves these by cross-referencing `PlayerSnapshot.carrying` (order
 * ids) against `orders[]` — see that file's own comment on why `carrying.length` never maps 1:1
 * to plates on its own. */
export interface CarriedDishRenderState {
  ticketId: string;
  dishId: string;
}

/** STORY-043 "Kitchen order queue board". One entry per queued ticket, restaurant-wide — `rank`
 * is the entry's position in the ALREADY-server-ranked `you.kitchenQueueBoard` array
 * (`worker-system.js#compareTickets` order), computed by `GameClient.ts` as a plain array index
 * (Pattern 4/11: the client labels published order, it does not compute it) and used directly as
 * the slot index by `upsertQueueBoardDish` — see that method's own comment on why this pool is
 * rank-indexed rather than held-slot like `ReadyDishRenderState`'s pool. */
export interface QueueBoardDishRenderState {
  ticketId: string;
  dishId: string;
  rank: number;
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

/** One shared material per segment colour, for the diner segment discs.
 *
 * Built lazily and cached rather than one per diner: a full dining room is 6 tables x a
 * `partySize` cap of 4 = up to 24 discs, but only a handful of distinct segment colours
 * (`customer-segments.json`), so this collapses 24 materials down to a few. The discs exist
 * because the seated model cannot carry the tint the capsule used to — see `upsertCustomer`. */
const segmentDiscMaterials = new Map<number, THREE.MeshBasicMaterial>();

function segmentDiscMaterial(color: number): THREE.MeshBasicMaterial {
  let material = segmentDiscMaterials.get(color);
  if (!material) {
    material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    segmentDiscMaterials.set(color, material);
  }
  return material;
}

/** Scratch vector for `updateWorkerAnimations`'s per-frame step measurement. Module-level and
 * reused rather than allocated per worker per frame — this runs for every worker every frame. */
const WORKER_STEP = new THREE.Vector3();

/** Below this squared per-frame step, a worker's heading is left alone. The position lerp never
 * fully converges, so without a floor here an arrived worker would keep re-deriving a heading
 * from meaningless sub-millimetre jitter and slowly rotate on the spot forever. */
const WORKER_FACING_EPSILON_SQ = 1e-8;

/** How fast a worker turns toward its direction of travel, in "fraction of the remaining arc per
 * second". Fast enough that a worker rounding a table is facing the right way before it gets
 * there, slow enough that the turn is visible rather than a snap. */
const WORKER_TURN_RATE = 9;

/** Worker walking speed, and the fraction of it that counts as "moving" for the idle/walk
 * crossfade. Mirrors `OWNER_MOVE_SPEED`/`OWNER_ANIMATION_MOVE_FRACTION` — see
 * `updateWorkerAnimations` for why a threshold is needed at all. The worker figure is well under
 * the owner's because `group.position` here is the OUTPUT of a 0.035 lerp, which lags the true
 * snapshot velocity substantially; thresholding at the owner's fraction would leave a genuinely
 * walking worker stuck in its idle clip. */
const WORKER_MOVE_SPEED = 2.2;
const WORKER_ANIMATION_MOVE_FRACTION = 0.02;

/** PRD §4.4/§14 "Worker role icon" — one letter per `WorkerRole`, distinct from the table-badge
 * glyphs above so a player never confuses the two vocabularies. */
const WORKER_ROLE_GLYPHS: Record<string, string> = {
  cook: 'C',
  server: 'S',
  prep_worker: 'P',
  host: 'H',
  busser: 'B',
};

/** Worker role icons identify the person; these explicit task chips describe what that person
 * is doing. In particular, the old `A` for `seat_party` looked like the walker's name. */
const WORKER_TASK_LABELS: Record<string, string> = {
  tend_station: 'COOKING',
  restock: 'RESTOCK',
  deliver_order: 'DELIVER',
  seat_party: 'SEATING',
  take_order: 'ORDER',
  clear_table: 'CLEAR',
  collect_payment: 'PAYMENT',
};

/** How many queued-ticket boxes a station's indicator shows before it just reads "a lot" —
 * matches `MAX_VISIBLE_CARRY_PLATES`'s own reasoning: a 5th box would be lost behind the other
 * four at this camera distance anyway, and the color band already carries "this is bad" past
 * that point. */
const MAX_VISIBLE_QUEUE_BOXES = 4;

/** Local-space offsets for the three station indicators, relative to the station's own mesh.
 * DELIBERATELY DIFFERENT ANCHORS as well as different shapes/colors — PRD §8 "distinct signals
 * for each" bottleneck, applied literally: the queue bar sits front-left and grows as a stack of
 * boxes, the shortage glyph sits back-right as a single fixed circular icon, so the two bottleneck
 * kinds can never be confused even at a glance from the default camera height. STORY-041's waiting
 * glyph sits top-center, above both, so it reads as hovering over the whole station rather than
 * competing with either existing anchor. */
const STATION_QUEUE_ANCHOR = { x: -0.9, y: 0.7, z: -0.5 } as const;
const STATION_SHORTAGE_ANCHOR = { x: 0.9, y: 1.1, z: 0.5 } as const;
const STATION_WAITING_ANCHOR = { x: 0, y: 1.7, z: 0 } as const;

// PRD §14 "Visual state language" — the shared palette. STORY-016 extends this to the full
// green/yellow/orange/red/blue/purple semantics; Milestone 0 needs only structural colors.
export const ZONE_COLORS: Record<string, number> = {
  street: 0x777c76,
  dining: 0x946543,
  pass: 0xbab3a3,
  kitchen: 0x66746d,
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

/** STORY-060. See `updateOwnerAnimations`'s own comment — the fraction of `OWNER_MOVE_SPEED`
 * above which the self owner's Chef Blaze rig is considered "walking" rather than "idle". */
const OWNER_ANIMATION_MOVE_FRACTION = 0.08;

// --- STORY-031: PRD §5.3/§10.2 carry-socket dish proxies + destination-table target marker ----

/** Generous cap on simultaneously visible carry-socket dish proxies — production
 * `OWNER_CARRY_CAPACITY` is 1 order, and even the harness's own upgraded-capacity fixture (§13)
 * never simulates more than 3 orders × a couple of dishes each. Same "hide past a generous cap
 * rather than overlap" discipline as `MAX_READY_DISH_SLOTS`. */
const MAX_VISIBLE_CARRIED_DISHES = 6;

/** Local-space offsets (relative to the owner avatar's own origin) for each carry-socket slot —
 * a small fan in front of the body at roughly chest height, distinct from `MAX_VISIBLE_CARRY_PLATES`'s
 * shoulder-stacked generic plates (still used by `setCarrying`, STORY-012's simpler count-only
 * indicator, kept for `asset-showcase-harness.ts`/`upgrade-preview-harness.ts`'s own demos). */
const CARRY_DISH_SLOT_OFFSETS: readonly { x: number; y: number; z: number }[] = [
  { x: 0.28, y: 1.28, z: 0.22 },
  { x: 0.28, y: 1.28, z: -0.22 },
  { x: -0.28, y: 1.28, z: 0.22 },
  { x: -0.28, y: 1.28, z: -0.22 },
  { x: 0, y: 1.48, z: 0.3 },
  { x: 0, y: 1.48, z: -0.3 },
];
/** Dish proxies are built full-size (same geometry as the pass, per §10.2) but the carry socket
 * is a much smaller stage than the service pass counter — scaled down so a plate does not dwarf
 * the owner's own capsule body. */
const CARRY_DISH_SCALE = 0.55;

/** PRD §5.3 reference composition (`docs/rival-restaurant-arcade-legibility-ui.png`): a target
 * chip + downward arrow floating above the destination table, and a pulsing ring on the floor
 * beneath it. All three always the §14 blue "opportunity" tone (a delivery is a revenue
 * opportunity, never a freshness/urgency signal — same reasoning `upsertReadyDish`'s own table
 * chip comment gives). */
// The four "walk up and press E" management posts — see `buildWayfinding`'s own comment on the
// big "E" badge these get, distinct from the plain read-only labels every table/station has.
const COMMAND_POST_IDS = new Set([
  'upgrade_terminal',
  'host_stand',
  'service_station',
  'kitchen_command_board',
  // STORY-043. The queue board is a read-only "walk up and read" board like `kitchen_command_board`
  // (it happens to open on the same `E` toggle rather than writing an action — see
  // `GameClient.ts#onInteract`), so it gets the same big "E" wayfinding badge.
  'kitchen_order_queue_board',
]);

const CARRY_TARGET_RING_INNER = 0.95;
const CARRY_TARGET_RING_OUTER = 1.15;
const CARRY_TARGET_ARROW_Y = 1.6;
const CARRY_TARGET_CHIP_Y = 2.05;

/** STORY-056 "handle complaint - I can't tell they're angry, make the entire table have a red
 * marker and it be very visible above the customers". Two numbers matter here:
 *  - The floor ring is deliberately BIGGER than `CARRY_TARGET_RING_*` above (1.2-1.45 vs 0.95-
 *    1.15) so it visibly encircles the whole 1.8m table (the report's "entire table"), and — if a
 *    delivery happens to be inbound to the SAME unhappy table at the same time — the two rings sit
 *    concentric, blue delivery ring inside red complaint ring, distinguishable by color and
 *    radius rather than one obscuring the other.
 *  - The glyph sits at y=3.0, clear of BOTH the 4-state table badge (`createGlyphSprite`, scale
 *    0.45 at y=1.7 → spans 1.475-1.925) and the carry-target chip (`CARRY_TARGET_CHIP_Y` 2.05,
 *    label-sprite scale 0.68 → spans 1.71-2.39): at scale 1.0 this glyph spans 2.5-3.5, well above
 *    both, so all three can be visible on the same table at once without touching. This is the
 *    same PURELY VERTICAL "stack it higher, don't compete with the existing anchor" device
 *    `STATION_WAITING_ANCHOR` already uses above `STATION_QUEUE_ANCHOR`/`STATION_SHORTAGE_ANCHOR`
 *    (see that block's own comment) — reused here rather than inventing a horizontal-offset
 *    vocabulary this file doesn't otherwise use for table-anchored sprites.
 *
 * COLOR: `STATE_COLORS.critical` (0xe0402f), not `.bottleneck` (0xe0812f, actually orange despite
 * this story's own approach_summary mislabeling it "the existing red tone `dirty` already uses" —
 * `dirty` uses `.bottleneck`, and `.bottleneck`'s own doc comment in `state-colors.ts` says
 * "Orange"). The report's literal ask was "a RED marker", and `.critical` is this file's one
 * actually-red §14 hex. It is also the semantically correct pick, not just the visually correct
 * one: `patienceColorBand`'s `critical` band (the patience ring's reddest state, `upsertCustomer`)
 * and `party.everUnhappy` flip at the EXACT SAME threshold — `UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD`
 * — per `customer-system.js`'s own derivation. So a diner's patience ring turning this same red is
 * the direct visual precursor to this marker appearing; reusing `.bottleneck` would have severed
 * that continuity for no reason beyond a mistaken cross-reference in the approach_summary.
 */
const COMPLAINT_RING_INNER = 1.2;
const COMPLAINT_RING_OUTER = 1.45;
const COMPLAINT_GLYPH_Y = 3.0;
const COMPLAINT_GLYPH_SCALE = 1.0;

// --- STORY-030: PRD §5.2/§10.1 dish-specific ready-food proxies at the service pass ----------
//
// Supersedes STORY-016's single generic `foodReadyIcon` glyph sprite (removed by this story —
// see `updateFloorState`'s own comment on why this is a full replacement, not an addition).

/** How many ready tickets the pass can show at once without any two proxies overlapping — a
 * fixed slot layout (like `MAX_VISIBLE_QUEUE_BOXES`/`MAX_VISIBLE_CARRY_PLATES` above) rather
 * than a dynamic reflow, so an already-visible dish never jumps sideways just because a NEWER
 * ticket became ready. 8 comfortably outpaces kitchen throughput for the MVP's 4-station,
 * single-cook line; a 9th simultaneous ready ticket (never observed in practice) is hidden
 * rather than placed on top of another proxy — UNLIKE `MAX_VISIBLE_QUEUE_BOXES`'s 5th box (which
 * is fine to simply not draw, since the queue's color band already carries "this is bad" past
 * that point), a hidden-vs-overlapping choice matters here because the AC is explicitly "all
 * remain visible without geometry overlap" — overlapping would violate it outright, a briefly
 * uncounted 9th plate would not. See `claimReadyDishSlot`. */
const MAX_READY_DISH_SLOTS = 8;

/** How many spark sprites orbit the ready bell (`buildReadyBell`) while it's active — enough to
 * read as "sparkling", cheap enough to animate every frame with a plain per-sprite sin(). */
const READY_BELL_SPARK_COUNT = 4;
/** The bell's bounce rate/height (`updateReadyBellAnimation`) — a real service bell dings,
 * settles, dings again, rather than bobbing continuously, which is what makes it still catch the
 * eye on a long glance rather than reading as background scenery motion. */
const READY_BELL_JUMP_HZ = 1.6;
const READY_BELL_JUMP_HEIGHT = 0.16;
/** Local-space X range across the service pass's own 16-unit width (`buildEntity`'s
 * `service_pass` box), leaving a margin so a plate's own radius never clips past the pass edge. */
const READY_DISH_SLOT_X_RANGE = 6.5;

function readyDishSlotPosition(slot: number): number {
  if (MAX_READY_DISH_SLOTS <= 1) return 0;
  const t = slot / (MAX_READY_DISH_SLOTS - 1); // 0..1
  return -READY_DISH_SLOT_X_RANGE + t * (READY_DISH_SLOT_X_RANGE * 2);
}

// Restaurant-wide queue pictures are positioned by server priority, unlike the pass's stable
// ready-dish slots. Keep ten visible cards in two rows on the clear wall between pantry and wash.
const MAX_QUEUE_BOARD_SLOTS = 10;
const QUEUE_BOARD_COLUMNS = 5;
const QUEUE_BOARD_SLOT_X_RANGE = 3.2;
const QUEUE_BOARD_ROW_Y = [3.25, 1.25] as const;
const QUEUE_BOARD_PICTURE_SCALE = 1.7;
const QUEUE_BOARD_PANEL_DEPTH = 0.3;
// Cards share the panel's plane and sit just ahead of its kitchen-facing surface.
const QUEUE_BOARD_SLOT_Z = -(QUEUE_BOARD_PANEL_DEPTH / 2 + 0.03);
// Both wayfinding markers sit above the panel's 4.4-unit top edge.
const QUEUE_BOARD_LABEL_Y = 4.95;
const QUEUE_BOARD_BADGE_Y = 6.0;

function queueBoardSlotPosition(slot: number): { x: number; y: number } {
  const column = slot % QUEUE_BOARD_COLUMNS;
  const row = Math.floor(slot / QUEUE_BOARD_COLUMNS);
  const t = QUEUE_BOARD_COLUMNS <= 1 ? 0 : column / (QUEUE_BOARD_COLUMNS - 1); // 0..1
  return {
    x: -QUEUE_BOARD_SLOT_X_RANGE + t * (QUEUE_BOARD_SLOT_X_RANGE * 2),
    y: QUEUE_BOARD_ROW_Y[row] ?? QUEUE_BOARD_ROW_Y[QUEUE_BOARD_ROW_Y.length - 1],
  };
}

/** STORY-057. One accent color per catalogue dish for its big picture card
 * (`createDishPicturePanel`) — no existing per-dish 2D color/artwork field exists anywhere
 * (`dishes.json` has none; `DISH_COLORS` above is per-INGREDIENT/component, e.g. `bunTan`, not
 * per-dish), so this is a new, purpose-built map, kept small and local exactly like
 * `DISH_PROXY_BUILDERS` above. Chosen loosely off each dish's real ingredient palette (burger
 * = browned bun/patty tone, salad = green, espresso = dark roast) purely so a returning player's
 * existing color association (from the 3D proxies they already know) carries over — not a
 * strict science, just "don't pick colors that fight the dish's own established identity". Falls
 * back to `DISH_COLORS.genericFood`'s own tan for any id this map does not (yet) name, same
 * "never crash on an uncatalogued id" precedent `buildGenericDishProxy`'s own comment documents. */
const DISH_PICTURE_ACCENTS: Record<string, number> = {
  smash_burger: 0xc0562e,
  caesar_salad: 0x6fa85a,
  pasta_primavera: 0xdfb23c,
  chicken_sandwich: 0xd98f4e,
  steak_frites: 0x8a3a2b,
  nachos: 0xd4a017,
  espresso: 0x4a2f22,
  cheesecake: 0xe6b8b0,
};

/** Same `dishesData.dishes` id->name lookup `InteractionController.ts`/`KitchenQueueBoard.tsx`
 * already build independently for their own dish-name needs — this file didn't need one before
 * this story, since `buildDishProxy` only ever needed a `dishId` (to pick a builder), never a
 * display name. */
const DISH_NAMES = new Map((dishesData.dishes as { id: string; name: string }[]).map((dish) => [dish.id, dish.name]));

/** `DISH_PICTURE_ACCENTS[dishId]`, falling back to `DISH_COLORS.genericFood` for any id this
 * story's map does not name — declared as a function (not inlined at the one call site) so the
 * fallback rule has one place to read, matching `dishName`'s own single-purpose-lookup shape in
 * `InteractionController.ts`. */
function dishPictureAccent(dishId: string): number {
  return DISH_PICTURE_ACCENTS[dishId] ?? DISH_COLORS.genericFood;
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

/** STORY-053. AC3: the staged label must say WHY — at minimum how many sibling dishes are still
 * outstanding — not just a different color with no explanation. Kept as its own function (rather
 * than inlined at the one call site) because `upsertReadyDish` needs the identical string both
 * at first build (`createLabelSprite`) and on every later call (`setLabelSpriteText`), and a
 * literal template repeated at two call sites is exactly the kind of drift a `.d.ts`-adjacent
 * naming mismatch could introduce silently. */
function stagedLabelText(waitingOnCount: number): string {
  return `WAITING ON ${waitingOnCount}`;
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

/** PRD §10.2 "reuse one dish asset/proxy across pass, carry, and delivery" — STORY-031's carry-
 * socket proxies (`RestaurantScene#setCarriedDishes`) call this SAME function `upsertReadyDish`
 * already calls, rather than duplicating any dish geometry. Exported (module-private through
 * STORY-030) for exactly that reuse — no second builder, no re-derived silhouette. */
export function buildDishProxy(dishId: string): THREE.Group {
  const builder = DISH_PROXY_BUILDERS[dishId] ?? buildGenericDishProxy;
  return buildArcadeFoodProxy(dishId, { scale: 2.4, fallback: builder() });
}

export interface RestaurantSceneOptions {
  showDebugGrid?: boolean;
  showCompetitor?: boolean;
  night?: boolean;
  scenery?: boolean;
}

export class RestaurantScene {
  readonly scene = new THREE.Scene();
  readonly layout = layout;
  private readonly scenery: CopperAndThyme;
  readonly sceneryReady: Promise<boolean>;

  private readonly owners = new Map<string, THREE.Group>();
  private readonly grid: THREE.GridHelper;
  private readonly competitor: THREE.Group;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly ambient: THREE.AmbientLight;
  private readonly practicalLights: THREE.PointLight[] = [];
  private readonly ambientBaseColor = 0xffffff;

  // --- STORY-016: 3D visual state language --------------------------------------------------
  /** Live customers and workers — spawn/despawn entities, reconciled by `EntityViewRegistry`
   * the same way `owners` is, one kind each ('customers', 'workers'), from `GameClient.ts`. */
  private readonly customers = new Map<string, THREE.Group>();
  private readonly workers = new Map<string, THREE.Group>();
  /** One lazily-built badge sprite per table id — tables themselves are static (built once from
   * `layout.entities`), so only the badge shown above one needs to change per snapshot. */
  private readonly tableBadges = new Map<string, THREE.Sprite>();
  /** One queue-box stack + one shortage glyph + one waiting glyph per station — built once in
   * the constructor, since the station set is fixed (`STATIONS`), unlike tables/customers/
   * workers. `waitingIcon` is STORY-041's addition — see `updateStationIndicators`. */
  private readonly stationIndicators = new Map<
    Station,
    { queueBoxes: THREE.Mesh[]; shortageIcon: THREE.Sprite; waitingIcon: THREE.Sprite }
  >();
  /** Authored ingredient props for the active menu, placed on the physical pantry surface. */
  private readonly pantryIngredientProps = new Map<string, THREE.Group>();
  /** One authored plate per delivered ticket, attached to its table while the party eats/pays. */
  private readonly tableDishes = new Map<string, THREE.Group>();
  /** STORY-030. Spawn/despawn ready-dish proxies at the service pass, one per ready ticket —
   * same seam as `customers`/`workers` above (`GameClient.ts` reconciles a 'readyDishes' kind
   * through `EntityViewRegistry`), unlike the fixed-count `tableBadges`/`stationIndicators`
   * above. Supersedes STORY-016's single `foodReadyIcon` sprite (removed). */
  private readonly upgradedStations = new Map<string, boolean>();
  private readonly readyDishes = new Map<string, THREE.Group>();
  /** Which of `MAX_READY_DISH_SLOTS` fixed pass positions each live ticket currently occupies —
   * see `readyDishSlotPosition`'s own comment on why slots are stable, not reflowed. */
  private readonly readyDishSlots = new Map<string, number>();
  private readonly readyDishSlotUsed: boolean[] = new Array(MAX_READY_DISH_SLOTS).fill(false);
  /** STORY-043. The kitchen order queue board's own dish-proxy pool — same spawn/despawn seam as
   * `readyDishes` (a distinct `EntityViewRegistry` kind, 'queueBoardDishes'), but rank-indexed,
   * not held-slot — see `queueBoardSlotPosition`'s own header comment on why there is no
   * `queueBoardDishSlots`/`...SlotUsed` pair to mirror `readyDishSlots` here. */
  private readonly queueBoardDishes = new Map<string, THREE.Group>();
  /** The counter bell (`buildReadyBell`) — replaces the ticket-ready screen toast with a
   * diegetic, hard-to-miss cue: it bounces and sparks whenever `readyDishes` is non-empty, and
   * sits still and dark otherwise. One fixed fixture, not spawn/despawn per ticket like
   * `readyDishes` above — it signals "something is ready", not which ticket. */
  private readyBell!: THREE.Group;
  private readyBellActive = false;
  private readonly readyBellSparks: THREE.Sprite[] = [];
  /** The rival's own "table" boxes and sign, captured from `buildCompetitor()` so
   * `updateRivalActivity` can recolor them without rebuilding the shell. */
  private competitorSlab!: THREE.Mesh;
  private readonly competitorTables: THREE.Mesh[] = [];
  private readonly competitorSign: THREE.Mesh;
  /** The authored rival cutaway reuses the primary GLB's geometry with a material-isolated
   * palette; these surfaces carry the rival's live occupancy glow during Peek. */
  private rivalScenery: THREE.Group | null = null;
  private readonly rivalActivityMeshes: THREE.Mesh[] = [];
  /** STORY-031. Per-player, per-ticket carry-socket dish proxies — a NESTED map (unlike
   * `readyDishes`' flat one) because two owners can each be carrying at once, and `setCarriedDishes`
   * needs to diff/prune ONE player's own set without touching the other's. Children of that
   * player's own `owners` group, so they translate/rotate with the avatar for free. */
  private readonly carriedDishes = new Map<string, Map<string, THREE.Group>>();
  /** STORY-031. One target marker (chip + arrow + pulsing ring) per destination table currently
   * targeted by a carried order, keyed by `tableId` and built lazily — see `updateCarryTargets`'s
   * own comment on why markers are hidden, not destroyed, when a table stops being targeted. */
  private readonly carryTargets = new Map<string, THREE.Group>();
  /** STORY-056. One marker (floor ring + oversized glyph above the diners' heads) per table with
   * an unresolved complaint (`CustomerSnapshot.unhappy`), keyed by `tableId` and built lazily —
   * same "hide, never destroy, when no longer active" discipline as `carryTargets` above, since a
   * complaint can be handled and a new one can start at the same table later in the same match. */
  private readonly complaintMarkers = new Map<string, THREE.Group>();
  constructor(options: RestaurantSceneOptions = {}) {
    this.scene.background = new THREE.Color(0x0b1512);

    // STORY-059: darken the flat/uniform base lighting for more contrast against the 3 practical
    // `PointLight`s below (intensities 4.2/3.1/1.25) and the bloom pass meant to make them pop —
    // was 0.48 day / (0.65 fixed) hemisphere; lowered ~1/3 so the practical lights read as a
    // bigger jump off the base level instead of getting washed out by flat ambient fill.
    // `keyLight` (the directional "sun", below) is left at its existing intensity — it already
    // carries direction/shadow and isn't the flat contribution this ask is about; only
    // ambient/hemisphere/exposure are darkened (screenshot-verified legible, see implementation
    // notes). Night's own ambient is darkened by a similar proportion in `setNight()` below so day
    // stays visibly brighter than night.
    this.ambient = new THREE.AmbientLight(0xffffff, 0.32);
    this.scene.add(this.ambient);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    this.keyLight.color.setHex(0xffdfb0);
    this.keyLight.position.set(-12, 18, -6);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.radius = 4;
    // STORY-059: this frustum used to be left:-18/right:18/top:20/bottom:-20. IMPORTANT: these
    // bounds are in the shadow camera's OWN view space, not world x/z — `keyLight` sits at
    // (-12, 18, -6) aiming at the origin, so its view basis is rotated off the world axes in
    // plan (not axis-aligned). Working out the actual basis (z_cam = normalize(light - target),
    // x_cam = normalize(worldUp × z_cam)) and projecting the real floor's 4 corners
    // (`shared/game-data/restaurant-layout.json`'s `bounds`: x -9..9, z -12..12) onto it: the
    // worst-case corners land at left/right ≈ ±14.8 (x_cam has a zero world-y component, so
    // standing height never makes this worse) and top/bottom ≈ ±10.8 at floor level, growing to
    // ≈ +13.7 at the top for a ~5m-tall prop — that 13.7 figure rests on an ASSUMED prop height,
    // not a measured one, so top is given real margin past it rather than trimmed to match it
    // exactly. (A first pass at ±11/top:14/bottom:-16 clipped the real floor's far corners on x —
    // caught only by re-deriving this math, since the resulting shadow loss reads as the floor
    // going flatter there, not as a visible hard edge.) Tightened to left:-16/right:16 (~1.2
    // margin past the ±14.8 requirement), top:16 (~2.3 margin past the ~13.7 tall-prop estimate,
    // rather than the ~0.3 a bare top:14 would leave), and bottom:-16 (generous margin toward the
    // street/rival side — the rival's slab at `buildCompetitor()`'s z -20..-31 was never fully
    // covered even by the OLD bottom:-20, so -16 here is not a new regression there). Net area
    // 32×32=1024 vs the original 36×40=1440 — about 1.4x shadow-map texel density at the SAME
    // 2048 resolution, a real if more modest win than a naive (and wrong) world-space reading of
    // the old numbers would suggest. The "visually confirmed no clipping... via the
    // `restaurant-layout` harness" claim this comment used to end on was checked against
    // whatever frustum was ACTUALLY live at the time — which STORY-062 (below) found was never
    // this one; see that note for what was really being observed.
    // BUGFIX (STORY-062): Object.assign only sets these plain fields on the OrthographicCamera
    // instance — three.js's shadow-map render path (WebGLShadowMap -> LightShadow.updateMatrices)
    // uses the camera's existing `projectionMatrix` as-is every frame and never recomputes it from
    // left/right/top/bottom/near/far on its own. Without the explicit updateProjectionMatrix()
    // call below, this frustum silently never took effect and the shadow camera kept rendering
    // with DirectionalLightShadow's constructor-default frustum (OrthographicCamera(-5, 5, 5, -5,
    // 0.5, 500)) instead of the fitted one documented above — so every texel-density and
    // no-clipping claim above was made against that tiny ±5 default, not the intended ±16 one.
    // With the default frustum's area (10×10=100) actually smaller than the intended one
    // (32×32=1024), fixing this trades texel density for coverage: shadows over the region the
    // default already covered may read softer/blockier at the same 2048 map size and radius:4
    // PCF blur, not sharper — the real win is that owner/props far from center (previously
    // outside the tiny default frustum, silently unshadowed) are now covered at all.
    Object.assign(this.keyLight.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
    this.keyLight.shadow.camera.updateProjectionMatrix();
    this.keyLight.shadow.normalBias = 0.035;
    this.keyLight.shadow.bias = -0.0002;
    // STORY-059: was 0.65 — darkened alongside `ambient` above, same reasoning.
    this.scene.add(new THREE.HemisphereLight(0xc5dcf2, 0x695138, 0.4));
    this.scene.add(this.keyLight);
    // Warm practical pools keep the stainless work line and dining room dimensional. They do
    // not cast additional shadows; the key light owns shadowing while these lights provide the
    // amber bounce that the bloom pass can catch on the scene's authored Glow surfaces.
    for (const lightSpec of [
      { color: 0xffad58, intensity: 4.2, distance: 13, position: [-2, 5.8, 4] as const },
      { color: 0xffd38a, intensity: 3.1, distance: 11, position: [4.5, 4.6, -1.5] as const },
      { color: 0x78c9ff, intensity: 1.25, distance: 10, position: [-6, 3.6, -4] as const },
    ]) {
      const light = new THREE.PointLight(lightSpec.color, lightSpec.intensity, lightSpec.distance, 2);
      light.position.set(lightSpec.position[0], lightSpec.position[1], lightSpec.position[2]);
      light.userData.baseIntensity = lightSpec.intensity;
      this.practicalLights.push(light);
      this.scene.add(light);
    }
    this.scene.fog = new THREE.FogExp2(0x0b1512, 0.018);

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

    this.buildWayfinding();
    this.buildReadyBell();
    this.buildStreetscape();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    this.scenery = new CopperAndThyme(this.scene);
    this.sceneryReady = this.scenery.ready.then((loaded) => {
      if (loaded) {
        for (const [station, upgraded] of this.upgradedStations) this.setStationUpgraded(station, upgraded);
        this.installRivalScenery();
      }
      return loaded;
    });
    this.scenery.setVisible(options.scenery ?? true);
    this.setNight(options.night ?? false);
  }

  setSceneryVisible(visible: boolean): void {
    this.scenery.setVisible(visible);
  }

  setHostStandSpecial(specialId: string | null): void {
    const stand = this.scene.getObjectByName('host_stand');
    const old = stand?.getObjectByName('label_host_stand');
    if (!stand || !old) return;
    if (old.userData.specialId === specialId) return;
    old.parent?.remove(old);
    const label = createLabelSprite(specialId ? specialId.replace(/_/g, ' ').toUpperCase() : 'WELCOME', 0xd4e7dd, 0.68);
    label.name = 'label_host_stand'; label.userData.specialId = specialId; label.position.copy(old.position);
    stand.add(label);
  }

  /** STORY-033. The physical pantry carries the same risk and inbound-delivery state as its board. */
  setPantryCommandState(risk: string, deliveryCount: number): void {
    const pantry = this.scene.getObjectByName('pantry');
    const old = pantry?.getObjectByName('label_pantry');
    if (!pantry || !old) return;
    const signature = `${risk}:${deliveryCount}`;
    if (old.userData.pantrySignature === signature) return;
    old.parent?.remove(old);
    const colors: Record<string, number> = {
      STOCKED: 0x65c88a,
      WATCH: 0xe6c45a,
      'AT RISK': 0xe89145,
      BLOCKING: 0xe05b4f,
    };
    const label = createLabelSprite(
      `PANTRY · ${risk}${deliveryCount > 0 ? ` · ${deliveryCount} INBOUND` : ''}`,
      colors[risk] ?? 0xd4e7dd,
      0.74,
    );
    label.name = 'label_pantry';
    label.userData.pantrySignature = signature;
    label.position.copy(old.position);
    pantry.add(label);

    let crates = pantry.getObjectByName('supplier_delivery_crates') as THREE.Group | undefined;
    if (!crates) {
      crates = new THREE.Group();
      crates.name = 'supplier_delivery_crates';
      for (let i = 0; i < 2; i += 1) {
        const crate = this.box(0.55, 0.45, 0.55, 0xc88742);
        crate.position.set(-0.42 + i * 0.72, 1.2 + i * 0.25, -0.85);
        crates.add(crate);
      }
      pantry.add(crates);
    }
    crates.visible = deliveryCount > 0;
  }

  /** The private pantry snapshot chooses which ingredient models belong on this restaurant's
   * shelf. Colored pads show stock risk while the pantry board remains the exact count readout. */
  setPantryIngredients(ingredients: Array<{
    ingredientId: string;
    count: number;
    incomingUnits: number;
    risk: 'STOCKED' | 'WATCH' | 'AT RISK' | 'BLOCKING';
  }>): void {
    const pantry = this.scene.getObjectByName('pantry');
    if (!pantry) return;
    const seen = new Set<string>();
    const riskColors: Record<string, number> = {
      STOCKED: 0x65c88a,
      WATCH: 0xe6c45a,
      'AT RISK': 0xe89145,
      BLOCKING: 0xe05b4f,
    };
    ingredients.forEach((ingredient, index) => {
      seen.add(ingredient.ingredientId);
      let holder = this.pantryIngredientProps.get(ingredient.ingredientId);
      if (!holder) {
        holder = new THREE.Group();
        holder.name = `pantry_ingredient_${ingredient.ingredientId}`;
        const pad = new THREE.Mesh(
          new THREE.CylinderGeometry(0.2, 0.2, 0.025, 18),
          new THREE.MeshStandardMaterial({ color: riskColors[ingredient.risk], roughness: 0.65 }),
        );
        pad.name = 'stock_risk_pad';
        pad.position.y = -0.015;
        holder.add(pad, buildArcadeFoodProxy(ingredient.ingredientId, { scale: 1.3 }));
        pantry.add(holder);
        this.pantryIngredientProps.set(ingredient.ingredientId, holder);
      }
      const column = index % 6;
      const row = Math.floor(index / 6);
      holder.position.set((column - 2.5) * 0.42, 0.78, (row - 1) * 0.4);
      holder.scale.setScalar(ingredient.count > 0 ? 1 : 0.82);
      holder.userData.stockCount = ingredient.count;
      holder.userData.incomingUnits = ingredient.incomingUnits;
      const pad = holder.getObjectByName('stock_risk_pad');
      if (pad instanceof THREE.Mesh && pad.material instanceof THREE.MeshStandardMaterial) {
        pad.material.color.setHex(riskColors[ingredient.risk]);
        pad.material.emissive.setHex(ingredient.risk === 'BLOCKING' ? 0x4a0804 : 0x000000);
      }
    });
    for (const [ingredientId, holder] of this.pantryIngredientProps) {
      if (seen.has(ingredientId)) continue;
      holder.removeFromParent();
      disposeFoodObject(holder);
      this.pantryIngredientProps.delete(ingredientId);
    }
  }

  /** STORY-036. The pass board mirrors the authoritative focus selected on the server. */
  setKitchenFocus(focusName: string): void {
    const board = this.scene.getObjectByName('kitchen_command_board');
    const old = board?.getObjectByName('label_kitchen_command_board');
    if (!board || !old || old.userData.focusName === focusName) return;
    old.parent?.remove(old);
    const label = createLabelSprite(focusName.toUpperCase(), 0xffd27a, 0.6);
    label.name = 'label_kitchen_command_board';
    label.userData.focusName = focusName;
    label.position.copy(old.position);
    board.add(label);
  }

  /** STORY-035. Persistent, in-world props for each front-door investment. The server-published
   * owned-id set controls visibility; these meshes carry no game rules. */
  setFrontDoorUpgrades(ownedIds: string[]): void {
    const owned = new Set(ownedIds);
    const definitions = [
      ['host_stand_toolkit_1', 3.35, -8.75, 0x5fbf9e, 'TABLET'],
      ['street_signage_1', -1.5, -10.7, 0x2d2922, 'SPECIALS'],
      ['queue_pager_1', 4.0, -9.2, 0x7667c9, 'PAGERS'],
      ['guest_recovery_kit_1', 2.4, -9.15, 0xd96b55, 'RECOVERY'],
      ['maitre_d_radio_1', 3.7, -8.9, 0x3ab0d9, 'RADIO'],
      ['window_display_1', 0, -8.3, 0xd9b23a, 'FEATURE'],
    ] as const;
    for (const [id, x, z, color, labelText] of definitions) {
      let group = this.scene.getObjectByName(`front_upgrade_${id}`) as THREE.Group | undefined;
      if (!group) {
        group = new THREE.Group();
        group.name = `front_upgrade_${id}`;
        group.position.set(x, 0, z);
        const prop = this.box(
          id === 'street_signage_1' || id === 'window_display_1' ? 1.8 : 0.45,
          id === 'street_signage_1' ? 1.5 : 0.55,
          0.18,
          color,
        );
        group.add(prop);
        const label = createLabelSprite(labelText, 0xf4ead5, 0.5);
        label.position.set(0, id === 'street_signage_1' ? 1.7 : 0.8, 0);
        group.add(label);
        this.scene.add(group);
      }
      group.visible = owned.has(id);
    }
  }

  private buildWayfinding(): void {
    for (const entity of this.layout.entities) {
      // STORY-056. Reported: "instead of listing the table numbers, only show them when you are
      // delivering food" — this loop used to unconditionally attach a permanent `formatTableChip`
      // placard ("T04") to EVERY table, for the life of the scene. That duplicated (and
      // permanently pre-empted) `buildCarryTargetMarker`/`updateCarryTargets` below, which already
      // shows the identical chip, plus a ring and arrow, ONLY while a player is actively carrying
      // an order bound for that table — exactly "only show when delivering". Tables are the only
      // entity type this affects: station/pass/other wayfinding labels below are unrelated to the
      // complaint and stay exactly as they were. (Verified no HUD/alert code elsewhere assumes a
      // table's number is permanently visible in the 3D scene — `hud-alerts.js` and
      // `ArcadeToast.tsx` both carry `tableId` as structured data/HUD text, never as a lookup
      // against an in-world placard, and no other code reaches into the scene by
      // `label_${tableId}`.)
      if (entity.type === 'table') continue;
      const label = entity.type === 'station' ? entity.station!.toUpperCase()
        : ({ service_pass: 'PICKUP', pantry: 'PANTRY', dishwashing: 'WASH',
            upgrade_terminal: 'UPGRADES', host_stand: 'WELCOME', service_station: 'SERVICE',
            kitchen_command_board: 'RUSH THE PASS',
            // STORY-043. "Expo rail" is the real-world name for the shelf a kitchen stages
            // outstanding tickets on, in priority order, for whoever's free to grab the next one.
            kitchen_order_queue_board: 'EXPO RAIL' } as Record<string, string>)[entity.id];
      if (!label) continue;
      // Bumped 1.6x from 0.42 — these wayfinding placards (station names, PICKUP/PANTRY/
      // UPGRADES/etc.) were reported hard to read from the normal play camera.
      const sprite = createLabelSprite(label, 0xd4e7dd, 0.68);
      sprite.name = `label_${entity.id}`;
      // STORY-057. `kitchen_order_queue_board` alone gets a lifted y — see
      // `QUEUE_BOARD_LABEL_Y`'s own comment for why the shared 0.19 now collides with its
      // enlarged picture grid.
      sprite.position.set(
        0,
        entity.id === 'kitchen_order_queue_board' ? QUEUE_BOARD_LABEL_Y : 0.19,
        entity.id === 'kitchen_order_queue_board' ? 0 : entity.type === 'station' ? -1.25 : -0.85,
      );
      this.scene.getObjectByName(entity.id)?.add(sprite);

      // Reported: the command-post labels (UPGRADES/WELCOME/SERVICE/RUSH THE PASS) weren't
      // "obvious enough to change the operation" even after the label-scale pass above. A text
      // pill still reads as scenery from across the floor; a big "E" badge — the exact key the
      // HUD's own `.interact-prompt` already shows once in range (`GameView.tsx`) — reads as an
      // affordance at a glance, the same way a real venue's illuminated door/counter signage
      // does. Scoped to just these four: tables/stations are READ (their badge/state is the
      // point), not walked-up-to-and-pressed-E the way these command posts are.
      if (COMMAND_POST_IDS.has(entity.id)) {
        const badge = createGlyphSprite('E', 0xffd27a, 0.95);
        badge.name = `command_badge_${entity.id}`;
        // STORY-057. Same lift as the label above, for the same reason — see
        // `QUEUE_BOARD_BADGE_Y`'s own comment.
        badge.position.set(
          0,
          entity.id === 'kitchen_order_queue_board' ? QUEUE_BOARD_BADGE_Y : 1.75,
          entity.id === 'kitchen_order_queue_board' ? 0 : entity.type === 'station' ? -1.25 : -0.85,
        );
        this.scene.getObjectByName(entity.id)?.add(badge);
      }
    }
    // Reported: "the expo rail has the icons overlap the board and you can't see them at times."
    // Root cause — this sign and `kitchen_order_queue_board` (STORY-057's back-wall expo rail,
    // its original position [-3, 0, 10.8]) occupied overlapping world space: the
    // original board's card grid spanned world x -7..1, y 0..4.4 (`QUEUE_BOARD_ROW_Y`'s top row centers at
    // y=3.25), plus its own "EXPO RAIL" label/badge up to y=6.0 (`QUEUE_BOARD_LABEL_Y`/
    // `QUEUE_BOARD_BADGE_Y`) — this sign's OLD y=3.6 sat squarely inside that top row's band, at
    // an x/z close enough to the board's face to land in the same screen region from the default
    // camera angle. `createLabelSprite` renders with `depthTest: false` (a deliberate choice for
    // small always-on-top badges — see that function's own header), so whenever the two
    // overlapped on screen this sign always won, painting over whichever dish card sat behind it
    // — "can't see them AT TIMES" because the collision is only visible once the board actually
    // has cards queued there. Raised well clear of the board's tallest element (badge at y=6.0)
    // rather than shifted in x/z, since re-deriving a camera-projection offset is more fragile
    // than a comfortable, direct vertical margin. Re-verified in the browser
    // (`?harness=kitchen-bottleneck`, "Spawn rush (8 tickets)"): no overlap with any card/badge
    // at this height, at the width this board's grid actually uses.
    const title = createLabelSprite('COPPER & THYME', 0xf0d7a0, 1.3);
    title.position.set(0, 7.2, 11.8);
    title.name = 'restaurant_identity';
    this.scene.add(title);
    const rival = createLabelSprite('RIVAL', 0xf0c2ad, 1.15);
    rival.position.set(0, 3.8, -26);
    this.competitor.add(rival);
  }

  /** Reported: the ticket-ready screen toast was easy to miss/ignore mid-rush. This builds a
   * physical bell on the counter instead — `ArcadeToast.tsx` no longer queues a toast for
   * `ticket-ready` at all, and `setReadyBellActive`/`updateReadyBellAnimation` below make the
   * bell itself the "something is ready" cue. Positioned past `READY_DISH_SLOT_X_RANGE`'s own
   * span so it never overlaps a plate proxy, however many tickets are live. */
  private buildReadyBell(): void {
    const group = new THREE.Group();
    group.name = 'ready_bell';

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.38, 0.08, 20),
      new THREE.MeshStandardMaterial({ color: 0x8a6a34, roughness: 0.4, metalness: 0.6 }),
    );
    base.position.y = 0.04;
    group.add(base);

    // A sphere clipped to its top hemisphere (thetaLength = PI/2) is a dome — a real call
    // bell's body — sitting flat-side-down on `base` without needing a lathe geometry.
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xd8ad3f, roughness: 0.3, metalness: 0.75 }),
    );
    dome.position.y = 0.08;
    group.add(dome);

    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xf3d979, roughness: 0.25, metalness: 0.8 }),
    );
    knob.position.y = 0.4;
    group.add(knob);

    for (let i = 0; i < READY_BELL_SPARK_COUNT; i += 1) {
      const spark = createGlyphSprite('•', STATE_COLORS.healthy, 0.22);
      spark.visible = false;
      spark.name = `ready_bell_spark_${i}`;
      group.add(spark);
      this.readyBellSparks.push(spark);
    }

    group.position.set(-7.3, 0.45, -0.1);
    this.readyBell = group;
    const passMesh = this.scene.getObjectByName('service_pass');
    if (passMesh) passMesh.add(group);
    else this.scene.add(group); // defensive: layout has always declared exactly one service_pass
  }

  /** Toggled by `upsertReadyDish`/`removeReadyDish` off `readyDishes.size` — see `buildReadyBell`'s
   * own comment. A no-op when the state hasn't actually changed, so a snapshot with one ready
   * ticket replacing another doesn't reset the bounce/spark phase mid-animation. */
  private setReadyBellActive(active: boolean): void {
    if (this.readyBellActive === active) return;
    this.readyBellActive = active;
    for (const spark of this.readyBellSparks) spark.visible = active;
    if (!active) {
      this.readyBell.position.y = 0.45;
      this.readyBell.rotation.z = 0;
    }
  }

  private buildStreetscape(): void {
    const district = new THREE.Group();
    district.name = 'district_backdrop';
    const ground = this.box(64, 0.15, 64, 0x89978a);
    ground.position.set(0, -0.7, -8);
    district.add(ground);
    const street = this.box(54, 0.12, 8, 0x4b5758);
    street.position.set(0, -0.5, -16);
    district.add(street);
    for (let x = -25; x <= 25; x += 5) {
      const stripe = this.box(2, 0.02, 0.12, 0xd4c8a5);
      stripe.position.set(x, -0.42, -16);
      district.add(stripe);
    }
    for (const x of [-11, 11]) {
      const sidewalk = this.box(2.4, 0.25, 28, 0xa8aba0);
      sidewalk.position.set(x, -0.35, 0);
      district.add(sidewalk);
      for (const z of [-9, 8]) {
        const pot = this.box(1.2, 0.6, 1.2, 0x93694d);
        pot.position.set(x, 0.15, z);
        district.add(pot);
        const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1),
          new THREE.MeshStandardMaterial({ color: 0x456943, roughness: 0.9 }));
        leaves.position.set(x, 0.95, z);
        district.add(leaves);
      }
    }
    // Background shop facades sit outside movement bounds and below the dining sightline.
    for (const x of [-19, 19]) {
      const shop = this.box(8, 3.5, 12, x < 0 ? 0xaaa08e : 0x9eafa5);
      shop.position.set(x, 1.1, 6);
      district.add(shop);
      const roof = this.box(8.3, 0.2, 12.3, 0x566962);
      roof.position.set(x, 2.95, 6);
      district.add(roof);
      for (const dx of [-2.5, 0, 2.5]) {
        const window = this.box(1.6, 1.8, 0.1, 0x334e4c);
        window.position.set(x + dx, 1.25, -0.06);
        district.add(window);
      }
    }
    district.visible = false;
    this.scene.add(district);
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
      case 'service_station':
        return this.box(1.2, 1.0, 0.8, 0x3ab0d9);
      // STORY-057. Report: "the 'rush the pass' ... option ... sometimes collide[s] with food,
      // put the option back deeper in the kitchen". Confirmed, not assumed: at this board's old
      // position (`restaurant-layout.json` used to say `[2.5, 0, 2]`), it sat at the SAME z as
      // `service_pass` ([0, 0, 2]) — `readyDishSlotPosition`'s `READY_DISH_SLOT_X_RANGE` (6.5)
      // spans ready-dish proxies across world x -6.5..6.5 at that same z, which fully covered
      // this board's x=2.5. Moved to `[4, 0, 3.5]` — past the "kitchen" zone's own z=3 boundary
      // (`restaurant-layout.json`'s `zones[]`), clear of the pass box (`service_pass`'s
      // `this.box(16, 0.9, 0.8, ...)` spans z 1.6-2.4; this board's own 0.22-deep box at z=3.5
      // spans z 3.39-3.61 — a 0.99 z gap, independent of x) and of every station's box
      // (`station`'s `this.box(2.4, 1.0, 1.4, ...)` at z=5 spans z 4.3-5.7 — a 0.69 z gap).
      //
      // x=4 is deliberate, not just "nudge z": `nearKitchenCommandBoard`'s trigger uses
      // `OWNER_INTERACT_RANGE` (2.2, `InteractionController.ts#inRange`) regardless of this
      // entity's own declared `interactionRadius: 1.6` in the layout — checked codebase-wide
      // (`grep -rn '\.interactionRadius\b'` across client/server finds exactly two reads, both
      // `upgrade_terminal`'s; `kitchen_command_board`'s own field is presently DEAD, read by
      // nothing — a pre-existing fact this story did not introduce, left as-is since fixing it is
      // out of this story's scope). So the real threat isn't the declared 1.6, it's 2.2: if this
      // board's own trigger circle reached a STATION's anchor point, `GameClient.ts#onInteract`'s
      // `if (nearKitchenCommandBoard) {...; return;}` sits ABOVE the `this.status.prompt` fallback
      // that resolves `E — Cook X`/`E — Plate X` — so overlap there wouldn't just be visually
      // confusing, it would make a station's own cook prompt UNREACHABLE by E while standing on
      // it. At the original x=2.5 (matching `station_oven`'s x=2), no z between 3 and 5 clears
      // that bar (distance to oven at x=2.5 needs z<2.857 to exceed 2.2, which is BELOW the z=3
      // floor this story requires) — so x had to move too. x=4 sits at the oven/plating x
      // midpoint (oven x=2, plating x=6): distance from [4,3.5] to `station_oven` [2,0,5] is
      // sqrt(2^2 + 1.5^2) = sqrt(4+2.25) = 2.5, to `station_plating` [6,0,5] the same 2.5, to
      // `service_pass` [0,0,2] sqrt(4^2+1.5^2) = sqrt(18.25) = 4.27, to every other kitchen entity
      // (`station_prep`/`station_grill`/`pantry`/`dishwashing`/`kitchen_order_queue_board`, all
      // >=6 units away in x or z) further still — every one exceeds 2.2 with margin, so no other
      // interactable's own anchor point falls inside this board's trigger circle (the concrete,
      // achievable bar; the naive "combined-radii" ceiling of 4.4 STORY-053 used for
      // `.upgrade-terminal` is NOT clear of the two nearest stations at 2.5 each, but that
      // stricter bar is already broken elsewhere in this shipped layout by design — adjacent
      // stations sit exactly 4 apart against their own 2.2+2.2 combined ceiling).
      // The queue board now occupies the clear wall at [1, 0, 10.8], also outside this trigger.
      case 'kitchen_command_board':
        return this.box(2.2, 1.5, 0.22, 0x392f27);
      // Keep the panel child rooted above the floor: buildEntities positions the parent at y=0.
      // The narrower panel fits between the pantry shelves and dishwashing furniture.
      case 'kitchen_order_queue_board': {
        const group = new THREE.Group();
        group.add(this.box(8, 4.4, QUEUE_BOARD_PANEL_DEPTH, 0x3a4652));
        return group;
      }
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
    this.competitorSlab = slab;
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

  /** Mount the same authored room a second time for Peek, then give it a clear rival identity.
   * The GLB clone is scaled into the compact rival footprint and kept under the existing
   * competitor group so the hold-to-peek camera and visibility seam remain unchanged. */
  private installRivalScenery(): void {
    if (this.rivalScenery) return;
    const variant = this.scenery.createRivalVariant();
    if (!variant) return;

    for (let i = 1; i <= 6; i += 1) {
      const table = variant.getObjectByName(`table_${i}`);
      if (!table) continue;
      let surface: THREE.Mesh | null = null;
      table.traverse((object) => {
        if (surface || !(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some((material) => /Ceramic|Linen|OakLight|Walnut/.test(material.name))) surface = object;
      });
      if (!surface) table.traverse((object) => { if (!surface && object instanceof THREE.Mesh) surface = object; });
      if (surface) this.rivalActivityMeshes.push(surface);
    }

    // Duplicate names would make scene.getObjectByName('table_1') ambiguous for the live player's
    // interaction layer. Prefix every rival node after collecting the activity surfaces above.
    variant.traverse((object) => {
      if (object !== variant && object.name) object.name = `rival_${object.name}`;
    });
    variant.add(this.buildRivalAccents());
    variant.scale.setScalar(0.52);
    variant.position.set(0, 0, RestaurantScene.RIVAL_FLOOR.centerZ);
    this.rivalScenery = variant;
    this.competitor.add(variant);

    // The authored variant now supplies the rival's floor, tables, and kitchen. Keep the old
    // shell meshes as an activity fallback for export/harness code, but remove them from the
    // player-facing Peek view so the silhouette reads as one coherent restaurant.
    this.competitorSlab.visible = false;
    this.competitorTables.forEach((table) => { table.visible = false; });
    this.competitorSign.visible = false;
  }

  /** Rival-only dressing: jewel-toned succulents, a small neon rail, and pendant lamps make the
   * second room feel authored rather than like a recolored duplicate of Copper & Thyme. */
  private buildRivalAccents(): THREE.Group {
    const accents = new THREE.Group();
    accents.name = 'rival_accents';
    const planterPositions = [
      [-7.3, -7.2, 0xc86879], [6.8, -6.5, 0x5db3a6], [-7.2, 7.2, 0x8c6bb4], [6.7, 7.4, 0xe09a57],
    ] as const;
    for (const [x, z, potColor] of planterPositions) {
      const planter = new THREE.Group();
      planter.position.set(x, 0, z);
      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.58, 0.44, 0.62, 12),
        new THREE.MeshStandardMaterial({ color: potColor, roughness: 0.55 }),
      );
      pot.position.y = 0.31;
      planter.add(pot);
      const soil = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.035, 16),
        new THREE.MeshStandardMaterial({ color: 0x302035, roughness: 0.95 }),
      );
      soil.position.y = 0.63;
      planter.add(soil);
      for (let i = 0; i < 6; i += 1) {
        const angle = (i / 6) * Math.PI * 2;
        const leaf = new THREE.Mesh(
          new THREE.SphereGeometry(0.18, 8, 6),
          new THREE.MeshStandardMaterial({ color: i % 2 ? 0x5db3a6 : 0x2f776e, roughness: 0.75 }),
        );
        leaf.scale.set(0.52, 1.5, 0.34);
        leaf.position.set(Math.cos(angle) * 0.22, 0.9 + (i % 3) * 0.06, Math.sin(angle) * 0.22);
        leaf.rotation.z = Math.cos(angle) * 0.45;
        leaf.rotation.x = Math.sin(angle) * -0.35;
        planter.add(leaf);
      }
      accents.add(planter);
    }

    const railMaterial = new THREE.MeshStandardMaterial({
      color: 0x54d4d2,
      emissive: 0x1b8e9b,
      emissiveIntensity: 1.2,
      metalness: 0.25,
      roughness: 0.3,
    });
    const neonRail = new THREE.Mesh(new THREE.BoxGeometry(11, 0.1, 0.1), railMaterial);
    neonRail.position.set(0, 4.85, 10.3);
    accents.add(neonRail);

    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(8, 1.15, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x28152f, roughness: 0.5, metalness: 0.25 }),
    );
    sign.position.set(0, 5.45, 10.45);
    const signLabel = createLabelSprite('RIVAL CANTEEN', 0xffb1c1, 0.5);
    signLabel.position.set(0, 0.02, 0.1);
    sign.add(signLabel);
    accents.add(sign);

    for (const [x, color] of [[-4.2, 0xffb347], [4.2, 0x73e0dd]] as const) {
      const pendant = new THREE.Group();
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.5, 8),
        new THREE.MeshStandardMaterial({ color: 0x17172b, roughness: 0.7 }));
      cord.position.y = 3.55;
      pendant.add(cord);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.26, 16, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xd67b91, emissive: color, emissiveIntensity: 0.8,
          metalness: 0.4, roughness: 0.28, side: THREE.DoubleSide }));
      shade.position.y = 2.25;
      pendant.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8),
        new THREE.MeshStandardMaterial({ color: 0xfff0d1, emissive: color, emissiveIntensity: 1.4 }));
      bulb.position.y = 2.18;
      pendant.add(bulb);
      pendant.position.set(x, 0, 4.5);
      accents.add(pendant);
    }
    return accents;
  }

  /**
   * STORY-034. Reported: "both players are still in the same restaurant." They were — the
   * opponent's raw `position` (their own restaurant's LOCAL coordinates, the same
   * x∈[-9,9]/z∈[-12,12] bounds `action-validator.js` clamps every owner to, self or rival alike)
   * was rendered with no offset at all, so their avatar walked around this restaurant's own
   * floor/tables indistinguishably from the real owner, instead of anywhere near
   * `buildCompetitor`'s decorative shell — which made that shell (and this story's own Peek
   * camera) point at an empty, avatar-less set while the real rival activity overlapped the
   * player's own floor the whole time. A linear remap into the shell's own footprint (its 6
   * "table" boxes span roughly x∈[-6,3]/z∈[-24,-20.5] — see `buildCompetitor`) is not a claim
   * that the rival's table layout matches this restaurant's; it is exactly the same "coarse
   * activity indicator, not a synced second floor" abstraction `updateRivalActivity`'s own
   * lit-box count already uses for occupancy, just extended to the one moving body.
   */
  private static readonly RIVAL_FLOOR = { halfX: 8, halfZ: 4.5, centerZ: -24.5 };
  private rivalWorldPosition(local: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const { halfX, halfZ, centerZ } = RestaurantScene.RIVAL_FLOOR;
    return { x: (local.x / 9) * halfX, y: local.y, z: centerZ + (local.z / 12) * halfZ };
  }

  /** Create or update one owner avatar. Position always comes from server state. */
  upsertOwner(state: OwnerRenderState): void {
    let group = this.owners.get(state.playerId);
    if (!group) {
      group = new THREE.Group();
      group.name = `owner_${state.playerId}`;
      // STORY-060. The capsule/sphere/cone primitive built here used to be the ENTIRE owner
      // avatar for both "self" and "rival"; it still is for rival (untouched — out of scope,
      // see the story). For "self" it is now only the synchronous placeholder: `buildChefBlaze`
      // below is async (a network fetch + parse), and gameplay must never wait on it, so this
      // primitive group renders immediately and is swapped out for the loaded rig once/if that
      // promise resolves — same "playable fallback first, atomic swap later" contract
      // `buildArcadeFoodProxy` (`FoodModels.ts`) already uses for food props, and if the GLB
      // ever fails to load, this placeholder is what's left in place rather than a hole.
      const placeholder = new THREE.Group();
      placeholder.name = 'placeholder';
      const color = state.isSelf ? 0x7ac74f : 0xd98c4a;
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.34, 0.75, 6, 12),
        new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
      );
      body.position.y = 0.85;
      placeholder.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.26, 16, 12),
        new THREE.MeshStandardMaterial({ color: 0xf0d5b8 }),
      );
      head.position.y = 1.6;
      placeholder.add(head);
      // Facing indicator — reads clearly from the high-angle camera of PRD §14. The loaded
      // Chef Blaze rig needs no equivalent: its own model-space forward orientation (baked in
      // at export — see `assets/chef-blaze/README_ThreeJS.md`) reads the same way once
      // `group.rotation.y = state.facing` below turns the whole group, primitive or not.
      const nose = new THREE.Mesh(
        new THREE.ConeGeometry(0.14, 0.4, 8),
        new THREE.MeshStandardMaterial({ color: 0x2b2f35 }),
      );
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, 1.15, 0.42);
      placeholder.add(nose);
      group.add(placeholder);
      // STORY-012 §10 "Serving Tray": up to 3 small plates, hidden until `setCarrying` shows
      // as many as the owner is actually holding. Built once here, alongside the avatar, so
      // `setCarrying` (called at snapshot cadence from `GameClient`, not every render frame)
      // only ever toggles visibility rather than allocating geometry on the hot path. Left as
      // direct children of `group` (not the placeholder) for BOTH self and rival, unchanged by
      // the Chef Blaze swap below. NOTE: `setCarrying`/these plates are legacy — real gameplay's
      // carry visual is `setCarriedDishes`'s dish proxies (STORY-031, `CARRY_DISH_SLOT_OFFSETS`
      // above); only the harnesses (`asset-showcase-harness.ts`, `upgrade-preview-harness.ts`)
      // still call `setCarrying`. Still worth getting right since the AC names it explicitly:
      // the original (0.3, 1.35+i*0.12, 0) offset was fitted to the OLD capsule's silhouette,
      // where a rounded body filled the gap out to x=0.3 at that height — on Chef Blaze's
      // narrower, arms-away-from-torso rig the same numbers floated the plates beside the HEAD,
      // clearly outside the body (checked visually in the Asset Showcase harness, "Carried
      // plates" slider at 3 — see the story's PR description). Pulled in and down to sit beside
      // the forearm/waist instead, which reads as "carried at the side" on both bodies.
      for (let i = 0; i < MAX_VISIBLE_CARRY_PLATES; i += 1) {
        const plate = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.16, 0.04, 16),
          new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.4 }),
        );
        plate.name = `plate_${i}`;
        plate.position.set(0.24, 1.0 + i * 0.11, 0.1);
        plate.visible = false;
        group.add(plate);
      }
      this.owners.set(state.playerId, group);
      this.scene.add(group);

      if (state.isSelf) {
        const ownerGroup = group;
        void buildChefBlaze()
          .then((instance) => {
            // The owner could have been removed (disconnect, harness teardown) while the GLB
            // was in flight — `removeOwner` takes the group out of `this.owners` and out of the
            // scene, but doesn't reach into this closure, so check first rather than resurrect
            // a detached group or, worse, silently leak the loaded instance.
            if (this.owners.get(state.playerId) !== ownerGroup) return;
            const stalePlaceholder = ownerGroup.getObjectByName('placeholder');
            if (stalePlaceholder) ownerGroup.remove(stalePlaceholder);
            ownerGroup.add(instance.root);
            ownerGroup.userData.chefBlaze = instance;
          })
          .catch((error: unknown) => {
            console.warn(`Chef Blaze model failed to load for ${state.playerId}; keeping placeholder.`, error);
          });
      }
    }
    // NOT the customer/`positionTarget` lerp pattern below — `upsertOwner` is called every
    // render frame (via `GameClient#handleFrame` -> `EntityViewRegistry.reconcile`) with a
    // position `StateInterpolator` has already time-interpolated between snapshots, unlike
    // customers/workers whose upsert only fires at ~10 Hz snapshot cadence and so need a
    // second, client-side smoothing layer. Setting position directly here IS the correct,
    // already-smooth behavior; a deferred `positionTarget` with no per-frame consumer left
    // every owner avatar frozen at its spawn point while the camera (which reads the same
    // interpolated position straight from `players[]`, not from this mesh) kept following
    // correctly — the exact bug this replaces.
    const worldPosition = state.remapToRivalFloor ? this.rivalWorldPosition(state.position) : state.position;
    // STORY-060. `updateOwnerAnimations` (called once per frame, right after every owner's
    // `upsertOwner`) needs to know how far THIS owner moved since last frame to decide
    // idle-vs-walk — there is no server-provided "is moving" flag (see this file's own header
    // note on why), so it's derived here from consecutive positions, the only per-frame signal
    // available. Recorded as a squared XZ distance (skip the sqrt until `updateOwnerAnimations`
    // actually needs a real speed) rather than compared against a threshold right here, because
    // this method has no `dt` — snapshot-to-snapshot wall-clock time varies with frame rate, and
    // only `updateOwnerAnimations` (fed `dt` from `GameClient#handleFrame`) can turn a raw
    // distance into a real units/second speed.
    const lastPosition = group.userData.lastOwnerPosition as THREE.Vector3 | undefined;
    if (lastPosition) {
      const dx = worldPosition.x - lastPosition.x;
      const dz = worldPosition.z - lastPosition.z;
      group.userData.recentMoveDistSq = dx * dx + dz * dz;
    } else {
      group.userData.recentMoveDistSq = 0;
    }
    group.userData.lastOwnerPosition = new THREE.Vector3(worldPosition.x, worldPosition.y, worldPosition.z);
    group.position.set(worldPosition.x, worldPosition.y, worldPosition.z);
    group.userData.remapToRivalFloor = state.remapToRivalFloor === true;
    group.visible = !state.remapToRivalFloor || this.competitor.visible;
    group.rotation.y = state.facing;
  }

  /** STORY-060. Advances the self owner's `AnimationMixer` (idle/walk crossfade — see
   * `ChefBlazeModel.ts`'s own doc comment for why a crossfade rather than a hard cut) once per
   * render frame. Split from `upsertOwner` for the same reason `updateWorkerAnimations` is split
   * from `upsertWorker`: `upsertOwner` runs once per OWNER inside `EntityViewRegistry.reconcile`
   * and has no `dt`, while this runs once per FRAME from `GameClient#handleFrame`, which does.
   * A no-op for every owner that hasn't finished loading the GLB yet (still on the primitive
   * placeholder) or isn't "self" (rival keeps its primitive permanently — see the story). */
  updateOwnerAnimations(dt: number): void {
    for (const group of this.owners.values()) {
      const chefBlaze = group.userData.chefBlaze as ChefBlazeInstance | undefined;
      if (!chefBlaze) continue;
      const distSq = (group.userData.recentMoveDistSq as number | undefined) ?? 0;
      // Squared-distance form of "speed > threshold": sqrt(distSq)/dt > OWNER_MOVE_SPEED *
      // MOVE_FRACTION becomes distSq > (OWNER_MOVE_SPEED * MOVE_FRACTION * dt)^2. The 8% cutoff
      // (`OWNER_ANIMATION_MOVE_FRACTION`, below) is well under real walking speed (so an owner
      // who is actually moving reads as walking almost immediately) but comfortably above the
      // sub-millimeter jitter `StateInterpolator`'s own smoothing leaves in an otherwise-still
      // owner — the noise a naive "moved at all since last frame" check would otherwise read as
      // a permanent, never-idle walk cycle.
      const thresholdDist = OWNER_MOVE_SPEED * OWNER_ANIMATION_MOVE_FRACTION * Math.max(dt, 1 / 1000);
      const moving = distSq > thresholdDist * thresholdDist;
      chefBlaze.update(dt, moving);
    }
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

  /**
   * STORY-031 PRD §5.3/§10.2. Supersedes `setCarrying`'s generic plate-count indicator for real
   * gameplay: one REAL dish proxy per carried DISH (not per order — see `CarriedDishRenderState`'s
   * own comment), reusing `buildDishProxy` — the exact geometry `upsertReadyDish` builds at the
   * pass — attached as a child of the owner's own avatar group so it rides along automatically.
   * `setCarrying` itself is left untouched (`asset-showcase-harness.ts`/`upgrade-preview-harness.ts`
   * still call it for their own simpler demos; nothing requires migrating them for this story).
   *
   * Build-once-per-ticket, diff-by-hand against the previous call's ticket set — same "spawn/
   * despawn, but keyed within THIS player's own sub-map" discipline `upsertReadyDish`/
   * `removeReadyDish` use for the pass, just nested one level deeper here because two owners can
   * each be carrying independently. `slots` is already capped by the caller
   * (`GameClient.ts` slices `carrying` to `carryCapacity` before resolving dishes) — the
   * `MAX_VISIBLE_CARRIED_DISHES` slice below is only a defensive backstop against the harness's
   * own upgraded-capacity fixtures ever exceeding the fixed slot layout.
   */
  setCarriedDishes(playerId: string, slots: CarriedDishRenderState[]): void {
    const group = this.owners.get(playerId);
    if (!group) return;
    let byTicket = this.carriedDishes.get(playerId);
    if (!byTicket) {
      byTicket = new Map();
      this.carriedDishes.set(playerId, byTicket);
    }

    const limited = slots.slice(0, MAX_VISIBLE_CARRIED_DISHES);
    const seen = new Set<string>();
    limited.forEach((slot, i) => {
      seen.add(slot.ticketId);
      let proxy = byTicket!.get(slot.ticketId);
      if (!proxy) {
        proxy = buildDishProxy(slot.dishId);
        proxy.name = `carry_dish_${slot.ticketId}`;
        proxy.scale.setScalar(CARRY_DISH_SCALE);
        group.add(proxy);
        byTicket!.set(slot.ticketId, proxy);
      }
      const offset = CARRY_DISH_SLOT_OFFSETS[i] ?? CARRY_DISH_SLOT_OFFSETS[CARRY_DISH_SLOT_OFFSETS.length - 1];
      proxy.position.set(offset.x, offset.y, offset.z);
    });
    // Delivered or dropped since the last call — remove rather than hide, matching
    // `removeReadyDish`'s own "no lingering geometry for a ticket that no longer exists" rule.
    for (const [ticketId, proxy] of byTicket) {
      if (seen.has(ticketId)) continue;
      group.remove(proxy);
      disposeFoodObject(proxy);
      byTicket.delete(ticketId);
    }
  }

  /** STORY-012 "Faster Grill I": a hotter tint on the OWNER'S OWN grill mesh once purchased.
   * Ownership can change mid-match (unlike everything `buildAll()` builds once from static
   * layout JSON), so this is looked up by name rather than rebuilt — the one live per-entity
   * update path this file has; see the header comment on why it stays this narrow rather than
   * growing into a general visual-state system (that generalization is STORY-016's). */
  setStationUpgraded(station: string, upgraded: boolean): void {
    this.upgradedStations.set(station, upgraded);
    const mesh = this.scene.getObjectByName(`station_${station}`) as THREE.Mesh | undefined;
    if (!mesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.color.setHex(
      upgraded ? (STATION_COLORS_UPGRADED[station] ?? STATION_COLORS[station]) : (STATION_COLORS[station] ?? 0x808890),
    );
    mesh.getObjectByName(`copper_station_${station}`)?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      // Clone once: glTF materials are shared across the kitchen and dining room.
      if (!object.userData.upgradeMaterial) {
        object.material = (object.material as THREE.MeshStandardMaterial).clone();
        object.userData.upgradeMaterial = true;
      }
      const surface = object.material as THREE.MeshStandardMaterial;
      surface.emissive.setHex(upgraded ? 0xa34813 : 0x000000);
      surface.emissiveIntensity = upgraded ? 0.25 : 0;
    });
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

      // STORY-041. The missing middle state between idle (nothing queued) and actively cooking
      // (something in `active[]`): a ticket sits in this station's queue but nobody — no worker,
      // no owner interact — has started it yet. A distinct glyph at a distinct anchor from both
      // of the above, exactly as `state-color-bands.js`'s own "a shortage is a categorically
      // different signal" reasoning already argues for the shortage icon; this is a third,
      // equally distinct signal, not a recolor of either existing one.
      const waitingIcon = createGlyphSprite('…', STATE_COLORS.attention, 0.5);
      waitingIcon.position.set(STATION_WAITING_ANCHOR.x, STATION_WAITING_ANCHOR.y, STATION_WAITING_ANCHOR.z);
      waitingIcon.visible = false;
      stationMesh.add(waitingIcon);

      this.stationIndicators.set(station, { queueBoxes, shortageIcon, waitingIcon });
    }
  }

  // --- STORY-030: ready-dish proxies — spawn/despawn, reconciled by EntityViewRegistry
  // ('readyDishes') --------------------------------------------------------------------------

  /** First free pass slot for a NEWLY seen ticket — see `readyDishSlotPosition`'s own comment
   * on why slots are claimed once and held, not recomputed every snapshot. Returns `null` past
   * `MAX_READY_DISH_SLOTS` live tickets simultaneously (see that constant's own comment) — the
   * caller (`upsertReadyDish`) hides the proxy rather than placing a second one on an
   * already-occupied slot, which the AC "all remain visible without geometry overlap" rules out
   * as an option; the overlap is what would actually violate it, not a briefly-hidden 9th plate. */
  private claimReadyDishSlot(ticketId: string): number | null {
    const existing = this.readyDishSlots.get(ticketId);
    if (existing !== undefined) return existing;
    const slot = this.readyDishSlotUsed.findIndex((used) => !used);
    if (slot === -1) return null;
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
    // STORY-053. `staged` short-circuits `stale` to false regardless of `readyAgeMs` — AC4's
    // "staleness pressure does not apply while staged", without touching `readyAgeMs`'s own
    // computation (still server-authoritative, untouched by this story). This is also what makes
    // the ring's forced healthy/neutral color (spec'd separately below) fall out for free: `band`
    // can only read 'bottleneck' when `stale` is true, so a staged ticket's ring is always
    // 'healthy' by construction, never a third color of its own — the DISTINCT staged signal
    // lives entirely in the label below, not in the ring.
    const stale = !state.staged && state.readyAgeMs > ORDER_FRESHNESS_GRACE_MS;
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
      const tableChip = createLabelSprite(formatTableChip(state.tableId), STATE_COLORS.opportunity, 0.62);
      tableChip.position.set(0, 1.4, 0);
      tableChip.name = 'table_chip';
      group.add(tableChip);

      // PRD §5.2 "compact state label — READY while fresh, GOING COLD once exceeded". Both built
      // once, each already tinted its own fixed semantic color, and toggled by visibility —
      // never recolored at runtime, matching the worker task chips' "build every option once"
      // discipline above.
      const readyLabel = createLabelSprite('READY', STATE_COLORS.healthy, 0.52);
      readyLabel.position.set(0, 0.83, 0);
      readyLabel.name = 'label_ready';
      group.add(readyLabel);
      const coldLabel = createLabelSprite('GOING COLD', STATE_COLORS.bottleneck, 0.52);
      coldLabel.position.set(0, 0.83, 0);
      coldLabel.name = 'label_cold';
      group.add(coldLabel);

      // STORY-053. A THIRD label, same position/size discipline as the two above but a
      // different color family: `STATE_COLORS.premium` (purple) is not one of the two freshness
      // bands this proxy's ring/READY/GOING COLD already use (green/orange), specifically so it
      // can never read as a variant of either — this dish is not "fine" and not "spoiling", it
      // is blocked on the kitchen, which is a different fact altogether. Unlike the other two,
      // its TEXT can change after creation (a sibling ticket finishing lowers `waitingOnCount`
      // over this one ticket's own on-pass lifetime), so it is re-baked via `setLabelSpriteText`
      // on every call below rather than built once and only toggled.
      const stagedLabel = createLabelSprite(stagedLabelText(state.waitingOnCount), STATE_COLORS.premium, 0.52);
      stagedLabel.position.set(0, 0.83, 0);
      stagedLabel.name = 'label_staged';
      group.add(stagedLabel);

      group.name = `ready_dish_${state.ticketId}`;
      this.readyDishes.set(state.ticketId, group);
      const passMesh = this.scene.getObjectByName('service_pass');
      if (passMesh) passMesh.add(group);
      else this.scene.add(group); // defensive: layout has always declared exactly one service_pass
    }

    const slot = this.claimReadyDishSlot(state.ticketId);
    if (slot === null) {
      // Past `MAX_READY_DISH_SLOTS` simultaneously ready tickets — hide rather than overlap an
      // already-placed proxy (see `claimReadyDishSlot`'s own comment). Skip the rest of this
      // upsert; there is nothing else worth updating on a proxy nobody can see.
      group.visible = false;
      return;
    }
    group.visible = true;
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
    const stagedLabel = group.getObjectByName('label_staged') as THREE.Sprite;
    // STORY-053 AC2/AC4: while staged, NEITHER of the two freshness labels shows — this ticket
    // is not "READY" (the player cannot actually deliver it — its order isn't off the line) and
    // not "GOING COLD" (staleness pressure is deliberately suspended above via `stale`'s own
    // `!state.staged` guard). Only the staged label is visible. The instant a later snapshot's
    // `staged` flips false (the last sibling finished), this same block falls straight through
    // to the ordinary `!stale`/`stale` branch below on the SAME ticket entry — no despawn/respawn,
    // no extra transition code, which is what makes AC5 ("the whole group transitions together")
    // true for free.
    readyLabel.visible = !state.staged && !stale;
    coldLabel.visible = !state.staged && stale;
    stagedLabel.visible = state.staged;
    if (state.staged) setLabelSpriteText(stagedLabel, stagedLabelText(state.waitingOnCount));

    this.setReadyBellActive(true);
  }

  removeReadyDish(ticketId: string): void {
    const group = this.readyDishes.get(ticketId);
    if (!group) return;
    group.parent?.remove(group);
    disposeFoodObject(group);
    this.readyDishes.delete(ticketId);
    this.releaseReadyDishSlot(ticketId);
    this.setReadyBellActive(this.readyDishes.size > 0);
  }

  readyDishIds(): string[] {
    return [...this.readyDishes.keys()];
  }

  // --- STORY-043/STORY-057: kitchen order queue board dish PICTURES — spawn/despawn, reconciled
  // by EntityViewRegistry ('queueBoardDishes') -----------------------------------------------

  /** Reposition every update so server priority changes move cards immediately. */
  upsertQueueBoardDish(state: QueueBoardDishRenderState): void {
    let group = this.queueBoardDishes.get(state.ticketId);
    if (!group) {
      group = new THREE.Group();
      const name = DISH_NAMES.get(state.dishId) ?? state.dishId;
      group.add(createDishPicturePanel(state.dishId, name, dishPictureAccent(state.dishId), QUEUE_BOARD_PICTURE_SCALE));
      group.name = `queue_board_dish_${state.ticketId}`;
      this.queueBoardDishes.set(state.ticketId, group);
      const board = this.scene.getObjectByName('kitchen_order_queue_board');
      if (board) board.add(group);
      else this.scene.add(group); // defensive: layout has always declared exactly one board
    }

    if (state.rank >= MAX_QUEUE_BOARD_SLOTS) {
      // Past the rendering pool's cap — hide rather than overlap an already-placed card, same
      // "hide past a generous cap" discipline `claimReadyDishSlot`'s own comment documents for
      // `readyDishes` (Decision 70 in this story's own `design.md`: the SERVER list is never
      // truncated, only how many of it this scene has slots to draw).
      group.visible = false;
      return;
    }
    group.visible = true;
    const { x, y } = queueBoardSlotPosition(state.rank);
    // Mount the card on the kitchen-facing surface.
    group.position.set(x, y, QUEUE_BOARD_SLOT_Z);
  }

  removeQueueBoardDish(ticketId: string): void {
    const group = this.queueBoardDishes.get(ticketId);
    if (!group) return;
    group.parent?.remove(group);
    disposeFoodObject(group);
    this.queueBoardDishes.delete(ticketId);
  }

  queueBoardDishIds(): string[] {
    return [...this.queueBoardDishes.keys()];
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

  /** The counter bell's bounce+spark while `readyBellActive` — see `buildReadyBell`'s own
   * comment. `Math.max(0, sin(...))` clips the bounce to a "ding, settle, ding" cadence (half a
   * period of motion, half a period flat) rather than a continuous bob that fades into
   * background motion on a long glance. A no-op while inactive, same idle-cost discipline as
   * `updateReadyDishAnimations`. */
  updateReadyBellAnimation(elapsedSeconds: number): void {
    if (!this.readyBellActive) return;
    const phase = elapsedSeconds * READY_BELL_JUMP_HZ;
    const bounce = Math.max(0, Math.sin(phase));
    this.readyBell.position.y = 0.45 + bounce * READY_BELL_JUMP_HEIGHT;
    this.readyBell.rotation.z = bounce * 0.18;

    this.readyBellSparks.forEach((spark, i) => {
      const t = elapsedSeconds * 2.4 + (i / this.readyBellSparks.length) * Math.PI * 2;
      const radius = 0.42 + bounce * 0.12;
      spark.position.set(Math.cos(t) * radius, 0.42 + Math.sin(t * 1.7) * 0.18, Math.sin(t) * radius);
      (spark.material as THREE.SpriteMaterial).opacity = 0.5 + Math.sin(elapsedSeconds * 5 + i) * 0.5;
    });
  }

  // --- STORY-031: destination-table target marker (chip + arrow + pulsing ring) --------------

  /** Lazily builds one marker, as a child of the table's own mesh (`this.scene.getObjectByName
   * (tableId)`, the same anchor `updateTableBadges` already uses) so it moves/rotates with the
   * table for free — tables never move mid-match in this MVP, but this avoids a second
   * independent position source anyway. Always the §14 blue `opportunity` tone (see this file's
   * "STORY-031" constants block for why). */
  private buildCarryTargetMarker(tableId: string): THREE.Group {
    const group = new THREE.Group();
    group.name = `carry_target_${tableId}`;

    // Pulsing floor ring — same ring-beneath-the-entity device as the ready-dish freshness ring
    // and the customer patience ring, so "this is the delivery target" reads instantly.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(CARRY_TARGET_RING_INNER, CARRY_TARGET_RING_OUTER, 32),
      new THREE.MeshBasicMaterial({
        color: STATE_COLORS.opportunity,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.name = 'target_ring';
    group.add(ring);

    // Downward-pointing arrow hovering above the table — the reference composition's own device
    // (`docs/rival-restaurant-arcade-legibility-ui.png`) for "the plate belongs HERE".
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.5, 4),
      new THREE.MeshStandardMaterial({ color: STATE_COLORS.opportunity, roughness: 0.4 }),
    );
    arrow.rotation.x = Math.PI; // tip down
    arrow.position.y = CARRY_TARGET_ARROW_Y;
    arrow.name = 'target_arrow';
    group.add(arrow);

    // Table-number chip, reusing `formatTableChip`/`createLabelSprite` exactly as `upsertReadyDish`'s
    // own pass-side table chip does — same "T04" formatting, same blue tone, one shared vocabulary.
    // Matches the 0.68 scale the STORY-030 wayfinding-legibility pass gave every other placard —
    // this chip had been left at the pre-pass 0.42 (reported: "not clear where items need to go").
    const chip = createLabelSprite(formatTableChip(tableId), STATE_COLORS.opportunity, 0.68);
    chip.position.y = CARRY_TARGET_CHIP_Y;
    chip.name = 'target_chip';
    group.add(chip);

    return group;
  }

  /**
   * STORY-031 PRD §5.3. `tableIds` is every table currently targeted by a carried order (usually
   * zero or one; more than one only when a Serving Tray upgrade has the owner carrying several
   * orders bound for different tables at once). Markers are HIDDEN, never destroyed, when a
   * table stops being targeted — the same "the target can move between tables across a match"
   * reasoning `upsertReadyDish`'s slot system uses for tickets, applied to tables here instead.
   * Only ever called with THIS restaurant's own real table ids (`GameClient.ts` scopes this to
   * the self player's own carrying — the rival's tables have no individually-rendered mesh to
   * attach a marker to; see `buildCompetitor`'s own comment).
   */
  updateCarryTargets(tableIds: string[]): void {
    const active = new Set(tableIds);
    for (const tableId of active) {
      let marker = this.carryTargets.get(tableId);
      if (!marker) {
        marker = this.buildCarryTargetMarker(tableId);
        const tableMesh = this.scene.getObjectByName(tableId);
        // Defensive: every id passed in should be a real table from this restaurant's own
        // `tables[]`, so `tableMesh` should never be missing — falling back to scene-root avoids
        // silently dropping the marker if a caller ever passes a stale id.
        (tableMesh ?? this.scene).add(marker);
        this.carryTargets.set(tableId, marker);
      }
      marker.visible = true;
    }
    for (const [tableId, marker] of this.carryTargets) {
      if (!active.has(tableId)) marker.visible = false;
    }
  }

  /** Per-frame half of the target marker, same split `updateReadyDishAnimations` makes: a
   * gentle ring pulse plus a slight arrow bob, real wall-clock time (a presentation concern, not
   * simulation time). Only currently-visible markers are touched. */
  updateCarryTargetAnimations(elapsedSeconds: number): void {
    for (const marker of this.carryTargets.values()) {
      if (!marker.visible) continue;
      const ring = marker.getObjectByName('target_ring') as THREE.Mesh | undefined;
      if (ring) {
        const pulse = 1 + Math.sin(elapsedSeconds * 3.2) * 0.08;
        ring.scale.set(pulse, pulse, 1);
      }
      const arrow = marker.getObjectByName('target_arrow') as THREE.Mesh | undefined;
      if (arrow) arrow.position.y = CARRY_TARGET_ARROW_Y + Math.sin(elapsedSeconds * 2.4) * 0.08;
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
      // One snapshot entity represents the whole party. Draw up to four seated diners around
      // the table instead of a single body hidden under its center; their heads remain visible
      // above the tabletop while the lower torso reads as seated in the authored chairs.
      const body = new THREE.Group();
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
      group.position.set(state.position.x, state.position.y, state.position.z);
      group.userData.positionTarget = new THREE.Vector3(state.position.x, state.position.y, state.position.z);
      this.customers.set(state.customerId, group);
      this.scene.add(group);
    }
    (group.userData.positionTarget as THREE.Vector3).set(state.position.x, state.position.y, state.position.z);
    const body = group.getObjectByName('body') as THREE.Group;
    const partySize = Math.max(1, Math.min(4, state.partySize ?? 1));
    const seatOffsets = [
      [-1.02, 0], [1.02, 0], [0, -1.02], [0, 1.02],
    ] as const;
    while (body.children.length < partySize) {
      const diner = new THREE.Group();
      diner.name = 'diner';
      // The capsule+sphere pair stays as the synchronous placeholder and the permanent fallback
      // if the GLB never resolves — same contract `upsertOwner` and `upsertWorker` use. Grouped
      // under one node so the model swap removes both with a single call.
      const placeholder = new THREE.Group();
      placeholder.name = 'diner_placeholder';
      const torso = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.18, 0.2, 5, 10),
        new THREE.MeshStandardMaterial({ color: segmentColor, roughness: 0.7 }),
      );
      torso.position.y = 0.45;
      placeholder.add(torso);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.17, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xf0d5b8, roughness: 0.8 }),
      );
      head.position.y = 0.82;
      placeholder.add(head);
      diner.add(placeholder);
      // §14's "segment-cued customers" tint lives on that torso today. A textured model cannot
      // carry it — tinting per instance would mean per-instance materials, i.e. 24 copies of
      // Aurelia's material, which is exactly what the shared-resource path exists to avoid. So the
      // cue moves to its own small disc at the diner's feet, which survives the swap and keeps the
      // channel independent of the patience ring (a party-wide marker, a different signal).
      const segmentDisc = new THREE.Mesh(
        new THREE.CircleGeometry(0.22, 16),
        segmentDiscMaterial(segmentColor),
      );
      segmentDisc.rotation.x = -Math.PI / 2;
      segmentDisc.position.y = 0.02;
      segmentDisc.name = 'segment_disc';
      diner.add(segmentDisc);
      body.add(diner);

      const dinerGroup = diner;
      void buildRiggedCharacter(SEATED_DINER_MODEL)
        .then((instance) => {
          // The party may have left while the GLB was in flight; `removeCustomer` drops the group
          // but cannot reach this closure.
          if (this.customers.get(state.customerId) !== group || dinerGroup.parent === null) {
            instance.dispose();
            return;
          }
          const stale = dinerGroup.getObjectByName('diner_placeholder');
          if (stale) dinerGroup.remove(stale);
          dinerGroup.add(instance.root);
          dinerGroup.userData.model = instance;
        })
        .catch((error: unknown) => {
          console.warn(`Seated diner model failed to load for ${state.customerId}; keeping placeholder.`, error);
        });
    }
    body.children.forEach((child, index) => {
      child.visible = index < partySize;
      const [x, z] = seatOffsets[index] ?? seatOffsets[0];
      child.position.set(x, 0, z);
      // Turn each seat inward to face the table. The capsule placeholder was rotationally
      // symmetric so this never mattered; a seated figure with legs and a face very much has a
      // front, and four diners all facing the same way reads as a waiting room rather than a
      // table. `atan2(x, z)` (not `-x, -z`) because these models are +Z-forward in their own local
      // space, so pointing the seat's own outward offset along +Z aims the character back at the
      // centre. Same convention `upsertOwner` uses to apply `state.facing` with no correction.
      child.rotation.y = Math.atan2(x, z);
    });
    for (const diner of body.children) {
      const disc = diner.getObjectByName('segment_disc') as THREE.Mesh | undefined;
      if (disc) disc.material = segmentDiscMaterial(segmentColor);
    }
    const existingOrderLabel = group.getObjectByName('order_label') as THREE.Sprite | undefined;
    if (state.orderLabel) {
      if (existingOrderLabel?.userData.text !== state.orderLabel) {
        existingOrderLabel?.parent?.remove(existingOrderLabel);
        const label = createOrderLabelSprite(state.orderLabel, 0.5);
        label.name = 'order_label';
        label.userData.text = state.orderLabel;
        label.position.set(0, 1.92, 0);
        label.userData.orderPhase = (state.customerId.length % 11) * 0.31;
        group.add(label);
      }
    } else if (existingOrderLabel) {
      existingOrderLabel.parent?.remove(existingOrderLabel);
    }
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
    // Release each seated diner's mixer bookkeeping. Geometry and materials are NOT freed: these
    // are shared-resource instances, so they belong to the cached source and every other diner is
    // still pointing at them (see `RiggedCharacterOptions`).
    const body = group.getObjectByName('body');
    if (body) {
      for (const diner of body.children) {
        const model = diner.userData.model as RiggedCharacterInstance | undefined;
        if (model) model.dispose();
      }
    }
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
  updateCustomerAnimations(elapsedSeconds: number, dt = 0): void {
    const amplitudeByBand: Record<string, number> = { healthy: 0, attention: 0.03, bottleneck: 0.07, critical: 0.13 };
    const speedByBand: Record<string, number> = { healthy: 0, attention: 2.2, bottleneck: 3.4, critical: 5.0 };
    for (const group of this.customers.values()) {
      const target = group.userData.positionTarget as THREE.Vector3 | undefined;
      if (target) group.position.lerp(target, 0.035);
      if (dt > 0) {
        const seated = group.getObjectByName('body');
        // `moving` is always false: a seated diner's GLB ships no walk clip at all, so the loader
        // ignores the flag entirely (see `RiggedCharacterSpec.walkClip`). This call is purely to
        // advance the mixer so the seated idle's chest rise plays.
        if (seated) {
          for (const diner of seated.children) {
            const model = diner.userData.model as RiggedCharacterInstance | undefined;
            if (model) model.update(dt, false);
          }
        }
      }
      const band = (group.userData.band as string) ?? 'healthy';
      const amplitude = amplitudeByBand[band] ?? 0;
      const body = group.getObjectByName('body');
      if (!body) continue;
      const orderLabel = group.getObjectByName('order_label') as THREE.Sprite | undefined;
      if (orderLabel) {
        const phase = Number(orderLabel.userData.orderPhase ?? 0);
        orderLabel.position.y = 1.92 + Math.sin(elapsedSeconds * 2.4 + phase) * 0.035;
        const base = Number(orderLabel.userData.baseScale ?? 0.5);
        const pulse = 1 + Math.sin(elapsedSeconds * 2.4 + phase) * 0.018;
        orderLabel.scale.set(base * (560 / 170) * pulse, base * pulse, 1);
      }
      if (amplitude === 0) {
        body.rotation.z = 0;
        body.position.y = 0;
        continue;
      }
      const speed = speedByBand[band] ?? 0;
      body.rotation.z = Math.sin(elapsedSeconds * speed) * amplitude;
      body.position.y = Math.abs(Math.sin(elapsedSeconds * speed * 1.7)) * amplitude * 0.4;
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
      // Named so the cast-model load below can find and remove exactly this mesh. The role glyph
      // and task chips are siblings and deliberately survive the swap — they identify the worker
      // and describe what it is doing, which a textured model does not replace.
      body.name = 'worker_placeholder';
      group.add(body);
      // Role glyphs stay compact because the task chip above them supplies the readable action.
      const roleGlyph = createGlyphSprite(WORKER_ROLE_GLYPHS[state.role] ?? '?', color, 0.6);
      roleGlyph.position.set(0, 1.55, 0);
      group.add(roleGlyph);
      // One explicit task chip per possible task, plus one "needs help", all built once and toggled —
      // see this method's own header on why only one is ever visible at a time.
      for (const kind of Object.keys(WORKER_TASK_LABELS)) {
        const jobGlyph = createLabelSprite(WORKER_TASK_LABELS[kind], STATE_COLORS.opportunity, 0.38);
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
      group.position.set(state.position.x, state.position.y, state.position.z);
      group.userData.positionTarget = new THREE.Vector3(state.position.x, state.position.y, state.position.z);
      this.workers.set(state.workerId, group);
      this.scene.add(group);

      // STORY-064/065. Roles with a cast character (`host` -> Monsieur, `server` -> Vivienne)
      // swap the capsule for the rigged model once the GLB resolves. Everything above stays: the
      // capsule is the synchronous placeholder — the load is a network fetch plus parse and
      // gameplay must never wait on it — and it is also the permanent fallback for `cook`,
      // `prep_worker` and `busser`, which have no character, and for a load that fails.
      //
      // `ownResources` is left at its default (shared geometry/materials). Only one host and one
      // server exist per restaurant today (`restaurant-layout.json`'s `staff.roster`), so this
      // saves nothing yet — but it is the same path STORY-066's up-to-24 diners need, and having
      // the crowd characters on a different path from the crowd-safe one is how that stops being
      // true by accident.
      const roleSpec = WORKER_ROLE_MODELS[state.role];
      if (roleSpec) {
        const workerGroup = group;
        void buildRiggedCharacter(roleSpec)
          .then((instance) => {
            // The worker may have despawned while the GLB was in flight. `removeWorker` drops it
            // from `this.workers` but cannot reach into this closure, so check before attaching —
            // otherwise this resurrects a detached group and leaks the instance with it.
            if (this.workers.get(state.workerId) !== workerGroup) {
              instance.dispose();
              return;
            }
            const capsule = workerGroup.getObjectByName('worker_placeholder');
            if (capsule) workerGroup.remove(capsule);
            workerGroup.add(instance.root);
            workerGroup.userData.model = instance;
          })
          .catch((error: unknown) => {
            console.warn(`${state.role} model failed to load for ${state.workerId}; keeping placeholder.`, error);
          });
      }
    }
    // `upsertWorker` is called once per `match_snapshot` (~10 Hz), unlike owners (called every
    // render frame via `StateInterpolator`) — snapping `group.position` directly here, as this
    // used to, makes every worker visibly teleport between positions every ~100ms ("skippy").
    // Same fix as `upsertCustomer`'s below: defer to `positionTarget`, smoothed once per frame
    // by `updateWorkerAnimations`.
    (group.userData.positionTarget as THREE.Vector3).set(state.position.x, state.position.y, state.position.z);

    for (const kind of Object.keys(WORKER_TASK_LABELS)) {
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
    // Release the mixer's per-root bookkeeping. This does NOT free geometry or materials: worker
    // models are built on the shared-resource path, so those belong to the cached source and are
    // still in use by every other instance of this character (see `RiggedCharacterOptions`).
    const model = group.userData.model as RiggedCharacterInstance | undefined;
    if (model) model.dispose();
    this.scene.remove(group);
    this.workers.delete(workerId);
  }

  workerIds(): string[] {
    return [...this.workers.keys()];
  }

  /** Smooths `upsertWorker`'s ~10 Hz snapshot positions toward the latest target every render
   * frame — the same split `updateCustomerAnimations` uses for customers/workers, both of which
   * only get new positions at snapshot cadence, unlike the owner avatar (interpolated every
   * frame upstream by `StateInterpolator`, so it needs no second smoothing pass). Called every
   * frame from `GameClient#handleFrame`, same lerp factor as customers for a consistent feel. */
  updateWorkerAnimations(dt = 0): void {
    for (const group of this.workers.values()) {
      const target = group.userData.positionTarget as THREE.Vector3 | undefined;
      if (!target) continue;
      const before = WORKER_STEP.copy(group.position);
      group.position.lerp(target, 0.035);
      const model = group.userData.model as RiggedCharacterInstance | undefined;
      if (!model || dt <= 0) continue;

      // How far this worker actually moved THIS frame, which is the only movement signal
      // available here: unlike the owner (whose `upsertOwner` records a per-frame delta from
      // `StateInterpolator`), workers get new positions at ~10 Hz and are smoothed by the lerp
      // above, so the lerp's own output is the thing to measure.
      const stepSq = before.distanceToSquared(group.position);

      // STORY-064. Workers were rotationally-symmetric capsules and so never carried a facing at
      // all — there is no `state.facing` to read for them the way `upsertOwner` has one. A rigged
      // character without it would slide sideways and backwards while always facing one
      // direction, which reads as broken far more loudly than a capsule ever did. Facing is
      // therefore derived from the direction of travel.
      //
      // `atan2(dx, dz)`, not the usual `atan2(dz, dx)`: these models are +Z-forward in their own
      // local space (`assets/cast/README_ThreeJS.md`), so a group rotated by `theta` about Y
      // points along `(sin theta, 0, cos theta)` — the same convention `upsertOwner` relies on to
      // apply `state.facing` with no corrective rotation.
      if (stepSq > WORKER_FACING_EPSILON_SQ) {
        const heading = Math.atan2(group.position.x - before.x, group.position.z - before.z);
        // Shortest-arc turn, so a worker crossing the +/-PI seam turns a few degrees rather than
        // spinning the long way round, and eased rather than snapped so the turn reads as a turn.
        // Wrap the raw difference into [-PI, PI] so the turn takes the short way round.
        const raw = heading - group.rotation.y;
        const delta = Math.atan2(Math.sin(raw), Math.cos(raw));
        group.rotation.y += delta * Math.min(1, dt * WORKER_TURN_RATE);
      }

      // Same squared-distance-vs-threshold form as `updateOwnerAnimations`, for the same reason:
      // the lerp leaves sub-millimetre jitter in a worker that has arrived, and a naive "moved at
      // all" test reads that as a permanent, never-idle walk cycle.
      const thresholdDist = WORKER_MOVE_SPEED * WORKER_ANIMATION_MOVE_FRACTION * Math.max(dt, 1 / 1000);
      model.update(dt, stepSq > thresholdDist * thresholdDist);
    }
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

  /** STORY-056. Builds one complaint marker as a child of the table's own mesh — same
   * `this.scene.getObjectByName(tableId)` anchor `updateTableBadges`/`buildCarryTargetMarker`
   * already use, so it moves for free with the table (tables never move mid-match in this MVP,
   * same defensive note those two give). Deliberately NOT a re-tint of the existing 4-state badge
   * glyph (`createGlyphSprite` at 0.45 scale): this is a distinct visual DEVICE — a large red ring
   * around the whole table plus an even larger glyph floating well above every other per-table
   * sprite (see `COMPLAINT_RING_*`/`COMPLAINT_GLYPH_*`'s own comment for the exact numbers and why
   * they clear the 4-state badge and the carry-target chip) — so an unresolved complaint reads as
   * a fundamentally different kind of signal, not a red variant of "order taken". Uses
   * `STATE_COLORS.critical` — see `COMPLAINT_RING_*`/`COMPLAINT_GLYPH_*`'s own comment for why
   * that, not `.bottleneck`, is this file's actual red and the semantically correct pick.
   */
  private buildComplaintMarker(tableId: string): THREE.Group {
    const group = new THREE.Group();
    group.name = `complaint_marker_${tableId}`;

    // Floor ring — same "ring beneath the entity" device as the carry-target/ready-dish/patience
    // rings, but bigger and fully opaque (not the carry ring's 0.85) so it reads at a glance even
    // WITHOUT the per-frame pulse below — same "a screenshot still shows it" reasoning
    // `upsertReadyDish`'s static isOldest size/opacity boost gives (see that method's own comment).
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(COMPLAINT_RING_INNER, COMPLAINT_RING_OUTER, 32),
      new THREE.MeshBasicMaterial({
        color: STATE_COLORS.critical,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025;
    ring.name = 'complaint_ring';
    group.add(ring);

    // The "very visible above the customers" glyph. `!` is a symbol none of the four badge
    // glyphs (O/F/$/X) use, at more than double their scale, floating well above every other
    // per-table sprite — legible from the normal play camera distance without walking up to it.
    const glyph = createGlyphSprite('!', STATE_COLORS.critical, COMPLAINT_GLYPH_SCALE);
    glyph.position.y = COMPLAINT_GLYPH_Y;
    glyph.name = 'complaint_glyph';
    group.add(glyph);

    return group;
  }

  /** STORY-056. `customers` must already be filtered to THIS restaurant — same requirement
   * `updateTableBadges`'s own comment gives, and this is always called right alongside it from
   * `updateFloorState` with the same already-filtered array. Markers are HIDDEN, never destroyed,
   * once built (`updateCarryTargets`'s own precedent) — a complaint can be handled and a new one
   * can start at the same table later in the same match, and hiding avoids rebuilding the same
   * geometry/texture repeatedly. This is the ONE place `party.unhappy` is read for rendering — it
   * flips to false the instant the complaint is handled or the party leaves (`customer-system.js`
   * derivation cited in this story's approach_summary), and since this runs every snapshot off the
   * live `customers` array, the marker clears on that same snapshot — no stale marker outlives the
   * flag. */
  private updateComplaintMarkers(customers: CustomerSnapshot[]): void {
    const unhappyTableIds = new Set(
      customers.filter((c) => c.unhappy && c.tableId).map((c) => c.tableId as string),
    );
    for (const tableId of unhappyTableIds) {
      let marker = this.complaintMarkers.get(tableId);
      if (!marker) {
        const tableMesh = this.scene.getObjectByName(tableId);
        // Defensive, same reasoning `updateCarryTargets` gives: every id here comes from this
        // restaurant's own live `customers[]`, so `tableMesh` should never be missing. Skip
        // rather than cache under a scene-root fallback — an un-parented marker would never be
        // visible under the table anyway, and caching it here would permanently short-circuit the
        // `!marker` check above on a transient lookup miss.
        if (!tableMesh) continue;
        marker = this.buildComplaintMarker(tableId);
        tableMesh.add(marker);
        this.complaintMarkers.set(tableId, marker);
      }
      marker.visible = true;
    }
    for (const [tableId, marker] of this.complaintMarkers) {
      if (!unhappyTableIds.has(tableId)) marker.visible = false;
    }
  }

  /** Per-frame half of the complaint marker, same split `updateCarryTargetAnimations`/
   * `updateReadyDishAnimations` make: the marker is already fully legible at rest (see
   * `buildComplaintMarker`'s own comment), this only adds a pulse on top for extra urgency. Only
   * currently-visible markers are touched. */
  updateComplaintMarkerAnimations(elapsedSeconds: number): void {
    for (const marker of this.complaintMarkers.values()) {
      if (!marker.visible) continue;
      const ring = marker.getObjectByName('complaint_ring') as THREE.Mesh | undefined;
      if (ring) {
        const pulse = 1 + Math.sin(elapsedSeconds * 4) * 0.12;
        ring.scale.set(pulse, pulse, 1);
      }
      const glyph = marker.getObjectByName('complaint_glyph') as THREE.Sprite | undefined;
      if (glyph) {
        const pulse = 1 + Math.sin(elapsedSeconds * 4 + Math.PI / 2) * 0.1;
        glyph.scale.set(COMPLAINT_GLYPH_SCALE * pulse, COMPLAINT_GLYPH_SCALE * pulse, 1);
      }
    }
  }

  /** Keep the same dish identity visible through the whole service path: pass, hands, table.
   * Delivered orders remain public until payment settles, so this projection naturally keeps
   * plates present while diners eat and removes them when the table visit finishes. */
  private updateTableDishes(orders: OrderSnapshot[]): void {
    const delivered = orders.filter((order) => order.state === 'delivered' && order.tableId);
    const seen = new Set(delivered.map((order) => order.ticketId));
    const tableSlots = new Map<string, number>();

    for (const order of delivered) {
      const tableId = order.tableId!;
      const slot = tableSlots.get(tableId) ?? 0;
      tableSlots.set(tableId, slot + 1);

      let proxy = this.tableDishes.get(order.ticketId);
      if (!proxy) {
        proxy = buildDishProxy(order.dishId);
        proxy.name = `table_dish_${order.ticketId}`;
        proxy.scale.setScalar(0.52);
        this.scene.getObjectByName(tableId)?.add(proxy);
        this.tableDishes.set(order.ticketId, proxy);
      }

      // Four compact settings fit on the 1.8 m round table. Larger parties reuse the ring with
      // a smaller radius, which is still clearer than stacking plates at the centre.
      const angle = (slot % 4) * (Math.PI / 2) + Math.PI / 4;
      const radius = slot < 4 ? 0.42 : 0.18;
      proxy.position.set(Math.cos(angle) * radius, 0.84, Math.sin(angle) * radius);
      proxy.rotation.y = -angle;
    }

    for (const [ticketId, proxy] of this.tableDishes) {
      if (seen.has(ticketId)) continue;
      proxy.removeFromParent();
      disposeFoodObject(proxy);
      this.tableDishes.delete(ticketId);
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

      // STORY-041. `queueDepth` above is EXACTLY the same `orders[]`-derived count
      // `kitchen.queuedTicketsAt(restaurantId, station)` would report server-side (both read the
      // ticket's `state === 'queued'` at this station; see that facade's own comment) — no new
      // server state, per this story's AC. The AC's "queued at this station but not yet started"
      // is a per-TICKET claim, true of every entry `queuedTicketsAt` returns, whether or not this
      // station also happens to have something else `in_progress` right now — a station cooking
      // one ticket with three more behind it still has three unstarted tickets nobody has acted
      // on, which matters most of all in co-op mode with no automated cook (STORY-040) to ever
      // clear them on its own. So this glyph is driven by queue PRESENCE alone, deliberately not
      // narrowed to "and the station is otherwise idle" — that would hide exactly the backed-up
      // case this story exists for. It stays a DISTINCT signal from the queue boxes above (own
      // glyph, own anchor, fixed color, never recolored by the band) rather than a duplicate of
      // them, the same "categorically different claim" split `state-color-bands.js` already
      // draws between a queue-depth color and the shortage glyph.
      indicator.waitingIcon.visible = queueDepth > 0;
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
    const activityMeshes = this.rivalActivityMeshes.length ? this.rivalActivityMeshes : this.competitorTables;
    if (!rival) {
      for (const t of activityMeshes) (t.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
      if (this.competitorSign) (this.competitorSign.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3;
      return;
    }
    const occupiedFraction =
      rival.seatsTotal > 0 ? (rival.seatsTotal - rival.seatsAvailable) / rival.seatsTotal : 0;
    const litCount = Math.round(occupiedFraction * activityMeshes.length);
    activityMeshes.forEach((t, i) => {
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
   * The single per-snapshot entry point for everything in this section: tables, table dishes,
   * stations, rival activity and the event effect. Customers, workers, and ready-dish proxies are
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
    // STORY-056. Reads the SAME already-filtered `selfCustomers` array `updateTableBadges` just
    // used — see `updateComplaintMarkers`'s own comment on why this always runs alongside it.
    this.updateComplaintMarkers(selfCustomers);
    this.updateTableDishes(selfOrders);
    this.updateStationIndicators(selfOrders, self?.shortages ?? []);
    this.updateRivalActivity(rival);
    this.updateEventEffect(params.events);
  }

  removeOwner(playerId: string): void {
    const group = this.owners.get(playerId);
    if (!group) return;
    // STORY-060. `disposeChefBlaze` is safe here specifically because `ChefBlazeModel.ts`'s
    // `buildChefBlaze` deep-clones geometry/material per instance (see its own comment on why) —
    // disposing them only frees THIS owner's copy, not the cached source every future load
    // reuses.
    const chefBlaze = group.userData.chefBlaze as ChefBlazeInstance | undefined;
    if (chefBlaze) disposeChefBlaze(chefBlaze.root);
    this.scene.remove(group);
    this.owners.delete(playerId);
    // STORY-031. Carry-socket dish proxies are children of `group`, so `scene.remove(group)`
    // above already sweeps their geometry out of the render graph — this only drops the now-
    // stale bookkeeping map entry so a later `setCarriedDishes` for this same playerId (a
    // reconnect, say) starts from a clean slate rather than referencing disposed proxies.
    this.carriedDishes.delete(playerId);
  }

  ownerIds(): string[] {
    return [...this.owners.keys()];
  }

  setDebugGrid(visible: boolean): void {
    this.grid.visible = visible;
  }

  setCompetitorVisible(visible: boolean): void {
    this.competitor.visible = visible;
    // Rival avatars share the shell's presentation state, including between snapshots.
    for (const owner of this.owners.values()) {
      if (owner.userData.remapToRivalFloor) owner.visible = visible;
    }
  }

  setDistrictVisible(visible: boolean): void {
    const district = this.scene.getObjectByName('district_backdrop');
    if (district) district.visible = visible;
  }

  setNight(night: boolean): void {
    // STORY-059: day ambient dropped 0.48→0.32 (see constructor); night's own value is lowered
    // by roughly the same proportion (was 0.32, now 0.20) so night stays visibly darker than the
    // new day baseline instead of the two converging.
    this.ambient.intensity = night ? 0.2 : 0.32;
    this.keyLight.intensity = night ? 0.85 : 2.6;
    for (const light of this.practicalLights) {
      light.intensity = Number(light.userData.baseIntensity ?? light.intensity) * (night ? 0.72 : 1);
    }
    this.scene.background = new THREE.Color(night ? 0x07110e : 0x0b1512);
  }

  dispose(): void {
    this.scenery.dispose();
    this.keyLight.shadow.dispose();
    this.scene.userData.disposeEnvironment?.();
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
    this.pantryIngredientProps.clear();
    this.tableDishes.clear();
    this.readyDishes.clear();
    this.readyDishSlots.clear();
    this.readyDishSlotUsed.fill(false);
    this.queueBoardDishes.clear();
    this.readyBellSparks.length = 0;
    this.carriedDishes.clear();
    this.carryTargets.clear();
    this.complaintMarkers.clear();
    this.scene.clear();
  }
}
