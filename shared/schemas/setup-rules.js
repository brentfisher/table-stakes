// The setup CONTRACT: the rules both the client and the server must agree on about a menu.
// PRD §7 "Menu constraints", "Pricing"; PRD §18 "Setup UI".
//
// Plain JavaScript with a sibling setup-rules.d.ts (design Decision 4). It is pure and
// browser-safe — no `fs`, no catalogue loading, no match state — so the client can grey out an
// illegal option and the server can reject it using the same function. That is Milestone 0
// Decision 2 done honestly: the client's disabling is UX, and
// `server/src/game/validators/setup-validator.js` re-derives every rule here from scratch on
// the authoritative side.
//
// WHY THIS FILE IS NOT `validation.js`: Decision 11 splits SHAPE from AUTHORITY.
// `validation.js` answers "is this a well-formed setup_submit"; this module answers "is this
// menu legal given the catalogue and the layout", which needs data validation.js never sees.
//
// ============================================================================================
// PRD §7 "Pricing", non-negotiable: "The UI should display qualitative guidance, not exact
// customer utility math." `priceGuidance()` therefore returns LABEL STRINGS ONLY. It has no
// numeric field, no score, no ratio and no projected conversion — there is deliberately
// nothing for a UI to render by mistake. The thresholds it compares against live in
// tuning.js and stay there.
// ============================================================================================

import {
  BRIEFING_INDICATOR_THRESHOLDS,
  MENU_PRICE_BOUNDS,
  PRICE_GUIDANCE_THRESHOLDS,
} from '../constants/tuning.js';
import { MENU_ADDON_SLOTS, MENU_MAIN_SLOTS } from './messages.js';

/**
 * PRD §7 "Menu constraints": "Players choose up to 2 add-ons: drinks, desserts, or sides."
 * `snack` is deliberately NOT here — PRD §12's own `setup_submit` example puts `nachos`
 * (category `snack`) in `menu[]`, so a rule of "mains must be entrees" would make the PRD's
 * example illegal. A main is anything that is not an add-on category.
 */
export const ADDON_CATEGORIES = Object.freeze(['drink', 'dessert', 'side']);

export const isAddonCategory = (category) => ADDON_CATEGORIES.includes(category);
export const isMainCategory = (category) => !ADDON_CATEGORIES.includes(category);

/**
 * The six PRD §7 labels, VERBATIM. This is the entire vocabulary of price feedback the player
 * ever sees; a seventh string, or any number, is a bug.
 */
export const PRICE_GUIDANCE_LABELS = Object.freeze({
  EXCELLENT_VALUE: 'Excellent value',
  COMPETITIVE: 'Competitive',
  PREMIUM: 'Premium',
  TOO_EXPENSIVE: 'Likely too expensive for this market',
  LOW_MARGIN: 'Low margin',
  STRONG_MARGIN: 'Strong margin, demand risk',
});

/** Every legal label, for a UI that wants to enumerate them and for the check script. */
export const PRICE_GUIDANCE_LABEL_LIST = Object.freeze(Object.values(PRICE_GUIDANCE_LABELS));

/** Every reason `setup-validator.js` may refuse a submission for. Machine codes, snake_case. */
export const SETUP_REJECTION_REASONS = Object.freeze([
  'malformed_submission',
  'wrong_phase',
  'wrong_main_count',
  'too_many_addons',
  'unknown_dish',
  'duplicate_dish',
  'invalid_main_category',
  'invalid_addon_category',
  'price_out_of_range',
  'dish_not_producible',
  'unknown_upgrade',
  'upgrade_unaffordable',
  'unknown_ingredient',
  'invalid_inventory_quantity',
  'inventory_over_budget',
  'unknown_worker',
  'worker_unassigned',
  'invalid_station_assignment',
  'unknown_policy',
  'invalid_policy_target',
]);

/** Money is dollars-and-cents everywhere. Round once, here, so nobody drifts by a half-cent. */
export const toCents = (value) => Math.round(value * 100) / 100;

