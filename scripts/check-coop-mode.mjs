#!/usr/bin/env node
// Co-op match mode check — STORY-039's acceptance criteria, in process.
//
// Same style as `check-invite-lobby.mjs` (the invite/lobby half) and `check-upgrades.mjs` (the
// real-Match-plus-every-gameplay-system half): real `Match`/room objects, every system
// registered against the real simulation loop, `action-validator.js`'s own
// `handlePurchaseUpgrade` called with the exact wire shape — no socket, no client.
//
// WHAT THIS STORY ADDS, AND WHAT THIS SCRIPT PROVES:
//   1. `POST /api/rooms` accepts `mode: 'coop'` and mints the SAME invite-token/joinUrl fields
//      `mode: 'private_human'` does (`match-manager.js`'s own `isInviteFlow` — see that file's
//      comment on why co-op reuses that flow rather than a second invite system).
//   2. A co-op room's two seats resolve to ONE restaurant, not one each — `Match#restaurantIdFor`
//      is the seam every restaurant-keyed system (customers, scoring, action-validator, ...) now
//      reads instead of assuming `restaurantId === playerId`; this script proves BOTH that the
//      resolver itself collapses correctly AND that a REAL action from either seat lands on the
//      shared restaurant, not a private one.
//   3. No bot, no rival: `buildSnapshot` never attaches a `bots` array to a co-op room (that is
//      `solo_bot`-only), and the district never records a `CHOOSE_RIVAL` decision for a co-op
//      match's single-restaurant pool — see this story's own "Implementation notes" for why that
//      is the documented, deliberate behavior (the softmax's "leave" option is still live; only
//      the RIVAL comparison term has nothing to compare against).
//   4. Every pre-existing mode (dev/private_human/solo_bot) is BYTE-IDENTICAL to before this
//      story — `Match#restaurantIdFor` is the identity function unless `sharedRestaurant` is
//      explicitly set, and this script re-confirms a plain 2-player match still gets two
//      restaurants, not one.
//
// Run: node scripts/check-coop-mode.mjs

import { readFileSync } from 'node:fs';
import { Match } from '../server/src/game/match.js';
import * as matchManager from '../server/src/game/match-manager.js';
import { registerSystem, clearSystems, stepMatch } from '../server/src/game/simulation-loop.js';
import { movementSystem } from '../server/src/game/systems/movement-system.js';
import { setupSystem } from '../server/src/game/systems/setup-system.js';
import { customerSystem } from '../server/src/game/systems/customer-system.js';
import { orderSystem } from '../server/src/game/systems/order-system.js';
import { eventSystem } from '../server/src/game/systems/event-system.js';
import { inventorySystem } from '../server/src/game/systems/inventory-system.js';
import { workerSystem } from '../server/src/game/systems/worker-system.js';
import { upgradeSystem } from '../server/src/game/systems/upgrade-system.js';
import { handlePurchaseUpgrade } from '../server/src/game/validators/action-validator.js';
import { CUSTOMER_STATES } from '../shared/schemas/game-state.js';
import { RECONNECT_GRACE_MS, STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT } from '../shared/constants/tuning.js';
import { catalogue } from '../server/src/game/catalogue.js';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const realLog = console.log;
function quiet(fn) {
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = realLog;
  }
}

console.log('Co-op match mode check\n');

// --- 1. POST /api/rooms's server-side half: createRoom({mode: 'coop'}) reuses the invite flow -
{
  const room = quiet(() =>
    matchManager.createRoom({ mode: 'coop', hostDisplayName: '  Jamie  ' }),
  );
  check(
    'a coop room gets a non-guessable inviteToken/expiry/hostDisplayName exactly like private_human',
    typeof room.inviteToken === 'string' &&
      room.inviteToken.length >= 16 &&
      room.inviteExpiresAt !== null &&
      room.hostDisplayName === 'Jamie',
    `token=${room.inviteToken} host="${room.hostDisplayName}"`,
  );
  check(
    'a coop room defaults to exactly two required seats',
    room.match.requiredPlayers === 2,
    `requiredPlayers=${room.match.requiredPlayers}`,
  );
  check(
    "the room's mode is reported as 'coop', not folded into 'private_human'",
    room.mode === 'coop' && matchManager.roomStatus(room).mode === 'coop',
  );
  check(
    'the underlying Match has sharedRestaurant set — the one flag every restaurant-keyed system reads',
    room.match.sharedRestaurant === true,
  );

  const dev = quiet(() => matchManager.createRoom());
  const privateHuman = quiet(() => matchManager.createRoom({ mode: 'private_human' }));
  const soloBot = quiet(() => matchManager.createRoom({ mode: 'solo_bot' }));
  check(
    'every pre-existing mode still gets sharedRestaurant: false — nothing about them moved',
    dev.match.sharedRestaurant === false &&
      privateHuman.match.sharedRestaurant === false &&
      soloBot.match.sharedRestaurant === false,
  );
}

