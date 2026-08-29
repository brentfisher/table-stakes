// Single source of truth for cross-application constants.
//
// This file is plain JavaScript (with a sibling tuning.d.ts for TypeScript consumers)
// because the server is a vanilla Express JavaScript app per PRD §13 and must not be
// made to compile TypeScript. The client and harnesses import it through Vite, which
// picks up the .d.ts for types.

/**
 * The pinned Three.js version. PRD §13 "Three.js loading": Three.js is loaded from a
 * pinned CDN import map and is never bundled or added as an npm dependency. This constant
 * is the ONLY place the version is written; the import maps in client/index.html and
 * harnesses/index.html are verified against it by scripts/check-threejs-pin.mjs.
 */
export const THREE_VERSION = '0.180.0';
export const THREE_CDN_BASE = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;

/** Authoritative simulation tick rate, Hz. PRD §12 "Tick target": 10-20/sec. */
export const SIMULATION_TICK_HZ = 20;

/** Network state broadcast rate, Hz. PRD §12: 10/sec initially. */
export const BROADCAST_HZ = 10;

/**
 * Match phase durations in milliseconds. PRD §5 gives a full-length pacing target and a
 * shorter first-playable preset for fast balancing and multiplayer testing.
 *
 * A `null` duration means the phase has no deadline and ends on a condition instead — only
 * `lobby` is like that (it ends when every required player has connected and readied).
 *
 * `final_rush` is an ADDITIONAL phase after `service`, not a relabelled tail of it: PRD §5's
 * 10-minute breakdown lists "Main service: 6 minutes" and "Final rush: 1 minute" as separate
 * line items, and they have separate keys here.
 *
 * `smoke` is NOT a gameplay preset. It exists so the whole lifecycle can be driven end to end
 * over a real socket by scripts/smoke-phases.mjs in about eight seconds. Never run a real
 * match on it.
 */
export const PHASE_DURATIONS_MS = {
  full: {
    lobby: null, // variable — ends when both players ready
    market_reveal: 30_000,
    setup: 120_000,
    service: 300_000,
    final_rush: 60_000,
    results: 30_000,
  },
  prototype: {
    lobby: null,
    market_reveal: 15_000,
    setup: 45_000,
    service: 150_000,
    final_rush: 45_000,
    results: 20_000,
  },
  smoke: {
    lobby: null,
    market_reveal: 1_200,
    setup: 2_000,
    service: 2_000,
    final_rush: 1_200,
    results: 1_200,
  },
};

/** Every selectable preset name. `POST /api/rooms` accepts one of these and nothing else. */
export const PHASE_PRESETS = Object.freeze(Object.keys(PHASE_DURATIONS_MS));

/**
 * PRD §12 "Mode": the initial release is 1v1. A match seats this many players; a third
 * joiner is rejected with `match_full` rather than silently seated. A development match
 * created through `POST /api/dev/match` overrides this to 1.
 */
export const PLAYERS_PER_MATCH = 2;

/** Restaurant floor bounds, in world units. The server clamps owner movement to these. */
export const RESTAURANT_BOUNDS = {
  minX: -9,
  maxX: 9,
  minZ: -12,
  maxZ: 12,
};

/** Owner movement. Sprint is server-enforced (PRD §8: limited by stamina or cooldown). */
export const OWNER_MOVE_SPEED = 4.2; // world units / second
export const OWNER_SPRINT_MULTIPLIER = 1.7;
export const OWNER_SPRINT_MAX_MS = 2_500;
export const OWNER_SPRINT_COOLDOWN_MS = 5_000;

/** Reconnect grace period. PRD §13 "Server responsibilities": handle reconnect grace. */
export const RECONNECT_GRACE_MS = 30_000;
