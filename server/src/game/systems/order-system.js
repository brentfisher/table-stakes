// The kitchen. PRD §17 "Order system" and "Order quality", implemented for the MVP.
//
// A seated party generates an order from its restaurant's locked menu; the order decomposes
// into one ticket per dish; each ticket walks that dish's `stationSteps` from dishes.json,
// waiting in a station's queue whenever that station is already working its concurrency
// limit; a ticket that finishes its last step lands on the service pass and starts losing
// freshness; when every ticket of an order is off the line it is handed to the table, scored,
// and the party goes on to eat and pay.
//
// Registered against `simulation-loop.js` per Decision 15 — one new file plus one line in
// `systems/index.js`. NOTHING IN `match.js` CHANGES: `toSnapshot()` already serializes
// `this.orders ?? []`, and this system attaches its own pre-sanitized, already-public-shaped
// array there every tick.
//
// ============================================================================================
// NO COOKING MINIGAME. PRD §17 is explicit: "For MVP, do not add complex minigames for
// cooking. The meaningful skill should be operational prioritization, physical movement, and
// timing—not an unrelated button-sequence challenge." Nothing in this file reads a client
// message, an input sequence or a timing bar, and no `interact` action gates a ticket. A
// ticket advances on `dtMs` and on `dtMs` only. The difficulty this system creates is a
// QUEUE — a station with a finite number of hands and more tickets than hands — which is the
// thing STORY-007's workers work, STORY-008's owner physically intervenes in, and STORY-019's
// harness visualises.
// ============================================================================================
//
// ============================================================================================
// THE SEAM BETWEEN THIS SYSTEM AND `customer-system.js`
// ============================================================================================
// Neither system reads the other's internals. This one publishes a small facade on the match,
// `match.kitchen`, and the customer system calls it:
//
//   placeOrder(request) -> {ok: true, orderId} | {ok: false, reason}   at the end of ORDERING
//   pollDelivery(orderId) -> null | {delivered, ...} | {cancelled, reason}
//   cancelOrder(orderId, reason)   when a waiting party's patience runs out
//   settleOrder(orderId)           when the party reaches PAYING — THIS is where revenue moves
//   abandonOrder(orderId, reason)  when the party storms out (LEAVE_ANGRY) without paying
//
// `request` is an explicit field list built by the customer system, not the internal party
// object, so the hidden §6 profile crosses this boundary deliberately and visibly. It stays
// server-side either way — `toPublicOrderSnapshot` is the only thing that reaches the wire.
//
// The facade is attached on the transition INTO `service`. The loop runs every registered
// system's `onPhaseChange` before any `update` that tick, so it exists before the customer
// system first ticks in service — a guarantee, not a race. It is also attached lazily in
// `update`, for a script that drops a match straight into service.
//
// WHY THE CUSTOMER SYSTEM PUSHES AND THIS ONE IS POLLED: the kitchen never needs to enumerate
// parties, and the customer system never needs to know what a ticket is. The only shared
// vocabulary is an order id — which was already a public field on `CustomerSnapshot`.
// ============================================================================================
//
// STORY-006 (ingredients) SEAM, now filled in. This system asks one question about a dish before
// committing to it: `isDishAvailable()`, which reads the `match.dishAvailability` map
// `inventory-system.js` publishes. Both outcomes come from that map alone: a dish that goes
// unavailable BEFORE the party orders drops out of the draw, and one that goes unavailable while
// its ticket is still queued has that ticket voided — which reduces the order's `correctness`,
// and, if it voids every ticket, cancels the order outright and sends the party to CANCEL_ORDER.
//
// The map was NOT the whole of the integration, and this file's original note said so by
// omission rather than on purpose: `dishAvailability` is read in `orderableEntries` (order time)
// and in `voidUnavailableTickets` (a sweep), and neither of those is a STATION STEP. STORY-006's
// acceptance criterion is that a dish's ingredients are consumed "at the correct step, not at
// order time", which needs a hook where a step is dispatched. That hook is `claimIngredients()`
// in `dispatchQueues` — twenty lines, read through an optional `match.pantry` facade with the
// same defensiveness as `match.dishAvailability`, and inert when no inventory system is
// registered. Nothing else about the kitchen moved.
//
// REVENUE IS SERVER-SIDE ONLY (Milestone 0 Decision 2), computed here from the price the
// player set during setup — never from anything a client sends. It accrues to
// `restaurant.ledger` and is reported at the results transition. There is no snapshot home for
// it yet: `RestaurantSnapshot` in game-state.d.ts declares a dozen fields (inventory,
// reputation, tables, workers) this story does not own, and filling them with placeholders
// would be worse than leaving the array empty. STORY-013 scores from the ledger.

