// The customer party state machine, PRD §8 "Customer state machine" / §17 "Customer acquisition
// system", now running over a SHARED DISTRICT (STORY-010).
//
// ============================================================================================
// THE SHARED DISTRICT (STORY-010). PRD §22: "Both restaurants draw customers from one shared
// district pool." Parties are spawned by the DISTRICT, not per restaurant: one Poisson arrival
// process, one pool, and every party evaluates every restaurant in the match before choosing
// one probabilistically or walking away. See `resolveEvaluateRestaurants` and the block above
// it for the model itself.
//
// A district with one restaurant (a `POST /api/dev/match` match, and every check script that
// seats a single player) is the degenerate case of the same code: one candidate, no rival to
// compare against, so `decisionReason` stays null and CHOOSE_RIVAL never fires — which is the
// honest answer, and a strict improvement on the 8% phantom rival this replaced.
// ============================================================================================
//
// Registers against the simulation loop per Decision 15 (match-lifecycle-and-phase-clock/
// design.md) — one file, one line in systems/index.js, no edit to match.js's clock/phase logic.
// `phases: ['service', 'final_rush']` means this system is simply not called outside those
// phases; no phase guard is needed inside update().
//
// THE ONE EXCEPTION, DISCLOSED: `match.js`'s `toSnapshot()` had `customers: []` hardcoded with
// no other integration point for real data — snapshots are pull-based per viewer, built by a
// method that lives in match.js. That one field now reads `this.customers ?? []` (so every
// match that predates this story, or never reaches `service`, is unaffected) instead of the
// literal empty array. `toSnapshot()` has since been generalised so that every entity array it
// carries defaults the same way, which is why STORY-005's orders needed no further edit there
// at all — the kitchen simply attaches `match.orders` and it serializes.
// match.js still contains zero customer *logic*; it only serializes whatever this system
// attaches. This is disclosed here and in the PR because Decision 15 promises "no edit to
// match.js" and this is a narrow, deliberate exception to that promise, not an oversight.
//
// THE KITCHEN SEAM (STORY-005). `WAITING_FOR_FOOD` used to end after an INVENTED duration
// drawn from `CUSTOMER_FOOD_WAIT_MS_RANGE`, documented as standing in until a kitchen existed.
// It now ends when the kitchen actually plates the party's order. The two systems talk through
// one object on the match, `match.kitchen`, published by `order-system.js`; neither reads the
// other's internals. This system PUSHES an order (an explicit field list, never the internal
// party object) and POLLS for its delivery by order id — an id that was already a public field
// on `CustomerSnapshot`. If no kitchen is registered, nothing invents a duration: the party
// waits, its patience runs out, and it leaves via CANCEL_ORDER, which is the honest outcome for
// a restaurant with no kitchen.
//
// PRIVACY (PRD §6, this story's hardest requirement): a party's hidden profile — budget,
// patienceSeconds, the four choice weights, preferred/disliked tags — must never reach the
// client. `toPublicCustomerSnapshot` is the ONLY function that produces what `match.customers`
// holds, and it is an explicit field allowlist, not a spread — so no future field added to the
// internal party object can leak by accident.

import { catalogue } from '../catalogue.js';
import layout from '../../../../shared/game-data/restaurant-layout.json' with { type: 'json' };
import { CUSTOMER_STATES, isExitState } from '../../../../shared/schemas/game-state.js';
import { STATIONS } from '../../../../shared/schemas/messages.js';
// The event system's own reader for "how much does this event want a dish with these tags",
// imported rather than reimplemented against `dishTagDemandMultipliers` — order-system.js
// already takes `neutralEventEffects` from here for the same reason. A field name that moves
// then breaks a build instead of silently zeroing event affinity.
import { dishDemandMultiplier } from './event-system.js';
import {
  CUSTOMER_RNG_STREAM,
  CUSTOMER_ENTER_DISTRICT_MS,
  CUSTOMER_EVALUATE_RESTAURANTS_MS,
  CUSTOMER_SEATED_GREET_MS,
  CUSTOMER_ORDERING_MS,
  CUSTOMER_EATING_MS_RANGE,
  CUSTOMER_PAYING_MS,
  CUSTOMER_LEAVING_MS,
  CUSTOMER_EXIT_LINGER_MS,
  CUSTOMER_MAX_SPAWNS_PER_TICK,
  CUSTOMER_PROFILE_JITTER,
  CUSTOMER_WAIT_TOLERANCE_SHARE,
  CUSTOMER_VISIT_DURATION_TOLERANCE_MULTIPLIER,
  CUSTOMER_SATISFACTION_WEIGHTS,
  CUSTOMER_ANGRY_SATISFACTION_THRESHOLD,
  DISTRICT_RNG_STREAM,
  DISTRICT_CHOICE_TEMPERATURE,
  DISTRICT_LEAVE_UTILITY,
  DISTRICT_EVENT_AFFINITY_WEIGHT,
  DISTRICT_REASON_EPSILON,
  DISTRICT_TABLE_TURN_MS,
  DISTRICT_BACKLOG_WAIT_PER_TICKET_MS,
  DISTRICT_WAIT_INTOLERABLE_MULTIPLE,
  DISTRICT_PRICE_VALUE_SLOPE,
  DISTRICT_PRICE_NEUTRAL_VALUE,
  DISTRICT_MENU_FIT_TAG_STEP,
  DISTRICT_REPUTATION_START,
  DISTRICT_REPUTATION_MIN,
  DISTRICT_REPUTATION_MAX,
  DISTRICT_REPUTATION_REVIEW_WEIGHT,
  DISTRICT_REPUTATION_WALKOUT_PENALTY,
  EVENT_DEMAND_SHIFT_BAND,
  UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD,
  OWNER_COMPLAINT_PATIENCE_RELIEF_FRAC,
} from '../../../../shared/constants/tuning.js';

const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

/** States in which a party is "waiting for something" and its patience decays. Once EATING
 * begins the party has what it came for, so patience stops decaying (PRD §8 lists "total visit
 * duration" as a separate satisfaction factor, not a second abandonment clock). */
const PATIENCE_DECAYING_STATES = new Set([
  CUSTOMER_STATES.APPROACH_OR_QUEUE,
  CUSTOMER_STATES.SEATED,
  CUSTOMER_STATES.ORDERING,
  CUSTOMER_STATES.WAITING_FOR_FOOD,
]);

/** Event effects share the §16 vocabulary (design Decision 12). The event system publishes
 * the active event's effects on `match.eventEffects`, with every key present at a neutral
 * value at all times, so this can be read unconditionally. The neutral default below still
 * matters: a match running without the event system registered (several check scripts do
 * exactly that) has no such field at all. This system never reaches into the event system —
 * it only reads this one match-state field. */
const NEUTRAL_EVENT_EFFECTS = Object.freeze({
  footTrafficMultiplier: 1,
  partySizeMultiplier: 1,
  segmentWeightOverrides: Object.freeze({}),
});

function getEventEffects(match) {
  return match.eventEffects ?? NEUTRAL_EVENT_EFFECTS;
}

// --- lazily-initialized, per-match simulation state -----------------------------------------
//
// Attached dynamically to the match instance rather than declared in match.js's constructor —
// match.js knows nothing about customers; this system owns its own state entirely. A match that
// never reaches `service` never gets this property at all, and `toSnapshot` already treats an
// absent `match.customers` as `[]`.

function buildTables() {
  const tables = new Map();
  for (const entity of layout.entities) {
    if (entity.type === 'table') {
      tables.set(entity.id, {
        id: entity.id,
        seats: entity.seats,
        position: entity.position,
        occupiedBy: null,
        /**
         * STORY-007. PRD §8 "Operational bottlenecks" lists a dirty table as one, `TableSnapshot`
         * has always declared the field, and §17's server priority list has "Clear dirty table"
         * as rule 4 — which is unimplementable while every table is permanently clean. A table a
         * party has left is dirty and CANNOT BE SEATED until somebody clears it.
         *
         * It only ever becomes true where a floor staff exists to clear it (`match.brigade`), so
         * a match with no worker system registered still has permanently clean tables and this
         * system behaves exactly as it did before STORY-007.
         */
        dirty: false,
        /** Bumped every time the table is dirtied, so the worker system can tell one clearing job
         * from the next one at the same table without holding a reference to it. */
        soilCount: 0,
      });
    }
  }
  return tables;
}

/**
 * One restaurant as the DISTRICT sees it: its own floor, its own queue, its own reputation, and
 * its own funnel counters. Every restaurant in the match gets one; nothing here is per-player
 * private — the private half (the menu and its prices) stays where STORY-009 put it, on the
 * player's own `setup`, and is read through `menuOf()` at evaluation time.
 *
 * `tables` is a per-restaurant copy of the layout. Both restaurants share one layout file, so
 * they share table ids and coordinates; giving each its own Map is what makes "table_1 is taken
 * at MY restaurant" independent of the rival's floor. (Rendering two restaurants at distinct
 * district coordinates is a scene story's job, not this one's — the model only needs separate
 * occupancy.)
 */
