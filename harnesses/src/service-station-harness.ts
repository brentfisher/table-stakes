import data from '../../shared/game-data/service-station.json';
import type { SceneHarness } from './harness-shell';
import { DevControls } from './shared/dev-controls';

const CASES = {
  understaffed: { occupied: 6, dirty: 3, ready: 4, workers: 1, risk: 5, label: 'UNDERSTAFFED' },
  balanced: { occupied: 4, dirty: 1, ready: 1, workers: 3, risk: 1, label: 'BALANCED' },
  overstaffed: { occupied: 1, dirty: 0, ready: 0, workers: 4, risk: 0, label: 'OVERSTAFFED' },
} as const;

export const serviceStationHarness: SceneHarness = (() => {
  let root: HTMLElement | null = null;
  return {
    id: 'service-station', title: 'Service Station',
    description: 'Compare understaffed, balanced, and overstaffed dining rooms with temporary contracts.',
    mount(container) {
      root = container;
      const stage = document.createElement('section'); stage.className = 'service-preview';
      const controls = new DevControls('Dining-room fixture'); container.append(stage, controls.element);
      let caseId: keyof typeof CASES = 'understaffed'; let contractId = 'relief_server';
      const render = () => {
        const fixture = CASES[caseId]; const contract = data.contracts.find((item) => item.id === contractId)!;
        stage.innerHTML = `<div class="service-preview-board"><strong>DINING ROOM · ${fixture.label}</strong>` +
          `<h2>${fixture.occupied}/6 occupied · ${fixture.dirty} dirty</h2><p>${fixture.ready} ready dishes · ${fixture.workers} staff · ${fixture.risk} guests at risk</p>` +
          `<h3>${contract.name}</h3><p>${contract.benefit}</p><p>Trade-off: ${contract.downside}</p>` +
          `<small>$${contract.hireFee} hire · $${contract.wage}/${contract.wageIntervalMs / 1000}s · arrives ${contract.arrivalDelayMs / 1000}s · ${contract.durationMs / 1000}s contract</small></div>`;
      };
      controls.addSelect('Staffing case', Object.entries(CASES).map(([value, item]) => ({ value, label: item.label })), (value) => { caseId = value as keyof typeof CASES; render(); });
      controls.addSelect('Contract', data.contracts.map((item) => ({ value: item.id, label: item.name })), (value) => { contractId = value; render(); });
      render();
    },
    dispose() { root?.replaceChildren(); root = null; },
  };
})();
