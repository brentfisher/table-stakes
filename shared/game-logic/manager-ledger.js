// STORY-037. Pure five-constraint diagnosis shared by the authoritative manager-ledger system
// and its standalone harness. Every input is an already-observed count/state; this module does
// not predict outcomes or invent a counterfactual lift.

import { MANAGER_CONSTRAINT_LIMITING_SCORE } from '../constants/tuning.js';

export const MANAGER_CONSTRAINT_IDS = Object.freeze([
  'demand_conversion',
  'seating_service',
  'production',
  'inventory',
  'prioritization',
]);

const round = (value) => Number(value.toFixed(2));
const statusFor = (score) => score >= MANAGER_CONSTRAINT_LIMITING_SCORE ? 'limiting' : score > 0 ? 'watch' : 'clear';

export function classifyManagerConstraints(input) {
  const evaluated = input.chosenParties + input.lostToRival;
  const lostShare = evaluated > 0 ? input.lostToRival / evaluated : 0;
  const demandScore = lostShare * 4 + Math.min(1, input.leftDistrict);
  const seatingScore =
    input.queueLength / Math.max(1, input.longQueueThreshold) * 2 +
    Math.min(2, input.dirtyTables) +
    Math.min(2, input.unhappyGuests);
  const productionScore =
    input.queuedTickets / Math.max(1, input.kitchenQueueThreshold) * 3 +
    input.oldestReadyFoodMs / Math.max(1, input.freshnessGraceMs);
  const inventoryScore =
    Math.min(4, input.blockingTickets * 2 + input.unavailableDishes * 2) +
    (input.pantryRisk === 'AT RISK' ? 1 : input.pantryRisk === 'BLOCKING' ? 3 : input.pantryRisk === 'WATCH' ? 0.5 : 0);
  const recommendationIsUrgent = input.recommendedFocusId !== 'premium_first';
  const focusMismatch = recommendationIsUrgent && input.activeFocusId !== input.recommendedFocusId;
  const prioritizationScore = focusMismatch ? MANAGER_CONSTRAINT_LIMITING_SCORE : 0;

  const values = [
    {
      id: 'demand_conversion', score: demandScore,
      evidence: `${input.lostToRival} of ${evaluated} evaluated parties chose elsewhere; ${input.leftDistrict} left the district.`,
    },
    {
      id: 'seating_service', score: seatingScore,
      evidence: `${input.queueLength} waiting, ${input.dirtyTables} dirty tables, ${input.unhappyGuests} guests at risk.`,
    },
    {
      id: 'production', score: productionScore,
      evidence: `${input.queuedTickets} kitchen tickets queued; oldest ready food ${Math.round(input.oldestReadyFoodMs / 1000)}s.`,
    },
    {
      id: 'inventory', score: inventoryScore,
      evidence: `${input.blockingTickets} blocked tickets, ${input.unavailableDishes} unavailable dishes; pantry ${input.pantryRisk}.`,
    },
    {
      id: 'prioritization', score: prioritizationScore,
      evidence: focusMismatch
        ? `Kitchen focus ${input.activeFocusId} differs from the observed-pressure recommendation ${input.recommendedFocusId}.`
        : `Kitchen focus ${input.activeFocusId} matches current urgent pressure or no urgent mismatch is observed.`,
    },
  ].map((constraint) => ({ ...constraint, score: round(constraint.score), status: statusFor(constraint.score) }));

  const ranked = [...values].sort((a, b) => b.score - a.score);
  return { constraints: values, dominantConstraint: ranked[0]?.score > 0 ? ranked[0].id : null };
}