function buildRestaurantView(playerId) {
  const tables = buildTables();
  return {
    restaurantId: playerId,
    playerId,
    tables,
    totalSeats: [...tables.values()].reduce((sum, t) => sum + t.seats, 0),

    /** PRD §4.2: compounds across the match, capped so it cannot make one early. */
    reputation: DISTRICT_REPUTATION_START,

    guestsServed: 0,
    satisfactionSum: 0,
    abandonedParties: 0,

    /**
     * This restaurant's own funnel, in §8 vocabulary. `CHOOSE_RIVAL` is the one entry that is
     * NOT a party state: no party is ever in state CHOOSE_RIVAL, because the district's
     * `customers[]` array is shared by both viewers and "chose the rival" is viewer-relative —
     * the party that walked past this restaurant is walking INTO the other one, in
     * APPROACH_OR_QUEUE. It is counted here, against the restaurant that lost it, which is
     * exactly the shape STORY-014's results screen needs.
     */
    counts: {
      chosen: 0,
      [CUSTOMER_STATES.CHOOSE_RIVAL]: 0,
      [CUSTOMER_STATES.LEAVE_DISTRICT]: 0,
      [CUSTOMER_STATES.REVIEW]: 0,
      [CUSTOMER_STATES.ABANDON_QUEUE]: 0,
      [CUSTOMER_STATES.CANCEL_ORDER]: 0,
      [CUSTOMER_STATES.LEAVE_ANGRY]: 0,
    },
    /** §17 reason -> count, for the parties this restaurant WON and the ones it LOST. */
    wonByReason: {},
    lostByReason: {},

    // Memoized menu, invalidated by identity of the player's `setup` object (which setup-system
    // locks at the setup -> service transition and nothing mutates afterwards).
    _menuSource: undefined,
    _menu: [],
  };
}

function ensureState(match) {
  if (!match._customerSimState) {
    const queueEntity = layout.entities.find((e) => e.type === 'queue');
    const restaurants = new Map();
    for (const playerId of match.players.keys()) {
      restaurants.set(playerId, buildRestaurantView(playerId));
    }
    match._customerSimState = {
      rng: match.createRngStream(CUSTOMER_RNG_STREAM),
      /**
       * Decision 18: the choice draws from its OWN named sub-stream, so a change to how parties
       * choose does not shift the segment/patience/budget draws a seed produces for a given
       * party. It does NOT make the arrival TIMELINE independent of the choice: the customers
       * stream is also drawn from when a party starts eating, so how many parties get that far
       * still moves the later inter-arrival gaps. That coupling predates this story (STORY-004
       * put both draws on one stream) and is left alone rather than quietly re-cut here.
       */
      districtRng: match.createRngStream(DISTRICT_RNG_STREAM),
      parties: new Map(),
      nextId: 1,
      msUntilNextArrival: null,
      restaurants,
      queuePosition: queueEntity?.position ?? layout.spawn.customerEntry,
      entryPosition: layout.spawn.customerEntry,
      /** Every restaurant choice this match made, in order — PRD §17 step 6, "Record decision
       * reason for analytics and post-match explanation". Published on `match.districtDecisions`
       * (server-side only; it never enters a snapshot) and NOT cleared at `results`, because
       * `results` is precisely when STORY-014 reads it. */
      decisions: [],
      // Every party that ever spawned this match, in spawn order — the reproducibility check's
      // evidence, and the balance figure's raw material.
      spawnLog: [],
      // Cumulative terminal outcomes for the DISTRICT as a whole. Per-restaurant funnels live on
      // each restaurant view's own `counts` — PRD §24's "40-90 parties per restaurant" figure is
      // read from there now that a district can hold more than one restaurant.
      // `CHOOSE_RIVAL` stays declared and stays 0 here: it is a per-restaurant funnel outcome,
      // never a district one (see buildRestaurantView).
      counts: {
        spawned: 0,
        [CUSTOMER_STATES.REVIEW]: 0,
        [CUSTOMER_STATES.CHOOSE_RIVAL]: 0,
        [CUSTOMER_STATES.LEAVE_DISTRICT]: 0,
        [CUSTOMER_STATES.ABANDON_QUEUE]: 0,
        [CUSTOMER_STATES.CANCEL_ORDER]: 0,
        [CUSTOMER_STATES.LEAVE_ANGRY]: 0,
      },
    };
    match.floor = createFloorFacade(match, match._customerSimState);
  }
  return match._customerSimState;
}

// --- the facade the worker system calls (STORY-007) ------------------------------------------
//
// The mirror image of the seam `order-system.js` built the other way: the kitchen publishes
// `match.kitchen` and this system calls it; this system publishes `match.floor` and the worker
// system calls that. Neither reads the other's internals, and the only shared vocabulary is a
// customer id, a table id and a restaurant id — all of them already public on `CustomerSnapshot`.
//
// Every getter returns an explicit field list, never the internal party object: the PRD §6 hidden
// profile (budget, preferred tags, patience seconds) lives on that object and does not need to
// cross this line for a server to decide who to walk to next.

function createFloorFacade(match, state) {
  const partiesAt = (restaurantId, customerState) => {
    const out = [];
    for (const party of state.parties.values()) {
      if (party.restaurantId !== restaurantId) continue;
      if (party.state !== customerState) continue;
      out.push({
        customerId: party.customerId,
        partySize: party.partySize,
        tableId: party.tableId,
        position: { ...party.position },
        patienceRemaining: patienceFraction(party),
        waitingMs: Math.max(0, match.elapsedMs - party.stateEnteredAtMs),
      });
    }
    // Longest-waiting first. A queue is a queue: §17's server list says nothing about picking
    // favourites within one of its rules, and first-come-first-served is the rule a person
    // watching the floor would describe.
    out.sort((a, b) => b.waitingMs - a.waitingMs);
    return out;
  };
  const findParty = (customerId) => state.parties.get(customerId) ?? null;

  return {
    /** §17 server rule 2's candidates: parties standing in the queue. */
    waitingParties(restaurantId) {
      return partiesAt(restaurantId, CUSTOMER_STATES.APPROACH_OR_QUEUE);
    },

    /** Is there a clean, free table this party would fit at right now? Asked before a server
     * commits to the walk, and asked again by `seatParty` when it gets there. */
    hasTableFor(restaurantId, partySize) {
      const view = state.restaurants.get(restaurantId);
      return view ? bestFitTable(view.tables, partySize) !== null : false;
    },

    /** Walk the party to a table. Fails if the floor filled up while the server was walking —
     * which is the point of making the walk take time. */
    seatParty(customerId) {
      const party = findParty(customerId);
      if (!party || party.state !== CUSTOMER_STATES.APPROACH_OR_QUEUE) {
        return { ok: false, reason: 'not_waiting' };
      }
      tryToSeat(match, state, party);
      return party.tableId
        ? { ok: true, tableId: party.tableId }
        : { ok: false, reason: 'no_table' };
    },

    /** §17 server rule 3's candidates: parties seated and holding a menu. */
    partiesToGreet(restaurantId) {
      return partiesAt(restaurantId, CUSTOMER_STATES.SEATED);
    },

    /** The server reached the table. The party then spends `CUSTOMER_ORDERING_MS` choosing, as
     * it always has — that is the party's own deliberation, not the server standing there. */
    takeOrderFrom(customerId) {
      const party = findParty(customerId);
      if (!party || party.state !== CUSTOMER_STATES.SEATED) return { ok: false, reason: 'not_seated' };
      transitionTo(match, party, CUSTOMER_STATES.ORDERING);
      return { ok: true };
    },

    /** §17 server rule 5's candidates: parties sitting with the bill. */
    partiesAwaitingPayment(restaurantId) {
      return partiesAt(restaurantId, CUSTOMER_STATES.PAYING);
    },

    /** Money is already booked when the party finished eating (`finishEating` settles with the
     * kitchen); this is the physical half — the table is released and the party walks. */
    collectPayment(customerId) {
      const party = findParty(customerId);
      if (!party || party.state !== CUSTOMER_STATES.PAYING) return { ok: false, reason: 'not_paying' };
      freeTable(match, state, party);
      const [ex, ey, ez] = state.entryPosition;
      party.position = { x: ex, y: ey, z: ez };
      transitionTo(match, party, CUSTOMER_STATES.LEAVING);
      return { ok: true };
    },

    /** §17 server rule 4's candidates. `soilCount` distinguishes this dirtying from the next one
     * at the same table, so a clearing job can be counted once. */
    dirtyTables(restaurantId) {
      const view = state.restaurants.get(restaurantId);
      if (!view) return [];
      return [...view.tables.values()]
        .filter((table) => table.dirty)
        .map((table) => ({
          tableId: table.id,
          soilCount: table.soilCount,
          position: { x: table.position[0], y: table.position[1], z: table.position[2] },
        }));
    },

    clearTable(restaurantId, tableId) {
      const table = state.restaurants.get(restaurantId)?.tables.get(tableId);
      if (!table || !table.dirty) return { ok: false, reason: 'not_dirty' };
      table.dirty = false;
      return { ok: true };
    },

    tablePositionOf(restaurantId, tableId) {
      const table = state.restaurants.get(restaurantId)?.tables.get(tableId);
      return table ? { x: table.position[0], y: table.position[1], z: table.position[2] } : null;
    },

    /** Where parties queue, so a server walking out to seat somebody has somewhere to walk to. */
    queuePosition() {
      const [x, y, z] = state.queuePosition;
      return { x, y, z };
    },

    /**
     * STORY-008's `handle_complaint` candidates. Only parties with a table: `everUnhappy` can
     * be set while a party is still in `APPROACH_OR_QUEUE`, but there is nowhere for the owner
     * to stand and interact with a party that has no table yet — the queue itself has no
     * per-party position, only `queuePosition()`'s single point for the whole line. No worker
     * ever reads this: PRD §17's server list has no complaint-handling rule, this is owner-only.
     */
    unhappyParties(restaurantId) {
      const out = [];
      for (const party of state.parties.values()) {
        if (party.restaurantId !== restaurantId) continue;
        if (!party.everUnhappy || party.complaintHandled) continue;
        if (!party.tableId) continue;
        out.push({ customerId: party.customerId, tableId: party.tableId });
      }
      return out;
    },

    /** The owner apologized and comped something. PRD §8: "Deliver, apologize, comp item" ->
     * satisfaction and reputation are protected rather than lost. One recovery per party — see
     * `party.complaintHandled` — so this cannot be farmed by interacting with the same table
     * repeatedly. */
    handleComplaint(customerId) {
      const party = findParty(customerId);
      if (!party || !party.everUnhappy || party.complaintHandled) {
        return { ok: false, reason: 'not_unhappy' };
      }
      party.complaintHandled = true;
      const relief = party.patienceSeconds * 1000 * OWNER_COMPLAINT_PATIENCE_RELIEF_FRAC;
      party.patienceMsRemaining = Math.min(
        party.patienceSeconds * 1000,
        party.patienceMsRemaining + relief,
      );
      return { ok: true };
    },
  };
}

