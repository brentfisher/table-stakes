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
  /**
   * Ready-up state, PRD §18 setup UI "opponent-ready status". PUBLIC on purpose: §18 says to
   * show whether the opponent is ready while forbidding their menu and prices, so this flag
   * is the whole of what one player learns about the other's setup.
   */
  ready: boolean;
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
 *
 * BOTH PLAYERS RECEIVE THIS ARRAY IDENTICALLY, so everything in it must be genuinely public.
 * STORY-010 publishes it, and publishes exactly the observables its own choice model scores a
 * restaurant on: what a customer in the street can see. The fields a later story owns are
 * OPTIONAL until that story fills them in, each marked with the story that will — a partial
 * object is honest, and placeholders that read as real data are not (the same reasoning
 * order-system.js gives for not filling this shape in itself).
 *
 * `menu`, `inventory` and `cash` are deliberately NOT published while STORY-010 owns this
 * array: they are the player's private setup submission (PRD §18, Decision 16 — `you.setup`),
 * read by the choice model server-side and never republished to the rival.
 */
export interface RestaurantSnapshot {
  restaurantId: string;
  playerId: string;

  // --- published today, STORY-010: the public observables the choice model scores ---
  /** PRD §6 "Visible reputation". Compounds across the match inside a capped band. */
  reputation: number;
  /** Parties queueing at this restaurant right now. PRD §6 "Actual queue length". */
  queueLength: number;
  seatsTotal: number;
  seatsAvailable: number;
  /** What the district projects a party of two would wait here, from the live queue, free
   * tables and the kitchen's deepest station queue. PRD §6 "Actual service speed". */
  projectedWaitMs: number;
  guestsServed: number;
  averageSatisfaction: number;
  abandonedParties: number;
  tables: TableSnapshot[];

  // --- owned by later stories; absent until then ---
  /** STORY-006 (inventory) — priced menu with live availability. */
  menu?: Array<{ dishId: string; price: number; available: boolean }>;
  /** STORY-006 — remaining units, keyed by ingredient id from dishes.json `ingredients`. */
  inventory?: Record<string, number>;
  /** STORY-013 (scoring). */
  cash?: number;
  revenue?: number;
  /** STORY-012 (upgrades). */
  purchasedUpgradeIds?: string[];
  /** STORY-005's kitchen publishes ticket state through `orders[]`; a per-station view is a
   * later story's. */
  stations?: StationSnapshot[];
  /** STORY-007 (worker AI). */
  workers?: Array<{ workerId: string; role: WorkerRole; position: Vec3; busy: boolean }>;
  /** STORY-015 (HUD bottlenecks). */
  activeBottlenecks?: BottleneckKind[];
}

/**
 * One party's restaurant choice, PRD §17 step 6 ("Record decision reason for analytics and
 * post-match explanation"). SERVER-SIDE ONLY: the whole log lives on `match.districtDecisions`
 * and never enters a snapshot, because one restaurant's losses are the other's reasons. The
 * per-restaurant roll-up STORY-014's results screen reads is `match.districtSummary`.
 */
export interface DistrictDecision {
  customerId: string;
  segmentId: string;
  partySize: number;
  atMs: number;
  /** Null when the party left the district without choosing. */
  chosenRestaurantId: string | null;
  /** Null when no single component decided it — two comparable restaurants, or no rival to
   * compare against at all. Never guessed. */
  reason: DecisionReason | null;
  /** Each restaurant's total utility for this party, in [0,1]. */
  utilities: Record<string, number>;
  projectedWaitMs: Record<string, number>;
}

