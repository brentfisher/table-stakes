#!/usr/bin/env node
// Setup-phase check — the executable acceptance criteria for STORY-009.
//
// The repo has no test framework (Milestone 0 Decision 8), so this is a runnable script. Most
// of it runs IN PROCESS, the way scripts/check-match-lifecycle.mjs does: setup is a validator
// story, and a validator is checkable by calling it with a hostile message rather than by
// pushing that message through a socket. That buys the two things a wire test cannot have —
// every rejection reason exercised in milliseconds, and an injectable layout with the grill
// torn out, without which the PRD §7 "physically producible" rule cannot be demonstrated at
// all (loader.js guarantees every shipped dish is producible in the shipped layout).
//
// The last section DOES use a real server and two real sockets, because one criterion is
// about the bytes a client receives: "the opponent's menu and prices are not present anywhere
// in the client's received data during setup". That is a claim about a serialized payload, and
// it is checked here by grepping the JSON both clients actually received.
//
// It starts its own server on the port below and kills only that child, in a `finally`.
//
// Run: node scripts/check-setup-phase.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveBase, startServer } from './lib/server-process.mjs';
import { Match } from '../server/src/game/match.js';
import { clearSystems, registerSystem, stepMatch } from '../server/src/game/simulation-loop.js';
import { setupSystem } from '../server/src/game/systems/setup-system.js';
import {
  acceptSetupSubmission,
  defaultSubmission,
  validateSetupSubmission,
} from '../server/src/game/validators/setup-validator.js';
import { catalogue } from '../server/src/game/catalogue.js';
import {
  ERROR_CODES,
  IMPLEMENTED_CLIENT_MESSAGE_TYPES,
  MENU_ADDON_SLOTS,
  MENU_MAIN_SLOTS,
} from '../shared/schemas/messages.js';
import { validateClientMessage } from '../shared/schemas/validation.js';
import {
  PRICE_GUIDANCE_LABELS,
  PRICE_GUIDANCE_LABEL_LIST,
  SETUP_REJECTION_REASONS,
  priceBoundsFor,
  priceGuidance,
  selectableAddons,
  selectableMains,
} from '../shared/schemas/setup-rules.js';
import {
  STARTING_CASH,
  STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT,
} from '../shared/constants/tuning.js';

const target = resolveBase(3317);
const BASE = target.base;
const WS_URL = `${BASE.replace('http', 'ws')}/ws`;

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The match and the systems log every transition. Useful when running the server, noise here.
const realLog = console.log;
function quiet(fn) {
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = realLog;
  }
}

const layout = catalogue.layout;
const dish = (id) => catalogue.dishesById[id];

/** A legal submission, so each test can break exactly one thing about it. */
function goodSubmission(overrides = {}) {
  return {
    type: 'setup_submit',
    menu: [
      { dishId: 'smash_burger', price: 14 },
      { dishId: 'chicken_sandwich', price: 13 },
      { dishId: 'nachos', price: 16 },
    ],
    addons: [{ dishId: 'espresso', price: 5 }],
    startingUpgradeId: 'serving_tray_1',
    staffAssignments: { cook_1: 'grill', server_1: 'dining_room' },
    startingInventory: { beef: 20, bun: 20, cheese: 20, lettuce: 10 },
    policyId: 'friendly_staff',
    ...overrides,
  };
}

/** The shipped layout with one station entity removed, for the producibility rule. */
function layoutWithout(station) {
  return {
    ...layout,
    entities: layout.entities.filter((e) => !(e.type === 'station' && e.station === station)),
  };
}

console.log('Setup phase check\n');

// --- 1. the protocol admits setup_submit, in the same commit as its handler --------------
check(
  'setup_submit is in IMPLEMENTED_CLIENT_MESSAGE_TYPES and setup_rejected in ERROR_CODES',
  IMPLEMENTED_CLIENT_MESSAGE_TYPES.includes('setup_submit') &&
    ERROR_CODES.includes('setup_rejected'),
  `implemented=[${IMPLEMENTED_CLIENT_MESSAGE_TYPES.join(', ')}]`,
);

