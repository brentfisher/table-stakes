// Type declarations for messages.js. PRD §12 "WebSocket messages" — the field names below are
// taken verbatim from the §12 JSON examples. Changing one is a wire-breaking change.

import type {
  CustomerSnapshot,
  OrderSnapshot,
  PlayerSnapshot,
  RestaurantSnapshot,
} from './game-state';

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
  | 'invalid_payload';

export type MatchPhase =
  | 'lobby'
  | 'market_reveal'
  | 'setup'
  | 'service'
  | 'final_rush'
  | 'results';

export type EventState = 'warning' | 'active' | 'ended';

export type InteractAction =
  | 'cook'
  | 'plate'
  | 'deliver'
  | 'restock'
  | 'seat'
  | 'clear_table'
  | 'repair'
  | 'handle_complaint';

export type DishCategory = 'entree' | 'side' | 'drink' | 'dessert' | 'snack';

export type Station = 'prep' | 'grill' | 'oven' | 'plating';

export declare const CLIENT_MESSAGE_TYPES: readonly ClientMessageType[];
export declare const SERVER_MESSAGE_TYPES: readonly ServerMessageType[];
export declare const IMPLEMENTED_CLIENT_MESSAGE_TYPES: readonly ClientMessageType[];
export declare const ERROR_CODES: readonly ErrorCode[];
export declare const MATCH_PHASES: readonly MatchPhase[];
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
}

export type ClientMessage =
  | JoinRoomMessage
  | PlayerInputMessage
  | InteractMessage
  | PurchaseUpgradeMessage
  | SetupSubmitMessage;

// --- server -> client ---------------------------------------------------------------------

/** Sent once on a successful `join_room`. */
export interface JoinedMessage {
  type: 'joined';
  roomId: string;
  playerId: string;
  seed: string;
  layoutId: string;
}

/** One entry of the snapshot's `events[]`. PRD §12 server-to-client example 1. */
export interface SnapshotEventEntry {
  eventId: string;
  state: EventState;
  startsInMs?: number;
  endsInMs?: number;
}

/** PRD §12 server-to-client example 1. Broadcast at BROADCAST_HZ. */
export interface MatchSnapshotMessage {
  type: 'match_snapshot';
  serverTime: number;
  matchPhase: MatchPhase;
  timeRemainingMs: number | null;
  events: SnapshotEventEntry[];
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

/** PRD §12 server-to-client example 3. `winnerPlayerId` is null on a draw. */
export interface MatchCompleteMessage {
  type: 'match_complete';
  winnerPlayerId: string | null;
  results: Record<string, MatchResult>;
}

export interface ErrorMessage {
  type: 'error';
  error: ErrorCode;
  receivedType?: string;
  detail?: string;
}

export type ServerMessage =
  | JoinedMessage
  | MatchSnapshotMessage
  | EventAnnounceMessage
  | MatchCompleteMessage
  | ErrorMessage;
