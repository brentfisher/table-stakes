// Ingredient stock, station bins, shortages and restocking. PRD §7 item 3 ("Starting inventory
// allocation"), §8 "Operational bottlenecks" (the `Ingredient shortage` row), §9's
// `ingredient_shortage` event, §10's "Restocking" upgrade category.
//
// Registered against `simulation-loop.js` per Decision 15 — one new file plus one line in
// `systems/index.js`. NOTHING IN `match.js` CHANGES.
//
// ============================================================================================
// THE MODEL: TWO LEVELS OF STOCK, BECAUSE §8's BOTTLENECK IS A DISTANCE PROBLEM
// ============================================================================================
// PRD §8 gives the ingredient-shortage row a visible signal ("Empty ingredient icon"), a player
// intervention ("Retrieve/restock ingredients") and a consequence ("Menu items unavailable,
// canceled orders"). An intervention that is *retrieval* only means something if the stock the
// kitchen cooks from is somewhere other than the stock the restaurant owns. So:
//
//   PANTRY   one bag of units per restaurant, seeded from `player.setup.startingInventory` —
//            PRD §7 item 3, the player's own strategic commitment. It is the reserve.
//   BINS     one small working stock per STATION per ingredient, capped at
//            INVENTORY_STATION_BIN_CAPACITY. It is what production actually eats.
//   RESTOCK  a timed job that moves units pantry -> bin. It is the walk to the back.
//
// and the two failure modes fall out of that shape rather than being written as cases:
//
//   bin empty, pantry has stock  ->  BLOCKED. The dish is still on the menu, its tickets sit in
//                                    the station queue and are skipped over, and a restock will
//                                    un-block them. This is the recoverable §8 bottleneck.
//   bin AND pantry empty         ->  UNAVAILABLE. The restaurant cannot make that dish again
//                                    this match: it drops off the menu for new orders and its
//                                    queued tickets are voided, which is §8's "menu items
//                                    unavailable, canceled orders" exactly.
//
// That single rule is why this file needs no special case for either outcome, and why it needs
// none for the §9 event either — see Decision 37.
//
// ============================================================================================
// WHERE A DISH'S INGREDIENTS ARE CONSUMED, AND WHEN
// ============================================================================================
// WHEN: at the moment the ticket's FIRST station step is dispatched — not when the party orders.
// An order sitting in a queue has not been cooked and has not spent anything, and PRD §8's
// consequence of a shortage is a *canceled* order, which is only meaningful if the order could
// be placed before the ingredients were gone.
//
// WHERE: the bin of the station that runs that first step. `dishes.json` gives a dish ONE
// ingredient list and a SEPARATE list of station steps, with no per-step ingredient data — so
// splitting a burger's beef across prep/grill/plating is not a thing the content can express,
// and inventing a split here would be a balance decision dressed as a schema. The first step is
// where raw goods enter the line (prep for seven of the eight MVP dishes, plating for
// cheesecake), so that is the bin that holds them.
//
// ============================================================================================
// WHAT THIS STORY DOES NOT OWN
// ============================================================================================
// The owner's physical restock interaction is STORY-008 and the worker's restock behaviour is
// STORY-007. This file owns the stock MODEL and the shortage STATE: `requestRestock()` is a
// public facade call that both of those stories drive, and neither of them needs to know what a
// bin is. `INVENTORY_AUTO_RESTOCK` is the abstracted stand-in that decides *when* to walk until
// they land — the same admission `ORDER_PASS_HANDOFF_MS` makes about the plate runner, and
// documented as such in tuning.js.

import { catalogue } from '../catalogue.js';
import layout from '../../../../shared/game-data/restaurant-layout.json' with { type: 'json' };
import { STATIONS } from '../../../../shared/schemas/messages.js';
import { neutralEventEffects } from './event-system.js';
import {
  INVENTORY_AUTO_RESTOCK,
  INVENTORY_MAX_CONCURRENT_RESTOCKS,
  INVENTORY_RESTOCK_MS_PER_UNIT,
  INVENTORY_RESTOCK_THRESHOLD_UNITS,
  INVENTORY_RESTOCK_TRAVEL_MS,
  INVENTORY_RNG_STREAM,
  INVENTORY_STATION_BIN_CAPACITY,
} from '../../../../shared/constants/tuning.js';