// --- 2. the PRD §12 example is legal, not merely well-formed -----------------------------
{
  const prdExample = {
    type: 'setup_submit',
    menu: [
      { dishId: 'smash_burger', price: 14 },
      { dishId: 'chicken_sandwich', price: 13 },
      { dishId: 'nachos', price: 16 },
    ],
    addons: [{ dishId: 'espresso', price: 5 }],
    startingUpgradeId: 'serving_tray_1',
    staffAssignments: { cook_1: 'grill', server_1: 'dining_room' },
  };
  const shape = validateClientMessage(prdExample);
  const authority = validateSetupSubmission(prdExample);
  check(
    'the PRD §12 setup_submit example passes BOTH the shape check and the authority check',
    shape.ok === true && authority.ok === true,
    authority.ok ? 'accepted verbatim' : `${authority.reason}: ${authority.detail}`,
  );
  check(
    'a `snack` in menu[] is a legal main — PRD §12 puts nachos there, so "entrees only" is wrong',
    authority.ok === true && catalogue.dishesById.nachos.category === 'snack',
    `nachos.category=${catalogue.dishesById.nachos.category}`,
  );
  check(
    'the §12 example carries no startingInventory or policyId, and is accepted anyway',
    !('startingInventory' in prdExample) && !('policyId' in prdExample) && authority.ok === true,
    'every STORY-009 field on setup_submit is optional (Decision 7: widen, never rename)',
  );
}

// --- 3. every rejection reason, exercised -------------------------------------------------
const seenReasons = new Set();
function rejects(label, message, expectedReason, options = {}) {
  const result = validateSetupSubmission(message, options);
  if (!result.ok) seenReasons.add(result.reason);
  check(
    `rejects ${label} as ${expectedReason}`,
    result.ok === false && result.reason === expectedReason,
    result.ok ? 'ACCEPTED' : `${result.reason}: ${result.detail}`,
  );
}