/** `match.districtSummary` — one entry per restaurant, published at the `results` transition. */
export interface DistrictSummaryEntry {
  restaurantId: string;
  reputation: number;
  guestsServed: number;
  averageSatisfaction: number;
  abandonedParties: number;
  /** Funnel counters in §8 vocabulary. `chosen` is parties won; `CHOOSE_RIVAL` is parties this
   * restaurant lost to the other one — a funnel outcome, never a party state. */
  counts: Record<string, number>;
  wonByReason: Partial<Record<DecisionReason, number>>;
  lostByReason: Partial<Record<DecisionReason, number>>;
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

/**
 * `match_snapshot.orders[]` — ONE TICKET, PRD §17 "Order system". A party's order decomposes
 * into one ticket per dish, so several entries can share an `orderId`; `ticketId` is what is
 * unique. Every field is server-computed (Decision 2) and pre-sanitized by
 * `order-system.js`'s `toPublicOrderSnapshot`, which is an allowlist, not a spread.
 *
 * STATION QUEUE DEPTH IS DERIVED FROM THIS ARRAY rather than published as its own number, so
 * the two can never disagree:
 *
 *     orders.filter((o) => o.station === station && o.state === 'queued').length
 */
export interface OrderSnapshot {
  /** The party's order. Shared by every ticket the party's order decomposed into. */
  orderId: string;
  /** STORY-005. Unique per ticket — `orderId` is not, once a party orders more than one dish. */
  ticketId: string;
  restaurantId: string;
  customerId: string;
  /** STORY-005. The table this ticket is destined for; null if the party has no table. */
  tableId: string | null;
  dishId: string;
  /** The price the player set for this dish during setup. Revenue is computed from it, on the
   * server, and never from anything the client sends. */
  price: number;
  state: OrderState;
  /**
   * STORY-005. The station this ticket is being worked at (`in_progress`) or waiting for
   * (`queued`), and null once it is off the line — ready, delivered or cancelled.
   */
  station: Station | null;
  /** Index into the dish's `stationSteps`; -1 before the first step starts. */
  currentStepIndex: number;
  remainingMs: number;
  /** Ms since the dish finished, for the PRD §17 freshness component of order quality. */
  readyAgeMs: number;
}

/**
 * `match.eventEffects` — the combined effect of every event active RIGHT NOW, published onto
 * match state every tick by `server/src/game/systems/event-system.js` (STORY-011).
 *
 * Every key is always present with a neutral value (`1` for a multiplier, `{}` for a map, `0`
 * for a count), including when no event is active, so a consumer reads what it needs
 * unconditionally and never branches on whether an event is running. The scalar and map keys
 * are derived from `events.json` itself, so a new effect key in the data appears here with no
 * code change; the ones the MVP catalogue defines are listed below.
 *
 * Multipliers are 1.0-relative (Decision 12): above 1 amplifies, below 1 dampens — including
 * durations, where below 1 therefore means faster.
 */
export interface ActiveEventEffects {
  /** Ids of the events active this tick, in activation order. Empty when none are. */
  activeEventIds: string[];

  // --- the §16 vocabulary ---
  footTrafficMultiplier: number;
  partySizeMultiplier: number;
  dishTagDemandMultipliers: Record<string, number>;
  /** Raw overrides from the active events; the resolved distribution is `segmentWeights`. */
  segmentWeightOverrides: Record<string, number>;
  /**
   * The market's `segmentWeights` with the active overrides applied per Decision 12 — the
   * override replaces the named segment's weight and the rest is redistributed proportionally.
   * Sums to 1. Equal to the market's own weights when nothing overrides them.
   */
  segmentWeights: Record<string, number>;

  // --- Decision 12 named extensions, as the MVP catalogue defines them ---
  patienceMultiplier: number;
  priceSensitivityMultiplier: number;
  reputationRewardMultiplier: number;
  trailingBurstMultiplier: number;
  ingredientCostMultiplier: number;
  ingredientRestockDurationMultiplier: number;
  affectedIngredientCount: number;
  stationSpeedMultipliers: Partial<Record<Station, number>>;

  /** One entry per active event carrying a `specialPartySpawn`. Empty when none do. */
  specialPartySpawns: Array<{
    eventId: string;
    segment: string;
    partySize: number;
    budgetMultiplier: number;
    reputationImpactMultiplier: number;
  }>;

  /** Derived keys the catalogue may add later. */
  [key: string]: unknown;
}
