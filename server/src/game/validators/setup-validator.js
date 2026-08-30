// The authority on whether a `setup_submit` is legal. PRD §7 "Setup phase", §12 "Server
// authority", Milestone 0 Decision 2.
//
// THE POINT OF THIS FILE: the setup screen greys out illegal options, and none of that
// counts. A browser can send anything. Every rule the client enforces for UX is re-derived
// here, from the catalogue and the layout, against a message this module assumes is hostile.
// Decision 2 names `server/src/game/validators/` as where a player action gets its authority
// check; this is the first inhabitant of that directory.
//
// SEPARATION FROM `shared/schemas/validation.js` (Decision 11): that module answers "is this a
// well-formed setup_submit" — arrays where arrays belong, numbers where numbers belong. This
// one answers "is this menu legal", which needs the dish catalogue, the restaurant layout and
// the player's cash. The rules both sides of the wire must agree on (price bounds,
// producibility, add-on categories) live in `shared/schemas/setup-rules.js` so the client can
// import the same functions instead of reimplementing them and drifting.
//
// A REJECTION MUTATES NOTHING. Validation is a pure function over the message and the
// catalogue; `acceptSetupSubmission` is the only thing that touches the match, and it only
// runs after a clean `{ok: true}`.
//
// ---------------------------------------------------------------------------------------
// STORY-006 BOUNDARY. The starting inventory allocation is validated, priced and stored, and
// then read by nobody: STORY-006 owns the inventory MODEL — depletion, spoilage, restocking,
// what happens when a dish's ingredient runs out. Until it lands, `startingInventory` is a
// priced bag of units on the accepted submission, and the `inventory_over_budget` rule this
// story's acceptance criteria require is enforced here regardless. When 006 lands it should
// seed its per-restaurant inventory from `player.setup.startingInventory` and change nothing
// about this validator.
// ---------------------------------------------------------------------------------------

import {
  STARTING_CASH,
  STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT,
} from '../../../../shared/constants/tuning.js';
import { MENU_ADDON_SLOTS, MENU_MAIN_SLOTS } from '../../../../shared/schemas/messages.js';
import {
  inventoryCost,
  isAddonCategory,
  isPriceInRange,
  isProducible,
  missingStationsFor,
  priceBoundsFor,
  rosterOf,
  selectableMains,
  toCents,
} from '../../../../shared/schemas/setup-rules.js';
import { catalogue as shippedCatalogue } from '../catalogue.js';

const reject = (reason, detail) => ({ ok: false, reason, detail });

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Resolve the data this validation runs against. The defaults are the real shipped catalogue
 * and the real layout; the options exist so a check script can hand in a layout with the
 * grill torn out. Every dish that ships IS producible in the shipped layout — loader.js makes
 * sure of it — so the PRD §7 "physically producible" rule would otherwise be a rule with no
 * way to demonstrate that it works.
 */
function resolveContext({ catalogue = shippedCatalogue, layout, startingCash } = {}) {
  return {
    catalogue,
    layout: layout ?? catalogue.layout,
    startingCash: Number.isFinite(startingCash) ? startingCash : STARTING_CASH,
  };
}

/**
 * Is this submission legal? Pure — it reads the message and the catalogue and touches nothing.
 *
 * @returns {{ok: true, submission: object} | {ok: false, reason: string, detail: string}}
 *          `reason` is a member of SETUP_REJECTION_REASONS in setup-rules.js.
 */
