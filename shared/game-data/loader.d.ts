// Type declarations for loader.js, plus the catalogue entity shapes the JSON files carry.
// NODE ONLY — see the header of loader.js. Browser code imports the JSON directly.

import type { DishCategory, Station } from '../schemas/messages';

export interface Ingredient {
  name: string;
  /** Restock price of one unit, in dollars. Not required to sum to a dish's `baseCost`. */
  unitCost: number;
}

export interface StationStep {
  station: Station;
  durationMs: number;
}

/** PRD §16 "Dish definition example". */
export interface Dish {
  id: string;
  name: string;
  category: DishCategory;
  tags: string[];
  /** Keyed by an id declared in dishes.json `ingredients`. Values are positive integers. */
  ingredients: Record<string, number>;
  baseCost: number;
  suggestedPrice: number;
  stationSteps: StationStep[];
  baseSatisfaction: number;
  /** Keyed by market id. > 1 means the dish over-performs in that district. */
  marketAffinity: Record<string, number>;
}

/** PRD §16 "Market definition example". */
export interface Market {
  id: string;
  name: string;
  daypart: string;
  description: string;
  /** Keyed by segment id. Sums to 1.0 within SEGMENT_WEIGHT_TOLERANCE. */
  segmentWeights: Record<string, number>;
  priceSensitivity: number;
  baseFootTrafficPerMinute: number;
  preferredTags: string[];
  /** Event ids drawn from by the seeded event deck. */
  eventPool: string[];
}

/** PRD §6 "Customer segments". `patienceSeconds` is the deliberate seconds-named exception. */
export interface CustomerSegment {
  id: string;
  name: string;
  primaryPriority: string;
  budget: number;
  patienceSeconds: number;
  preferredTags: string[];
  dislikedTags: string[];
  partySize: number;
  serviceSpeedWeight: number;
  priceWeight: number;
  menuFitWeight: number;
  reputationWeight: number;
}

/**
 * PRD §16 "Event definition example". The first four keys are the shared vocabulary present on
 * every event; the rest express §9 effects that vocabulary cannot, and appear only where the
 * §9 table describes them.
 */
export interface EventEffects {
  footTrafficMultiplier: number;
  segmentWeightOverrides: Record<string, number>;
  dishTagDemandMultipliers: Record<string, number>;
  partySizeMultiplier: number;

  patienceMultiplier?: number;
  priceSensitivityMultiplier?: number;
  reputationRewardMultiplier?: number;
  trailingBurstMultiplier?: number;
  stationSpeedMultipliers?: Partial<Record<Station, number>>;
  affectedIngredientCount?: number;
  ingredientRestockDurationMultiplier?: number;
  ingredientCostMultiplier?: number;
  specialPartySpawn?: {
    segment: string;
    partySize: number;
    budgetMultiplier: number;
    reputationImpactMultiplier: number;
  };
}

export interface GameEvent {
  id: string;
  title: string;
  description: string;
  warningMs: number;
  durationMs: number;
  effects: EventEffects;
}

/** PRD §10 "Upgrades". `effects` keys are read by systems, never rendered as prose. */
export interface Upgrade {
  id: string;
  name: string;
  category: string;
  cost: number;
  tier: number;
  description: string;
  /** Id of the upgrade this one supersedes, when it is tier 2+. */
  requires?: string;
  effects: Record<string, unknown>;
}

export interface RestaurantLayout {
  id: string;
  name: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  zones: Array<{ id: string; label: string; min: [number, number]; max: [number, number] }>;
  entities: Array<Record<string, unknown>>;
  spawn: Record<string, [number, number, number]>;
}

export interface RawCatalogue {
  dishes: { ingredients: Record<string, Ingredient>; dishes: Dish[] };
  markets: { markets: Market[] };
  segments: { segments: CustomerSegment[] };
  events: { events: GameEvent[] };
  upgrades: { upgrades: Upgrade[] };
  layout: RestaurantLayout;
}

export interface Catalogue {
  ingredients: Record<string, Ingredient>;
  dishes: Dish[];
  markets: Market[];
  segments: CustomerSegment[];
  events: GameEvent[];
  upgrades: Upgrade[];
  layout: RestaurantLayout;

  dishesById: Readonly<Record<string, Dish>>;
  marketsById: Readonly<Record<string, Market>>;
  segmentsById: Readonly<Record<string, CustomerSegment>>;
  eventsById: Readonly<Record<string, GameEvent>>;
  upgradesById: Readonly<Record<string, Upgrade>>;
}

/** See loader.js — the tolerance exists because 0.55+0.10+0.20+0.05+0.10 !== 1 in float. */
export declare const SEGMENT_WEIGHT_TOLERANCE: number;

export declare class CatalogueError extends Error {
  readonly errors: string[];
  constructor(errors: string[]);
}

export declare function readCatalogueFiles(dir?: string): RawCatalogue;

/** Pure. Returns every problem found; an empty array means the catalogue is consistent. */
export declare function validateCatalogue(raw: RawCatalogue): string[];

/** Reads, validates and indexes. Throws CatalogueError listing every problem. */
export declare function loadCatalogue(dir?: string): Catalogue;
