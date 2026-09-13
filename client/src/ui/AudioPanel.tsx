import { useEffect, useRef, useState } from 'react';
import type { RestaurantAudio, AudioCue } from '../audio/RestaurantAudio';
import { loadSettings, saveSettings, type Settings } from '../app/settings';

export function AudioPanel({ audio }: { audio: RestaurantAudio | null }): JSX.Element {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const [, refresh] = useState(0);
  useEffect(() => {
    if (!audio) return;
    audio.onStateChange = () => refresh((value) => value + 1);
    return () => { audio.onStateChange = null; };
  }, [audio]);
  useEffect(() => {
    const change = (event: Event) => setSettings((event as CustomEvent<Settings>).detail ?? loadSettings());
    window.addEventListener('restaurant-settings-changed', change);
    window.addEventListener('storage', change);
    return () => { window.removeEventListener('restaurant-settings-changed', change); window.removeEventListener('storage', change); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [open]);
  const close = () => { setOpen(false); toggleRef.current?.focus(); };
  const patch = (next: Partial<Settings>) => {
    const updated = { ...settings, ...next }; setSettings(updated); saveSettings(updated);
    if (!updated.audioMuted) void audio?.unlock();
  };
  const preview = async (cue: AudioCue) => { await audio?.unlock(); audio?.cue(cue); };
  const state = !audio?.supported ? 'Unavailable' : settings.audioMuted || settings.audioVolume === 0 ? 'Muted' : audio.running ? 'Live mix' : 'Enable sound';
  return <aside ref={panelRef} className="restaurant-audio" aria-label="Restaurant sound" onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape') close(); }} onKeyUp={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
    <button ref={toggleRef} className="restaurant-audio-toggle" type="button" aria-expanded={open} aria-controls="restaurant-audio-mixer" onClick={() => { setOpen(!open); void audio?.unlock(); }}>
      <span aria-hidden="true">♫</span><span>Sound <small>{state}</small></span><span aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    {open && <section id="restaurant-audio-mixer" className="restaurant-audio-mixer" aria-label="Sound mixer">
      <header><span>THE HOUSE MIX</span><button type="button" onClick={close} aria-label="Close sound mixer">×</button></header>
      <h2>A little kitchen music.</h2><p>Soft piano, busy pans, and a bell when an order is ready for pickup.</p>
      <label className="restaurant-audio-mute"><input type="checkbox" checked={settings.audioMuted} onChange={(event) => patch({ audioMuted: event.target.checked })} />Mute all sound</label>
      {([['audioVolume', 'Master'], ['audioMusicVolume', 'Piano'], ['audioAmbienceVolume', 'Kitchen'], ['audioEffectsVolume', 'Game cues']] as const).map(([key, label]) => <label className="restaurant-audio-slider" key={key}><span>{label}</span><input type="range" min="0" max="100" step="1" value={settings[key]} disabled={settings.audioMuted} onChange={(event) => patch({ [key]: Number(event.target.value) })} /><output>{settings[key]}%</output></label>)}
      <div className="restaurant-audio-previews" aria-label="Preview sound cues">{([['earned', 'Cash'], ['ready', 'Plate ready'], ['win', 'Victory']] as const).map(([cue, label]) => <button key={cue} type="button" disabled={settings.audioMuted || settings.audioVolume === 0 || settings.audioEffectsVolume === 0 || !audio?.supported} onClick={() => void preview(cue)}>{label} <span aria-hidden="true">▷</span></button>)}</div>
      <p className="restaurant-audio-note">{!audio?.supported ? 'Audio is unavailable in this browser. ' : ''}Sound pauses in background tabs. Every game cue also has visual feedback.</p>
    </section>}
  </aside>;
}
