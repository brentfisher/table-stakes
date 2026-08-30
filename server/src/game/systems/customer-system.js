// The customer party state machine, PRD §8 "Customer state machine" / §17 "Customer acquisition
// system", implemented for a SINGLE restaurant. STORY-010 introduces the real shared-district,
// two-restaurant choice model; this story builds everything the choice model needs to plug into
// — spawning, the hidden per-party profile, the state machine, patience, and satisfaction — and
// leaves `resolveEvaluateRestaurants` below as the seam it replaces. See that function's comment.
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
// literal empty array. `events`/`restaurants`/`orders` are deliberately left untouched —
// STORY-005/009/011 are editing match.js and tuning.js in parallel worktrees, so this story
// only changes the one line it needs, and the sibling stories make the identical narrow change
// for their own field when they land, rather than colliding on lines none of them use yet.
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
  CUSTOMER_RIVAL_PLACEHOLDER_PROBABILITY,
  CUSTOMER_QUEUE_PRESSURE_LEAVE_THRESHOLD,
  CUSTOMER_QUEUE_PRESSURE_LEAVE_PROBABILITY,
  CUSTOMER_WAIT_TOLERANCE_SHARE,
  CUSTOMER_VISIT_DURATION_TOLERANCE_MULTIPLIER,
  CUSTOMER_SATISFACTION_WEIGHTS,
  CUSTOMER_ANGRY_SATISFACTION_THRESHOLD,
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

/** Event effects share the §16 vocabulary (design Decision 12). STORY-011 will set
 * `match.activeEventEffects` to the active event's `effects` object; until then every consumer
 * here reads this neutral default, exactly the "default 1.0" seam the story calls for. This
 * system never reaches into an event system — it only reads this one match-state field. */
const NEUTRAL_EVENT_EFFECTS = Object.freeze({
  footTrafficMultiplier: 1,
  partySizeMultiplier: 1,
  segmentWeightOverrides: Object.freeze({}),
});

function getEventEffects(match) {
  return match.activeEventEffects ?? NEUTRAL_EVENT_EFFECTS;
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
      });
    }
  }
  return tables;
}

