// STORY-032. Authoritative state for the Maitre d' command post. Activation and customer
// effects are added through this facade; the client only receives the compact public view.
import specialsData from '../../../../shared/game-data/front-door-specials.json' with { type: 'json' };
import { catalogue } from '../catalogue.js';
import { dishDemandMultiplier } from './event-system.js';

const SPECIAL_BY_ID = new Map(specialsData.specials.map((special) => [special.id, special]));

function featuredDishFor(match, restaurantId) {
  const player = match.players.get(restaurantId);
  const slots = [...(player?.setup?.menu ?? []), ...(player?.setup?.addons ?? [])];
  const available = slots
    .map((slot) => catalogue.dishesById[slot.dishId])
    .filter((dish) => dish && match.dishAvailability?.[restaurantId]?.[dish.id] !== false);
  if (available.length === 0) return null;
  return available.reduce((best, dish) =>
    dishDemandMultiplier(match.eventEffects, dish.tags) > dishDemandMultiplier(match.eventEffects, best.tags)
      ? dish
      : best,
  ).id;
}

function isEligible(match, restaurantId, special) {
  const marketId = match.market?.id;
  const activeEvent = (match.events ?? []).some((event) => event.state === 'active');
  const queueLength = (match.restaurants ?? []).find((restaurant) => restaurant.restaurantId === restaurantId)?.queueLength ?? 0;
  switch (special.eligibility) {
    case 'office_rush': return marketId === 'downtown_lunch';
    case 'price_sensitive_wave': return marketId === 'downtown_lunch' || marketId === 'stadium_district';
    case 'pre_theater_couples': return marketId === 'uptown_pre_theater';
    case 'stadium_wave': return marketId === 'stadium_district';
    case 'active_event': return activeEvent;
    case 'long_queue': return queueLength >= 3;
    default: return false;
  }
}

function ensure(match) {
  if (match._frontDoorState) return match._frontDoorState;
  const restaurants = new Map([...match.players.keys()].map((id) => [id, { activeSpecialId: null, featuredDishId: null, endsAtMs: 0, cooldownEndsAtMs: 0, spent: 0 }]));
  const state = { restaurants };
  match._frontDoorState = state;
  match.frontDoor = {
    special(id) { return SPECIAL_BY_ID.get(id) ?? null; },
    activeSpecial(id) {
      const entry = restaurants.get(id);
      return entry?.activeSpecialId ? SPECIAL_BY_ID.get(entry.activeSpecialId) ?? null : null;
    },
    featuredDishId(id) { return restaurants.get(id)?.featuredDishId ?? null; },
    stateFor(id) { return restaurants.get(id) ?? null; },
    spentFor(id) { return restaurants.get(id)?.spent ?? 0; },
    eligibleSpecialIds(id) { return specialsData.specials.filter((special) => isEligible(match, id, special)).map((special) => special.id); },
    activate(id, specialId) {
      const entry = restaurants.get(id); const special = SPECIAL_BY_ID.get(specialId);
      if (!entry || !special) return { ok: false, reason: 'unknown_special' };
      if (!isEligible(match, id, special)) return { ok: false, reason: 'special_ineligible' };
      if (entry.activeSpecialId || match.elapsedMs < entry.cooldownEndsAtMs) return { ok: false, reason: 'special_unavailable' };
      if ((match.upgrades?.cashAvailable(id) ?? 0) < special.cost) return { ok: false, reason: 'insufficient_cash' };
      const featuredDishId = special.id === 'chefs_feature' ? featuredDishFor(match, id) : null;
      if (special.id === 'chefs_feature' && !featuredDishId) return { ok: false, reason: 'no_available_dish' };
      entry.spent += special.cost; entry.activeSpecialId = special.id; entry.featuredDishId = featuredDishId; entry.endsAtMs = match.elapsedMs + special.durationMs; entry.cooldownEndsAtMs = entry.endsAtMs + special.cooldownMs;
      return { ok: true };
    },
    publicFor(id) {
      const stateFor = restaurants.get(id);
      if (!stateFor) return { activeSpecialId: null, featuredDishId: null, activeForMs: 0, cooldownForMs: 0, eligibleSpecialIds: [] };
      return {
        activeSpecialId: stateFor.activeSpecialId,
        featuredDishId: stateFor.featuredDishId,
        activeForMs: Math.max(0, stateFor.endsAtMs - match.elapsedMs),
        cooldownForMs: Math.max(0, stateFor.cooldownEndsAtMs - match.elapsedMs),
        eligibleSpecialIds: this.eligibleSpecialIds(id),
      };
    },
  };
  return state;
}

export const frontDoorSystem = {
  id: 'front_door',
  phases: ['service', 'final_rush'],
  update(match) {
    const state = ensure(match);
    for (const entry of state.restaurants.values()) {
      if (entry.activeSpecialId && match.elapsedMs >= entry.endsAtMs) {
        entry.activeSpecialId = null;
        entry.featuredDishId = null;
      }
    }
  },
  onPhaseChange(match, transition) {
    if (transition.to === 'service') ensure(match);
  },
};