// --- segment / arrival draws, seeded from match.createRngStream('customers') ----------------

/**
 * Decision 12: `segmentWeightOverrides` REPLACES the named segment's weight while active; the
 * remaining weight is redistributed proportionally across the segments not named.
 */
function effectiveSegmentWeights(market, overrides) {
  const overriddenIds = Object.keys(overrides);
  if (overriddenIds.length === 0) return market.segmentWeights;

  const overriddenSum = overriddenIds.reduce((sum, id) => sum + (overrides[id] ?? 0), 0);
  const remaining = Math.max(0, 1 - overriddenSum);
  const baseRemainingSum = Object.entries(market.segmentWeights)
    .filter(([id]) => !overriddenIds.includes(id))
    .reduce((sum, [, w]) => sum + w, 0);

  const weights = {};
  for (const [id, w] of Object.entries(market.segmentWeights)) {
    if (overriddenIds.includes(id)) {
      weights[id] = overrides[id];
    } else {
      weights[id] = baseRemainingSum > 0 ? (w / baseRemainingSum) * remaining : 0;
    }
  }
  return weights;
}

function drawSegmentId(weights, rng) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, w]) => sum + w, 0) || 1;
  let r = rng() * total;
  for (const [id, w] of entries) {
    r -= w;
    if (r <= 0) return id;
  }
  return entries[entries.length - 1][0];
}

/** +/- CUSTOMER_PROFILE_JITTER around `base`, so the party's real value cannot be reconstructed
 * from its public segmentId plus the client's own copy of customer-segments.json. */
function jittered(rng, base) {
  return base * (1 + (rng() * 2 - 1) * CUSTOMER_PROFILE_JITTER);
}

function randomInRange(rng, [min, max]) {
  return min + rng() * (max - min);
}

/** The restaurant a party is queueing at / seated in, or null before it has chosen. */
function viewOf(state, party) {
  return party.restaurantId ? (state.restaurants.get(party.restaurantId) ?? null) : null;
}

// --- spawning --------------------------------------------------------------------------------

function spawnParty(match, state, effects) {
  const weights = effectiveSegmentWeights(match.market, effects.segmentWeightOverrides ?? {});
  const segmentId = drawSegmentId(weights, state.rng);
  const segment = catalogue.segmentsById[segmentId];

  const partySizeMultiplier = effects.partySizeMultiplier ?? 1;
  const partySize = Math.max(1, Math.round(segment.partySize * partySizeMultiplier));

  const budget = jittered(state.rng, segment.budget);
  const patienceSeconds = Math.max(5, jittered(state.rng, segment.patienceSeconds));

  const customerId = `party_${state.nextId}`;
  state.nextId += 1;

  const [x, y, z] = state.entryPosition;

  const party = {
    customerId,
    segmentId,
    partySize,
    state: CUSTOMER_STATES.ENTER_DISTRICT,
    restaurantId: null,
    position: { x, y, z },
    tableId: null,
    orderId: null,
    decisionReason: null,
    satisfaction: 100,

    spawnedAtMs: match.elapsedMs,
    stateEnteredAtMs: match.elapsedMs,
    exitAtMs: undefined,

    // --- the hidden profile. NEVER read by toPublicCustomerSnapshot. -----------------------
    budget,
    patienceSeconds,
    patienceMsRemaining: patienceSeconds * 1000,
    preferredTags: segment.preferredTags,
    dislikedTags: segment.dislikedTags,
    serviceSpeedWeight: segment.serviceSpeedWeight,
    priceWeight: segment.priceWeight,
    menuFitWeight: segment.menuFitWeight,
    reputationWeight: segment.reputationWeight,

    // bookkeeping for the satisfaction wait factors — patience remaining (0..1) sampled at each
    // hand-off, so the cost of EACH wait can be isolated from the cumulative countdown.
    patienceAtSeatedFrac: null,
    patienceAtOrderPlacedFrac: null,
    patienceAtFoodDeliveredFrac: null,
    eatingTargetMs: null,

    // What the kitchen said about the order when it landed: the PRD §8 satisfaction factors
    // `computeSatisfactionFactors` could not compute before a kitchen existed. Null until then.
    orderOutcome: null,

    // STORY-008. PRD §8 "unhappy customer" bottleneck. `everUnhappy` is sticky — once patience
    // has crossed `UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD` the party stays a candidate for
    // `recoveryActions` even if patience recovers between phases; `complaintHandled` is the
    // owner's one recovery per party. `unhappy`, the live public signal, is derived as
    // `everUnhappy && !complaintHandled` wherever it is read, rather than stored a second time.
    everUnhappy: false,
    complaintHandled: false,
  };

  state.parties.set(customerId, party);
  state.counts.spawned += 1;
  state.spawnLog.push({ customerId, segmentId, partySize, spawnedAtMs: match.elapsedMs });
  return party;
}

/** Poisson arrivals: draw an exponential inter-arrival gap from the effective rate, carrying any
 * overshoot forward exactly as the phase clock carries its own overshoot (Decision 14) — so the
 * arrival sequence does not drift and stays reproducible under any dtMs. */
function tickArrivals(match, state, dtMs) {
  const market = match.market;
  if (!market) return;

  const effects = getEventEffects(match);
  const ratePerMs = (market.baseFootTrafficPerMinute * (effects.footTrafficMultiplier ?? 1)) / 60_000;
  if (ratePerMs <= 0) return;

  if (state.msUntilNextArrival === null) {
    state.msUntilNextArrival = -Math.log(1 - state.rng()) / ratePerMs;
  }

  state.msUntilNextArrival -= dtMs;
  let guard = 0;
  while (state.msUntilNextArrival <= 0 && guard < CUSTOMER_MAX_SPAWNS_PER_TICK) {
    spawnParty(match, state, effects);
    state.msUntilNextArrival += -Math.log(1 - state.rng()) / ratePerMs;
    guard += 1;
  }
}

