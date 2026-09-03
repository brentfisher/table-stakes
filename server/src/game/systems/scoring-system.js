// PRD §11 "Scoring and win conditions". Reads what every other gameplay system produced —
// `match.districtSummary` (customer-system.js), `match.orderSummary` (order-system.js),
// `match.upgradeSummary` (upgrade-system.js), and each player's own `setup` — and turns it into
// a composite score, a winner, and the full §11 "End-of-match results" payload.
//
// THIS FILE OWNS NO SIMULATION STATE OF ITS OWN. It has no `match._scoringSimState`, no
// per-tick bookkeeping, nothing to tear down. Its `update()` is required by `registerSystem`
// but is genuinely empty: every raw number it needs was already accumulated, incrementally,
// by the system that owns that number, and published on the match for exactly this moment.
//
// REGISTRATION ORDER IS LOAD-BEARING. This system MUST be registered LAST (see
// systems/index.js's registration comment) — every one of the three summaries above is set by
// its OWNER's own `onPhaseChange('results')` handler, immediately before that system tears its
// own internals down. `onPhaseChange` fires for every system, in registration order, before any
// `update` runs this tick — so as long as `scoringSystem` is last, every summary this file reads
// is guaranteed to already exist by the time its own `onPhaseChange('results')` runs.
//
// PURE MATH LIVES ELSEWHERE. `computeCompositeScore`, `computePenaltyPoints`,
// `compareForTieBreak` and `determineWinner` are `../scoring/score-formula.js` — a
// dependency-free module with no knowledge of `match`, written independently against a frozen
// contract. This file's job is entirely translation: match state -> that module's plain-object
// inputs -> `match.finalResults`.

import { computeCompositeScore, computePenaltyPoints, determineWinner } from '../scoring/score-formula.js';
import { CUSTOMER_STATES } from '../../../../shared/schemas/game-state.js';
import {
  SCORE_POINTS_SCALE,
  SCORE_WEIGHT_NET_REVENUE,
  SCORE_WEIGHT_GUESTS_SERVED,
  SCORE_WEIGHT_SATISFACTION,
  SCORE_WEIGHT_REPUTATION,
  SCORE_WEIGHT_EVENT_OBJECTIVE,
  SCORE_NET_REVENUE_REFERENCE,
  SCORE_GUESTS_SERVED_REFERENCE,
  SCORE_PENALTY_ABANDONMENT_POINTS,
  SCORE_PENALTY_CANCELLED_ORDER_POINTS,
  SCORE_PENALTY_SEVERE_DISSATISFACTION_POINTS,
  SCORE_PENALTY_WASTE_POINTS_PER_DOLLAR,
  SCORE_PENALTY_CRITIC_FAILURE_POINTS,
  DISTRICT_REPUTATION_MIN,
  DISTRICT_REPUTATION_MAX,
} from '../../../../shared/constants/tuning.js';

const toCents = (value) => Math.round(value * 100) / 100;

/**
 * §11's one named example of a "broken promise" penalty. Building the mechanism that actually
 * SPAWNS `food_critic_spotted`'s `specialPartySpawn` party is out of scope for this story (as of
 * this story starting, nothing in the codebase consumes that field — see event-system.js's own
 * comment on `specialPartySpawns`); inventing it here would be scope creep into whichever story
 * owns party spawning. Absent that mechanism, "failing" the event is defined structurally: the
 * event was active AND something already-countable went wrong on the floor during the same
 * window — see `countCriticFailures` below.
 */
const CRITIC_EVENT_ID = 'food_critic_spotted';

/**
 * PRD §11 "failing a critic event". Defined here as: a `food_critic_spotted` window was active
 * (per the district's shared, never-torn-down `match.eventTimeline`) AND, during that same
 * window, this restaurant had at least one cancelled order OR at least one party newly cross
 * into `everUnhappy` — i.e., something went wrong on the floor while the critic-relevant event
 * was live. Each qualifying WINDOW counts once, not once per bad thing inside it.
 *
 * `badMomentsMs` is the union of order-system.js's cancellation timestamps and
 * customer-system.js's first-everUnhappy timestamps for this restaurant — both absolute
 * `match.elapsedMs` values, collected incrementally by the systems that own those events (see
 * the `badMomentsMs` field comments on each). Cross-referencing happens here, against the
 * timeline's own `activateAtMs`/`endAtMs`, converted to absolute match-clock time via
 * `timeline.anchorMs` — the exact same conversion event-system.js's own `update()` uses.
 *
 * Returns 0 (not a guess) when the event system never ran, or the timeline was never anchored —
 * both mean "no event was ever active", never an error.
 */
