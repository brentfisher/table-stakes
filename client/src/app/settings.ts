// STORY-023 AC: "Settings exposes audio, fullscreen, reduced motion, and graphics-quality
// preference controls; persisting them (e.g. localStorage) is in scope, wiring them into the
// renderer is not." This module is the persistence half only — plain load/save against
// `localStorage`, no dependency on `GameClient`/`SceneManager`. A later story that actually
// wires graphics quality or reduced motion into `SceneManager`/`RestaurantScene` reads these
// same values; this story does not touch those files (Notes: "must not touch GameClient/
// SceneManager internals").

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface Settings {
  /** 0-100. Not routed to any audio system yet — there isn't one in the codebase to route to. */
  audioVolume: number;
  audioMuted: boolean;
  /** Whether a match start should request fullscreen — the request itself (Fullscreen API) is
   * a browser affordance `SettingsPanel` can trigger directly without touching the renderer;
   * auto-requesting it ON MATCH START is the part left for a later story to wire in. */
  fullscreenPreferred: boolean;
  reducedMotion: boolean;
  graphicsQuality: GraphicsQuality;
}

export const DEFAULT_SETTINGS: Settings = {
  audioVolume: 80,
  audioMuted: false,
  fullscreenPreferred: false,
  // Respect the OS-level signal out of the box where we can read one; still just a stored
  // preference either way, per the AC's "wiring them into the renderer is not [in scope]".
  reducedMotion:
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  graphicsQuality: 'medium',
};

const STORAGE_KEY = 'rivalRestaurant.settings.v1';

export function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Merge over defaults rather than trusting the stored shape outright — a future story adding
    // a field must not crash on an older saved blob missing it.
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private-browsing storage quota or disabled localStorage — a lost preference is not worth
    // surfacing an error over; the next change attempts the write again.
  }
}
