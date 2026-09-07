import specialsData from '../../shared/game-data/front-door-specials.json';
import type { SceneHarness } from './harness-shell';
import { DevControls } from './shared/dev-controls';

const SPECIALS = specialsData.specials;
const WAVES = [
  { id: 'office_rush', label: 'Office rush', queue: 4, market: 'Downtown Lunch' },
  { id: 'pre_theater_couples', label: 'Pre-theater couples', queue: 2, market: 'Uptown Pre-Theater' },
  { id: 'stadium_wave', label: 'Game-day groups', queue: 6, market: 'Stadium District' },
  { id: 'long_queue', label: 'Long waitlist', queue: 8, market: 'Any district' },
] as const;

export const frontDoorPolicyHarness: SceneHarness = (() => {
  let root: HTMLElement | null = null;
  return {
    id: 'front-door-policies',
    title: 'Front Door Policies',
    description: 'Preview every Maitre d special against customer-wave and event fixtures.',
    mount(container) {
      root = container;
      const stage = document.createElement('div');
      stage.className = 'front-door-preview';
      const board = document.createElement('section');
      board.className = 'front-door-preview-board';
      const street = document.createElement('div');
      street.className = 'front-door-preview-street';
      stage.append(street, board);
      const controls = new DevControls('Policy fixtures');
      container.append(stage, controls.element);

      let special = SPECIALS[0];
      let wave: (typeof WAVES)[number] = WAVES[0];
      let eventActive = true;
      const render = () => {
        const waveId: string = wave.id;
        const eligible = special.eligibility === waveId ||
          (special.eligibility === 'price_sensitive_wave' && waveId !== 'pre_theater_couples') ||
          (special.eligibility === 'active_event' && eventActive);
        street.replaceChildren();
        const sign = document.createElement('div');
        sign.className = 'front-door-preview-sign';
        sign.textContent = special.name.toUpperCase();
        const line = document.createElement('div');
        line.className = 'front-door-preview-line';
        for (let i = 0; i < wave.queue; i += 1) {
          const guest = document.createElement('span');
          guest.textContent = '●';
          line.appendChild(guest);
        }
        street.append(sign, line);
        board.innerHTML = `<strong>MAITRE D' BOARD</strong><h2>${special.name}</h2>` +
          `<p>${wave.market} · ${wave.queue} waiting · ${eventActive ? 'EVENT ACTIVE' : 'NO EVENT'}</p>` +
          `<p class="${eligible ? 'is-eligible' : 'is-ineligible'}">${eligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}</p>` +
          `<p>${special.benefit}</p><p>Trade-off: ${special.downside}</p>` +
          `<small>$${special.cost} · ${special.durationMs / 1000}s active · ${special.cooldownMs / 1000}s cooldown</small>`;
      };
      controls.addSelect('Special', SPECIALS.map((item) => ({ value: item.id, label: item.name })), (id) => {
        special = SPECIALS.find((item) => item.id === id) ?? SPECIALS[0]; render();
      });
      controls.addSelect('Customer wave', WAVES.map((item) => ({ value: item.id, label: item.label })), (id) => {
        wave = WAVES.find((item) => item.id === id) ?? WAVES[0]; render();
      });
      controls.addToggle('District event active', eventActive, (value) => { eventActive = value; render(); });
      render();
    },
    dispose() { root?.replaceChildren(); root = null; },
  };
})();