rejects('a non-object submission', null, 'malformed_submission');
rejects('a submission with no menu array', goodSubmission({ menu: undefined }), 'malformed_submission');
rejects('a submission outside the setup phase', goodSubmission(), 'wrong_phase', { phase: 'service' });
rejects(
  `${MENU_MAIN_SLOTS - 1} main dishes`,
  goodSubmission({ menu: goodSubmission().menu.slice(0, 2) }),
  'wrong_main_count',
);
rejects(
  `${MENU_MAIN_SLOTS + 1} main dishes`,
  goodSubmission({ menu: [...goodSubmission().menu, { dishId: 'caesar_salad', price: 12 }] }),
  'wrong_main_count',
);
rejects(
  `${MENU_ADDON_SLOTS + 1} add-ons`,
  goodSubmission({
    addons: [
      { dishId: 'espresso', price: 5 },
      { dishId: 'cheesecake', price: 10 },
      { dishId: 'caesar_salad', price: 12 },
    ],
  }),
  'too_many_addons',
);
rejects(
  'an unknown dish id',
  goodSubmission({ menu: [{ dishId: 'unicorn_burger', price: 14 }, ...goodSubmission().menu.slice(1)] }),
  'unknown_dish',
);
rejects(
  'the same dish in a main slot and an add-on slot',
  goodSubmission({ addons: [{ dishId: 'smash_burger', price: 14 }] }),
  'duplicate_dish',
);
rejects(
  'an entree in an add-on slot',
  goodSubmission({ addons: [{ dishId: 'caesar_salad', price: 12 }] }),
  'invalid_addon_category',
);
rejects(
  'a drink in a main slot',
  goodSubmission({ menu: [{ dishId: 'espresso', price: 5 }, ...goodSubmission().menu.slice(1)] }),
  'invalid_main_category',
);
rejects(
  'a price above the dish’s bounded range',
  goodSubmission({ menu: [{ dishId: 'smash_burger', price: 99 }, ...goodSubmission().menu.slice(1)] }),
  'price_out_of_range',
);
rejects(
  'a grilled dish in a restaurant with no grill',
  goodSubmission(),
  'dish_not_producible',
  { layout: layoutWithout('grill') },
);
rejects('an unknown upgrade id', goodSubmission({ startingUpgradeId: 'warp_drive_1' }), 'unknown_upgrade');
rejects(
  'a starting upgrade the player cannot afford',
  goodSubmission({ startingUpgradeId: 'serving_tray_2' }),
  'upgrade_unaffordable',
  { startingCash: 100 },
);
rejects(
  'an unknown ingredient in the allocation',
  goodSubmission({ startingInventory: { unobtainium: 5 } }),
  'unknown_ingredient',
);
rejects(
  'a fractional ingredient quantity',
  goodSubmission({ startingInventory: { beef: 2.5 } }),
  'invalid_inventory_quantity',
);
rejects(
  'a negative ingredient quantity',
  goodSubmission({ startingInventory: { beef: -1 } }),
  'invalid_inventory_quantity',
);
rejects(
  'an allocation above the per-ingredient cap',
  goodSubmission({ startingInventory: { beef: STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT + 1 } }),
  'invalid_inventory_quantity',
);
rejects(
  'an allocation the player cannot afford alongside the upgrade',
  goodSubmission({ startingInventory: { steak: 80, beef: 80, chicken: 80 } }),
  'inventory_over_budget',
);
rejects(
  'a staff assignment naming a worker who is not on the roster',
  goodSubmission({ staffAssignments: { cook_1: 'grill', server_1: 'dining_room', chef_de_cuisine: 'oven' } }),
  'unknown_worker',
);
rejects(
  'a worker left with no post',
  goodSubmission({ staffAssignments: { cook_1: 'grill' } }),
  'worker_unassigned',
);
rejects(
  'a cook assigned to the dining room',
  goodSubmission({ staffAssignments: { cook_1: 'dining_room', server_1: 'dining_room' } }),
  'invalid_station_assignment',
);
rejects('an unknown policy id', goodSubmission({ policyId: 'free_caviar' }), 'unknown_policy');
rejects(
  'a House Special naming a dish that is not on the menu',
  goodSubmission({ policyId: 'house_special', policyDishId: 'steak_frites' }),
  'invalid_policy_target',
);

check(
  'every declared SETUP_REJECTION_REASONS member is exercised by this script',
  SETUP_REJECTION_REASONS.every((reason) => seenReasons.has(reason)),
  SETUP_REJECTION_REASONS.filter((r) => !seenReasons.has(r)).join(', ') || 'all covered',
);