function ensureState(match) {
  if (!match._customerSimState) {
    const tables = buildTables();
    const queueEntity = layout.entities.find((e) => e.type === 'queue');
    match._customerSimState = {
      rng: match.createRngStream(CUSTOMER_RNG_STREAM),
      parties: new Map(),
      nextId: 1,
      msUntilNextArrival: null,
      tables,
      totalSeats: [...tables.values()].reduce((sum, t) => sum + t.seats, 0),
      queuePosition: queueEntity?.position ?? layout.spawn.customerEntry,
      entryPosition: layout.spawn.customerEntry,
      // Every party that ever spawned this match, in spawn order — the reproducibility check's
      // evidence, and the balance figure's raw material.
      spawnLog: [],
      // Cumulative terminal outcomes, PRD §24's "40-90 parties per restaurant" figure. Read and
      // logged in onPhaseChange before the match clears this state.
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
  }
  return match._customerSimState;
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

function firstRestaurantId(match) {
  const [first] = match.players.keys();
  return first ?? null;
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

// --- the EVALUATE_RESTAURANTS seam (STORY-010 replaces this function) -----------------------

function queuePressure(state) {
  if (state.totalSeats <= 0) return 0;
  let queued = 0;
  for (const party of state.parties.values()) {
    if (party.state === CUSTOMER_STATES.APPROACH_OR_QUEUE) queued += 1;
  }
  return queued / state.totalSeats;
}

/**
 * PRD §6 "Restaurant choice model" / §17 steps 3-5, implemented against a SINGLE restaurant.
 * STORY-010 replaces this function's body with a real two-restaurant comparison scored from
 * public properties (menu fit, price, projected wait, reputation, capacity, event affinity) and
 * the party's own four weights. Until then:
 *
 *   - a flat probability (CUSTOMER_RIVAL_PLACEHOLDER_PROBABILITY) stands in for "a real rival
 *     existed and won", so CHOOSE_RIVAL is reachable and exercised with nothing to compare
 *     against yet;
 *   - queue pressure — the one signal that IS real even with one restaurant (§6 "Actual queue
 *     length") — drives LEAVE_DISTRICT;
 *   - everyone else approaches the one restaurant that exists.
 *
 * `decisionReason` is left null for the placeholder rival pick (there is no real comparison to
 * cite) and set to 'restaurant_full' when capacity pressure is the actual reason, so the
 * §17/STORY-014 explanation layer is not fabricating reasons that later widen.
 */
function resolveEvaluateRestaurants(match, state, party) {
  const r1 = state.rng();
  if (r1 < CUSTOMER_RIVAL_PLACEHOLDER_PROBABILITY) {
    exitParty(match, state, party, CUSTOMER_STATES.CHOOSE_RIVAL, null);
    return;
  }

  const pressure = queuePressure(state);
  if (pressure > CUSTOMER_QUEUE_PRESSURE_LEAVE_THRESHOLD) {
    const r2 = state.rng();
    if (r2 < CUSTOMER_QUEUE_PRESSURE_LEAVE_PROBABILITY) {
      exitParty(match, state, party, CUSTOMER_STATES.LEAVE_DISTRICT, 'restaurant_full');
      return;
    }
  }

  party.restaurantId = firstRestaurantId(match);
  const [qx, qy, qz] = state.queuePosition;
  party.position = { x: qx, y: qy, z: qz };
  transitionTo(match, party, CUSTOMER_STATES.APPROACH_OR_QUEUE);
}

// --- seating ----------------------------------------------------------------------------------

function bestFitTable(tables, partySize) {
  let best = null;
  for (const table of tables.values()) {
    if (table.occupiedBy) continue;
    if (table.seats < partySize) continue;
    if (!best || table.seats < best.seats) best = table;
  }
  return best;
}

function patienceFraction(party) {
  return clamp(party.patienceMsRemaining / (party.patienceSeconds * 1000), 0, 1);
}

function tryToSeat(match, state, party) {
  const table = bestFitTable(state.tables, party.partySize);
  if (!table) return;

  table.occupiedBy = party.customerId;
  party.tableId = table.id;
  party.position = { x: table.position[0], y: table.position[1], z: table.position[2] };
  party.patienceAtSeatedFrac = patienceFraction(party);
  transitionTo(match, party, CUSTOMER_STATES.SEATED);
}

function freeTable(state, party) {
  if (!party.tableId) return;
  const table = state.tables.get(party.tableId);
  if (table) table.occupiedBy = null;
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
    recoveryActions: null,
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
  freeTable(state, party);
  party.state = exitState;
  party.stateEnteredAtMs = match.elapsedMs;
  party.exitAtMs = match.elapsedMs;
  if (decisionReason !== undefined) party.decisionReason = decisionReason;
  state.counts[exitState] += 1;
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
    party.patienceMsRemaining = Math.max(0, party.patienceMsRemaining - dtMs);
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
      tryToSeat(match, state, party);
      break;

    case CUSTOMER_STATES.SEATED:
      if (party.patienceMsRemaining <= 0) {
        exitParty(match, state, party, CUSTOMER_STATES.CANCEL_ORDER);
        break;
      }
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
      if (msInState >= CUSTOMER_PAYING_MS) {
        freeTable(state, party);
        const [ex, ey, ez] = state.entryPosition;
        party.position = { x: ex, y: ey, z: ez };
        transitionTo(match, party, CUSTOMER_STATES.LEAVING);
      }
      break;

    case CUSTOMER_STATES.LEAVING:
      if (msInState >= CUSTOMER_LEAVING_MS) {
        // Decision 13: REVIEW/REPUTATION_IMPACT resolves in this one step.
        party.state = CUSTOMER_STATES.REVIEW;
        party.stateEnteredAtMs = match.elapsedMs;
        party.exitAtMs = match.elapsedMs;
        state.counts[CUSTOMER_STATES.REVIEW] += 1;
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
  };
}

// --- the system --------------------------------------------------------------------------------

export const customerSystem = {
  id: 'customers',
  phases: ['service', 'final_rush'],

  update(match, dtMs) {
    const state = ensureState(match);

    tickArrivals(match, state, dtMs);
    for (const party of state.parties.values()) advanceParty(match, state, party, dtMs);
    cleanupExitedParties(match, state);

    // match.js's toSnapshot() serializes whatever is here verbatim — see the top-of-file note.
    // Only ever assign the sanitized projection, never the internal `state.parties` values.
    match.customers = [...state.parties.values()].map(toPublicCustomerSnapshot);
  },

  onPhaseChange(match, transition) {
    if (transition.to !== 'results') return;
    if (!match._customerSimState) return; // never ticked — nothing to report or clear.

    const { counts } = match._customerSimState;
    console.log(
      `[customers] ${match.id} seed=${match.seed} market=${match.market?.id ?? 'none'} ` +
        `served(REVIEW)=${counts[CUSTOMER_STATES.REVIEW]} of ${counts.spawned} spawned ` +
        `(rival=${counts[CUSTOMER_STATES.CHOOSE_RIVAL]} left_district=${counts[CUSTOMER_STATES.LEAVE_DISTRICT]} ` +
        `abandoned_queue=${counts[CUSTOMER_STATES.ABANDON_QUEUE]} cancelled_order=${counts[CUSTOMER_STATES.CANCEL_ORDER]} ` +
        `left_angry=${counts[CUSTOMER_STATES.LEAVE_ANGRY]})`,
    );

    match.customers = [];
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
};