/** The stations this layout physically has, in a fixed order — the same list, derived the same
 * way, that `order-system.js` builds its stations from. The order is part of the reproducibility
 * contract: the opening fill and the auto-restock scan both walk stations in this sequence. */
const LAYOUT_STATIONS = Object.freeze(
  STATIONS.filter((station) =>
    layout.entities.some((e) => e.type === 'station' && e.station === station),
  ),
);

/**
 * The station whose bin holds a dish's raw ingredients: the station of its first `stationSteps`
 * entry. See the file header for why the first step and not a split across all of them.
 */
export function consumingStationFor(dish) {
  return dish?.stationSteps?.[0]?.station ?? null;
}

// --- per-match state ---------------------------------------------------------------------------
//
// Attached dynamically to the match, exactly as customer-system.js and order-system.js do:
// match.js knows nothing about inventory, and a match that never reaches `service` never gets
// this property at all.

/** Every dish the player locked onto their menu, mains and add-ons alike. */
function menuDishesOf(player) {
  const dishes = [];
  for (const slot of [...(player.setup?.menu ?? []), ...(player.setup?.addons ?? [])]) {
    const dish = catalogue.dishesById[slot.dishId];
    if (dish) dishes.push(dish);
  }
  return dishes;
}

/**
 * Which (station, ingredient) bins this restaurant will ever draw on, and the largest single
 * serving that will ever be pulled from each. Derived from the LOCKED menu, so a restaurant
 * never stocks, restocks or reports a shortage of an ingredient it has no use for.
 */
function buildRequirements(dishes) {
  const byStation = new Map();
  for (const dish of dishes) {
    const station = consumingStationFor(dish);
    if (station === null) continue;
    const perStation = byStation.get(station) ?? new Map();
    for (const [ingredientId, qty] of Object.entries(dish.ingredients ?? {})) {
      perStation.set(ingredientId, Math.max(perStation.get(ingredientId) ?? 0, qty));
    }
    byStation.set(station, perStation);
  }
  // Sorted, so the opening fill and the auto-restock scan are order-stable across runs.
  return LAYOUT_STATIONS.filter((station) => byStation.has(station)).map((station) => ({
    station,
    ingredients: [...byStation.get(station).entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([ingredientId, perServing]) => ({ ingredientId, perServing })),
  }));
}

function buildRestaurantInventory(player) {
  const dishes = menuDishesOf(player);
  const inventory = {
    restaurantId: player.playerId,
    playerId: player.playerId,
    dishes,
    requirements: buildRequirements(dishes),
    /** PRD §7 item 3. The player's own allocation, and the only stock they will ever have. */
    pantry: { ...(player.setup?.startingInventory ?? {}) },
    /** station -> { ingredientId: units }. Only the bins this menu needs exist. */
    bins: new Map(),
    /** In-flight pantry -> bin moves. */
    jobs: [],
    nextJobId: 1,
    shortages: [],
    ledger: {
      unitsAllocated: 0,
      unitsConsumed: 0,
      unitsRestocked: 0,
      restocksCompleted: 0,
      restockMs: 0,
      blockedClaims: 0,
      shortageMs: 0,
      dishesGoneUnavailable: new Set(),
    },
  };

  for (const { station } of inventory.requirements) inventory.bins.set(station, {});
  inventory.ledger.unitsAllocated = Object.values(inventory.pantry).reduce((s, n) => s + n, 0);

  // MISE EN PLACE. The bins are filled from the pantry at the setup -> service lock, not by a
  // restock job: the kitchen has all of setup to stock its counters, and opening the doors with
  // every station empty would make the first minute of every match a shortage.
  for (const { station, ingredients } of inventory.requirements) {
    const bin = inventory.bins.get(station);
    for (const { ingredientId } of ingredients) {
      const moved = Math.min(inventory.pantry[ingredientId] ?? 0, INVENTORY_STATION_BIN_CAPACITY);
      if (moved <= 0) continue;
      inventory.pantry[ingredientId] -= moved;
      bin[ingredientId] = (bin[ingredientId] ?? 0) + moved;
    }
  }

  return inventory;
}

