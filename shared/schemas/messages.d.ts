// Type declarations for messages.js. PRD §12 "WebSocket messages" — the field names below are
// taken verbatim from the §12 JSON examples. Changing one is a wire-breaking change.

import type {
  CustomerSnapshot,
  OrderSnapshot,
  PlayerSnapshot,
  RestaurantSnapshot,
} from './game-state';
import type { PhasePreset } from '../constants/tuning';
import type { AcceptedSetup } from './setup-rules';

// STORY-001 declared `PlayerSnapshot` here. STORY-002 moved the snapshot ENTITY shapes to
// game-state.d.ts, where the rest of them live, and re-exports them so no existing import
// path breaks — design Decision 7's "widen, never rename" applied to the type surface.
export type {
  CustomerSnapshot,
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
  | 'purchase_rejected';

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
   * STORY-012. Upgrade ids this restaurant owns, including any `startingUpgradeId` chosen at
   * setup. Private, unlike the public `carryCapacity` it helps produce — which SPECIFIC
   * upgrades a player owns is competitive information the same way their menu is.
   */
  purchasedUpgradeIds: string[];
}

/** One entry of the snapshot's `events[]`. PRD §12 server-to-client example 1. */
export interface SnapshotEventEntry {
  eventId: string;
  state: EventState;
  startsInMs?: number;
  endsInMs?: number;
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

/** Per-player final scoring, PRD §11 "Recommended score composition". */
export interface MatchResult {
  score: number;
  revenue: number;
  guestsServed: number;
  averageSatisfaction: number;
  reputation: number;
  abandonedParties: number;
}

/**
 * PRD §12 server-to-client example 3. `winnerPlayerId` is null on a draw — and until
 * STORY-013 scores a match, always null. `results` follows the §12 example literally: one
 * key per player in the match, each an empty object until STORY-013 fills it in.
 */
export interface MatchCompleteMessage {
  type: 'match_complete';
  winnerPlayerId: string | null;
  results: Record<string, MatchResult | Record<string, never>>;
  /** STORY-003 addition — see MatchEndReason. */
  reason: MatchEndReason;
  /** Set only when `reason` is `player_disconnected`. */
  disconnectedPlayerId?: string;
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
