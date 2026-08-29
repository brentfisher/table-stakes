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
