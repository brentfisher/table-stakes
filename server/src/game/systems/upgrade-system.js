// The owner's terminal purchase. PRD §10 "Upgrades": spending cash costs time and attention,
// because it can only happen at the physical `upgrade_terminal`, walked to like any other §8
// interaction. This module is the authority `action-validator.js#handlePurchaseUpgrade` calls
// into — it never receives a network message itself.
//
// SCOPE: `shared/game-data/upgrades.json` carries 11 catalogue entries; only the 5 named in
// `KNOWN_EFFECT_KEYS` below have a system that reads their effect. A purchase of any other
// entry is REJECTED `effect_not_implemented` rather than silently accepted-with-no-effect or
// silently charged — the same Decision 7 discipline `shared/schemas/messages.js` applies to a
// declared-but-unimplemented message type, applied here to a declared-but-unimplemented effect
// key. A later story that wires `prep_counter_1`'s `stationConcurrentCapacity` only has to add
// that key here; it does not have to touch the purchase flow.
//
// CASH IS DERIVED, NEVER STORED. `cashAvailable` is `cashRemaining` (frozen at setup) plus
// `kitchen.revenueFor()` (STORY-005's append-only ledger) minus this restaurant's own running
// `cashSpent`. A stored running balance would have to be kept in sync with revenue on every
// paid order; deriving it fresh each read cannot drift, and this is not a hot path.

import { OWNER_CARRY_CAPACITY } from '../../../../shared/constants/tuning.js';
import { catalogue } from '../catalogue.js';

const toCents = (value) => Math.round(value * 100) / 100;

/** Every `effects` key a live system actually reads. See the module header — an upgrade whose
 * `effects` names any OTHER key is legal catalogue data but an illegal purchase. */
const KNOWN_EFFECT_KEYS = new Set([
  'ownerCarryCapacity',
  'stationSpeedMultipliers',
  'seatedPatienceMultiplier',
  'restockTravelTimeMultiplier',
]);

function fail(reason, detail) {
  return { ok: false, reason, detail };
}

function effectsAreKnown(upgrade) {
  return Object.keys(upgrade.effects).every((key) => KNOWN_EFFECT_KEYS.has(key));
}

/** The "meaningful" upgrades §24's affordability hypothesis is about — every catalogue entry
 * this file actually wires an effect for. Derived from the catalogue rather than a second
 * hardcoded id list, so it can never drift from `KNOWN_EFFECT_KEYS` above. */
const WIRED_UPGRADES = Object.values(catalogue.upgradesById).filter(effectsAreKnown);

/** Whether at least one wired upgrade this restaurant does not yet own — and whose tier
 * prerequisite, if any, it already does — costs no more than `cash`. PRD §24's "a healthy
 * restaurant can afford a MEANINGFUL upgrade", not literally any catalogue entry. */
function canAffordSomethingNew(owned, cash) {
  return WIRED_UPGRADES.some(
    (u) => !owned.has(u.id) && (!u.requires || owned.has(u.requires)) && u.cost <= cash,
  );
}

/** Folds every upgrade this restaurant owns into one resolved effects object. `ownerCarryCapacity`
 * is a capacity ceiling, not a rate, so it takes the MAX across owned tiers (serving_tray_2's 3
 * already implies serving_tray_1's 2 via `requires`, but MAX is correct even if that ever
 * changes). Every other known key is a multiplier and multiplies together. */
function resolveEffects(owned) {
  const effects = {
    ownerCarryCapacity: OWNER_CARRY_CAPACITY,
    stationSpeedMultipliers: {},
    seatedPatienceMultiplier: 1,
    restockTravelTimeMultiplier: 1,
  };
  for (const upgradeId of owned) {
    const upgrade = catalogue.upgradesById[upgradeId];
    if (!upgrade) continue;
    for (const [key, value] of Object.entries(upgrade.effects)) {
      if (key === 'ownerCarryCapacity') {
        effects.ownerCarryCapacity = Math.max(effects.ownerCarryCapacity, value);
      } else if (key === 'stationSpeedMultipliers') {
        for (const [station, multiplier] of Object.entries(value)) {
          effects.stationSpeedMultipliers[station] = (effects.stationSpeedMultipliers[station] ?? 1) * multiplier;
        }
      } else if (key === 'seatedPatienceMultiplier') {
        effects.seatedPatienceMultiplier *= value;
      } else if (key === 'restockTravelTimeMultiplier') {
        effects.restockTravelTimeMultiplier *= value;
      }
      // An unknown key never reaches here: `purchase()` rejects it before it is ever owned.
    }
  }
  return effects;
}

