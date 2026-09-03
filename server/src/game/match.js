// One match's authoritative state: its seed, its market, its players, and — the point of
// STORY-003 — its phase and its clock.
//
// PRD §12 "Server authority" names the match seed and the match timer as things the server
// owns. This module is where both live. The client renders `matchPhase` and `timeRemainingMs`
// out of the snapshot and never runs a clock of its own (Milestone 0 Decision 2).
//
// STORY-001 parked every match in a permanent `service` phase so replicated movement could be
// exercised. That placeholder is gone: the PRD §5 phase machine runs here, driven by the
// simulation loop's `dtMs` rather than by a timer of its own (Decision 3).
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO: it holds no gameplay systems. Customers, orders,
// setup submissions, events and scoring register against `simulation-loop.js` as systems (see
// `systems/index.js`) precisely so that adding one is a new file plus a registration line,
// and never an edit here.
//
// THE ONE DISCLOSED EXCEPTION (STORY-004): `toSnapshot()`'s `customers` field now reads
// `this.customers ?? []` instead of a hardcoded `[]`, because snapshots are pull-based per
// viewer and this method is the only place they are assembled — there was no other integration
// point for a system's data to reach the wire. `customer-system.js` attaches its own
// pre-sanitized array (`match.customers = [...]`); this file still contains zero gameplay
// logic, only a generic fallback. `events`/`restaurants`/`orders` are deliberately left as `[]`
// here — STORY-011/009/005 own those and should make the identical narrow change themselves
// when they land, rather than this story pre-editing lines it does not use, to keep each
// story's diff to this shared file surgical and rebase-friendly. See customer-system.js's file
// header for the full reasoning.

import { MATCH_PHASES } from '../../../shared/schemas/messages.js';
import {
  PHASE_DURATIONS_MS,
  PLAYERS_PER_MATCH,
  RECONNECT_GRACE_MS,
  RESTAURANT_BOUNDS,
  OWNER_SPRINT_MAX_MS,
  OWNER_CARRY_CAPACITY,
} from '../../../shared/constants/tuning.js';
import { createRng } from './rng.js';
import { catalogue, publicMarket } from './catalogue.js';
import layout from '../../../shared/game-data/restaurant-layout.json' with { type: 'json' };

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

/**
 * Phases in which losing a player for longer than the grace period must end the match.
 * A drop in `lobby` frees the seat instead (nothing is under way to abandon), and a drop in
 * `results` is ignored because the match is already decided.
 */
const GRACE_ENFORCED_PHASES = Object.freeze(['market_reveal', 'setup', 'service', 'final_rush']);

/** The phase after `phase`, or null if `phase` is the last one. Order is MATCH_PHASES. */
function nextPhase(phase) {
  return MATCH_PHASES[MATCH_PHASES.indexOf(phase) + 1] ?? null;
}

export class Match {
  /**
   * @param {object} options
   * @param {string} options.id                 room id, also the match id
   * @param {string} options.seed               fixed at creation; drives every deterministic draw
   * @param {string} [options.phasePreset]      a key of PHASE_DURATIONS_MS
   * @param {number} [options.requiredPlayers]  seats; 1 for a `POST /api/dev/match` match
   */
  constructor({ id, seed, phasePreset = 'prototype', requiredPlayers = PLAYERS_PER_MATCH }) {
    if (!PHASE_DURATIONS_MS[phasePreset]) {
      throw new Error(
        `unknown phasePreset "${phasePreset}" — expected one of ${Object.keys(PHASE_DURATIONS_MS).join(', ')}`,
      );
    }

    this.id = id;
    this.seed = seed;
    this.phasePreset = phasePreset;
    this.requiredPlayers = requiredPlayers;
    this.durations = PHASE_DURATIONS_MS[phasePreset];
    this.createdAt = Date.now();

    // The configuration stream. Drawn from at construction only, so a system drawing later
    // cannot shift the market selection. Systems use createRngStream() instead.
    this.rng = createRng(seed);

    /**
     * THE match clock. Accumulated tick time, not wall time: the loop owns the cadence
     * (Decision 3), so the phase clock advances by the same `dtMs` every system sees. One
     * clock, not two — the snapshot's `serverTime` is this value.
     */
    this.elapsedMs = 0;

    this.phase = MATCH_PHASES[0]; // 'lobby'
    this.phaseStartedAtMs = 0;
    this.phaseEndsAtMs = this.durations[this.phase] === null ? null : this.durations[this.phase];

    this.players = new Map();

    this.ended = false;
    /** One of MATCH_END_REASONS once `ended`. */
    this.endReason = null;
    this.endedPlayerId = null;

    /** Server-to-client messages produced this tick. The loop drains and broadcasts them. */
    this.outbox = [];

    // PRD §12 room-flow step 4: the server selects the market scenario, from the seed.
    this.config = this.#generateConfig();
    this.market = catalogue.marketsById[this.config.marketId];
  }

