// PRD §15.3 Kitchen bottleneck harness.
//
// Purpose: test station queues, ingredient shortages, finished-food pickup, worker behaviours
// and owner interventions — the cluster of systems that produce the game's core moment-to-moment
// decision — and MEASURE how long a ticket takes to clear, comparably across configuration
// changes. §22 counts this as harness #3 of the three MVP requires (restaurant-layout-harness is
// #1, customer-flow-harness is #2).
//
// NO LIVE SIMULATION IMPORTED — same rule as customer-flow-harness (STORY-018): there is no
// ticking kitchen-system.js/worker-system.js/pantry.js underneath. But UNLIKE that harness, this
// story's own AC ("measure task completion time... comparable across configuration changes")
// cannot be satisfied by state a human only forces on demand — a queued ticket has to actually
// take *time* to cook for a timing comparison to mean anything. So this file owns a small,
// self-contained tick loop that reproduces just enough of §5/§17's shape (worker "loading" cost
// vs. a station's own independent cook timer; the owner resolving a dispatch immediately and
// paying a cooldown afterward, exactly as `action-validator.js#handleInteract`'s own header
// documents) to produce numbers worth looking at — using the SAME duration constants
// (`WORKER_TASK_DURATIONS_MS`, `OWNER_TASK_DURATIONS_MS`, the `INVENTORY_RESTOCK_*` family) and
// the SAME dish data (`dishes.json` `stationSteps`) the real systems use, so a change made here
// is directly informative about tuning those systems, not a parallel set of invented numbers.
// Rendering is still 100% the shared surface: `RestaurantScene.updateFloorState` /
// `upsertWorker` / `upsertOwner` — see this file's own imports and the header comment on
// `mockShortageVsQueueDemo` in `shared/test-entities.ts` for why "reuse the renderer, not the
// simulation" is exactly the line PRD §15 draws.
//
// A VIRTUAL CLOCK, NOT WALL-CLOCK MS. `simClockMs` advances by `realDtMs * productionSpeed` each
// frame, so cranking "Production speed" to 4x makes a 6-second grill step resolve in 1.5 real
// seconds WITHOUT shrinking the number this harness reports for it — every duration logged below
// is always in the same units `WORKER_TASK_DURATIONS_MS`/`dishes.json` already use, so numbers
// stay comparable to each other (and to §24's targets) regardless of what the speed toggle is set
// to. Production speed is a "get to more measurements faster" convenience, never a second unit.
//
// EQUIPMENT FAILURE HAS NO LIVE COUNTERPART YET. `action-validator.js`'s own header is explicit:
// "`repair` IS DECLARED AND ALWAYS REJECTED... nothing in this codebase marks a station broken."
// So `StationMock.broken` and the repair flow below are this harness's own invention, in the
// SHAPE STORY-008 already reserved (`repair` targets one station, costs the owner a duration
// derived the same way every other owner action is) — there is no `RestaurantScene` rendering to
// reuse for "broken" because none was ever built, so the one new visual this file adds is a
// third glyph badge per station, using the same `createGlyphSprite` helper STORY-016's own
// queue/shortage badges use, at a third anchor point so it is never confused with either.

import * as THREE from 'three';
import type { SceneHarness } from './harness-shell';
import { RestaurantScene, CameraController, type OwnerRenderState, type WorkerRenderState } from './shared/scene-primitives';
import { DevControls } from './shared/dev-controls';
import { STATE_COLORS } from '../../client/src/game/state-colors';
import { createGlyphSprite } from '../../client/src/scenes/icon-sprites';
import layout from '../../shared/game-data/restaurant-layout.json';
import dishesData from '../../shared/game-data/dishes.json';
import { STATIONS } from '../../shared/schemas/messages';
import type { Station } from '../../shared/schemas/messages';
import type {
  OrderSnapshot,
  OrderState,
  RestaurantSnapshot,
  Vec3,
  WorkerHelpReason,
  WorkerRole,
  WorkerTaskKind,
} from '../../shared/schemas/game-state';
import {
  WORKER_TASK_DURATIONS_MS,
  OWNER_TASK_DURATIONS_MS,
  INVENTORY_RESTOCK_TRAVEL_MS,
  INVENTORY_RESTOCK_MS_PER_UNIT,
  WORKER_RESTOCK_THRESHOLD_UNITS,
} from '../../shared/constants/tuning';

// --- Spatial reference points -----------------------------------------------------------------

type LayoutEntity = { id: string; type: string; station?: string; position: number[] };
const entities = layout.entities as LayoutEntity[];

function entityPos(id: string): Vec3 {
  const entity = entities.find((e) => e.id === id);
  if (!entity) throw new Error(`layout entity not found: ${id}`);
  const [x, , z] = entity.position;
  return { x, y: 0, z };
}

const STATION_POS: Record<Station, Vec3> = Object.fromEntries(
  STATIONS.map((s) => [s, entityPos(`station_${s}`)]),
) as Record<Station, Vec3>;
const PANTRY_POS = entityPos('pantry');
const PASS_POS = entityPos('service_pass');
const TABLES: Vec3[] = entities.filter((e) => e.type === 'table').map((e) => entityPos(e.id));
const COOK_IDLE_POS: Vec3 = { x: 0, y: 0, z: 6.4 };
const SERVER_IDLE_POS: Vec3 = { x: -1.5, y: 0, z: 0.6 };
const OWNER_IDLE_POS: Vec3 = { x: 4, y: 0, z: 0.5 };

const KITCHEN_CAMERA = { height: 22, distance: 25, angle: 0.35, fov: 48 } as const;

