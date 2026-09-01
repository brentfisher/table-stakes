// The authority on whether an `interact` is legal. PRD §8 "Interactions", §12 "Server
// authority" ("Player interaction validation" is server-owned), Decision 2's
// `server/src/game/validators/` convention (see `setup-validator.js`, the first inhabitant).
//
// THE POINT OF THIS FILE: the client's `InteractionController` decides what prompt to SHOW —
// it resolves the nearest valid-looking target and renders "E — Cook Smash Burger". None of
// that counts. A browser can send any `{targetId, action}` pair `shared/schemas/validation.js`
// will accept (a well-formed string and a member of `INTERACT_ACTIONS` is all that checks). This
// module re-derives, from the match's own facades, whether the owner is close enough, whether
// the target exists, and whether the action is legal for its CURRENT state — exactly the three
// things this story's acceptance criteria name. A rejection mutates nothing.
//
// TARGET IDS ARE WORLD ENTITY IDS, not ticket or order ids the client would have to guess. PRD
// §12's own example is `"targetId": "station_grill_1"` — a station, not a ticket. The client
// never resolves an action (Decision 2's "the client never calculates action outcomes"
// generalised to this story): it says WHERE the owner is interacting, and this file decides
// WHAT happens there, by reading the same facades `worker-system.js` already reads. `cook` and
// `plate` are the same `kitchen.startTicket()` call the cook uses for its own rule 2 — the
// difference is only which station the target names.
//
// NO TASK-COMPLETION SYSTEM. A worker's task is set now and resolved on a future tick
// (`worker-system.js`'s `worker.task`) because it acts without a human choosing the moment. The
// owner already spent real wall-clock time walking there; gating the EFFECT behind a further
// server-side delay would just read as unresponsive input. So a valid `interact` resolves its
// facade call IMMEDIATELY, and `OWNER_TASK_DURATIONS_MS[action]` — derived from the worker's own
// durations by `OWNER_TASK_SPEED_ADVANTAGE`, never a second set of numbers — is spent afterward
// as a cooldown: the next `interact` from that player is rejected `busy` until it elapses. That
// cooldown, not a route/task model, is what makes "the owner performs the same actions faster
// than a worker" a rate rather than an assertion.
//
// ARBITRATION WITH THE AI SERVER. `kitchen.readyOrders()` — the pool the AI server's §17 rule 1
// reads and the pool `pickup` reads — excludes a plate once ANY player has claimed it
// (`order.claimedBy`, set in `order-system.js`). The two never compete for the same plate
// because there is only ever one pool and claiming removes an entry from it. Restocking needs no
// equivalent: `INVENTORY_MAX_CONCURRENT_RESTOCKS` already serializes the one pantry trip slot
// regardless of who asks for it.
//
// `repair` IS DECLARED AND ALWAYS REJECTED. PRD §8 lists "Repair/unstick a station", but nothing
// in this codebase marks a station broken — `power_fluctuation`'s `stationSpeedMultipliers` is a
// duration scalar events already apply symmetrically, not a discrete failure state, and inventing
// one is out of this story's scope. It stays a legal `INTERACT_ACTIONS` member, reachable and
// shape-checked, so a later story that adds a real failure state only has to teach this file
// what a broken station looks like — it does not have to re-wire the wire protocol.

import {
  OWNER_INTERACT_RANGE,
  OWNER_TASK_DURATIONS_MS,
  OWNER_CARRY_CAPACITY,
  WORKER_RESTOCK_THRESHOLD_UNITS,
} from '../../../../shared/constants/tuning.js';
import { STATIONS } from '../../../../shared/schemas/messages.js';
import layout from '../../../../shared/game-data/restaurant-layout.json' with { type: 'json' };

const vec = ([x, y, z]) => ({ x, y, z });
const ENTITY_BY_ID = new Map(layout.entities.map((entity) => [entity.id, entity]));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Static world position for every target id this story resolves EXCEPT tables — a table's
 * position is asked of `match.floor`, the same source of truth the worker system uses, rather
 * than duplicated from the layout a second time. */
function staticTargetPosition(targetId) {
  const entity = ENTITY_BY_ID.get(targetId);
  return entity ? vec(entity.position) : null;
}

