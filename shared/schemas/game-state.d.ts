// Type declarations for game-state.js, plus the entity shapes carried by `match_snapshot`.
// PRD §8, §12, §17. The server owns all of this; the client only renders it.

import type { InteractAction, Station } from './messages';

export type CustomerState =
  | 'ENTER_DISTRICT'
  | 'EVALUATE_RESTAURANTS'
  | 'APPROACH_OR_QUEUE'
  | 'SEATED'
  | 'ORDERING'
  | 'WAITING_FOR_FOOD'
  | 'EATING'
  | 'PAYING'
  | 'LEAVING'
  | 'REVIEW'
  | CustomerExitState;

/** PRD §8 "Exit states include:". */
export type CustomerExitState =
  | 'CHOOSE_RIVAL'
  | 'LEAVE_DISTRICT'
  | 'ABANDON_QUEUE'
  | 'CANCEL_ORDER'
  | 'LEAVE_ANGRY';

export type OrderState =
  | 'placed'
  | 'queued'
  | 'in_progress'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export type DecisionReason =
  | 'better_price'
  | 'better_menu_fit'
  | 'shorter_projected_wait'
  | 'higher_reputation'
  | 'event_affinity'
  | 'restaurant_full'
  | 'customer_abandoned_queue';

export type WorkerRole = 'cook' | 'server' | 'prep_worker' | 'host';

export type BottleneckKind =
  | 'kitchen_backlog'
  | 'ingredient_shortage'
  | 'server_overload'
  | 'long_entry_queue'
  | 'unhappy_customer'
  | 'dirty_table'
  | 'equipment_failure'
  | 'cash_opportunity';

export declare const CUSTOMER_STATES: Readonly<Record<CustomerState, CustomerState>>;
export declare const CUSTOMER_EXIT_STATES: readonly CustomerExitState[];
export declare const CUSTOMER_STATE_LIST: readonly CustomerState[];
export declare function isExitState(state: string): boolean;
export declare const ORDER_STATES: readonly OrderState[];
export declare const DECISION_REASONS: readonly DecisionReason[];
export declare const WORKER_ROLES: readonly WorkerRole[];
export declare const BOTTLENECK_KINDS: readonly BottleneckKind[];

// --- snapshot entity shapes ---------------------------------------------------------------

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** `match_snapshot.players[]` — the owner-avatars. STORY-001 shipped this shape. */
export interface PlayerSnapshot {
  playerId: string;
  position: Vec3;
  facing: number;
  sprinting: boolean;
  /** Last `player_input.sequence` the server integrated, for client reconciliation. */
  lastSequence: number;
  connected: boolean;
  /** Set while the owner is mid-action at a station or table. */
  carrying?: string[];
  currentAction?: InteractAction | null;
}

/** One table in a restaurant, PRD §8 "Operational bottlenecks" (dirty tables block seating). */
export interface TableSnapshot {
  id: string;
  seats: number;
  occupiedBy: string | null;
  dirty: boolean;
}

/** One kitchen station, PRD §14 layout. `speedMultiplier` folds in upgrades and events. */
export interface StationSnapshot {
  id: string;
  station: Station;
  busyWithOrderId: string | null;
  remainingMs: number;
  broken: boolean;
  speedMultiplier: number;
}

/**
 * `match_snapshot.restaurants[]` — one per player. Everything here is server-computed;
 * PRD §12 "Networking model" forbids the browser calculating any of it.
 */
export interface RestaurantSnapshot {
  restaurantId: string;
  playerId: string;
  /** Priced menu as submitted in `setup_submit`, keyed by dish id. */
  menu: Array<{ dishId: string; price: number; available: boolean }>;
  /** Remaining units, keyed by ingredient id from dishes.json `ingredients`. */
  inventory: Record<string, number>;
  cash: number;
  revenue: number;
  reputation: number;
  guestsServed: number;
  averageSatisfaction: number;
  abandonedParties: number;
  queueLength: number;
  purchasedUpgradeIds: string[];
  tables: TableSnapshot[];
  stations: StationSnapshot[];
  workers: Array<{ workerId: string; role: WorkerRole; position: Vec3; busy: boolean }>;
  activeBottlenecks: BottleneckKind[];
}

/**
 * `match_snapshot.customers[]` — a party, not an individual. PRD §6: the exact preference
 * math is hidden from the player, so this carries the party's visible state only.
 */
export interface CustomerSnapshot {
  customerId: string;
  segmentId: string;
  partySize: number;
  state: CustomerState;
  /** Null until the party has chosen; PRD §6 choice is probabilistic, never argmax. */
  restaurantId: string | null;
  position: Vec3;
  /** 0..1 of the segment's `patienceSeconds` still remaining. */
  patienceRemaining: number;
  satisfaction: number;
  tableId: string | null;
  orderId: string | null;
  decisionReason: DecisionReason | null;
}

/** `match_snapshot.orders[]` — one ticket, PRD §17 "Order system". */
export interface OrderSnapshot {
  orderId: string;
  restaurantId: string;
  customerId: string;
  dishId: string;
  price: number;
  state: OrderState;
  /** Index into the dish's `stationSteps`; -1 before the first step starts. */
  currentStepIndex: number;
  remainingMs: number;
  /** Ms since the dish finished, for the PRD §17 freshness component of order quality. */
  readyAgeMs: number;
}
