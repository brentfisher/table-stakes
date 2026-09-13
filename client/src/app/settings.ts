// STORY-023 AC: "Settings exposes audio, fullscreen, reduced motion, and graphics-quality
// preference controls; persisting them (e.g. localStorage) is in scope. Audio layer gains are
// also broadcast here so the in-match procedural mixer can react without coupling React to the
// renderer. Graphics quality and reduced motion remain save-only preferences for now.

export type GraphicsQuality = 'low' | 'medium' | 'high';

export interface Settings {
  /** Master and layer gains, expressed as percentages. */
  audioVolume: number;
  audioMuted: boolean;
  audioMusicVolume: number;
  audioAmbienceVolume: number;
  audioEffectsVolume: number;
  /** Whether a match start should request fullscreen — the request itself (Fullscreen API) is
   * a browser affordance `SettingsPanel` can trigger directly without touching the renderer;
   * auto-requesting it ON MATCH START is the part left for a later story to wire in. */
  fullscreenPreferred: boolean;
  reducedMotion: boolean;
  graphicsQuality: GraphicsQuality;
  /** STORY-032. The main-menu neon sign (`NeonSign.ts`) is the one renderer that DOES read this
   * module today — `reducedMotion` above turns off its sparks/parallax, same as the OS-level
   * preference it defaults from. Everything else in this file is still save-only. */
  menuSignSparks: boolean;
  menuSignBloom: number;
}

export const DEFAULT_SETTINGS: Settings = {
  audioVolume: 80,
  audioMuted: false,
  audioMusicVolume: 40,
  audioAmbienceVolume: 45,
  audioEffectsVolume: 75,
  fullscreenPreferred: false,
  // Respect the OS-level signal out of the box where we can read one; still just a stored
  // preference either way, per the AC's "wiring them into the renderer is not [in scope]".
  reducedMotion:
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  graphicsQuality: 'medium',
  menuSignSparks: true,
  menuSignBloom: 0.6,
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
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    for (const key of ['audioVolume', 'audioMusicVolume', 'audioAmbienceVolume', 'audioEffectsVolume'] as const) {
      merged[key] = typeof merged[key] === 'number' && Number.isFinite(merged[key]) ? Math.max(0, Math.min(100, merged[key])) : DEFAULT_SETTINGS[key];
    }
    merged.audioMuted = merged.audioMuted === true;
    return merged;
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
  window.dispatchEvent(new CustomEvent('restaurant-settings-changed', { detail: settings }));
}