const isTableId = (id) => /^table_\d+$/.test(id);
const isStationId = (id) => id.startsWith('station_');
const stationNameOf = (id) => id.slice('station_'.length);

function fail(error, reason, detail) {
  return { ok: false, error, reason, detail };
}

/**
 * The one entry point. `match` is the room's live Match, `playerId` the socket's own id (never
 * trusted from the message body — Decision 2), `message` the already shape-checked
 * `InteractMessage`. Returns `{ok:true}` or `{ok:false, error, reason?, detail?, silent?}`;
 * `silent` marks a stale/duplicate `interact` the caller should drop without telling the client
 * anything went wrong, mirroring `Match#applyInput`'s handling of an out-of-order `sequence`.
 */
export function handleInteract(match, playerId, message) {
  if (!match.isServicePhase) {
    return fail('interact_rejected', 'wrong_phase', `interact is only accepted in service, not ${match.phase}`);
  }

  const player = match.players.get(playerId);
  if (!player) return fail('interact_rejected', 'unknown_player');

  if (typeof message.sequence === 'number' && message.sequence <= player.lastInteractSequence) {
    return { ok: false, silent: true };
  }

  if (player.pendingAction && match.elapsedMs < player.pendingAction.readyAtMs) {
    return fail('interact_rejected', 'busy', `${Math.ceil(player.pendingAction.readyAtMs - match.elapsedMs)}ms remaining`);
  }

  if (!match.kitchen || !match.floor || !match.pantry) {
    // Between the phase transition and every system's onPhaseChange running, which the loop
    // guarantees happens before any update this tick — so this is defensive, not reachable in
    // a real match, exactly like the same guard in worker-system.js.
    return fail('interact_rejected', 'not_ready');
  }

  const restaurantId = playerId; // an owner only ever acts on their own restaurant
  const { targetId, action } = message;

  const resolved = resolveAction(match, restaurantId, player, targetId, action);
  if (typeof message.sequence === 'number') player.lastInteractSequence = message.sequence;
  if (!resolved.ok) return resolved;

  player.pendingAction = { action, readyAtMs: match.elapsedMs + OWNER_TASK_DURATIONS_MS[action] };
  return { ok: true };
}

function resolveAction(match, restaurantId, player, targetId, action) {
  switch (action) {
    case 'cook':
    case 'plate':
      return resolveCookOrPlate(match, restaurantId, player, targetId, action);
    case 'pickup':
      return resolvePickup(match, restaurantId, player, targetId);
    case 'deliver':
      return resolveDeliver(match, restaurantId, player, targetId);
    case 'drop_carry':
      return resolveDropCarry(match, player);
    case 'restock':
      return resolveRestock(match, restaurantId, player, targetId);
    case 'seat':
      return resolveSeat(match, restaurantId, player, targetId);
    case 'clear_table':
      return resolveClearTable(match, restaurantId, player, targetId);
    case 'handle_complaint':
      return resolveHandleComplaint(match, restaurantId, player, targetId);
    case 'repair':
      return fail('interact_rejected', 'no_failure_state', 'no station is currently broken');
    default:
      // Unreachable: `validateInteract` already rejects any action outside INTERACT_ACTIONS.
      return fail('interact_rejected', 'unknown_action');
  }
}

function requireRange(player, position, label) {
  if (!position) return fail('interact_rejected', 'no_such_target', label);
  if (distance(player.position, position) > OWNER_INTERACT_RANGE) {
    return fail('interact_rejected', 'out_of_range', label);
  }
  return null;
}

function resolveCookOrPlate(match, restaurantId, player, targetId, action) {
  if (!isStationId(targetId)) return fail('interact_rejected', 'no_such_target', targetId);
  const station = stationNameOf(targetId);
  if (!STATIONS.includes(station)) return fail('interact_rejected', 'no_such_target', targetId);
  // `plate` names the plating station; `cook` names any of the other three. Same underlying
  // call either way — see this file's header — so the split is purely which prompt is legal
  // where, matching the AC's two separate end-to-end bullets.
  const isPlatingStation = station === 'plating';
  if (action === 'plate' && !isPlatingStation) return fail('interact_rejected', 'wrong_action_for_target', targetId);
  if (action === 'cook' && isPlatingStation) return fail('interact_rejected', 'wrong_action_for_target', targetId);

  const outOfRange = requireRange(player, staticTargetPosition(targetId), targetId);
  if (outOfRange) return outOfRange;

  const queued = match.kitchen.queuedTicketsAt(restaurantId, station);
  if (queued.length === 0) return fail('interact_rejected', 'nothing_queued', targetId);
  // Oldest first, same as the queue's own FIFO dispatch — the owner does not out-prioritize the
  // rail's own order, just skips the wait for a pair of hands to be free.
  const oldest = queued.reduce((a, b) => (b.queueAgeMs > a.queueAgeMs ? b : a));
  const result = match.kitchen.startTicket(restaurantId, oldest.ticketId);
  if (!result.ok) return fail('interact_rejected', result.reason, result.missingIngredientId ?? undefined);
  return { ok: true };
}

