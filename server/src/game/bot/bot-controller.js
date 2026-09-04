// The bot opponent. PRD §12's solo/development fallback, §20's MVP scope.
//
// ============================================================================================
// THE ONE RULE THIS FILE MUST NEVER BREAK
// ============================================================================================
// conventions.md Notable Pattern 1: the bot is a CLIENT from the server's point of view, not a
// privileged branch. Every single thing this file does to change match state goes through
// `#send()`, which calls `routeMessage()` — the exact function `socket-server.js` calls for a
// real browser's `ws.on('message', ...)`. `#send()` even JSON.stringify's the message and
// `routeMessage` JSON.parse's it right back, the same round trip a real socket forces, so a
// bug that only shows up in serialization cannot hide behind an in-process object reference.
//
// This file therefore NEVER calls `match.kitchen.startTicket()`, `match.floor.seatParty()`,
// `match.pantry.requestRestock()` or any other MUTATING facade method, never assigns into
// `match.*` or `player.*`, and never imports `action-validator.js` or `setup-validator.js`
// directly. `scripts/check-bot.mjs` greps this file's own source for exactly those calls and
// fails the check if one appears — see its "no privileged path" block.
//
// What this file DOES read directly: `match.kitchen`/`match.floor`/`match.pantry`'s READ-ONLY
// query methods (`queuedTicketsAt`, `readyOrders`, `waitingParties`, `dirtyTables`,
// `binShortfalls`, ...) and `match.players.get(id).position`/`.carrying`. That is not a
// privileged information channel: it is exactly what a human owner's own client already shows
// them about their OWN restaurant (the whole point of `action-validator.js`'s contextual
// interaction menu, and of `toPublicRestaurantSnapshot()`/`toPublicOrderSnapshot()` publishing
// tables/orders/customers at all). Reading it here to DECIDE what to do changes nothing about
// how the decision lands — every landing goes through the router and the validator, and can be
// rejected by them exactly as a human's can (a race with the worker system, a target that
// stopped being legal between the decision and the walk). See `#chooseTarget()`.
//
// ============================================================================================
// WHY THE DECISION LOOP IS DRIVEN BY dtMs, NOT setInterval
// ============================================================================================
// STORY-017 AC5: "Bot behaviour is seeded from the match seed so a bot match is reproducible."
// All bot randomness draws from `match.createRngStream(BOT_RNG_STREAM)` (Decision 18), which is
// a pure function of the seed AND of how many times it has been called. If this controller
// drew on its own wall-clock `setInterval`, the number of draws before any given point in the
// match would depend on real scheduling jitter, and "reproducible" would be false the moment
// two runs' event loops interleaved differently. Instead, `advance(dtMs)` is called once per
// SIMULATION tick with the same `dtMs` every system in the match sees (`simulation-loop.js`'s
// own guarantee), and this controller's own decision cadence (`BOT_DECISION_INTERVAL_MS`) is
// counted in that same game-ms. Two runs stepped with the same sequence of `dtMs` values produce
// the exact same sequence of bot decisions. In PRODUCTION, `dtMs` comes from real wall time
// (`simulation-loop.js#startSimulationLoop`), so which tick a decision lands on can still shift
// run to run there — the reproducibility claim is about deterministic stepping, which is
// exactly what STORY-013's balance-testing harness (this story's other stated use) needs, and
// is what `scripts/check-bot.mjs` verifies.
//
// `advance()` is called from `simulation-loop.js#stepRoom()` — the SAME function
// `startSimulationLoop`'s own per-room tick and `scripts/check-bot.mjs`'s synthetic loop both
// call, so there is exactly one place bots get ticked, not two independently-ordered ones.

