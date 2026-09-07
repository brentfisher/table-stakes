// STORY-026 asset showcase harness. Mocked state that matches the *shape* of the real
// production view contracts (`OwnerRenderState`, `CustomerRenderState`, `WorkerRenderState`,
// `RestaurantSnapshot`, `CustomerSnapshot`, `OrderSnapshot`) rather than being ad hoc objects
// that merely happen to render — this file's own acceptance criterion.
//
// Companion to `test-entities.ts`, not a replacement: that module's `mockOwner`/`orbitOwner`/
// `mockShortageVsQueueDemo` are restaurant-layout-harness's and kitchen-bottleneck-harness's own
// fixtures, scoped to their stories. This module is scoped to asset-showcase-harness's three
// categories (Player/Dish/Restaurant Models) and is a thin, typed builder layer — it holds no
// THREE.js objects and no DOM, only plain data shaped exactly like what `RestaurantScene`,
// `GameClient` and `match_snapshot` already carry.

import type { OwnerRenderState, CustomerRenderState, WorkerRenderState } from './scene-primitives';
import type {
  RestaurantSnapshot,
  CustomerSnapshot,
  OrderSnapshot,
  TableSnapshot,
  WorkerRole,
} from '../../../shared/schemas/game-state';
import { UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD } from '../../../shared/constants/tuning';
import layout from '../../../shared/game-data/restaurant-layout.json';

export const SHOWCASE_RESTAURANT_ID = 'showcase_restaurant';
export const SHOWCASE_RIVAL_ID = 'showcase_rival';
export const SHOWCASE_OWNER_ID = 'showcase_owner';
export const SHOWCASE_RIVAL_OWNER_ID = 'showcase_owner_rival';

type LayoutTableEntity = { id: string; type: string; seats?: number };
const TABLE_ENTITIES = (layout.entities as LayoutTableEntity[]).filter((e) => e.type === 'table');

/** Every real table id/seat-count from the layout both restaurants actually ship, so a "which
 * table" picker never drifts from `restaurant-layout.json`. */
export function layoutTableIds(): string[] {
  return TABLE_ENTITIES.map((t) => t.id);
}

export function mockOwner(playerId: string, x: number, z: number, isSelf: boolean, facing = 0): OwnerRenderState {
  return { playerId, position: { x, y: 0, z }, facing, isSelf };
}

export function mockWorker(
  workerId: string,
  role: WorkerRole,
  post: string,
  x: number,
  z: number,
  task: WorkerRenderState['task'] = null,
  needsHelp: WorkerRenderState['needsHelp'] = null,
): WorkerRenderState {
  return {
    workerId,
    role,
    post,
    position: { x, y: 0, z },
    busy: task !== null,
    task,
    needsHelp,
  };
}

/** `unhappy` is derived from `patienceRemaining` the same way the server derives it
 * (`patienceRemaining <= UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD`), not set independently — a mock
 * fixture that could show `unhappy: true` above the threshold, or vice versa, would be exactly
 * the "ad hoc object that happens to render" this file's header disclaims. */
export function mockCustomerRenderState(
  customerId: string,
  segmentId: string,
  x: number,
  z: number,
  patienceRemaining: number,
): CustomerRenderState {
  return {
    customerId,
    position: { x, y: 0, z },
    patienceRemaining,
    unhappy: patienceRemaining <= UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD,
    segmentId,
  };
}

/** Every real table, all clean and unoccupied — the neutral floor state a category starts from
 * before a specific preview overrides one table. */
export function defaultTables(): TableSnapshot[] {
  return TABLE_ENTITIES.map((t) => ({ id: t.id, seats: t.seats ?? 2, occupiedBy: null, dirty: false }));
}

export function mockSelfRestaurantSnapshot(overrides: Partial<RestaurantSnapshot> = {}): RestaurantSnapshot {
  return {
    restaurantId: SHOWCASE_RESTAURANT_ID,
    playerId: SHOWCASE_RESTAURANT_ID,
    reputation: 60,
    queueLength: 0,
    seatsTotal: 12,
    seatsAvailable: 12,
    projectedWaitMs: 0,
    guestsServed: 0,
    averageSatisfaction: 0,
    abandonedParties: 0,
    tables: defaultTables(),
    shortages: [],
    ...overrides,
  };
}

export function mockRivalRestaurantSnapshot(overrides: Partial<RestaurantSnapshot> = {}): RestaurantSnapshot {
  return {
    restaurantId: SHOWCASE_RIVAL_ID,
    playerId: SHOWCASE_RIVAL_ID,
    reputation: 55,
    queueLength: 0,
    seatsTotal: 12,
    seatsAvailable: 12,
    projectedWaitMs: 0,
    guestsServed: 0,
    averageSatisfaction: 0,
    abandonedParties: 0,
    tables: [],
    ...overrides,
  };
}

/** `orderId`/`ticketId`/`dishId` are the only fields every preview actually varies; every other
 * `OrderSnapshot` field gets the same "off/neutral" default a real never-touched ticket would
 * carry, so a caller overriding just `state`/`station`/`readyAgeMs`/etc. can never accidentally
 * leave a required field undefined. */
export function mockOrder(
  orderId: string,
  dishId: string,
  overrides: Partial<OrderSnapshot> = {},
): OrderSnapshot {
  return {
    orderId,
    ticketId: `${orderId}_ticket`,
    restaurantId: SHOWCASE_RESTAURANT_ID,
    customerId: 'showcase_customer',
    tableId: null,
    dishId,
    price: 0,
    state: 'queued',
    station: null,
    currentStepIndex: 0,
    remainingMs: 0,
    readyAgeMs: 0,
    blockedByIngredientId: null,
    ...overrides,
  };
}

export function mockDiningCustomer(
  customerId: string,
  overrides: Partial<CustomerSnapshot> = {},
): CustomerSnapshot {
  return {
    customerId,
    segmentId: 'office_worker',
    partySize: 2,
    state: 'SEATED',
    restaurantId: SHOWCASE_RESTAURANT_ID,
    position: { x: 0, y: 0, z: 0 },
    queueWaitMs: 0,
    readyToSeat: false,
    patienceRemaining: 1,
    satisfaction: 80,
    tableId: null,
    orderId: null,
    decisionReason: null,
    unhappy: false,
    ...overrides,
  };
}
