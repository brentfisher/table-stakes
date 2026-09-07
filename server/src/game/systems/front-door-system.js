// STORY-032. Authoritative state for the Maitre d' command post. Activation and customer
// effects are added through this facade; the client only receives the compact public view.
import specialsData from '../../../../shared/game-data/front-door-specials.json' with { type: 'json' };

const SPECIAL_BY_ID = new Map(specialsData.specials.map((special) => [special.id, special]));

function ensure(match) {
  if (match._frontDoorState) return match._frontDoorState;
  const restaurants = new Map([...match.players.keys()].map((id) => [id, { activeSpecialId: null, endsAtMs: 0, cooldownEndsAtMs: 0, spent: 0 }]));
  const state = { restaurants };
  match._frontDoorState = state;
  match.frontDoor = {
    special(id) { return SPECIAL_BY_ID.get(id) ?? null; },
    activeSpecial(id) {
      const entry = restaurants.get(id);
      return entry?.activeSpecialId ? SPECIAL_BY_ID.get(entry.activeSpecialId) ?? null : null;
    },
    stateFor(id) { return restaurants.get(id) ?? null; },
    spentFor(id) { return restaurants.get(id)?.spent ?? 0; },
    activate(id, specialId) {
      const entry = restaurants.get(id); const special = SPECIAL_BY_ID.get(specialId);
      if (!entry || !special) return { ok: false, reason: 'unknown_special' };
      if (entry.activeSpecialId || match.elapsedMs < entry.cooldownEndsAtMs) return { ok: false, reason: 'special_unavailable' };
      if ((match.upgrades?.cashAvailable(id) ?? 0) < special.cost) return { ok: false, reason: 'insufficient_cash' };
      entry.spent += special.cost; entry.activeSpecialId = special.id; entry.endsAtMs = match.elapsedMs + special.durationMs; entry.cooldownEndsAtMs = entry.endsAtMs + special.cooldownMs;
      return { ok: true };
    },
    publicFor(id) {
      const stateFor = restaurants.get(id);
      if (!stateFor) return { activeSpecialId: null, activeForMs: 0, cooldownForMs: 0 };
      return {
        activeSpecialId: stateFor.activeSpecialId,
        activeForMs: Math.max(0, stateFor.endsAtMs - match.elapsedMs),
        cooldownForMs: Math.max(0, stateFor.cooldownEndsAtMs - match.elapsedMs),
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
      if (entry.activeSpecialId && match.elapsedMs >= entry.endsAtMs) entry.activeSpecialId = null;
    }
  },
  onPhaseChange(match, transition) {
    if (transition.to === 'service') ensure(match);
  },
};