import { routeMessage } from '../../websocket/message-router.js';
import * as connections from '../../websocket/connection-manager.js';
import { BotSocket } from './bot-socket.js';
import { buildBotSetup } from './bot-setup.js';
import { catalogue } from '../catalogue.js';
import { STATIONS } from '../../../../shared/schemas/messages.js';
import layout from '../../../../shared/game-data/restaurant-layout.json' with { type: 'json' };
import {
  BOT_DECISION_INTERVAL_MS,
  BOT_DEFAULT_DIFFICULTY,
  BOT_DIFFICULTIES,
  BOT_MISTAKE_PROBABILITY,
  BOT_RNG_STREAM,
  BOT_SPRINT_ENABLED,
  OWNER_CARRY_CAPACITY,
  OWNER_INTERACT_RANGE,
  STARTING_CASH,
  WORKER_RESTOCK_THRESHOLD_UNITS,
} from '../../../../shared/constants/tuning.js';

/** A requested difficulty, coerced to one that exists — same shape as
 * `match-manager.js#normalizePhasePreset`. */
export function normalizeBotDifficulty(value) {
  return BOT_DIFFICULTIES.includes(value) ? value : BOT_DEFAULT_DIFFICULTY;
}

// --- the layout, read once, exactly the way action-validator.js and worker-system.js each
// independently do (their own comments explain why this is duplicated rather than imported:
// both read the PUBLIC facade a station name resolves against, and cross-system code stays out
// of another system's internals — Decision 15). --------------------------------------------

const ENTITY_BY_ID = new Map(layout.entities.map((entity) => [entity.id, entity]));
const vec = ([x, y, z]) => ({ x, y, z });
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function staticPosition(entityId) {
  const entity = ENTITY_BY_ID.get(entityId);
  return entity ? vec(entity.position) : null;
}

const STATION_POSITION = new Map(
  layout.entities.filter((entity) => entity.type === 'station').map((entity) => [entity.station, vec(entity.position)]),
);
const SERVICE_PASS_POSITION = staticPosition('service_pass') ?? vec(layout.spawn.owner);
const PANTRY_POSITION = staticPosition('pantry') ?? vec(layout.spawn.owner);
const HOST_STAND_POSITION = staticPosition('host_stand') ?? vec(layout.spawn.owner);

export class BotController {
  /**
   * @param {object} room  a match-manager room ({id, match, sockets, ...}) — the SAME shape
   *                       `socket-server.js`'s real connections attach to.
   * @param {object} [options]
   * @param {'easy'|'hard'} [options.difficulty]
   * @param {number} [options.seatIndex]  0 for the first bot attached to this room, 1 for a
   *                                      second (a bot-vs-bot room — `scripts/check-bot.mjs`
   *                                      only). MUST be caller-supplied and MUST NOT be derived
   *                                      from `playerId`: `connection-manager.js#register`
   *                                      hands out `player_N` from a counter that is global to
   *                                      the whole SERVER PROCESS, not to this match, so it is
   *                                      not itself reproducible from the seed. `attachBot()`
   *                                      below sets it from `room.bots.length`, which is exactly
   *                                      "which bot is this, in the fixed order its caller
   *                                      attached them" and nothing else.
   */
  constructor(room, { difficulty = BOT_DEFAULT_DIFFICULTY, seatIndex = 0 } = {}) {
    this.room = room;
    this.match = room.match;
    this.difficulty = normalizeBotDifficulty(difficulty);
    this.playerId = null;
    this.sequence = 0;
    this.lastSnapshot = null;
    this.readied = false;
    this.setupSent = false;
    this.decisionAccumulatorMs = 0;
    this.stopped = false;
    // Instrumentation ONLY — never read by any gameplay code, never serialized, exactly the
    // class `worker-system.js`'s own `travelMs`/`workMs`/`idleMs` counters are in ("never
    // serialized, never gameplay"). `scripts/check-bot.mjs` reads this to MEASURE the
    // difficulty knob (accepted-interacts/minute) rather than assert it holds.
    this.stats = { interactsSent: 0, interactsRejected: 0, decisionsSkipped: 0 };

    this.socket = new BotSocket((raw) => this.#handleServerMessage(JSON.parse(raw)));
    // A seat-scoped, named sub-stream (Decision 18): `${BOT_RNG_STREAM}:${seatIndex}` rather
    // than the bare stream name. Two bots seated in the SAME match calling
    // `match.createRngStream(BOT_RNG_STREAM)` with the identical name would each get their OWN
    // generator, but both re-seeded from the identical `${match.seed}:bot` string
    // (`createRngStream`'s own definition) — i.e. the exact same draw sequence, twice. A
    // bot-vs-bot match would then have both restaurants make identical menu/price/mistake
    // choices, which is not "reproducible", it is "coupled". Scoping by seat index keeps every
    // draw still 100% seed-derived (STORY-017 AC5) while giving the two seats independent
    // sequences — the same fix `createRngStream`'s own naming convention exists to make trivial.
    this.rng = this.match.createRngStream(`${BOT_RNG_STREAM}:${seatIndex}`);

    // JOIN. The exact message a browser's very first frame sends — see `socket-server.js`'s own
    // `wss.on('connection')` handler, which this constructor mirrors line for line except for
    // the transport underneath it (a `BotSocket`, not a TCP `ws`).
    connections.register(this.socket);
    this.#send({ type: 'join_room', roomId: room.id });
  }

  #send(message) {
    // THE ONLY WAY THIS FILE EVER TOUCHES MATCH STATE. Same function, same validators, same
    // rejection codes a human's browser gets — see this file's header.
    routeMessage(this.socket, JSON.stringify(message));
  }

