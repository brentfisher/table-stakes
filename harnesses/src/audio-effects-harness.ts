// Standalone preview of the in-match procedural audio layer (`client/src/audio/RestaurantAudio.ts`)
// — every cue and the ambient foley/music layer, triggerable without a live match. No canvas: this
// harness has nothing to render, only sound to trigger and mixer state to inspect.
//
// `RestaurantAudio#update(status)` is how the real game drives `active`/`cooking`/the cue
// triggers, off a real `GameClientStatus`. Building one of those by hand here would duplicate (and
// drift from) that large, frequently-changing interface for fields this harness never reads —
// `fakeStatus` below is deliberately a `Partial<GameClientStatus>` double-cast to the full type,
// documented as covering only the handful of fields `RestaurantAudio#update` itself reads
// (`connection`, `reconnecting`, `matchPhase`, `orders`, `restaurantId`, `revenue`,
// `presentationEvents`, `matchComplete`, `playerId`) — anything else `update` is ever taught to
// read will silently read `undefined` here until this list is updated too.

import { RestaurantAudio } from '../../client/src/audio/RestaurantAudio';
import { loadSettings, saveSettings } from '../../client/src/app/settings';
import type { GameClientStatus } from '../../client/src/game/GameClient';
import { DevControls } from './shared/dev-controls';
import type { SceneHarness } from './harness-shell';

function fakeStatus(overrides: Partial<GameClientStatus>): GameClientStatus {
  return {
    connection: 'open',
    reconnecting: false,
    matchPhase: 'service',
    restaurantId: 'harness',
    playerId: 'harness',
    revenue: 0,
    orders: [],
    presentationEvents: [],
    matchComplete: null,
    ...overrides,
  } as unknown as GameClientStatus;
}

export const audioEffectsHarness: SceneHarness = (() => {
  let audio: RestaurantAudio | null = null;
  let active = false;
  let cooking = false;
  let statusReadout: ((value: string) => void) | null = null;
  let statusTimer: number | null = null;

  return {
    id: 'audio-effects',
    title: 'Audio Effects',
    description: 'Live preview of every RestaurantAudio cue and the ambient music/foley layer, with the real mixer controls.',

    mount(container: HTMLElement): void {
      const panel = new DevControls('Audio controls');
      container.append(panel.element);

      audio = new RestaurantAudio();
      const settings = loadSettings();

      panel.addButton('Unlock audio (required once, browser autoplay policy)', () => {
        void audio?.unlock();
      });
      statusReadout = panel.addReadout('Context state');
      panel.addSeparator();

      panel.addToggle('Muted', settings.audioMuted, (v) => {
        const next = { ...loadSettings(), audioMuted: v };
        saveSettings(next);
        window.dispatchEvent(new CustomEvent('restaurant-settings-changed', { detail: next }));
      });
      for (const [key, label] of [
        ['audioVolume', 'Master volume'],
        ['audioMusicVolume', 'Music volume'],
        ['audioAmbienceVolume', 'Ambience volume'],
        ['audioEffectsVolume', 'Effects volume'],
      ] as const) {
        panel.addSlider(label, { min: 0, max: 100, step: 5, value: settings[key] }, (v) => {
          const next = { ...loadSettings(), [key]: v };
          saveSettings(next);
          window.dispatchEvent(new CustomEvent('restaurant-settings-changed', { detail: next }));
        });
      }
      panel.addSeparator();

      const pushStatus = () => {
        const orders = cooking
          ? ([{ restaurantId: 'harness', orderId: 'o1', ticketId: 't1', state: 'in_progress' }] as unknown as GameClientStatus['orders'])
          : [];
        audio?.update(fakeStatus({ matchPhase: active ? 'service' : 'lobby', orders }));
      };
      panel.addToggle('Active (service running — required for ambient music/foley)', false, (v) => {
        active = v;
        pushStatus();
      });
      panel.addToggle('Cooking (adds the low foley layer)', false, (v) => {
        cooking = v;
        pushStatus();
      });
      panel.addSeparator();

      panel.addButton('Cue: earned (a table paid)', () => audio?.cue('earned'));
      panel.addButton('Cue: ready (a ticket hit the pass)', () => audio?.cue('ready'));
      panel.addButton('Cue: pickup (owner picked up a plate)', () => audio?.cue('pickup'));
      panel.addButton('Cue: win (match won)', () => audio?.cue('win'));

      statusTimer = window.setInterval(() => {
        if (!audio) return;
        statusReadout?.(`${audio.supported ? (audio.running ? 'running' : 'suspended/locked') : 'unsupported'} — active=${active} cooking=${cooking}`);
      }, 250);
    },

    dispose(): void {
      if (statusTimer !== null) window.clearInterval(statusTimer);
      statusTimer = null;
      audio?.dispose();
      audio = null;
      active = false;
      cooking = false;
    },
  };
})();
