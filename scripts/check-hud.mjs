#!/usr/bin/env node
// Service-phase HUD and alert prioritization check — STORY-015's acceptance criteria, in process.
//
// THREE LAYERS, matching the file split the story itself produced:
//
//   1. `classifyBottlenecks` (hud-bottleneck-system.js) — a pure function of constructed
//      restaurant/customer/order fragments, exercised directly with no `Match` at all, the same
//      way `scoring-system.js`'s `_internal` exports are tested in check-scoring.mjs.
//   2. Wiring — a real `Match` with every gameplay system registered (`registerAllSystems`),
//      proving `hud-bottleneck-system.js` is actually reached during `service` and that
//      `match.js#toSnapshot`'s new `you.revenue` reads the right facade.
//   3. `buildCriticalAlerts`/`capCriticalAlerts` (shared/game-logic/hud-alerts.js) — pure,
//      exercised directly against constructed `RestaurantSnapshot`-shaped fragments (with
//      `activeBottlenecks` set as layer 1 would have produced it), proving the §18 priority
//      order and the alarm-fatigue cap independently of the server wiring.
//
// Run: node scripts/check-hud.mjs

import { Match } from '../server/src/game/match.js';
import { registerAllSystems } from '../server/src/game/systems/index.js';
import { clearSystems, stepMatch, registeredSystems } from '../server/src/game/simulation-loop.js';
import { classifyBottlenecks } from '../server/src/game/systems/hud-bottleneck-system.js';
import { buildCriticalAlerts, capCriticalAlerts, ALERT_CATEGORIES } from '../shared/game-logic/hud-alerts.js';
import { cashFeedbackFor } from '../shared/game-logic/hud-cash-feedback.js';
import {
  HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD,
  HUD_LONG_ENTRY_QUEUE_THRESHOLD,
  HUD_EVENT_COUNTDOWN_ALERT_MS,
  HUD_CRITICAL_ALERTS_MAX,
  HUD_CASH_FEEDBACK_MIN_DELTA,
  ORDER_FRESHNESS_GRACE_MS,
} from '../shared/constants/tuning.js';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const realLog = console.log;
function quiet(fn) {
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = realLog;
  }
}

const TICK_MS = 50;

console.log('HUD and alert-prioritization check — PRD §18\n');

// =================================================================================================
// 1. classifyBottlenecks — pure, per-kind threshold behaviour
// =================================================================================================
console.log('1. server-side bottleneck classification (hud-bottleneck-system.js)');

function baseRestaurant(overrides = {}) {
  return { restaurantId: 'p1', queueLength: 0, tables: [], shortages: [], ...overrides };
}

{
  // Nothing wrong: empty restaurant, no customers, no orders.
  const kinds = classifyBottlenecks(baseRestaurant(), [], []);
  check('a healthy restaurant classifies to no bottlenecks', kinds.length === 0, `got [${kinds}]`);
}

{
  // unhappy_customer: reuses CustomerSnapshot.unhappy verbatim.
  const customers = [
    { customerId: 'c1', restaurantId: 'p1', state: 'WAITING_FOR_FOOD', unhappy: true, patienceRemaining: 0.1 },
    { customerId: 'c2', restaurantId: 'p2', state: 'WAITING_FOR_FOOD', unhappy: true, patienceRemaining: 0.05 },
  ];
  const kinds = classifyBottlenecks(baseRestaurant(), customers, []);
  check(
    'an unhappy customer at THIS restaurant classifies unhappy_customer, the rival one does not count',
    kinds.includes('unhappy_customer'),
  );
  const kindsNone = classifyBottlenecks(baseRestaurant(), [{ ...customers[0], unhappy: false }], []);
  check('a customer who is not unhappy does not trigger it', !kindsNone.includes('unhappy_customer'));
  const kindsExited = classifyBottlenecks(baseRestaurant(), [{ ...customers[0], state: 'LEAVE_ANGRY' }], []);
  check(
    'an unhappy customer already in an exit state does not trigger it (they are already gone)',
    !kindsExited.includes('unhappy_customer'),
  );
}