  // --- deterministic configuration ----------------------------------------------------

  #generateConfig() {
    // Draw order is part of the reproducibility contract: market first, then spawn jitter.
    // Inserting a draw ABOVE an existing one changes every match with the same seed.
    const marketDraw = this.rng();
    const market = catalogue.markets[Math.floor(marketDraw * catalogue.markets.length)];
    return {
      layoutId: layout.id,
      marketId: market.id,
      spawnJitter: Number(this.rng().toFixed(6)),
    };
  }

  /**
   * A named, independent RNG stream for one system — `match.createRngStream('event_deck')`.
   *
   * Refines Milestone 0 Decision 6. Decision 6 says a match is reproducible from its seed and
   * that STORY-011's event deck draws from "this same seeded stream". A single shared stream
   * makes that literally true but couples systems: once STORY-004 draws a customer between
   * two of STORY-011's event draws, neither is reproducible on its own. A stream named from
   * the same seed is still entirely seed-derived and still identical for both players, and it
   * survives another system being added beside it. Same seed plus same name is always the
   * same sequence.
   */
  createRngStream(name) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('createRngStream(name) requires a non-empty stream name');
    }
    return createRng(`${this.seed}:${name}`);
  }

  // --- players ------------------------------------------------------------------------

  /**
   * PRD §12 room-flow steps 1-2, plus reconnect. Returns `{ok: true, player, reconnected}`
   * or `{ok: false, error}` carrying an ERROR_CODES member.
   *
   * `requestedPlayerId` is a reconnect token (see JoinRoomMessage in messages.d.ts). It is
   * honoured ONLY for a player who is currently disconnected and still inside the grace
   * window, so it can never take a seat somebody is sitting in.
   */
  join({ requestedPlayerId = null, fallbackPlayerId }) {
    if (requestedPlayerId) {
      const existing = this.players.get(requestedPlayerId);
      if (existing && !existing.connected && this.#withinGrace(existing)) {
        existing.connected = true;
        existing.disconnectedAtMs = null;
        // Movement intent does not survive the gap — a reconnecting owner must not inherit
        // the direction they were holding when the socket dropped.
        existing.input = { x: 0, z: 0, sprint: false };
        return { ok: true, player: existing, reconnected: true };
      }
    }
    if (this.players.size >= this.requiredPlayers) {
      return { ok: false, error: 'match_full' };
    }
    return { ok: true, player: this.#seat(fallbackPlayerId), reconnected: false };
  }

  #seat(playerId) {
    const existing = this.players.get(playerId);
    if (existing) {
      existing.connected = true;
      existing.disconnectedAtMs = null;
      return existing;
    }
    const [x, y, z] = layout.spawn.owner;
    // Offset the second owner so two avatars are distinguishable at spawn.
    const offset = this.players.size * 2.5;
    const player = {
      playerId,
      position: { x: clamp(x + offset, RESTAURANT_BOUNDS.minX, RESTAURANT_BOUNDS.maxX), y, z },
      facing: 0,
      sprinting: false,
      sprintRemainingMs: OWNER_SPRINT_MAX_MS,
      sprintCooldownMs: 0,
      lastSequence: 0,
      connected: true,
      ready: false,
      /**
       * STORY-009's accepted `setup_submit`, or null until they submit. PRIVATE — it is only
       * ever serialized into this player's OWN `you` slice (Decision 16), never into
       * `players[]`, which is the half of the snapshot the opponent also receives.
       */
      setup: null,
      disconnectedAtMs: null,
      input: { x: 0, z: 0, sprint: false },
      // STORY-008. `carrying`/`lastInteractSequence` are read and written directly by
      // `action-validator.js`, the same way `movement-system.js` already reads and writes
      // `sprintRemainingMs` above — a player field, not a system-attached array, so no facade
      // is needed for the one caller that touches it. `pendingAction` is the ONE field on this
      // object never serialized: it is the timer for the in-flight action, and `currentAction`
      // (its public name) is derived from it at snapshot time.
      carrying: [],
      pendingAction: null,
      lastInteractSequence: 0,
      // STORY-012. `purchase_upgrade` is its own message stream, not an `interact` — a
      // separate sequence counter so a stale/duplicate purchase can never dedup against (or be
      // deduped by) an unrelated interact sequence number.
      lastPurchaseSequence: 0,
    };
    this.players.set(playerId, player);
    return player;
  }

  /**
   * A socket closed. PRD §13 "Server responsibilities": handle reconnect grace. The player is
   * HELD, not removed — the match keeps running, and `advanceClock` ends it only once the
   * grace period expires. A drop during `lobby` is different: nothing is under way, so the
   * seat is released for somebody else.
   */
  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.connected = false;
    player.ready = false;
    player.input = { x: 0, z: 0, sprint: false };
    player.disconnectedAtMs = this.elapsedMs;
    if (this.phase === 'lobby') this.players.delete(playerId);
  }

  #withinGrace(player) {
    if (player.disconnectedAtMs === null) return true;
    return this.elapsedMs - player.disconnectedAtMs <= RECONNECT_GRACE_MS;
  }

  /**
   * PRD §12 room-flow step 7's readiness half, and PRD §5's lobby "ready up". Accepted only
   * in the two phases that consult it; anywhere else it is a no-op and returns false so the
   * caller can say why nothing happened.
   */
  setReady(playerId, ready = true) {
    if (this.ended) return false;
    if (this.phase !== 'lobby' && this.phase !== 'setup') return false;
    const player = this.players.get(playerId);
    if (!player || !player.connected) return false;
    player.ready = Boolean(ready);
    return true;
  }

  /** Record a movement intent. The client sends intent only — never a position (PRD §12). */
  applyInput(playerId, message) {
    const player = this.players.get(playerId);
    if (!player) return;
    if (typeof message.sequence === 'number' && message.sequence <= player.lastSequence) return;

    const move = message.move ?? {};
    const x = Number.isFinite(move.x) ? clamp(move.x, -1, 1) : 0;
    const z = Number.isFinite(move.z) ? clamp(move.z, -1, 1) : 0;
    player.input = { x, z, sprint: Boolean(move.sprint) };
    if (Number.isFinite(message.facing)) player.facing = message.facing;
    if (typeof message.sequence === 'number') player.lastSequence = message.sequence;
  }

  // --- the phase clock -----------------------------------------------------------------

  /** Ms left in the current phase; null in a phase with no deadline (`lobby`). */
  get timeRemainingMs() {
    if (this.ended) return 0;
    if (this.phaseEndsAtMs === null) return null;
    return Math.max(0, Math.round(this.phaseEndsAtMs - this.elapsedMs));
  }

  /** True for the phases in which the restaurant is actually open. */
  get isServicePhase() {
    return this.phase === 'service' || this.phase === 'final_rush';
  }

  /**
   * Advance the clock by `dtMs` and apply every transition that became due. Called once per
   * tick by `simulation-loop.js`, BEFORE the systems run and before the snapshot is built —
   * which is what guarantees no broadcast ever carries a phase's time after that phase ended.
   *
   * Returns the transitions that happened, `[{from, to, atMs}]`, in order. Usually empty.
   */
  advanceClock(dtMs) {
    if (this.ended) return [];
    this.elapsedMs += dtMs;

    const expired = this.#playerPastGrace();
    if (expired) {
      this.#endMatch('player_disconnected', this.elapsedMs, expired.playerId);
      return [];
    }

    const transitions = [];
    // Bounded: there are only so many phases, and each iteration advances one or ends the
    // match. The guard means a zero-length phase can never spin the loop.
    for (let guard = 0; guard <= MATCH_PHASES.length; guard += 1) {
      const dueAtMs = this.#dueAtMs();
      if (dueAtMs === null) break;

      const to = nextPhase(this.phase);
      if (to === null) {
        // The last phase ran out: the match is over. PRD §12 room-flow step 11.
        this.#endMatch('completed', dueAtMs);
        break;
      }
      transitions.push(this.#enterPhase(to, dueAtMs));
    }
    return transitions;
  }

  /**
   * The clock coordinate at which the current phase ends, or null if it has not. A phase ends
   * two ways and PRD §12 step 7 requires both: its timer runs out, or its condition is met.
   */
  #dueAtMs() {
    if (this.phaseEndsAtMs !== null && this.elapsedMs >= this.phaseEndsAtMs) {
      // The DEADLINE, not "now". Carrying the overshoot into the next phase is what keeps the
      // phase timeline gapless and drift-free across a whole match.
      return this.phaseEndsAtMs;
    }
    if (this.phase === 'lobby' && this.#everySeatFilledAndReady()) return this.elapsedMs;
    if (this.phase === 'setup' && this.#everyPlayerReady()) return this.elapsedMs;
    return null;
  }

  #everySeatFilledAndReady() {
    if (this.players.size < this.requiredPlayers) return false;
    return [...this.players.values()].every((p) => p.connected && p.ready);
  }

  /**
   * Every seated player is ready. A player who dropped mid-setup cannot ready, so the match
   * waits out the setup timer for them rather than starting service on the survivor's word.
   */
  #everyPlayerReady() {
    if (this.players.size < this.requiredPlayers) return false;
    return [...this.players.values()].every((p) => p.ready);
  }

  #playerPastGrace() {
    if (!GRACE_ENFORCED_PHASES.includes(this.phase)) return null;
    for (const player of this.players.values()) {
      if (!player.connected && !this.#withinGrace(player)) return player;
    }
    return null;
  }

  #enterPhase(to, atMs) {
    const from = this.phase;
    this.phase = to;
    this.phaseStartedAtMs = atMs;
    const duration = this.durations[to];
    this.phaseEndsAtMs = duration === null ? null : atMs + duration;

    // Readiness is per-phase: readying up in the lobby is not a promise about your menu.
    for (const player of this.players.values()) player.ready = false;

    console.log(
      `[match] ${this.id} ${from} -> ${to} (${duration ?? 'no deadline'}ms) at ${Math.round(atMs)}ms`,
    );
    return { from, to, atMs };
  }

  /**
   * End the match. `completed` is the normal exit at the end of `results`; any other reason
   * is an abort, which lands the match on `results` with nothing left on the clock so both
   * clients see one coherent terminal state rather than a phase frozen mid-countdown.
   */
  #endMatch(reason, atMs, disconnectedPlayerId = null) {
    if (this.ended) return;
    this.ended = true;
    this.endReason = reason;
    this.endedPlayerId = disconnectedPlayerId;
    if (reason !== 'completed') {
      this.phase = 'results';
      this.phaseStartedAtMs = atMs;
    }
    this.phaseEndsAtMs = atMs;
    console.log(
      `[match] ${this.id} ended: ${reason}${disconnectedPlayerId ? ` (${disconnectedPlayerId})` : ''}`,
    );
    this.enqueue(this.matchCompleteMessage());
  }

  // --- outbound messages ----------------------------------------------------------------

  /**
   * Queue a server-to-client message for the room. The loop drains this after the systems
   * run, so a system announcing something (STORY-011's `event_announce`) needs to know
   * nothing about sockets.
   */
  enqueue(message) {
    this.outbox.push(message);
  }

  drainOutbox() {
    if (this.outbox.length === 0) return [];
    const drained = this.outbox;
    this.outbox = [];
    return drained;
  }

  /**
   * PRD §12 server-to-client example 3. STORY-013's `scoring-system.js` — registered last of
   * every gameplay system — populates `this.finalResults` at the `service`/`final_rush` ->
   * `results` transition. This reads that if it exists.
   *
   * It may not: `#endMatch` for any reason OTHER than `completed` sets `this.phase = 'results'`
   * DIRECTLY (see below), which is not a phase transition `advanceClock` ever reports, so
   * `onPhaseChange` never fires for it and `scoringSystem` never runs. A player-disconnect end
   * during setup or market_reveal is the clearest example. The fallback below — one empty
   * object per player, exactly as the §12 example writes it — is what keeps that path
   * harmless rather than a crash.
   */
  matchCompleteMessage() {
    return {
      type: 'match_complete',
      winnerPlayerId: this.finalResults?.winnerPlayerId ?? null,
      results:
        this.finalResults?.results ??
        Object.fromEntries([...this.players.keys()].map((playerId) => [playerId, {}])),
      reason: this.endReason ?? 'completed',
      ...(this.endedPlayerId ? { disconnectedPlayerId: this.endedPlayerId } : {}),
    };
  }

  // --- snapshot --------------------------------------------------------------------------

  /** True once the market reveal has begun; before that the market is not public. */
  get marketRevealed() {
    return MATCH_PHASES.indexOf(this.phase) >= MATCH_PHASES.indexOf('market_reveal');
  }

  /**
   * PRD §12 "Server-to-client": `match_snapshot`, BUILT PER VIEWER.
   *
   * This is the privacy boundary PRD §18 requires ("Do not reveal the opponent's exact menu
   * or prices during setup"). Everything at the top level of this object is public and both
   * players receive it identically — including `market`, which §12 room-flow step 5 requires
   * be identical. Anything one player alone may see goes under `you`, which is the only part
   * that differs between the two snapshots. STORY-009's setup submission belongs under `you`;
   * putting it anywhere else leaks it.
   */
  toSnapshot(viewerPlayerId = null) {
    const viewer = viewerPlayerId ? this.players.get(viewerPlayerId) : null;
    return {
      type: 'match_snapshot',
      serverTime: Math.round(this.elapsedMs),
      matchPhase: this.phase,
      timeRemainingMs: this.timeRemainingMs,
      market: this.marketRevealed ? publicMarket(this.market) : null,
      // `setup` is here and NOWHERE else: PRD §18 forbids revealing the opponent's exact menu
      // or prices during setup, and `you` is the only key that differs per viewer.
      you: viewer
        ? {
            playerId: viewer.playerId,
            ready: viewer.ready,
            setup: viewer.setup ?? null,
            // STORY-012. Private for the same reason `setup` is — both are derived from this
            // player's own menu/pricing choices. `match.upgrades` does not exist before
            // `service` (`upgrade-system.js` attaches it on the setup->service transition).
            cash: this.upgrades?.cashAvailable(viewer.playerId) ?? null,
            purchasedUpgradeIds: this.upgrades?.ownedUpgrades(viewer.playerId) ?? [],
          }
        : null,
      // Each of these is populated by a system attaching its own pre-sanitized, already
      // public-shaped array to `match.<name>` during its tick; this method only serializes
      // whatever is there, defaulting to `[]` before any such system has run. That default is
      // the one narrow exception to Decision 15's "later systems never edit match.js" — made
      // once, for all of them, so no future story has to touch this method again. match.js
      // still contains no gameplay logic.
      events: this.events ?? [],
      eventForecast: this.eventForecast ?? [],
      restaurants: this.restaurants ?? [],
      customers: this.customers ?? [],
      orders: this.orders ?? [],
      players: [...this.players.values()].map((p) => ({
        playerId: p.playerId,
        position: { x: p.position.x, y: p.position.y, z: p.position.z },
        facing: p.facing,
        sprinting: p.sprinting,
        connected: p.connected,
        // PRD §18 shows "opponent-ready status" — readiness is the one public fact about
        // another player's setup.
        ready: p.ready,
        lastSequence: p.lastSequence,
        // STORY-008. `p.carrying` holds `{orderId, tableId}` internally (`action-validator.js`
        // needs the destination table to validate `deliver`'s target); only the order id is
        // public here — it is already public on `orders[]`, same reasoning as `ready`, and the
        // client cross-references that array for a dish name rather than this one duplicating
        // it. `currentAction` is derived here, not read off `pendingAction` directly — a pure
        // function of the clock, so a snapshot pulled between actions never shows a stale one.
        // `action-validator.js` does the real (mutating) expiry check.
        carrying: p.carrying.map((c) => c.orderId),
        currentAction:
          p.pendingAction && this.elapsedMs < p.pendingAction.readyAtMs ? p.pendingAction.action : null,
        // STORY-012. Public: already inferable by watching `carrying` reach 2 or 3, and the
        // client's own InteractionController needs its OWN capacity to know when to stop
        // offering `pickup`. WHICH upgrade produced it stays private — see `you` above.
        carryCapacity: this.upgrades?.ownerCarryCapacity(p.playerId) ?? OWNER_CARRY_CAPACITY,
      })),
    };
  }
}
