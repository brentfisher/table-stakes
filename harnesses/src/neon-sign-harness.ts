// Standalone preview of the "TABLE / STAKES" main-menu marquee (STORY-032's
// `client/src/scenes/NeonSign.ts`), so its sparks/bloom/reduced-motion knobs can be tuned without
// going through the real main menu. `NeonRestaurantSign` owns its own renderer and
// `requestAnimationFrame` loop (via `renderer.setAnimationLoop`) — this harness only has to hand
// it a sized container, wire `DevControls` to `configure()`, and dispose it on teardown.

import { NeonRestaurantSign } from '../../client/src/scenes/NeonSign';
import { DevControls } from './shared/dev-controls';
import type { SceneHarness } from './harness-shell';

export const neonSignHarness: SceneHarness = (() => {
  let sign: NeonRestaurantSign | null = null;

  return {
    id: 'neon-sign',
    title: 'Neon Sign',
    description: 'Standalone preview of the main-menu neon sign, with live sparks/bloom/reduced-motion controls.',

    mount(container: HTMLElement): void {
      const viewport = document.createElement('div');
      viewport.className = 'harness-viewport';
      const panel = new DevControls('Neon sign controls');
      container.append(viewport, panel.element);

      sign = new NeonRestaurantSign(viewport, { sparks: true, bloom: 0.6, reducedMotion: false });
      const activeSign = sign;

      panel.addToggle('Sparks', true, (value) => activeSign.configure({ sparks: value }));
      panel.addSlider('Bloom', { min: 0, max: 1.5, step: 0.05, value: 0.6 }, (value) => activeSign.configure({ bloom: value }));
      panel.addToggle('Reduced motion', false, (value) => activeSign.configure({ reducedMotion: value }));
      panel.addSeparator();
      panel.addButton('Trigger spark burst', () => activeSign.spark(60));
    },

    dispose(): void {
      sign?.dispose();
      sign = null;
    },
  };
})();