function ensureState(match) {
  if (!match._upgradeSimState) {
    const state = { restaurants: new Map() };
    for (const player of match.players.values()) {
      state.restaurants.set(player.playerId, {
        owned: new Set(),
        cashSpent: 0,
        // PRD §24 "a healthy restaurant can afford a meaningful upgrade roughly every 60-120
        // seconds" — the elapsed-ms timestamp of every tick this restaurant newly became able
        // to afford at least one wired upgrade it doesn't already own. Logged at `results`.
        affordableAtMs: [],
        wasAffordable: false,
      });
    }
    match._upgradeSimState = state;
    match.upgrades = createUpgradeFacade(match, state);
  }
  return match._upgradeSimState;
}

function createUpgradeFacade(match, state) {
  return {
    ownedUpgrades(restaurantId) {
      const restaurant = state.restaurants.get(restaurantId);
      return restaurant ? [...restaurant.owned].sort() : [];
    },

    ownerCarryCapacity(restaurantId) {
      const restaurant = state.restaurants.get(restaurantId);
      if (!restaurant) return OWNER_CARRY_CAPACITY;
      return resolveEffects(restaurant.owned).ownerCarryCapacity;
    },

    stationSpeedMultiplier(restaurantId, station) {
      const restaurant = state.restaurants.get(restaurantId);
      if (!restaurant) return 1;
      const value = resolveEffects(restaurant.owned).stationSpeedMultipliers[station];
      return Number.isFinite(value) && value > 0 ? value : 1;
    },

    seatedPatienceMultiplier(restaurantId) {
      const restaurant = state.restaurants.get(restaurantId);
      return restaurant ? resolveEffects(restaurant.owned).seatedPatienceMultiplier : 1;
    },

    restockTravelTimeMultiplier(restaurantId) {
      const restaurant = state.restaurants.get(restaurantId);
      return restaurant ? resolveEffects(restaurant.owned).restockTravelTimeMultiplier : 1;
    },

    /** STORY-013 (PRD §11 "Expenses"/"Net profit"). Cash spent on upgrades bought DURING
     * service — distinct from `player.setup.upgradeCost`, which is the STARTING upgrade chosen
     * at setup and is already folded into `cashRemaining` there. `scoring-system.js` adds the
     * two together. */
    cashSpentOnUpgrades(restaurantId) {
      return state.restaurants.get(restaurantId)?.cashSpent ?? 0;
    },

    /** Starting cash plus revenue earned so far, minus every upgrade bought. See the module
     * header — this is computed fresh every call, never stored. */
    cashAvailable(restaurantId) {
      const restaurant = state.restaurants.get(restaurantId);
      const player = match.players.get(restaurantId);
      const startingCash = player?.setup?.cashRemaining ?? 0;
      const revenue = match.kitchen?.revenueFor(restaurantId) ?? 0;
      const spent = restaurant?.cashSpent ?? 0;
      return toCents(startingCash + revenue - spent);
    },

    /**
     * The one mutating call. `action-validator.js#handlePurchaseUpgrade` is the only caller —
     * range and phase are ITS job, exactly as `kitchen.startTicket`/`floor.seatParty` leave
     * range checking to `action-validator.js` and only validate what they themselves own.
     *
     * @returns {{ok: true} | {ok: false, reason: string, detail?: string}}
     */
    purchase(restaurantId, upgradeId) {
      const restaurant = state.restaurants.get(restaurantId);
      if (!restaurant) return fail('unknown_restaurant');
      const upgrade = catalogue.upgradesById[upgradeId];
      if (!upgrade) return fail('unknown_upgrade', upgradeId);
      if (restaurant.owned.has(upgradeId)) return fail('already_owned', upgradeId);
      if (!effectsAreKnown(upgrade)) return fail('effect_not_implemented', upgradeId);
      if (upgrade.requires && !restaurant.owned.has(upgrade.requires)) {
        return fail('prerequisite_missing', `"${upgradeId}" requires "${upgrade.requires}"`);
      }
      const available = this.cashAvailable(restaurantId);
      if (available < upgrade.cost) {
        return fail('insufficient_cash', `"${upgradeId}" costs ${upgrade.cost}, available is ${available}`);
      }
      restaurant.owned.add(upgradeId);
      restaurant.cashSpent = toCents(restaurant.cashSpent + upgrade.cost);
      return { ok: true };
    },
  };
}