// --- 2. validateInvite gates a coop room exactly like private_human --------------------------
{
  const room = quiet(() => matchManager.createRoom({ mode: 'coop' }));
  const goodToken = room.inviteToken;

  check(
    'a mismatched token is refused as invite_token_mismatch',
    matchManager.validateInvite(room, { inviteToken: 'wrong-token' }).error === 'invite_token_mismatch',
  );
  check(
    'the correct token is accepted',
    matchManager.validateInvite(room, { inviteToken: goodToken }).ok === true,
  );

  room.match.join({ fallbackPlayerId: 'host' });
  room.match.join({ fallbackPlayerId: 'guest' });
  check(
    'a third fresh join against a full coop room is refused as match_full',
    matchManager.validateInvite(room, { inviteToken: goodToken }).error === 'match_full',
  );

  const reconnecting = quiet(() => matchManager.createRoom({ mode: 'coop' }));
  reconnecting.match.join({ fallbackPlayerId: 'host' });
  reconnecting.match.removePlayer('host');
  check(
    'a disconnected coop seat-holder redeeming their OWN reconnect token bypasses the invite gate',
    matchManager.validateInvite(reconnecting, {
      requestedPlayerId: 'host',
      inviteToken: 'irrelevant',
    }).ok === true,
  );
  check(
    'a coop lobby drop is HELD (holdLobbySeatsDuringGrace), same as private_human — not released instantly',
    reconnecting.match.players.size === 1 &&
      reconnecting.match.players.get('host')?.connected === false,
    `players=${[...reconnecting.match.players.keys()].join(',')}`,
  );
  reconnecting.match.advanceClock(RECONNECT_GRACE_MS + 1000);
  check(
    'once the grace window elapses, the seat frees for a fresh join — the room did not end',
    reconnecting.match.players.size === 0 && !reconnecting.match.ended,
  );
}

// --- 3. Match#restaurantIdFor: the seam every restaurant-keyed system now reads --------------
{
  const coop = new Match({ id: 'coop-resolver', seed: 'coop-resolver', requiredPlayers: 2, sharedRestaurant: true });
  coop.join({ fallbackPlayerId: 'host' });
  coop.join({ fallbackPlayerId: 'guest' });
  check(
    "both coop seats resolve to the SAME restaurant id — the first-seated player's own",
    coop.restaurantIdFor('host') === 'host' && coop.restaurantIdFor('guest') === 'host',
    `host->${coop.restaurantIdFor('host')} guest->${coop.restaurantIdFor('guest')}`,
  );

  const competitive = new Match({ id: 'competitive-resolver', seed: 'competitive-resolver', requiredPlayers: 2 });
  competitive.join({ fallbackPlayerId: 'p1' });
  competitive.join({ fallbackPlayerId: 'p2' });
  check(
    'a non-coop match keeps restaurantId === playerId for both seats — unaffected by this story',
    competitive.restaurantIdFor('p1') === 'p1' && competitive.restaurantIdFor('p2') === 'p2',
  );
}

// --- harness for the real-service-phase sections below ----------------------------------------
clearSystems();
registerSystem(movementSystem);
registerSystem(setupSystem);
registerSystem(customerSystem);
registerSystem(orderSystem);
registerSystem(eventSystem);
registerSystem(inventorySystem);
registerSystem(workerSystem);
registerSystem(upgradeSystem);

const TICK_MS = 50;
const PROBE_MAINS = [
  { dishId: 'smash_burger', price: 14 },
  { dishId: 'caesar_salad', price: 12 },
  { dishId: 'chicken_sandwich', price: 13 },
];

function submission({ mains = PROBE_MAINS, cashRemaining = 1000 } = {}) {
  return {
    menu: mains,
    addons: [],
    startingUpgradeId: null,
    staffAssignments: { cook_1: 'prep', server_1: 'dining_room' },
    startingInventory: fullPantry(),
    policyId: null,
    policyDishId: null,
    upgradeCost: 0,
    inventoryCost: 0,
    cashRemaining,
    submittedAtMs: 0,
    locked: false,
    autoFilled: false,
  };
}

function fullPantry() {
  const allocation = {};
  for (const ingredientId of Object.keys(catalogue.ingredients)) {
    allocation[ingredientId] = STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT;
  }
  return allocation;
}

function runUntilPhase(match, phase, maxSteps = 20_000) {
  quiet(() => {
    for (let i = 0; i < maxSteps && match.phase !== phase && !match.ended; i += 1) {
      stepMatch(match, TICK_MS);
    }
  });
  return match.phase === phase;
}

const LAYOUT = JSON.parse(readFileSync(new URL('../shared/game-data/restaurant-layout.json', import.meta.url)));
const ENTITY_BY_ID = new Map(LAYOUT.entities.map((e) => [e.id, e]));
function standAt(match, playerId, entityId) {
  const entity = ENTITY_BY_ID.get(entityId);
  if (!entity) throw new Error(`no layout entity ${entityId}`);
  const [x, y, z] = entity.position;
  match.players.get(playerId).position = { x, y, z };
}