// ============================================================================================
// THE RESTAURANT CHOICE MODEL — PRD §6 "Restaurant choice model", §17 steps 3-6
// ============================================================================================
//
// A party that has finished EVALUATE_RESTAURANTS scores EVERY restaurant in the district from
// PUBLIC, OBSERVABLE properties only — the things §6's "Important design rule" says customers
// must keep reacting to — weights them with the party's OWN hidden §6 profile weights, and then
// picks probabilistically.
//
// The five observables, and where each is read from:
//
//   menuFit     the locked menu's dishes' tags against the party's preferred/disliked tags.
//               A menu board is public; the party's tag list is not.
//   price       the price the PLAYER set for each dish, on the market-scaled value axis
//               `priceGuidance()` uses in setup-rules.js, times whether the party can afford it.
//   wait        PROJECTED WAIT: the live queue at that restaurant, whether a table that fits
//               this party is free, and how deep the kitchen's busiest station queue is — the
//               last read through `match.kitchen.queueDepth()`, the same number the snapshot's
//               orders derive, never from the order system's internals.
//   reputation  the restaurant's visible reputation, normalised across its capped band.
//   event       what the active event does to the demand for the tags on this menu, read with
//               the event system's own `dishDemandMultiplier`.
//
// WHY A SOFTMAX AND NOT AN ARGMAX. PRD §23 names early snowballing as a top risk and §6 states
// the rule directly: "A player should not lose simply because the opponent had a better starting
// menu." An argmax over these scores gives the whole district to whoever is 0.01 ahead, forever.
// `p_i ∝ exp(u_i / DISTRICT_CHOICE_TEMPERATURE)` gives a modestly better restaurant a
// proportionally higher share and never all of it, and the temperature is the single dial that
// says how much better "better" has to be. It is measured, not asserted — see
// scripts/check-district-choice.mjs.
//
// LEAVING IS AN OPTION IN THE SAME DRAW, not a separate coin flip: `DISTRICT_LEAVE_UTILITY` is
// the utility of the street, so a district of bad restaurants loses parties to it in proportion
// to how bad they are (PRD §24: a badly priced menu "should reduce customer conversion, but
// should not make the restaurant completely empty" — an exponential is never zero).
//
// A restaurant whose projected wait exceeds the party's own patience budget is not a candidate
// at all: that is §8's `restaurant_full`, and it is how "capacity failures can send customers to
// the competitor" (§4.2) actually happens.

/** Parties queueing at one restaurant right now. §6's "Actual queue length", live. */
function queueLengthFor(state, restaurantId) {
  let queued = 0;
  for (const party of state.parties.values()) {
    if (party.state === CUSTOMER_STATES.APPROACH_OR_QUEUE && party.restaurantId === restaurantId) {
      queued += 1;
    }
  }
  return queued;
}

/** STORY-006's seam, read exactly as defensively as order-system.js reads it: until an inventory
 * model publishes `match.dishAvailability`, every dish on a locked menu is available. §6 lists
 * "Dish availability" among the things customers must keep reacting to, and honouring it here
 * costs one lookup. */
function isDishAvailable(match, restaurantId, dishId) {
  const perRestaurant = match.dishAvailability?.[restaurantId];
  if (!perRestaurant) return true;
  return perRestaurant[dishId] !== false;
}

/**
 * The priced menu STORY-009's setup submission holds, read from where that story stores it.
 * Memoized per restaurant on the identity of the `setup` object: `setup-system.js` locks it at
 * the setup -> service transition and nothing mutates it afterwards (PRD §7 — menus change only
 * during setup), so this rebuilds only if a check script swaps a whole submission in.
 */
function menuOf(match, view) {
  const setup = match.players.get(view.playerId)?.setup ?? null;
  if (view._menuSource !== setup) {
    view._menuSource = setup;
    const entries = [];
    const add = (slot, isAddon) => {
      const dish = catalogue.dishesById[slot.dishId];
      if (dish) entries.push({ dish, price: slot.price, isAddon });
    };
    for (const slot of setup?.menu ?? []) add(slot, false);
    for (const slot of setup?.addons ?? []) add(slot, true);
    view._menu = entries;
  }
  return view._menu;
}

function availableMenu(match, view) {
  return menuOf(match, view).filter((entry) => isDishAvailable(match, view.restaurantId, entry.dish.id));
}

function countTagMatches(tags, list) {
  if (!tags || !list || list.length === 0) return 0;
  let n = 0;
  for (const tag of tags) if (list.includes(tag)) n += 1;
  return n;
}

/** How one dish reads to one party: neutral 0.5, up per preferred tag, down per disliked one. */
function dishFit(dish, party) {
  const liked = countTagMatches(dish.tags, party.preferredTags);
  const disliked = countTagMatches(dish.tags, party.dislikedTags);
  return clamp(0.5 + DISTRICT_MENU_FIT_TAG_STEP * (liked - disliked), 0, 1);
}

/**
 * Perceived value of one dish at the price the player set: the market-scaled deviation from the
 * dish's suggested price (so `uptown_pre_theater`'s tolerant crowd punishes a mark-up less than
 * `downtown_lunch`'s), multiplied by whether this party can actually afford it out of its own
 * hidden per-guest budget.
 */
function dishValue(dish, price, party, market) {
  const deviation = (price / dish.suggestedPrice - 1) * (market?.priceSensitivity ?? 1);
  // Neutral sits BELOW 1 so that undercutting the suggested price still buys something. With
  // neutral at 1 the axis saturates and a discount is invisible — see the constant's comment.
  const value = clamp(DISTRICT_PRICE_NEUTRAL_VALUE - deviation * DISTRICT_PRICE_VALUE_SLOPE, 0, 1);
  const affordability = price <= party.budget ? 1 : clamp(party.budget / price, 0, 1);
  return value * affordability;
}

/**
 * How wanted this menu is under the district's current conditions, on the same [0,1] axis as
 * everything else: 0.5 when no event touches it (so with no event active the term is a constant
 * and cannot bias the choice), up towards 1 as an event amplifies the tags on the menu, down
 * towards 0 as one suppresses them. The multiplier itself comes from the event system's own
 * `dishDemandMultiplier`, so the §16 vocabulary is read through its owner.
 */
function eventAffinityFor(menu, effects) {
  if (menu.length === 0) return 0.5;
  // The STRONGEST AMPLIFIER, falling back to the strongest dampener only when nothing on the
  // menu is amplified at all — the same reasoning as menu fit's max: a party needs one dish the
  // district currently wants, and holding an out-of-favour dish beside a wanted one does not
  // make the restaurant less attractive. (Ranking by raw distance from 1 would let a 0.6 dish
  // outweigh a 1.35 one. Unreachable with today's catalogue, where every
  // `dishTagDemandMultipliers` value is >= 1 — which is exactly why it is written down here
  // rather than left to be discovered by the first event that dampens demand.)
  let strongestAmplifier = 1;
  let strongestDampener = 1;
  for (const entry of menu) {
    const m = dishDemandMultiplier(effects, entry.dish.tags);
    if (m > strongestAmplifier) strongestAmplifier = m;
    if (m < strongestDampener) strongestDampener = m;
  }
  const strongest = strongestAmplifier > 1 ? strongestAmplifier : strongestDampener;
  const span = Math.max(0.01, EVENT_DEMAND_SHIFT_BAND.max - 1);
  return clamp(0.5 + (strongest - 1) / (2 * span), 0, 1);
}

/** The deepest station queue at one restaurant, through the kitchen's own facade. Zero when no
 * kitchen is registered — this system never guesses at a backlog it cannot observe. */
function kitchenBacklogFor(match, restaurantId) {
  const kitchen = match.kitchen;
  if (typeof kitchen?.queueDepth !== 'function') return 0;
  let deepest = 0;
  for (const station of STATIONS) {
    const depth = kitchen.queueDepth(restaurantId, station);
    if (depth > deepest) deepest = depth;
  }
  return deepest;
}

/**
 * What a party standing in the street would estimate its wait to be: how long before a table
 * that fits it frees up, plus how long the visible kitchen backlog will hold up its food.
 * Public information only — queue length, table occupancy, station queue depth.
 */
function projectedWaitMs(match, state, view, partySize) {
  // Only tables big enough for THIS party count — a four-top waiting on the three tables that
  // seat four waits longer than a solo diner does in the same dining room.
  let fittingTables = 0;
  let freeFittingTables = 0;
  for (const table of view.tables.values()) {
    if (table.seats < partySize) continue;
    fittingTables += 1;
    if (!table.occupiedBy) freeFittingTables += 1;
  }
  const queued = queueLengthFor(state, view.restaurantId);
  const seatWaitMs =
    freeFittingTables > 0
      ? 0
      : Math.ceil((queued + 1) / Math.max(1, fittingTables)) * DISTRICT_TABLE_TURN_MS;
  const kitchenWaitMs = kitchenBacklogFor(match, view.restaurantId) * DISTRICT_BACKLOG_WAIT_PER_TICKET_MS;
  return seatWaitMs + kitchenWaitMs;
}

/** The five scored components, and the §17 reason each one justifies when it is the margin. */
const REASON_BY_COMPONENT = Object.freeze({
  price: 'better_price',
  menuFit: 'better_menu_fit',
  wait: 'shorter_projected_wait',
  reputation: 'higher_reputation',
  eventAffinity: 'event_affinity',
});
const COMPONENT_KEYS = Object.freeze(Object.keys(REASON_BY_COMPONENT));

