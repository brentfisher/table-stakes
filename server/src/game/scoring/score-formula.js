/**
 * Pure scoring math for STORY-013 (PRD §11: Scoring and win conditions).
 *
 * This module takes NO dependencies on live game state and does NOT import
 * shared/constants/tuning.js. Every number it needs is passed in by the
 * caller as a function parameter, which keeps it trivially unit-testable
 * with synthetic inputs.
 */

/**
 * Clamp a value into the [0, 1] range.
 * @param {number} value
 * @returns {number}
 */
export function clamp01(value) {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Sum the non-negative, independently-weighted penalty components into a
 * single total penalty point value.
 *
 * @param {object} counts
 * @param {number} counts.abandonedParties
 * @param {number} counts.cancelledOrders
 * @param {number} counts.severeDissatisfactionCount
 * @param {number} counts.wasteDollars - dollars of unserved food revenue forgone
 * @param {number} counts.criticFailures - count of failed critic events
 * @param {object} penaltyWeights
 * @param {number} penaltyWeights.abandonmentPoints
 * @param {number} penaltyWeights.cancelledOrderPoints
 * @param {number} penaltyWeights.severeDissatisfactionPoints
 * @param {number} penaltyWeights.wastePointsPerDollar
 * @param {number} penaltyWeights.criticFailurePoints
 * @returns {number} total penalty points, always >= 0
 */
export function computePenaltyPoints(counts, penaltyWeights) {
  const abandonment =
    Math.max(0, counts.abandonedParties) * penaltyWeights.abandonmentPoints;
  const cancelled =
    Math.max(0, counts.cancelledOrders) * penaltyWeights.cancelledOrderPoints;
  const severeDissatisfaction =
    Math.max(0, counts.severeDissatisfactionCount) *
    penaltyWeights.severeDissatisfactionPoints;
  const waste =
    Math.max(0, counts.wasteDollars) * penaltyWeights.wastePointsPerDollar;
  const criticFailure =
    Math.max(0, counts.criticFailures) * penaltyWeights.criticFailurePoints;

  const total =
    abandonment + cancelled + severeDissatisfaction + waste + criticFailure;

  return Math.max(0, total);
}

/**
 * Compute the composite Restaurant Score per PRD §11:
 *   Revenue Score + Guests Served Score + Satisfaction Score +
 *   Reputation Bonus + Event Objective Bonus - Penalty Score
 *
 * Raw revenue, guests-served, satisfaction, and reputation values are
 * normalized to [0, 1] fractions of their configured reference values
 * before being weighted and scaled onto the points scale.
 *
 * @param {object} raw
 * @param {number} raw.netRevenue - dollars, can be negative
 * @param {number} raw.guestsServed - integer count
 * @param {number} raw.averageSatisfaction - 0-100 scale
 * @param {number} raw.reputation - raw scale, `reputationMin` to `reputationMax`
 * @param {number} raw.eventObjectiveFraction - already a 0-1 fraction
 * @param {number} raw.penaltyPoints - already-computed total penalty points
 * @param {object} weights
 * @param {number} weights.pointsScale
 * @param {number} weights.netRevenueWeight
 * @param {number} weights.guestsServedWeight
 * @param {number} weights.satisfactionWeight
 * @param {number} weights.reputationWeight
 * @param {number} weights.eventObjectiveWeight
 * @param {number} weights.netRevenueReference
 * @param {number} weights.guestsServedReference
 * @param {number} weights.reputationMin
 * @param {number} weights.reputationMax
 * @returns {{ score: number, components: { revenueScore: number, guestsServedScore: number, satisfactionScore: number, reputationBonus: number, eventObjectiveBonus: number, penaltyScore: number } }}
 */
export function computeCompositeScore(raw, weights) {
  const revenueFraction = clamp01(raw.netRevenue / weights.netRevenueReference);
  const guestsServedFraction = clamp01(
    raw.guestsServed / weights.guestsServedReference
  );
  const satisfactionFraction = clamp01(raw.averageSatisfaction / 100);
  const reputationSpan = weights.reputationMax - weights.reputationMin;
  const reputationFraction = clamp01(
    (raw.reputation - weights.reputationMin) / reputationSpan
  );
  const eventObjectiveFraction = clamp01(raw.eventObjectiveFraction);

  const revenueScore =
    revenueFraction * weights.netRevenueWeight * weights.pointsScale;
  const guestsServedScore =
    guestsServedFraction * weights.guestsServedWeight * weights.pointsScale;
  const satisfactionScore =
    satisfactionFraction * weights.satisfactionWeight * weights.pointsScale;
  const reputationBonus =
    reputationFraction * weights.reputationWeight * weights.pointsScale;
  const eventObjectiveBonus =
    eventObjectiveFraction * weights.eventObjectiveWeight * weights.pointsScale;
  const penaltyScore = Math.max(0, raw.penaltyPoints);

  const score =
    revenueScore +
    guestsServedScore +
    satisfactionScore +
    reputationBonus +
    eventObjectiveBonus -
    penaltyScore;

  return {
    score,
    components: {
      revenueScore,
      guestsServedScore,
      satisfactionScore,
      reputationBonus,
      eventObjectiveBonus,
      penaltyScore,
    },
  };
}

/**
 * PRD §11 tie-break order, applied only when two restaurants' final
 * composite scores are exactly equal:
 *   1. Higher average satisfaction
 *   2. More customers served
 *   3. Higher net revenue
 *   4. Fewer abandoned parties
 *
 * @param {object} a
 * @param {number} a.averageSatisfaction
 * @param {number} a.guestsServed
 * @param {number} a.netRevenue
 * @param {number} a.abandonedParties
 * @param {object} b - same shape as a
 * @returns {number} negative if a ranks above b, positive if b ranks above a, 0 if a genuine tie
 */
export function compareForTieBreak(a, b) {
  if (a.averageSatisfaction !== b.averageSatisfaction) {
    return b.averageSatisfaction - a.averageSatisfaction;
  }
  if (a.guestsServed !== b.guestsServed) {
    return b.guestsServed - a.guestsServed;
  }
  if (a.netRevenue !== b.netRevenue) {
    return b.netRevenue - a.netRevenue;
  }
  if (a.abandonedParties !== b.abandonedParties) {
    return a.abandonedParties - b.abandonedParties;
  }
  return 0;
}

/**
 * Decide a winner between exactly two restaurants: compare final composite
 * scores first, fall back to `compareForTieBreak`, and treat a genuine 0
 * from that as a real draw.
 *
 * @param {Array<{restaurantId: string, score: number, tieBreak: {averageSatisfaction: number, guestsServed: number, netRevenue: number, abandonedParties: number}}>} restaurants - exactly 2 entries
 * @returns {string | null} the winning restaurantId, or null for a genuine draw
 */
export function determineWinner(restaurants) {
  const [first, second] = restaurants;

  if (first.score !== second.score) {
    return first.score > second.score ? first.restaurantId : second.restaurantId;
  }

  const tieBreakResult = compareForTieBreak(first.tieBreak, second.tieBreak);
  if (tieBreakResult < 0) return first.restaurantId;
  if (tieBreakResult > 0) return second.restaurantId;
  return null;
}