let seq = 0;
function purchase(match, playerId, upgradeId) {
  seq += 1;
  return handlePurchaseUpgrade(match, playerId, { upgradeId, sequence: seq });
}

// --- 4. both coop seats land in the SAME restaurant once the match actually runs --------------
{
  const match = new Match({
    id: 'coop-service',
    seed: 'coop-service',
    phasePreset: 'prototype',
    requiredPlayers: 2,
    sharedRestaurant: true,
  });
  match.join({ fallbackPlayerId: 'host' });
  match.join({ fallbackPlayerId: 'guest' });
  match.setReady('host', true);
  match.setReady('guest', true);
  // Only the FIRST-seated player's setup becomes the shared restaurant's menu — see
  // `Match#restaurantIdFor`'s own comment. The guest's own submission is still accepted (never
  // rejected) but the shared restaurant reads the host's.
  match.players.get('host').setup = submission();
  match.players.get('guest').setup = submission({ cashRemaining: 500 });

  const reachedService = runUntilPhase(match, 'service');
  check('the coop match reaches service with both seats ready', reachedService, `phase=${match.phase}`);

  check(
    'match.restaurants has exactly ONE entry, not two — AC2',
    match.restaurants.length === 1,
    JSON.stringify(match.restaurants.map((r) => r.restaurantId)),
  );
  check(
    "the one restaurant's id is the shared restaurant id (the host's own)",
    match.restaurants[0]?.restaurantId === match.restaurantIdFor('guest'),
  );

  // Let a modest number of real ticks run so the district actually has a chance to spawn and
  // decide some parties (AC3: "still produce real, playable customer flow").
  quiet(() => {
    for (let i = 0; i < 400; i += 1) stepMatch(match, TICK_MS);
  });
  const spawned = match._customerSimState?.counts?.spawned ?? 0;
  check(
    'the district actually spawned and processed real parties against the single restaurant (not a dead simulation)',
    spawned > 0,
    `spawned=${spawned}`,
  );
  check(
    'CHOOSE_RIVAL never fires for a co-op match — there is no rival restaurant to lose a party to (documented AC3 decision)',
    (match._customerSimState?.counts?.[CUSTOMER_STATES.CHOOSE_RIVAL] ?? 0) === 0,
  );
  check(
    'match.restaurants is still exactly one entry after live ticking (no seat-filled-late second bucket)',
    match.restaurants.length === 1,
  );

  // --- 5. a REAL action from either seat lands on the shared restaurant --------------------
  standAt(match, 'host', 'upgrade_terminal');
  standAt(match, 'guest', 'upgrade_terminal');
  const hostPurchase = purchase(match, 'host', 'serving_tray_1');
  const guestPurchase = purchase(match, 'guest', 'faster_grill_1');
  check(
    "the host's purchase is accepted",
    hostPurchase.ok === true,
    JSON.stringify(hostPurchase),
  );
  check(
    "the GUEST's purchase — a different upgrade, from the second seat — is ALSO accepted",
    guestPurchase.ok === true,
    JSON.stringify(guestPurchase),
  );
  const sharedId = match.restaurantIdFor('guest');
  const owned = match.upgrades.ownedUpgrades(sharedId);
  check(
    "BOTH purchases — one from each seat — landed on the ONE shared restaurant's owned-upgrades list",
    owned.includes('serving_tray_1') && owned.includes('faster_grill_1'),
    `owned(${sharedId})=${JSON.stringify(owned)}`,
  );
  check(
    "the guest's own (never-looked-up) private bucket owns neither — proving the purchase did not silently split",
    match.upgrades.ownedUpgrades('guest').length === 0,
  );

  check(
    'buildSnapshot never attaches a bots array to a coop room — that marker is solo_bot-only (AC3: no bot opponent)',
    !('bots' in matchManager.buildSnapshot({ mode: 'coop', match, bots: [] })),
  );
}

// --- 6. regression: a plain (non-coop) 2-player match is completely unaffected ----------------
{
  const match = new Match({ id: 'competitive-service', seed: 'competitive-service', phasePreset: 'prototype', requiredPlayers: 2 });
  match.join({ fallbackPlayerId: 'p1' });
  match.join({ fallbackPlayerId: 'p2' });
  match.setReady('p1', true);
  match.setReady('p2', true);
  match.players.get('p1').setup = submission();
  match.players.get('p2').setup = submission();
  runUntilPhase(match, 'service');
  quiet(() => stepMatch(match, TICK_MS));
  check(
    'a plain competitive match still gets TWO restaurants — this story changes nothing about it',
    match.restaurants.length === 2,
    JSON.stringify(match.restaurants.map((r) => r.restaurantId)),
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
