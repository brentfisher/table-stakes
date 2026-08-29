// Catalogue loader and integrity check. PRD §16 "Data-driven content": all balancing content
// is JSON, never hardcoded in a system — which means a typo in a JSON file is a class of bug
// no compiler catches. This module is where it gets caught, loudly, at startup.
//
// NODE ONLY. It reads the JSON files with `readFileSync` and must never be imported into
// browser code. That is deliberate on two counts: the server wants a hard failure at boot, and
// the client already gets these files as typed imports through Vite without needing a loader.
// `readFileSync` is used rather than `import ... with {type: 'json'}` because import
// attributes are still a moving target across Node versions and the server is plain JS.
//
// Plain JavaScript with a sibling loader.d.ts, design Decision 4.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DISH_CATEGORIES, STATIONS } from '../schemas/messages.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Tolerance for the PRD §16 rule that a market's `segmentWeights` describe a probability
 * distribution. It is not ceremonial: 0.55 + 0.10 + 0.20 + 0.05 + 0.10 is not exactly 1 in
 * IEEE-754 binary floating point, so an exact comparison would reject the PRD's own example.
 * 1e-6 is loose enough for that and far too tight to hide a real balance mistake — the
 * smallest weight anyone would plausibly write is 0.01.
 */
export const SEGMENT_WEIGHT_TOLERANCE = 1e-6;

/** Thrown by loadCatalogue. Carries EVERY problem found, not just the first. */
export class CatalogueError extends Error {
  constructor(errors) {
    super(`Invalid game-data catalogue — ${errors.length} problem(s):\n  - ${errors.join('\n  - ')}`);
    this.name = 'CatalogueError';
    this.errors = errors;
  }
}

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

/** Reads and JSON-parses the five catalogue files plus the §14 layout. Throws on bad JSON. */
export function readCatalogueFiles(dir = HERE) {
  const read = (file) => {
    const path = join(dir, file);
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (cause) {
      throw new CatalogueError([`${file} could not be read or parsed: ${cause.message}`]);
    }
  };
  return {
    dishes: read('dishes.json'),
    markets: read('markets.json'),
    segments: read('customer-segments.json'),
    events: read('events.json'),
    upgrades: read('upgrades.json'),
    layout: read('restaurant-layout.json'),
  };
}

/**
 * Pure integrity check over already-parsed files. Returns an array of human-readable problems;
 * an empty array means the catalogue is internally consistent. Separated from the file reading
 * so scripts/check-catalogue.mjs can report every error at once instead of dying on the first.
 */