import { catalogue } from '../catalogue.js';
import layout from '../../../../shared/game-data/restaurant-layout.json' with { type: 'json' };
import { ORDER_STATES } from '../../../../shared/schemas/game-state.js';
import { STATIONS } from '../../../../shared/schemas/messages.js';
import { dishDemandMultiplier, neutralEventEffects } from './event-system.js';
import {
  ORDER_RNG_STREAM,
  STATION_CONCURRENCY,
  STATION_DEFAULT_CONCURRENCY,
  ORDER_ADDON_PROBABILITY,
  ORDER_PREFERRED_TAG_BONUS,
  ORDER_DISLIKED_TAG_PENALTY,
  ORDER_PRICE_ELASTICITY,
  ORDER_OVER_BUDGET_WEIGHT,
  ORDER_PASS_HANDOFF_MS,
  ORDER_FRESHNESS_GRACE_MS,
  ORDER_FRESHNESS_WINDOW_MS,
  ORDER_FRESHNESS_FLOOR,
  ORDER_QUALITY_WEIGHTS,
  ORDER_PREFERENCE_TAG_STEP,
  ORDER_PRICE_FAIRNESS_SLOPE,
  ORDER_SNAPSHOT_LINGER_MS,
  CUSTOMER_WAIT_TOLERANCE_SHARE,
} from '../../../../shared/constants/tuning.js';

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

/** Money is dollars-and-cents everywhere in this repo — same rounding as setup-rules.js. */
const toCents = (value) => Math.round(value * 100) / 100;

/** The stations this layout physically has, in a fixed order. The order is part of the
 * reproducibility contract: the dispatch pass walks stations in exactly this sequence. */
const LAYOUT_STATIONS = Object.freeze(
  STATIONS.filter((station) =>
    layout.entities.some((e) => e.type === 'station' && e.station === station),
  ),
);

function concurrencyFor(station) {
  return STATION_CONCURRENCY[station] ?? STATION_DEFAULT_CONCURRENCY;
}

/**
 * STORY-006's seam. Until an inventory model exists, every dish on a locked menu is available.
 * `match.dishAvailability` is read defensively so that publishing it is the whole of STORY-006's
 * integration with this file.
 */
function isDishAvailable(match, restaurantId, dishId) {
  const perRestaurant = match.dishAvailability?.[restaurantId];
  if (!perRestaurant) return true;
  return perRestaurant[dishId] !== false;
}

/** Decision 12's neutral default, read unconditionally so this system never branches on
 * whether an event is running. `event-system.js` publishes the real one as `match.eventEffects`. */
function getEventEffects(match) {
  return match.eventEffects ?? neutralEventEffects(match.market ?? null);
}

/** Decision 12: a multiplier below 1 means FASTER. Sampled once, when the step is dispatched —
 * a grill that speeds up mid-steak does not retroactively un-cook it. */
function stationSpeedMultiplier(match, station) {
  const value = getEventEffects(match).stationSpeedMultipliers?.[station];
  return Number.isFinite(value) && value > 0 ? value : 1;
}

// --- per-match state -------------------------------------------------------------------------
//
// Attached dynamically to the match, exactly as customer-system.js does: match.js knows nothing
// about orders, and a match that never reaches `service` never gets this property at all.

function buildStations() {
  const stations = new Map();
  for (const station of LAYOUT_STATIONS) {
    stations.set(station, {
      station,
      concurrency: concurrencyFor(station),
      /** Tickets being worked right now. Never longer than `concurrency`. */
      active: [],
      /** Tickets waiting for a free pair of hands, FIFO. THE queue depth. */
      queue: [],
      // Instrumentation for the §24 balance run — not gameplay, never serialized.
      busyMs: 0,
      maxQueueDepth: 0,
    });
  }
  return stations;
}

/** The locked menu STORY-009's setup system produced, read from where it stores it — the
 * accepted submission on the player. Prices are the player's own, not the suggested ones. */
function buildMenu(player) {
  const menu = new Map();
  const add = (slot, isAddon) => {
    const dish = catalogue.dishesById[slot.dishId];
    if (!dish) return; // unreachable: the validator rejects an unknown dish. Defensive only.
    menu.set(dish.id, { dish, price: toCents(slot.price), isAddon });
  };
  for (const slot of player.setup?.menu ?? []) add(slot, false);
  for (const slot of player.setup?.addons ?? []) add(slot, true);
  return menu;
}

function buildRestaurant(player) {
  return {
    // A restaurant is identified by its owner's playerId — the same id `customer-system.js`
    // puts on `party.restaurantId`.
    restaurantId: player.playerId,
    playerId: player.playerId,
    menu: buildMenu(player),
    stations: buildStations(),
    orders: new Map(),
    /**
     * The server-side money and outcome record. PRD §11's penalty list names "Canceled orders"
     * with no formula, and scoring is STORY-013 — so what this story owes is a countable,
     * explained penalty record, not a score. The cancellation counters carry both the count and
     * the revenue that walked out with it, which is the number a penalty term will want.
     */
    ledger: {
      revenue: 0,
      ordersPlaced: 0,
      ordersDelivered: 0,
      ordersPaid: 0,
      dishesProduced: 0,
      cancelledOrders: 0,
      cancelledRevenueForgone: 0,
      voidedTickets: 0,
      walkedOutOrders: 0,
      walkedOutRevenueForgone: 0,
      qualitySum: 0,
      qualitySamples: 0,
    },
  };
}