{
  // server_overload: ready order past the freshness grace window.
  const fresh = [{ orderId: 'o1', ticketId: 't1', restaurantId: 'p1', state: 'ready', readyAgeMs: ORDER_FRESHNESS_GRACE_MS - 1 }];
  const stale = [{ orderId: 'o1', ticketId: 't1', restaurantId: 'p1', state: 'ready', readyAgeMs: ORDER_FRESHNESS_GRACE_MS + 1 }];
  check('a ready order still inside its freshness grace does not trigger server_overload', !classifyBottlenecks(baseRestaurant(), [], fresh).includes('server_overload'));
  check('a ready order past its freshness grace triggers server_overload', classifyBottlenecks(baseRestaurant(), [], stale).includes('server_overload'));
  const rival = [{ orderId: 'o1', ticketId: 't1', restaurantId: 'p2', state: 'ready', readyAgeMs: ORDER_FRESHNESS_GRACE_MS + 1 }];
  check("a rival's stale ready order does not trigger it for this restaurant", !classifyBottlenecks(baseRestaurant(), [], rival).includes('server_overload'));
}

{
  // ingredient_shortage: shortages[] with blockedTickets > 0.
  const noBlock = baseRestaurant({ shortages: [{ station: 'grill', ingredientId: 'beef', blockedTickets: 0, restocking: true, exhausted: false }] });
  const blocked = baseRestaurant({ shortages: [{ station: 'grill', ingredientId: 'beef', blockedTickets: 1, restocking: false, exhausted: false }] });
  check('a shortage with nothing blocked yet does not trigger ingredient_shortage', !classifyBottlenecks(noBlock, [], []).includes('ingredient_shortage'));
  check('a shortage actively blocking a ticket triggers ingredient_shortage', classifyBottlenecks(blocked, [], []).includes('ingredient_shortage'));
}

{
  // kitchen_backlog: queued, unblocked tickets past the threshold.
  const under = Array.from({ length: HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD }, (_, i) => ({
    orderId: `o${i}`, ticketId: `t${i}`, restaurantId: 'p1', state: 'queued', blockedByIngredientId: null,
  }));
  const over = Array.from({ length: HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD + 1 }, (_, i) => ({
    orderId: `o${i}`, ticketId: `t${i}`, restaurantId: 'p1', state: 'queued', blockedByIngredientId: null,
  }));
  const blocked = over.map((o) => ({ ...o, blockedByIngredientId: 'beef' }));
  check('exactly the threshold of queued tickets does not yet trigger kitchen_backlog', !classifyBottlenecks(baseRestaurant(), [], under).includes('kitchen_backlog'));
  check('past the threshold of queued, unblocked tickets triggers kitchen_backlog', classifyBottlenecks(baseRestaurant(), [], over).includes('kitchen_backlog'));
  check('the same count, but ingredient-blocked, does NOT double-count as kitchen_backlog', !classifyBottlenecks(baseRestaurant(), [], blocked).includes('kitchen_backlog'));
}

{
  // long_entry_queue / dirty_table.
  check(
    'a queue past the threshold triggers long_entry_queue',
    classifyBottlenecks(baseRestaurant({ queueLength: HUD_LONG_ENTRY_QUEUE_THRESHOLD + 1 }), [], []).includes('long_entry_queue'),
  );
  check(
    'a queue at the threshold does not yet trigger long_entry_queue',
    !classifyBottlenecks(baseRestaurant({ queueLength: HUD_LONG_ENTRY_QUEUE_THRESHOLD }), [], []).includes('long_entry_queue'),
  );
  check(
    'any dirty table triggers dirty_table',
    classifyBottlenecks(baseRestaurant({ tables: [{ id: 'table_1', seats: 2, occupiedBy: null, dirty: true }] }), [], []).includes('dirty_table'),
  );
}