/**
 * Score one restaurant for one party. Returns the raw components, the WEIGHTED contribution of
 * each (which is what a decision reason is argued from — a component nobody weights cannot be
 * the reason anybody chose anything), the total utility in [0,1], and whether the projected wait
 * put this restaurant outside the party's tolerance entirely.
 */
function scoreRestaurant(match, state, view, party, effects) {
  const menu = availableMenu(match, view);
  const mains = menu.filter((entry) => !entry.isAddon);
  const priced = mains.length > 0 ? mains : menu;

  const components = {
    // A party needs ONE dish it wants, not an average of the whole board: adding a dish must
    // never lower a restaurant's fit. Same reasoning as Decision 22's "strongest matching tag".
    menuFit: menu.length === 0 ? 0 : Math.max(...menu.map((entry) => dishFit(entry.dish, party))),
    price:
      priced.length === 0
        ? 0
        : Math.max(...priced.map((entry) => dishValue(entry.dish, entry.price, party, match.market))),
    wait: 0,
    reputation: clamp(
      (view.reputation - DISTRICT_REPUTATION_MIN) / (DISTRICT_REPUTATION_MAX - DISTRICT_REPUTATION_MIN),
      0,
      1,
    ),
    eventAffinity: eventAffinityFor(menu, effects),
  };

  const waitMs = projectedWaitMs(match, state, view, party.partySize);
  const tolerableMs = party.patienceSeconds * 1000 * DISTRICT_WAIT_INTOLERABLE_MULTIPLE;
  components.wait = clamp(1 - waitMs / Math.max(1, tolerableMs), 0, 1);

  // The party's own §6 weights (they sum to 1), plus event affinity as a district term the
  // profile does not carry. Renormalised so utility stays on [0,1] whatever the mix.
  const weights = {
    menuFit: party.menuFitWeight,
    price: party.priceWeight,
    wait: party.serviceSpeedWeight,
    reputation: party.reputationWeight,
    eventAffinity: DISTRICT_EVENT_AFFINITY_WEIGHT,
  };
  const weightTotal = COMPONENT_KEYS.reduce((sum, key) => sum + weights[key], 0) || 1;

  const contributions = {};
  let utility = 0;
  for (const key of COMPONENT_KEYS) {
    contributions[key] = (weights[key] * components[key]) / weightTotal;
    utility += contributions[key];
  }

  return {
    restaurantId: view.restaurantId,
    view,
    components,
    contributions,
    utility,
    projectedWaitMs: waitMs,
    /** §8 `restaurant_full`: the wait this party can see is longer than it is willing to wait. */
    overCapacity: waitMs > tolerableMs,
  };
}

/**
 * PRD §17 step 6. The reason is the component whose WEIGHTED contribution beat the best rival's
 * by the most — weighted, because a party that does not care about price was not won on price.
 * Below `DISTRICT_REASON_EPSILON` the two restaurants were effectively tied and the honest
 * answer is null: roughly half of a symmetric 1v1's picks are coin flips, and labelling those
 * `better_price` would fabricate exactly the data STORY-014's results screen is built on.
 */
function reasonFromContributions(chosen, rival) {
  let bestReason = null;
  let bestDiff = 0;
  for (const key of COMPONENT_KEYS) {
    const diff = chosen.contributions[key] - rival.contributions[key];
    if (diff > bestDiff) {
      bestDiff = diff;
      bestReason = REASON_BY_COMPONENT[key];
    }
  }
  return bestDiff >= DISTRICT_REASON_EPSILON ? bestReason : null;
}

/** `p_i ∝ exp(u_i / T)`, drawn from the district's own RNG sub-stream. The max is subtracted
 * before exponentiating purely for numerical stability; it cancels out of the ratios. */
function softmaxPick(options, rng) {
  const maxUtility = Math.max(...options.map((o) => o.utility));
  const weights = options.map((o) => Math.exp((o.utility - maxUtility) / DISTRICT_CHOICE_TEMPERATURE));
  const total = weights.reduce((sum, w) => sum + w, 0) || 1;
  let r = rng() * total;
  for (let i = 0; i < options.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return options[i];
  }
  return options[options.length - 1];
}

function bump(map, key) {
  if (!key) return;
  map[key] = (map[key] ?? 0) + 1;
}

/**
 * PRD §17 step 6, "Record decision reason for analytics and post-match explanation". One record
 * per party per decision on `state.decisions`, plus the per-restaurant funnel counters STORY-014
 * reads: the restaurant that won the party, and — for every restaurant that did not — a
 * CHOOSE_RIVAL against its own funnel with the reason it lost by.
 */
function recordDecision(match, state, party, scored, chosen, reason) {
  state.decisions.push({
    customerId: party.customerId,
    segmentId: party.segmentId,
    partySize: party.partySize,
    atMs: Math.round(match.elapsedMs),
    chosenRestaurantId: chosen?.restaurantId ?? null,
    reason,
    utilities: Object.fromEntries(scored.map((s) => [s.restaurantId, Number(s.utility.toFixed(4))])),
    projectedWaitMs: Object.fromEntries(scored.map((s) => [s.restaurantId, Math.round(s.projectedWaitMs)])),
  });

  for (const s of scored) {
    if (chosen && s.restaurantId === chosen.restaurantId) {
      s.view.counts.chosen += 1;
      bump(s.view.wonByReason, reason);
    } else if (chosen) {
      s.view.counts[CUSTOMER_STATES.CHOOSE_RIVAL] += 1;
      bump(s.view.lostByReason, reason);
    } else {
      s.view.counts[CUSTOMER_STATES.LEAVE_DISTRICT] += 1;
      bump(s.view.lostByReason, reason);
    }
  }
}

function sendToRestaurant(match, state, party, chosen, reason) {
  party.restaurantId = chosen.restaurantId;
  party.decisionReason = reason;
  const [qx, qy, qz] = state.queuePosition;
  party.position = { x: qx, y: qy, z: qz };
  transitionTo(match, party, CUSTOMER_STATES.APPROACH_OR_QUEUE);
}

/**
 * PRD §17 steps 3-6, for one party, over the whole district. The ONLY function that decides
 * where a party goes; everything above it produces the numbers it compares.
 */
function resolveEvaluateRestaurants(match, state, party) {
  const effects = getEventEffects(match);
  const scored = [...state.restaurants.values()].map((view) =>
    scoreRestaurant(match, state, view, party, effects),
  );

  // An empty district (no player has a restaurant yet) has nothing to choose between.
  if (scored.length === 0) {
    exitParty(match, state, party, CUSTOMER_STATES.LEAVE_DISTRICT, null);
    return;
  }

  const candidates = scored.filter((s) => !s.overCapacity);
  if (candidates.length === 0) {
    // Every restaurant's visible wait is longer than this party will tolerate. §8's
    // `restaurant_full`, and the one decision reason a one-restaurant district can still cite.
    recordDecision(match, state, party, scored, null, 'restaurant_full');
    exitParty(match, state, party, CUSTOMER_STATES.LEAVE_DISTRICT, 'restaurant_full');
    return;
  }

  const picked = softmaxPick(
    [
      ...candidates.map((s) => ({ kind: 'restaurant', utility: s.utility, scored: s })),
      { kind: 'leave', utility: DISTRICT_LEAVE_UTILITY, scored: null },
    ],
    state.districtRng,
  );

  if (picked.kind === 'leave') {
    // Nobody was full; this party just was not tempted by anything on offer. There is no §17
    // reason for that — inventing one would be a lie about a comparison that did not decide it.
    recordDecision(match, state, party, scored, null, null);
    exitParty(match, state, party, CUSTOMER_STATES.LEAVE_DISTRICT, null);
    return;
  }

  const chosen = picked.scored;
  const others = scored.filter((s) => s !== chosen);
  let reason = null;
  if (others.length > 0) {
    const bestOther = others.reduce((a, b) => (b.utility > a.utility ? b : a));
    // A rival that was not even a candidate lost this party to its own queue, whatever the
    // scores said.
    reason = bestOther.overCapacity ? 'restaurant_full' : reasonFromContributions(chosen, bestOther);
  }

  recordDecision(match, state, party, scored, chosen, reason);
  sendToRestaurant(match, state, party, chosen, reason);
}

// --- reputation, PRD §4.2 / §8 step 8 "Modifies restaurant score/reputation" -----------------

/**
 * One party's verdict, folded into the restaurant's running reputation as a moving average and
 * clamped into the §4.2 band. COMPOUNDING is the point — a restaurant that keeps guests happy
 * keeps rising, and that rising reputation keeps winning it parties — and so is the CAP: the
 * ceiling is what stops a good first minute from deciding the match, which is §23's "cap runaway
 * advantages" expressed as a number instead of a hope.
 */