function countCriticFailures(match, badMomentsMs) {
  const timeline = match.eventTimeline;
  if (!timeline || timeline.anchorMs === null || timeline.anchorMs === undefined) return 0;
  if (badMomentsMs.length === 0) return 0;

  let failures = 0;
  for (const entry of timeline.entries) {
    if (entry.eventId !== CRITIC_EVENT_ID) continue;
    const activateAbsMs = timeline.anchorMs + entry.activateAtMs;
    const endAbsMs = timeline.anchorMs + entry.endAtMs;
    if (badMomentsMs.some((ms) => ms >= activateAbsMs && ms < endAbsMs)) failures += 1;
  }
  return failures;
}

/**
 * PRD §11 "Event Objective Bonus", a 0-1 fraction: of this restaurant's delivered orders, what
 * share were PLACED while at least one event was active district-wide? Reflects whether the
 * restaurant capitalized on event-driven demand, rather than being the same number for both
 * restaurants (which "fraction of the whole match that was event-active" would be — that measure
 * is explicitly rejected here for exactly that reason). Computed incrementally in
 * `order-system.js#deliverOrder`, at delivery time, from the order's own `placedAtMs` — order
 * objects are pruned from live state well before `results` (`ORDER_SNAPSHOT_LINGER_MS`), so this
 * cannot be reconstructed after the fact from `match.orderSummary` alone; it has to already be a
 * running count by the time this file reads it.
 */
function eventObjectiveFractionFor(orderSummary) {
  const delivered = orderSummary?.ordersDelivered ?? 0;
  if (delivered <= 0) return 0;
  return (orderSummary.ordersDeliveredDuringEvent ?? 0) / delivered;
}

function buildRestaurantResult(match, restaurantId, districtByRestaurant, orderByRestaurant, upgradeByRestaurant) {
  const district = districtByRestaurant.get(restaurantId) ?? {};
  const order = orderByRestaurant.get(restaurantId) ?? {};
  const upgrade = upgradeByRestaurant.get(restaurantId) ?? {};
  const setup = match.players.get(restaurantId)?.setup ?? {};

  // --- money: net revenue / expenses (PRD §11) --------------------------------------------
  const inventoryCost = setup.inventoryCost ?? 0;
  const upgradeCostAtSetup = setup.upgradeCost ?? 0;
  const cashSpentOnUpgrades = upgrade.cashSpentOnUpgrades ?? 0;
  const revenue = order.revenue ?? 0;
  const expenses = toCents(inventoryCost + upgradeCostAtSetup + cashSpentOnUpgrades);
  // "Net profit" and "net revenue" are the same number — one field, `netProfit`, doubling as
  // both names §11 uses for it.
  const netProfit = toCents(revenue - expenses);

  // --- penalties -----------------------------------------------------------------------------
  const badMomentsMs = [...(district.badMomentsMs ?? []), ...(order.badMomentsMs ?? [])];
  const criticFailures = countCriticFailures(match, badMomentsMs);
  const eventObjectiveFraction = eventObjectiveFractionFor(order);

  const penaltyPoints = computePenaltyPoints(
    {
      abandonedParties: district.abandonedParties ?? 0,
      cancelledOrders: order.cancelledOrders ?? 0,
      severeDissatisfactionCount: district.severelyDissatisfiedCount ?? 0,
      wasteDollars: order.wasteDollars ?? 0,
      criticFailures,
    },
    {
      abandonmentPoints: SCORE_PENALTY_ABANDONMENT_POINTS,
      cancelledOrderPoints: SCORE_PENALTY_CANCELLED_ORDER_POINTS,
      severeDissatisfactionPoints: SCORE_PENALTY_SEVERE_DISSATISFACTION_POINTS,
      wastePointsPerDollar: SCORE_PENALTY_WASTE_POINTS_PER_DOLLAR,
      criticFailurePoints: SCORE_PENALTY_CRITIC_FAILURE_POINTS,
    },
  );

  // --- composite score -------------------------------------------------------------------------
  const { score } = computeCompositeScore(
    {
      netRevenue: netProfit,
      guestsServed: district.guestsServed ?? 0,
      averageSatisfaction: district.averageSatisfaction ?? 0,
      reputation: district.reputation ?? DISTRICT_REPUTATION_MIN,
      eventObjectiveFraction,
      penaltyPoints,
    },
    {
      pointsScale: SCORE_POINTS_SCALE,
      netRevenueWeight: SCORE_WEIGHT_NET_REVENUE,
      guestsServedWeight: SCORE_WEIGHT_GUESTS_SERVED,
      satisfactionWeight: SCORE_WEIGHT_SATISFACTION,
      reputationWeight: SCORE_WEIGHT_REPUTATION,
      eventObjectiveWeight: SCORE_WEIGHT_EVENT_OBJECTIVE,
      netRevenueReference: SCORE_NET_REVENUE_REFERENCE,
      guestsServedReference: SCORE_GUESTS_SERVED_REFERENCE,
      reputationMin: DISTRICT_REPUTATION_MIN,
      reputationMax: DISTRICT_REPUTATION_MAX,
    },
  );

  return {
    score,
    // The original 6 MatchResult fields (never removed, per Decision 7):
    revenue,
    guestsServed: district.guestsServed ?? 0,
    averageSatisfaction: district.averageSatisfaction ?? 0,
    reputation: district.reputation ?? DISTRICT_REPUTATION_MIN,
    abandonedParties: district.abandonedParties ?? 0,
    // The §11 additions:
    expenses,
    netProfit,
    customersLostToRival: district.counts?.[CUSTOMER_STATES.CHOOSE_RIVAL] ?? 0,
    averageWaitTimeMs: district.averageWaitTimeMs ?? 0,
    bestSellingDishes: order.bestSellingDishes ?? [],
    highestMarginDishes: order.highestMarginDishes ?? [],
    eventPerformance: { eventObjectiveFraction, criticFailures },
    upgradesPurchased: upgrade.purchasedUpgradeIds ?? [],
    customerSegmentBreakdown: district.segmentCounts ?? {},
    // Not part of MatchResult — stripped before this restaurant's entry reaches
    // `match.finalResults.results`; only `determineWinner`'s tie-break comparator reads it.
    tieBreak: {
      averageSatisfaction: district.averageSatisfaction ?? 0,
      guestsServed: district.guestsServed ?? 0,
      netRevenue: netProfit,
      abandonedParties: district.abandonedParties ?? 0,
    },
  };
}

