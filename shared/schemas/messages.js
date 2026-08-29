// Wire protocol message vocabulary. PRD §12 "WebSocket messages".
//
// This module is the single declaration of what may travel over the socket. It is plain
// JavaScript with a sibling messages.d.ts (design Decision 4) because the server is a vanilla
// Express JavaScript app and must never be made to compile TypeScript. The message SHAPES
// live in messages.d.ts; the runtime CONSTANTS live here, and validation.js checks payloads
// against them.
//
// STORY-002 widened this module from STORY-001's movement-and-snapshot subset to the full MVP
// protocol vocabulary. Nothing was renamed — design Decision 7 exists precisely so that later
// stories add members rather than rewrite names.
//
// NOTE ON `IMPLEMENTED_CLIENT_MESSAGE_TYPES`: it is deliberately UNCHANGED by STORY-002.
// It means "types the server's message-router actually handles", not "types that have a
// schema". This story ships the data and the shapes, not the systems that consume them, so
// no handler was added; widening this list would send `interact`, `purchase_upgrade` and
// `setup_submit` into the router's `default:` branch and have them silently do nothing —
// the exact failure design Decision 7 forbids. The story that implements a handler adds its
// type here in the same commit. `scripts/smoke-milestone0.mjs` asserts this by sending
// `purchase_upgrade` and requiring a `not_implemented` error back.

/** Every message a client may send. An unlisted `type` is rejected as `unknown_type`. */
export const CLIENT_MESSAGE_TYPES = Object.freeze([
  'join_room',
  'player_input',
  'interact',
  'purchase_upgrade',
  'setup_submit',
]);

/** Every message the server may send. */
export const SERVER_MESSAGE_TYPES = Object.freeze([
  'joined',
  'match_snapshot',
  'event_announce',
  'match_complete',
  'error',
]);

/**
 * The subset the server's message-router has a handler for. See the note above: this grows
 * one story at a time, alongside the handler. Everything declared but not listed here is
 * answered with `{type: 'error', error: 'not_implemented'}`.
 */
export const IMPLEMENTED_CLIENT_MESSAGE_TYPES = Object.freeze(['join_room', 'player_input']);

/**
 * Error codes the server may return in `{type: 'error', error: <code>}`. STORY-001's router
 * emits the first five; `invalid_payload` is what validation.js returns for a well-typed
 * message with a malformed body.
 */
export const ERROR_CODES = Object.freeze([
  'invalid_json',
  'missing_type',
  'unknown_type',
  'not_implemented',
  'room_not_found',
  'invalid_payload',
]);

/** Match phases, PRD §5 "Match structure". Keys match PHASE_DURATIONS_MS in tuning.js. */
export const MATCH_PHASES = Object.freeze([
  'lobby',
  'market_reveal',
  'setup',
  'service',
  'final_rush',
  'results',
]);

/**
 * Lifecycle of an event as it appears in a snapshot's `events[]`. PRD §12's example carries
 * `"state": "warning"`; PRD §9's announcement flow gives the other two.
 */
export const EVENT_STATES = Object.freeze(['warning', 'active', 'ended']);

/**
 * Legal `action` values on an `interact` message. PRD §8 "Interactions"; the §12 example uses
 * `"action": "cook"`. A story that adds a new contextual action widens this list.
 */
export const INTERACT_ACTIONS = Object.freeze([
  'cook',
  'plate',
  'deliver',
  'restock',
  'seat',
  'clear_table',
  'repair',
  'handle_complaint',
]);

/** Dish categories, PRD §7 "Menu configuration". */
export const DISH_CATEGORIES = Object.freeze(['entree', 'side', 'drink', 'dessert', 'snack']);

/** Kitchen stations the §14 layout provides. `stationSteps[].station` must be one of these. */
export const STATIONS = Object.freeze(['prep', 'grill', 'oven', 'plating']);

/** PRD §7 "Menu constraints": three mains plus up to two add-ons. */
export const MENU_MAIN_SLOTS = 3;
export const MENU_ADDON_SLOTS = 2;
