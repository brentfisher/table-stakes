// Type declarations for messages.js. PRD §12 "WebSocket messages" — the field names below are
// taken verbatim from the §12 JSON examples. Changing one is a wire-breaking change.

import type {
  CustomerSnapshot,
  KitchenQueueBoardEntry,
  OrderSnapshot,
  PlayerSnapshot,
  RestaurantSnapshot,
} from './game-state';
import type { PhasePreset } from '../constants/tuning';
import type { AcceptedSetup } from './setup-rules';
import type { ManagerConstraintId, ManagerConstraintSnapshot } from '../game-logic/manager-ledger';

// STORY-001 declared `PlayerSnapshot` here. STORY-002 moved the snapshot ENTITY shapes to
// game-state.d.ts, where the rest of them live, and re-exports them so no existing import
// path breaks — design Decision 7's "widen, never rename" applied to the type surface.
export type {
  CustomerSnapshot,
  KitchenQueueBoardEntry,
  OrderSnapshot,
  PlayerSnapshot,
  RestaurantSnapshot,
} from './game-state';

export type ClientMessageType =
  | 'join_room'
  | 'player_input'
  | 'player_ready'
  | 'interact'
  | 'purchase_upgrade'
  | 'setup_submit';

export type ServerMessageType =
  | 'joined'
  | 'match_snapshot'
  | 'event_announce'
  | 'match_complete'
  | 'error';

export type ErrorCode =
  | 'invalid_json'
  | 'missing_type'
  | 'unknown_type'
  | 'not_implemented'
  | 'room_not_found'
  | 'invalid_payload'
  | 'match_full'
  /** STORY-009: well-formed but illegal setup submission. Carries `reason`. */
  | 'setup_rejected'
  /** STORY-008: well-formed but illegal `interact` — out of range, no such target, or wrong
   * for the target's current state. Carries `reason`. */
  | 'interact_rejected'
  /** STORY-012: well-formed but illegal `purchase_upgrade` — out of range of the terminal,
   * unknown upgrade, already owned, unmet tier prerequisite, an effect not wired to any
   * system, or unaffordable. Carries `reason`. */
  | 'purchase_rejected'
  /** STORY-022: `join_room` (fresh or a reconnect token) arrived after the match already
   * ended. Carries `reason`, a MatchEndReason. */
  | 'match_ended'
  /** STORY-024: a fresh join against a private-invite room presented a token that does not
   * match the room's current `inviteToken`. */
  | 'invite_token_mismatch'
  /** STORY-024: the room's invite has passed `INVITE_TOKEN_EXPIRY_MS`. */
  | 'invite_expired'
  /** STORY-024: the host canceled the room via `POST /api/rooms/:roomId/cancel`. */
  | 'invite_canceled'
  /** STORY-024: the room's match has already left `lobby` — distinct from `match_full`, a
   * timing fact rather than a capacity one. */
  | 'already_started'
  /** STORY-024: no room owns the presented invite token at all. */
  | 'invite_not_found';

export type MatchPhase =
  | 'lobby'
  | 'market_reveal'
  | 'setup'
  | 'service'
  | 'final_rush'
  | 'results';

export type EventState = 'warning' | 'active' | 'ended';

/** Why a match ended. `player_disconnected` means a reconnect grace period expired. */
export type MatchEndReason = 'completed' | 'player_disconnected';

export type InteractAction =
  | 'activate_special'
  | 'service_command'
  | 'pantry_order'
  | 'kitchen_command'
  | 'cook'
  | 'plate'
  | 'deliver'
  | 'restock'
  | 'seat'
  | 'clear_table'
  | 'repair'
  | 'handle_complaint'
  | 'pickup'
  | 'drop_carry';

export type DishCategory = 'entree' | 'side' | 'drink' | 'dessert' | 'snack';

export type Station = 'prep' | 'grill' | 'oven' | 'plating';