// --- 4. the price band, at its exact boundaries -------------------------------------------
{
  const burger = dish('smash_burger');
  const { minPrice, maxPrice } = priceBoundsFor(burger);
  const at = (price) =>
    validateSetupSubmission(
      goodSubmission({ menu: [{ dishId: 'smash_burger', price }, ...goodSubmission().menu.slice(1)] }),
    ).ok;

  check(
    'price bounds are derived from suggestedPrice and rounded to whole cents',
    minPrice === 8.4 && maxPrice === 22.4 && burger.suggestedPrice === 14,
    `${minPrice}-${maxPrice} from a suggested ${burger.suggestedPrice}`,
  );
  check(
    'both endpoints of the bounded range are accepted',
    at(minPrice) === true && at(maxPrice) === true,
    `${minPrice} and ${maxPrice}`,
  );
  check(
    'one cent outside either endpoint is rejected',
    at(minPrice - 0.01) === false && at(maxPrice + 0.01) === false,
    `${(minPrice - 0.01).toFixed(2)} and ${(maxPrice + 0.01).toFixed(2)}`,
  );
  // The rounding is not cosmetic: `14 * 1.6` is 22.400000000000002 in IEEE-754, and a client
  // that puts the raw product in an input `max` would offer a price the server then refuses.
  const isWholeCents = (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;
  check(
    'every shipped dish has a usable band and both endpoints land on whole cents',
    catalogue.dishes.every((d) => {
      const b = priceBoundsFor(d);
      return (
        b.minPrice < d.suggestedPrice &&
        b.maxPrice > d.suggestedPrice &&
        isWholeCents(b.minPrice) &&
        isWholeCents(b.maxPrice)
      );
    }) && maxPrice !== burger.suggestedPrice * 1.6,
    `1.6 * 14 = ${14 * 1.6}, band max = ${maxPrice}`,
  );
}

// --- 5. producibility, PRD §7 "Menu constraints" -------------------------------------------
{
  const noOven = layoutWithout('oven');
  const mainsWithOven = selectableMains(catalogue.dishes, layout).map((d) => d.id);
  const mainsWithoutOven = selectableMains(catalogue.dishes, noOven).map((d) => d.id);
  check(
    'a dish that needs a missing station drops out of the selectable list AND is rejected',
    mainsWithOven.includes('nachos') &&
      !mainsWithoutOven.includes('nachos') &&
      validateSetupSubmission(goodSubmission(), { layout: noOven }).reason === 'dish_not_producible',
    `with oven: ${mainsWithOven.join(', ')} / without: ${mainsWithoutOven.join(', ')}`,
  );
  check(
    'the shipped layout can produce every shipped dish, so the rule needs an injected layout',
    selectableMains(catalogue.dishes, layout).length + selectableAddons(catalogue.dishes, layout).length ===
      catalogue.dishes.length,
    `${catalogue.dishes.length} dishes, all producible in "${layout.id}"`,
  );
}

// --- 6. PRD §7 "qualitative guidance, not exact customer utility math" ----------------------
{
  const sixLabels = [
    'Excellent value',
    'Competitive',
    'Premium',
    'Likely too expensive for this market',
    'Low margin',
    'Strong margin, demand risk',
  ];
  check(
    'the six §7 labels are declared verbatim and are the entire vocabulary',
    PRICE_GUIDANCE_LABEL_LIST.length === 6 &&
      sixLabels.every((label) => PRICE_GUIDANCE_LABEL_LIST.includes(label)),
    PRICE_GUIDANCE_LABEL_LIST.join(' / '),
  );

  // Sweep every dish across its whole legal band in every market, at one-cent steps.
  let sweeps = 0;
  let onlyLabels = true;
  let anyNumber = false;
  const produced = new Set();
  for (const d of catalogue.dishes) {
    const { minPrice, maxPrice } = priceBoundsFor(d);
    for (const market of catalogue.markets) {
      for (let price = minPrice; price <= maxPrice + 1e-9; price += 0.25) {
        const guidance = priceGuidance(d, Math.round(price * 100) / 100, market);
        sweeps += 1;
        for (const value of Object.values(guidance)) {
          if (value === null) continue;
          if (typeof value !== 'string') anyNumber = true;
          if (!PRICE_GUIDANCE_LABEL_LIST.includes(value)) onlyLabels = false;
          produced.add(value);
        }
        if (Object.keys(guidance).join(',') !== 'valueLabel,marginLabel') onlyLabels = false;
      }
    }
  }
  check(
    'priceGuidance returns labels only — no score, ratio, probability or projected wait',
    onlyLabels && !anyNumber,
    `${sweeps} price/dish/market combinations, keys are {valueLabel, marginLabel}`,
  );
  check(
    'all four §7 value labels and both margin labels actually occur across the legal bands',
    sixLabels.every((label) => produced.has(label)),
    sixLabels.filter((l) => !produced.has(l)).join(', ') || 'all six reachable',
  );
  check(
    'the suggested price reads "Competitive" in every market, whatever its price sensitivity',
    catalogue.dishes.every((d) =>
      catalogue.markets.every(
        (m) => priceGuidance(d, d.suggestedPrice, m).valueLabel === PRICE_GUIDANCE_LABELS.COMPETITIVE,
      ),
    ),
    'the market scales the DEVIATION from the suggested price, not the price',
  );
  check(
    'the same price reads more expensively in a price-sensitive district than a tolerant one',
    priceGuidance(dish('steak_frites'), 48, catalogue.marketsById.downtown_lunch).valueLabel ===
      PRICE_GUIDANCE_LABELS.TOO_EXPENSIVE &&
      priceGuidance(dish('steak_frites'), 48, catalogue.marketsById.uptown_pre_theater).valueLabel !==
        PRICE_GUIDANCE_LABELS.TOO_EXPENSIVE,
    'steak_frites at $48: downtown (1.2) vs uptown (0.7)',
  );
}

// --- 6b. the §18 screen itself cannot render the simulation's math ---------------------------
// A static guard on the one file that renders price feedback. `priceGuidance` already has no
// numeric field to leak, but the component could still reach past it into the catalogue for a
// segment's budget or a dish's market affinity and put a simulation parameter on screen. The
// §7 rule is about what the player SEES, so this asserts on the source of what draws it.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, '../client/src/ui/SetupScreen.tsx'), 'utf8');
  // Comments explain the rule and quote it; only executable source can break it.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  // Terms with no legitimate use in a UI at all. `segmentWeights` is deliberately NOT here:
  // PRD §5's market reveal is explicitly a "customer segment forecast", both players receive
  // it identically, and the screen renders it as a share.
  const forbidden = [
    'PRICE_GUIDANCE_THRESHOLDS',
    'BRIEFING_INDICATOR_THRESHOLDS',
    'priceSensitivity',
    'marketAffinity',
    'baseSatisfaction',
    'serviceSpeedWeight',
    'priceWeight',
    'menuFitWeight',
    'reputationWeight',
    'conversion',
    'projectedWait',
    'utility',
  ];
  const leaked = forbidden.filter((term) => source.includes(term));
  check(
    'the §18 setup screen references no utility term, weight, threshold or projected wait',
    leaked.length === 0,
    leaked.length === 0 ? `${forbidden.length} forbidden terms, none present` : `USES: ${leaked.join(', ')}`,
  );

  // `budget` and `patienceSeconds` ARE the numbers §7 says to show only as broad indicators.
  // They may appear in the type the JSON is cast to — `segmentForecast` needs them to derive
  // its labels — but every occurrence must be a bare field declaration, never a read.
  const rawFieldUses = source
    .split('\n')
    .filter((line) => /\bbudget\b|\bpatienceSeconds\b/.test(line))
    .filter((line) => !/^\s*(budget|patienceSeconds): number;\s*$/.test(line));
  check(
    'a segment’s budget and patience appear only as a type field, never read or rendered',
    rawFieldUses.length === 0,
    rawFieldUses.length === 0
      ? 'the screen shows spendingIndicator/patienceIndicator labels instead'
      : `READ AT: ${rawFieldUses.map((l) => l.trim()).join(' | ')}`,
  );

  check(
    'the screen renders price feedback only through priceGuidance’s label strings',
    source.includes('priceGuidance(') && source.includes('GuidanceChips'),
    'labels arrive pre-computed; the component never sees a score',
  );
}