function ensureState(match) {
  if (!match._inventorySimState) {
    const state = {
      rng: match.createRngStream(INVENTORY_RNG_STREAM),
      restaurants: new Map(),
      /** Ingredient ids the §9 `ingredient_shortage` event is currently hitting. Match-level and
       * identical for both restaurants — see Decision 37. */
      affectedIngredientIds: [],
      eventShortageActive: false,
    };
    for (const player of match.players.values()) {
      state.restaurants.set(player.playerId, buildRestaurantInventory(player));
    }
    match._inventorySimState = state;
    match.pantry = createPantryFacade(match, state);
    publishAvailability(match, state);
  }
  return match._inventorySimState;
}

// --- stock arithmetic --------------------------------------------------------------------------

const binOf = (inventory, station) => inventory.bins.get(station) ?? null;
const binLevel = (inventory, station, ingredientId) => binOf(inventory, station)?.[ingredientId] ?? 0;

/** Units of `ingredientId` already pulled out of the pantry and still walking to a bin. */
function inFlightUnits(inventory, ingredientId) {
  let units = 0;
  for (const job of inventory.jobs) if (job.ingredientId === ingredientId) units += job.units;
  return units;
}

/** Everything this restaurant still has of an ingredient, wherever it currently is. */
function totalUnits(inventory, station, ingredientId) {
  return (
    binLevel(inventory, station, ingredientId) +
    (inventory.pantry[ingredientId] ?? 0) +
    inFlightUnits(inventory, ingredientId)
  );
}

/**
 * Take one serving of `dish` out of its station bin. All-or-nothing: a partial pull would leave
 * ingredients spent on a plate that was never started.
 *
 * @returns {{ok: true} | {ok: false, missingIngredientId: string, exhausted: boolean}}
 *          `exhausted` distinguishes the two §8 outcomes — false means "the bin is empty but the
 *          pantry is not", which is a BLOCK a restock recovers from; true means the restaurant
 *          has none of that ingredient anywhere, which is what makes the dish unavailable.
 */
function claim(inventory, station, dish) {
  const bin = binOf(inventory, station);
  const need = Object.entries(dish?.ingredients ?? {});
  if (!bin) {
    // A dish routed through a station this restaurant has no bin for — unreachable for a menu
    // dish, since the bins are built from the menu. Treated as exhausted rather than free food.
    const first = need[0]?.[0] ?? null;
    return { ok: false, missingIngredientId: first, exhausted: true };
  }
  for (const [ingredientId, qty] of need) {
    if ((bin[ingredientId] ?? 0) < qty) {
      return {
        ok: false,
        missingIngredientId: ingredientId,
        exhausted: totalUnits(inventory, station, ingredientId) < qty,
      };
    }
  }
  let consumed = 0;
  for (const [ingredientId, qty] of need) {
    bin[ingredientId] -= qty;
    consumed += qty;
  }
  inventory.ledger.unitsConsumed += consumed;
  return { ok: true };
}

/** Can this restaurant still produce this dish AT ALL — bin, pantry and in-flight stock together?
 * This is the question `match.dishAvailability` answers, and it is deliberately NOT "is the bin
 * full enough right now": a bin that is empty while the pantry is not is a delay, not a menu
 * change. */
function canEverProduce(inventory, dish) {
  const station = consumingStationFor(dish);
  if (station === null || !inventory.bins.has(station)) return false;
  for (const [ingredientId, qty] of Object.entries(dish.ingredients ?? {})) {
    if (totalUnits(inventory, station, ingredientId) < qty) return false;
  }
  return true;
}

// --- PRD §9's `ingredient_shortage`, expressed through the same model ---------------------------

/** Decision 12's neutral default, read unconditionally so this system never branches on whether
 * an event is running. `event-system.js` publishes the real one as `match.eventEffects`. */
function getEventEffects(match) {
  return match.eventEffects ?? neutralEventEffects(match.market ?? null);
}

