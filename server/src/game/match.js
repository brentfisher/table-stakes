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
   * @param {boolean} [options.holdLobbySeatsDuringGrace] STORY-024. A drop during `lobby`
   *   normally frees the seat instantly (see `removePlayer`'s own comment) — nothing is under
   *   way to abandon, and the bare dev/bot room this class already served has no invite to
   *   protect. A private-invite room is different: a host or guest who blips mid-invite-flow
   *   should get the SAME reconnect grace everyone already gets mid-match, not lose their seat
   *   to a third party who happens to load the join link in that window. Defaults false so
   *   every existing caller — `check-match-lifecycle.mjs`'s own "a drop during lobby releases
   *   the seat instead of holding it" among them — is unaffected.
   * @param {string|null} [options.marketId] STORY-025. PRD §12 step 4 says "the server selects
   *   the market scenario" FROM THE SEED — normally true here too (`#generateConfig` still
   *   draws `marketDraw` unconditionally, so every pre-existing seed keeps drawing the exact
   *   same market it always did and `spawnJitter`'s draw index never shifts). This override
   *   exists ONLY for the STORY-025 "Play vs Bot" menu's "market scenario" picker, which needs
   *   an explicit choice rather than a seed lottery: when it names a real `catalogue.marketsById`
   *   entry, that market is used INSTEAD of the drawn one; a missing/unknown id falls back to
   *   the drawn market exactly as if this option had never been passed, so a typo or a stale id
   *   degrades to the pre-existing behavior rather than throwing.
   * @param {boolean} [options.sharedRestaurant] STORY-039. Every system in this codebase keys
   *   its own "one restaurant" bucket by `playerId` directly — see `restaurantIdFor`'s own
   *   comment just below for the full reasoning. Defaults false so every existing caller (dev,
   *   `private_human`, `solo_bot`) keeps `restaurantId === playerId` exactly as before. A co-op
   *   room passes `true`: every player in this match is folded onto ONE restaurant instead of
   *   getting their own.
   */
  constructor({
    id,
    seed,
    phasePreset = 'prototype',
    requiredPlayers = PLAYERS_PER_MATCH,
    holdLobbySeatsDuringGrace = false,
    marketId = null,
    sharedRestaurant = false,
  }) {
    if (!PHASE_DURATIONS_MS[phasePreset]) {
      throw new Error(
        `unknown phasePreset "${phasePreset}" — expected one of ${Object.keys(PHASE_DURATIONS_MS).join(', ')}`,
      );
    }

    this.id = id;
    this.seed = seed;
    this.phasePreset = phasePreset;
    this.requiredPlayers = requiredPlayers;
    this.holdLobbySeatsDuringGrace = holdLobbySeatsDuringGrace;
    this.sharedRestaurant = sharedRestaurant;
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

    /**
     * STORY-022. Server-side-only structured event log, appended to by `logEvent()` below and
     * by the systems/router that touch a client message or an order's lifecycle. Never
     * serialized into a snapshot — `telemetry-export.js` is the only reader, and it runs once
     * at export time, off the simulation tick entirely.
     */
    this.telemetry = [];

    // PRD §12 room-flow step 4: the server selects the market scenario, from the seed —
    // unless STORY-025's `marketId` override names a real one (see the constructor's own
    // comment on why the draw still happens either way).
    this.config = this.#generateConfig(marketId);
    this.market = catalogue.marketsById[this.config.marketId];
  }

  // --- deterministic configuration ----------------------------------------------------

  #generateConfig(marketIdOverride = null) {
    // Draw order is part of the reproducibility contract: market first, then spawn jitter.
    // Inserting a draw ABOVE an existing one changes every match with the same seed. The draw
    // itself always happens, override or not — see the constructor's own comment on why.
    const marketDraw = this.rng();
    const drawnMarket = catalogue.markets[Math.floor(marketDraw * catalogue.markets.length)];
    const overrideMarket = marketIdOverride ? catalogue.marketsById[marketIdOverride] : null;
    const market = overrideMarket ?? drawnMarket;
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

  /**
   * STORY-039. `restaurantId === playerId` is baked into essentially every gameplay system
   * (customer-system.js's district, order/inventory/worker-system's per-restaurant state,
   * action-validator.js's `restaurantId = playerId`, this class's own `toSnapshot`) — a
   * restaurant is, everywhere else in this codebase, simply "the thing this player owns". A
   * co-op match breaks that 1:1 assumption on purpose (two players, one restaurant), and rather
   * than teach a dozen files a new per-match player->restaurant mapping, this ONE method is the
   * single seam: every site that used to read `playerId` as a restaurant id now asks this
   * instead. For every EXISTING mode it returns `playerId` unchanged (`sharedRestaurant` is
   * false), so nothing about a dev/private_human/solo_bot match's behaviour moves by a single
   * byte. For a co-op match it returns the FIRST player ever seated (`this.players`' insertion
   * order — see `#seat`) for every player id asked about, so both seats resolve to the exact
   * same restaurant bucket everywhere this is called, without either seat needing to know who
   * "hosts" it.
   *
   * The one documented consequence: `menuOf` (customer-system.js) reads a restaurant's menu off
   * `match.players.get(view.playerId)?.setup` — the FIRST-seated co-op player's own setup
   * submission becomes the shared restaurant's menu; the second player's `setup_submit` is
   * still accepted and stored (nothing rejects it) but never read by anything customer-facing.
   * A real collaborative single-menu flow is explicitly STORY-040+'s job (see that story's own
   * "no-staff kitchen rework"), not this foundation story's.
   *
   * DELIBERATELY RE-DERIVED FROM `this.players` ON EVERY CALL, NOT CACHED/PINNED. `this.players`
   * can only ever lose an entry during `lobby` (a drop past `RECONNECT_GRACE_MS` with
   * `holdLobbySeatsDuringGrace` — `#releaseLobbySeatsPastGrace` — or, without that flag, an
   * instant lobby-drop release; see `removePlayer`), which means the FIRST-seated player CAN
   * change while a co-op room is still waiting in its lobby (the original host drops, grace
   * expires, a fresh join fills the freed seat first). That is fine, not a bug: every OTHER
   * restaurant-keyed system in this codebase (`order-system.js`, `inventory-system.js`,
   * `worker-system.js`, `upgrade-system.js`, ...) also builds its own bucket map by enumerating
   * `match.players.values()` FRESH, lazily, the first time it ticks during `service` —
   * i.e. from whichever roster is actually seated once the match leaves `lobby`, which is frozen
   * from that point on (`this.players` is never deleted from again post-lobby — see the two call
   * sites of `.delete(` in this file). Re-deriving here keeps `restaurantIdFor` looking at THE
   * SAME roster those systems build their real buckets from. Pinning the id at first-seat time
   * would instead risk the opposite failure: if that pinned player's seat was later reclaimed by
   * someone else before service began, every other system's bucket map would have no entry for
   * the stale pinned id at all (it enumerates the CURRENT roster), and every action would resolve
   * to a restaurant that was never built. Verified empirically in
   * `scripts/check-coop-mode.mjs` ("a co-op seat freed and refilled during lobby still reaches
   * service with one consistent shared restaurant").
   */
  restaurantIdFor(playerId) {
    if (!this.sharedRestaurant) return playerId;
    const [firstSeatedId] = this.players.keys();
    return firstSeatedId ?? playerId;
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
    // STORY-022. A dead room answers `match_ended`, not `match_full` — a late reconnect token
    // and a genuinely full roster are different facts, and telling them apart is the whole
    // point of "ends cleanly with a stated reason rather than hanging". Checked before the
    // reconnect-token branch below: once ended, no token and no fresh join gets a seat.
    if (this.ended) return { ok: false, error: 'match_ended', reason: this.endReason };
    if (requestedPlayerId) {
      const existing = this.players.get(requestedPlayerId);
      if (existing && !existing.connected && this.#withinGrace(existing)) {
        existing.connected = true;
        existing.disconnectedAtMs = null;
        // Movement intent does not survive the gap — a reconnecting owner must not inherit
        // the direction they were holding when the socket dropped.
        existing.input = { x: 0, z: 0, sprint: false };
        this.logEvent('player_connection', { playerId: existing.playerId, action: 'reconnected' });
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
    this.logEvent('player_connection', { playerId, action: 'joined' });
    return player;
  }

  /**
   * A socket closed. PRD §13 "Server responsibilities": handle reconnect grace. The player is
   * HELD, not removed — the match keeps running, and `advanceClock` ends it only once the
   * grace period expires. A drop during `lobby` is normally different: nothing is under way,
   * so the seat is released immediately for somebody else — UNLESS this is a STORY-024
   * private-invite room (`holdLobbySeatsDuringGrace`), where the seat is held through the same
   * grace window instead and `advanceClock`'s `#releaseLobbySeatsPastGrace` frees it only once
   * that window actually elapses.
   */
  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.connected = false;
    player.ready = false;
    player.input = { x: 0, z: 0, sprint: false };
    player.disconnectedAtMs = this.elapsedMs;
    this.logEvent('player_connection', { playerId, action: 'disconnected' });
    if (this.phase === 'lobby' && !this.holdLobbySeatsDuringGrace) this.players.delete(playerId);
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

    // STORY-024. Only reachable when `holdLobbySeatsDuringGrace` — see `removePlayer`'s own
    // comment. Ordinary dev/bot rooms free a lobby seat the instant it drops and never reach
    // here, matching their pre-STORY-024 behaviour exactly.
    if (this.phase === 'lobby' && this.holdLobbySeatsDuringGrace) this.#releaseLobbySeatsPastGrace();

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

  /**
   * STORY-024. `lobby`'s equivalent of `#playerPastGrace`, but freeing the seat rather than
   * ending the match — nothing was under way for a lobby drop to abandon, so the honest outcome
   * of a grace window running out here is "somebody else can take that seat now", not
   * `player_disconnected`. Iterates a snapshot of `this.players.values()` because deleting a
   * key mid-iteration over the live Map is undefined behaviour in the general case.
   */
  #releaseLobbySeatsPastGrace() {
    for (const player of [...this.players.values()]) {
      if (!player.connected && !this.#withinGrace(player)) {
        this.players.delete(player.playerId);
        this.logEvent('player_connection', { playerId: player.playerId, action: 'seat_released' });
      }
    }
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
    this.logEvent('phase_transition', { from, to });
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
    this.logEvent('match_end', { reason, disconnectedPlayerId });
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
   * STORY-022. Append one structured record to `this.telemetry` — a plain object push, no
   * `JSON.stringify` and no socket, so a system or the router can call this from its own
   * transition site without touching the hot tick's cost profile. `atMs` is always
   * `this.elapsedMs`, the same clock coordinate every other diffable field in the match is
   * built from — never `Date.now()`, which would make two runs of the same seed diff dirty.
   */
  logEvent(category, payload) {
    this.telemetry.push({ atMs: Math.round(this.elapsedMs), category, ...payload });
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
        Object.fromEntries(
          [...new Set([...this.players.keys()].map((id) => this.restaurantIdFor(id)))].map((id) => [id, {}]),
        ),
      reason: this.endReason ?? 'completed',
      ...(this.endedPlayerId ? { disconnectedPlayerId: this.endedPlayerId } : {}),
      // STORY-014 (PRD §11 results-screen narrative layer). Match-wide, not per-player, so they
      // sit beside `winnerPlayerId` rather than inside each player's own `results[playerId]`
      // entry. Same disconnect-path fallback as `results` above: when `scoringSystem` never ran
      // (see the class comment above this method), there is nothing to explain, and the honest
      // answer is null/empty rather than a crash.
      decidingSegment: this.finalResults?.decidingSegment ?? null,
      turningPoints: this.finalResults?.turningPoints ?? [],
      tieBreakDecided: this.finalResults?.tieBreakDecided ?? null,
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
    // STORY-039. The restaurant bucket THIS viewer's private facades (`cash`, `pantry`, ...)
    // and THIS viewer's `frontDoor`/`serviceStation` entries below are read from — `playerId`
    // for every pre-existing mode, the shared co-op restaurant id for both co-op seats. See
    // `restaurantIdFor`'s own comment for why this is the one seam instead of a dozen edits.
    const viewerRestaurantId = viewer ? this.restaurantIdFor(viewer.playerId) : null;
    // De-duplicated restaurant ids for the two per-viewer maps below: a co-op match's two
    // players both resolve to the SAME restaurant id, so this is a one-entry set for them
    // (`frontDoor`/`serviceStation` would otherwise carry a second, always-default entry keyed
    // by the second player's raw id — one that nothing writes to and the guest's own client
    // would never look up, since it looks up by `you.restaurantId`, not `you.playerId`).
    const restaurantIds = [...new Set([...this.players.keys()].map((id) => this.restaurantIdFor(id)))];
    return {
      type: 'match_snapshot',
      serverTime: Math.round(this.elapsedMs),
      matchPhase: this.phase,
      timeRemainingMs: this.timeRemainingMs,
      // STORY-040. Public, not `you`-scoped: both co-op seats need to know their restaurant has
      // no roster (the ready-up flow builds an empty `staffAssignments`, the upgrade terminal
      // locks staff-only upgrades) and it is true identically for both of them — same publicness
      // reasoning as `market`'s own comment just below, not a per-viewer fact like `you.setup`.
      sharedRestaurant: this.sharedRestaurant,
      market: this.marketRevealed ? publicMarket(this.market) : null,
      // `setup` is here and NOWHERE else: PRD §18 forbids revealing the opponent's exact menu
      // or prices during setup, and `you` is the only key that differs per viewer.
      you: viewer
        ? {
            playerId: viewer.playerId,
            // STORY-039. The restaurant THIS viewer acts on — `playerId` itself for every
            // pre-existing mode. A co-op guest's `playerId` is never a key into `restaurants[]`/
            // `frontDoor`/`serviceStation`; the client must read THIS field to find its own
            // restaurant rather than assuming `restaurantId === playerId`.
            restaurantId: viewerRestaurantId,
            ready: viewer.ready,
            setup: viewer.setup ?? null,
            // STORY-012. Private for the same reason `setup` is — both are derived from this
            // player's own menu/pricing choices. `match.upgrades` does not exist before
            // `service` (`upgrade-system.js` attaches it on the setup->service transition).
            cash: this.upgrades?.cashAvailable(viewerRestaurantId) ?? null,
            purchasedUpgradeIds: this.upgrades?.ownedUpgrades(viewerRestaurantId) ?? [],
            // STORY-015. PRD §18 "Revenue and available cash" needs BOTH numbers, and `cash`
            // above only ever carried the second one — `restaurants[].revenue` stays
            // deliberately unpublished (`customer-system.js#toPublicRestaurantSnapshot`'s own
            // comment: "neither are cash, inventory, the ledger... a later story owns"), so a
            // rival's revenue never leaks the way a rival's cash never does. This is that later
            // story, and `you` — already the private, per-viewer half PRD §18/Decision 16 carry
            // `cash` in — is exactly where the viewer's OWN revenue belongs, for the same
            // reason: it is derived from this player's own menu and pricing. Same source and
            // same null-before-`service` guard as `cash` (`match.kitchen` does not exist before
            // `order-system.js`'s own `onPhaseChange('service')`, and is torn down at `results`).
            revenue: this.kitchen?.revenueFor(viewerRestaurantId) ?? null,
            pantry: this.pantry?.publicFor(viewerRestaurantId) ?? null,
            // STORY-036. Private because it includes the viewer's exact live menu availability.
            kitchenCommand: this.kitchenCommand?.privateFor(viewerRestaurantId) ?? null,
            // STORY-037. The combined management diagnosis includes private pantry/menu facts,
            // payroll and this restaurant's conversion history, so it follows those sources
            // under `you` rather than leaking through the public restaurant array.
            managerLedger: this.managerLedger?.privateFor(viewerRestaurantId) ?? null,
            // STORY-043. Restaurant-wide ranked ticket queue — same viewer-scoping reasoning as
            // `kitchenCommand` just above (own restaurant's kitchen only, never the rival's).
            // `[]`, not `null` (unlike `kitchenCommand`): see `GameClientStatus.kitchenQueueBoard`'s
            // own comment on why this field has no meaningful null/empty distinction to carry.
            kitchenQueueBoard: this.kitchen?.queuedTicketsAcrossStations(viewerRestaurantId) ?? [],
            // STORY-052. `scoring-system.js#onPhaseChange('results')` populates
            // `this.finalResults` SYNCHRONOUSLY the instant the match enters `results` — the
            // viewer's own final numbers exist from the phase's first tick, long before
            // `match_complete` arrives at the end of the results-phase timer. Publishing THIS
            // viewer's own slice here lets the client tease the recap early without waiting.
            // Never `this.finalResults` wholesale: that also carries `winnerPlayerId`,
            // `decidingSegment`, `turningPoints` and the RIVAL's own full result, any of which
            // would leak the outcome early or cross PRD §18's privacy boundary. `null` before
            // `results` (this.finalResults is undefined) and also null on a disconnect-triggered
            // end (`#endMatch` with reason !== 'completed' sets `phase = 'results'` directly
            // without `onPhaseChange` ever firing, so `finalResults` never gets set) — both are
            // the honest answer, and `match_complete` follows immediately in the disconnect path
            // anyway, so there is nothing for a teaser to show there.
            resultsPreview: this.finalResults?.results?.[viewerRestaurantId] ?? null,
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
      frontDoor: Object.fromEntries(restaurantIds.map((id) => [id, this.frontDoor?.publicFor(id) ?? { activeSpecialId: null, featuredDishId: null, activeForMs: 0, cooldownForMs: 0, eligibleSpecialIds: [] }])),
      serviceStation: Object.fromEntries(restaurantIds.map((id) => [id, this.serviceStation?.publicFor(id) ?? { priorityId: 'balanced', priorityCooldownForMs: 0, payrollBurn: 0, laborExpenses: 0, contracts: [] }])),
      players: [...this.players.values()].map((p) => ({
        playerId: p.playerId,
        // STORY-039. See `you.restaurantId` above — the client's `remapToRivalFloor` decision
        // (rendering another player as a decorative rival, or as a real teammate on this same
        // floor) reads THIS, not `playerId`, for exactly the same reason.
        restaurantId: this.restaurantIdFor(p.playerId),
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
        carryCapacity: this.upgrades?.ownerCarryCapacity(this.restaurantIdFor(p.playerId)) ?? OWNER_CARRY_CAPACITY,
      })),
    };
  }
}