// --- 7. against a live match: acceptance, non-mutation, immutability, privacy ---------------
function matchInSetup(seed = 'setup-check') {
  const match = new Match({ id: `m_${seed}`, seed, phasePreset: 'prototype' });
  quiet(() => {
    for (const id of ['p1', 'p2']) match.join({ fallbackPlayerId: id });
    for (const id of ['p1', 'p2']) match.setReady(id, true);
    for (let i = 0; i < 4000 && match.phase !== 'setup'; i += 1) stepMatch(match, 50);
  });
  return match;
}

clearSystems();
registerSystem(setupSystem);

{
  const match = matchInSetup();
  check('the check harness reaches the setup phase', match.phase === 'setup', match.phase);

  // A rejected submission must change nothing at all.
  const before = JSON.stringify(match.toSnapshot('p1'));
  const rejected = quiet(() =>
    acceptSetupSubmission(match, 'p1', goodSubmission({ menu: [{ dishId: 'espresso', price: 5 }] })),
  );
  const after = JSON.stringify(match.toSnapshot('p1'));
  check(
    'a rejected submission returns a reason and mutates no match state',
    rejected.ok === false &&
      typeof rejected.reason === 'string' &&
      SETUP_REJECTION_REASONS.includes(rejected.reason) &&
      before === after &&
      match.players.get('p1').setup === null &&
      match.players.get('p1').ready === false,
    `${rejected.reason}: ${rejected.detail}`,
  );

  // Acceptance stores the submission and marks the player ready.
  const accepted = quiet(() => acceptSetupSubmission(match, 'p1', goodSubmission()));
  check(
    'an accepted submission is stored under the player and marks them ready',
    accepted.ok === true &&
      match.players.get('p1').ready === true &&
      match.toSnapshot('p1').you.setup.menu.length === MENU_MAIN_SLOTS,
    `cashRemaining=${accepted.submission?.cashRemaining} of ${STARTING_CASH}`,
  );
  check(
    'the server computes the money — upgrade cost, allocation cost and cash remaining',
    accepted.submission.upgradeCost === catalogue.upgradesById.serving_tray_1.cost &&
      accepted.submission.inventoryCost > 0 &&
      accepted.submission.cashRemaining ===
        Math.round(
          (STARTING_CASH - accepted.submission.upgradeCost - accepted.submission.inventoryCost) * 100,
        ) / 100,
    `upgrade=${accepted.submission.upgradeCost} stock=${accepted.submission.inventoryCost} left=${accepted.submission.cashRemaining}`,
  );
}