/**
 * Which ingredients the district's supplier is short of right now.
 *
 * `affectedIngredientCount` is a §16 COUNT key (neutral 0), so this reads the effects
 * unconditionally like every other consumer. The draw happens on the RISING EDGE of the count —
 * once, when a shortage starts — and is held until the count returns to zero, so an unrelated
 * event ending mid-shortage cannot silently re-roll which ingredient is scarce.
 *
 * The pool is the union of what BOTH restaurants actually cook, not all eighteen catalogue
 * ingredients: an event that hits an ingredient nobody has on their menu is a notification, and
 * PRD §9's first design rule is that an event must create an actionable decision. The draw is
 * match-level and both restaurants read the same list — PRD §9's fairness contract is that the
 * timeline is a property of the match and asymmetry may only come from the restaurants' own
 * state, which here is whether they happen to be leaning on that ingredient.
 */
function updateAffectedIngredients(match, state) {
  const count = Math.round(getEventEffects(match).affectedIngredientCount ?? 0);
  if (count <= 0) {
    state.affectedIngredientIds = [];
    state.eventShortageActive = false;
    return;
  }
  if (state.eventShortageActive) return;

  const pool = new Set();
  for (const inventory of state.restaurants.values()) {
    for (const { ingredients } of inventory.requirements) {
      for (const { ingredientId } of ingredients) pool.add(ingredientId);
    }
  }
  const candidates = [...pool].sort();
  const picked = [];
  for (let i = 0; i < count && candidates.length > 0; i += 1) {
    picked.push(candidates.splice(Math.floor(state.rng() * candidates.length), 1)[0]);
  }
  state.affectedIngredientIds = picked;
  state.eventShortageActive = true;
}

/**
 * PRD §10 "Restocking": how long one pantry -> bin move takes.
 *
 *   travel        the walk to the storage room and back. THE number PRD §10's "Pantry Shelves —
 *                 restock travel time -25%" scales, through `restockTravelTimeMultiplier` on
 *                 `match.upgradeEffects`, read defensively so STORY-012 publishing that object is
 *                 the whole of its integration with this file.
 *   handling      per unit carried, so a big top-up costs more than a small one.
 *   event         PRD §9 `ingredient_shortage`, "one ingredient restocks more slowly": the §16
 *                 `ingredientRestockDurationMultiplier`, applied ONLY to the ingredients the
 *                 event actually named. That asymmetry is the whole content of the event, and it
 *                 is why an unaffected ingredient restocking at the same speed is the assertion
 *                 that proves the effect is wired up at all.
 */
function restockDurationMs(match, state, ingredientId, units) {
  const fx = getEventEffects(match);
  const travelMultiplier = match.upgradeEffects?.restockTravelTimeMultiplier;
  const travel =
    INVENTORY_RESTOCK_TRAVEL_MS *
    (Number.isFinite(travelMultiplier) && travelMultiplier > 0 ? travelMultiplier : 1);
  let duration = travel + INVENTORY_RESTOCK_MS_PER_UNIT * Math.max(0, units);
  if (state.affectedIngredientIds.includes(ingredientId)) {
    const m = fx.ingredientRestockDurationMultiplier;
    if (Number.isFinite(m) && m > 0) duration *= m;
  }
  return Math.round(duration);
}

// --- restocking --------------------------------------------------------------------------------

/**
 * Start a pantry -> bin move. The only way stock ever reaches a station bin after the doors open,
 * and the call STORY-007's worker and STORY-008's owner both make.
 *
 * @returns {{ok: true, jobId: string, units: number, durationMs: number}
 *          | {ok: false, reason: string}}
 */
function startRestock(match, state, inventory, station, ingredientId, requestedUnits = null) {
  if (!inventory.bins.has(station)) return { ok: false, reason: 'unknown_station' };
  if (inventory.jobs.length >= INVENTORY_MAX_CONCURRENT_RESTOCKS) {
    return { ok: false, reason: 'restocker_busy' };
  }
  if (inventory.jobs.some((j) => j.station === station && j.ingredientId === ingredientId)) {
    return { ok: false, reason: 'already_restocking' };
  }
  const room = INVENTORY_STATION_BIN_CAPACITY - binLevel(inventory, station, ingredientId);
  if (room <= 0) return { ok: false, reason: 'bin_full' };
  const available = inventory.pantry[ingredientId] ?? 0;
  if (available <= 0) return { ok: false, reason: 'pantry_empty' };

  const units = Math.min(room, available, requestedUnits ?? room);
  if (units <= 0) return { ok: false, reason: 'nothing_to_move' };

  // Reserved out of the pantry NOW, so two requests cannot promise the same units, and so
  // `canEverProduce` keeps counting them (through `inFlightUnits`) while they are in transit.
  inventory.pantry[ingredientId] -= units;
  const durationMs = restockDurationMs(match, state, ingredientId, units);
  const job = {
    jobId: `restock_${inventory.restaurantId}_${inventory.nextJobId++}`,
    station,
    ingredientId,
    units,
    totalMs: durationMs,
    remainingMs: durationMs,
    startedAtMs: match.elapsedMs,
  };
  inventory.jobs.push(job);
  return { ok: true, jobId: job.jobId, units, durationMs };
}