function ensureState(match) {
  if (!match._orderSimState) {
    const state = {
      rng: match.createRngStream(ORDER_RNG_STREAM),
      restaurants: new Map(),
      nextOrderId: 1,
      nextTicketId: 1,
    };
    for (const player of match.players.values()) {
      state.restaurants.set(player.playerId, buildRestaurant(player));
    }
    match._orderSimState = state;
    match.kitchen = createKitchenFacade(match, state);
  }
  return match._orderSimState;
}

// --- PRD §17 step 2: generating the order -----------------------------------------------------

function countMatchingTags(tags, list) {
  if (!list || list.length === 0) return 0;
  let n = 0;
  for (const tag of tags) if (list.includes(tag)) n += 1;
  return n;
}

/**
 * How attractive one menu entry is to one party, as a non-negative weight for a seeded draw.
 * PRD §17 step 2 names four inputs and all four are here:
 *
 *   segment preferences — the party's own preferred/disliked tags, plus the dish's
 *                         `marketAffinity` for the district actually being played;
 *   menu availability   — an unavailable dish is filtered out before this runs (STORY-006);
 *   price               — on the same market-scaled value axis `priceGuidance()` uses, so the
 *                         district's `priceSensitivity` decides how much a mark-up costs, and a
 *                         dish above the party's own hidden budget keeps only a sliver;
 *   event context       — `dishTagDemandMultipliers`, through the shared §16 vocabulary.
 */
function dishWeight(match, entry, request) {
  const { dish, price } = entry;
  const market = match.market;

  let weight = Number.isFinite(dish.marketAffinity?.[market?.id]) ? dish.marketAffinity[market.id] : 1;

  weight *= 1 + ORDER_PREFERRED_TAG_BONUS * countMatchingTags(dish.tags, request.preferredTags);
  weight *= ORDER_DISLIKED_TAG_PENALTY ** countMatchingTags(dish.tags, request.dislikedTags);

  weight *= dishDemandMultiplier(getEventEffects(match), dish.tags);

  const sensitivity = Number.isFinite(market?.priceSensitivity) ? market.priceSensitivity : 1;
  const adjusted = Math.max(0.05, 1 + (price / dish.suggestedPrice - 1) * sensitivity);
  weight *= adjusted ** -ORDER_PRICE_ELASTICITY;

  if (price > request.budget) weight *= ORDER_OVER_BUDGET_WEIGHT;

  return Math.max(0, weight);
}

function weightedPick(entries, weights, rng) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return entries[entries.length - 1] ?? null;
  let r = rng() * total;
  for (let i = 0; i < entries.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return entries[i];
  }
  return entries[entries.length - 1];
}

/** The menu entries a party may actually be served right now, split by slot kind. */
function orderableEntries(match, restaurant) {
  const mains = [];
  const addons = [];
  for (const entry of restaurant.menu.values()) {
    if (!isDishAvailable(match, restaurant.restaurantId, entry.dish.id)) continue;
    (entry.isAddon ? addons : mains).push(entry);
  }
  return { mains, addons };
}

function makeTicket(state, order, entry) {
  return {
    ticketId: `ticket_${state.nextTicketId++}`,
    orderId: order.orderId,
    dishId: entry.dish.id,
    dish: entry.dish,
    price: entry.price,
    state: 'placed',
    /** Index into the dish's `stationSteps`; -1 until the first step starts. */
    stepIndex: -1,
    /** The station this ticket is at, or waiting for. Null once it is off the line. */
    station: entry.dish.stationSteps[0]?.station ?? null,
    remainingMs: 0,
    readyAtMs: null,
    voidedReason: null,
    /** STORY-006. The ingredient this ticket could not be started for, or null. A `queued`
     * ticket with a non-null blocker is not waiting for a free pair of hands — it is waiting for
     * stock to reach the station, which is a different §8 bottleneck with a different fix. */
    blockedByIngredientId: null,
  };
}

/**
 * PRD §17 steps 2 and 3 together: one main per guest, an add-on per guest at
 * `ORDER_ADDON_PROBABILITY`, each becoming a ticket in the kitchen workflow.
 *
 * Every draw comes from `match.createRngStream('orders')` (Decision 18), so what a party orders
 * is reproducible from the match seed and independent of what any other system draws.
 */