export const scoringSystem = {
  id: 'scoring',
  // No `phases` key: `registerSystem` requires either a non-empty array or nothing at all, and
  // this system has no phase-scoped work — `update` is a required no-op (see the module header),
  // called every tick regardless of phase, and does nothing every time. All real work happens in
  // `onPhaseChange`, which fires for every system on every transition regardless of `phases`.

  update() {},

  onPhaseChange(match, transition) {
    if (transition.to !== 'results') return;

    const districtByRestaurant = new Map((match.districtSummary ?? []).map((d) => [d.restaurantId, d]));
    const orderByRestaurant = new Map((match.orderSummary ?? []).map((o) => [o.restaurantId, o]));
    const upgradeByRestaurant = new Map((match.upgradeSummary ?? []).map((u) => [u.restaurantId, u]));

    const restaurantIds = [...match.players.keys()];
    const perRestaurant = new Map();
    for (const restaurantId of restaurantIds) {
      perRestaurant.set(
        restaurantId,
        buildRestaurantResult(match, restaurantId, districtByRestaurant, orderByRestaurant, upgradeByRestaurant),
      );
    }

    // `determineWinner` is contracted for exactly 2 restaurants — the real shape of every match
    // this game ever runs. A dev/check-script match seated with only 1 player has no rival to
    // win against; null is the honest answer, not a crash.
    let winnerPlayerId = null;
    if (restaurantIds.length === 2) {
      const [aId, bId] = restaurantIds;
      const a = perRestaurant.get(aId);
      const b = perRestaurant.get(bId);
      winnerPlayerId = determineWinner([
        { restaurantId: aId, score: a.score, tieBreak: a.tieBreak },
        { restaurantId: bId, score: b.score, tieBreak: b.tieBreak },
      ]);
    }

    const results = {};
    for (const [restaurantId, r] of perRestaurant) {
      // `tieBreak` is scoring-internal only — never part of the wire-facing MatchResult shape.
      const { tieBreak: _tieBreak, ...publicResult } = r;
      results[restaurantId] = publicResult;
      console.log(
        `[scoring] ${match.id} ${restaurantId} score=${r.score.toFixed(1)} ` +
          `revenue=$${r.revenue.toFixed(2)} netProfit=$${r.netProfit.toFixed(2)} ` +
          `guestsServed=${r.guestsServed} avgSatisfaction=${r.averageSatisfaction} ` +
          `winner=${winnerPlayerId === restaurantId}`,
      );
    }
    console.log(`[scoring] ${match.id} winnerPlayerId=${winnerPlayerId ?? 'null (draw)'}`);

    // Outlives everything else's teardown, same pattern as `match.districtSummary` etc. — the
    // match is ending anyway, so nothing needs to null this back out.
    match.finalResults = { winnerPlayerId, results };
  },
};

/** Exported for `scripts/check-scoring.mjs` ONLY, exactly as every sibling system's `_internal`
 * is — a way to exercise a branch (the critic-failure cross-reference, the event-objective
 * fraction) deterministically. */
export const _internal = { countCriticFailures, eventObjectiveFractionFor, buildRestaurantResult, CRITIC_EVENT_ID };