function advanceRestocks(inventory, dtMs) {
  if (inventory.jobs.length === 0) return;
  inventory.ledger.restockMs += inventory.jobs.length * dtMs;
  const done = [];
  for (const job of inventory.jobs) {
    job.remainingMs -= dtMs;
    if (job.remainingMs <= 0) done.push(job);
  }
  for (const job of done) {
    inventory.jobs.splice(inventory.jobs.indexOf(job), 1);
    const bin = binOf(inventory, job.station);
    if (!bin) {
      inventory.pantry[job.ingredientId] = (inventory.pantry[job.ingredientId] ?? 0) + job.units;
      continue;
    }
    bin[job.ingredientId] = (bin[job.ingredientId] ?? 0) + job.units;
    inventory.ledger.unitsRestocked += job.units;
    inventory.ledger.restocksCompleted += 1;
  }
}

/**
 * THE ABSTRACTED RESTOCKER (see tuning.js's INVENTORY_AUTO_RESTOCK). Picks the emptiest bin that
 * is at or below the threshold and starts a move. STORY-007/008 replace this trigger with a body
 * that has to walk; the job it starts, its duration and everything downstream stay exactly as
 * they are.
 */
function autoRestock(match, state, inventory) {
  if (!INVENTORY_AUTO_RESTOCK) return;
  if (inventory.jobs.length >= INVENTORY_MAX_CONCURRENT_RESTOCKS) return;

  let best = null;
  for (const { station, ingredients } of inventory.requirements) {
    for (const { ingredientId } of ingredients) {
      const level = binLevel(inventory, station, ingredientId);
      if (level > INVENTORY_RESTOCK_THRESHOLD_UNITS) continue;
      if ((inventory.pantry[ingredientId] ?? 0) <= 0) continue;
      if (inventory.jobs.some((j) => j.station === station && j.ingredientId === ingredientId)) {
        continue;
      }
      // Emptiest first; ties break on the requirements' own sorted order, so the choice is
      // reproducible rather than dependent on Map iteration luck.
      if (best === null || level < best.level) best = { station, ingredientId, level };
    }
  }
  if (best) startRestock(match, state, inventory, best.station, best.ingredientId);
}

// --- the shortage state ------------------------------------------------------------------------

/**
 * PRD §8's "Empty ingredient icon", as data. One entry per (station, ingredient) the kitchen
 * cannot currently pull a full serving of.
 *
 * DISTINGUISHABLE FROM A LONG QUEUE, which is the acceptance criterion: a deep queue shows up as
 * `restaurants[].queueLength` and as `orders[]` entries in state `queued`, and neither of those
 * changes when a bin runs dry. A shortage shows up here, and on the ticket itself as
 * `orders[].blockedByIngredientId` — a `queued` ticket with a non-null blocker is not waiting for
 * a free pair of hands, it is waiting for food to arrive from the back.
 */
function computeShortages(match, inventory) {
  const shortages = [];
  for (const { station, ingredients } of inventory.requirements) {
    for (const { ingredientId, perServing } of ingredients) {
      const level = binLevel(inventory, station, ingredientId);
      if (level >= perServing) continue;
      let blockedTickets = 0;
      for (const ticket of match.orders ?? []) {
        if (ticket.restaurantId !== inventory.restaurantId) continue;
        if (ticket.blockedByIngredientId === ingredientId && ticket.station === station) {
          blockedTickets += 1;
        }
      }
      shortages.push({
        station,
        ingredientId,
        binLevel: level,
        blockedTickets,
        restocking: inventory.jobs.some(
          (j) => j.station === station && j.ingredientId === ingredientId,
        ),
        /** True once the pantry is empty too: this is no longer a delay, it is the end of that
         * dish for the match. `dishAvailability` follows from exactly this. */
        exhausted: totalUnits(inventory, station, ingredientId) < perServing,
      });
    }
  }
  return shortages;
}

