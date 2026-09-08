import supplierData from '../../shared/game-data/pantry-restock.json';
import type { SceneHarness } from './harness-shell';
import { DevControls } from './shared/dev-controls';

const FIXTURES = {
  low_stock: { name: 'Lettuce', count: 4, incoming: 0, risk: 'WATCH', direction: 'MARKET', cause: 'Local suppliers are trading at the normal rate.', dishes: 'Smash Burger · Caesar Salad · Chicken Sandwich', blocked: 0, delay: 1 },
  shortage: { name: 'Lettuce', count: 0, incoming: 0, risk: 'BLOCKING', direction: 'MARKET', cause: 'No usable lettuce remains in the pantry.', dishes: 'Smash Burger · Caesar Salad · Chicken Sandwich', blocked: 3, delay: 1 },
  price_spike: { name: 'Lettuce', count: 4, incoming: 0, risk: 'WATCH', direction: 'EXPENSIVE', cause: 'Supplier shortage: lettuce +50%.', dishes: 'Smash Burger · Caesar Salad · Chicken Sandwich', blocked: 0, delay: 2 },
  emergency: { name: 'Ground Beef', count: 0, incoming: 6, risk: 'AT RISK', direction: 'EXPENSIVE', cause: 'Rush handling adds a 60% premium.', dishes: 'Smash Burger', blocked: 2, delay: .3 },
  bulk: { name: 'Potatoes', count: 3, incoming: 30, risk: 'WATCH', direction: 'DEAL', cause: 'Bulk rate saves 20% per unit.', dishes: 'Fries', blocked: 0, delay: 2 },
  delivery_delay: { name: 'Seasonal Vegetables', count: 0, incoming: 12, risk: 'AT RISK', direction: 'EXPENSIVE', cause: 'Supplier shortage doubles the delivery window.', dishes: 'Pasta Primavera', blocked: 1, delay: 2 },
} as const;

export const pantryBoardHarness: SceneHarness = (() => {
  let root: HTMLElement | null = null;
  return {
    id: 'pantry-board',
    title: 'Pantry Board',
    description: 'Exercise low stock, shortages, price spikes, emergency and bulk orders, and delayed deliveries.',
    mount(container) {
      root = container;
      const stage = document.createElement('section');
      stage.className = 'pantry-preview';
      const controls = new DevControls('Pantry fixture');
      container.append(stage, controls.element);
      let fixtureId: keyof typeof FIXTURES = 'low_stock';
      const render = () => {
        const fixture = FIXTURES[fixtureId];
        const orders = supplierData.products.map((product) => {
          const event = fixture.direction === 'EXPENSIVE' && fixtureId !== 'emergency' ? 1.5 : 1;
          const unitCost = .45 * product.unitCostMultiplier * event;
          return `<button><strong>${product.name}</strong><span>+${product.units} · $${(unitCost * product.units).toFixed(2)}</span><small>${Math.round(product.deliveryMs * fixture.delay / 100) / 10}s</small></button>`;
        }).join('');
        stage.innerHTML = `<article class="pantry-preview-board"><header><small>STOCKROOM TERMINAL</small><h2>PANTRY · ${fixture.risk}</h2></header>
          <div class="pantry-preview-stock"><strong>${fixture.name}</strong><b>${fixture.count} ON HAND</b><em>${fixture.direction}</em></div>
          <p>${fixture.cause}</p><p>Affects ${fixture.dishes}${fixture.blocked ? ` · BLOCKING ${fixture.blocked} TICKETS` : ''}</p>
          ${fixture.incoming ? `<div class="pantry-preview-inbound">INBOUND +${fixture.incoming}<progress max="100" value="42"></progress></div>` : ''}
          <div class="pantry-preview-options">${orders}</div></article>`;
      };
      controls.addSelect('Scenario', Object.keys(FIXTURES).map((value) => ({
        value,
        label: value.replace(/_/g, ' ').toUpperCase(),
      })), (value) => { fixtureId = value as keyof typeof FIXTURES; render(); });
      render();
    },
    dispose() { root?.replaceChildren(); root = null; },
  };
})();
