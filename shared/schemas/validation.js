// Client-to-server message validation. PRD §12 "Networking model": the browser is not trusted,
// so every inbound message is checked for shape before any system sees it.
//
// Plain JavaScript with a sibling validation.d.ts (design Decision 4). This is the one schema
// module a TypeScript client and a plain-JavaScript server both import, which is exactly why
// it must not be authored as .ts — the server would then have to compile TypeScript.
//
// SCOPE: this validates SHAPE, not legality. Whether `upgradeId` names a real upgrade, whether
// the player can afford it, whether the target is in reach — those are authority questions and
// belong to server/src/game/validators/action-validator.js (design Decision 2). Keeping the
// two apart is what lets the client reuse this module to reject its own malformed messages
// before sending them.
//
// Error codes are the ones the router already emits (messages.js ERROR_CODES), so wiring this
// into message-router.js adds no new vocabulary.

import {
  CLIENT_MESSAGE_TYPES,
  IMPLEMENTED_CLIENT_MESSAGE_TYPES,
  INTERACT_ACTIONS,
  MENU_ADDON_SLOTS,
  MENU_MAIN_SLOTS,
} from './messages.js';

const ok = (message) => ({ ok: true, message });
const fail = (error, detail) => ({ ok: false, error, detail });

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A `sequence` is a non-negative integer counter the client increments per intent. */
function badSequence(message) {
  if (!isFiniteNumber(message.sequence)) return 'sequence must be a number';
  if (!Number.isInteger(message.sequence) || message.sequence < 0) {
    return 'sequence must be a non-negative integer';
  }
  return null;
}

/** One `{dishId, price}` slot of `setup_submit`. */
function badMenuSelection(slot, label) {
  if (!isPlainObject(slot)) return `${label} must be an object`;
  if (!isNonEmptyString(slot.dishId)) return `${label}.dishId must be a non-empty string`;
  if (!isFiniteNumber(slot.price)) return `${label}.price must be a number`;
  if (slot.price < 0) return `${label}.price must not be negative`;
  return null;
}

function validateJoinRoom(message) {
  if (message.roomId !== undefined && !isNonEmptyString(message.roomId)) {
    return fail('invalid_payload', 'roomId must be a non-empty string when present');
  }
  return ok(message);
}

/** PRD §12 client-to-server example 1. Intent only — no position, ever. */
function validatePlayerInput(message) {
  const seq = badSequence(message);
  if (seq) return fail('invalid_payload', seq);

  const move = message.move;
  if (!isPlainObject(move)) return fail('invalid_payload', 'move must be an object');
  if (!isFiniteNumber(move.x) || !isFiniteNumber(move.z)) {
    return fail('invalid_payload', 'move.x and move.z must be numbers');
  }
  if (typeof move.sprint !== 'boolean') {
    return fail('invalid_payload', 'move.sprint must be a boolean');
  }
  if (!isFiniteNumber(message.facing)) {
    return fail('invalid_payload', 'facing must be a number (radians)');
  }
  if (Object.prototype.hasOwnProperty.call(message, 'position')) {
    // A client that sends a position is either buggy or cheating; PRD §12 gives the server
    // sole authority over position. Reject rather than silently discard the field.
    return fail('invalid_payload', 'player_input must not carry a position — the server is authoritative');
  }
  return ok(message);
}

/** PRD §12 client-to-server example 2. */
function validateInteract(message) {
  const seq = badSequence(message);
  if (seq) return fail('invalid_payload', seq);
  if (!isNonEmptyString(message.targetId)) {
    return fail('invalid_payload', 'targetId must be a non-empty string');
  }
  if (!INTERACT_ACTIONS.includes(message.action)) {
    return fail('invalid_payload', `action must be one of: ${INTERACT_ACTIONS.join(', ')}`);
  }
  return ok(message);
}