export function validateSetupSubmission(message, options = {}) {
  const { catalogue, layout, startingCash } = resolveContext(options);
  const phase = options.phase ?? 'setup';

  // PRD §7: "Players can alter the menu only during setup in MVP", and §20 puts dynamic menu
  // changes during service out of scope. The phase check is here rather than only in the
  // router so that no future caller can route around it.
  if (phase !== 'setup') {
    return reject('wrong_phase', `setup_submit is only accepted during setup, not ${phase}`);
  }

  if (!isPlainObject(message)) return reject('malformed_submission', 'not an object');
  const mains = message.menu;
  const addons = message.addons ?? [];
  if (!Array.isArray(mains)) return reject('malformed_submission', 'menu must be an array');
  if (!Array.isArray(addons)) return reject('malformed_submission', 'addons must be an array');
  if (!isPlainObject(message.staffAssignments)) {
    return reject('malformed_submission', 'staffAssignments must be an object');
  }

  // --- 1. slot counts, PRD §7 "Menu constraints" -----------------------------------------
  // "Players choose 3 main dishes" — exactly three, which is stricter than validation.js's
  // shape check (at most three). The exact count is a legality rule, so it lives here.
  if (mains.length !== MENU_MAIN_SLOTS) {
    return reject(
      'wrong_main_count',
      `exactly ${MENU_MAIN_SLOTS} main dishes are required, got ${mains.length}`,
    );
  }
  if (addons.length > MENU_ADDON_SLOTS) {
    return reject(
      'too_many_addons',
      `at most ${MENU_ADDON_SLOTS} add-ons are allowed, got ${addons.length}`,
    );
  }

  // --- 2. every slot: known, unique, right kind, producible, priced in range -------------
  const seen = new Set();
  const normalize = (slots, kind) => {
    const out = [];
    for (const [i, slot] of slots.entries()) {
      const at = `${kind === 'main' ? 'menu' : 'addons'}[${i}]`;
      if (!isPlainObject(slot)) return reject('malformed_submission', `${at} must be an object`);

      const dish = catalogue.dishesById[slot.dishId];
      if (!dish) return reject('unknown_dish', `${at}: no dish "${slot.dishId}" in the catalogue`);
      if (seen.has(dish.id)) {
        return reject('duplicate_dish', `${at}: "${dish.id}" already occupies another slot`);
      }
      seen.add(dish.id);

      // PRD §7: add-ons are "drinks, desserts, or sides". A main is anything that is not one
      // of those — NOT "entrees only": PRD §12's own setup_submit example puts `nachos`
      // (category `snack`) in `menu[]`, and a rule that rejects the PRD's example is wrong.
      if (kind === 'addon' && !isAddonCategory(dish.category)) {
        return reject(
          'invalid_addon_category',
          `${at}: "${dish.id}" is a ${dish.category}; add-ons are drinks, desserts or sides`,
        );
      }
      if (kind === 'main' && isAddonCategory(dish.category)) {
        return reject(
          'invalid_main_category',
          `${at}: "${dish.id}" is a ${dish.category} and belongs in an add-on slot`,
        );
      }

      // PRD §7 "Menu constraints": "Every dish must be physically producible by a station in
      // the restaurant." Checked against the layout's actual station entities, not a list.
      if (!isProducible(dish, layout)) {
        return reject(
          'dish_not_producible',
          `${at}: "${dish.id}" needs station(s) ${missingStationsFor(dish, layout).join(', ')}, ` +
            `which layout "${layout?.id}" does not have`,
        );
      }

      // PRD §7 "Pricing": within a bounded range derived from the dish's suggested price.
      if (!isPriceInRange(dish, slot.price)) {
        const bounds = priceBoundsFor(dish);
        return reject(
          'price_out_of_range',
          `${at}: ${slot.price} is outside ${bounds.minPrice}-${bounds.maxPrice} for "${dish.id}"`,
        );
      }

      out.push({ dishId: dish.id, price: toCents(slot.price) });
    }
    return out;
  };

  const normalizedMains = normalize(mains, 'main');
  if (!Array.isArray(normalizedMains)) return normalizedMains;
  const normalizedAddons = normalize(addons, 'addon');
  if (!Array.isArray(normalizedAddons)) return normalizedAddons;

  // --- 3. the opening upgrade, PRD §7 item 6 ---------------------------------------------
  const upgradeId = message.startingUpgradeId ?? null;
  let upgradeCost = 0;
  if (upgradeId !== null) {
    const upgrade = catalogue.upgradesById[upgradeId];
    if (!upgrade) return reject('unknown_upgrade', `no upgrade "${upgradeId}" in the catalogue`);
    // Affordability is checked on the upgrade ALONE before the allocation is added in, so
    // that an unaffordable upgrade reports itself rather than hiding behind a budget error.
    if (upgrade.cost > startingCash) {
      return reject(
        'upgrade_unaffordable',
        `"${upgradeId}" costs ${upgrade.cost}, starting cash is ${startingCash}`,
      );
    }
    upgradeCost = upgrade.cost;
  }

  // --- 4. the starting inventory allocation, PRD §7 item 3 --------------------------------
  const allocation = message.startingInventory ?? {};
  if (!isPlainObject(allocation)) {
    return reject('malformed_submission', 'startingInventory must be an object');
  }
  const normalizedInventory = {};
  for (const [ingredientId, units] of Object.entries(allocation)) {
    if (!catalogue.ingredients[ingredientId]) {
      return reject(
        'unknown_ingredient',
        `no ingredient "${ingredientId}" in dishes.json \`ingredients\``,
      );
    }
    if (!Number.isInteger(units) || units < 0) {
      return reject(
        'invalid_inventory_quantity',
        `startingInventory.${ingredientId} must be a non-negative integer, got ${units}`,
      );
    }
    if (units > STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT) {
      return reject(
        'invalid_inventory_quantity',
        `startingInventory.${ingredientId} exceeds the per-ingredient cap of ` +
          `${STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT}`,
      );
    }
    if (units > 0) normalizedInventory[ingredientId] = units;
  }

  const stockCost = inventoryCost(normalizedInventory, catalogue.ingredients);
  if (stockCost === null) return reject('unknown_ingredient', 'allocation names a priceless id');
  const totalCost = toCents(stockCost + upgradeCost);
  if (totalCost > startingCash) {
    return reject(
      'inventory_over_budget',
      `allocation (${stockCost}) plus upgrade (${upgradeCost}) is ${totalCost}, ` +
        `over the starting cash of ${startingCash}`,
    );
  }

  // --- 5. worker station assignments, PRD §7 "Staffing setup" -----------------------------
  const roster = rosterOf(layout);
  const rosterById = new Map(roster.map((worker) => [worker.id, worker]));
  for (const [workerId, post] of Object.entries(message.staffAssignments)) {
    const worker = rosterById.get(workerId);
    if (!worker) {
      return reject('unknown_worker', `no worker "${workerId}" on this restaurant's roster`);
    }
    if (!worker.posts.includes(post)) {
      return reject(
        'invalid_station_assignment',
        `"${workerId}" cannot work "${post}" — allowed: ${worker.posts.join(', ')}`,
      );
    }
  }
  for (const worker of roster) {
    if (!Object.prototype.hasOwnProperty.call(message.staffAssignments, worker.id)) {
      return reject('worker_unassigned', `"${worker.id}" has no post; every worker needs one`);
    }
  }

  // --- 6. the optional policy/perk, PRD §7 "Initial policies/perks" ------------------------
  const policyId = message.policyId ?? null;
  let policyDishId = null;
  if (policyId !== null) {
    const policy = catalogue.policiesById[policyId];
    if (!policy) return reject('unknown_policy', `no policy "${policyId}" in policies.json`);
    if (policy.requiresMenuDish) {
      const target = message.policyDishId ?? null;
      if (target === null || !seen.has(target)) {
        return reject(
          'invalid_policy_target',
          `"${policyId}" applies to one dish on your menu; "${target}" is not on it`,
        );
      }
      policyDishId = target;
    }
  }

  return {
    ok: true,
    submission: {
      menu: normalizedMains,
      addons: normalizedAddons,
      startingUpgradeId: upgradeId,
      staffAssignments: { ...message.staffAssignments },
      startingInventory: normalizedInventory,
      policyId,
      policyDishId,
      upgradeCost,
      inventoryCost: stockCost,
      cashRemaining: toCents(startingCash - totalCost),
      submittedAtMs: 0,
      locked: false,
      autoFilled: false,
    },
  };
}