export function validateCatalogue(raw) {
  const errors = [];
  const err = (msg) => errors.push(msg);

  const dishes = raw.dishes?.dishes;
  const ingredients = raw.dishes?.ingredients;
  const markets = raw.markets?.markets;
  const segments = raw.segments?.segments;
  const events = raw.events?.events;
  const upgrades = raw.upgrades?.upgrades;

  if (!Array.isArray(dishes)) err('dishes.json: `dishes` must be an array');
  if (!ingredients || typeof ingredients !== 'object') {
    err('dishes.json: `ingredients` must be an object — it is the single ingredient list');
  }
  if (!Array.isArray(markets)) err('markets.json: `markets` must be an array');
  if (!Array.isArray(segments)) err('customer-segments.json: `segments` must be an array');
  if (!Array.isArray(events)) err('events.json: `events` must be an array');
  if (!Array.isArray(upgrades)) err('upgrades.json: `upgrades` must be an array');
  if (errors.length > 0) return errors;

  // --- id hygiene ---------------------------------------------------------------------
  // conventions.md "Naming": data ids are snake_case, and every one must be unique within
  // its file because every cross-reference below is a lookup by id.
  const idsOf = (file, list) => {
    const seen = new Set();
    for (const entry of list) {
      const id = entry?.id;
      if (typeof id !== 'string') {
        err(`${file}: an entry has no string \`id\``);
        continue;
      }
      if (!SNAKE_CASE.test(id)) err(`${file}: id "${id}" is not snake_case`);
      if (seen.has(id)) err(`${file}: duplicate id "${id}"`);
      seen.add(id);
    }
    return seen;
  };

  idsOf('dishes.json', dishes);
  const marketIds = idsOf('markets.json', markets);
  const segmentIds = idsOf('customer-segments.json', segments);
  const eventIds = idsOf('events.json', events);
  const upgradeIds = idsOf('upgrades.json', upgrades);

  const ingredientIds = new Set(Object.keys(ingredients));
  for (const id of ingredientIds) {
    if (!SNAKE_CASE.test(id)) err(`dishes.json: ingredient id "${id}" is not snake_case`);
  }

  // --- dishes -------------------------------------------------------------------------
  const usedIngredients = new Set();
  for (const dish of dishes) {
    const at = `dishes.json[${dish.id}]`;

    if (!DISH_CATEGORIES.includes(dish.category)) {
      err(`${at}: category "${dish.category}" is not one of ${DISH_CATEGORIES.join(', ')}`);
    }
    if (!Array.isArray(dish.tags) || dish.tags.length === 0) {
      err(`${at}: tags must be a non-empty array`);
    }
    for (const field of ['baseCost', 'suggestedPrice', 'baseSatisfaction']) {
      if (typeof dish[field] !== 'number' || !Number.isFinite(dish[field])) {
        err(`${at}: ${field} must be a finite number`);
      }
    }

    // Unknown ingredient — every key must be declared in the single ingredient list.
    if (!dish.ingredients || typeof dish.ingredients !== 'object') {
      err(`${at}: ingredients must be an object`);
    } else {
      for (const [ingredientId, qty] of Object.entries(dish.ingredients)) {
        usedIngredients.add(ingredientId);
        if (!ingredientIds.has(ingredientId)) {
          err(`${at}: unknown ingredient "${ingredientId}" — not declared in dishes.json \`ingredients\``);
        }
        if (!Number.isInteger(qty) || qty <= 0) {
          err(`${at}: ingredient "${ingredientId}" quantity must be a positive integer`);
        }
      }
    }

    // Unknown station — PRD §7: every dish must be producible by a station the restaurant has.
    if (!Array.isArray(dish.stationSteps) || dish.stationSteps.length === 0) {
      err(`${at}: stationSteps must be a non-empty array`);
    } else {
      for (const [i, step] of dish.stationSteps.entries()) {
        if (!STATIONS.includes(step?.station)) {
          err(`${at}.stationSteps[${i}]: unknown station "${step?.station}" — the §14 layout has ${STATIONS.join(', ')}`);
        }
        if (!Number.isFinite(step?.durationMs) || step.durationMs <= 0) {
          err(`${at}.stationSteps[${i}]: durationMs must be a positive number of milliseconds`);
        }
      }
    }

    // marketAffinity is keyed by market id.
    if (!dish.marketAffinity || typeof dish.marketAffinity !== 'object') {
      err(`${at}: marketAffinity must be an object keyed by market id`);
    } else {
      for (const marketId of Object.keys(dish.marketAffinity)) {
        if (!marketIds.has(marketId)) {
          err(`${at}.marketAffinity: unknown market "${marketId}"`);
        }
      }
    }
  }

  for (const ingredientId of ingredientIds) {
    if (!usedIngredients.has(ingredientId)) {
      err(`dishes.json: ingredient "${ingredientId}" is declared but no dish uses it`);
    }
  }

  // Every station in the layout should be reachable by some dish, or it is dead scenery.
  const layoutStations = new Set(
    (raw.layout?.entities ?? []).filter((e) => e.type === 'station').map((e) => e.station),
  );
  const dishStations = new Set(dishes.flatMap((d) => (d.stationSteps ?? []).map((s) => s.station)));
  for (const station of layoutStations) {
    if (!dishStations.has(station)) {
      err(`restaurant-layout.json has station "${station}" but no dish routes through it`);
    }
  }

  // --- customer segments ---------------------------------------------------------------
  for (const segment of segments) {
    const at = `customer-segments.json[${segment.id}]`;
    if (!Number.isFinite(segment.budget)) err(`${at}: budget must be a number`);
    if (!Number.isFinite(segment.patienceSeconds) || segment.patienceSeconds <= 0) {
      err(`${at}: patienceSeconds must be a positive number (the deliberate seconds-named field)`);
    }
    if (!Number.isInteger(segment.partySize) || segment.partySize <= 0) {
      err(`${at}: partySize must be a positive integer`);
    }
    for (const field of ['preferredTags', 'dislikedTags']) {
      if (!Array.isArray(segment[field])) err(`${at}: ${field} must be an array`);
    }
    for (const field of ['serviceSpeedWeight', 'priceWeight', 'menuFitWeight', 'reputationWeight']) {
      if (!Number.isFinite(segment[field])) err(`${at}: ${field} must be a number`);
    }
  }

  // --- markets -------------------------------------------------------------------------
  for (const market of markets) {
    const at = `markets.json[${market.id}]`;

    if (!Number.isFinite(market.priceSensitivity) || market.priceSensitivity <= 0) {
      err(`${at}: priceSensitivity must be a positive number`);
    }
    if (!Number.isFinite(market.baseFootTrafficPerMinute) || market.baseFootTrafficPerMinute <= 0) {
      err(`${at}: baseFootTrafficPerMinute must be a positive number`);
    }
    if (!Array.isArray(market.preferredTags)) err(`${at}: preferredTags must be an array`);

    // Unknown segment id in segmentWeights, and the §16 sum-to-1.0 rule.
    if (!market.segmentWeights || typeof market.segmentWeights !== 'object') {
      err(`${at}: segmentWeights must be an object keyed by segment id`);
    } else {
      let sum = 0;
      for (const [segmentId, weight] of Object.entries(market.segmentWeights)) {
        if (!segmentIds.has(segmentId)) {
          err(`${at}.segmentWeights: unknown segment "${segmentId}"`);
        }
        if (!Number.isFinite(weight) || weight < 0) {
          err(`${at}.segmentWeights.${segmentId}: weight must be a non-negative number`);
          continue;
        }
        sum += weight;
      }
      if (Math.abs(sum - 1) > SEGMENT_WEIGHT_TOLERANCE) {
        err(
          `${at}.segmentWeights sums to ${sum} — must be 1.0 within ${SEGMENT_WEIGHT_TOLERANCE}` +
            ' (they are a probability distribution over arriving parties)',
        );
      }
    }

    // Unknown event id in eventPool.
    if (!Array.isArray(market.eventPool) || market.eventPool.length === 0) {
      err(`${at}: eventPool must be a non-empty array of event ids`);
    } else {
      for (const eventId of market.eventPool) {
        if (!eventIds.has(eventId)) err(`${at}.eventPool: unknown event "${eventId}"`);
      }
    }
  }

  // --- events ---------------------------------------------------------------------------
  for (const event of events) {
    const at = `events.json[${event.id}]`;

    if (typeof event.title !== 'string' || event.title.length === 0) {
      err(`${at}: title must be a non-empty string`);
    }
    // conventions.md "Naming": durations are milliseconds with a `Ms` suffix.
    if (!Number.isFinite(event.warningMs) || event.warningMs < 0) {
      err(`${at}: warningMs must be a non-negative number of milliseconds`);
    }
    if (!Number.isFinite(event.durationMs) || event.durationMs <= 0) {
      err(`${at}: durationMs must be a positive number of milliseconds`);
    }

    const effects = event.effects;
    if (!effects || typeof effects !== 'object') {
      err(`${at}: effects must be an object`);
      continue;
    }
    // The four §16 `baseball_game_ends` keys are the shared vocabulary — present on every
    // event so a consumer can read them without a per-event special case.
    for (const key of ['footTrafficMultiplier', 'partySizeMultiplier']) {
      if (!Number.isFinite(effects[key]) || effects[key] < 0) {
        err(`${at}.effects.${key} must be a non-negative number`);
      }
    }
    for (const key of ['segmentWeightOverrides', 'dishTagDemandMultipliers']) {
      if (!effects[key] || typeof effects[key] !== 'object' || Array.isArray(effects[key])) {
        err(`${at}.effects.${key} must be an object (use {} for none)`);
      }
    }
    for (const segmentId of Object.keys(effects.segmentWeightOverrides ?? {})) {
      if (!segmentIds.has(segmentId)) {
        err(`${at}.effects.segmentWeightOverrides: unknown segment "${segmentId}"`);
      }
    }
    for (const station of Object.keys(effects.stationSpeedMultipliers ?? {})) {
      if (!STATIONS.includes(station)) {
        err(`${at}.effects.stationSpeedMultipliers: unknown station "${station}"`);
      }
    }
    if (effects.specialPartySpawn && !segmentIds.has(effects.specialPartySpawn.segment)) {
      err(`${at}.effects.specialPartySpawn: unknown segment "${effects.specialPartySpawn.segment}"`);
    }
  }

  // Every event must be reachable — an event in no market's pool can never be drawn.
  const pooled = new Set(markets.flatMap((m) => m.eventPool ?? []));
  for (const eventId of eventIds) {
    if (!pooled.has(eventId)) {
      err(`events.json: event "${eventId}" appears in no market's eventPool and can never fire`);
    }
  }

  // --- upgrades --------------------------------------------------------------------------
  for (const upgrade of upgrades) {
    const at = `upgrades.json[${upgrade.id}]`;
    if (typeof upgrade.category !== 'string' || !SNAKE_CASE.test(upgrade.category)) {
      err(`${at}: category must be a snake_case string`);
    }
    if (!Number.isFinite(upgrade.cost) || upgrade.cost <= 0) {
      err(`${at}: cost must be a positive number`);
    }
    if (!Number.isInteger(upgrade.tier) || upgrade.tier < 1 || upgrade.tier > 3) {
      err(`${at}: tier must be an integer 1-3 (PRD §10 caps MVP at three tiers per category)`);
    }
    if (!upgrade.effects || typeof upgrade.effects !== 'object' || Array.isArray(upgrade.effects)) {
      err(`${at}: effects must be a machine-readable object`);
    } else if (Object.keys(upgrade.effects).length === 0) {
      err(`${at}: effects must not be empty — an upgrade with no machine-readable effect is prose`);
    }
    if (upgrade.requires !== undefined && !upgradeIds.has(upgrade.requires)) {
      err(`${at}: requires unknown upgrade "${upgrade.requires}"`);
    }
    for (const station of Object.keys(upgrade.effects?.stationSpeedMultipliers ?? {})) {
      if (!STATIONS.includes(station)) {
        err(`${at}.effects.stationSpeedMultipliers: unknown station "${station}"`);
      }
    }
    for (const station of Object.keys(upgrade.effects?.stationConcurrentCapacity ?? {})) {
      if (!STATIONS.includes(station)) {
        err(`${at}.effects.stationConcurrentCapacity: unknown station "${station}"`);
      }
    }
  }

  return errors;
}

/**
 * Reads and validates the catalogue. THROWS CatalogueError listing every problem if anything
 * is inconsistent — a half-valid catalogue must never reach a running match, because the
 * symptom downstream is a customer wanting a dish that does not exist, three systems away
 * from the typo that caused it.
 */
export function loadCatalogue(dir = HERE) {
  const raw = readCatalogueFiles(dir);
  const errors = validateCatalogue(raw);
  if (errors.length > 0) throw new CatalogueError(errors);

  return {
    ingredients: raw.dishes.ingredients,
    dishes: raw.dishes.dishes,
    markets: raw.markets.markets,
    segments: raw.segments.segments,
    events: raw.events.events,
    upgrades: raw.upgrades.upgrades,
    layout: raw.layout,

    dishesById: indexById(raw.dishes.dishes),
    marketsById: indexById(raw.markets.markets),
    segmentsById: indexById(raw.segments.segments),
    eventsById: indexById(raw.events.events),
    upgradesById: indexById(raw.upgrades.upgrades),
  };
}

function indexById(list) {
  return Object.freeze(Object.fromEntries(list.map((entry) => [entry.id, entry])));
}
