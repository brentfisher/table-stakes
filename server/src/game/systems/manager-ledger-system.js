// STORY-037. The authoritative synthesis layer for the four management posts. It reads state
// owned by front-door, service-station, kitchen-command, inventory, orders and customers; it
// never mutates their rules. Live snapshots stay private under `you`, while match-end summaries
// are frozen before scoring so ResultsPanel can explain only decisions and outcomes we recorded.

import {
  HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD,
  HUD_LONG_ENTRY_QUEUE_THRESHOLD,
  ORDER_FRESHNESS_GRACE_MS,
  TELEMETRY_SAMPLE_INTERVAL_MS,
} from '../../../../shared/constants/tuning.js';
import {
  MANAGER_CONSTRAINT_IDS,
  classifyManagerConstraints,
} from '../../../../shared/game-logic/manager-ledger.js';

const cents = (value) => Math.round(value * 100) / 100;
const roundToOne = (value) => Math.round(value * 10) / 10;

const RECOMMENDATIONS = Object.freeze({
  demand_conversion: 'Revisit the front-door offer, price, or menu fit before the next rush.',
  seating_service: 'Add or redirect dining-room capacity before attracting another wave.',
  production: 'Choose a kitchen focus that clears the measured rail or pass backlog.',
  inventory: 'Order earlier or choose a replenishment option that covers the measured shortage.',
  prioritization: 'Align the kitchen focus with the pressure shown on the command board.',
});

function initialTracking() {
  return Object.fromEntries(MANAGER_CONSTRAINT_IDS.map((id) => [id, {
    id, observedMs: 0, limitingMs: 0, peakScore: 0, evidence: '',
  }]));
}

/** STORY-039. `match.restaurantIdFor`, feature-detected — `scripts/check-manager-ledger.mjs`
 * exercises this system against a hand-built fixture object, not a real `Match`, so a fixture
 * with no `restaurantIdFor` keeps its pre-existing `restaurantId === playerId` behavior exactly
 * as before this story (same fallback `action-validator.js` uses for its own fixtures). */
function restaurantIdOf(match, playerId) {
  return typeof match.restaurantIdFor === 'function' ? match.restaurantIdFor(playerId) : playerId;
}

function ensure(match) {
  if (match._managerLedgerState) return match._managerLedgerState;
  // STORY-039. De-duplicated through `restaurantIdFor` — a co-op match's two players collapse
  // to the one restaurant id they share, same reasoning as every other per-restaurant bucket
  // in this codebase now follows (see `Match#restaurantIdFor`'s own comment).
  const state = {
    lastSampleMs: -Infinity,
    restaurants: new Map(
      [...new Set([...match.players.keys()].map((id) => restaurantIdOf(match, id)))].map((id) => [
        id,
        { tracking: initialTracking() },
      ]),
    ),
  };
  match._managerLedgerState = state;
  match.managerLedger = {
    privateFor(restaurantId) { return buildLiveLedger(match, restaurantId); },
  };
  return state;
}