// --- Dish/ingredient data ----------------------------------------------------------------------
// Real `dishes.json` records, not invented numbers — see this file's own header on why that
// matters for the timing readouts to be worth anything.

interface DishData {
  id: string;
  suggestedPrice: number;
  ingredients: Record<string, number>;
  stationSteps: { station: Station; durationMs: number }[];
}
// `as unknown as` — dishes.json's own inferred union type has each dish's `ingredients` narrowed
// to ITS OWN optional keys (TS infers a distinct shape per array literal entry), which no single
// `Record<string, number>` cast satisfies directly; the JSON is trusted input, same as `layout`
// above.
const ALL_DISHES = dishesData.dishes as unknown as DishData[];
// Four dishes, chosen to cover all four stations between them (every one starts at `prep`,
// same as every dish in the catalogue — see `blockedByIngredientId`'s own schema comment on why
// the ingredient gate only ever needs to be checked once, at a ticket's first step).
const PRESET_DISH_IDS = ['smash_burger', 'caesar_salad', 'pasta_primavera', 'nachos'];
const PRESET_DISHES: DishData[] = PRESET_DISH_IDS.map((id) => {
  const dish = ALL_DISHES.find((d) => d.id === id);
  if (!dish) throw new Error(`kitchen-bottleneck-harness: preset dish not found: ${id}`);
  return dish;
});
function dishById(id: string): DishData {
  const dish = PRESET_DISHES.find((d) => d.id === id);
  if (!dish) throw new Error(`kitchen-bottleneck-harness: unknown dish ${id}`);
  return dish;
}
function dishesUsingStation(station: Station): DishData[] {
  const found = PRESET_DISHES.filter((d) => d.stationSteps.some((s) => s.station === station));
  return found.length > 0 ? found : PRESET_DISHES;
}
function stepDurationMs(dish: DishData, station: Station): number {
  return dish.stationSteps.find((s) => s.station === station)?.durationMs ?? 2000;
}

const INGREDIENT_IDS = [...new Set(PRESET_DISHES.flatMap((d) => Object.keys(d.ingredients)))];

// --- Harness-only tuning (control-panel knobs, not gameplay data; see house convention on
// `shared/constants/tuning.js` — none of this feeds a live system) -----------------------------

const BIN_STARTING_STOCK = 20;
const BIN_REFILL_TARGET = 20;
const BACKLOG_PRESET_SIZE = 6;
/** No live duration exists to reuse — see this file's header on why `repair` is invented here. */
const HARNESS_REPAIR_DURATION_MS = 3_000;
const STEP_LOG_CAP = 30;

// --- Mock model ----------------------------------------------------------------------------

interface MockTicket {
  ticketId: string;
  orderId: string;
  dishId: string;
  station: Station;
  currentStepIndex: number;
  state: OrderState;
  blockedByIngredientId: string | null;
  claimedBy: 'worker' | 'owner' | null;
  remainingMs: number;
  stepStartedAtMs: number | null;
  dispatchedBy: 'worker' | 'owner' | null;
  queuedAtMs: number;
  readyAtMs: number | null;
  deliveredAtMs: number | null;
}

interface StationMock {
  station: Station;
  busyTicketId: string | null;
  broken: boolean;
  slowFactor: 1 | 2 | 4;
}

interface BinMock {
  ingredientId: string;
  stock: number;
  restocking: boolean;
  restockRemainingMs: number;
  restockTotalMs: number;
  requestedBy: 'worker' | 'owner' | null;
}

interface WorkerMock {
  workerId: string;
  role: WorkerRole;
  enabled: boolean;
  busyRemainingMs: number | null;
  currentTaskKind: WorkerTaskKind | null;
  pendingTicketId: string | null;
  needsHelp: { reason: WorkerHelpReason; station: Station | null; ingredientId: string | null } | null;
}

/** `carry` has no `InteractAction` equivalent — it is this harness's own one-click stand-in for
 * the real game's two separate `pickup` + `deliver` interacts (see this file's header). */
type OwnerActionKind = 'cook' | 'plate' | 'restock' | 'repair' | 'carry';

interface OwnerMock {
  spawned: boolean;
  busyRemainingMs: number | null;
  currentAction: OwnerActionKind | null;
  carryingTicketId: string | null;
  repairTargetStation: Station | null;
  /** Which station a 'cook'/'plate' dispatch targeted, purely for `ownerRenderState`'s own
   * positioning — the dispatch itself already resolved instantly (see `resolveOwnerCompletion`'s
   * header comment), so this has no bearing on when the action completes. */
  actionTargetStation: Station | null;
}

interface StepCompletion { actor: 'worker' | 'owner'; durationMs: number; station: Station; dishId: string }
interface DeliveryCompletion { actor: 'worker' | 'owner'; durationMs: number }
interface TotalCompletion { actor: 'worker' | 'owner'; durationMs: number }

function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function fmtMs(ms: number | null): string {
  return ms === null ? '—' : `${Math.round(ms)}ms`;
}

const OWNER_ID = 'harness_owner';
const RESTAURANT_ID = 'harness_restaurant';

export const kitchenBottleneckHarness: SceneHarness = createKitchenBottleneckHarness();

