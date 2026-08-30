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
// --- setup phase, PRD §7 (STORY-009) --------------------------------------------------

export declare const STARTING_CASH: number;

export interface MenuPriceBounds {
  minMultiplier: number;
  maxMultiplier: number;
}
export declare const MENU_PRICE_BOUNDS: MenuPriceBounds;

/** Thresholds behind the §7 labels. Never rendered — see the note in tuning.js. */
export interface PriceGuidanceThresholds {
  excellentValueBelow: number;
  competitiveBelow: number;
  premiumBelow: number;
  lowMarginBelow: number;
  strongMarginAbove: number;
}
export declare const PRICE_GUIDANCE_THRESHOLDS: PriceGuidanceThresholds;

export declare const STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT: number;

/** Thresholds behind the §7 briefing's broad indicators. Never rendered — see tuning.js. */
export interface BriefingIndicatorThresholds {
  spendModestBelow: number;
  spendModerateBelow: number;
  spendComfortableBelow: number;
  patienceHurriedBelow: number;
  patienceAverageBelow: number;
}
export declare const BRIEFING_INDICATOR_THRESHOLDS: BriefingIndicatorThresholds;
// --- order system and kitchen production, PRD §17 (STORY-005) -------------------------

import type { Station } from '../schemas/messages';

export declare const ORDER_RNG_STREAM: string;
export declare const STATION_CONCURRENCY: Readonly<Partial<Record<Station, number>>>;
export declare const STATION_DEFAULT_CONCURRENCY: number;
export declare const ORDER_ADDON_PROBABILITY: number;
export declare const ORDER_PREFERRED_TAG_BONUS: number;
export declare const ORDER_DISLIKED_TAG_PENALTY: number;
export declare const ORDER_PRICE_ELASTICITY: number;
export declare const ORDER_OVER_BUDGET_WEIGHT: number;
export declare const ORDER_PASS_HANDOFF_MS: number;
export declare const ORDER_FRESHNESS_GRACE_MS: number;
export declare const ORDER_FRESHNESS_WINDOW_MS: number;
export declare const ORDER_FRESHNESS_FLOOR: number;

export interface OrderQualityWeights {
  correctness: number;
  freshness: number;
  preferenceFit: number;
  serviceTiming: number;
}
export declare const ORDER_QUALITY_WEIGHTS: OrderQualityWeights;
export declare const ORDER_PREFERENCE_TAG_STEP: number;
export declare const ORDER_PRICE_FAIRNESS_SLOPE: number;
export declare const ORDER_SNAPSHOT_LINGER_MS: number;