// --- 8. the privacy criterion, on the serialized snapshot ------------------------------------
{
  const match = matchInSetup('privacy');
  const secret = {
    type: 'setup_submit',
    menu: [
      { dishId: 'steak_frites', price: 33.33 },
      { dishId: 'pasta_primavera', price: 21.11 },
      { dishId: 'caesar_salad', price: 11.77 },
    ],
    addons: [{ dishId: 'cheesecake', price: 9.99 }],
    startingUpgradeId: 'pantry_shelves_1',
    staffAssignments: { cook_1: 'oven', server_1: 'pass' },
    startingInventory: { steak: 12, potatoes: 20 },
    policyId: 'house_special',
    policyDishId: 'steak_frites',
  };
  const accepted = quiet(() => acceptSetupSubmission(match, 'p1', secret));

  const mine = JSON.stringify(match.toSnapshot('p1'));
  const theirs = JSON.stringify(match.toSnapshot('p2'));
  const fingerprints = ['steak_frites', '33.33', 'pasta_primavera', 'cheesecake', 'pantry_shelves_1',
    'house_special', 'oven'];

  // The positive control matters: without it this passes vacuously if nothing was ever stored.
  check(
    'the submitter’s own snapshot DOES carry their menu, prices, upgrade, policy and staffing',
    accepted.ok === true && fingerprints.every((f) => mine.includes(f)),
    fingerprints.filter((f) => !mine.includes(f)).join(', ') || 'all present under `you.setup`',
  );
  check(
    'the opponent’s serialized snapshot contains NONE of it (PRD §18)',
    fingerprints.every((f) => !theirs.includes(f)) && theirs.includes('"setup":null'),
    fingerprints.filter((f) => theirs.includes(f)).join(', ') || 'not one fingerprint survives',
  );
  // An ALLOWLIST, not a denylist: `toSnapshot` builds `players[]` from an explicit field list,
  // and this pins that list. A field added to the player record later cannot leak by being
  // something nobody thought to forbid — it fails here the moment it reaches the public array.
  const PUBLIC_PLAYER_FIELDS = ['playerId', 'position', 'facing', 'sprinting', 'connected',
    'ready', 'lastSequence'];
  const opponentEntry = match.toSnapshot('p2').players.find((p) => p.playerId === 'p1');
  check(
    'the opponent entry carries exactly the public field allowlist, readiness included',
    opponentEntry.ready === true &&
      JSON.stringify(Object.keys(opponentEntry).sort()) ===
        JSON.stringify([...PUBLIC_PLAYER_FIELDS].sort()),
    Object.keys(opponentEntry).join(', '),
  );
  check(
    'the KEY `setup` appears in a snapshot only under `you`, and only for its owner',
    // `"setup"` also occurs as the value of `matchPhase`, so match the key form specifically.
    JSON.stringify({ ...match.toSnapshot('p2'), you: undefined }).includes('"setup":') === false &&
      match.toSnapshot('p2').you.setup === null &&
      match.toSnapshot('p1').you.setup !== null,
    'stripping `you` from p2’s snapshot leaves no trace of anyone’s submission',
  );
}

