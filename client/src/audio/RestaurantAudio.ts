import { loadSettings, type Settings } from '../app/settings';
import type { GameClientStatus } from '../game/GameClient';

export type AudioCue = 'earned' | 'ready' | 'pickup' | 'win';
/** Original procedural score and foley: no downloads or third-party samples; scheduled on the audio clock. */
export class RestaurantAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private room: GainNode | null = null;
  private effects: GainNode | null = null;
  private settings = loadSettings();
  private timer: number | undefined;
  private nextBeat = 0;
  private beat = 0;
  private active = false;
  private cooking = false;
  private readyOrders = new Set<string>();
  private voices = new Set<OscillatorNode>();
  private nextFoley = 0;
  private disposed = false;
  private seen = new Set<string>();
  private revenue: number | null = null;
  private complete = false;
  private lastCue = new Map<AudioCue, number>();
  onStateChange: (() => void) | null = null;
  get running(): boolean { return this.context?.state === 'running'; }
  get supported(): boolean { return typeof window.AudioContext === 'function'; }
  private visibility = () => {
    if (document.hidden) { this.stopVoices(); void this.context?.suspend().catch(() => {}); }
    else if (this.context && !this.settings.audioMuted) {
      this.nextBeat = this.context.currentTime + 0.08;
      this.nextFoley = this.context.currentTime + 2;
      void this.context.resume().catch(() => {});
    }
  };
  private changed = (event: Event) => { this.settings = (event as CustomEvent<Settings>).detail ?? loadSettings(); this.mix(); this.onStateChange?.(); };
  private gesture = (event: Event) => {
    if (event instanceof KeyboardEvent && (event.repeat || event.metaKey || event.ctrlKey || event.altKey)) return;
    if (!this.running) void this.unlock();
  };
  constructor() {
    window.addEventListener('pointerdown', this.gesture);
    window.addEventListener('keydown', this.gesture);
    window.addEventListener('restaurant-settings-changed', this.changed);
    window.addEventListener('storage', this.changed);
    document.addEventListener('visibilitychange', this.visibility);
  }
  async unlock(): Promise<void> {
    if (this.disposed || !this.supported || this.settings.audioMuted || document.hidden) return;
    try {
      if (!this.context) {
        const ctx = new AudioContext(); this.context = ctx;
        this.master = ctx.createGain(); this.master.gain.value = 0;
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -16; compressor.knee.value = 18; compressor.ratio.value = 5;
        this.master.connect(compressor); compressor.connect(ctx.destination);
        this.music = ctx.createGain(); this.room = ctx.createGain(); this.effects = ctx.createGain();
        this.music.connect(this.master); this.room.connect(this.master); this.effects.connect(this.master);
        ctx.onstatechange = () => this.onStateChange?.();
        this.timer = window.setInterval(() => this.schedule(), 100);
      }
      if (this.context.state !== 'running') await this.context.resume();
      if (this.disposed) return;
      this.mix(); this.onStateChange?.();
    } catch { this.onStateChange?.(); }
  }
  private mix(): void {
    const ctx = this.context; if (!ctx || !this.master) return;
    const level = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)) / 100;
    this.master.gain.setTargetAtTime(this.settings.audioMuted ? 0 : level(this.settings.audioVolume) * 0.7, ctx.currentTime, 0.04);
    this.music?.gain.cancelScheduledValues(ctx.currentTime);
    this.music?.gain.setTargetAtTime(level(this.settings.audioMusicVolume), ctx.currentTime, 0.25);
    this.room?.gain.setTargetAtTime(level(this.settings.audioAmbienceVolume), ctx.currentTime, 0.25);
    this.effects?.gain.setTargetAtTime(level(this.settings.audioEffectsVolume), ctx.currentTime, 0.04);
  }
  private tone(midi: number, at: number, duration: number, level: number, bus: GainNode, metal = false): void {
    const ctx = this.context;
    if (!ctx || this.disposed || this.voices.size >= 72) return;
    const fundamental = 440 * 2 ** ((midi - 69) / 12);
    const partials = metal ? [1, 2.76, 5.4] : [1, 2, 3];
    partials.forEach((ratio, index) => {
      const oscillator = ctx.createOscillator(); const envelope = ctx.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = fundamental * ratio;
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(level / (1 + index * 5), at + 0.006);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration / (1 + index * 0.4));
      oscillator.connect(envelope); envelope.connect(bus);
      this.voices.add(oscillator);
      oscillator.start(at); oscillator.stop(at + duration + 0.02);
      oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); this.voices.delete(oscillator); };
    });
  }
  private schedule(): void {
    const ctx = this.context;
    if (!ctx || !this.running || !this.active || this.settings.audioMuted || document.hidden) return;
    if (this.nextBeat < ctx.currentTime) this.nextBeat = ctx.currentTime + 0.04;
    while (this.nextBeat < ctx.currentTime + 0.22) {
      const chords = [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 53, 59]];
      const chord = chords[Math.floor(this.beat / 8) % chords.length];
      const step = this.beat % 8;
      if (step === 0) this.tone(chord[0] - 12, this.nextBeat, 2.5, 0.13, this.music!);
      const phrase = [1, 2, 3, 2, 1, 3, 2, -1];
      if (phrase[step] >= 0) this.tone(chord[phrase[step]], this.nextBeat, 1.9, 0.11, this.music!);
      // Sparse porcelain and low pan taps leave space for the actionable pass bell.

      this.beat++; this.nextBeat += 60 / 78 / 2;
    }
    if (ctx.currentTime >= this.nextFoley) {
      this.tone(82, ctx.currentTime + 0.03, 0.22, 0.028, this.room!, true);
      this.tone(89, ctx.currentTime + 0.17, 0.17, 0.018, this.room!, true);
      if (this.cooking) this.tone(45, ctx.currentTime + 0.31, 0.18, 0.045, this.room!, true);
      this.nextFoley = ctx.currentTime + (this.cooking ? 3.8 : 7) + Math.random() * 2;
    }
  }
  cue(cue: AudioCue): void {
    const ctx = this.context;
    if (!ctx || this.disposed || !this.running || this.settings.audioMuted || this.settings.audioVolume === 0 || this.settings.audioEffectsVolume === 0 || document.hidden) return;
    const now = ctx.currentTime;
    if (now - (this.lastCue.get(cue) ?? -Infinity) < (cue === 'ready' ? 1.2 : 0.35)) return;
    this.lastCue.set(cue, now);
    const notes: Record<AudioCue, number[]> = { earned: [84, 91], ready: [79, 86], pickup: [88], win: [72, 76, 79, 84, 83, 86, 91, 96] };
    notes[cue].forEach((note, index) => this.tone(note, now + 0.025 + index * (cue === 'win' ? 0.15 : 0.095), cue === 'win' ? 1.1 : 0.55, cue === 'pickup' ? 0.07 : 0.15, this.effects!, cue !== 'win'));
    this.music?.gain.cancelScheduledValues(now);
    this.music?.gain.setTargetAtTime(Math.max(0, Math.min(100, this.settings.audioMusicVolume)) / 100 * 0.35, now, 0.03);
    this.music?.gain.setTargetAtTime(Math.max(0, Math.min(100, this.settings.audioMusicVolume)) / 100, now + (cue === 'win' ? 1.8 : 0.45), 0.3);
  }
  update(status: GameClientStatus): void {
    const wasActive = this.active;
    this.active = status.connection === 'open' && !status.reconnecting && (status.matchPhase === 'service' || status.matchPhase === 'final_rush');
    this.cooking = status.orders.some(order => order.restaurantId === status.restaurantId && order.state === 'in_progress');
    if (wasActive && !this.active) this.stopVoices();
    const mine = status.orders.filter(order => order.restaurantId === status.restaurantId);
    // A ready ticket may have siblings still cooking. Ring only when the whole order can leave.
    const ready = new Set(mine.filter(order => order.state === 'ready' && !mine.some(sibling => sibling.orderId === order.orderId && (sibling.state === 'queued' || sibling.state === 'in_progress'))).map(order => order.orderId));
    if (this.active && wasActive && [...ready].some(id => !this.readyOrders.has(id))) this.cue('ready');
    this.readyOrders = ready;
    if (this.revenue !== null && status.revenue !== null && status.revenue > this.revenue && this.active && wasActive) this.cue('earned');
    this.revenue = status.revenue;
    for (const item of status.presentationEvents) {
      if (this.seen.has(item.key)) continue;
      this.seen.add(item.key);
      if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value!);
      if (!this.active || !wasActive) continue;
      if (item.event.type === 'owner-picked-up') this.cue('pickup');
    }
    if (status.matchComplete && !this.complete) {
      this.complete = true;
      if (status.matchComplete.winnerPlayerId !== null && (status.matchComplete.winnerPlayerId === status.playerId || status.matchComplete.winnerPlayerId === status.restaurantId)) this.cue('win');
    }
  }
  private stopVoices(): void {
    for (const voice of this.voices) { try { voice.stop(); } catch { /* Already finished. */ } }
  }
  dispose(): void {
    this.disposed = true;
    this.stopVoices();
    window.removeEventListener('pointerdown', this.gesture); window.removeEventListener('keydown', this.gesture);
    window.removeEventListener('restaurant-settings-changed', this.changed); window.removeEventListener('storage', this.changed);
    document.removeEventListener('visibilitychange', this.visibility);
    window.clearInterval(this.timer);
    if (this.context) { this.context.onstatechange = null; void this.context.close().catch(() => {}); }
    this.onStateChange = null;
  }
}
