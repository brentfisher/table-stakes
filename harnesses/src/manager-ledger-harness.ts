import {
  classifyManagerConstraints,
  type ManagerConstraintInput,
} from '../../shared/game-logic/manager-ledger.js';
import type { SceneHarness } from './harness-shell';

const BASE: ManagerConstraintInput = {
  chosenParties: 12, lostToRival: 0, leftDistrict: 0,
  queueLength: 0, longQueueThreshold: 4, dirtyTables: 0, unhappyGuests: 0,
  queuedTickets: 0, kitchenQueueThreshold: 3, oldestReadyFoodMs: 0, freshnessGraceMs: 10_000,
  blockingTickets: 0, unavailableDishes: 0, pantryRisk: 'STOCKED',
  activeFocusId: 'rush_pass', recommendedFocusId: 'premium_first',
};

const SCENARIOS: Array<{ id: string; name: string; input: Partial<ManagerConstraintInput> }> = [
  { id: 'steady', name: 'Steady service', input: {} },
  { id: 'demand', name: 'Demand loss', input: { chosenParties: 4, lostToRival: 8, leftDistrict: 2 } },
  { id: 'service', name: 'Dining-room jam', input: { queueLength: 7, dirtyTables: 2, unhappyGuests: 1 } },
  { id: 'production', name: 'Kitchen backlog', input: { queuedTickets: 6, oldestReadyFoodMs: 18_000 } },
  { id: 'inventory', name: 'Stockout', input: { blockingTickets: 2, unavailableDishes: 2, pantryRisk: 'BLOCKING' } },
  { id: 'priority', name: 'Wrong focus', input: { activeFocusId: 'premium_first', recommendedFocusId: 'save_ingredients' } },
];

const LABELS: Record<string, string> = {
  demand_conversion: 'Demand conversion', seating_service: 'Seating / service',
  production: 'Production capacity', inventory: 'Inventory availability', prioritization: 'Prioritization',
};

export const managerLedgerHarness: SceneHarness = (() => {
  let root: HTMLElement | null = null;
  return {
    id: 'manager-ledger',
    title: "Manager's Ledger",
    description: 'HTML preview of compact command chips, the shared five-constraint diagnosis, and evidence-backed results.',
    mount(container) {
      root = container;
      const stage = document.createElement('section');
      stage.className = 'manager-ledger-preview';
      const header = document.createElement('header');
      header.innerHTML = '<span>STORY 037 · LIVE MANAGEMENT SYNTHESIS</span><h2>Manager\'s Ledger</h2><p>Switch the observed pressure. The cards below use the same diagnosis function as the server.</p>';
      const controls = document.createElement('nav');
      controls.className = 'manager-ledger-scenarios';
      const body = document.createElement('div');

      const render = (scenarioId: string) => {
        const scenario = SCENARIOS.find((item) => item.id === scenarioId) ?? SCENARIOS[0];
        const result = classifyManagerConstraints({ ...BASE, ...scenario.input });
        for (const button of controls.querySelectorAll('button')) {
          button.classList.toggle('is-active', button.dataset.scenario === scenario.id);
        }
        body.innerHTML = `
          <div class="manager-preview-chips">
            <article><span>Front door</span><strong>Lunch Express · $12</strong></article>
            <article><span>Dining room</span><strong>Run Ready Food · 1 temp · $4/cycle</strong></article>
            <article><span>Kitchen</span><strong>${scenario.id === 'priority' ? 'Premium First' : 'Rush the Pass'}</strong></article>
            <article class="risk-${String(({ ...BASE, ...scenario.input }).pantryRisk).toLowerCase().replace(/\s/g, '-')}"><span>Pantry</span><strong>${({ ...BASE, ...scenario.input }).pantryRisk} · 1 inbound</strong></article>
          </div>
          <div class="manager-preview-title"><span>TACTICAL OVERVIEW</span><strong>Dominant: ${result.dominantConstraint ? LABELS[result.dominantConstraint] : 'None observed'}</strong></div>
          <div class="manager-preview-constraints">
            ${result.constraints.map((constraint) => `
              <article class="is-${constraint.status}">
                <div><strong>${LABELS[constraint.id]}</strong><span>${constraint.id === result.dominantConstraint ? 'DOMINANT' : constraint.status.toUpperCase()}</span></div>
                <meter min="0" max="8" value="${constraint.score}"></meter>
                <p>${constraint.evidence}</p>
              </article>`).join('')}
          </div>
          <div class="manager-preview-results">
            <div><span>Special window</span><strong>7 / 11 decisions chose you</strong><small>3 delivered · $55.20 revenue · $18.40 check · 78 satisfaction · $12 spend</small></div>
            <div><span>Temporary labor</span><strong>$34.00</strong><small>$18 hire fee · $16 wages · 8 tasks completed</small></div>
            <div><span>Service restocks</span><strong>$27.00</strong><small>$6 market premium · 2 orders</small></div>
            <p><strong>What to change:</strong> ${result.dominantConstraint ? result.constraints.find((item) => item.id === result.dominantConstraint)?.evidence : 'No sustained constraint was observed.'} Every sentence names recorded evidence rather than claiming unmeasured lift.</p>
          </div>`;
      };

      for (const scenario of SCENARIOS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.scenario = scenario.id;
        button.textContent = scenario.name;
        button.addEventListener('click', () => render(scenario.id));
        controls.appendChild(button);
      }
      stage.append(header, controls, body);
      container.appendChild(stage);
      render('steady');
    },
    dispose() { root?.replaceChildren(); root = null; },
  };
})();