/**
 * Validate a submission against a live match and, only if it is legal, store it on the player
 * and mark them ready.
 *
 * READINESS. Design Decision 19 kept `player_ready` a separate message so STORY-003 would not
 * have to half-implement `setup_submit` to extract a readiness bit. That argument is about
 * accepting a message and ignoring most of it; this module validates the whole thing, and the
 * story's acceptance criteria say "submitting marks the player ready". `player_ready` remains
 * an independent message a player can still use to un-ready.
 */
export function acceptSetupSubmission(match, playerId, message, options = {}) {
  const player = match?.players?.get(playerId);
  if (!player) return reject('malformed_submission', `no player "${playerId}" in this match`);
  if (match.ended) return reject('wrong_phase', 'the match has ended');

  // PRD §7/§20: the menu is immutable once service starts. `locked` is set by setup-system.js
  // at the setup -> service transition, so a submission arriving after it is refused even if
  // the phase check somehow let it through.
  if (player.setup?.locked) {
    return reject('wrong_phase', 'the menu is locked; it cannot be changed after service begins');
  }

  const result = validateSetupSubmission(message, { ...options, phase: match.phase });
  if (!result.ok) return result;

  // Nothing above this line has touched the match.
  result.submission.submittedAtMs = Math.round(match.elapsedMs);
  player.setup = result.submission;
  match.setReady(playerId, true);
  return result;
}

/**
 * A legal submission for a player who never sent one. PRD §5 lets the setup phase end on the
 * timer, so this case is normal, not exceptional — and every later system (orders, customer
 * choice, scoring) needs a menu to exist for both restaurants.
 *
 * Deterministic and content-derived: the first `MENU_MAIN_SLOTS` producible mains in catalogue
 * order at their own suggested prices, no add-ons, no upgrade, no policy, an empty pantry, and
 * each worker at the first post it is allowed to take. It is deliberately unambitious — an
 * idle player should get a working restaurant, not a good one — and it is put through
 * `validateSetupSubmission` like any other submission so it can never be the one illegal menu
 * in the match.
 */
export function defaultSubmission(options = {}) {
  const { catalogue, layout, startingCash } = resolveContext(options);
  const mains = selectableMains(catalogue.dishes, layout).slice(0, MENU_MAIN_SLOTS);
  const message = {
    type: 'setup_submit',
    menu: mains.map((dish) => ({ dishId: dish.id, price: dish.suggestedPrice })),
    addons: [],
    startingUpgradeId: null,
    staffAssignments: Object.fromEntries(
      rosterOf(layout).map((worker) => [worker.id, worker.posts[0]]),
    ),
    startingInventory: {},
    policyId: null,
  };

  const result = validateSetupSubmission(message, { catalogue, layout, startingCash });
  if (!result.ok) {
    // The catalogue cannot produce three producible mains for this layout. That is a content
    // problem, and a match cannot run without a menu, so say so loudly rather than starting
    // service with an empty restaurant.
    throw new Error(
      `defaultSubmission: cannot build a legal fallback menu (${result.reason}: ${result.detail})`,
    );
  }
  result.submission.autoFilled = true;
  return result.submission;
}