function createKitchenBottleneckHarness(): SceneHarness {
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: RestaurantScene | null = null;
  let camera: CameraController | null = null;
  let frame = 0;
  let observer: ResizeObserver | null = null;
  let brokenBadges = new Map<Station, THREE.Sprite>();

  let tickets = new Map<string, MockTicket>();
  let stationsMock = new Map<Station, StationMock>();
  let bins = new Map<string, BinMock>();
  let workers = new Map<string, WorkerMock>();
  let owner: OwnerMock = { spawned: false, busyRemainingMs: null, currentAction: null, carryingTicketId: null, repairTargetStation: null, actionTargetStation: null };
  let simClockMs = 0;
  let productionSpeed = 1;
  let nextTicketSeq = 0;
  let nextDishSeq = 0;
  let selectedStation: Station = STATIONS[0];
  let selectedIngredient = INGREDIENT_IDS[0];

  let stepCompletions: StepCompletion[] = [];
  let deliveryCompletions: DeliveryCompletion[] = [];
  let totalCompletions: TotalCompletion[] = [];
  let restockCompletions: number[] = [];
  let repairCompletions: number[] = [];

  function makeTicket(dish: DishData, opts?: { atStation?: Station }): MockTicket {
    nextTicketSeq += 1;
    const id = `harness_ticket_${nextTicketSeq}`;
    let stepIndex = 0;
    let station = dish.stationSteps[0].station;
    let blockedByIngredientId: string | null = null;

    if (opts?.atStation) {
      const idx = dish.stationSteps.findIndex((s) => s.station === opts.atStation);
      stepIndex = idx >= 0 ? idx : 0;
      station = dish.stationSteps[stepIndex].station;
      // Deliberately skips the ingredient gate: this preset exists to stress ONE station
      // directly (§15.3 "long station queue"), as if these tickets already cleared their first
      // step elsewhere — see `dishesUsingStation`'s own comment on how the target dish is chosen.
    } else {
      for (const [ingredientId, qty] of Object.entries(dish.ingredients)) {
        const bin = bins.get(ingredientId);
        if (bin && bin.stock < qty) { blockedByIngredientId = ingredientId; break; }
      }
      if (!blockedByIngredientId) {
        for (const [ingredientId, qty] of Object.entries(dish.ingredients)) {
          const bin = bins.get(ingredientId);
          if (bin) bin.stock = Math.max(0, bin.stock - qty);
        }
      }
    }

    const ticket: MockTicket = {
      ticketId: id,
      orderId: id,
      dishId: dish.id,
      station,
      currentStepIndex: stepIndex,
      state: 'queued',
      blockedByIngredientId,
      claimedBy: null,
      remainingMs: 0,
      stepStartedAtMs: null,
      dispatchedBy: null,
      queuedAtMs: simClockMs,
      readyAtMs: null,
      deliveredAtMs: null,
    };
    tickets.set(id, ticket);
    return ticket;
  }

  function spawnReadyTicket(): void {
    const dish = PRESET_DISHES[nextDishSeq % PRESET_DISHES.length];
    nextDishSeq += 1;
    nextTicketSeq += 1;
    const id = `harness_ticket_${nextTicketSeq}`;
    const ticket: MockTicket = {
      ticketId: id,
      orderId: id,
      dishId: dish.id,
      station: dish.stationSteps[dish.stationSteps.length - 1].station,
      currentStepIndex: dish.stationSteps.length - 1,
      state: 'ready',
      blockedByIngredientId: null,
      claimedBy: null,
      remainingMs: 0,
      stepStartedAtMs: null,
      dispatchedBy: null,
      queuedAtMs: simClockMs,
      readyAtMs: simClockMs,
      deliveredAtMs: null,
    };
    tickets.set(id, ticket);
  }

  function findEligibleQueuedTicket(allowedStations?: Station[]): MockTicket | null {
    for (const ticket of tickets.values()) {
      if (ticket.state !== 'queued' || ticket.blockedByIngredientId) continue;
      if (allowedStations && !allowedStations.includes(ticket.station)) continue;
      const station = stationsMock.get(ticket.station)!;
      if (station.broken || station.busyTicketId) continue;
      return ticket;
    }
    return null;
  }

  function findOldestReadyUnclaimed(): MockTicket | null {
    for (const ticket of tickets.values()) {
      if (ticket.state === 'ready' && ticket.claimedBy === null) return ticket;
    }
    return null;
  }

  function neediestBin(): BinMock | null {
    let best: BinMock | null = null;
    for (const bin of bins.values()) {
      if (bin.restocking || bin.stock > WORKER_RESTOCK_THRESHOLD_UNITS) continue;
      if (!best || bin.stock < best.stock) best = bin;
    }
    return best;
  }

  function startStationStep(ticket: MockTicket, station: StationMock, actor: 'worker' | 'owner'): void {
    ticket.state = 'in_progress';
    ticket.stepStartedAtMs = simClockMs;
    ticket.dispatchedBy = actor;
    station.busyTicketId = ticket.ticketId;
    ticket.remainingMs = stepDurationMs(dishById(ticket.dishId), station.station) * station.slowFactor;
  }

  function completeStationStep(ticket: MockTicket, station: StationMock): void {
    const now = simClockMs;
    const durationMs = now - (ticket.stepStartedAtMs ?? now);
    stepCompletions.push({ actor: ticket.dispatchedBy ?? 'worker', durationMs, station: station.station, dishId: ticket.dishId });
    if (stepCompletions.length > STEP_LOG_CAP) stepCompletions.shift();
    station.busyTicketId = null;

    const dish = dishById(ticket.dishId);
    const nextIndex = ticket.currentStepIndex + 1;
    if (nextIndex < dish.stationSteps.length) {
      ticket.currentStepIndex = nextIndex;
      ticket.station = dish.stationSteps[nextIndex].station;
      ticket.state = 'queued';
      ticket.dispatchedBy = null;
      ticket.stepStartedAtMs = null;
    } else {
      ticket.state = 'ready';
      ticket.readyAtMs = now;
      totalCompletions.push({ actor: ticket.dispatchedBy ?? 'worker', durationMs: now - ticket.queuedAtMs });
      if (totalCompletions.length > STEP_LOG_CAP) totalCompletions.shift();
    }
  }

  function startBinRestock(bin: BinMock, actor: 'worker' | 'owner'): void {
    const deltaQty = Math.max(0, BIN_REFILL_TARGET - bin.stock);
    const fullDuration = INVENTORY_RESTOCK_TRAVEL_MS + deltaQty * INVENTORY_RESTOCK_MS_PER_UNIT;
    bin.restocking = true;
    bin.restockRemainingMs = fullDuration;
    bin.restockTotalMs = fullDuration;
    bin.requestedBy = actor;
    if (actor === 'worker') {
      const cook = workers.get('cook_1')!;
      cook.busyRemainingMs = fullDuration;
      cook.currentTaskKind = 'restock';
      cook.pendingTicketId = null;
    } else {
      // The owner's OWN busy time is much shorter than the pantry trip itself (matches
      // `OWNER_TASK_DURATIONS_MS.restock`'s derivation, and `resolveRestock`'s own comment: the
      // owner "requests" a restock, the bin fills on its own schedule) — the differential §17
      // promises is exactly this: the owner is free again long before the cook doing the same
      // trip themselves would be, even though the bin itself refills at the same real rate.
      owner.busyRemainingMs = OWNER_TASK_DURATIONS_MS.restock;
      owner.currentAction = 'restock';
    }
  }

  function resolveOwnerCompletion(): void {
    const action = owner.currentAction;
    if (action === 'repair' && owner.repairTargetStation) {
      const station = stationsMock.get(owner.repairTargetStation)!;
      station.broken = false;
      repairCompletions.push(HARNESS_REPAIR_DURATION_MS);
      if (repairCompletions.length > STEP_LOG_CAP) repairCompletions.shift();
      owner.repairTargetStation = null;
    } else if (action === 'carry' && owner.carryingTicketId) {
      const ticket = tickets.get(owner.carryingTicketId);
      if (ticket) {
        ticket.state = 'delivered';
        ticket.deliveredAtMs = simClockMs;
        deliveryCompletions.push({ actor: 'owner', durationMs: simClockMs - (ticket.readyAtMs ?? simClockMs) });
        if (deliveryCompletions.length > STEP_LOG_CAP) deliveryCompletions.shift();
      }
      scene?.setCarrying(OWNER_ID, 0);
      owner.carryingTicketId = null;
    }
    // 'cook' / 'plate' / 'restock' already resolved at the moment they were dispatched — the
    // owner's cooldown was pure gating on the NEXT action, exactly as `action-validator.js`'s own
    // header documents ("a valid interact resolves its facade call IMMEDIATELY").
    owner.busyRemainingMs = null;
    owner.currentAction = null;
  }

  function updateCookWorker(simDtMs: number): void {
    const cook = workers.get('cook_1')!;
    if (cook.busyRemainingMs !== null) {
      cook.busyRemainingMs -= simDtMs;
      if (cook.busyRemainingMs <= 0) {
        if (cook.currentTaskKind === 'tend_station' && cook.pendingTicketId) {
          const ticket = tickets.get(cook.pendingTicketId);
          if (ticket) {
            const station = stationsMock.get(ticket.station)!;
            if (!station.broken && !station.busyTicketId) startStationStep(ticket, station, 'worker');
          }
        }
        cook.busyRemainingMs = null;
        cook.pendingTicketId = null;
        cook.currentTaskKind = null;
      }
      return;
    }
    if (!cook.enabled) { cook.needsHelp = null; return; }

    const eligible = findEligibleQueuedTicket();
    if (eligible) {
      cook.busyRemainingMs = WORKER_TASK_DURATIONS_MS.tend_station;
      cook.pendingTicketId = eligible.ticketId;
      cook.currentTaskKind = 'tend_station';
      cook.needsHelp = null;
      return;
    }
    const lowBin = neediestBin();
    if (lowBin) {
      startBinRestock(lowBin, 'worker');
      cook.needsHelp = null;
      return;
    }
    // §17 cook rule 5: nothing eligible to cook and no bin worth a trip — if a blocked ticket is
    // the REASON (its ingredient's bin is simply not low enough yet to trigger a restock, e.g.
    // it just now hit zero from another ticket), surface the same "needs help" signal STORY-007
    // gives a live cook, rather than silently reading as merely idle.
    const blocked = [...tickets.values()].find((t) => t.state === 'queued' && t.blockedByIngredientId);
    cook.needsHelp = blocked
      ? { reason: 'blocked_on_ingredients', station: blocked.station, ingredientId: blocked.blockedByIngredientId }
      : null;
  }

  function updateServerWorker(simDtMs: number): void {
    const server = workers.get('server_1')!;
    if (server.busyRemainingMs !== null) {
      server.busyRemainingMs -= simDtMs;
      if (server.busyRemainingMs <= 0) {
        const ticket = server.pendingTicketId ? tickets.get(server.pendingTicketId) : null;
        if (ticket) {
          ticket.state = 'delivered';
          ticket.deliveredAtMs = simClockMs;
          deliveryCompletions.push({ actor: 'worker', durationMs: simClockMs - (ticket.readyAtMs ?? simClockMs) });
          if (deliveryCompletions.length > STEP_LOG_CAP) deliveryCompletions.shift();
        }
        server.busyRemainingMs = null;
        server.pendingTicketId = null;
        server.currentTaskKind = null;
      }
      return;
    }
    if (!server.enabled) return;
    const ready = findOldestReadyUnclaimed();
    if (ready) {
      ready.claimedBy = 'worker';
      server.busyRemainingMs = WORKER_TASK_DURATIONS_MS.deliver_order;
      server.pendingTicketId = ready.ticketId;
      server.currentTaskKind = 'deliver_order';
    }
  }

  function advanceSim(simDtMs: number): void {
    simClockMs += simDtMs;

    for (const bin of bins.values()) {
      if (!bin.restocking) continue;
      bin.restockRemainingMs -= simDtMs;
      if (bin.restockRemainingMs <= 0) {
        bin.stock = BIN_REFILL_TARGET;
        bin.restocking = false;
        restockCompletions.push(bin.restockTotalMs);
        if (restockCompletions.length > STEP_LOG_CAP) restockCompletions.shift();
        for (const ticket of tickets.values()) {
          if (ticket.blockedByIngredientId === bin.ingredientId) ticket.blockedByIngredientId = null;
        }
      }
    }

    for (const station of stationsMock.values()) {
      if (station.broken || !station.busyTicketId) continue;
      const ticket = tickets.get(station.busyTicketId);
      if (!ticket) { station.busyTicketId = null; continue; }
      ticket.remainingMs -= simDtMs;
      if (ticket.remainingMs <= 0) completeStationStep(ticket, station);
    }

    updateCookWorker(simDtMs);
    updateServerWorker(simDtMs);

    if (owner.busyRemainingMs !== null) {
      owner.busyRemainingMs -= simDtMs;
      if (owner.busyRemainingMs <= 0) resolveOwnerCompletion();
    }
  }

  // --- rendering ---------------------------------------------------------------------------

  function buildOrderSnapshots(): OrderSnapshot[] {
    return [...tickets.values()].map((t) => ({
      orderId: t.orderId,
      ticketId: t.ticketId,
      restaurantId: RESTAURANT_ID,
      customerId: 'harness_customer',
      tableId: null,
      dishId: t.dishId,
      price: dishById(t.dishId).suggestedPrice,
      state: t.state,
      station: t.state === 'ready' || t.state === 'delivered' ? null : t.station,
      currentStepIndex: t.currentStepIndex,
      remainingMs: Math.max(0, t.remainingMs),
      readyAgeMs: t.state === 'ready' ? Math.max(0, simClockMs - (t.readyAtMs ?? simClockMs)) : 0,
      blockedByIngredientId: t.blockedByIngredientId,
    }));
  }

  function buildShortages(): NonNullable<RestaurantSnapshot['shortages']> {
    const byIngredient = new Map<string, { station: Station; ingredientId: string; blockedTickets: number }>();
    for (const t of tickets.values()) {
      if (t.state !== 'queued' || !t.blockedByIngredientId) continue;
      const entry = byIngredient.get(t.blockedByIngredientId) ?? {
        station: t.station,
        ingredientId: t.blockedByIngredientId,
        blockedTickets: 0,
      };
      entry.blockedTickets += 1;
      byIngredient.set(t.blockedByIngredientId, entry);
    }
    return [...byIngredient.values()].map((e) => ({
      ...e,
      restocking: bins.get(e.ingredientId)?.restocking ?? false,
      exhausted: false,
    }));
  }

  function syncScene(): void {
    if (!scene) return;
    const restaurant: RestaurantSnapshot = {
      restaurantId: RESTAURANT_ID,
      playerId: RESTAURANT_ID,
      reputation: 60,
      queueLength: 0,
      seatsTotal: TABLES.length * 4,
      seatsAvailable: TABLES.length * 4,
      projectedWaitMs: 0,
      guestsServed: 0,
      averageSatisfaction: 0,
      abandonedParties: 0,
      tables: [],
      shortages: buildShortages(),
    };
    scene.updateFloorState({
      selfRestaurantId: RESTAURANT_ID,
      restaurants: [restaurant],
      customers: [],
      orders: buildOrderSnapshots(),
      events: [],
    });

    scene.upsertWorker(cookRenderState());
    scene.upsertWorker(serverRenderState());

    if (owner.spawned) scene.upsertOwner(ownerRenderState());
    else scene.removeOwner(OWNER_ID);

    for (const station of STATIONS) {
      const badge = brokenBadges.get(station);
      if (badge) badge.visible = stationsMock.get(station)!.broken;
    }
  }

  function cookRenderState(): WorkerRenderState {
    const cook = workers.get('cook_1')!;
    let position: Vec3 = COOK_IDLE_POS;
    let task: WorkerRenderState['task'] = null;
    if (cook.currentTaskKind === 'tend_station' && cook.pendingTicketId) {
      const ticket = tickets.get(cook.pendingTicketId);
      if (ticket) {
        position = STATION_POS[ticket.station];
        task = { kind: 'tend_station', phase: 'work', targetId: ticket.ticketId, station: ticket.station, remainingMs: Math.max(0, cook.busyRemainingMs ?? 0) };
      }
    } else if (cook.currentTaskKind === 'restock') {
      position = PANTRY_POS;
      task = { kind: 'restock', phase: 'work', targetId: null, station: null, remainingMs: Math.max(0, cook.busyRemainingMs ?? 0) };
    }
    return { workerId: cook.workerId, role: cook.role, post: 'prep', position, busy: task !== null, task, needsHelp: cook.needsHelp };
  }

  function serverRenderState(): WorkerRenderState {
    const server = workers.get('server_1')!;
    let position: Vec3 = SERVER_IDLE_POS;
    let task: WorkerRenderState['task'] = null;
    if (server.currentTaskKind === 'deliver_order' && server.pendingTicketId) {
      const ticket = tickets.get(server.pendingTicketId);
      position = TABLES[0] ?? SERVER_IDLE_POS;
      task = { kind: 'deliver_order', phase: 'work', targetId: ticket?.ticketId ?? null, station: null, remainingMs: Math.max(0, server.busyRemainingMs ?? 0) };
    }
    return { workerId: server.workerId, role: server.role, post: 'pass', position, busy: task !== null, task, needsHelp: null };
  }

  function ownerRenderState(): OwnerRenderState {
    let position: Vec3 = OWNER_IDLE_POS;
    if ((owner.currentAction === 'cook' || owner.currentAction === 'plate') && owner.actionTargetStation) {
      position = STATION_POS[owner.actionTargetStation];
    } else if (owner.currentAction === 'restock') position = PANTRY_POS;
    else if (owner.currentAction === 'repair' && owner.repairTargetStation) position = STATION_POS[owner.repairTargetStation];
    else if (owner.currentAction === 'carry') position = TABLES[0] ?? PASS_POS;
    return { playerId: OWNER_ID, position, facing: 0, isSelf: true };
  }

  return {
    id: 'kitchen-bottleneck',
    title: 'Kitchen Bottleneck',
    description:
      'Station queues, ingredient shortages, pickup, worker behaviours and owner interventions — ' +
      'with task-completion timing measured and comparable across configuration changes. PRD §15.3.',

    mount(container: HTMLElement): void {
      const viewport = document.createElement('div');
      viewport.className = 'harness-viewport';
      const panel = new DevControls('Kitchen bottleneck controls');
      container.append(viewport, panel.element);

      scene = new RestaurantScene({ showDebugGrid: false, showCompetitor: false });
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(viewport.clientWidth, Math.max(1, viewport.clientHeight));
      viewport.appendChild(renderer.domElement);

      camera = new CameraController(viewport.clientWidth / Math.max(1, viewport.clientHeight));
      camera.setSettings(KITCHEN_CAMERA);
      camera.setTarget(0, 3.5);

      // --- reset all mock state fresh on every mount --------------------------------------
      tickets = new Map();
      stationsMock = new Map(STATIONS.map((s) => [s, { station: s, busyTicketId: null, broken: false, slowFactor: 1 as const }]));
      bins = new Map(INGREDIENT_IDS.map((id) => [id, { ingredientId: id, stock: BIN_STARTING_STOCK, restocking: false, restockRemainingMs: 0, restockTotalMs: 0, requestedBy: null }]));
      workers = new Map([
        ['cook_1', { workerId: 'cook_1', role: 'cook' as WorkerRole, enabled: true, busyRemainingMs: null, currentTaskKind: null, pendingTicketId: null, needsHelp: null }],
        ['server_1', { workerId: 'server_1', role: 'server' as WorkerRole, enabled: true, busyRemainingMs: null, currentTaskKind: null, pendingTicketId: null, needsHelp: null }],
      ]);
      owner = { spawned: false, busyRemainingMs: null, currentAction: null, carryingTicketId: null, repairTargetStation: null, actionTargetStation: null };
      simClockMs = 0;
      productionSpeed = 1;
      nextTicketSeq = 0;
      nextDishSeq = 0;
      selectedStation = STATIONS[0];
      selectedIngredient = INGREDIENT_IDS[0];
      stepCompletions = [];
      deliveryCompletions = [];
      totalCompletions = [];
      restockCompletions = [];
      repairCompletions = [];

      // One badge per station, built once — see this file's header on why "broken" gets its own
      // glyph rather than reusing/recoloring the queue or shortage indicators STORY-016 built.
      brokenBadges = new Map();
      for (const station of STATIONS) {
        const mesh = scene.scene.getObjectByName(`station_${station}`);
        if (!mesh) continue;
        const badge = createGlyphSprite('B', STATE_COLORS.critical, 0.55);
        badge.position.set(0, 1.6, 0);
        badge.visible = false;
        mesh.add(badge);
        brokenBadges.set(station, badge);
      }

      // --- Production speed ------------------------------------------------------------
      panel.addSelect('Production speed', [
        { value: '0.25', label: '0.25x' },
        { value: '0.5', label: '0.5x' },
        { value: '1', label: '1x' },
        { value: '2', label: '2x' },
        { value: '4', label: '4x' },
      ], (v) => { productionSpeed = Number(v); });

      panel.addSeparator();

      // --- Queue preset orders (§15.3) --------------------------------------------------
      panel.addButton('Spawn single ticket', () => makeTicket(PRESET_DISHES[nextDishSeq++ % PRESET_DISHES.length]));
      panel.addButton('Spawn light order (3 tickets)', () => {
        for (let i = 0; i < 3; i += 1) makeTicket(PRESET_DISHES[nextDishSeq++ % PRESET_DISHES.length]);
      });
      panel.addButton('Spawn rush (8 tickets)', () => {
        for (let i = 0; i < 8; i += 1) makeTicket(PRESET_DISHES[nextDishSeq++ % PRESET_DISHES.length]);
      });
      panel.addButton(`Queue backlog at selected station (${BACKLOG_PRESET_SIZE} tickets)`, () => {
        const candidates = dishesUsingStation(selectedStation);
        for (let i = 0; i < BACKLOG_PRESET_SIZE; i += 1) {
          makeTicket(candidates[i % candidates.length], { atStation: selectedStation });
        }
      });
      panel.addButton('Spawn ready dish at pass', () => spawnReadyTicket());

      panel.addSeparator();

      // --- Ingredient bins ---------------------------------------------------------------
      panel.addSelect('Ingredient', INGREDIENT_IDS.map((id) => ({ value: id, label: id })), (v) => { selectedIngredient = v; });
      const setBinReadout = panel.addReadout('Bin');
      panel.addButton('Empty bin (create a shortage)', () => {
        const bin = bins.get(selectedIngredient);
        if (bin) { bin.stock = 0; bin.restocking = false; }
      });
      panel.addButton('Reset bin to full (debug)', () => {
        const bin = bins.get(selectedIngredient);
        if (bin) { bin.stock = BIN_STARTING_STOCK; bin.restocking = false; }
      });

      panel.addSeparator();

      // --- Stations (queue depth, slow, equipment failure) --------------------------------
      panel.addSelect('Selected station', STATIONS.map((s) => ({ value: s, label: s })), (v) => { selectedStation = v as Station; });
      panel.addSelect('Slow factor (selected station)', [
        { value: '1', label: '1x (normal)' },
        { value: '2', label: '2x slower' },
        { value: '4', label: '4x slower' },
      ], (v) => {
        const station = stationsMock.get(selectedStation);
        if (station) station.slowFactor = Number(v) as 1 | 2 | 4;
      });
      panel.addButton('Trigger equipment failure at selected station', () => {
        const station = stationsMock.get(selectedStation);
        if (station) station.broken = true;
      });
      const setStationReadout = panel.addReadout('Station');

      panel.addSeparator();

      // --- Workers -------------------------------------------------------------------------
      panel.addToggle('Cook enabled', true, (v) => { workers.get('cook_1')!.enabled = v; });
      panel.addToggle('Server enabled', true, (v) => { workers.get('server_1')!.enabled = v; });
      const setCookReadout = panel.addReadout('Cook');
      const setServerReadout = panel.addReadout('Server');

      panel.addSeparator();

      // --- Owner interventions (§17 differential) -------------------------------------------
      panel.addToggle('Owner on floor', false, (v) => {
        owner.spawned = v;
        if (!v) {
          owner.busyRemainingMs = null;
          owner.currentAction = null;
          owner.carryingTicketId = null;
          owner.actionTargetStation = null;
        }
      });
      panel.addButton('Owner: cook (prep/grill/oven)', () => {
        if (!owner.spawned || owner.busyRemainingMs !== null) return;
        const ticket = findEligibleQueuedTicket(['prep', 'grill', 'oven']);
        if (!ticket) return;
        startStationStep(ticket, stationsMock.get(ticket.station)!, 'owner');
        owner.busyRemainingMs = OWNER_TASK_DURATIONS_MS.cook;
        owner.currentAction = 'cook';
        owner.actionTargetStation = ticket.station;
      });
      panel.addButton('Owner: plate (plating)', () => {
        if (!owner.spawned || owner.busyRemainingMs !== null) return;
        const ticket = findEligibleQueuedTicket(['plating']);
        if (!ticket) return;
        startStationStep(ticket, stationsMock.get(ticket.station)!, 'owner');
        owner.busyRemainingMs = OWNER_TASK_DURATIONS_MS.plate;
        owner.currentAction = 'plate';
        owner.actionTargetStation = ticket.station;
      });
      panel.addButton('Owner: carry ready dish to table', () => {
        if (!owner.spawned || owner.busyRemainingMs !== null || owner.carryingTicketId) return;
        const ticket = findOldestReadyUnclaimed();
        if (!ticket) return;
        ticket.claimedBy = 'owner';
        owner.carryingTicketId = ticket.ticketId;
        owner.busyRemainingMs = OWNER_TASK_DURATIONS_MS.pickup + OWNER_TASK_DURATIONS_MS.deliver;
        owner.currentAction = 'carry';
        scene?.setCarrying(OWNER_ID, 1);
      });
      panel.addButton('Owner: restock neediest bin', () => {
        if (!owner.spawned || owner.busyRemainingMs !== null) return;
        const bin = neediestBin();
        if (!bin) return;
        startBinRestock(bin, 'owner');
      });
      panel.addButton('Owner: repair selected station', () => {
        if (!owner.spawned || owner.busyRemainingMs !== null) return;
        const station = stationsMock.get(selectedStation);
        if (!station || !station.broken) return;
        owner.busyRemainingMs = HARNESS_REPAIR_DURATION_MS;
        owner.currentAction = 'repair';
        owner.repairTargetStation = selectedStation;
      });
      const setOwnerReadout = panel.addReadout('Owner');

      panel.addSeparator();

      // --- Measurements (§15.3's distinguishing control) ------------------------------------
      const setStepReadout = panel.addReadout('Station steps (dispatch→cooked)');
      const setDeliveryReadout = panel.addReadout('Deliveries (ready→table)');
      const setTotalReadout = panel.addReadout('Last full ticket (queue→ready)');
      const setRestockReadout = panel.addReadout('Restocks');
      const setRepairReadout = panel.addReadout('Repairs');
      const setClockReadout = panel.addReadout('Sim clock');

      panel.addSeparator();

      panel.addSlider('Camera height', { min: 10, max: 40, step: 0.5, value: KITCHEN_CAMERA.height },
        (v) => camera?.setSettings({ height: v }));
      panel.addSlider('Camera distance', { min: 8, max: 42, step: 0.5, value: KITCHEN_CAMERA.distance },
        (v) => camera?.setSettings({ distance: v }));
      panel.addSlider('Camera angle', { min: -Math.PI, max: Math.PI, step: 0.02, value: KITCHEN_CAMERA.angle },
        (v) => camera?.setSettings({ angle: v }));
      panel.addSlider('Field of view', { min: 20, max: 80, step: 1, value: KITCHEN_CAMERA.fov },
        (v) => camera?.setSettings({ fov: v }));
      panel.addButton('Reset camera', () => camera?.setSettings({ ...KITCHEN_CAMERA }));

      const fpsReadout = panel.addReadout('FPS');

      function refreshReadouts(): void {
        const bin = bins.get(selectedIngredient);
        setBinReadout(bin ? `${bin.ingredientId}: ${bin.stock} units${bin.restocking ? ` (restocking, ${fmtMs(bin.restockRemainingMs)} left)` : ''}` : '—');

        const station = stationsMock.get(selectedStation);
        if (station) {
          const depth = [...tickets.values()].filter((t) => t.state === 'queued' && !t.blockedByIngredientId && t.station === selectedStation).length;
          const busyTicket = station.busyTicketId ? tickets.get(station.busyTicketId) : null;
          setStationReadout(
            `${selectedStation}: queue ${depth}${station.broken ? ', BROKEN' : busyTicket ? `, cooking ${fmtMs(busyTicket.remainingMs)}` : ', idle'}, slow x${station.slowFactor}`,
          );
        }

        const cook = workers.get('cook_1')!;
        setCookReadout(`${cook.enabled ? 'enabled' : 'DISABLED'} — ${cook.currentTaskKind ? `${cook.currentTaskKind} (${fmtMs(cook.busyRemainingMs)})` : cook.needsHelp ? 'NEEDS HELP' : 'idle'}`);
        const serverWorker = workers.get('server_1')!;
        setServerReadout(`${serverWorker.enabled ? 'enabled' : 'DISABLED'} — ${serverWorker.currentTaskKind ? `${serverWorker.currentTaskKind} (${fmtMs(serverWorker.busyRemainingMs)})` : 'idle'}`);

        setOwnerReadout(
          !owner.spawned ? 'not spawned' : owner.currentAction ? `${owner.currentAction} (${fmtMs(owner.busyRemainingMs)} left)` : 'free',
        );

        const stepWorkerAvg = average(stepCompletions.filter((c) => c.actor === 'worker').map((c) => c.durationMs));
        const stepOwnerAvg = average(stepCompletions.filter((c) => c.actor === 'owner').map((c) => c.durationMs));
        const lastStep = stepCompletions[stepCompletions.length - 1];
        setStepReadout(
          `${stepCompletions.length} done — avg worker ${fmtMs(stepWorkerAvg)}, avg owner ${fmtMs(stepOwnerAvg)}` +
          (lastStep ? `; last ${lastStep.dishId}@${lastStep.station} ${fmtMs(lastStep.durationMs)} (${lastStep.actor})` : ''),
        );

        const delWorkerAvg = average(deliveryCompletions.filter((c) => c.actor === 'worker').map((c) => c.durationMs));
        const delOwnerAvg = average(deliveryCompletions.filter((c) => c.actor === 'owner').map((c) => c.durationMs));
        setDeliveryReadout(`${deliveryCompletions.length} done — avg worker ${fmtMs(delWorkerAvg)}, avg owner ${fmtMs(delOwnerAvg)}`);

        const lastTotal = totalCompletions[totalCompletions.length - 1];
        setTotalReadout(lastTotal ? `${fmtMs(lastTotal.durationMs)} (${lastTotal.actor}) — avg ${fmtMs(average(totalCompletions.map((c) => c.durationMs)))}` : 'none yet');

        setRestockReadout(restockCompletions.length ? `${restockCompletions.length} done — last ${fmtMs(restockCompletions[restockCompletions.length - 1])}` : 'none yet');
        setRepairReadout(repairCompletions.length ? `${repairCompletions.length} done — last ${fmtMs(repairCompletions[repairCompletions.length - 1])}` : 'none yet');
        setClockReadout(`${Math.round(simClockMs)}ms virtual`);
      }

      const resize = () => {
        const w = viewport.clientWidth;
        const h = Math.max(1, viewport.clientHeight);
        renderer?.setSize(w, h);
        camera?.setAspect(w / h);
      };
      observer = new ResizeObserver(resize);
      observer.observe(viewport);

      // Seed a small starting order so the harness is immediately demonstrative rather than an
      // empty kitchen — the more elaborate bottleneck scenarios (backlog + shortage + a disabled
      // worker together) are the control panel's job, same split customer-flow-harness makes.
      makeTicket(PRESET_DISHES[nextDishSeq++ % PRESET_DISHES.length]);
      makeTicket(PRESET_DISHES[nextDishSeq++ % PRESET_DISHES.length]);
      spawnReadyTicket();

      let last = performance.now();
      let fpsAccum = 0;
      let fpsFrames = 0;
      let readoutAccum = 0;

      const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        const realDt = Math.min(0.1, (now - last) / 1000);
        last = now;

        fpsAccum += realDt;
        fpsFrames += 1;
        readoutAccum += realDt;
        if (fpsAccum >= 0.5) {
          fpsReadout((fpsFrames / fpsAccum).toFixed(0));
          fpsAccum = 0;
          fpsFrames = 0;
        }
        if (readoutAccum >= 0.3) {
          refreshReadouts();
          readoutAccum = 0;
        }

        advanceSim(realDt * 1000 * productionSpeed);
        syncScene();

        if (scene && camera) {
          camera.update(realDt);
          renderer?.render(scene.scene, camera.camera);
        }
      };
      frame = requestAnimationFrame(loop);
      refreshReadouts();
    },

    dispose(): void {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      observer = null;
      // `scene.dispose()` traverses the whole graph disposing geometry/materials, which sweeps
      // up the per-station broken-badge sprites too (children of each station mesh) — same
      // reasoning as customer-flow-harness's route lines/labels.
      scene?.dispose();
      scene = null;
      renderer?.dispose();
      renderer = null;
      camera = null;
      brokenBadges = new Map();
      tickets = new Map();
      stationsMock = new Map();
      bins = new Map();
      workers = new Map();
      owner = { spawned: false, busyRemainingMs: null, currentAction: null, carryingTicketId: null, repairTargetStation: null, actionTargetStation: null };
    },
  };
}