function resolvePickup(match, restaurantId, player, targetId) {
  if (targetId !== 'service_pass') return fail('interact_rejected', 'no_such_target', targetId);
  const outOfRange = requireRange(player, staticTargetPosition(targetId), targetId);
  if (outOfRange) return outOfRange;

  // STORY-012. `match.upgrades` is undefined before `service` first ticks (defensive, exactly
  // as `match.kitchen`/`match.floor`/`match.pantry` are read elsewhere in this file).
  const capacity = match.upgrades?.ownerCarryCapacity(restaurantId) ?? OWNER_CARRY_CAPACITY;
  if (player.carrying.length >= capacity) {
    return fail('interact_rejected', 'carry_full', `capacity ${capacity}`);
  }
  const [oldest] = match.kitchen.readyOrders(restaurantId);
  if (!oldest) return fail('interact_rejected', 'nothing_ready');
  const claim = match.kitchen.claimOrder(restaurantId, oldest.orderId, player.playerId);
  if (!claim.ok) return fail('interact_rejected', claim.reason);
  player.carrying.push({ orderId: oldest.orderId, tableId: claim.tableId });
  return { ok: true };
}

function resolveDeliver(match, restaurantId, player, targetId) {
  if (!isTableId(targetId)) return fail('interact_rejected', 'no_such_target', targetId);
  const outOfRange = requireRange(player, match.floor.tablePositionOf(restaurantId, targetId), targetId);
  if (outOfRange) return outOfRange;

  const carried = player.carrying.find((c) => c.tableId === targetId);
  if (!carried) {
    const heldFor = player.carrying.map((c) => c.tableId).join(', ') || 'nothing';
    return fail('interact_rejected', 'wrong_table', `carrying for ${heldFor}, not ${targetId}`);
  }
  const delivered = match.kitchen.deliverOrder(carried.orderId);
  if (!delivered) return fail('interact_rejected', 'not_ready');
  player.carrying = player.carrying.filter((c) => c.orderId !== carried.orderId);
  return { ok: true };
}

/** §8's secondary action (`F`). Self-targeted: `targetId` is conventionally `"self"` and never
 * resolved against the world, since `validateInteract` requires a non-empty string but this
 * action names no place. */
function resolveDropCarry(match, player) {
  const carried = player.carrying[0];
  if (!carried) return fail('interact_rejected', 'nothing_carried');
  match.kitchen.unclaimOrder(carried.orderId);
  player.carrying = player.carrying.filter((c) => c.orderId !== carried.orderId);
  return { ok: true };
}

function resolveRestock(match, restaurantId, player, targetId) {
  if (targetId !== 'pantry') return fail('interact_rejected', 'no_such_target', targetId);
  const outOfRange = requireRange(player, staticTargetPosition(targetId), targetId);
  if (outOfRange) return outOfRange;

  // The same shopping-list read as §17 cook rule 4 (`worker-system.js`'s `restockCandidates`),
  // duplicated rather than imported: both read the PUBLIC `binShortfalls()` facade, and cross-
  // system code stays out of another system's internals (Decision 15).
  const candidates = match.pantry
    .binShortfalls(restaurantId)
    .filter((b) => b.binLevel <= WORKER_RESTOCK_THRESHOLD_UNITS && b.pantryUnits > 0 && !b.restocking)
    .sort((a, b) => a.binLevel - b.binLevel);
  const [neediest] = candidates;
  if (!neediest) return fail('interact_rejected', 'nothing_to_restock');
  const result = match.pantry.requestRestock(restaurantId, neediest.station, neediest.ingredientId);
  if (!result.ok) return fail('interact_rejected', result.reason);
  return { ok: true };
}