export declare const CLIENT_MESSAGE_TYPES: readonly ClientMessageType[];
export declare const SERVER_MESSAGE_TYPES: readonly ServerMessageType[];
export declare const IMPLEMENTED_CLIENT_MESSAGE_TYPES: readonly ClientMessageType[];
export declare const ERROR_CODES: readonly ErrorCode[];
export declare const MATCH_PHASES: readonly MatchPhase[];
export declare const MATCH_END_REASONS: readonly MatchEndReason[];
export declare const EVENT_STATES: readonly EventState[];
export declare const INTERACT_ACTIONS: readonly InteractAction[];
export declare const DISH_CATEGORIES: readonly DishCategory[];
export declare const STATIONS: readonly Station[];
export declare const MENU_MAIN_SLOTS: number;
export declare const MENU_ADDON_SLOTS: number;

// --- client -> server ---------------------------------------------------------------------

/** Create a room (no `roomId`) or join an existing one. PRD §12 "Room flow" step 1. */
export interface JoinRoomMessage {
  type: 'join_room';
  roomId?: string;
  /**
   * Reconnect token. A client that dropped mid-match sends the `playerId` it was given by
   * its previous `joined` message to reclaim its seat within `RECONNECT_GRACE_MS`. The MVP
   * has no authentication, so this is trust-on-first-use and MUST become a signed session
   * token before any public deployment — see the STORY-003 design note. The server only
   * honours it when that player is currently DISCONNECTED and still inside its grace window.
   */
  playerId?: string;
  /**
   * STORY-024. Required for a FRESH (non-reconnect) join against a private-invite room —
   * `match-manager.js#createRoom({mode: 'private_human'})`'s own `inviteToken`. A `join_room`
   * that supplies a matching `playerId` for an already-held, disconnected seat bypasses this
   * (see `validateInvite`'s own header): they already hold the seat, the invite got them in
   * once already. Rooms created without `mode: 'private_human'` (the pre-existing dev/bot
   * flow) have no `inviteToken` at all, so this field is simply ignored for them.
   */
  inviteToken?: string;
}

/**
 * Ready-up. PRD §5 "Lobby" (ready up), §12 room-flow step 7 ("once both players are ready
 * or timer expires") and §18 setup UI ("opponent-ready status"). Readiness is public — it is
 * the one thing about the opponent's setup that §18 says to show.
 */
export interface PlayerReadyMessage {
  type: 'player_ready';
  /** Defaults to true when omitted; `false` un-readies during `lobby` or `setup`. */
  ready?: boolean;
}

/** PRD §12 client-to-server example 1. Intent only — the server integrates and clamps. */
export interface PlayerInputMessage {
  type: 'player_input';
  sequence: number;
  move: { x: number; z: number; sprint: boolean };
  facing: number;
}

/** PRD §12 client-to-server example 2. */
export interface InteractMessage {
  type: 'interact';
  sequence: number;
  targetId: string;
  action: InteractAction;
}

/** PRD §12 client-to-server example 3. `upgradeId` is an id in shared/game-data/upgrades.json. */
export interface PurchaseUpgradeMessage {
  type: 'purchase_upgrade';
  sequence: number;
  upgradeId: string;
}

/** One priced menu slot in `setup_submit`. `dishId` is an id in shared/game-data/dishes.json. */
export interface MenuSelection {
  dishId: string;
  price: number;
}

/**
 * PRD §12 client-to-server example 4. Note it carries no `sequence` in the PRD example — it is
 * a one-shot phase submission, not a per-tick intent. PRD §7 "Menu constraints": `menu` holds
 * MENU_MAIN_SLOTS mains and `addons` holds up to MENU_ADDON_SLOTS drinks/desserts/sides.
 */
export interface SetupSubmitMessage {
  type: 'setup_submit';
  menu: MenuSelection[];
  addons: MenuSelection[];
  startingUpgradeId?: string | null;
  staffAssignments: Record<string, string>;

  // --- STORY-009 additions ----------------------------------------------------------------
  // PRD §7 lists seven things the player configures during setup; §12's example shows four of
  // them. These carry the rest. All three are OPTIONAL, so the §12 example remains a valid
  // `setup_submit` byte for byte — design Decision 7's "widen, never rename".

  /** PRD §7 item 3, "Starting inventory allocation": units keyed by ingredient id. */
  startingInventory?: Record<string, number>;
  /** PRD §7 item 7, "Optional restaurant policy/perk": an id in policies.json, or null. */
  policyId?: string | null;
  /** Required only by a policy whose `requiresMenuDish` is true (House Special). */
  policyDishId?: string | null;
}