/**
 * THE INTEGRATION WITH THE KITCHEN. `order-system.js` built this seam before an inventory model
 * existed: it reads an optional `match.dishAvailability` map defensively, drops an unavailable
 * dish out of the draw for new orders, and voids a queued ticket whose dish has gone unavailable
 * (which cancels the order outright when it voids every ticket, sending the party to
 * CANCEL_ORDER). Publishing this map is the whole of that half of the integration.
 *
 * `false` is written explicitly for an unavailable dish, because the consumer's test is
 * `perRestaurant[dishId] !== false` — an omitted dish reads as available.
 */
function publishAvailability(match, state) {
  const availability = {};
  for (const inventory of state.restaurants.values()) {
    const perRestaurant = {};
    for (const dish of inventory.dishes) {
      const available = canEverProduce(inventory, dish);
      perRestaurant[dish.id] = available;
      if (!available) inventory.ledger.dishesGoneUnavailable.add(dish.id);
    }
    availability[inventory.restaurantId] = perRestaurant;
  }
  match.dishAvailability = availability;
}

// --- the facade the kitchen and the action stories call ------------------------------------------

function createPantryFacade(match, state) {
  const find = (restaurantId) => state.restaurants.get(restaurantId) ?? null;

  return {
    /**
     * Take one serving of `dish` out of `station`'s bin. Called by `order-system.js` at the
     * instant a ticket's FIRST station step is dispatched, and by nothing else.
     *
     * @returns {{ok: true} | {ok: false, missingIngredientId: string|null, exhausted: boolean}}
     */
    claim(restaurantId, station, dish) {
      const inventory = find(restaurantId);
      if (!inventory) return { ok: false, missingIngredientId: null, exhausted: false };
      const result = claim(inventory, station, dish);
      if (!result.ok) inventory.ledger.blockedClaims += 1;
      return result;
    },

    /** PRD §8's player intervention, as a call. STORY-007 (worker) and STORY-008 (owner) drive
     * this; the duration it returns is what makes the walk cost time. */
    requestRestock(restaurantId, station, ingredientId, units = null) {
      const inventory = find(restaurantId);
      if (!inventory) return { ok: false, reason: 'unknown_restaurant' };
      return startRestock(match, state, inventory, station, ingredientId, units);
    },

    /** What a restock of `units` would take right now, including the §9 event and the §10
     * upgrade. Exposed so a UI can show the prompt's duration without starting the job. */
    restockDurationMs(ingredientId, units) {
      return restockDurationMs(match, state, ingredientId, units);
    },

    /** Units still in the restaurant's reserve. */
    stockOf(restaurantId, ingredientId) {
      return find(restaurantId)?.pantry[ingredientId] ?? 0;
    },

    /** Units at one station's counter. */
    binLevel(restaurantId, station, ingredientId) {
      const inventory = find(restaurantId);
      return inventory ? binLevel(inventory, station, ingredientId) : 0;
    },

    /** PRD §8's ingredient-shortage signal for one restaurant, as published this tick. */
    shortagesFor(restaurantId) {
      return (find(restaurantId)?.shortages ?? []).map((s) => ({ ...s }));
    },

    /** In-flight pantry -> bin moves for one restaurant. */
    restocksInFlight(restaurantId) {
      return (find(restaurantId)?.jobs ?? []).map((job) => ({ ...job }));
    },

    /** The ingredients PRD §9's `ingredient_shortage` is currently hitting — match-level, and the
     * same list for both restaurants. */
    affectedIngredientIds() {
      return [...state.affectedIngredientIds];
    },

    /** The server-side stock record for one restaurant, as a copy. */
    ledgerFor(restaurantId) {
      const ledger = find(restaurantId)?.ledger;
      if (!ledger) return null;
      return { ...ledger, dishesGoneUnavailable: [...ledger.dishesGoneUnavailable] };
    },
  };
}

