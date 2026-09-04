// Builds a legal `setup_submit` payload for the bot, weighted toward the active market — PRD
// §12/§20's bot fallback, STORY-017 AC3: "the bot picks a menu and prices with some relation
// to the active market ... rather than a fixed hardcoded menu."
//
// PURE. This module reads the catalogue, the layout and the market, draws from the caller's
// own RNG function, and returns a plain object shaped exactly like a client's `setup_submit`
// message. It never touches a match, a socket or the validator — `bot-controller.js` is the
// only thing that SENDS what this builds, through the exact same `setup-validator.js` a
// human's browser goes through (STORY-017 AC2). That split mirrors the one `setup-rules.js` /
// `setup-validator.js` already draw between "what's legal" and "what a body decides to do", and
// keeps this file trivially callable from a check script with no match, no socket and no RNG
// side effects beyond the function it was handed.

import { MENU_ADDON_SLOTS, MENU_MAIN_SLOTS } from '../../../../shared/schemas/messages.js';
import {
  defaultInventoryAllocation,
  priceBoundsFor,
  rosterOf,
  selectableAddons,
  selectableMains,
  toCents,
} from '../../../../shared/schemas/setup-rules.js';
import {
  BOT_MARKET_AFFINITY_WEIGHT,
  BOT_MENU_PRICE_JITTER,
  BOT_PRICE_SENSITIVITY_LEAN,
  BOT_TAG_MATCH_WEIGHT,
  STARTING_CASH,
  STARTING_INVENTORY_DEFAULT_CASH_SHARE,
  STARTING_INVENTORY_DEFAULT_SERVINGS,
  STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT,
} from '../../../../shared/constants/tuning.js';

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

/**
 * How much `dish` fits the active market: one point per dish tag that matches the market's own
 * `preferredTags` — the AC's named signal — plus a smaller bonus from the dish's own catalogued
 * `marketAffinity` for this market, when the dish declares one. Both are real catalogue data
 * (see `shared/game-data/dishes.json`); this is never a fixed menu that happens to validate.
 */
function marketFitScore(dish, market) {
  const preferred = new Set(market?.preferredTags ?? []);
  const tagMatches = (dish.tags ?? []).filter((tag) => preferred.has(tag)).length;
  const affinity = dish.marketAffinity?.[market?.id] ?? 1; // 1 = neutral, matching order-system.js's own convention
  return tagMatches * BOT_TAG_MATCH_WEIGHT + (affinity - 1) * BOT_MARKET_AFFINITY_WEIGHT;
}

/** Highest market fit first; ties broken by the bot's own RNG draw so two dishes tied on fit do
 * not always resolve the same way, while the whole ranking still replays identically from the
 * same seed (the draw comes from `rng`, never `Math.random()`). */
function rankByMarketFit(dishes, market, rng) {
  return dishes
    .map((dish) => ({ dish, score: marketFitScore(dish, market), jitter: rng() }))
    .sort((a, b) => b.score - a.score || b.jitter - a.jitter)
    .map((entry) => entry.dish);
}

/** A price inside `priceBoundsFor(dish)`, leaned toward the low or high end of that band by the
 * market's `priceSensitivity` and nudged by the bot's own RNG stream. This is a heuristic, not
 * the market's real demand curve — the bot has no more insight into `order-system.js`'s price-
 * elasticity math than a human reading `priceGuidance()`'s qualitative labels would. */
function choosePrice(dish, market, rng) {
  const bounds = priceBoundsFor(dish);
  if (!bounds) return Number(dish.suggestedPrice) || 0;
  const sensitivity = Number.isFinite(market?.priceSensitivity) ? market.priceSensitivity : 1;
  const lean = clamp(0.5 - (sensitivity - 1) * BOT_PRICE_SENSITIVITY_LEAN, 0.1, 0.9);
  const jitter = (rng() - 0.5) * 2 * BOT_MENU_PRICE_JITTER;
  const t = clamp(lean + jitter, 0.02, 0.98);
  return toCents(bounds.minPrice + t * (bounds.maxPrice - bounds.minPrice));
}

/**
 * Post the cook to whichever station this chosen menu leans on hardest; post the server to
 * `dining_room` — the same first-listed post `defaultSubmission()` falls back to, so a bot
 * restaurant's front-of-house behaves exactly like the fallback everyone already exercises.
 */
function chooseStaffAssignments(layout, mains, addons) {
  const usage = new Map();
  for (const dish of [...mains, ...addons]) {
    for (const step of dish.stationSteps ?? []) {
      usage.set(step.station, (usage.get(step.station) ?? 0) + 1);
    }
  }
  const assignments = {};
  for (const worker of rosterOf(layout)) {
    if (worker.role === 'cook') {
      const [best] = worker.posts
        .map((post) => ({ post, count: usage.get(post) ?? 0 }))
        .sort((a, b) => b.count - a.count);
      assignments[worker.id] = best?.post ?? worker.posts[0];
    } else {
      assignments[worker.id] = worker.posts[0];
    }
  }
  return assignments;
}

/**
 * @param {object} args
 * @param {{dishes: object[], ingredients: object}} args.catalogue  the loaded catalogue
 * @param {object} args.layout                                     the restaurant layout
 * @param {object} args.market   the active market — reads `id`/`preferredTags`/
 *                                `priceSensitivity`, all public (§12 room-flow step 5)
 * @param {() => number} args.rng  `match.createRngStream(BOT_RNG_STREAM)` — see
 *                                  `bot-controller.js`. Never `Math.random()`.
 * @param {number} [args.startingCash]
 * @returns {object} a `setup_submit`-shaped message, UNVALIDATED — the caller sends it through
 *                    the real `setup-validator.js`, same as any client (STORY-017 AC2).
 */
export function buildBotSetup({ catalogue, layout, market, rng, startingCash = STARTING_CASH }) {
  const mains = rankByMarketFit(selectableMains(catalogue.dishes, layout), market, rng).slice(
    0,
    MENU_MAIN_SLOTS,
  );
  const addons = rankByMarketFit(selectableAddons(catalogue.dishes, layout), market, rng).slice(
    0,
    MENU_ADDON_SLOTS,
  );

  const startingInventory = defaultInventoryAllocation(
    [...mains, ...addons],
    catalogue.ingredients,
    {
      cash: startingCash,
      cashShare: STARTING_INVENTORY_DEFAULT_CASH_SHARE,
      servings: STARTING_INVENTORY_DEFAULT_SERVINGS,
      maxUnitsPerIngredient: STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT,
    },
  );

  return {
    type: 'setup_submit',
    menu: mains.map((dish) => ({ dishId: dish.id, price: choosePrice(dish, market, rng) })),
    addons: addons.map((dish) => ({ dishId: dish.id, price: choosePrice(dish, market, rng) })),
    startingUpgradeId: null,
    staffAssignments: chooseStaffAssignments(layout, mains, addons),
    startingInventory,
    policyId: null,
    policyDishId: null,
  };
}

/** Exported for `scripts/check-bot.mjs` ONLY, exactly as `action-validator.js`'s `_internal`
 * is — a way to exercise the scoring function directly rather than only through its effect on
 * a full submission. No other module may import it. */
export const _internal = { marketFitScore, rankByMarketFit, choosePrice };