// --- 9. the menu is immutable once service starts ---------------------------------------------
{
  const match = matchInSetup('immutable');
  quiet(() => acceptSetupSubmission(match, 'p1', goodSubmission()));
  const submittedMenu = JSON.stringify(match.players.get('p1').setup.menu);

  // p2 never submits: the setup timer runs out and service begins anyway (PRD §5).
  quiet(() => {
    for (let i = 0; i < 4000 && match.phase !== 'service'; i += 1) stepMatch(match, 50);
  });

  const late = quiet(() =>
    acceptSetupSubmission(
      match,
      'p1',
      goodSubmission({ menu: [{ dishId: 'steak_frites', price: 34 }, ...goodSubmission().menu.slice(1)] }),
    ),
  );
  check(
    'a setup_submit arriving after service starts is refused and changes nothing',
    match.phase === 'service' &&
      late.ok === false &&
      late.reason === 'wrong_phase' &&
      JSON.stringify(match.players.get('p1').setup.menu) === submittedMenu,
    `${late.reason}: ${late.detail}`,
  );
  check(
    'both menus are locked at the setup -> service transition',
    [...match.players.values()].every((p) => p.setup && p.setup.locked === true),
    [...match.players.values()].map((p) => `${p.playerId}:locked=${p.setup?.locked}`).join(' '),
  );
  check(
    'a player who never submitted gets a legal, deterministic default menu',
    match.players.get('p2').setup.autoFilled === true &&
      match.players.get('p2').setup.menu.length === MENU_MAIN_SLOTS &&
      validateSetupSubmission({
        ...match.players.get('p2').setup,
        menu: match.players.get('p2').setup.menu,
      }).ok === true &&
      JSON.stringify(defaultSubmission().menu) === JSON.stringify(match.players.get('p2').setup.menu),
    match.players.get('p2').setup.menu.map((s) => `${s.dishId}@${s.price}`).join(', '),
  );
}
clearSystems();

// --- 10. over the wire: the router path, and the bytes a client actually receives -------------

function connect({ roomId }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const state = { ws, snapshots: [], errors: [], joined: null };
    const timer = setTimeout(() => reject(new Error('join timeout')), 5000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'join_room', roomId })));
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      if (msg.type === 'joined') {
        state.joined = msg;
        clearTimeout(timer);
        resolve(state);
      } else if (msg.type === 'match_snapshot') {
        state.snapshots.push(msg);
        state.rawSnapshots = state.rawSnapshots ?? [];
        state.rawSnapshots.push(typeof event.data === 'string' ? event.data : String(event.data));
      } else if (msg.type === 'error') {
        state.errors.push(msg);
      }
    });
    ws.addEventListener('error', () => reject(new Error('socket error')));
  });
}