function generateOrder(match, state, restaurant, request) {
  const { mains, addons } = orderableEntries(match, restaurant);
  if (mains.length === 0) return { ok: false, reason: 'no_dish_available' };

  const order = {
    orderId: `order_${state.nextOrderId++}`,
    restaurantId: restaurant.restaurantId,
    customerId: request.customerId,
    tableId: request.tableId ?? null,
    placedAtMs: match.elapsedMs,
    readyAtMs: null,
    deliveredAtMs: null,
    finishedAtMs: null,
    state: 'placed',
    tickets: [],
    request,
    quality: null,
    qualityComponents: null,
    satisfaction: null,
    revenue: 0,
    settled: false,
  };

  const mainWeights = mains.map((entry) => dishWeight(match, entry, request));
  const addonWeights = addons.map((entry) => dishWeight(match, entry, request));

  for (let guest = 0; guest < request.partySize; guest += 1) {
    order.tickets.push(makeTicket(state, order, weightedPick(mains, mainWeights, state.rng)));
    if (addons.length > 0 && state.rng() < ORDER_ADDON_PROBABILITY) {
      order.tickets.push(makeTicket(state, order, weightedPick(addons, addonWeights, state.rng)));
    }
  }

  // The ticket price IS the price the player set in setup. Nothing else is ever used, and the
  // client is never asked (Decision 2).
  order.quotedRevenue = toCents(order.tickets.reduce((sum, t) => sum + t.price, 0));

  restaurant.orders.set(order.orderId, order);
  restaurant.ledger.ordersPlaced += 1;
  for (const ticket of order.tickets) enqueueTicket(restaurant, ticket);
  return { ok: true, orderId: order.orderId };
}

// --- the production line ----------------------------------------------------------------------

function enqueueTicket(restaurant, ticket) {
  const station = restaurant.stations.get(ticket.station);
  if (!station) {
    // A dish routed through a station this layout does not have. The setup validator's
    // `dish_not_producible` rule makes this unreachable for a menu dish; void rather than hang.
    voidTicket(restaurant, ticket, 'station_missing');
    return;
  }
  ticket.state = 'queued';
  station.queue.push(ticket);
  if (station.queue.length > station.maxQueueDepth) station.maxQueueDepth = station.queue.length;
}

function startStep(match, station, ticket) {
  ticket.stepIndex += 1;
  const step = ticket.dish.stationSteps[ticket.stepIndex];
  // THE ONLY SOURCE OF A STATION TIMING IS dishes.json. No inline constant, ever.
  ticket.remainingMs = step.durationMs * stationSpeedMultiplier(match, station.station);
  ticket.state = 'in_progress';
  station.active.push(ticket);
}

function finishStep(match, restaurant, ticket) {
  const nextStep = ticket.dish.stationSteps[ticket.stepIndex + 1];
  if (nextStep) {
    ticket.station = nextStep.station;
    enqueueTicket(restaurant, ticket);
    return;
  }
  // Off the line and onto the service pass. Freshness starts decaying from this instant.
  ticket.state = 'ready';
  ticket.station = null;
  ticket.remainingMs = 0;
  ticket.readyAtMs = match.elapsedMs;
  restaurant.ledger.dishesProduced += 1;
}

function voidTicket(restaurant, ticket, reason) {
  ticket.state = 'cancelled';
  ticket.station = null;
  ticket.remainingMs = 0;
  ticket.voidedReason = reason;
  restaurant.ledger.voidedTickets += 1;
}

/** Remove a ticket from whichever station list is holding it. */
function detachTicket(restaurant, ticket) {
  for (const station of restaurant.stations.values()) {
    const a = station.active.indexOf(ticket);
    if (a !== -1) station.active.splice(a, 1);
    const q = station.queue.indexOf(ticket);
    if (q !== -1) station.queue.splice(q, 1);
  }
}

/**
 * Pass 1: burn `dtMs` off everything currently being worked, and hand every completed step on.
 * Done for ALL stations before any dispatching, so the result cannot depend on which station
 * happens to be processed first.
 */
function advanceActiveTickets(match, restaurant, dtMs) {
  const completed = [];
  for (const station of restaurant.stations.values()) {
    if (station.active.length > 0) station.busyMs += station.active.length * dtMs;
    for (const ticket of station.active) {
      ticket.remainingMs -= dtMs;
      if (ticket.remainingMs <= 0) completed.push({ station, ticket });
    }
  }
  for (const { station, ticket } of completed) {
    const at = station.active.indexOf(ticket);
    if (at !== -1) station.active.splice(at, 1);
    finishStep(match, restaurant, ticket);
  }
}

/**
 * Pass 2: fill every free pair of hands from that station's queue, FIFO.
 *
 * This is the concurrency limit, and it is the whole difficulty of the kitchen: a station with
 * `concurrency` tickets already active starts nothing, and the rest of its queue simply waits.
 * A ticket that moved to its next station in pass 1 may start there in the same tick — the
 * hand-off between stations is instantaneous, the WAIT is the queue.
 */
