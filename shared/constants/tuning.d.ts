export declare const THREE_VERSION: string;
export declare const THREE_CDN_BASE: string;
export declare const SIMULATION_TICK_HZ: number;
export declare const BROADCAST_HZ: number;

/** `smoke` is a script-only preset — see the note on PHASE_DURATIONS_MS in tuning.js. */
export type PhasePreset = 'full' | 'prototype' | 'smoke';
export type MatchPhase =
  | 'lobby'
  | 'market_reveal'
  | 'setup'
  | 'service'
  | 'final_rush'
  | 'results';

export declare const PHASE_DURATIONS_MS: Record<
  PhasePreset,
  Record<MatchPhase, number | null>
>;
export declare const PHASE_PRESETS: readonly PhasePreset[];
export declare const PLAYERS_PER_MATCH: number;

export interface RestaurantBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export declare const RESTAURANT_BOUNDS: RestaurantBounds;

export declare const OWNER_MOVE_SPEED: number;
export declare const OWNER_SPRINT_MULTIPLIER: number;
export declare const OWNER_SPRINT_MAX_MS: number;
export declare const OWNER_SPRINT_COOLDOWN_MS: number;
export declare const RECONNECT_GRACE_MS: number;

// --- events (STORY-011) -------------------------------------------------------------------

export declare const EVENT_MIN_GAP_MS: number;
export declare const EVENT_MAX_GAP_MS: number;
export declare const EVENT_TAIL_MARGIN_MS: number;
export declare const EVENT_MAX_CONCURRENT_HIGH_IMPACT: number;
export declare const EVENT_HIGH_IMPACT_THRESHOLD: number;
export declare const EVENT_ENDED_VISIBLE_MS: number;

export interface EventTeaserLeadBoundsMs {
  min: number;
  max: number;
}
export declare const EVENT_TEASER_LEAD_BOUNDS_MS: EventTeaserLeadBoundsMs;

/** PRD §24 magnitude target, as multiplier bounds. See the note in tuning.js. */
export interface EventDemandShiftBand {
  min: number;
  max: number;
}
export declare const EVENT_DEMAND_SHIFT_BAND: EventDemandShiftBand;
// --- Customer lifecycle — STORY-004 ---------------------------------------------------------

export declare const CUSTOMER_RNG_STREAM: string;
export declare const CUSTOMER_ENTER_DISTRICT_MS: number;
export declare const CUSTOMER_EVALUATE_RESTAURANTS_MS: number;
export declare const CUSTOMER_SEATED_GREET_MS: number;
export declare const CUSTOMER_ORDERING_MS: number;
export declare const CUSTOMER_FOOD_WAIT_MS_RANGE: readonly [number, number];
export declare const CUSTOMER_EATING_MS_RANGE: readonly [number, number];
export declare const CUSTOMER_PAYING_MS: number;
export declare const CUSTOMER_LEAVING_MS: number;
export declare const CUSTOMER_EXIT_LINGER_MS: number;
export declare const CUSTOMER_MAX_SPAWNS_PER_TICK: number;
export declare const CUSTOMER_PROFILE_JITTER: number;
export declare const CUSTOMER_RIVAL_PLACEHOLDER_PROBABILITY: number;
export declare const CUSTOMER_QUEUE_PRESSURE_LEAVE_THRESHOLD: number;
export declare const CUSTOMER_QUEUE_PRESSURE_LEAVE_PROBABILITY: number;

export interface CustomerWaitToleranceShare {
  seating: number;
  ordering: number;
  food: number;
}
export declare const CUSTOMER_WAIT_TOLERANCE_SHARE: CustomerWaitToleranceShare;
export declare const CUSTOMER_VISIT_DURATION_TOLERANCE_MULTIPLIER: number;

export interface CustomerSatisfactionWeights {
  waitToBeSeated: number;
  waitToOrder: number;
  waitForFood: number;
  dishQuality: number;
  dishPreferenceMatch: number;
  priceFairness: number;
  orderAccuracy: number;
  tableCleanliness: number;
  eventRelevance: number;
  recoveryActions: number;
  visitDurationVsPatience: number;
}
export declare const CUSTOMER_SATISFACTION_WEIGHTS: CustomerSatisfactionWeights;
export declare const CUSTOMER_ANGRY_SATISFACTION_THRESHOLD: number;