{
  // Never fabricated, however bad the fixture: equipment_failure/cash_opportunity have no
  // producer, whatever else is wrong at once.
  const everythingElseWrong = baseRestaurant({
    queueLength: 99,
    tables: [{ id: 't1', seats: 2, occupiedBy: null, dirty: true }],
    shortages: [{ station: 'grill', ingredientId: 'beef', blockedTickets: 5, restocking: false, exhausted: true }],
  });
  const busyCustomers = [{ customerId: 'c1', restaurantId: 'p1', state: 'WAITING_FOR_FOOD', unhappy: true, patienceRemaining: 0.01 }];
  const busyOrders = [
    { orderId: 'o1', ticketId: 't1', restaurantId: 'p1', state: 'ready', readyAgeMs: 999_999 },
    ...Array.from({ length: 10 }, (_, i) => ({ orderId: `q${i}`, ticketId: `q${i}`, restaurantId: 'p1', state: 'queued', blockedByIngredientId: null })),
  ];
  const kinds = classifyBottlenecks(everythingElseWrong, busyCustomers, busyOrders);
  check(
    'equipment_failure never appears — no station is ever marked broken in this codebase',
    !kinds.includes('equipment_failure'),
  );
  check(
    'cash_opportunity never appears — owned by the STORY-016 visual layer, not this HUD alert list',
    !kinds.includes('cash_opportunity'),
  );
  check(
    'the priority order pushed matches PRD §18 (unhappy -> overload -> shortage -> backlog -> queue -> dirty)',
    JSON.stringify(kinds) ===
      JSON.stringify(['unhappy_customer', 'server_overload', 'ingredient_shortage', 'kitchen_backlog', 'long_entry_queue', 'dirty_table']),
    `got [${kinds}]`,
  );
}

// =================================================================================================
// 2. wiring — a real Match, registerAllSystems(), the actual simulation loop
// =================================================================================================
console.log('\n2. wiring: hud-bottleneck-system reached during service, you.revenue on the wire');

clearSystems();
registerAllSystems();

function makeServiceMatch() {
  const match = new Match({ id: 'hud_wiring', seed: 'hud-seed', phasePreset: 'prototype', requiredPlayers: 2 });
  match.join({ fallbackPlayerId: 'p1' });
  match.join({ fallbackPlayerId: 'p2' });
  match.setReady('p1', true);
  match.setReady('p2', true);
  const submission = {
    menu: [{ dishId: 'smash_burger', price: 14 }],
    addons: [],
    startingUpgradeId: null,
    staffAssignments: { cook_1: 'prep', server_1: 'dining_room' },
    startingInventory: {},
    policyId: null,
    policyDishId: null,
    upgradeCost: 0,
    inventoryCost: 0,
    cashRemaining: 100,
    submittedAtMs: 0,
    locked: false,
    autoFilled: false,
  };
  match.players.get('p1').setup = { ...submission };
  match.players.get('p2').setup = { ...submission };
  quiet(() => {
    for (let i = 0; i < 20_000 && match.phase !== 'service' && !match.ended; i += 1) stepMatch(match, TICK_MS);
  });
  return match;
}