/** PRD §12 client-to-server example 3. Existence and affordability are the server's call. */
function validatePurchaseUpgrade(message) {
  const seq = badSequence(message);
  if (seq) return fail('invalid_payload', seq);
  if (!isNonEmptyString(message.upgradeId)) {
    return fail('invalid_payload', 'upgradeId must be a non-empty string');
  }
  return ok(message);
}

/**
 * PRD §12 client-to-server example 4. Note it carries no `sequence` — it is a one-shot phase
 * submission. PRD §7 "Menu constraints" bounds the slot counts; whether each dishId exists and
 * each price sits in its legal band is setup-validator.js's job.
 */
function validateSetupSubmit(message) {
  if (!Array.isArray(message.menu)) return fail('invalid_payload', 'menu must be an array');
  if (message.menu.length === 0) return fail('invalid_payload', 'menu must not be empty');
  if (message.menu.length > MENU_MAIN_SLOTS) {
    return fail('invalid_payload', `menu must hold at most ${MENU_MAIN_SLOTS} main dishes`);
  }

  for (let i = 0; i < message.menu.length; i += 1) {
    const bad = badMenuSelection(message.menu[i], `menu[${i}]`);
    if (bad) return fail('invalid_payload', bad);
  }

  const addons = message.addons ?? [];
  if (!Array.isArray(addons)) return fail('invalid_payload', 'addons must be an array');
  if (addons.length > MENU_ADDON_SLOTS) {
    return fail('invalid_payload', `addons must hold at most ${MENU_ADDON_SLOTS} entries`);
  }
  for (let i = 0; i < addons.length; i += 1) {
    const bad = badMenuSelection(addons[i], `addons[${i}]`);
    if (bad) return fail('invalid_payload', bad);
  }

  const allIds = [...message.menu, ...addons].map((slot) => slot.dishId);
  if (new Set(allIds).size !== allIds.length) {
    return fail('invalid_payload', 'the same dish may not occupy two menu slots');
  }

  if (
    message.startingUpgradeId !== undefined &&
    message.startingUpgradeId !== null &&
    !isNonEmptyString(message.startingUpgradeId)
  ) {
    return fail('invalid_payload', 'startingUpgradeId must be a non-empty string or null');
  }

  if (!isPlainObject(message.staffAssignments)) {
    return fail('invalid_payload', 'staffAssignments must be an object');
  }
  for (const [workerId, post] of Object.entries(message.staffAssignments)) {
    if (!isNonEmptyString(post)) {
      return fail('invalid_payload', `staffAssignments.${workerId} must be a non-empty string`);
    }
  }
  return ok(message);
}

/** One validator per client-to-server message type, keyed by `type`. */
export const CLIENT_MESSAGE_VALIDATORS = Object.freeze({
  join_room: validateJoinRoom,
  player_input: validatePlayerInput,
  interact: validateInteract,
  purchase_upgrade: validatePurchaseUpgrade,
  setup_submit: validateSetupSubmit,
});

/**
 * The single entry point. Parses nothing — hand it an already-parsed object.
 *
 * Returns `{ok: true, message}` or `{ok: false, error, detail}` where `error` is one of
 * messages.js ERROR_CODES. Ordering matters and mirrors message-router.js:
 *   missing_type -> unknown_type -> not_implemented -> invalid_payload
 * so that a declared-but-unimplemented type is still rejected as `not_implemented`
 * (design Decision 7) rather than being reported as a payload problem.
 *
 * Pass `{requireImplemented: false}` to validate the shape of a type no handler exists for
 * yet — which is what a client-side pre-send check wants.
 */
export function validateClientMessage(message, { requireImplemented = true } = {}) {
  if (!isPlainObject(message) || typeof message.type !== 'string') {
    return fail('missing_type', 'message must be an object with a string `type`');
  }
  if (!CLIENT_MESSAGE_TYPES.includes(message.type)) {
    return fail('unknown_type', message.type);
  }
  if (requireImplemented && !IMPLEMENTED_CLIENT_MESSAGE_TYPES.includes(message.type)) {
    return fail('not_implemented', message.type);
  }
  return CLIENT_MESSAGE_VALIDATORS[message.type](message);
}