function dispatchQueues(match, restaurant) {
  for (const stationId of LAYOUT_STATIONS) {
    const station = restaurant.stations.get(stationId);
    if (!station) continue;
    let index = 0;
    while (station.active.length < station.concurrency && index < station.queue.length) {
      const ticket = station.queue[index];
      if (!claimIngredients(match, restaurant, station, ticket)) {
        // Skipped, not stopped: PRD §8's consequence of a shortage is that the affected DISHES
        // stall, not that the kitchen does. A head-of-line block would let one empty bin idle
        // every other pair of hands at that station. The ticket keeps its place in the queue.
        index += 1;
        continue;
      }
      station.queue.splice(index, 1);
      startStep(match, station, ticket);
    }
  }
}

/**
 * STORY-006's other half. The `dishAvailability` seam below answers "may this dish be ORDERED",
 * which is a question about the menu; this answers "may this ticket be STARTED", which is a
 * question about the station's bin, and the two are deliberately not the same — an order placed
 * while the bin was full may reach the front of the queue after it has run dry.
 *
 * Called at the instant a ticket's FIRST station step is dispatched (`stepIndex === -1`) and
 * never again, because that is when the raw goods are actually pulled: an order sitting in a
 * queue has not been cooked and has not spent anything.
 *
 * `match.pantry` is read exactly as defensively as `match.dishAvailability` and
 * `match.eventEffects` are — with no inventory system registered, every claim succeeds and this
 * file behaves precisely as it did before STORY-006.
 */
function claimIngredients(match, restaurant, station, ticket) {
  if (ticket.stepIndex !== -1) return true; // already claimed when this ticket first started
  const pantry = match.pantry;
  if (!pantry) return true;
  const claim = pantry.claim(restaurant.restaurantId, station.station, ticket.dish);
  ticket.blockedByIngredientId = claim.ok ? null : (claim.missingIngredientId ?? null);
  return claim.ok;
}

/**
 * STORY-006's second outcome. A dish that goes unavailable while its ticket has not yet been
 * started is voided; one already on the line is finished, because the ingredients are spent.
 */
function voidUnavailableTickets(match, restaurant) {
  if (!match.dishAvailability?.[restaurant.restaurantId]) return; // nothing to check, cheap exit
  for (const order of restaurant.orders.values()) {
    if (order.state === 'delivered' || order.state === 'cancelled') continue;
    for (const ticket of order.tickets) {
      if (ticket.state !== 'queued') continue;
      if (isDishAvailable(match, restaurant.restaurantId, ticket.dishId)) continue;
      detachTicket(restaurant, ticket);
      voidTicket(restaurant, ticket, 'dish_unavailable');
    }
  }
}

// --- PRD §17 "Order quality" ------------------------------------------------------------------

/** "Freshness: time since completion." Full marks inside the grace period, then linear to the
 * floor across the rest of the window. */
export function freshnessAt(readyAtMs, atMs) {
  if (readyAtMs === null) return 0;
  const age = Math.max(0, atMs - readyAtMs);
  if (age <= ORDER_FRESHNESS_GRACE_MS) return 1;
  const span = ORDER_FRESHNESS_WINDOW_MS - ORDER_FRESHNESS_GRACE_MS;
  if (span <= 0) return ORDER_FRESHNESS_FLOOR;
  return clamp(1 - (age - ORDER_FRESHNESS_GRACE_MS) / span, ORDER_FRESHNESS_FLOOR, 1);
}

/** How well one dish fits this party's tags. 0.5 is "no opinion", not "bad". */
function preferenceFitFor(dish, request) {
  const liked = countMatchingTags(dish.tags, request.preferredTags);
  const disliked = countMatchingTags(dish.tags, request.dislikedTags);
  return clamp(0.5 + ORDER_PREFERENCE_TAG_STEP * (liked - disliked), 0, 1);
}

/**
 * PRD §8's `priceFairness` factor, on the same market-scaled value axis `priceGuidance()` uses
 * in setup-rules.js: a dish at its suggested price is entirely fair, and the district's
 * `priceSensitivity` decides how fast a mark-up stops being. Below the suggested price is
 * simply fair, not extra-fair — a bargain is already scored by the value the guest got.
 */
function priceFairnessFor(dish, price, market) {
  const sensitivity = Number.isFinite(market?.priceSensitivity) ? market.priceSensitivity : 1;
  const adjusted = 1 + (price / dish.suggestedPrice - 1) * sensitivity;
  return clamp(1 - Math.max(0, adjusted - 1) * ORDER_PRICE_FAIRNESS_SLOPE, 0, 1);
}

/**
 * Score a delivered order. PRD §17 lists six order-quality components; the two it marks as
 * "later versions" (preparation-quality tiers, ingredient-quality upgrades) are deliberately
 * absent rather than stubbed at 1.0, so these weights never need re-tuning when they land.
 *
 * Returns both the single §17 `quality` number and the named PRD §8 satisfaction factors this
 * story makes computable for the first time — `dishQuality`, `dishPreferenceMatch`,
 * `orderAccuracy` and `priceFairness`, all of which `customer-system.js` had returning `null`.
 */