function applyReview(view, satisfaction) {
  const moved = view.reputation + DISTRICT_REPUTATION_REVIEW_WEIGHT * (satisfaction - view.reputation);
  view.reputation = clamp(moved, DISTRICT_REPUTATION_MIN, DISTRICT_REPUTATION_MAX);
}

/** A party that gave up before it was served leaves no review, but the queue it walked out of
 * was visible to the street. Scored as a small fixed knock against the same band. */
function applyWalkout(view) {
  view.abandonedParties += 1;
  view.reputation = clamp(
    view.reputation - DISTRICT_REPUTATION_WALKOUT_PENALTY,
    DISTRICT_REPUTATION_MIN,
    DISTRICT_REPUTATION_MAX,
  );
}

// --- seating ----------------------------------------------------------------------------------

function bestFitTable(tables, partySize) {
  let best = null;
  for (const table of tables.values()) {
    if (table.occupiedBy) continue;
    // STORY-007: a dirty table is not a free table. This is what makes the server's rule-4
    // clearing job matter — an uncleared floor is lost seats, not cosmetic.
    if (table.dirty) continue;
    if (table.seats < partySize) continue;
    if (!best || table.seats < best.seats) best = table;
  }
  return best;
}

function patienceFraction(party) {
  return clamp(party.patienceMsRemaining / (party.patienceSeconds * 1000), 0, 1);
}

/** Seats the party at ITS OWN restaurant's floor. Choice-agnostic: this looks only at the
 * tables of whichever restaurant the party already chose. */
function tryToSeat(match, state, party) {
  const view = viewOf(state, party);
  if (!view) return;
  const table = bestFitTable(view.tables, party.partySize);
  if (!table) return;

  table.occupiedBy = party.customerId;
  party.tableId = table.id;
  party.position = { x: table.position[0], y: table.position[1], z: table.position[2] };
  party.patienceAtSeatedFrac = patienceFraction(party);
  transitionTo(match, party, CUSTOMER_STATES.SEATED);
}

/**
 * Release the table a party was sitting at. `soil` is true wherever the party actually SAT and
 * ate off it; a party that never got a table has nothing to release, and one whose order was
 * cancelled still leaves a table that needs wiping.
 */
function freeTable(match, state, party, soil = true) {
  if (!party.tableId) return;
  const table = viewOf(state, party)?.tables.get(party.tableId);
  if (table) {
    table.occupiedBy = null;
    if (soil && match.brigade?.ownsTableClearing(party.restaurantId)) {
      table.dirty = true;
      table.soilCount += 1;
    }
  }
  party.tableId = null;
}

// --- satisfaction, PRD §8's factor list -------------------------------------------------------

/**
 * Every §8 factor is a named key here, even the ones this story cannot compute yet, so a later
 * story widens an existing term instead of restructuring the formula:
 *
 *   - waitToBeSeated, waitToOrder, waitForFood, visitDurationVsPatience: REAL, computed from
 *     this story's own patience/clock bookkeeping.
 *   - dishQuality, dishPreferenceMatch, orderAccuracy, priceFairness: REAL as of STORY-005 —
 *     scored by the kitchen when the order is delivered and carried on `party.orderOutcome`.
 *   - tableCleanliness: a restaurant-state story (dirty tables are tracked).
 *   - eventRelevance: STORY-011 (a real active event to be relevant to).
 *   - recoveryActions: STORY-008 (the owner can act on a table).
 *
 * A factor this story cannot compute returns `null`, and `combineSatisfaction` renormalizes over
 * only the non-null factors — so today's score is 100% real inputs, not a real signal diluted by
 * fixed neutral placeholders, and it does not need re-tuning as each null becomes real.
 */
function computeSatisfactionFactors(match, party) {
  const share = CUSTOMER_WAIT_TOLERANCE_SHARE;
  const patienceMs = party.patienceSeconds * 1000;

  const waitToBeSeated = party.patienceAtSeatedFrac ?? patienceFraction(party);

  // Each later wait factor is the incremental cost of THAT phase (a delta against its own
  // tolerance share) scaled by how much patience was left going in. The scaling is not
  // decorative: without it, a party that arrived at a phase with patience ALREADY at zero and
  // then spent zero further ms in it (patience clamps at 0, it cannot go negative) produces a
  // delta of exactly 0 — "no further decay" — which the raw clamp reads as a PERFECT score, the
  // same value it gives a party who breezed through with patience to spare. Multiplying by the
  // prior fraction forces that case toward 0, since there was no patience budget left to judge
  // the phase against.
  const waitToOrder =
    party.patienceAtOrderPlacedFrac !== null && party.patienceAtSeatedFrac !== null
      ? clamp(1 - (party.patienceAtSeatedFrac - party.patienceAtOrderPlacedFrac) / share.ordering, 0, 1) *
        party.patienceAtSeatedFrac
      : null;

  const waitForFood =
    party.patienceAtFoodDeliveredFrac !== null && party.patienceAtOrderPlacedFrac !== null
      ? clamp(1 - (party.patienceAtOrderPlacedFrac - party.patienceAtFoodDeliveredFrac) / share.food, 0, 1) *
        party.patienceAtOrderPlacedFrac
      : null;

  const visitDurationMs = match.elapsedMs - party.spawnedAtMs;
  const visitDurationVsPatience = clamp(
    1 - visitDurationMs / (patienceMs * CUSTOMER_VISIT_DURATION_TOLERANCE_MULTIPLIER),
    0,
    1,
  );

  // STORY-005: the kitchen scores the order it delivered and hands back these four factors,
  // so they stop being null the moment an order actually reaches a table. A party that never
  // received food has no `orderOutcome`, and they correctly stay null for it.
  const outcome = party.orderOutcome;

  return {
    waitToBeSeated,
    waitToOrder,
    waitForFood,
    dishQuality: outcome?.dishQuality ?? null,
    dishPreferenceMatch: outcome?.dishPreferenceMatch ?? null,
    priceFairness: outcome?.priceFairness ?? null,
    orderAccuracy: outcome?.orderAccuracy ?? null,
    tableCleanliness: null,
    eventRelevance: null,
    // STORY-008. Null (not scored either way) for a party that never crossed
    // `UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD` — most parties, most of the time, and the whole
    // reason this factor renormalizes over non-null values rather than defaulting to a neutral
    // score. Once a party DID cross it, this is the one factor that rewards the owner
    // specifically for noticing and acting: 1 if `handle_complaint` reached them, 0 if it never
    // did — nothing between, because PRD §8 pairs this bottleneck with a discrete
    // "apologize/comp" action, not a partial-credit one.
    recoveryActions: party.everUnhappy ? (party.complaintHandled ? 1 : 0) : null,
    visitDurationVsPatience,
  };
}

function combineSatisfaction(factors) {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const [key, weight] of Object.entries(CUSTOMER_SATISFACTION_WEIGHTS)) {
    const value = factors[key];
    if (value === null || value === undefined) continue;
    weightedSum += weight * value;
    weightTotal += weight;
  }
  if (weightTotal === 0) return 100;
  return Math.round(clamp(weightedSum / weightTotal, 0, 1) * 100);
}

// --- state transitions -------------------------------------------------------------------------

function transitionTo(match, party, nextState) {
  party.state = nextState;
  party.stateEnteredAtMs = match.elapsedMs;
}

function exitParty(match, state, party, exitState, decisionReason) {
  const view = viewOf(state, party);
  freeTable(match, state, party);
  party.state = exitState;
  party.stateEnteredAtMs = match.elapsedMs;
  party.exitAtMs = match.elapsedMs;
  if (decisionReason !== undefined) party.decisionReason = decisionReason;
  state.counts[exitState] += 1;
  // The same outcome against the funnel of the restaurant it happened AT, if it had chosen one.
  // LEAVE_DISTRICT before a choice is booked by recordDecision instead, against every restaurant
  // that failed to attract the party.
  if (view && exitState !== CUSTOMER_STATES.LEAVE_DISTRICT) {
    view.counts[exitState] += 1;
    // PRD §8 step 8 and §4.2: a party that walked out of a queue, cancelled, or stormed off is
    // reputation the restaurant just lost. A party that ate and reviewed is handled where its
    // satisfaction is known (advanceParty's LEAVING case).
    if (exitState === CUSTOMER_STATES.ABANDON_QUEUE || exitState === CUSTOMER_STATES.CANCEL_ORDER) {
      applyWalkout(view);
    } else if (exitState === CUSTOMER_STATES.LEAVE_ANGRY) {
      applyReview(view, party.satisfaction);
    }
  }
  const [ex, ey, ez] = state.entryPosition;
  party.position = { x: ex, y: ey, z: ez };
}

