// One match's authoritative state.
//
// SCOPE (STORY-001 / PRD §21 Milestone 0): this owns the seed, the connected players, and
// their server-clamped positions. There are no customers, orders, workers, menus, money or
// events yet — each has its own story. The phase machine proper is STORY-003; Milestone 0
// parks every match in a single `service` phase so movement replication can be exercised.

import { createRng } from './rng.js';
import { RESTAURANT_BOUNDS, OWNER_MOVE_SPEED, OWNER_SPRINT_MULTIPLIER,
         OWNER_SPRINT_MAX_MS, OWNER_SPRINT_COOLDOWN_MS } from '../../../shared/constants/tuning.js';
import layout from '../../../shared/game-data/restaurant-layout.json' with { type: 'json' };

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export class Match {
  constructor({ id, seed, phasePreset = 'prototype' }) {
    this.id = id;
    this.seed = seed;
    this.phasePreset = phasePreset;
    this.rng = createRng(seed);
    this.createdAt = Date.now();
    this.startedAt = Date.now();
    this.phase = 'service';
    this.players = new Map();

    // Deterministic per-match configuration. Everything drawn here comes from the seed, so
    // two matches created with the same seed produce identical configuration.
    this.config = this.#generateConfig();
  }

  #generateConfig() {
    // Milestone 0 has one layout and no market catalogue (STORY-002 adds markets.json).
    // The draw is still made through the seeded stream so the determinism check is real.
    const draw = this.rng();
    return {
      layoutId: layout.id,
      // Placeholder market slot — STORY-002/003 replace this with a real markets.json pick.
      marketIndex: Math.floor(draw * 3),
      spawnJitter: Number(this.rng().toFixed(6)),
    };
  }

  addPlayer(playerId) {
    if (!this.players.has(playerId)) {
      const [x, y, z] = layout.spawn.owner;
      // Offset the second owner so two avatars are distinguishable at spawn.
      const offset = this.players.size * 2.5;
      this.players.set(playerId, {
        playerId,
        position: { x: clamp(x + offset, RESTAURANT_BOUNDS.minX, RESTAURANT_BOUNDS.maxX), y, z },
        facing: 0,
        sprinting: false,
        sprintRemainingMs: OWNER_SPRINT_MAX_MS,
        sprintCooldownMs: 0,
        lastSequence: 0,
        connected: true,
        input: { x: 0, z: 0, sprint: false },
      });
    }
    const player = this.players.get(playerId);
    player.connected = true;
    return player;
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (player) player.connected = false;
  }

  /**
   * Record a movement intent. The client sends intent only — it never sends a position.
   * PRD §12 "Networking model": the browser is not trusted to compute outcomes.
   */
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

  /** Advance the simulation by dtMs. Called by the simulation loop, never by a client. */
  tick(dtMs) {
    const dt = dtMs / 1000;
    for (const player of this.players.values()) {
      const wantsSprint = player.input.sprint && player.sprintCooldownMs <= 0 && player.sprintRemainingMs > 0;

      if (wantsSprint) {
        player.sprinting = true;
        player.sprintRemainingMs = Math.max(0, player.sprintRemainingMs - dtMs);
        if (player.sprintRemainingMs === 0) player.sprintCooldownMs = OWNER_SPRINT_COOLDOWN_MS;
      } else {
        player.sprinting = false;
        if (player.sprintCooldownMs > 0) {
          player.sprintCooldownMs = Math.max(0, player.sprintCooldownMs - dtMs);
          if (player.sprintCooldownMs === 0) player.sprintRemainingMs = OWNER_SPRINT_MAX_MS;
        } else if (player.sprintRemainingMs < OWNER_SPRINT_MAX_MS) {
          player.sprintRemainingMs = Math.min(OWNER_SPRINT_MAX_MS, player.sprintRemainingMs + dtMs * 0.5);
        }
      }

      // Normalize so diagonal movement is not faster than axis-aligned movement.
      const len = Math.hypot(player.input.x, player.input.z);
      if (len > 0) {
        const speed = OWNER_MOVE_SPEED * (player.sprinting ? OWNER_SPRINT_MULTIPLIER : 1);
        const nx = (player.input.x / len) * speed * dt;
        const nz = (player.input.z / len) * speed * dt;
        // THE authority check: the server clamps, so an out-of-bounds intent cannot
        // produce an out-of-bounds broadcast position.
        player.position.x = clamp(player.position.x + nx, RESTAURANT_BOUNDS.minX, RESTAURANT_BOUNDS.maxX);
        player.position.z = clamp(player.position.z + nz, RESTAURANT_BOUNDS.minZ, RESTAURANT_BOUNDS.maxZ);
      }
    }
  }

  /** PRD §12 "Server-to-client": match_snapshot. Empty collections are the Milestone 0 shape. */
  toSnapshot() {
    return {
      type: 'match_snapshot',
      serverTime: Date.now() - this.startedAt,
      matchPhase: this.phase,
      timeRemainingMs: null,
      events: [],
      restaurants: [],
      customers: [],
      orders: [],
      players: [...this.players.values()].map((p) => ({
        playerId: p.playerId,
        position: { x: p.position.x, y: p.position.y, z: p.position.z },
        facing: p.facing,
        sprinting: p.sprinting,
        connected: p.connected,
        lastSequence: p.lastSequence,
      })),
    };
  }
}