// --- the public projection ------------------------------------------------------------------------

/**
 * The §8 shortage signal, attached to the `restaurants[]` entries `customer-system.js` published
 * earlier this tick. An explicit allowlist, like every other projection in this repo.
 *
 * WHAT IS NOT PUBLISHED, and why, since `RestaurantSnapshot` in game-state.d.ts declares both
 * fields as this story's: `menu` (priced, with availability) and `inventory` (units per
 * ingredient) stay server-side. `restaurants[]` is the ONE array both players receive
 * identically, `check-district-choice.mjs` asserts that a rival's dish ids and the key names
 * `menu`/`inventory` never appear in it (PRD §18, Decision 16), and that assertion is the newer
 * and more specific evidence. What ships here instead is what PRD §8 makes an in-world signal
 * anyway — an ingredient is short at a station — which names no dish, no price and no reserve.
 */
function toPublicShortages(inventory) {
  return inventory.shortages.map((s) => ({
    station: s.station,
    ingredientId: s.ingredientId,
    blockedTickets: s.blockedTickets,
    restocking: s.restocking,
    exhausted: s.exhausted,
  }));
}

// --- the system --------------------------------------------------------------------------------

export const inventorySystem = {
  id: 'inventory',
  phases: ['service', 'final_rush'],

  update(match, dtMs) {
    const state = ensureState(match);
    updateAffectedIngredients(match, state);

    for (const inventory of state.restaurants.values()) {
      advanceRestocks(inventory, dtMs);
      autoRestock(match, state, inventory);
      inventory.shortages = computeShortages(match, inventory);
      if (inventory.shortages.length > 0) inventory.ledger.shortageMs += dtMs;
    }

    publishAvailability(match, state);

    // `customer-system.js` reassigns `match.restaurants` wholesale during its own update, which
    // is why this system is registered LAST: anything written to that array before it runs is
    // discarded. Decoration, not construction — the entries and every field on them are the
    // district's, and this adds one.
    for (const restaurant of match.restaurants ?? []) {
      const inventory = state.restaurants.get(restaurant.restaurantId);
      restaurant.shortages = inventory ? toPublicShortages(inventory) : [];
    }
  },

  onPhaseChange(match, transition) {
    if (transition.to === 'service') {
      // The facade and the availability map must exist before `order-system.js` first dispatches
      // a ticket. The loop runs every system's onPhaseChange before any update, so this is a
      // guarantee, not a race — and it is why registering this system last is safe.
      ensureState(match);
      return;
    }
    if (transition.to !== 'results') return;
    if (!match._inventorySimState) return;

    for (const inventory of match._inventorySimState.restaurants.values()) {
      const l = inventory.ledger;
      const leftInPantry = Object.values(inventory.pantry).reduce((s, n) => s + n, 0);
      console.log(
        `[inventory] ${match.id} ${inventory.restaurantId} allocated=${l.unitsAllocated}u ` +
          `consumed=${l.unitsConsumed}u restocked=${l.unitsRestocked}u in ${l.restocksCompleted} trips ` +
          `pantryLeft=${leftInPantry}u blockedClaims=${l.blockedClaims} ` +
          `shortage=${Math.round(l.shortageMs / 1000)}s ` +
          `unavailable=[${[...l.dishesGoneUnavailable].join(' ') || 'none'}]`,
      );
    }

    match.dishAvailability = undefined;
    match.pantry = undefined;
    match._inventorySimState = undefined;
  },
};

/**
 * Exported for scripts/check-inventory.mjs ONLY — not part of the system's contract, and no
 * other system or route may import it. Decision 8: the repo has no test framework, so a runnable
 * script is the only way to force a specific branch (an empty bin, an empty pantry, a restock
 * mid-flight, an event-affected ingredient) deterministically rather than hoping a seeded run
 * produces one.
 */
export const _internal = {
  ensureState,
  buildRequirements,
  buildRestaurantInventory,
  claim,
  canEverProduce,
  computeShortages,
  publishAvailability,
  restockDurationMs,
  startRestock,
  advanceRestocks,
  autoRestock,
  updateAffectedIngredients,
  totalUnits,
  binLevel,
  LAYOUT_STATIONS,
};