function finishEating(match, state, party) {
  const factors = computeSatisfactionFactors(match, party);
  party.satisfaction = combineSatisfaction(factors);

  if (party.satisfaction < CUSTOMER_ANGRY_SATISFACTION_THRESHOLD) {
    // Stormed out with the plates on the table. No money moves; the kitchen records the
    // forgone revenue for PRD §11's penalty side.
    match.kitchen?.abandonOrder(party.orderId, 'left_angry');
    exitParty(match, state, party, CUSTOMER_STATES.LEAVE_ANGRY);
  } else {
    // PRD §17 step 7, "Eats and pays". Revenue moves HERE and only here, computed server-side
    // by the kitchen at the price the player set in setup (Decision 2).
    match.kitchen?.settleOrder(party.orderId);
    transitionTo(match, party, CUSTOMER_STATES.PAYING);
  }
}

/**
 * The explicit field list this system hands the kitchen when a party orders. Deliberately not
 * the internal party object: everything the kitchen needs to weight a dish and score a wait is
 * named here, and nothing else crosses. It carries hidden §6 profile values — that is fine and
 * intended, both systems are server-side — but it means adding a field to a party never
 * silently widens what the kitchen sees.
 */
function orderRequest(party) {
  return {
    customerId: party.customerId,
    restaurantId: party.restaurantId,
    tableId: party.tableId,
    segmentId: party.segmentId,
    partySize: party.partySize,
    preferredTags: party.preferredTags,
    dislikedTags: party.dislikedTags,
    budget: party.budget,
    patienceMs: party.patienceSeconds * 1000,
  };
}

function advanceParty(match, state, party, dtMs) {
  if (PATIENCE_DECAYING_STATES.has(party.state)) {
    // STORY-012. "Seated patience" names the states that follow being seated, not the queue —
    // Better Seating is about giving the SERVER room to recover once a party is already at a
    // table, not about making the initial wait for a table feel shorter.
    const seatedPatienceMultiplier =
      party.state !== CUSTOMER_STATES.APPROACH_OR_QUEUE
        ? (match.upgradeEffects?.[party.restaurantId]?.seatedPatienceMultiplier ?? 1)
        : 1;
    party.patienceMsRemaining = Math.max(0, party.patienceMsRemaining - dtMs / seatedPatienceMultiplier);
    // STORY-008. Sticky, not a live threshold check on every read: a party that crossed into
    // "unhappy" and was never helped stays a `recoveryActions` candidate even if it recovers
    // patience crossing into its next phase (`patienceAtSeatedFrac` etc. resample per phase).
    if (patienceFraction(party) <= UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD) party.everUnhappy = true;
  }

  const msInState = match.elapsedMs - party.stateEnteredAtMs;

  switch (party.state) {
    case CUSTOMER_STATES.ENTER_DISTRICT:
      if (msInState >= CUSTOMER_ENTER_DISTRICT_MS) {
        transitionTo(match, party, CUSTOMER_STATES.EVALUATE_RESTAURANTS);
      }
      break;

    case CUSTOMER_STATES.EVALUATE_RESTAURANTS:
      if (msInState >= CUSTOMER_EVALUATE_RESTAURANTS_MS) {
        resolveEvaluateRestaurants(match, state, party);
      }
      break;

    case CUSTOMER_STATES.APPROACH_OR_QUEUE:
      if (party.patienceMsRemaining <= 0) {
        exitParty(match, state, party, CUSTOMER_STATES.ABANDON_QUEUE, 'customer_abandoned_queue');
        break;
      }
      // STORY-007. PRD §17 server rule 2 is "seat waiting party if table is available", and
      // `restaurant-layout.json` gives `server_1` the `host_stand` post — §7's "abstract host
      // behavior" means there is no HOST WORKER, not that nobody walks a party to a table. Where
      // a server exists, seating is that server's job and happens through `floor.seatParty()`.
      // With no worker system registered the automatic seating this system shipped with runs
      // unchanged.
      if (!match.brigade?.ownsSeating(party.restaurantId)) tryToSeat(match, state, party);
      break;

    case CUSTOMER_STATES.SEATED:
      if (party.patienceMsRemaining <= 0) {
        exitParty(match, state, party, CUSTOMER_STATES.CANCEL_ORDER);
        break;
      }
      // STORY-007. `CUSTOMER_SEATED_GREET_MS` was the abstracted greeting. Where a server
      // exists, the greeting IS that server arriving at the table (§17 server rule 3, "take
      // order from newly seated party"), and the party sits with its menu until it does.
      if (match.brigade?.ownsOrderTaking(party.restaurantId)) break;
      if (msInState >= CUSTOMER_SEATED_GREET_MS) transitionTo(match, party, CUSTOMER_STATES.ORDERING);
      break;

    case CUSTOMER_STATES.ORDERING:
      if (party.patienceMsRemaining <= 0) {
        exitParty(match, state, party, CUSTOMER_STATES.CANCEL_ORDER);
        break;
      }
      if (msInState >= CUSTOMER_ORDERING_MS) {
        // No kitchen registered: nothing is invented here. The party keeps holding its menu
        // and the patience check above is what eventually resolves it.
        if (!match.kitchen) break;
        const placed = match.kitchen.placeOrder(orderRequest(party));
        if (!placed.ok) {
          // Nothing on the menu can be served (STORY-006's shortage case). PRD §8 CANCEL_ORDER.
          exitParty(match, state, party, CUSTOMER_STATES.CANCEL_ORDER);
          break;
        }
        party.orderId = placed.orderId;
        party.patienceAtOrderPlacedFrac = patienceFraction(party);
        transitionTo(match, party, CUSTOMER_STATES.WAITING_FOR_FOOD);
      }
      break;

    case CUSTOMER_STATES.WAITING_FOR_FOOD: {
      if (party.patienceMsRemaining <= 0) {
        match.kitchen?.cancelOrder(party.orderId, 'customer_patience_expired');
        exitParty(match, state, party, CUSTOMER_STATES.CANCEL_ORDER);
        break;
      }
      // THE REAL KITCHEN WAIT. How long this takes is the sum of the dish's `stationSteps`
      // durations plus however long its tickets spent queueing behind other tickets — it is
      // not a number this system knows, guesses, or draws.
      const delivery = match.kitchen?.pollDelivery(party.orderId) ?? null;
      if (delivery?.cancelled) {
        exitParty(match, state, party, CUSTOMER_STATES.CANCEL_ORDER);
        break;
      }
      if (delivery?.delivered) {
        party.orderOutcome = delivery.satisfaction;
        party.patienceAtFoodDeliveredFrac = patienceFraction(party);
        party.eatingTargetMs = randomInRange(state.rng, CUSTOMER_EATING_MS_RANGE);
        transitionTo(match, party, CUSTOMER_STATES.EATING);
      }
      break;
    }

    case CUSTOMER_STATES.EATING:
      if (msInState >= party.eatingTargetMs) finishEating(match, state, party);
      break;

    case CUSTOMER_STATES.PAYING:
      // STORY-007. §17 server rule 5, "handle payment". Where a server exists the party holds its
      // table until somebody comes to take the money — which is the pressure that makes rule 5
      // worth having a rule for. `floor.collectPayment()` runs the same three lines.
      if (match.brigade?.ownsPayment(party.restaurantId)) break;
      if (msInState >= CUSTOMER_PAYING_MS) {
        freeTable(match, state, party);
        const [ex, ey, ez] = state.entryPosition;
        party.position = { x: ex, y: ey, z: ez };
        transitionTo(match, party, CUSTOMER_STATES.LEAVING);
      }
      break;

    case CUSTOMER_STATES.LEAVING:
      if (msInState >= CUSTOMER_LEAVING_MS) {
        // Decision 13: REVIEW/REPUTATION_IMPACT resolves in this one step — and STORY-010 is
        // what makes the second half of that name real. The party's satisfaction moves its
        // restaurant's reputation here, and nowhere else on the happy path.
        party.state = CUSTOMER_STATES.REVIEW;
        party.stateEnteredAtMs = match.elapsedMs;
        party.exitAtMs = match.elapsedMs;
        state.counts[CUSTOMER_STATES.REVIEW] += 1;
        const reviewed = viewOf(state, party);
        if (reviewed) {
          reviewed.counts[CUSTOMER_STATES.REVIEW] += 1;
          reviewed.guestsServed += 1;
          reviewed.satisfactionSum += party.satisfaction;
          applyReview(reviewed, party.satisfaction);
        }
      }
      break;

    default:
      // REVIEW or one of the five exit states: terminal, nothing left to advance. Cleanup
      // (removal after CUSTOMER_EXIT_LINGER_MS) happens in the caller.
      break;
  }
}

function cleanupExitedParties(match, state) {
  for (const [id, party] of state.parties) {
    const terminal = party.state === CUSTOMER_STATES.REVIEW || isExitState(party.state);
    if (terminal && party.exitAtMs !== undefined && match.elapsedMs - party.exitAtMs >= CUSTOMER_EXIT_LINGER_MS) {
      state.parties.delete(id);
    }
  }
}