export type ClientMessage =
  | JoinRoomMessage
  | PlayerInputMessage
  | PlayerReadyMessage
  | InteractMessage
  | PurchaseUpgradeMessage
  | SetupSubmitMessage;

// --- server -> client ---------------------------------------------------------------------

/** Sent once on a successful `join_room`, including a successful reconnect. */
export interface JoinedMessage {
  type: 'joined';
  roomId: string;
  playerId: string;
  seed: string;
  layoutId: string;
  /** PRD §12 room-flow step 4: the market is selected from the seed at match creation. */
  marketId: string;
  phasePreset: PhasePreset;
  /** True when this `joined` reclaimed an existing seat rather than taking a new one. */
  reconnected: boolean;
}

/**
 * The PUBLIC half of the selected market, PRD §12 room-flow step 5: "Both clients receive
 * identical public market data." Both players get byte-identical values.
 *
 * `eventPool` is deliberately absent. It is the draw pile STORY-011's seeded event deck
 * reads from, and publishing it would hand both players the match's event timeline before
 * the first customer arrives.
 */
export interface PublicMarket {
  id: string;
  name: string;
  daypart: string;
  description: string;
  /** PRD §7 "Nearby business/event anchors" — briefing prose, read by no system. */
  anchors: string[];
  segmentWeights: Record<string, number>;
  priceSensitivity: number;
  baseFootTrafficPerMinute: number;
  preferredTags: string[];
}

/**
 * The viewer's own private slice of the snapshot. This is the privacy boundary: PRD §18
 * forbids revealing the opponent's exact menu or prices during setup, so anything a player
 * alone may see goes here and nowhere else. STORY-009's setup submission belongs in here.
 */
export interface SnapshotViewer {
  playerId: string;
  /**
   * STORY-039. Which restaurant THIS viewer acts on — identical to `playerId` for a
   * competitive match, the shared co-op restaurant id for either co-op seat. The client reads
   * THIS, not `playerId`, to find its own entry in `restaurants[]`/`frontDoor`/
   * `serviceStation` — see `match.js#toSnapshot`'s own comment.
   */
  restaurantId: string | null;
  ready: boolean;
  /**
   * STORY-009. The viewer's own accepted setup submission, or null before they submit. This
   * is the field PRD §18's "do not reveal the opponent's exact menu or prices" is about: it
   * exists ONLY here, and `players[]` carries nothing that could reconstruct it.
   */
  setup: AcceptedSetup | null;
  /**
   * STORY-012. Starting cash plus revenue earned so far, minus every upgrade bought — the
   * live spendable balance a `purchase_upgrade` debits. Null until the upgrade system exists
   * (before `service`). Private for the same reason `setup` is: it is derived from the
   * viewer's own menu/pricing choices.
   */
  cash: number | null;
  /**
   * STORY-015. PRD §18 "Revenue and available cash" — the other half `cash` alone does not
   * carry. Private for the same reason `cash` is (Decision 16): `restaurants[]` is the one
   * array both players receive identically, and a rival's revenue is no more public than their
   * cash on hand. Null before `service` (before `match.kitchen` exists), same as `cash`.
   */
  revenue: number | null;
  /**
   * STORY-012. Upgrade ids this restaurant owns, including any `startingUpgradeId` chosen at
   * setup. Private, unlike the public `carryCapacity` it helps produce — which SPECIFIC
   * upgrades a player owns is competitive information the same way their menu is.
   */
  purchasedUpgradeIds: string[];
  /** STORY-033. The viewer's private stockroom board and supplier quotes. */
  pantry: PantrySnapshot | null;
  /** STORY-036. Private kitchen-command state, including exact menu availability. */
  kitchenCommand: {
    activeFocusId: string;
    cooldownForMs: number;
    selectionsByFocus: Record<string, number>;
    stationQueues: Array<{ station: Station; queued: number }>;
    oldestReadyFoodMs: number;
    shortages: Array<{ station: Station; ingredientId: string; blockedTickets: number; restocking: boolean; exhausted: boolean }>;
    menuAvailability: Array<{ dishId: string; available: boolean }>;
    activeEventIds: string[];
    activeSpecialId: string | null;
    atRiskGuests: number;
    recommendation: { focusId: string; reason: string };
  } | null;
  /** STORY-037. Compact private management state plus the five authoritative constraints. */
  managerLedger: ManagerLedgerSnapshot | null;
  /**
   * STORY-043 "Kitchen order queue board". This restaurant's own outstanding tickets, every
   * station, already ranked by `worker-system.js#compareTickets` (PRD §17 rules 2/3) — see
   * `KitchenQueueBoardEntry`'s own comment. Private for the same reason `kitchenCommand` is: it
   * is exact kitchen-internal state (PRD §18/Decision 16 never reveals a rival's). `[]`, not
   * `null`, before `match.kitchen` exists — "nothing queued" and "kitchen not attached yet" read
   * identically to a board with nothing to show either way.
   */
  kitchenQueueBoard: KitchenQueueBoardEntry[];
  /**
   * STORY-052 "Pre-reveal teaser". This viewer's own already-computed `MatchResult` slice of
   * `match.finalResults.results`, published as soon as `scoring-system.js#onPhaseChange`
   * populates it — the very first `results`-phase snapshot, well before `match_complete`
   * arrives at the end of the results-phase timer. Never the rival's own result and never any
   * of `match.finalResults`'s match-wide fields (`winnerPlayerId`, `decidingSegment`,
   * `turningPoints`) — those would leak the outcome or the rival's figures early, breaking PRD
   * §18. Null before `results`, and also null on a disconnect-triggered end (`onPhaseChange`
   * never fires for that path — see match.js's `#endMatch`), where `match_complete` follows
   * immediately anyway.
   */
  resultsPreview: MatchResult | null;
}