function scoreOrder(match, order, atMs) {
  const served = order.tickets.filter((t) => t.state === 'ready');
  const mean = (values) => (values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length);

  // "Correctness: required dish delivered" — every dish the party asked for actually arrived.
  const correctness = order.tickets.length === 0 ? 0 : served.length / order.tickets.length;

  const freshness = mean(served.map((t) => freshnessAt(t.readyAtMs, atMs)));
  const preferenceFit = mean(served.map((t) => preferenceFitFor(t.dish, order.request)));

  // "Service timing" — how long the kitchen took, against the share of THIS party's own
  // patience budget that PRD §8 allots to waiting for food.
  const waitMs = atMs - order.placedAtMs;
  const tolerated = order.request.patienceMs * CUSTOMER_WAIT_TOLERANCE_SHARE.food;
  const serviceTiming = tolerated > 0 ? clamp(1 - waitMs / tolerated, 0, 1) : 0;

  const w = ORDER_QUALITY_WEIGHTS;
  const quality = clamp(
    w.correctness * correctness +
      w.freshness * freshness +
      w.preferenceFit * preferenceFit +
      w.serviceTiming * serviceTiming,
    0,
    1,
  );

  // The dish's own `baseSatisfaction` is the ceiling a perfectly fresh plate can reach; the
  // freshness it was actually served at is what the guest experiences.
  const intrinsic = mean(served.map((t) => t.dish.baseSatisfaction / 100));

  return {
    quality,
    components: { correctness, freshness, preferenceFit, serviceTiming },
    satisfaction: {
      dishQuality: clamp(intrinsic * freshness, 0, 1),
      dishPreferenceMatch: preferenceFit,
      orderAccuracy: correctness,
      priceFairness: mean(served.map((t) => priceFairnessFor(t.dish, t.price, match.market))),
    },
    servedDishIds: served.map((t) => t.dishId),
  };
}

// --- delivery ----------------------------------------------------------------------------------

function allTicketsOffTheLine(order) {
  return order.tickets.every((t) => t.state === 'ready' || t.state === 'cancelled');
}

/**
 * An order every ticket of which is off the line is handed over after the abstracted
 * service-pass hand-off, and scored at the moment it lands on the table — which is what makes
 * freshness bite: the espresso that plated first has been sitting the whole time the steak was
 * on the grill.
 */
function resolveReadyOrders(match, restaurant) {
  for (const order of restaurant.orders.values()) {
    if (order.state === 'delivered' || order.state === 'cancelled') continue;

    if (!allTicketsOffTheLine(order)) {
      if (order.state === 'placed') order.state = 'in_progress';
      continue;
    }

    const served = order.tickets.filter((t) => t.state === 'ready');
    if (served.length === 0) {
      // Every dish was voided — there is nothing to serve. PRD §8 CANCEL_ORDER, via the poll.
      cancelOrder(restaurant, order, 'all_dishes_unavailable', match.elapsedMs);
      continue;
    }

    if (order.state !== 'ready') {
      order.state = 'ready';
      order.readyAtMs = match.elapsedMs;
      continue;
    }
    if (match.elapsedMs - order.readyAtMs < ORDER_PASS_HANDOFF_MS) continue;

    const scored = scoreOrder(match, order, match.elapsedMs);
    order.state = 'delivered';
    order.deliveredAtMs = match.elapsedMs;
    order.quality = scored.quality;
    order.qualityComponents = scored.components;
    order.satisfaction = scored.satisfaction;
    // Server-side, from the player's own set prices, over the dishes that ACTUALLY arrived.
    order.revenue = toCents(served.reduce((sum, t) => sum + t.price, 0));
    for (const ticket of served) ticket.state = 'delivered';
    restaurant.ledger.ordersDelivered += 1;
    restaurant.ledger.qualitySum += scored.quality;
    restaurant.ledger.qualitySamples += 1;
  }
}

function cancelOrder(restaurant, order, reason, atMs) {
  if (order.state === 'cancelled' || order.state === 'delivered') return;
  for (const ticket of order.tickets) {
    if (ticket.state === 'ready' || ticket.state === 'cancelled') continue;
    detachTicket(restaurant, ticket);
    voidTicket(restaurant, ticket, reason);
  }
  // A plate already on the pass when the party walks is thrown away: PRD §11 counts "Unserved
  // food waste" separately, and a ticket left in `ready` would read as food that got eaten.
  for (const ticket of order.tickets) {
    if (ticket.state === 'ready') voidTicket(restaurant, ticket, reason);
  }
  order.state = 'cancelled';
  order.cancelReason = reason;
  order.finishedAtMs = atMs;
  // PRD §11 "Penalties: Canceled orders". Recorded with the money that walked out with it;
  // STORY-013 decides what a cancellation is WORTH, this story guarantees it is countable.
  restaurant.ledger.cancelledOrders += 1;
  restaurant.ledger.cancelledRevenueForgone = toCents(
    restaurant.ledger.cancelledRevenueForgone + order.quotedRevenue,
  );
}