async function until(client, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const latest = client.snapshots.at(-1);
    if (latest && predicate(latest)) return latest;
    await sleep(25);
  }
  return null;
}

async function overTheWire() {
  const room = await (
    await fetch(`${BASE}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed: 'setup-wire', phasePreset: 'smoke' }),
    })
  ).json();

  const p1 = await connect({ roomId: room.id });
  const p2 = await connect({ roomId: room.id });
  await until(p1, (s) => s.players.length === 2);

  // A setup_submit sent in the lobby must be refused — the menu is a setup-phase decision.
  p1.ws.send(JSON.stringify(goodSubmission()));
  await sleep(150);
  check(
    'a setup_submit sent outside setup comes back as setup_rejected/wrong_phase',
    p1.errors.at(-1)?.error === 'setup_rejected' && p1.errors.at(-1)?.reason === 'wrong_phase',
    JSON.stringify(p1.errors.at(-1) ?? null),
  );

  p1.ws.send(JSON.stringify({ type: 'player_ready', ready: true }));
  p2.ws.send(JSON.stringify({ type: 'player_ready', ready: true }));
  await until(p1, (s) => s.matchPhase === 'setup');

  // An illegal menu, then a legal one, on the same socket.
  p1.ws.send(JSON.stringify(goodSubmission({ menu: [{ dishId: 'smash_burger', price: 999 }] })));
  await sleep(150);
  check(
    'the router answers an illegal menu with setup_rejected and a machine-readable reason',
    p1.errors.at(-1)?.error === 'setup_rejected' &&
      SETUP_REJECTION_REASONS.includes(p1.errors.at(-1)?.reason),
    JSON.stringify(p1.errors.at(-1) ?? null),
  );

  const secretPrice = 27.77;
  p1.ws.send(
    JSON.stringify({
      type: 'setup_submit',
      menu: [
        { dishId: 'steak_frites', price: secretPrice },
        { dishId: 'pasta_primavera', price: 19.19 },
        { dishId: 'caesar_salad', price: 10.1 },
      ],
      addons: [{ dishId: 'cheesecake', price: 8.88 }],
      startingUpgradeId: 'maintenance_plan_1',
      staffAssignments: { cook_1: 'oven', server_1: 'pass' },
      startingInventory: { steak: 10 },
      policyId: 'friendly_staff',
    }),
  );

  const mine = await until(p1, (s) => s.you?.setup !== null, 4000);
  check(
    'submitting over the wire stores the menu under `you` and marks the player ready',
    mine !== null && mine.you.ready === true && mine.you.setup.menu[0].price === secretPrice,
    mine ? `you.setup.menu[0]=${mine.you.setup.menu[0].dishId}@${mine.you.setup.menu[0].price}` : 'no snapshot',
  );

  // THE criterion: grep the raw frames the opponent's socket actually received.
  await sleep(300);
  const opponentFrames = (p2.rawSnapshots ?? []).join('\n');
  const fingerprints = ['steak_frites', String(secretPrice), '19.19', 'cheesecake',
    'maintenance_plan_1', 'friendly_staff'];
  const leaked = fingerprints.filter((f) => opponentFrames.includes(f));
  check(
    'not one byte of p1’s menu, prices, upgrade or policy appears in p2’s received frames',
    opponentFrames.length > 0 && leaked.length === 0,
    leaked.length === 0
      ? `${(p2.rawSnapshots ?? []).length} frames inspected`
      : `LEAKED: ${leaked.join(', ')}`,
  );
  check(
    'p2 does see that p1 is ready — §18’s opponent-ready status, and nothing more',
    p2.snapshots.at(-1).players.some((p) => p.playerId === p1.joined.playerId && p.ready === true) &&
      p2.snapshots.at(-1).you.setup === null,
    'players[].ready is public; you.setup is not',
  );

  p1.ws.close();
  p2.ws.close();
  await sleep(100);
}

const server = await startServer(target);
try {
  await overTheWire();
} finally {
  server.stop();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