function resolveSeat(match, restaurantId, player, targetId) {
  if (targetId !== 'host_stand') return fail('interact_rejected', 'no_such_target', targetId);
  const outOfRange = requireRange(player, staticTargetPosition(targetId), targetId);
  if (outOfRange) return outOfRange;

  const [longestWaiting] = match.floor.waitingParties(restaurantId);
  if (!longestWaiting) return fail('interact_rejected', 'no_one_waiting');
  const result = match.floor.seatParty(longestWaiting.customerId);
  if (!result.ok) return fail('interact_rejected', result.reason);
  return { ok: true };
}

function resolveClearTable(match, restaurantId, player, targetId) {
  if (!isTableId(targetId)) return fail('interact_rejected', 'no_such_target', targetId);
  const outOfRange = requireRange(player, match.floor.tablePositionOf(restaurantId, targetId), targetId);
  if (outOfRange) return outOfRange;

  const result = match.floor.clearTable(restaurantId, targetId);
  if (!result.ok) return fail('interact_rejected', result.reason);
  return { ok: true };
}

function resolveHandleComplaint(match, restaurantId, player, targetId) {
  if (!isTableId(targetId)) return fail('interact_rejected', 'no_such_target', targetId);
  const outOfRange = requireRange(player, match.floor.tablePositionOf(restaurantId, targetId), targetId);
  if (outOfRange) return outOfRange;

  const candidate = match.floor.unhappyParties(restaurantId).find((p) => p.tableId === targetId);
  if (!candidate) return fail('interact_rejected', 'not_unhappy', targetId);
  const result = match.floor.handleComplaint(candidate.customerId);
  if (!result.ok) return fail('interact_rejected', result.reason);
  return { ok: true };
}

const UPGRADE_TERMINAL_ENTITY = ENTITY_BY_ID.get('upgrade_terminal');

/**
 * The authority for `purchase_upgrade` — STORY-012. A SEPARATE top-level message from
 * `interact` (see `shared/schemas/messages.d.ts`'s `PurchaseUpgradeMessage`: `{upgradeId}`, no
 * `targetId`), so it is not routed through `resolveAction`/`INTERACT_ACTIONS` above. The
 * terminal names its OWN interaction radius in the layout (`interactionRadius`) rather than
 * reusing `OWNER_INTERACT_RANGE` — it is a fixed, single, always-known target, not a family of
 * targets a generic range constant fits.
 */
export function handlePurchaseUpgrade(match, playerId, message) {
  if (!match.isServicePhase) {
    return fail('purchase_rejected', 'wrong_phase', `purchase is only accepted in service, not ${match.phase}`);
  }

  const player = match.players.get(playerId);
  if (!player) return fail('purchase_rejected', 'unknown_player');

  if (typeof message.sequence === 'number' && message.sequence <= player.lastPurchaseSequence) {
    return { ok: false, silent: true };
  }

  if (!match.upgrades) {
    return fail('purchase_rejected', 'not_ready');
  }

  const terminalPosition = UPGRADE_TERMINAL_ENTITY ? vec(UPGRADE_TERMINAL_ENTITY.position) : null;
  if (!terminalPosition) return fail('purchase_rejected', 'no_such_target', 'upgrade_terminal');
  const radius = UPGRADE_TERMINAL_ENTITY.interactionRadius ?? OWNER_INTERACT_RANGE;
  if (distance(player.position, terminalPosition) > radius) {
    return fail('purchase_rejected', 'out_of_range', 'upgrade_terminal');
  }

  const restaurantId = playerId; // an owner only ever buys for their own restaurant
  const result = match.upgrades.purchase(restaurantId, message.upgradeId);
  if (typeof message.sequence === 'number') player.lastPurchaseSequence = message.sequence;
  if (!result.ok) return fail('purchase_rejected', result.reason, result.detail);
  return { ok: true };
}

/** Exported for `scripts/check-owner-actions.mjs`/`scripts/check-upgrades.mjs` ONLY, exactly as
 * `worker-system.js`'s `_internal` is — a way to force a specific branch deterministically. No
 * other module may import it. */
export const _internal = { staticTargetPosition, isTableId, isStationId };
