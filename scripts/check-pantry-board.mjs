#!/usr/bin/env node
import { inventorySystem, _internal } from '../server/src/game/systems/inventory-system.js';
import { handleInteract } from '../server/src/game/validators/action-validator.js';
import layout from '../shared/game-data/restaurant-layout.json' with { type: 'json' };

const results = [];
const check = (name, pass, detail = '') => {
  results.push(Boolean(pass));
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const setup = {
  menu: [{ dishId: 'smash_burger', price: 14 }],
  addons: [],
  startingInventory: { bun: 6, beef: 6, cheese: 6, lettuce: 6 },
  cashRemaining: 500,
};
function fakeMatch(seed = 'pantry-seed', cash = 500) {
  const telemetry = [];
  return {
    id: seed, elapsedMs: 0, phase: 'service', isServicePhase: true,
    players: new Map([['p1', {
      playerId: 'p1', setup: structuredClone(setup), position: { x: 0, y: 0, z: 0 },
      pendingAction: null, lastInteractSequence: 0, carrying: [],
    }]]),
    createRngStream() {
      let n = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
      return () => ((n = (n * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    },
    eventEffects: {}, restaurants: [], orders: [],
    brigade: { ownsRestocking: () => true },
    upgrades: { cashAvailable: () => cash },
    kitchen: {}, floor: {},
    logEvent(category, payload) { telemetry.push({ category, ...payload }); },
    telemetry,
  };
}

console.log('Pantry supplier board check\n');

const match = fakeMatch();
_internal.ensureState(match);
inventorySystem.update(match, 50);
const board = match.pantry.publicFor('p1');
check('every ingredient on the active menu appears on the pantry board',
  ['bun', 'beef', 'cheese', 'lettuce'].every((id) => board.ingredients.some((item) => item.ingredientId === id)));
const lettuce = board.ingredients.find((item) => item.ingredientId === 'lettuce');
check('an ingredient exposes count, risk, affected dishes, blocked impact, price and cause',
  lettuce.count === 6 && lettuce.risk && lettuce.affectedDishIds.includes('smash_burger') &&
  Number.isFinite(lettuce.blockedTickets) && lettuce.priceDirection && lettuce.explanation);
check('standard, emergency and bulk service-time options are all available',
  ['standard', 'emergency', 'bulk'].every((id) => lettuce.quotes.some((quote) => quote.productId === id)));
const standard = lettuce.quotes.find((quote) => quote.productId === 'standard');
const emergency = lettuce.quotes.find((quote) => quote.productId === 'emergency');
const bulk = lettuce.quotes.find((quote) => quote.productId === 'bulk');
check('emergency is materially faster and more expensive per unit than standard',
  emergency.deliveryMs < standard.deliveryMs / 2 && emergency.unitCost > standard.unitCost);
check('bulk is slower, larger and cheaper per unit than standard',
  bulk.deliveryMs > standard.deliveryMs && bulk.units > standard.units && bulk.unitCost < standard.unitCost);

const pantryPosition = layout.entities.find((entity) => entity.id === 'pantry').position;
match.players.get('p1').position = { x: pantryPosition[0], y: pantryPosition[1], z: pantryPosition[2] };
const accepted = handleInteract(match, 'p1', {
  targetId: 'pantry:emergency:lettuce', action: 'pantry_order', sequence: 1,
});
check('the server accepts a valid, in-range service-time supplier order', accepted.ok);
const afterOrder = match.pantry.publicFor('p1');
check('delivery progress is published to the HUD/world projection',
  afterOrder.deliveries.length === 1 && afterOrder.deliveries[0].arrivesInMs === emergency.deliveryMs);
match.elapsedMs += emergency.deliveryMs;
inventorySystem.update(match, 50);
check('an arrived order becomes owned pantry stock and leaves the inbound queue',
  match.pantry.publicFor('p1').deliveries.length === 0 &&
  match.pantry.stockOf('p1', 'lettuce') === emergency.units);
check('orders and arrivals emit structured telemetry',
  match.telemetry.some((event) => event.category === 'inventory_order_placed') &&
  match.telemetry.some((event) => event.category === 'inventory_order_delivered'));

const poor = fakeMatch('poor', 0);
_internal.ensureState(poor);
const rejected = poor.pantry.placeSupplierOrder('p1', 'standard', 'lettuce');
check('the server rejects an unaffordable order without mutation',
  !rejected.ok && rejected.reason === 'insufficient_cash' && poor.pantry.spentFor('p1') === 0);
const wrongPhase = fakeMatch('wrong-phase');
wrongPhase.phase = 'setup';
wrongPhase.isServicePhase = false;
_internal.ensureState(wrongPhase);
check('the supplier facade rejects an order outside service',
  wrongPhase.pantry.placeSupplierOrder('p1', 'standard', 'lettuce').reason === 'wrong_phase');
const constrained = fakeMatch('constraints');
_internal.ensureState(constrained);
const first = constrained.pantry.placeSupplierOrder('p1', 'standard', 'lettuce');
const second = constrained.pantry.placeSupplierOrder('p1', 'standard', 'beef');
const third = constrained.pantry.placeSupplierOrder('p1', 'standard', 'bun');
check('the supplier queue enforces its concurrent-order constraint',
  first.ok && second.ok && !third.ok && third.reason === 'supplier_queue_full');
check('only active-menu ingredients can be purchased',
  constrained.pantry.placeSupplierOrder('p1', 'standard', 'berries').reason === 'ingredient_not_on_menu');

function shortagePick(seed) {
  const candidate = fakeMatch(seed);
  candidate.eventEffects = { affectedIngredientCount: 1, ingredientCostMultiplier: 1.5, ingredientRestockDurationMultiplier: 2 };
  const state = _internal.ensureState(candidate);
  _internal.updateAffectedIngredients(candidate, state);
  return { pick: candidate.pantry.affectedIngredientIds()[0], board: candidate.pantry.publicFor('p1') };
}
const eventA = shortagePick('same-public-seed');
const eventB = shortagePick('same-public-seed');
const affected = eventA.board.ingredients.find((item) => item.ingredientId === eventA.pick);
check('supplier event selection is deterministic for the same public seed', eventA.pick === eventB.pick);
check('a price spike names the cause and changes both price and delivery time',
  affected.priceDirection === 'EXPENSIVE' && affected.explanation.includes('Supplier shortage') &&
  affected.quotes.find((quote) => quote.productId === 'standard').deliveryMs === standard.deliveryMs * 2);

const empty = fakeMatch('empty');
empty.players.get('p1').setup.startingInventory = {};
_internal.ensureState(empty);
inventorySystem.update(empty, 50);
const emptyLettuce = empty.pantry.publicFor('p1').ingredients.find((item) => item.ingredientId === 'lettuce');
check('a shortage alert names the ingredient and impacted dishes',
  emptyLettuce.risk === 'BLOCKING' && emptyLettuce.name === 'Lettuce' &&
  emptyLettuce.affectedDishIds.includes('smash_burger'));
check('shortage time is accumulated for results and shortage telemetry is emitted',
  empty.pantry.expensesFor('p1').shortageDurationMs === 50 &&
  empty.telemetry.some((event) => event.category === 'inventory_shortage_started'));

const resultMatch = fakeMatch('results-ledger');
_internal.ensureState(resultMatch);
const resultOrder = resultMatch.pantry.placeSupplierOrder('p1', 'standard', 'lettuce');
inventorySystem.onPhaseChange(resultMatch, { from: 'final_rush', to: 'results', atMs: 1000 });
const resultLedger = resultMatch.inventorySummary[0];
check('supplier spend, market premium, order count and shortage time are published for results',
  resultOrder.ok && resultLedger.inventoryExpenses === resultOrder.cost &&
  resultLedger.marketPremiumPaid === 0 && resultLedger.stockOrdersPlaced === 1 &&
  resultLedger.shortageDurationMs === 0);

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed.`);
if (results.some((pass) => !pass)) process.exitCode = 1;