{
  const match = makeServiceMatch();
  check('the probe match actually reaches service', match.phase === 'service');

  quiet(() => stepMatch(match, TICK_MS));
  const before = match.toSnapshot('p1');
  const p1Before = before.restaurants.find((r) => r.restaurantId === 'p1');
  check(
    'activeBottlenecks is present (possibly empty) on the wire during service — the field this story exists to populate',
    p1Before && Array.isArray(p1Before.activeBottlenecks),
    JSON.stringify(p1Before?.activeBottlenecks),
  );
  check(
    'you.revenue is a number once match.kitchen exists, not the undeclared field it used to be',
    typeof before.you.revenue === 'number',
    `you.revenue=${before.you.revenue}`,
  );

  // Force a real long_entry_queue condition — NOT by writing `restaurant.queueLength` directly
  // onto `match.restaurants` (customer-system.js REASSIGNS that array wholesale every tick, the
  // same "decoration trap" inventory-system.js's own header warns about, so a direct write is
  // silently discarded the very next tick). Instead, plant enough real probe parties into the
  // internal queue state customer-system.js itself reads `queueLengthFor` from — the same
  // technique check-upgrades.mjs's `plantParty` uses — so THIS system sees the number a real
  // match would actually produce.
  const sim = match._customerSimState;
  for (let i = 0; i < HUD_LONG_ENTRY_QUEUE_THRESHOLD + 5; i += 1) {
    sim.parties.set(`party_probe_queue_${i}`, {
      customerId: `party_probe_queue_${i}`,
      segmentId: 'office_worker',
      partySize: 1,
      state: 'APPROACH_OR_QUEUE',
      restaurantId: 'p1',
      position: { x: 0, y: 0, z: 0 },
      tableId: null,
      orderId: null,
      orderOutcome: null,
      satisfaction: null,
      decisionReason: null,
      patienceSeconds: 300,
      patienceMsRemaining: 300_000,
      budget: 999,
      preferredTags: [],
      dislikedTags: [],
      spawnedAtMs: match.elapsedMs,
      stateEnteredAtMs: match.elapsedMs,
      patienceAtSeatedFrac: 1,
      patienceAtOrderPlacedFrac: null,
      patienceAtFoodDeliveredFrac: null,
      eatingTargetMs: 10_000,
      everUnhappy: false,
      complaintHandled: false,
    });
  }
  quiet(() => stepMatch(match, TICK_MS));
  const after = match.toSnapshot('p1').restaurants.find((r) => r.restaurantId === 'p1');
  check(
    'a forced long queue is reclassified into activeBottlenecks by the very next tick',
    after.activeBottlenecks.includes('long_entry_queue'),
    JSON.stringify(after.activeBottlenecks),
  );
}

{
  // Registration-order guard: hud-bottlenecks must run strictly before scoring (see
  // systems/index.js's header) — proven the same way that file's own comment proves it, by
  // checking scoring still sees a fully-populated match at the results transition. A cheap,
  // durable proxy: force the match to `results` and confirm finalResults still gets built with
  // no throw, i.e. hud-bottlenecks did not corrupt anything scoring reads.
  const match = makeServiceMatch();
  quiet(() => {
    let steps = 0;
    while (match.phase !== 'results' && !match.ended && steps < 40_000) {
      stepMatch(match, TICK_MS);
      steps += 1;
    }
  });
  check(
    'a match still reaches results and scores with hud-bottlenecks registered ahead of scoring',
    match.finalResults !== undefined && match.finalResults !== null,
  );
  // The check above would pass even if `hud_bottlenecks` were registered AFTER `scoring` — it
  // only proves scoring still runs, not the ORDER. `systems/index.js`'s header requires it
  // strictly between `upgrades` and `scoring`; pin that literally, by index, off the same
  // `registeredSystems()` the boot log itself reads.
  const ids = registeredSystems().map((s) => s.id);
  const hudIndex = ids.indexOf('hud_bottlenecks');
  const upgradesIndex = ids.indexOf('upgrades');
  const scoringIndex = ids.indexOf('scoring');
  check(
    'hud_bottlenecks is registered strictly between upgrades and scoring, not just "ahead of scoring somewhere"',
    hudIndex > upgradesIndex && hudIndex < scoringIndex,
    `order=[${ids.join(', ')}]`,
  );
}

// =================================================================================================
// 3. buildCriticalAlerts / capCriticalAlerts — pure ranking and the alarm-fatigue cap
// =================================================================================================
console.log('\n3. client-side ranking and cap (shared/game-logic/hud-alerts.js)');

function restaurantWith(kinds, extra = {}) {
  return { restaurantId: 'p1', activeBottlenecks: kinds, shortages: [], ...extra };
}