/** Drop finished orders out of the snapshot once they have been visible long enough to read. */
function expireFinishedOrders(match, restaurant) {
  for (const [orderId, order] of restaurant.orders) {
    const finishedAtMs =
      order.state === 'delivered'
        ? order.deliveredAtMs
        : order.state === 'cancelled'
          ? order.finishedAtMs
          : null;
    if (finishedAtMs === null) continue;
    // A delivered order is held until it has been settled (or abandoned), so the customer
    // system can still find it when the party finally reaches PAYING.
    if (order.state === 'delivered' && !order.settled) continue;
    if (match.elapsedMs - finishedAtMs >= ORDER_SNAPSHOT_LINGER_MS) restaurant.orders.delete(orderId);
  }
}

// --- the facade the customer system calls -------------------------------------------------------

function findOrder(state, orderId) {
  if (!orderId) return null;
  for (const restaurant of state.restaurants.values()) {
    const order = restaurant.orders.get(orderId);
    if (order) return { restaurant, order };
  }
  return null;
}

function createKitchenFacade(match, state) {
  return {
    /**
     * PRD §17 steps 2-3. `request` is an explicit field list built by the caller:
     * `{customerId, restaurantId, tableId, partySize, segmentId, preferredTags, dislikedTags,
     *   budget, patienceMs}`.
     */
    placeOrder(request) {
      const restaurant = state.restaurants.get(request.restaurantId);
      if (!restaurant) return { ok: false, reason: 'unknown_restaurant' };
      return generateOrder(match, state, restaurant, request);
    },

    /**
     * Has this order landed? `null` while the kitchen is still working. The delivery result
     * carries the PRD §8 satisfaction factors this story makes real; the caller stores them and
     * its own formula picks them up.
     */
    pollDelivery(orderId) {
      const found = findOrder(state, orderId);
      if (!found) return null;
      const { order } = found;
      if (order.state === 'cancelled') {
        return { cancelled: true, reason: order.cancelReason ?? 'cancelled' };
      }
      if (order.state !== 'delivered') return null;
      return {
        delivered: true,
        orderId: order.orderId,
        quality: order.quality,
        revenue: order.revenue,
        satisfaction: order.satisfaction,
      };
    },

    /** The party gave up. PRD §8 CANCEL_ORDER; PRD §11's canceled-order penalty path. */
    cancelOrder(orderId, reason = 'customer_left') {
      const found = findOrder(state, orderId);
      if (!found) return false;
      cancelOrder(found.restaurant, found.order, reason, match.elapsedMs);
      return true;
    },

    /**
     * The party reached PAYING. THIS is where revenue moves — computed server-side, at the
     * price the player set in setup, over the dishes that actually reached the table.
     */
    settleOrder(orderId) {
      const found = findOrder(state, orderId);
      if (!found) return 0;
      const { restaurant, order } = found;
      if (order.state !== 'delivered' || order.settled) return 0;
      order.settled = true;
      restaurant.ledger.revenue = toCents(restaurant.ledger.revenue + order.revenue);
      restaurant.ledger.ordersPaid += 1;
      return order.revenue;
    },

    /** The party stormed out (LEAVE_ANGRY) with the food on the table. No revenue; recorded. */
    abandonOrder(orderId, reason = 'left_angry') {
      const found = findOrder(state, orderId);
      if (!found) return false;
      const { restaurant, order } = found;
      if (order.state === 'delivered' && !order.settled) {
        order.settled = true; // resolved, in the sense that no money will ever move for it.
        order.abandonReason = reason;
        restaurant.ledger.walkedOutOrders += 1;
        restaurant.ledger.walkedOutRevenueForgone = toCents(
          restaurant.ledger.walkedOutRevenueForgone + order.revenue,
        );
        return true;
      }
      cancelOrder(restaurant, order, reason, match.elapsedMs);
      return true;
    },

    /** Server-side revenue for one restaurant. STORY-013 scores from this. */
    revenueFor(restaurantId) {
      return state.restaurants.get(restaurantId)?.ledger.revenue ?? 0;
    },

    /** The whole outcome record for one restaurant, as a copy. */
    ledgerFor(restaurantId) {
      const ledger = state.restaurants.get(restaurantId)?.ledger;
      return ledger ? { ...ledger } : null;
    },

    /** Tickets waiting (not being worked) at one station — the same number the snapshot
     * exposes; see `toPublicOrderSnapshot`. */
    queueDepth(restaurantId, station) {
      return state.restaurants.get(restaurantId)?.stations.get(station)?.queue.length ?? 0;
    },
  };
}