function constraintInput(match, restaurantId) {
  const restaurant = (match.restaurants ?? []).find((item) => item.restaurantId === restaurantId);
  const district = (match.districtSummary ?? []).find((item) => item.restaurantId === restaurantId);
  const orders = (match.orders ?? []).filter((order) => order.restaurantId === restaurantId);
  const kitchen = match.kitchenCommand?.privateFor(restaurantId);
  const pantry = match.pantry?.publicFor(restaurantId);
  const customers = (match.customers ?? []).filter((customer) => customer.restaurantId === restaurantId);
  return {
    chosenParties: district?.counts?.chosen ?? 0,
    lostToRival: district?.counts?.CHOOSE_RIVAL ?? 0,
    leftDistrict: district?.counts?.LEAVE_DISTRICT ?? 0,
    queueLength: restaurant?.queueLength ?? 0,
    longQueueThreshold: HUD_LONG_ENTRY_QUEUE_THRESHOLD,
    dirtyTables: (restaurant?.tables ?? []).filter((table) => table.dirty).length,
    unhappyGuests: customers.filter((customer) => customer.unhappy).length,
    queuedTickets: orders.filter((order) => order.state === 'queued' && !order.blockedByIngredientId).length,
    kitchenQueueThreshold: HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD,
    oldestReadyFoodMs: kitchen?.oldestReadyFoodMs ?? 0,
    freshnessGraceMs: ORDER_FRESHNESS_GRACE_MS,
    blockingTickets: (restaurant?.shortages ?? []).reduce((sum, shortage) => sum + shortage.blockedTickets, 0),
    unavailableDishes: kitchen?.menuAvailability.filter((dish) => !dish.available).length ?? 0,
    pantryRisk: pantry?.overallRisk ?? 'STOCKED',
    activeFocusId: kitchen?.activeFocusId ?? 'rush_pass',
    recommendedFocusId: kitchen?.recommendation.focusId ?? 'premium_first',
  };
}

function buildLiveLedger(match, restaurantId) {
  const input = constraintInput(match, restaurantId);
  const diagnosis = classifyManagerConstraints(input);
  const frontDoor = match.frontDoor?.publicFor(restaurantId);
  const activeSpecial = frontDoor?.activeSpecialId ? match.frontDoor?.special(frontDoor.activeSpecialId) : null;
  const service = match.serviceStation?.publicFor(restaurantId);
  const kitchen = match.kitchenCommand?.privateFor(restaurantId);
  const pantry = match.pantry?.publicFor(restaurantId);
  return {
    chips: {
      frontDoor: {
        activeSpecialId: frontDoor?.activeSpecialId ?? null,
        activeForMs: frontDoor?.activeForMs ?? 0,
        activeCost: activeSpecial?.cost ?? 0,
      },
      service: {
        priorityId: service?.priorityId ?? 'balanced',
        activeContracts: service?.contracts.filter((contract) => contract.status === 'active').length ?? 0,
        arrivingContracts: service?.contracts.filter((contract) => contract.status === 'arriving').length ?? 0,
        payrollBurn: service?.payrollBurn ?? 0,
        laborExpenses: service?.laborExpenses ?? 0,
      },
      kitchen: { activeFocusId: kitchen?.activeFocusId ?? 'rush_pass' },
      pantry: {
        risk: pantry?.overallRisk ?? 'STOCKED',
        inboundDeliveries: pantry?.deliveries.length ?? 0,
      },
    },
    ...diagnosis,
  };
}

function inAnyWindow(atMs, windows) {
  return windows.some((window) => atMs >= window.startMs && atMs <= window.endMs);
}

function summarizeSpecials(match, restaurantId) {
  const activations = match.telemetry.filter(
    (event) => event.category === 'front_door_special_activated' && event.restaurantId === restaurantId,
  );
  const bySpecial = new Map();
  for (const activation of activations) {
    const entry = bySpecial.get(activation.specialId) ?? { specialId: activation.specialId, activations: [], spend: 0 };
    entry.activations.push({ startMs: activation.atMs, endMs: activation.atMs + activation.durationMs });
    entry.spend = cents(entry.spend + activation.cost);
    bySpecial.set(activation.specialId, entry);
  }
  const samples = match.telemetry.filter(
    (event) => event.category === 'manager_constraint_sample' && event.restaurantId === restaurantId,
  );
  const delivered = match.telemetry.filter(
    (event) => event.category === 'order' && event.restaurantId === restaurantId && event.state === 'delivered',
  );
  return [...bySpecial.values()].map((entry) => {
    const decisions = (match.districtDecisions ?? []).filter((decision) => inAnyWindow(decision.atMs, entry.activations));
    const conversions = decisions.filter((decision) => decision.chosenRestaurantId === restaurantId).length;
    const orders = delivered.filter((order) => inAnyWindow(order.placedAtMs, entry.activations));
    const observedRevenue = cents(orders.reduce((sum, order) => sum + order.revenue, 0));
    const windowSamples = samples.filter((sample) => inAnyWindow(sample.atMs, entry.activations));
    const averageSatisfaction = windowSamples.length > 0
      ? roundToOne(windowSamples.reduce(
          (sum, sample) => sum + (sample.averageSatisfaction ?? 0),
          0,
        ) / windowSamples.length)
      : null;
    return {
      specialId: entry.specialId,
      activations: entry.activations.length,
      spend: entry.spend,
      observedDecisions: decisions.length,
      observedConversions: conversions,
      observedConversionRate: decisions.length > 0 ? Number((conversions / decisions.length).toFixed(3)) : null,
      deliveredOrders: orders.length,
      observedRevenue,
      averageCheck: orders.length > 0 ? cents(observedRevenue / orders.length) : null,
      averageSatisfaction,
      peakQueue: Math.max(0, ...windowSamples.map((sample) => sample.queueLength ?? 0)),
    };
  });
}

