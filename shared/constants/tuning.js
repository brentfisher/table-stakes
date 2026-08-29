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

// --- events (STORY-011) -------------------------------------------------------------------
// PRD §9 "Dynamic events". Every number the seeded event deck uses lives here; `events.json`
// owns what an event DOES, this file owns when and how often one may happen.

/**
 * PRD §9 "Event cadence": "announced every 30-60 seconds during the service phase". These are
 * the bounds on the gap between one event's activation and the next, and the gap from the
 * start of service to the first activation.
 */
export const EVENT_MIN_GAP_MS = 30_000;
export const EVENT_MAX_GAP_MS = 60_000;

/**
 * An event scheduled this close to the end of the service window is not scheduled at all.
 * An event that activates two seconds before the doors shut is a notification, not a decision,
 * and PRD §9's first design rule is that an event must create an actionable decision.
 */
export const EVENT_TAIL_MARGIN_MS = 10_000;

/**
 * PRD §9 design rule: "Do not stack more than two high-impact events at once in MVP." The deck
 * builder enforces this while placing cards; it is not left to the cadence to make it unlikely.
 */
export const EVENT_MAX_CONCURRENT_HIGH_IMPACT = 2;

/**
 * How far an event's §16 district-level multipliers must move away from 1.0 for it to count as
 * "high impact". Measured as the largest absolute deviation from neutral across
 * `footTrafficMultiplier`, `partySizeMultiplier` and `dishTagDemandMultipliers` — the three
 * §16 keys that distort district DEMAND, which is what §9's stacking rule is about.
 */
export const EVENT_HIGH_IMPACT_THRESHOLD = 0.3;

/**
 * How long an event stays in `match_snapshot.events` with `state: 'ended'` after it finishes.
 * PRD §9 announcement flow step 5 is "event ends or transitions to the next event", and a
 * banner that vanishes on the same frame the effect stops never gets read.
 */
export const EVENT_ENDED_VISIBLE_MS = 5_000;

/**
 * PRD §9 announcement flow step 1: "a teaser or forecast appears 10-20 seconds before
 * activation when appropriate". `warningMs` of 0 in `events.json` means "not appropriate" —
 * nothing in the district telegraphs a power dip. Any NON-zero `warningMs` must fall in here.
 */
export const EVENT_TEASER_LEAD_BOUNDS_MS = Object.freeze({ min: 10_000, max: 20_000 });

/**
 * PRD §24: "Events should move demand materially enough that players notice: roughly 15-40%
 * for strong event-dish affinity, not 2-5%." Expressed as MULTIPLIER bounds rather than as
 * shifts on purpose: `1.15 - 1` is `0.14999999999999991` in IEEE-754, so a shift-based check
 * rejects an event authored at exactly the documented floor. Same class of trap as
 * `SEGMENT_WEIGHT_TOLERANCE` in `loader.js`; comparing the multipliers themselves is exact.
 */
export const EVENT_DEMAND_SHIFT_BAND = Object.freeze({ min: 1.15, max: 1.4 });