// --- the public projection — the ONLY function allowed to shape match.orders -------------------

/**
 * One entry per TICKET, matching `OrderSnapshot` in shared/schemas/game-state.d.ts field for
 * field. An explicit allowlist, not a spread: the internal ticket holds a reference to the
 * whole dish record and the order holds the party's hidden §6 profile, and neither may reach
 * the wire.
 *
 * STATION QUEUE DEPTH IS DERIVED, NOT DUPLICATED. Each ticket carries `station` and `state`, so
 * the depth of a station's queue is exactly
 *
 *     orders.filter((o) => o.station === station && o.state === 'queued').length
 *
 * which cannot drift out of step with the kitchen the way a denormalized per-ticket copy of the
 * number would. `scripts/check-orders.mjs` asserts that identity against `kitchen.queueDepth()`.
 */
function toPublicOrderSnapshot(order, ticket, elapsedMs) {
  return {
    orderId: order.orderId,
    ticketId: ticket.ticketId,
    restaurantId: order.restaurantId,
    customerId: order.customerId,
    tableId: order.tableId,
    dishId: ticket.dishId,
    price: ticket.price,
    state: ticket.state,
    station: ticket.station,
    currentStepIndex: ticket.stepIndex,
    remainingMs: Math.max(0, Math.round(ticket.remainingMs)),
    readyAgeMs: ticket.readyAtMs === null ? 0 : Math.max(0, Math.round(elapsedMs - ticket.readyAtMs)),
    blockedByIngredientId: ticket.blockedByIngredientId ?? null,
  };
}

function publicOrders(match, state) {
  const out = [];
  for (const restaurant of state.restaurants.values()) {
    for (const order of restaurant.orders.values()) {
      for (const ticket of order.tickets) {
        out.push(toPublicOrderSnapshot(order, ticket, match.elapsedMs));
      }
    }
  }
  return out;
}

// --- the system ---------------------------------------------------------------------------------

export const orderSystem = {
  id: 'orders',
  phases: ['service', 'final_rush'],

  update(match, dtMs) {
    const state = ensureState(match);

    for (const restaurant of state.restaurants.values()) {
      voidUnavailableTickets(match, restaurant);
      advanceActiveTickets(match, restaurant, dtMs);
      dispatchQueues(match, restaurant);
      resolveReadyOrders(match, restaurant);
      expireFinishedOrders(match, restaurant);
    }

    // match.js's toSnapshot() serializes whatever is here verbatim. Only ever the sanitized
    // projection, never the internal ticket or order objects.
    match.orders = publicOrders(match, state);
  },

  onPhaseChange(match, transition) {
    // The facade must exist before the customer system first ticks in service. The loop runs
    // every system's onPhaseChange before any update, so this is a guarantee, not a race.
    if (transition.to === 'service') {
      ensureState(match);
      return;
    }
    if (transition.to !== 'results') return;
    if (!match._orderSimState) return;

    for (const restaurant of match._orderSimState.restaurants.values()) {
      const l = restaurant.ledger;
      const avgQuality = l.qualitySamples > 0 ? (l.qualitySum / l.qualitySamples).toFixed(3) : 'n/a';
      console.log(
        `[orders] ${match.id} ${restaurant.restaurantId} revenue=$${l.revenue.toFixed(2)} ` +
          `placed=${l.ordersPlaced} delivered=${l.ordersDelivered} paid=${l.ordersPaid} ` +
          `dishes=${l.dishesProduced} avgQuality=${avgQuality} ` +
          `cancelled=${l.cancelledOrders} ($${l.cancelledRevenueForgone.toFixed(2)} forgone) ` +
          `walkouts=${l.walkedOutOrders} ($${l.walkedOutRevenueForgone.toFixed(2)} forgone) ` +
          `stations=[${[...restaurant.stations.values()]
            .map((s) => `${s.station} x${s.concurrency} peakQ=${s.maxQueueDepth}`)
            .join(' ')}]`,
      );
    }

    match.orders = [];
    match.kitchen = undefined;
    match._orderSimState = undefined;
  },
};

/**
 * Exported for scripts/check-orders.mjs ONLY — not part of the system's contract, and no other
 * system or route may import it. Decision 8: the repo has no test framework, so a runnable
 * script is the only way to force a specific branch (a full station, an unavailable dish, a
 * stale plate) deterministically rather than hoping a seeded run produces one.
 */
export const _internal = {
  ensureState,
  generateOrder,
  dishWeight,
  scoreOrder,
  preferenceFitFor,
  priceFairnessFor,
  advanceActiveTickets,
  dispatchQueues,
  claimIngredients,
  resolveReadyOrders,
  voidUnavailableTickets,
  cancelOrder,
  toPublicOrderSnapshot,
  publicOrders,
  buildStations,
  concurrencyFor,
  LAYOUT_STATIONS,
};