export interface ManagerLedgerSnapshot {
  chips: {
    frontDoor: { activeSpecialId: string | null; activeForMs: number; activeCost: number };
    service: { priorityId: string; activeContracts: number; arrivingContracts: number; payrollBurn: number; laborExpenses: number };
    kitchen: { activeFocusId: string };
    pantry: { risk: 'STOCKED' | 'WATCH' | 'AT RISK' | 'BLOCKING'; inboundDeliveries: number };
  };
  dominantConstraint: ManagerConstraintId | null;
  constraints: ManagerConstraintSnapshot[];
}

export interface ManagerLedgerResult {
  dominantConstraint: ManagerConstraintId | null;
  constraints: Array<{
    id: ManagerConstraintId; observedMs: number; limitingMs: number; peakScore: number; evidence: string;
  }>;
  specials: Array<{
    specialId: string; activations: number; spend: number; observedDecisions: number;
    observedConversions: number; observedConversionRate: number | null; deliveredOrders: number;
    observedRevenue: number; averageCheck: number | null; averageSatisfaction: number | null;
    peakQueue: number;
  }>;
  labor: {
    contractsHired: number; laborExpenses: number; hireFees: number; wagesPaid: number;
    taskCompletions: number; taskCompletionsByKind: Record<string, number>;
  };
  restocking: { expense: number; marketPremiumPaid: number; ordersPlaced: number; shortageDurationMs: number };
  kitchen: {
    finalFocusId: string; focusChanges: number; selectionsByFocus: Record<string, number>;
    recommendationMismatchMs: number;
  };
  insights: Array<{ category: ManagerConstraintId | 'specials' | 'labor'; observation: string; recommendation: string }>;
}

export interface PantryQuote {
  productId: string; name: string; description: string; units: number; cost: number;
  unitCost: number; deliveryMs: number; priceDirection: 'DEAL' | 'MARKET' | 'EXPENSIVE';
  explanation: string; available: boolean; unavailableReason: string | null;
}
export interface PantryIngredientSnapshot {
  ingredientId: string; name: string; count: number; incomingUnits: number;
  risk: 'STOCKED' | 'WATCH' | 'AT RISK' | 'BLOCKING'; affectedDishIds: string[];
  blockedTickets: number; ordersRemaining: number; priceDirection: 'DEAL' | 'MARKET' | 'EXPENSIVE';
  explanation: string; quotes: PantryQuote[];
}
export interface PantryDeliverySnapshot {
  orderId: string; ingredientId: string; ingredientName: string; productId: string;
  productName: string; units: number; arrivesInMs: number;
  totalMs: number;
}
export interface PantrySnapshot {
  overallRisk: 'STOCKED' | 'WATCH' | 'AT RISK' | 'BLOCKING';
  ingredients: PantryIngredientSnapshot[]; deliveries: PantryDeliverySnapshot[];
}