/**
 * PRD §7 "Pricing": the bounded range a menu item's price must sit in, derived from that
 * dish's own `suggestedPrice`. Rounded to whole cents so the client's input `min`/`max` and
 * the server's comparison are the same two numbers — `0.6 * 14` is 8.399999999999999 in
 * IEEE-754, and a boundary test against that is a coin flip.
 */
export function priceBoundsFor(dish) {
  const suggested = Number(dish?.suggestedPrice);
  if (!Number.isFinite(suggested) || suggested <= 0) return null;
  return {
    minPrice: toCents(suggested * MENU_PRICE_BOUNDS.minMultiplier),
    maxPrice: toCents(suggested * MENU_PRICE_BOUNDS.maxMultiplier),
  };
}

/** True when `price` is inside the dish's bounded range, inclusive of both endpoints. */
export function isPriceInRange(dish, price) {
  const bounds = priceBoundsFor(dish);
  if (!bounds || !Number.isFinite(price)) return false;
  // Compare in cents: the caller's price may itself be a float from a slider.
  const cents = Math.round(price * 100);
  return cents >= Math.round(bounds.minPrice * 100) && cents <= Math.round(bounds.maxPrice * 100);
}

/** The set of station ids a layout physically has, from its `station` entities. */
export function layoutStations(layout) {
  return new Set(
    (layout?.entities ?? []).filter((e) => e.type === 'station').map((e) => e.station),
  );
}

/** The distinct stations a dish's `stationSteps` route through. */
export function dishStations(dish) {
  return new Set((dish?.stationSteps ?? []).map((step) => step.station));
}

/**
 * PRD §7 "Menu constraints": "Every dish must be physically producible by a station in the
 * restaurant." A dish whose steps route through a station this layout does not have can never
 * be cooked, so it may not go on the menu — no matter what the client's UI allowed.
 */
export function isProducible(dish, layout) {
  const available = layoutStations(layout);
  const required = dishStations(dish);
  if (required.size === 0) return false;
  for (const station of required) if (!available.has(station)) return false;
  return true;
}

/** The stations a dish needs that this layout does not have. For the rejection detail. */
export function missingStationsFor(dish, layout) {
  const available = layoutStations(layout);
  return [...dishStations(dish)].filter((station) => !available.has(station));
}

/**
 * PRD §7's qualitative price guidance. Returns LABELS ONLY:
 *
 *   { valueLabel: <one of the four value labels>, marginLabel: <a margin label or null> }
 *
 * There is no number in the return value and there must never be one. The value axis scales
 * the price's deviation from the dish's suggested price by the market's `priceSensitivity`,
 * so the suggested price always reads "Competitive" and it is the district that decides how
 * far above that becomes "Likely too expensive for this market". `marginLabel` is null in the
 * comfortable middle — silence is a legitimate answer and beats inventing a seventh label.
 */
export function priceGuidance(dish, price, market = null) {
  const suggested = Number(dish?.suggestedPrice);
  if (!Number.isFinite(suggested) || suggested <= 0 || !Number.isFinite(price) || price <= 0) {
    return { valueLabel: null, marginLabel: null };
  }

  const sensitivity = Number.isFinite(market?.priceSensitivity) ? market.priceSensitivity : 1;
  const adjusted = 1 + (price / suggested - 1) * sensitivity;

  const t = PRICE_GUIDANCE_THRESHOLDS;
  let valueLabel;
  if (adjusted < t.excellentValueBelow) valueLabel = PRICE_GUIDANCE_LABELS.EXCELLENT_VALUE;
  else if (adjusted < t.competitiveBelow) valueLabel = PRICE_GUIDANCE_LABELS.COMPETITIVE;
  else if (adjusted < t.premiumBelow) valueLabel = PRICE_GUIDANCE_LABELS.PREMIUM;
  else valueLabel = PRICE_GUIDANCE_LABELS.TOO_EXPENSIVE;

  const baseCost = Number(dish?.baseCost);
  let marginLabel = null;
  if (Number.isFinite(baseCost)) {
    const margin = (price - baseCost) / price;
    if (margin < t.lowMarginBelow) marginLabel = PRICE_GUIDANCE_LABELS.LOW_MARGIN;
    else if (margin > t.strongMarginAbove) marginLabel = PRICE_GUIDANCE_LABELS.STRONG_MARGIN;
  }

  return { valueLabel, marginLabel };
}