function dominantFromTracking(tracking) {
  const ranked = Object.values(tracking).sort(
    (a, b) => b.limitingMs - a.limitingMs || b.observedMs - a.observedMs || b.peakScore - a.peakScore,
  );
  return ranked[0]?.observedMs > 0 ? ranked[0].id : null;
}

function finalSummary(match, restaurantId, restaurantState) {
  const district = (match.districtSummary ?? []).find((entry) => entry.restaurantId === restaurantId) ?? {};
  const inventory = (match.inventorySummary ?? []).find((entry) => entry.restaurantId === restaurantId) ?? {};
  const service = match.serviceStation?.expensesFor(restaurantId) ?? { laborExpenses: 0, hireFees: 0, wagesPaid: 0 };
  const kitchen = match.kitchenCommand?.privateFor(restaurantId);
  const contractsHired = match.telemetry.filter(
    (event) => event.category === 'service_contract_hired' && event.restaurantId === restaurantId,
  ).length;
  const focusChanges = match.telemetry.filter(
    (event) => event.category === 'kitchen_focus_changed' && event.restaurantId === restaurantId,
  ).length;
  const temporaryTaskEvents = match.telemetry.filter(
    (event) => event.category === 'worker_task_completed'
      && event.restaurantId === restaurantId
      && event.workerId.startsWith('temp_'),
  );
  const taskCompletionsByKind = temporaryTaskEvents.reduce((counts, event) => {
    counts[event.taskKind] = (counts[event.taskKind] ?? 0) + 1;
    return counts;
  }, {});
  const constraints = Object.values(restaurantState.tracking).map((entry) => ({ ...entry }));
  const dominantConstraint = dominantFromTracking(restaurantState.tracking);
  const specials = summarizeSpecials(match, restaurantId);
  const specialSpend = cents(specials.reduce((sum, special) => sum + special.spend, 0));
  const insights = [];

  if (dominantConstraint) {
    const evidence = restaurantState.tracking[dominantConstraint];
    insights.push({
      category: dominantConstraint,
      observation: `${evidence.evidence} This pressure was observed for ${Math.round(evidence.observedMs / 1000)}s.`,
      recommendation: RECOMMENDATIONS[dominantConstraint],
    });
  }
  if (specials.length > 0) {
    const decisions = specials.reduce((sum, item) => sum + item.observedDecisions, 0);
    const conversions = specials.reduce((sum, item) => sum + item.observedConversions, 0);
    insights.push({
      category: 'specials',
      observation: `Specials cost $${specialSpend.toFixed(2)}. During their active windows, ${conversions} of ${decisions} observed district decisions chose this restaurant.`,
      recommendation: 'Compare the observed window with its spend and queue pressure before repeating the offer.',
    });
  }
  if (service.laborExpenses > 0) {
    insights.push({
      category: 'labor',
      observation: `Temporary staffing cost $${service.laborExpenses.toFixed(2)} ($${service.hireFees.toFixed(2)} hire fees and $${service.wagesPaid.toFixed(2)} wages); temporary workers completed ${temporaryTaskEvents.length} recorded tasks while ${district.guestsServed ?? 0} guests were served.`,
      recommendation: 'Hire against a measured dining-room constraint and compare the cost with the work it covers.',
    });
  }
  if ((inventory.inventoryExpenses ?? 0) > 0 || (inventory.shortageDurationMs ?? 0) > 0) {
    insights.push({
      category: 'inventory',
      observation: `Restocks cost $${(inventory.inventoryExpenses ?? 0).toFixed(2)}, including $${(inventory.marketPremiumPaid ?? 0).toFixed(2)} market premium; shortage pressure lasted ${Math.round((inventory.shortageDurationMs ?? 0) / 1000)}s.`,
      recommendation: 'Order earlier when premium spend or recorded shortage time outweighs holding extra stock.',
    });
  }

  return {
    dominantConstraint,
    constraints,
    specials,
    labor: {
      contractsHired,
      ...service,
      taskCompletions: temporaryTaskEvents.length,
      taskCompletionsByKind,
    },
    restocking: {
      expense: inventory.inventoryExpenses ?? 0,
      marketPremiumPaid: inventory.marketPremiumPaid ?? 0,
      ordersPlaced: inventory.stockOrdersPlaced ?? 0,
      shortageDurationMs: inventory.shortageDurationMs ?? 0,
    },
    kitchen: {
      finalFocusId: kitchen?.activeFocusId ?? 'rush_pass',
      focusChanges,
      selectionsByFocus: { ...(kitchen?.selectionsByFocus ?? {}) },
      recommendationMismatchMs: restaurantState.tracking.prioritization.observedMs,
    },
    insights,
  };
}