  #handleServerMessage(msg) {
    if (msg.type === 'joined') {
      this.playerId = msg.playerId;
      console.log(`[bot] ${this.room.id} took seat ${msg.playerId} (difficulty=${this.difficulty})`);
      return;
    }
    if (msg.type === 'match_snapshot') {
      this.lastSnapshot = msg;
      return;
    }
    if (msg.type === 'match_complete') {
      this.stopped = true;
      return;
    }
    if (msg.type === 'error') {
      // A rejected setup, a busy/out-of-range interact, a stale sequence — none of these are
      // exceptional. The next decision tick simply re-evaluates and tries something else,
      // exactly as a human who mistimed a keypress would. Logged only so a genuinely broken
      // bot (every action rejected) is visible in the server log rather than silently idle.
      if (msg.error === 'interact_rejected') this.stats.interactsRejected += 1;
      console.warn(
        `[bot] ${this.room.id} ${this.playerId ?? '(unjoined)'} rejected: ${msg.error}` +
          `${msg.reason ? ` reason=${msg.reason}${msg.detail ? ` (${msg.detail})` : ''}` : ''}`,
      );
    }
  }

  /** Advance by `dtMs` of GAME time. See this file's header for why never wall time. */
  advance(dtMs) {
    if (this.stopped || this.match.ended || !this.playerId) return;

    const phase = this.match.phase;
    if (phase === 'lobby' || phase === 'market_reveal') {
      this.#ensureReady();
      return;
    }
    if (phase === 'setup') {
      this.#ensureSetupSubmitted();
      return;
    }
    if (phase !== 'service' && phase !== 'final_rush') return;

    this.decisionAccumulatorMs += dtMs;
    const interval = BOT_DECISION_INTERVAL_MS[this.difficulty];
    if (this.decisionAccumulatorMs < interval) return;
    this.decisionAccumulatorMs -= interval;
    this.#serviceTick();
  }

  #ensureReady() {
    // §5 "ready up" — a bare `player_ready` defaults to `ready: true`. `lobby` has no deadline
    // (`PHASE_DURATIONS_MS.*.lobby === null`), so a human+bot dev match never leaves it without
    // this. `setup`'s own readiness is set by `acceptSetupSubmission()` itself, so this method
    // is not reached again once setup begins — see `advance()`'s phase dispatch above.
    if (this.readied) return;
    this.#send({ type: 'player_ready', ready: true });
    this.readied = true;
  }

  #ensureSetupSubmitted() {
    if (this.setupSent) return;
    // STORY-017 AC3: weighted toward `match.market.preferredTags`, not a fixed menu.
    // `match.market` is the market OBJECT (Decision 2 room-flow step 4 already selected it at
    // match construction); its fields the bot reads here (`id`/`preferredTags`/
    // `priceSensitivity`) are the identical ones `publicMarket()` reveals to a human, just read
    // server-side instead of off a `match_snapshot`.
    const submission = buildBotSetup({
      catalogue,
      layout,
      market: this.match.market,
      rng: this.rng,
      startingCash: STARTING_CASH,
    });
    // STORY-017 AC2: sent through the SAME `setup_submit` -> `setup-validator.js` path a
    // human's browser uses (`message-router.js#handleSetupSubmit`), unmodified. If the
    // catalogue and layout ever produce a submission this rejects, the bot's seat falls back to
    // `setup-system.js`'s own `defaultSubmission()` exactly like an idle human's would — there
    // is no bot-only fallback here, on purpose.
    this.#send(submission);
    this.setupSent = true;
  }

  #serviceTick() {
    // Difficulty's imperfection — see `BOT_MISTAKE_PROBABILITY`'s own comment in tuning.js.
    if (this.#mistake()) {
      this.stats.decisionsSkipped += 1;
      return;
    }

    const target = this.#chooseTarget();
    const player = this.match.players.get(this.playerId);
    if (!player) return;

    if (!target) {
      this.#walkToward(HOST_STAND_POSITION);
      return;
    }

    if (distance(player.position, target.position) <= OWNER_INTERACT_RANGE) {
      this.sequence += 1;
      this.stats.interactsSent += 1;
      this.#send({
        type: 'interact',
        sequence: this.sequence,
        targetId: target.targetId,
        action: target.action,
      });
      return;
    }
    this.#walkToward(target.position);
  }

  #mistake() {
    const p = BOT_MISTAKE_PROBABILITY[this.difficulty] ?? 0;
    return p > 0 && this.rng() < p;
  }

  #walkToward(position) {
    const player = this.match.players.get(this.playerId);
    if (!player) return;
    const dx = position.x - player.position.x;
    const dz = position.z - player.position.z;
    const len = Math.hypot(dx, dz);
    this.sequence += 1;
    if (len < 0.05) {
      // Already there — release the input rather than jittering in place.
      this.#send({
        type: 'player_input',
        sequence: this.sequence,
        move: { x: 0, z: 0, sprint: false },
        facing: player.facing,
      });
      return;
    }
    const x = dx / len;
    const z = dz / len;
    this.#send({
      type: 'player_input',
      sequence: this.sequence,
      move: { x, z, sprint: BOT_SPRINT_ENABLED[this.difficulty] === true },
      // Same convention `movement-system.js`'s own callers use: facing points along the
      // direction of travel, atan2(x, z) so 0 is "forward" (+z) — matches `smoke-milestone0.mjs`
      // sending `x:1,z:0` alongside `facing:1.57` (pi/2).
      facing: Math.atan2(x, z),
    });
  }

  /**
   * §17-STYLE PRIORITY LIST, MIRRORED — not imported. `worker-system.js`'s own `_internal` is
   * reserved for `scripts/check-workers.mjs` ("no other system or route may import it" — its
   * own comment), so this is a second, independent statement of a similar shape: deliver a
   * carried plate > pick up a ready one > work the most urgent queued ticket at ANY station
   * (the owner is a generalist helper, unlike a cook scoped to one assigned station — see
   * `action-validator.js`'s own header on why the owner is faster-and-broader, not a second
   * cook) > seat the longest-waiting party > clear a dirty table > restock the neediest bin >
   * recover an unhappy party > idle near the host stand. Every branch below returns a
   * `{targetId, action, position}` or `null`; NOTHING here mutates anything.
   */
  #chooseTarget() {
    const restaurantId = this.playerId;
    const match = this.match;
    // Defensive, exactly like the same guard in action-validator.js/worker-system.js: the gap
    // between the setup->service transition and every system's onPhaseChange running this tick.
    if (!match.kitchen || !match.floor || !match.pantry) return null;

    const player = match.players.get(restaurantId);

    // 1. Finish delivering whatever is already in hand — never abandon a walk mid-carry.
    const carried = player?.carrying?.[0];
    if (carried) {
      const position = match.floor.tablePositionOf(restaurantId, carried.tableId);
      if (position) return { targetId: carried.tableId, action: 'deliver', position };
    }

    // 2. Pick up a ready plate, if there is a free hand.
    if ((player?.carrying?.length ?? 0) < OWNER_CARRY_CAPACITY) {
      const [ready] = match.kitchen.readyOrders(restaurantId);
      if (ready) return { targetId: 'service_pass', action: 'pickup', position: SERVICE_PASS_POSITION };
    }

    // 3. The oldest-queued startable ticket, at whichever station it sits at.
    let best = null;
    for (const station of STATIONS) {
      if (!match.kitchen.stationHasCapacity(restaurantId, station)) continue;
      for (const ticket of match.kitchen.queuedTicketsAt(restaurantId, station)) {
        if (ticket.blockedByIngredientId) continue;
        if (!best || ticket.queueAgeMs > best.ticket.queueAgeMs) best = { ticket, station };
      }
    }
    if (best) {
      const action = best.station === 'plating' ? 'plate' : 'cook';
      const position = STATION_POSITION.get(best.station);
      if (position) return { targetId: `station_${best.station}`, action, position };
    }

    // 4. Seat the longest-waiting party — same candidate `action-validator.js#resolveSeat`
    //    itself would pick, so this never aims the owner at a party the interact would refuse.
    const [longestWaiting] = match.floor.waitingParties(restaurantId);
    if (longestWaiting && match.floor.hasTableFor(restaurantId, longestWaiting.partySize)) {
      return { targetId: 'host_stand', action: 'seat', position: HOST_STAND_POSITION };
    }

    // 5. Clear a dirty table.
    const [dirty] = match.floor.dirtyTables(restaurantId);
    if (dirty) return { targetId: dirty.tableId, action: 'clear_table', position: dirty.position };

    // 6. Restock the neediest bin — the same shopping-list read §17 cook rule 4 and the owner's
    //    own `resolveRestock` use (`binShortfalls` is a read-only query facade).
    const [bin] = match.pantry
      .binShortfalls(restaurantId)
      .filter((b) => b.binLevel <= WORKER_RESTOCK_THRESHOLD_UNITS && b.pantryUnits > 0 && !b.restocking)
      .sort((a, b) => a.binLevel - b.binLevel);
    if (bin) return { targetId: 'pantry', action: 'restock', position: PANTRY_POSITION };

    // 7. Recover an unhappy party.
    const [unhappy] = match.floor.unhappyParties(restaurantId);
    if (unhappy) {
      const position = match.floor.tablePositionOf(restaurantId, unhappy.tableId);
      if (position) return { targetId: unhappy.tableId, action: 'handle_complaint', position };
    }

    return null;
  }
}

/** Create and immediately join a bot for `room`, appending it to `room.bots` (an array so a
 * bot-vs-bot room, used only by `scripts/check-bot.mjs`, holds two). `simulation-loop.js#
 * stepRoom()` ticks whatever is in `room.bots` — see this file's header. `seatIndex` is derived
 * from `room.bots`'s length BEFORE this bot is appended — the first bot attached to a room
 * always gets seat 0, a second always gets seat 1, regardless of what `playerId` connection-
 * manager.js later hands out — see the constructor's own note on why that distinction matters
 * for reproducibility. */
export function attachBot(room, options = {}) {
  const seatIndex = room.bots?.length ?? 0;
  const bot = new BotController(room, { ...options, seatIndex });
  room.bots = [...(room.bots ?? []), bot];
  return bot;
}

/** Exported for `scripts/check-bot.mjs` ONLY. No other module may import it. */
export const _internal = { STATION_POSITION, SERVICE_PASS_POSITION, PANTRY_POSITION, HOST_STAND_POSITION };