/** One entry of the snapshot's `events[]`. PRD §12 server-to-client example 1. */
export interface SnapshotEventEntry {
  eventId: string;
  state: EventState;
  startsInMs?: number;
  endsInMs?: number;
}

/**
 * STORY-025. One `room.bots` entry (`bot-controller.js#attachBot`), as merged into the wire
 * snapshot by `match-manager.js#buildSnapshot` ONLY for a `mode: 'solo_bot'` room — see that
 * function's own header for why this cannot come from `Match#toSnapshot` itself, and for why
 * the gate matters (a bare `POST /dev/match` bot room must never carry this, per STORY-017
 * AC1). Public and identical per viewer on the rooms it does appear for, same as every other
 * top-level `MatchSnapshotMessage` field: which seat is a bot, and what profile, is not
 * privileged information the way an opponent's menu/setup is.
 */
export interface BotSnapshotEntry {
  playerId: string;
  /** A `BOT_DIFFICULTIES` member (`shared/constants/tuning.js`) — the client's own
   * `client/src/ui/bot-profiles.ts` maps this to a display label ("Balanced", "Practice", ...)
   * rather than the raw id ever reaching a player-facing string directly. */
  difficulty: string;
}

/**
 * PRD §12 server-to-client example 1. Broadcast at BROADCAST_HZ, and BUILT PER VIEWER — two
 * players in one match receive two different objects, identical except for `you`.
 *
 * `timeRemainingMs` is null only in `lobby`, which has no deadline. Within any other phase it
 * decreases monotonically and resets at the transition. The client renders these two fields;
 * it must never run a phase clock of its own (Milestone 0 Decision 2).
 */
export interface MatchSnapshotMessage {
  type: 'match_snapshot';
  serverTime: number;
  matchPhase: MatchPhase;
  timeRemainingMs: number | null;
  /** STORY-040. `Match#sharedRestaurant` — public and identical for both co-op seats. See
   * `match.js#toSnapshot`'s own comment on why this is not under `you`. */
  sharedRestaurant: boolean;
  /** The §12 step-5 public market data. Null during `lobby`, set from `market_reveal` on. */
  market: PublicMarket | null;
  /** The viewer's own private slice — see SnapshotViewer. */
  you: SnapshotViewer | null;
  events: SnapshotEventEntry[];
  /** PRD §7 "Initial event forecast, if any" — see SnapshotEventForecastEntry. */
  eventForecast: SnapshotEventForecastEntry[];
  restaurants: RestaurantSnapshot[];
  customers: CustomerSnapshot[];
  orders: OrderSnapshot[];
  players: PlayerSnapshot[];
  /** STORY-025. Present (and non-empty for an attached bot) ONLY for a `mode: 'solo_bot'`
   * room — absent from every `'dev'`/`'private_human'` snapshot, unchanged from before this
   * story. See `BotSnapshotEntry`. */
  bots?: BotSnapshotEntry[];
}

/** PRD §12 server-to-client example 2. `startsInMs` is 0 when the event activates immediately. */
export interface EventAnnounceMessage {
  type: 'event_announce';
  eventId: string;
  title: string;
  description: string;
  startsInMs: number;
  durationMs: number;
}

/**
 * Per-player final scoring, PRD §11 "Recommended score composition" and its "End-of-match
 * results" field list. The original 6 fields below predate STORY-013's full payload and are
 * never removed (Decision 7) — everything after them is that story's addition, one JSDoc tag
 * per §11 results bullet it satisfies. "Key turning points" is the one §11 results bullet with
 * no field here: it is narrative text, explicitly out of scope for STORY-013 (see
 * scoring-system.js's header) and, if ever built, STORY-014's job.
 */
export interface MatchResult {
  /** STORY-033 supplier purchases and service-time stock operations. */
  inventoryExpenses: number;
  marketPremiumPaid: number;
  stockOrdersPlaced: number;
  shortageDurationMs: number;
  /** STORY-037. Recorded management decisions, costs, constraint diagnosis and observations. */
  managerLedger: ManagerLedgerResult;
  score: number;
  revenue: number;
  guestsServed: number;
  averageSatisfaction: number;
  reputation: number;
  abandonedParties: number;