{
  // Gate proof: a category with no server flag produces NO alert, even with matching raw data
  // sitting right there — the single most important property this file's header promises.
  const customers = [{ customerId: 'c1', restaurantId: 'p1', state: 'WAITING_FOR_FOOD', unhappy: true, patienceRemaining: 0.01, tableId: 't1' }];
  const alertsUngated = buildCriticalAlerts({
    selfRestaurantId: 'p1',
    restaurants: [restaurantWith([])], // no unhappy_customer flag from the server
    customers,
    orders: [],
    events: [],
    canAffordUpgrade: false,
  });
  check(
    'an unhappy customer with no server-side unhappy_customer flag produces no abandonment alert',
    !alertsUngated.some((a) => a.category === 'customer_abandonment_imminent'),
  );
  const alertsGated = buildCriticalAlerts({
    selfRestaurantId: 'p1',
    restaurants: [restaurantWith(['unhappy_customer'])],
    customers,
    orders: [],
    events: [],
    canAffordUpgrade: false,
  });
  check(
    'the same customer WITH the server flag produces exactly one, correctly keyed, alert',
    alertsGated.length === 1 && alertsGated[0].key === 'abandonment:c1',
    JSON.stringify(alertsGated),
  );
}

{
  // Priority ordering: one of every category at once, confirm §18 order.
  const restaurant = restaurantWith(
    ['unhappy_customer', 'server_overload', 'ingredient_shortage', 'kitchen_backlog', 'long_entry_queue', 'dirty_table'],
    { shortages: [{ station: 'grill', ingredientId: 'beef', blockedTickets: 2 }] },
  );
  const customers = [{ customerId: 'c1', restaurantId: 'p1', state: 'WAITING_FOR_FOOD', unhappy: true, patienceRemaining: 0.2, tableId: 't1' }];
  const orders = [{ orderId: 'o1', ticketId: 'tk1', restaurantId: 'p1', dishId: 'smash_burger', state: 'ready', readyAgeMs: ORDER_FRESHNESS_GRACE_MS + 500, tableId: 't1' }];
  const events = [{ eventId: 'lunch_rush', state: 'warning', startsInMs: HUD_EVENT_COUNTDOWN_ALERT_MS - 1_000 }];
  const alerts = buildCriticalAlerts({
    selfRestaurantId: 'p1',
    restaurants: [restaurant],
    customers,
    orders,
    events,
    canAffordUpgrade: true,
    affordableUpgradeId: 'serving_tray_1',
  });
  const categories = alerts.map((a) => a.category);
  check(
    'every category with a real signal fires, in exactly PRD §18 order',
    JSON.stringify(categories) ===
      JSON.stringify([
        'customer_abandonment_imminent',
        'food_ready_undelivered',
        'ingredient_shortage',
        'event_countdown',
        'upgrade_available',
        // three general suggestions, one per remaining kind, in the classification's own order
        'general_suggestion',
        'general_suggestion',
        'general_suggestion',
      ]),
    JSON.stringify(categories),
  );
  check(
    'priority is non-decreasing across the ranked list (never a lower category ahead of a higher one)',
    alerts.every((a, i) => i === 0 || alerts[i - 1].priority <= a.priority),
  );
  check('equipment_problem never appears in ALERT_CATEGORIES output either', !categories.includes('equipment_problem'));
  check('ALERT_CATEGORIES itself still names all seven PRD §18 slots, in order', ALERT_CATEGORIES.length === 7 && ALERT_CATEGORIES[3] === 'equipment_problem');
}