export const upgradeSystem = {
  id: 'upgrades',
  phases: ['service', 'final_rush'],

  update(match) {
    const state = ensureState(match);
    const effects = {};
    for (const [restaurantId, restaurant] of state.restaurants) {
      effects[restaurantId] = resolveEffects(restaurant.owned);

      // PRD §24 affordability cadence — a rising-edge sample, not a level check: a restaurant
      // that has been able to afford something for the last ten minutes is one event, not one
      // every tick.
      const affordableNow = canAffordSomethingNew(restaurant.owned, match.upgrades.cashAvailable(restaurantId));
      if (affordableNow && !restaurant.wasAffordable) restaurant.affordableAtMs.push(match.elapsedMs);
      restaurant.wasAffordable = affordableNow;
    }
    match.upgradeEffects = effects;
  },

  onPhaseChange(match, transition) {
    if (transition.to === 'service') {
      const state = ensureState(match);
      for (const [restaurantId, player] of match.players) {
        const startingId = player.setup?.startingUpgradeId;
        // Cost already deducted into `cashRemaining` at setup (setup-validator.js) — owning it
        // here is free.
        if (startingId && catalogue.upgradesById[startingId]) {
          state.restaurants.get(restaurantId).owned.add(startingId);
        }
      }
      return;
    }
    if (transition.to !== 'results') return;
    if (match._upgradeSimState) {
      for (const [restaurantId, restaurant] of match._upgradeSimState.restaurants) {
        const events = restaurant.affordableAtMs;
        const intervals = events.slice(1).map((t, i) => t - events[i]);
        const meanIntervalMs =
          intervals.length > 0 ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : null;
        console.log(
          `[upgrades] ${match.id} ${restaurantId} affordable-again events=${events.length} ` +
            `at=[${events.join(',')}]ms ` +
            `meanIntervalMs=${meanIntervalMs ?? 'n/a'} (§24 target 60000-120000ms)`,
        );
      }
    }
    // STORY-013 (PRD §11 "Upgrades purchased"). Must outlive this system's own teardown below —
    // same "outlives its own teardown" pattern as customer-system.js's `match.districtSummary`
    // and order-system.js's `match.orderSummary`. `scoring-system.js`, registered last, reads
    // this at its own `results` handler.
    if (match._upgradeSimState) {
      match.upgradeSummary = [...match._upgradeSimState.restaurants.keys()].map((restaurantId) => ({
        restaurantId,
        purchasedUpgradeIds: [...match._upgradeSimState.restaurants.get(restaurantId).owned],
        cashSpentOnUpgrades: match._upgradeSimState.restaurants.get(restaurantId).cashSpent,
      }));
    }
    match._upgradeSimState = undefined;
    match.upgrades = undefined;
    match.upgradeEffects = undefined;
  },
};

/** Exported for `scripts/check-upgrades.mjs` ONLY, exactly as every sibling system's
 * `_internal` is — a way to force a specific branch deterministically. */
export const _internal = { ensureState, resolveEffects, KNOWN_EFFECT_KEYS };