export const managerLedgerSystem = {
  id: 'manager_ledger',
  phases: ['service', 'final_rush'],
  update(match, dtMs) {
    const state = ensure(match);
    let shouldSample = false;
    if (match.elapsedMs - state.lastSampleMs >= TELEMETRY_SAMPLE_INTERVAL_MS) {
      state.lastSampleMs = match.elapsedMs;
      shouldSample = true;
    }
    for (const restaurantId of new Set([...match.players.keys()].map((id) => restaurantIdOf(match, id)))) {
      if (!state.restaurants.has(restaurantId)) state.restaurants.set(restaurantId, { tracking: initialTracking() });
      const ledger = buildLiveLedger(match, restaurantId);
      const restaurantState = state.restaurants.get(restaurantId);
      for (const constraint of ledger.constraints) {
        const tracked = restaurantState.tracking[constraint.id];
        if (constraint.score > 0) tracked.observedMs += dtMs;
        if (constraint.status === 'limiting') tracked.limitingMs += dtMs;
        if (constraint.score >= tracked.peakScore) {
          tracked.peakScore = constraint.score;
          tracked.evidence = constraint.evidence;
        }
      }
      if (shouldSample) {
        const restaurant = (match.restaurants ?? []).find((item) => item.restaurantId === restaurantId);
        match.logEvent('manager_constraint_sample', {
          restaurantId,
          dominantConstraint: ledger.dominantConstraint,
          scores: Object.fromEntries(ledger.constraints.map((constraint) => [constraint.id, constraint.score])),
          queueLength: restaurant?.queueLength ?? 0,
          averageSatisfaction: restaurant?.averageSatisfaction ?? 0,
        });
      }
    }
  },
  onPhaseChange(match, transition) {
    if (transition.to === 'service') { ensure(match); return; }
    if (transition.to !== 'results' || !match._managerLedgerState) return;
    match.managerLedgerSummary = [...match._managerLedgerState.restaurants].map(([restaurantId, state]) => ({
      restaurantId,
      ...finalSummary(match, restaurantId, state),
    }));
  },
};

export const _internal = { ensure, constraintInput, buildLiveLedger, summarizeSpecials, finalSummary };