// --- the public projection — the ONLY function allowed to shape match.customers -------------

/**
 * PRD §6: the hidden profile must never cross the wire. This is an explicit field ALLOWLIST, not
 * a spread of the internal party object, specifically so a field added to that object later
 * (hidden or not) cannot leak by omission of a `delete`. Compare against CustomerSnapshot in
 * shared/schemas/game-state.d.ts, which this must keep matching field-for-field.
 */
function toPublicCustomerSnapshot(party) {
  return {
    customerId: party.customerId,
    segmentId: party.segmentId,
    partySize: party.partySize,
    state: party.state,
    restaurantId: party.restaurantId,
    position: { x: party.position.x, y: party.position.y, z: party.position.z },
    patienceRemaining: patienceFraction(party),
    satisfaction: party.satisfaction,
    tableId: party.tableId,
    orderId: party.orderId,
    decisionReason: party.decisionReason,
    // STORY-008. Live, not sticky: `everUnhappy` is the sticky scoring flag `recoveryActions`
    // reads; this is what the client shows a "handle complaint" prompt against, and it clears
    // the instant the owner reaches them.
    unhappy: party.everUnhappy && !party.complaintHandled,
  };
}

/**
 * The other half of the privacy boundary, and the reason it is safe for both players to receive
 * this array identically: everything here is genuinely public. Most of it is what the choice
 * model itself scores — reputation, queue length, capacity, projected wait. `guestsServed`,
 * `averageSatisfaction` and `abandonedParties` are NOT model inputs: they are the §4.4 district
 * overview's service record, which §5's results phase compares anyway and which a player cannot
 * read about their own restaurant from anywhere else. They are published deliberately, and
 * named here so that nothing mistakes them for observables the model reads. The menu and its
 * prices are NOT here — they are the rival's
 * private setup submission (PRD §18, Decision 16, `you.setup`), read by the model server-side
 * and never republished — and neither are cash, inventory, the ledger or anything else a later
 * story owns. Like `toPublicCustomerSnapshot`, an explicit allowlist rather than a spread, so a
 * field added to the internal restaurant view cannot leak by omission.
 *
 * A subset of `RestaurantSnapshot` (shared/schemas/game-state.d.ts), whose remaining fields that
 * declaration now marks optional with the story that fills each one in.
 */
function toPublicRestaurantSnapshot(match, state, view) {
  return {
    restaurantId: view.restaurantId,
    playerId: view.playerId,
    reputation: Number(view.reputation.toFixed(2)),
    queueLength: queueLengthFor(state, view.restaurantId),
    seatsTotal: view.totalSeats,
    seatsAvailable: [...view.tables.values()].reduce(
      (sum, table) => sum + (table.occupiedBy ? 0 : table.seats),
      0,
    ),
    /** What the model projected for a party of 2 — the district's readable "how long is the
     * wait here" signal, not a per-party number. */
    projectedWaitMs: Math.round(projectedWaitMs(match, state, view, 2)),
    guestsServed: view.guestsServed,
    averageSatisfaction:
      view.guestsServed > 0 ? Math.round(view.satisfactionSum / view.guestsServed) : 0,
    abandonedParties: view.abandonedParties,
    tables: [...view.tables.values()].map((table) => ({
      id: table.id,
      seats: table.seats,
      occupiedBy: table.occupiedBy,
      // STORY-007: real, and the reason the server's rule-4 clearing job exists. Still always
      // false in a match with no worker system registered — see `buildTables`.
      dirty: table.dirty === true,
    })),
  };
}

/** A per-restaurant summary of §17 decision reasons, published at `results` for STORY-014. */
function districtSummary(state) {
  return [...state.restaurants.values()].map((view) => ({
    restaurantId: view.restaurantId,
    reputation: Number(view.reputation.toFixed(2)),
    guestsServed: view.guestsServed,
    averageSatisfaction: view.guestsServed > 0 ? Math.round(view.satisfactionSum / view.guestsServed) : 0,
    abandonedParties: view.abandonedParties,
    counts: { ...view.counts },
    wonByReason: { ...view.wonByReason },
    lostByReason: { ...view.lostByReason },
  }));
}

// --- the system --------------------------------------------------------------------------------

export const customerSystem = {
  id: 'customers',
  phases: ['service', 'final_rush'],

  update(match, dtMs) {
    const state = ensureState(match);
    // A seat that filled after service began (a dev match, a late join) still gets a restaurant.
    for (const playerId of match.players.keys()) {
      if (!state.restaurants.has(playerId)) state.restaurants.set(playerId, buildRestaurantView(playerId));
    }

    tickArrivals(match, state, dtMs);
    for (const party of state.parties.values()) advanceParty(match, state, party, dtMs);
    cleanupExitedParties(match, state);

    // match.js's toSnapshot() serializes whatever is here verbatim — see the top-of-file note.
    // Only ever assign the sanitized projection, never the internal `state.parties` values.
    match.customers = [...state.parties.values()].map(toPublicCustomerSnapshot);
    match.restaurants = [...state.restaurants.values()].map((view) =>
      toPublicRestaurantSnapshot(match, state, view),
    );
    // Server-side only: `toSnapshot()` carries neither key, and must not — this is the whole
    // decision log, and one restaurant's losses are the other's reasons. Both are republished
    // every tick rather than only at the `results` transition, because a match that ENDS on a
    // disconnect never transitions: `#endMatch` sets `phase = 'results'` directly, so
    // `advanceClock` returns no transition and `onPhaseChange` never fires. STORY-014 gets the
    // same record either way.
    match.districtDecisions = state.decisions;
    match.districtSummary = districtSummary(state);
  },

  onPhaseChange(match, transition) {
    if (transition.to !== 'results') return;
    if (!match._customerSimState) return; // never ticked — nothing to report or clear.

    const state = match._customerSimState;
    const { counts } = state;
    console.log(
      `[customers] ${match.id} seed=${match.seed} market=${match.market?.id ?? 'none'} ` +
        `district: ${counts.spawned} parties arrived, ${counts[CUSTOMER_STATES.REVIEW]} served, ` +
        `${counts[CUSTOMER_STATES.LEAVE_DISTRICT]} left without choosing ` +
        `(abandoned_queue=${counts[CUSTOMER_STATES.ABANDON_QUEUE]} cancelled_order=${counts[CUSTOMER_STATES.CANCEL_ORDER]} ` +
        `left_angry=${counts[CUSTOMER_STATES.LEAVE_ANGRY]})`,
    );
    for (const view of state.restaurants.values()) {
      const reasons = Object.entries(view.wonByReason).map(([r, n]) => `${r}=${n}`).join(' ') || 'none';
      console.log(
        `[district] ${match.id} ${view.restaurantId} chosen=${view.counts.chosen} ` +
          `lost_to_rival=${view.counts[CUSTOMER_STATES.CHOOSE_RIVAL]} served=${view.counts[CUSTOMER_STATES.REVIEW]} ` +
          `reputation=${view.reputation.toFixed(1)} avgSatisfaction=` +
          `${view.guestsServed > 0 ? Math.round(view.satisfactionSum / view.guestsServed) : 0} ` +
          `won_by: ${reasons}`,
      );
    }

    // PRD §17 step 6 is "post-match explanation", so the decision record must OUTLIVE the
    // simulation state that produced it. STORY-014 reads these two at `results`.
    match.districtDecisions = state.decisions;
    match.districtSummary = districtSummary(state);

    match.customers = [];
    match.restaurants = [];
    match.floor = undefined;
    match._customerSimState = undefined;
  },
};

/**
 * Exported for scripts/check-customer-lifecycle.mjs ONLY — not part of the system's public
 * contract, and no other system or route should import this. The repo has no test framework
 * (Milestone 0 Decision 8), so a runnable script is the only way to force specific branches
 * (every exit state, the satisfaction formula's edges) deterministically instead of hoping a
 * seeded run happens to produce them.
 */
export const _internal = {
  ensureState,
  getEventEffects,
  buildRestaurantView,
  viewOf,
  menuOf,
  availableMenu,
  dishFit,
  dishValue,
  eventAffinityFor,
  kitchenBacklogFor,
  projectedWaitMs,
  queueLengthFor,
  scoreRestaurant,
  reasonFromContributions,
  softmaxPick,
  applyReview,
  applyWalkout,
  toPublicRestaurantSnapshot,
  districtSummary,
  REASON_BY_COMPONENT,
  orderRequest,
  spawnParty,
  advanceParty,
  resolveEvaluateRestaurants,
  tryToSeat,
  computeSatisfactionFactors,
  combineSatisfaction,
  effectiveSegmentWeights,
  drawSegmentId,
  toPublicCustomerSnapshot,
  patienceFraction,
  buildTables,
  createFloorFacade,
  freeTable,
  bestFitTable,
};