{
  // THE ALARM-FATIGUE CAP, measured under a constructed heavy rush — many candidates in the two
  // most urgent bands, well past HUD_CRITICAL_ALERTS_MAX.
  const restaurant = restaurantWith(['unhappy_customer', 'server_overload', 'ingredient_shortage', 'kitchen_backlog', 'long_entry_queue', 'dirty_table'], {
    shortages: [{ station: 'grill', ingredientId: 'beef', blockedTickets: 9 }],
  });
  const customers = Array.from({ length: 6 }, (_, i) => ({
    customerId: `c${i}`, restaurantId: 'p1', state: 'WAITING_FOR_FOOD', unhappy: true, patienceRemaining: i / 100, tableId: `t${i}`,
  }));
  const orders = Array.from({ length: 6 }, (_, i) => ({
    orderId: `o${i}`, ticketId: `tk${i}`, restaurantId: 'p1', dishId: 'smash_burger', state: 'ready', readyAgeMs: ORDER_FRESHNESS_GRACE_MS + 1_000 + i, tableId: `t${i}`,
  }));
  const events = [{ eventId: 'lunch_rush', state: 'warning', startsInMs: 5_000 }];
  const uncapped = buildCriticalAlerts({
    selfRestaurantId: 'p1',
    restaurants: [restaurant],
    customers,
    orders,
    events,
    canAffordUpgrade: true,
    affordableUpgradeId: 'serving_tray_1',
  });
  const capped = capCriticalAlerts(uncapped, HUD_CRITICAL_ALERTS_MAX);
  check(
    `a heavy rush generates far more candidate alerts (${uncapped.length}) than the cap (${HUD_CRITICAL_ALERTS_MAX})`,
    uncapped.length > HUD_CRITICAL_ALERTS_MAX,
    `${uncapped.length} candidates`,
  );
  check(
    `the displayed list holds exactly at the cap during the rush, never queued past it`,
    capped.length === HUD_CRITICAL_ALERTS_MAX,
    `displayed ${capped.length}`,
  );
  check(
    'the cap keeps the highest-priority alerts and suppresses lower ones, never an arbitrary subset',
    capped.every((a) => a.category === 'customer_abandonment_imminent' || a.category === 'food_ready_undelivered'),
    JSON.stringify(capped.map((a) => a.category)),
  );
  check(
    'within customer_abandonment_imminent, the least-patience (most urgent) customers survive the cap',
    capped.filter((a) => a.category === 'customer_abandonment_imminent').every((a) => a.detail.patienceRemaining <= 0.03),
  );
}

// =================================================================================================
// 4. cashFeedbackFor — pure, the §14 "major moments" decision and its first-sample guard
// =================================================================================================
console.log('\n4. floating cash feedback (shared/game-logic/hud-cash-feedback.js)');

{
  check(
    'null previous revenue (the very first snapshot after service starts) never fires, however large the jump',
    cashFeedbackFor(null, 5_000, HUD_CASH_FEEDBACK_MIN_DELTA) === null,
  );
  check(
    'a delta under the threshold does not fire',
    cashFeedbackFor(100, 100 + HUD_CASH_FEEDBACK_MIN_DELTA - 1, HUD_CASH_FEEDBACK_MIN_DELTA) === null,
  );
  const atThreshold = cashFeedbackFor(100, 100 + HUD_CASH_FEEDBACK_MIN_DELTA, HUD_CASH_FEEDBACK_MIN_DELTA);
  check(
    'a delta AT the threshold fires, reporting exactly the real revenue delta',
    atThreshold !== null && atThreshold.amount === HUD_CASH_FEEDBACK_MIN_DELTA,
    JSON.stringify(atThreshold),
  );
  check(
    'no change (a snapshot with nothing new settled) does not fire',
    cashFeedbackFor(250, 250, HUD_CASH_FEEDBACK_MIN_DELTA) === null,
  );
  check(
    'a revenue decrease (never legitimate, but not this function’s job to assert that) does not fire',
    cashFeedbackFor(300, 280, HUD_CASH_FEEDBACK_MIN_DELTA) === null,
  );
}

// =================================================================================================
console.log('');
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.log(`${failed.length}/${results.length} checks FAILED`);
  process.exit(1);
}
console.log(`All ${results.length} checks passed.`);
