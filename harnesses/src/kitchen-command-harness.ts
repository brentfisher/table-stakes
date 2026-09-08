import commandData from '../../shared/game-data/kitchen-command.json';
import { rankTicketsForFocus } from '../../shared/game-logic/kitchen-focus.js';
import type { KitchenFocusDefinition } from '../../shared/game-logic/kitchen-focus.js';
import type { SceneHarness } from './harness-shell';

const FOCUSES = commandData.focuses as KitchenFocusDefinition[];

const TICKETS = [
  { ticketId: 'nearly_plated', dish: 'Burger', completionProgress: .95, specialPressure: 0, remainingProductionMs: 9000, scarcityRisk: .5, margin: 5, patienceRisk: .2 },
  { ticketId: 'event_feature', dish: 'Nachos', completionProgress: .3, specialPressure: 2, remainingProductionMs: 7000, scarcityRisk: .5, margin: 6, patienceRisk: .3 },
  { ticketId: 'quick_clear', dish: 'Salad', completionProgress: .2, specialPressure: 0, remainingProductionMs: 1000, scarcityRisk: .4, margin: 4, patienceRisk: .1 },
  { ticketId: 'safe_stock', dish: 'Pasta', completionProgress: .4, specialPressure: 0, remainingProductionMs: 5000, scarcityRisk: .05, margin: 7, patienceRisk: .4 },
  { ticketId: 'premium_table', dish: 'Steak', completionProgress: .5, specialPressure: 0, remainingProductionMs: 8000, scarcityRisk: .8, margin: 24, patienceRisk: .5 },
  { ticketId: 'patience_risk', dish: 'Sandwich', completionProgress: .1, specialPressure: 0, remainingProductionMs: 6000, scarcityRisk: .6, margin: 8, patienceRisk: .98 },
];

export const kitchenCommandHarness: SceneHarness = (() => {
  let root: HTMLElement | null = null;
  return {
    id: 'kitchen-command',
    title: 'Kitchen Command',
    description: 'Compare the same six-ticket rail under every data-defined kitchen focus.',
    mount(container) {
      root = container;
      const stage = document.createElement('section');
      stage.className = 'kitchen-command-preview';
      const heading = document.createElement('div');
      heading.innerHTML = '<strong>EXPEDITE PASS · IDENTICAL TICKET MIX</strong><p>Each column uses the live shared ranking function. Only priority order changes.</p>';
      const grid = document.createElement('div');
      grid.className = 'kitchen-command-comparison';
      for (const focus of FOCUSES) {
        const ranked = rankTicketsForFocus(focus, TICKETS, (a, b) => a.ticketId.localeCompare(b.ticketId));
        const card = document.createElement('article');
        card.innerHTML = `<h2>${focus.name}</h2><p>${focus.benefit}</p><p class="tradeoff">Trade-off: ${focus.downside}</p>` +
          `<ol>${ranked.map((ticket, index) => `<li class="${index === 0 ? 'first' : ''}">${ticket.dish}${index === 0 ? ' · FIRST' : ''}</li>`).join('')}</ol>`;
        grid.appendChild(card);
      }
      stage.append(heading, grid);
      container.appendChild(stage);
    },
    dispose() { root?.replaceChildren(); root = null; },
  };
})();