  /** §11 "Expenses": ingredient allocation cost plus every upgrade's cost (the starting one
   * chosen at setup, and every one bought during service). */
  expenses: number;
  /** STORY-034. Temporary-staff hire fees and recurring wages included in expenses. */
  laborExpenses: number;
  /** STORY-037. Front-door promotion spend included in expenses. */
  specialExpenses: number;
  /** §11 "Net profit" (the same number the score formula calls "net revenue" — one field
   * doubling as both names): revenue minus `expenses`. */
  netProfit: number;
  /** §11 "Customers lost to rival": parties this restaurant's own district funnel recorded as
   * CHOOSE_RIVAL — the party evaluated this restaurant and picked the opponent instead. */
  customersLostToRival: number;
  /** §11 "Average wait time": arrival to being seated, averaged over every seated party. */
  averageWaitTimeMs: number;
  /** §11 "Best-selling dishes": top dishes by units sold, at this restaurant, descending. */
  bestSellingDishes: Array<{ dishId: string; count: number; revenue: number }>;
  /** §11 "Highest-margin dishes": top dishes by (revenue per unit − catalogue `baseCost`),
   * descending. */
  highestMarginDishes: Array<{ dishId: string; marginPerUnit: number }>;
  /** §11 "Event performance": `eventObjectiveFraction` is the 0-1 share of this restaurant's
   * delivered orders placed while at least one event was active (the score formula's own Event
   * Objective Bonus input); `criticFailures` is the count of `food_critic_spotted` windows
   * during which something already-countable went wrong (a cancelled order, a party crossing
   * into severe dissatisfaction) — see scoring-system.js's `countCriticFailures` for the exact
   * definition and why it is structural rather than a dedicated critic-party mechanic. */
  eventPerformance: { eventObjectiveFraction: number; criticFailures: number };
  /** §11 "Upgrades purchased": every upgrade id this restaurant owns by match end, including
   * its starting upgrade chosen at setup. */
  upgradesPurchased: string[];
  /** §11 "Customer-segment breakdown": party count per segment id this restaurant actually
   * served (not merely attracted or lost). */
  customerSegmentBreakdown: Record<string, number>;

  // --- STORY-014 additions (results screen: score breakdown + narrative layer) ------------------
  // PRD §11 results screen: "so a player can see which term lost them the match" and the
  // narrative-sentence requirements. Every field below is server-computed, once, at `results` —
  // see server/src/game/scoring/narrative.js and scoring-system.js's own header comment.

  /** The composite score's own component contributions before the penalty subtraction — the
   * same `computeCompositeScore` breakdown `scoring-system.js` already computed internally,
   * simply no longer discarded. Each is already on the points scale (`SCORE_POINTS_SCALE`),
   * so they sum with `penaltyBreakdown`'s total to exactly `score`. */
  scoreBreakdown: {
    revenueScore: number;
    guestsServedScore: number;
    satisfactionScore: number;
    reputationBonus: number;
    eventObjectiveBonus: number;
    penaltyScore: number;
  };
  /** `penaltyScore`'s own five components — which specific penalty term did the damage, not
   * just the summed total `scoreBreakdown.penaltyScore` (== `computePenaltyPoints`) carries. */
  penaltyBreakdown: {
    abandonmentPoints: number;
    cancelledOrderPoints: number;
    severeDissatisfactionPoints: number;
    wastePoints: number;
    criticFailurePoints: number;
  };
  /** The narrative "player's best-performing dish by fulfillment time": the dish this
   * restaurant sold at least one of, with the lowest average time from order placement to that
   * dish coming off the line. Null when nothing sold. */
  bestDish: { dishId: string; count: number; avgFulfillmentMs: number } | null;
  /** The narrative "largest single loss cause, tied to the event that caused it" — read off
   * the OTHER player's `results[rivalId].largestLossCause` for "your rival lost N customers to
   * X [after the Y event]" sentences. `eventId` is null when no single event covered a majority
   * of that reason's occurrences (Notable Pattern 9: never fabricate a cause). Null when this
   * restaurant never lost a party to a reasoned district decision. */
  largestLossCause: { reason: string; count: number; eventId: string | null } | null;
}

