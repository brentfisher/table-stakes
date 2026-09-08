// STORY-036. One server-authoritative kitchen focus per restaurant. The facade ranks only
// tickets that worker-system has already proved startable; it cannot bypass inventory,
// station capacity, or any action validation.
import data from '../../../../shared/game-data/kitchen-command.json' with { type: 'json' };
import { rankTicketsForFocus } from '../../../../shared/game-logic/kitchen-focus.js';
import { STATIONS } from '../../../../shared/schemas/messages.js';
import { catalogue } from '../catalogue.js';
import { dishDemandMultiplier } from './event-system.js';

const FOCUS_BY_ID = new Map(data.focuses.map((focus) => [focus.id, focus]));

function ticketMetrics(match, restaurantId, ticket) {
  const dish = catalogue.dishesById[ticket.dishId];
  const featured = match.frontDoor?.featuredDishId(restaurantId) === ticket.dishId;
  const eventDemand = dish ? dishDemandMultiplier(match.eventEffects, dish.tags) : 1;
  let scarcityRisk = 0;
  if (dish && ticket.currentStepIndex <= 0) {
    const consumingStation = dish.stationSteps[0]?.station;
    for (const [ingredientId, units] of Object.entries(dish.ingredients ?? {})) {
      const available = (match.pantry?.stockOf(restaurantId, ingredientId) ?? 0) +
        (match.pantry?.binLevel(restaurantId, consumingStation, ingredientId) ?? 0);
      scarcityRisk = Math.max(scarcityRisk, units / Math.max(units, available));
    }
  }
  return {
    ...ticket,
    completionProgress: ticket.totalSteps > 0 ? (ticket.currentStepIndex + 1) / ticket.totalSteps : 0,
    specialPressure: (featured ? 2 : 0) + Math.max(0, eventDemand - 1),
    scarcityRisk,
    margin: ticket.price - (dish?.baseCost ?? ticket.price),
  };
}

function recommendationFor(match, restaurantId, overview) {
  if (overview.shortages.length > 0 || overview.menuAvailability.some((dish) => !dish.available)) {
    return { focusId: 'save_ingredients', reason: 'Ingredients are limiting the menu.' };
  }
  if (overview.oldestReadyFoodMs > 0) {
    return { focusId: 'rush_pass', reason: 'Finished food is waiting at the pass.' };
  }
  if (overview.activeEventIds.length > 0 || overview.activeSpecialId) {
    return { focusId: 'protect_special', reason: 'A short demand window is active.' };
  }
  if (overview.atRiskGuests > 0) {
    return { focusId: 'recovery_mode', reason: 'A seated table is running out of patience.' };
  }
  if (overview.stationQueues.some((station) => station.queued >= 3)) {
    return { focusId: 'clear_queue', reason: 'A station queue is becoming a bottleneck.' };
  }
  return { focusId: 'premium_first', reason: 'The kitchen is stable enough to protect margin.' };
}

function buildOverview(match, restaurantId) {
  const player = match.players.get(restaurantId);
  const dishIds = [...(player?.setup?.menu ?? []), ...(player?.setup?.addons ?? [])].map((slot) => slot.dishId);
  const overview = {
    stationQueues: STATIONS.map((station) => ({ station, queued: match.kitchen?.queueDepth(restaurantId, station) ?? 0 })),
    oldestReadyFoodMs: Math.max(0, ...(match.kitchen?.readyOrders(restaurantId) ?? []).map((order) => order.readyAgeMs)),
    shortages: match.pantry?.shortagesFor(restaurantId) ?? [],
    menuAvailability: dishIds.map((dishId) => ({
      dishId,
      available: match.dishAvailability?.[restaurantId]?.[dishId] !== false,
    })),
    activeEventIds: (match.events ?? []).filter((event) => event.state === 'active').map((event) => event.eventId),
    activeSpecialId: match.frontDoor?.stateFor(restaurantId)?.activeSpecialId ?? null,
    atRiskGuests: (match.customers ?? []).filter((customer) =>
      customer.restaurantId === restaurantId && customer.unhappy && customer.tableId,
    ).length,
  };
  return { ...overview, recommendation: recommendationFor(match, restaurantId, overview) };
}

function ensure(match) {
  if (match._kitchenCommandState) return match._kitchenCommandState;
  const restaurants = new Map([...match.players.keys()].map((id) => [id, {
    activeFocusId: data.defaultFocusId,
    cooldownEndsAtMs: 0,
    selectionsByFocus: Object.fromEntries(data.focuses.map((focus) => [focus.id, 0])),
  }]));
  match._kitchenCommandState = { restaurants };
  match.kitchenCommand = {
    focusFor(restaurantId) {
      return FOCUS_BY_ID.get(restaurants.get(restaurantId)?.activeFocusId) ?? FOCUS_BY_ID.get(data.defaultFocusId);
    },
    command(restaurantId, focusId) {
      const entry = restaurants.get(restaurantId);
      if (!entry) return { ok: false, reason: 'unknown_restaurant' };
      if (!FOCUS_BY_ID.has(focusId)) return { ok: false, reason: 'unknown_kitchen_focus' };
      if (entry.activeFocusId === focusId) return { ok: false, reason: 'focus_already_active' };
      if (match.elapsedMs < entry.cooldownEndsAtMs) return { ok: false, reason: 'focus_cooldown' };
      entry.activeFocusId = focusId;
      entry.cooldownEndsAtMs = match.elapsedMs + data.switchCooldownMs;
      match.logEvent?.('kitchen_focus_changed', { restaurantId, focusId });
      return { ok: true };
    },
    rankTickets(restaurantId, tickets, fallbackCompare) {
      const focus = this.focusFor(restaurantId);
      const measured = tickets.map((ticket) => ticketMetrics(match, restaurantId, ticket));
      return rankTicketsForFocus(focus, measured, fallbackCompare);
    },
    recordSelection(restaurantId, workerId, ticket) {
      const entry = restaurants.get(restaurantId);
      if (!entry) return;
      entry.selectionsByFocus[entry.activeFocusId] += 1;
      match.logEvent?.('kitchen_focus_selection', {
        restaurantId,
        focusId: entry.activeFocusId,
        workerId,
        ticketId: ticket.ticketId,
        station: ticket.station,
      });
    },
    privateFor(restaurantId) {
      const entry = restaurants.get(restaurantId);
      if (!entry) return null;
      return {
        activeFocusId: entry.activeFocusId,
        cooldownForMs: Math.max(0, entry.cooldownEndsAtMs - match.elapsedMs),
        selectionsByFocus: { ...entry.selectionsByFocus },
        ...buildOverview(match, restaurantId),
      };
    },
  };
  return match._kitchenCommandState;
}

export const kitchenCommandSystem = {
  id: 'kitchen_command',
  phases: ['service', 'final_rush'],
  update(match) { ensure(match); },
  onPhaseChange(match, transition) { if (transition.to === 'service') ensure(match); },
};

export const _internal = { ensure, ticketMetrics, buildOverview, recommendationFor };
