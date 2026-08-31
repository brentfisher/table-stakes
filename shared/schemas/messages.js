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

// STORY-003 added ONE type, `player_ready`, and its handler in the same commit. PRD §12's
// four client-to-server examples carry no readiness signal, but §5 "Lobby" (ready up), §12
// room-flow step 7 ("once both players are ready or timer expires") and §18 setup UI
// ("opponent-ready status") all require one, and it is not `setup_submit` — that message
// carries a menu whose validation is STORY-009's, and half-implementing it to steal its
// readiness bit is exactly the silent inaction Decision 7 forbids.

/** Every message a client may send. An unlisted `type` is rejected as `unknown_type`. */
export const CLIENT_MESSAGE_TYPES = Object.freeze([
  'join_room',
  'player_input',
  'player_ready',
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
export const IMPLEMENTED_CLIENT_MESSAGE_TYPES = Object.freeze([
  'join_room',
  'player_input',
  'player_ready',
  // STORY-009 added `setup_submit` in the same commit as its handler and its validator, per
  // the note above. Appended, never re-sorted: three stories fan out from the same commit and
  // an append-only diff to this list rebases cleanly.
  'setup_submit',
  // STORY-008 added `interact` in the same commit as its handler
  // (`message-router.js#handleInteract`) and its authority check
  // (`server/src/game/validators/action-validator.js`). `purchase_upgrade` stays OUT of this
  // list: STORY-008 defines the terminal's contextual prompt but not the upgrade catalogue or
  // its effects, which are STORY-012's — adding the type here with no catalogue behind it would
  // be exactly the silent inaction Decision 7 forbids, and `smoke-milestone0.mjs` still pins
  // `purchase_upgrade` to `not_implemented`.
  'interact',
]);

/**
 * Error codes the server may return in `{type: 'error', error: <code>}`. STORY-001's router
 * emits the first five; `invalid_payload` is what validation.js returns for a well-typed
 * message with a malformed body. STORY-003 added `match_full`, because a 1v1 match that
 * silently seats a third socket is worse than one that says no.
 */
export const ERROR_CODES = Object.freeze([
  'invalid_json',
  'missing_type',
  'unknown_type',
  'not_implemented',
  'room_not_found',
  'invalid_payload',
  'match_full',
  // STORY-009. A setup submission can be perfectly well FORMED and still illegal — an
  // out-of-range price, a dish this kitchen cannot cook, an allocation the player cannot
  // afford. Decision 11 draws the line between shape and authority, so those must not come
  // back as `invalid_payload`. The accompanying message carries `reason`, one of
  // SETUP_REJECTION_REASONS in setup-rules.js.
  'setup_rejected',
  // STORY-008. Same split as `setup_rejected`, one level down: an `interact` can be perfectly
  // well FORMED (a real action, a non-empty targetId) and still illegal — out of range, aimed
  // at a target that does not exist, or wrong for that target's current state. The accompanying
  // message carries `reason`, a short machine-readable string named in
  // `action-validator.js` (e.g. `out_of_range`, `no_such_target`, `nothing_queued`, `busy`).
  'interact_rejected',
]);

/**
 * Match phases, PRD §5 "Match structure", IN ORDER. Keys match PHASE_DURATIONS_MS in
 * tuning.js, and the order here IS the phase machine's order — `match.js` advances by
 * stepping this list, so a phase inserted here is a phase the machine runs.
 */
export const MATCH_PHASES = Object.freeze([
  'lobby',
  'market_reveal',
  'setup',
  'service',
  'final_rush',
  'results',
]);

/**
 * Why a match ended, carried on `match_complete.reason`. PRD §12's envelope has no such
 * field; STORY-003 adds it because "exceeding the reconnect grace ends the match cleanly
 * with a stated reason" is unimplementable without somewhere to state the reason.
 */
export const MATCH_END_REASONS = Object.freeze(['completed', 'player_disconnected']);

/**
 * Lifecycle of an event as it appears in a snapshot's `events[]`. PRD §12's example carries
 * `"state": "warning"`; PRD §9's announcement flow gives the other two.
 */
export const EVENT_STATES = Object.freeze(['warning', 'active', 'ended']);

/**
 * Legal `action` values on an `interact` message. PRD §8 "Interactions"; the §12 example uses
 * `"action": "cook"`. A story that adds a new contextual action widens this list.
 *
 * STORY-008 widened it by two. PRD §8 lists "carry a plate to a table" as one interaction, but
 * the owner is a real controllable body, not an abstracted worker on a timed route (§17's
 * `deliver_order`) — the carry has to be two touches, one at the service pass and one at the
 * destination table, or the walk between them is not gameplay. `deliver` is the second touch
 * (it already existed for that); `pickup` is the first, new one. `drop_carry` is `F`'s §8
 * "secondary action": put down whatever the owner is carrying without delivering it, freeing
 * the carry slot and returning the plate to the pass rather than losing it — the one
 * self-targeted action, sent with `targetId: "self"` since `validateInteract` requires a
 * non-empty string.
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
  'pickup',
  'drop_carry',
]);

/** Dish categories, PRD §7 "Menu configuration". */
export const DISH_CATEGORIES = Object.freeze(['entree', 'side', 'drink', 'dessert', 'snack']);

/** Kitchen stations the §14 layout provides. `stationSteps[].station` must be one of these. */
export const STATIONS = Object.freeze(['prep', 'grill', 'oven', 'plating']);

/** PRD §7 "Menu constraints": three mains plus up to two add-ons. */
export const MENU_MAIN_SLOTS = 3;
export const MENU_ADDON_SLOTS = 2;
