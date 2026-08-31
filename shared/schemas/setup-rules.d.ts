// Type declarations for setup-rules.js. PRD §7 "Menu constraints" and "Pricing".
//
// Note what `PriceGuidance` deliberately does NOT have: a score, a ratio, a conversion
// probability, a projected wait. PRD §7 forbids showing the simulation's math, and the
// cheapest way to keep that promise is a return type with nowhere to put a number.

import type { DishCategory } from './messages';

export interface DishStationStep {
  station: string;
  durationMs: number;
}

/** One entry of shared/game-data/dishes.json `dishes[]`. */
export interface Dish {
  id: string;
  name: string;
  category: DishCategory;
  tags: string[];
  ingredients: Record<string, number>;
  baseCost: number;
  suggestedPrice: number;
  stationSteps: DishStationStep[];
  baseSatisfaction: number;
  marketAffinity: Record<string, number>;
}

export interface Ingredient {
  name: string;
  unitCost: number;
}

export interface LayoutStaffPost {
  id: string;
  label: string;
  entityId?: string;
  zoneId?: string;
  station?: string;
}

export interface LayoutWorker {
  id: string;
  name: string;
  role: string;
  description: string;
  posts: string[];
}

export declare const ADDON_CATEGORIES: readonly DishCategory[];
export declare function isAddonCategory(category: string): boolean;
export declare function isMainCategory(category: string): boolean;

export type PriceValueLabel =
  | 'Excellent value'
  | 'Competitive'
  | 'Premium'
  | 'Likely too expensive for this market';

export type PriceMarginLabel = 'Low margin' | 'Strong margin, demand risk';

export interface PriceGuidanceLabels {
  EXCELLENT_VALUE: 'Excellent value';
  COMPETITIVE: 'Competitive';
  PREMIUM: 'Premium';
  TOO_EXPENSIVE: 'Likely too expensive for this market';
  LOW_MARGIN: 'Low margin';
  STRONG_MARGIN: 'Strong margin, demand risk';
}
export declare const PRICE_GUIDANCE_LABELS: PriceGuidanceLabels;
export declare const PRICE_GUIDANCE_LABEL_LIST: readonly (PriceValueLabel | PriceMarginLabel)[];

export type SetupRejectionReason =
  | 'malformed_submission'
  | 'wrong_phase'
  | 'wrong_main_count'
  | 'too_many_addons'
  | 'unknown_dish'
  | 'duplicate_dish'
  | 'invalid_main_category'
  | 'invalid_addon_category'
  | 'price_out_of_range'
  | 'dish_not_producible'
  | 'unknown_upgrade'
  | 'upgrade_unaffordable'
  | 'unknown_ingredient'
  | 'invalid_inventory_quantity'
  | 'inventory_over_budget'
  | 'unknown_worker'
  | 'worker_unassigned'
  | 'invalid_station_assignment'
  | 'unknown_policy'
  | 'invalid_policy_target';

export declare const SETUP_REJECTION_REASONS: readonly SetupRejectionReason[];

export declare function toCents(value: number): number;

export interface PriceBounds {
  minPrice: number;
  maxPrice: number;
}
export declare function priceBoundsFor(dish: Dish): PriceBounds | null;
export declare function isPriceInRange(dish: Dish, price: number): boolean;

export declare function layoutStations(layout: unknown): Set<string>;
export declare function dishStations(dish: Dish): Set<string>;
export declare function isProducible(dish: Dish, layout: unknown): boolean;
export declare function missingStationsFor(dish: Dish, layout: unknown): string[];

/** Labels only — see the header note. `marginLabel` is null in the comfortable middle. */
export interface PriceGuidance {
  valueLabel: PriceValueLabel | null;
  marginLabel: PriceMarginLabel | null;
}
export declare function priceGuidance(
  dish: Dish,
  price: number,
  market?: { priceSensitivity?: number } | null,
): PriceGuidance;

export declare function selectableMains(dishes: Dish[], layout: unknown): Dish[];
export declare function selectableAddons(dishes: Dish[], layout: unknown): Dish[];

export declare function rosterOf(layout: unknown): LayoutWorker[];
export declare function postsOf(layout: unknown): LayoutStaffPost[];

export declare function inventoryCost(
  allocation: Record<string, number>,
  ingredients: Record<string, Ingredient>,
): number | null;

export type SpendingIndicator = 'Modest' | 'Moderate' | 'Comfortable' | 'High';
export type PatienceIndicator = 'In a hurry' | 'Average' | 'Patient';

export declare const SPENDING_INDICATORS: readonly SpendingIndicator[];
export declare const PATIENCE_INDICATORS: readonly PatienceIndicator[];

/** Labels only — the §7 briefing shows "broad" indicators, never budget or patienceSeconds. */
export declare function spendingIndicator(segment: {
  budget?: number;
}): SpendingIndicator | null;
export declare function patienceIndicator(segment: {
  patienceSeconds?: number;
}): PatienceIndicator | null;

export interface SegmentForecastEntry {
  id: string;
  name: string;
  primaryPriority: string;
  /** The market's own `segmentWeights` share — PRD §5 reveals the forecast to both players. */
  share: number;
  spending: SpendingIndicator | null;
  patience: PatienceIndicator | null;
  preferredTags: string[];
}

export declare function segmentForecast(
  market: { segmentWeights?: Record<string, number> } | null,
  segments: Array<{
    id: string;
    name: string;
    primaryPriority: string;
    budget: number;
    patienceSeconds: number;
    preferredTags: string[];
  }>,
): SegmentForecastEntry[];

/**
 * PRD §7 item 3: a sensible opening pantry for a menu, trimmed to what `cash * cashShare` buys.
 * STORY-006's inventory model seeds a restaurant's pantry from the allocation this produces when
 * the player never submitted one.
 */
export declare function defaultInventoryAllocation(
  dishes: Array<{ ingredients?: Record<string, number> }>,
  ingredients: Record<string, { unitCost: number }>,
  opts: {
    cash: number;
    cashShare: number;
    servings: number;
    maxUnitsPerIngredient: number;
  },
): Record<string, number>;

export declare const MENU_MAIN_SLOTS: number;
export declare const MENU_ADDON_SLOTS: number;

/** One priced slot of an accepted submission. Mirrors `MenuSelection` on the wire. */
export interface AcceptedMenuSlot {
  dishId: string;
  price: number;
}

/**
 * A setup submission the server has ACCEPTED — the normalized, validated form
 * `setup-validator.js` produces and `match_snapshot.you.setup` carries.
 *
 * PRD §18 forbids revealing the opponent's menu or prices during setup, so this appears under
 * `you` and nowhere else in a snapshot (Decision 16). The money fields are server-computed:
 * PRD §12 "Networking model" forbids the browser calculating any of it.
 */
export interface AcceptedSetup {
  menu: AcceptedMenuSlot[];
  addons: AcceptedMenuSlot[];
  startingUpgradeId: string | null;
  staffAssignments: Record<string, string>;
  /** Units per ingredient id. STORY-006 owns the model this allocates against. */
  startingInventory: Record<string, number>;
  policyId: string | null;
  /** The dish a `requiresMenuDish` policy targets; null for every other policy. */
  policyDishId: string | null;
  upgradeCost: number;
  inventoryCost: number;
  cashRemaining: number;
  /** Match-clock ms at which the submission was accepted. */
  submittedAtMs: number;
  /** True once service has started: PRD §7/§20 forbid mid-match menu changes. */
  locked: boolean;
  /** True when the server supplied this because the player never submitted one. */
  autoFilled: boolean;
}