/** The dishes a player may legally put in a main slot, given the layout. */
export function selectableMains(dishes, layout) {
  return dishes.filter((d) => isMainCategory(d.category) && isProducible(d, layout));
}

/** The dishes a player may legally put in an add-on slot, given the layout. */
export function selectableAddons(dishes, layout) {
  return dishes.filter((d) => isAddonCategory(d.category) && isProducible(d, layout));
}

/** The §14 layout's worker roster and the posts each worker may be assigned to (PRD §7). */
export function rosterOf(layout) {
  return layout?.staff?.roster ?? [];
}

export function postsOf(layout) {
  return layout?.staff?.posts ?? [];
}

/** The cost in dollars of a `{ingredientId: units}` allocation, or null if any id is unknown. */
export function inventoryCost(allocation, ingredients) {
  let total = 0;
  for (const [ingredientId, units] of Object.entries(allocation ?? {})) {
    const unitCost = ingredients?.[ingredientId]?.unitCost;
    if (!Number.isFinite(unitCost)) return null;
    total += unitCost * units;
  }
  return toCents(total);
}

/**
 * PRD §7's setup briefing: "Broad spending and patience indicators". Broad — a label, never
 * the segment's budget or its `patienceSeconds`. Same discipline as `priceGuidance`: the
 * player reads the market, not the simulation's parameters.
 */
export const SPENDING_INDICATORS = Object.freeze(['Modest', 'Moderate', 'Comfortable', 'High']);
export const PATIENCE_INDICATORS = Object.freeze(['In a hurry', 'Average', 'Patient']);

export function spendingIndicator(segment) {
  const t = BRIEFING_INDICATOR_THRESHOLDS;
  const budget = Number(segment?.budget);
  if (!Number.isFinite(budget)) return null;
  if (budget < t.spendModestBelow) return SPENDING_INDICATORS[0];
  if (budget < t.spendModerateBelow) return SPENDING_INDICATORS[1];
  if (budget < t.spendComfortableBelow) return SPENDING_INDICATORS[2];
  return SPENDING_INDICATORS[3];
}

export function patienceIndicator(segment) {
  const t = BRIEFING_INDICATOR_THRESHOLDS;
  const seconds = Number(segment?.patienceSeconds);
  if (!Number.isFinite(seconds)) return null;
  if (seconds < t.patienceHurriedBelow) return PATIENCE_INDICATORS[0];
  if (seconds < t.patienceAverageBelow) return PATIENCE_INDICATORS[1];
  return PATIENCE_INDICATORS[2];
}

/**
 * The §18 briefing's customer forecast: which segments this district draws, most likely
 * first, each with its broad indicators. `share` is the market's own `segmentWeights` value —
 * the one number the briefing does show, because PRD §5's market reveal is explicitly a
 * "customer segment forecast" and both players receive it identically.
 */
export function segmentForecast(market, segments) {
  const weights = market?.segmentWeights ?? {};
  return segments
    .filter((segment) => weights[segment.id] > 0)
    .map((segment) => ({
      id: segment.id,
      name: segment.name,
      primaryPriority: segment.primaryPriority,
      share: weights[segment.id],
      spending: spendingIndicator(segment),
      patience: patienceIndicator(segment),
      preferredTags: [...segment.preferredTags],
    }))
    .sort((a, b) => b.share - a.share);
}

export { MENU_MAIN_SLOTS, MENU_ADDON_SLOTS };