/**
 * PRD §12 server-to-client example 3. `winnerPlayerId` is null on a draw, and also null when
 * the match ended before `scoring-system.js` ever ran (a disconnect-triggered end skips the
 * `results` phase transition entirely — see match.js's `#endMatch`). `results` follows the §12
 * example literally: one key per player in the match, each a full `MatchResult` once scored, or
 * an empty object in that early-end case.
 */
export interface MatchCompleteMessage {
  type: 'match_complete';
  winnerPlayerId: string | null;
  results: Record<string, MatchResult | Record<string, never>>;
  /** STORY-003 addition — see MatchEndReason. */
  reason: MatchEndReason;
  /** Set only when `reason` is `player_disconnected`. */
  disconnectedPlayerId?: string;

  // --- STORY-014 additions: match-wide narrative fields ------------------------------------------
  // Comparative between the two restaurants, unlike everything in `MatchResult` (which is each
  // player's own), so these sit beside `winnerPlayerId` rather than inside `results[playerId]` —
  // same reasoning as `winnerPlayerId` itself. All three are null/empty (never a guess) on a
  // match that never reached scoring — see match.js's own comment on this method — and on any
  // match with other than exactly 2 restaurants, the same "no rival, nothing to compare" case
  // `winnerPlayerId` already treats as null rather than a crash.

  /** The narrative "segment that decided the match" — PRD §11's own example ("You won the lunch
   * rush by serving 18 more office-worker parties"): the segment id with the largest served-
   * count difference between the two restaurants, and which one led it. Null when nobody was
   * served, or every segment tied exactly. */
  decidingSegment: { segmentId: string; leaderRestaurantId: string; servedDifferential: number } | null;
  /** PRD §11 "Key turning points": up to `RESULTS_TURNING_POINTS_MAX` largest swings in
   * cumulative party-acquisition margin between the two restaurants, ranked by `swing`
   * descending. `eventId`/`phase` name what was happening when the swing occurred; either may
   * be null (an event-less stretch of `service` still has a phase; a match whose event system
   * never anchored has neither). */
  turningPoints: Array<{
    atMs: number;
    eventId: string | null;
    phase: MatchPhase | null;
    leaderRestaurantId: string;
    swing: number;
  }>;
  /** PRD §11 "state tie-break resolution explicitly rather than silently". Set only when the
   * two composite scores were exactly equal AND the §11 tie-break chain (not a genuine draw)
   * decided the winner; null the rest of the time, including every ordinary match where the
   * scores simply differed. */
  tieBreakDecided: {
    criterion: 'averageSatisfaction' | 'guestsServed' | 'netRevenue' | 'abandonedParties';
    winnerPlayerId: string;
  } | null;
}

export interface ErrorMessage {
  type: 'error';
  error: ErrorCode;
  receivedType?: string;
  detail?: string;
  /** Set when `error` is `setup_rejected`: one of SETUP_REJECTION_REASONS in setup-rules. */
  reason?: string;
}

export type ServerMessage =
  | JoinedMessage
  | MatchSnapshotMessage
  | EventAnnounceMessage
  | MatchCompleteMessage
  | ErrorMessage;

/**
 * One entry of the snapshot's `eventForecast[]` — PRD §7's "Initial event forecast, if any",
 * built by STORY-011 from the match's seeded timeline and public from `market_reveal` on.
 *
 * Carries no time at which anything fires, deliberately. PRD §9 lists "event forecasting in
 * setup" as a reason to seed the deck, so the player is meant to plan for what this district
 * can do; handing over the schedule would make setup a lookup instead of a bet. The array is
 * ordered by `eventId`, NOT by firing order, so the ordering leaks nothing either.
 */
export interface SnapshotEventForecastEntry {
  eventId: string;
  title: string;
  description: string;
  /** How long the event lasts once it fires. Not when it fires. */
  durationMs: number;
  /** How many times it appears in this match's timeline. */
  occurrences: number;
  /** True when the event has a non-zero `warningMs` and will therefore be teased in advance. */
  telegraphed: boolean;
}
