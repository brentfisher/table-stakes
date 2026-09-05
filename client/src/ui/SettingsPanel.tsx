// STORY-023 AC: "Settings exposes audio, fullscreen, reduced motion, and graphics-quality
// preference controls; persisting them ... is in scope, wiring them into the renderer is not."
// See `client/src/app/settings.ts` for the persistence half and why "wiring in" is deliberately
// left for a later story. This is a modal overlay over `MainMenu`, same full-bleed-over-canvas
// pattern `SetupScreen`/`ResultsPanel` already use for the game routes (`app.css`'s `.setup`/
// `.results`) — here reused for a menu-level modal instead of a route-level one.

import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type GraphicsQuality, type Settings } from '../app/settings';

export function SettingsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [fullscreenActive, setFullscreenActive] = useState(() => Boolean(document.fullscreenElement));

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    // Fullscreen can be exited by the browser chrome (F11, the escape-hatch banner) without
    // going through the toggle button below — keep the displayed state honest either way.
    const onFullscreenChange = () => setFullscreenActive(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [onClose]);

  const patch = (next: Partial<Settings>) => setSettings((prev) => ({ ...prev, ...next }));

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      // A real browser affordance, not renderer state — safe to act on immediately rather than
      // only recording a preference, unlike `reducedMotion`/`graphicsQuality` below.
      void document.documentElement.requestFullscreen().catch(() => {
        // Some browsers refuse this outside a "recent user gesture" window under some embedding
        // contexts; nothing useful to show beyond leaving the toggle in its current state.
      });
    }
  };

  return (
    <div className="menu-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="menu-modal settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="menu-modal-header">
          <h2 id="settings-title">Settings</h2>
          <button type="button" className="menu-modal-close" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </div>

        <section className="settings-section">
          <h3>Audio</h3>
          <label className="settings-field">
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.audioVolume}
              disabled={settings.audioMuted}
              onChange={(event) => patch({ audioVolume: Number(event.target.value) })}
            />
            <span className="settings-value num">{settings.audioVolume}</span>
          </label>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={settings.audioMuted}
              onChange={(event) => patch({ audioMuted: event.target.checked })}
            />
            Mute
          </label>
          <p className="muted settings-note">No sound has shipped yet — this is saved for when it does.</p>
        </section>

        <section className="settings-section">
          <h3>Display</h3>
          <label className="settings-checkbox">
            <input type="checkbox" checked={fullscreenActive} onChange={toggleFullscreen} />
            Fullscreen now
          </label>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={settings.fullscreenPreferred}
              onChange={(event) => patch({ fullscreenPreferred: event.target.checked })}
            />
            Request fullscreen automatically when a match starts
          </label>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={settings.reducedMotion}
              onChange={(event) => patch({ reducedMotion: event.target.checked })}
            />
            Reduce motion
          </label>
          <p className="muted settings-note">
            Not applied to the scene yet — the renderer doesn&rsquo;t read this preference.
          </p>
        </section>

        <section className="settings-section">
          <h3>Graphics quality</h3>
          <div className="settings-field">
            <select
              value={settings.graphicsQuality}
              onChange={(event) => patch({ graphicsQuality: event.target.value as GraphicsQuality })}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <p className="muted settings-note">Saved only — no renderer setting reads this yet.</p>
        </section>

        <button
          type="button"
          className="settings-reset"
          onClick={() => setSettings(DEFAULT_SETTINGS)}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
