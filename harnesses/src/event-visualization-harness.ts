// PRD §15.4 Event visualization harness.
//
// Purpose: trigger any event by name, hold its warning/active/ended states indefinitely for
// inspection, and preview the environmental changes (foot traffic, district props, lighting,
// crowd density, weather) that PRD §15.4 lists alongside them — §9's "an event must read as an
// actionable decision, not just a moved number" is checked here by reading a banner cold, out of
// match context, the same way STORY-018/019's own headers describe checking their own systems.
//
// NO LIVE SIMULATION IMPORTED. There is no ticking event-system.js underneath — `harnesses/
// tsconfig.json` does not even include `server/`, so nothing here could import it if it wanted
// to. What's real: `shared/game-data/events.json` verbatim (title, description, warningMs,
// durationMs, effects — the SAME catalogue `event-system.js` reads) and `EVENT_STATES` from
// `shared/schemas/messages.js`. Combining several simultaneously-active events'
// effects (`resolveEffects`) is server-only logic this harness has no reason to reproduce: only
// ONE event is ever previewed at a time here.
//
// DATA-DRIVEN, ON PURPOSE (this story's own AC): the event dropdown, the description panel and
// "apply this event's foot traffic" all read `EVENTS[selectedEventIndex]` — nowhere does this
// file branch on an event id. Add an eleventh event to `events.json` and it appears in the
// dropdown with no code change, exactly as `dishesUsingStation`'s sibling pattern in
// kitchen-bottleneck-harness.ts proves for dishes.
//
// HELD INDEFINITELY, NOT A TIMER. `previewState` only changes when a control-panel button is
// clicked — there is no auto-advance from warning -> active -> ended the way the live deck
// would. The displayed countdown still ticks (real seconds, clamped at 0) so a "12s left"
// readout is inspectable exactly as it will look live, but it never forces the state away; §15.4
// asks for a state a human "can preview... and hold indefinitely for inspection."
//
// ONE BANNER, EVERY STATE — WIDER THAN WHAT THE LIVE CLIENT SHOWS TODAY. `EventBanner.tsx` only
// renders while `state === 'active'`; the 'warning' countdown lives instead in `HudPanel.tsx`'s
// "Next: X in Ns" line, and 'ended' has no consumer in the UI at all yet (only
// `RestaurantScene#updateEventEffect`'s ambient tint reads 'active' specifically, and reverts to
// neutral for every other state — this harness reuses that exact method via `updateFloorState`,
// so the tint only appears while previewing 'active', matching live behaviour precisely). This
// harness's own banner unifies all three into one previewable surface, labelled with the state
// name, because §15.4 asks to preview all three — not to reproduce today's split UI.
//
// FOOT TRAFFIC, PROPS, LIGHTING, CROWD DENSITY AND WEATHER ARE INDEPENDENT, HUMAN-DRIVEN TOGGLES
// (§15.4 "individually togglable"), not values derived from the selected event — a reviewer
// checking that AC must be able to move foot traffic without touching the event dropdown at all.
// "Apply selected event's foot traffic" is a separate, explicit one-shot button that reads
// `effects.footTrafficMultiplier` and moves the SAME toggle a human could move themselves; §9's
// "creates an actionable decision" is best judged with the environment set up like the moment an
// event actually lands, which is what that button is for.
//
// DISTRICT PROPS, CROWD DENSITY AND WEATHER HAVE NO LIVE COUNTERPART ANYWHERE IN THIS CODEBASE —
// same situation kitchen-bottleneck-harness.ts's own header describes for `repair`. They are
// this harness's own invention, kept cheap: three static meshes toggled as one group, a handful
// of static ambient markers toggled by count, and a `THREE.Fog` toggle — no particle system, no
// per-frame simulation. Foot traffic is the one exception that reuses a REAL mechanism
// (`RestaurantScene.upsertCustomer`, the same segment-tinted customer body STORY-016 built).

import * as THREE from 'three';
import type { SceneHarness } from './harness-shell';
import { RestaurantScene, CameraController, type CustomerRenderState } from './shared/scene-primitives';
import { DevControls } from './shared/dev-controls';
import eventsData from '../../shared/game-data/events.json';
import segmentsData from '../../shared/game-data/customer-segments.json';
import type { EventState, SnapshotEventEntry } from '../../shared/schemas/messages';
import type { RestaurantSnapshot, Vec3 } from '../../shared/schemas/game-state';

// --- Event catalogue (data-driven; see this file's own header) --------------------------------

interface EventEffects {
  footTrafficMultiplier: number;
  partySizeMultiplier: number;
  segmentWeightOverrides?: Record<string, number>;
  dishTagDemandMultipliers?: Record<string, number>;
  patienceMultiplier?: number;
  [otherEffectKey: string]: unknown;
}
interface EventDef {
  id: string;
  title: string;
  description: string;
  warningMs: number;
  durationMs: number;
  effects: EventEffects;
}
// `as unknown as` — same justification as `kitchen-bottleneck-harness.ts`'s cast of
// `dishesData.dishes`: each event literal's `effects` infers its own narrowed shape, which no
// single `EventEffects` satisfies directly; the JSON is trusted input.
const EVENTS = eventsData.events as unknown as EventDef[];

interface SegmentDef { id: string; name: string }
const SEGMENTS = segmentsData.segments as unknown as SegmentDef[];

// --- Spatial reference points ------------------------------------------------------------------
// PRD §14 "street/entry" zone (`restaurant-layout.json` bounds z -12..-8) is where a passerby, a
// foot-traffic surge, an ambient crowd and district props would all actually be — reusing one
// real zone rather than inventing new coordinates per control.

const STREET_Z = -10.5;
const CROWD_Z = -13.5;
const FOOT_TRAFFIC_X_SPREAD = 7.5;
const CROWD_X_SPREAD = 8.5;

const EVENT_CAMERA = { height: 27, distance: 25, angle: 0.28, fov: 48 } as const;

const RESTAURANT_ID = 'harness_restaurant';
const MAX_FOOT_TRAFFIC = 12;
const MAX_CROWD = 10;

const FOOT_TRAFFIC_PRESETS = [
  { value: '0', label: 'None' },
  { value: '2', label: 'Low (2)' },
  { value: '4', label: 'Baseline (4)' },
  { value: '8', label: 'Surge (8)' },
  { value: '12', label: 'Overwhelmed (12)' },
];
const CROWD_PRESETS = [
  { value: '0', label: 'None' },
  { value: '3', label: 'Low' },
  { value: '6', label: 'Medium' },
  { value: '10', label: 'High' },
];
type WeatherMode = 'clear' | 'overcast' | 'rain';
const WEATHER_OPTIONS: { value: WeatherMode; label: string }[] = [
  { value: 'clear', label: 'Clear' },
  { value: 'overcast', label: 'Overcast' },
  { value: 'rain', label: 'Rain' },
];

/** A "device frame" the viewport is constrained to, so the event UI can be inspected at several
 * sizes without relaunching (§15.4). `null` (Full) removes the constraint. */
const VIEWPORT_PRESETS: Record<string, { width: string; height: string } | null> = {
  full: null,
  desktop: { width: '1280px', height: '800px' },
  tablet: { width: '834px', height: '1024px' },
  mobile: { width: '390px', height: '740px' },
};
const VIEWPORT_PRESET_OPTIONS = [
  { value: 'full', label: 'Full (fill panel)' },
  { value: 'desktop', label: 'Desktop 1280×800' },
  { value: 'tablet', label: 'Tablet 834×1024' },
  { value: 'mobile', label: 'Mobile 390×740' },
];

function fmtSeconds(ms: number): string {
  return `${Math.max(0, Math.ceil(ms / 1000))}s`;
}

export const eventVisualizationHarness: SceneHarness = createEventVisualizationHarness();

function createEventVisualizationHarness(): SceneHarness {
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: RestaurantScene | null = null;
  let camera: CameraController | null = null;
  let frame = 0;
  let observer: ResizeObserver | null = null;

  let selectedEventIndex = 0;
  let previewState: 'idle' | EventState = 'idle';
  let previewSinceMs = 0;
  let simClockMs = 0;

  let footTrafficCount = 4;
  let footTrafficSegmentIds: string[] = SEGMENTS.map((s) => s.id);
  let activeFootTrafficIds: string[] = [];
  let crowdCount = 3;
  let crowdMarkers: THREE.Mesh[] = [];
  let districtProps: THREE.Group | null = null;
  let districtPropsVisible = true;
  let nightLighting = false;
  let weather: WeatherMode = 'clear';

  function currentEvent(): EventDef {
    return EVENTS[selectedEventIndex];
  }

  // --- foot traffic (reuses the real customer entity — see this file's header) ----------------

  function applyFootTraffic(count: number, segmentIds?: string[]): void {
    footTrafficCount = count;
    if (segmentIds) footTrafficSegmentIds = segmentIds;
    if (!scene) return;
    for (const id of activeFootTrafficIds) scene.removeCustomer(id);
    activeFootTrafficIds = [];
    const clamped = Math.min(count, MAX_FOOT_TRAFFIC);
    for (let i = 0; i < clamped; i += 1) {
      const id = `harness_foot_traffic_${i}`;
      const t = clamped > 1 ? i / (clamped - 1) : 0.5;
      const position: Vec3 = { x: (t - 0.5) * 2 * FOOT_TRAFFIC_X_SPREAD, y: 0, z: STREET_Z };
      const segmentId = footTrafficSegmentIds[i % footTrafficSegmentIds.length];
      const state: CustomerRenderState = {
        customerId: id,
        position,
        patienceRemaining: 1,
        unhappy: false,
        segmentId,
      };
      scene.upsertCustomer(state);
      activeFootTrafficIds.push(id);
    }
  }

  /** §15.4's "environmental changes that accompany" an event — moves the SAME foot-traffic
   * toggle a human could move (see this file's header on why this is a one-shot button, not a
   * derived value). `footTrafficMultiplier` is 1.0-relative; 4 is this harness's own baseline. */
  function footTrafficPresetForMultiplier(multiplier: number): string {
    if (multiplier <= 0.7) return '2';
    if (multiplier < 1.05) return '4';
    if (multiplier < 1.5) return '8';
    return '12';
  }

  // --- ambient crowd, district props, weather (invented — see this file's header) -------------

  function applyCrowd(count: number): void {
    crowdCount = count;
    const clamped = Math.min(count, MAX_CROWD);
    crowdMarkers.forEach((mesh, i) => { mesh.visible = i < clamped; });
  }

  function buildCrowdMarkers(root: THREE.Scene): THREE.Mesh[] {
    const geometry = new THREE.CylinderGeometry(0.22, 0.28, 1.1, 6);
    const material = new THREE.MeshStandardMaterial({ color: 0x5a6068 });
    const markers: THREE.Mesh[] = [];
    for (let i = 0; i < MAX_CROWD; i += 1) {
      const mesh = new THREE.Mesh(geometry, material);
      const t = MAX_CROWD > 1 ? i / (MAX_CROWD - 1) : 0.5;
      mesh.position.set((t - 0.5) * 2 * CROWD_X_SPREAD, 0.55, CROWD_Z + (i % 2 === 0 ? 0 : 0.8));
      mesh.visible = false;
      root.add(mesh);
      markers.push(mesh);
    }
    return markers;
  }

  /** Three simple static fixtures at the street edge — a streetlamp either side, one banner —
   * toggled as a single group. No live district-props system exists to reuse (see header). */
  function buildDistrictProps(root: THREE.Scene): THREE.Group {
    const group = new THREE.Group();
    const lampGeometry = new THREE.CylinderGeometry(0.06, 0.08, 3.2, 8);
    const lampMaterial = new THREE.MeshStandardMaterial({ color: 0x2c343d });
    const lampHeadGeometry = new THREE.SphereGeometry(0.22, 12, 12);
    const lampHeadMaterial = new THREE.MeshStandardMaterial({ color: 0xe0c02f, emissive: 0xe0c02f, emissiveIntensity: 0.6 });
    for (const x of [-8.5, 8.5]) {
      const pole = new THREE.Mesh(lampGeometry, lampMaterial);
      pole.position.set(x, 1.6, STREET_Z - 0.6);
      group.add(pole);
      const head = new THREE.Mesh(lampHeadGeometry, lampHeadMaterial);
      head.position.set(x, 3.2, STREET_Z - 0.6);
      group.add(head);
    }
    const bannerGeometry = new THREE.BoxGeometry(3.5, 0.9, 0.08);
    const bannerMaterial = new THREE.MeshStandardMaterial({ color: 0xa855d9 });
    const banner = new THREE.Mesh(bannerGeometry, bannerMaterial);
    banner.position.set(0, 2.6, STREET_Z - 1.2);
    group.add(banner);
    root.add(group);
    return group;
  }

  function applyWeather(mode: WeatherMode): void {
    weather = mode;
    if (!scene) return;
    if (mode === 'clear') { scene.scene.fog = null; return; }
    const color = mode === 'rain' ? 0x39424c : 0x5a6068;
    scene.scene.fog = new THREE.Fog(color, 20, 62);
  }

  // --- preview state, banner, scene sync -------------------------------------------------------

  function setPreviewState(next: 'idle' | EventState): void {
    previewState = next;
    previewSinceMs = simClockMs;
  }

  function eventEntries(): SnapshotEventEntry[] {
    if (previewState === 'idle') return [];
    const event = currentEvent();
    const elapsed = simClockMs - previewSinceMs;
    if (previewState === 'warning') {
      return [{ eventId: event.id, state: 'warning', startsInMs: Math.max(0, event.warningMs - elapsed) }];
    }
    if (previewState === 'active') {
      return [{ eventId: event.id, state: 'active', endsInMs: Math.max(0, event.durationMs - elapsed) }];
    }
    return [{ eventId: event.id, state: 'ended' }];
  }

  function syncScene(): void {
    if (!scene) return;
    const restaurant: RestaurantSnapshot = {
      restaurantId: RESTAURANT_ID,
      playerId: RESTAURANT_ID,
      reputation: 60,
      queueLength: 0,
      seatsTotal: 12,
      seatsAvailable: 12,
      projectedWaitMs: 0,
      guestsServed: 0,
      averageSatisfaction: 0,
      abandonedParties: 0,
      tables: [],
      shortages: [],
    };
    // The ambient event tint (`RestaurantScene#updateEventEffect`) reads this array and only
    // reacts to `state === 'active'` — reused verbatim, not reimplemented, so the harness proves
    // the SAME tint the live game shows, not a lookalike.
    scene.updateFloorState({
      selfRestaurantId: RESTAURANT_ID,
      restaurants: [restaurant],
      customers: [],
      orders: [],
      events: eventEntries(),
    });
  }

  function refreshBanner(bannerEl: HTMLDivElement, titleEl: HTMLSpanElement, timeEl: HTMLSpanElement, descEl: HTMLParagraphElement): void {
    if (previewState === 'idle') { bannerEl.hidden = true; return; }
    bannerEl.hidden = false;
    const event = currentEvent();
    const entry = eventEntries()[0];
    const stateLabel = previewState.toUpperCase();
    titleEl.textContent = `[${stateLabel}] ${event.title}`;
    if (entry?.state === 'warning') timeEl.textContent = `starts in ${fmtSeconds(entry.startsInMs ?? 0)}`;
    else if (entry?.state === 'active') timeEl.textContent = `${fmtSeconds(entry.endsInMs ?? 0)} left`;
    else timeEl.textContent = '';
    descEl.textContent = event.description;
  }

  function applyViewportPreset(viewport: HTMLDivElement, key: string): void {
    const preset = VIEWPORT_PRESETS[key];
    if (!preset) {
      viewport.style.width = '';
      viewport.style.maxWidth = '';
      viewport.style.height = '';
      viewport.style.maxHeight = '';
      viewport.style.margin = '';
      viewport.style.outline = '';
    } else {
      viewport.style.width = '100%';
      viewport.style.maxWidth = preset.width;
      viewport.style.height = preset.height;
      viewport.style.maxHeight = preset.height;
      viewport.style.margin = '0 auto';
      viewport.style.outline = '2px dashed #7fd4ff';
    }
  }

  return {
    id: 'event-visualization',
    title: 'Event Visualization',
    description:
      'Trigger any event by name, hold its warning/active/ended states for inspection, and preview ' +
      'foot traffic, district props, lighting, crowd density and weather. PRD §15.4.',

    mount(container: HTMLElement): void {
      const viewport = document.createElement('div');
      viewport.className = 'harness-viewport';
      const panel = new DevControls('Event visualization controls');
      container.append(viewport, panel.element);

      scene = new RestaurantScene({ showDebugGrid: false, showCompetitor: false });
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(viewport.clientWidth, Math.max(1, viewport.clientHeight));
      viewport.appendChild(renderer.domElement);

      camera = new CameraController(viewport.clientWidth / Math.max(1, viewport.clientHeight));
      camera.setSettings(EVENT_CAMERA);
      camera.setTarget(0, -3);

      // --- reset all mock/harness-only state fresh on every mount ---------------------------
      selectedEventIndex = 0;
      previewState = 'idle';
      previewSinceMs = 0;
      simClockMs = 0;
      activeFootTrafficIds = [];
      footTrafficSegmentIds = SEGMENTS.map((s) => s.id);
      districtPropsVisible = true;
      nightLighting = false;
      weather = 'clear';

      crowdMarkers = buildCrowdMarkers(scene.scene);
      districtProps = buildDistrictProps(scene.scene);
      applyCrowd(crowdCount);
      applyFootTraffic(footTrafficCount);

      // --- banner overlay (this file's own DOM; see header on why one banner covers all states)
      const bannerEl = document.createElement('div');
      bannerEl.className = 'event-preview-banner';
      const titleEl = document.createElement('span');
      titleEl.className = 'event-preview-banner-title';
      const timeEl = document.createElement('span');
      timeEl.className = 'event-preview-banner-time';
      const descEl = document.createElement('p');
      descEl.className = 'event-preview-banner-desc';
      bannerEl.append(titleEl, timeEl, descEl);
      bannerEl.hidden = true;
      viewport.appendChild(bannerEl);

      // --- Event selection (§15.4 "every event can be triggered by name") -------------------
      panel.addSelect(
        'Event',
        EVENTS.map((e, i) => ({ value: String(i), label: e.title })),
        (v) => {
          selectedEventIndex = Number(v);
          setPreviewState('idle');
        },
      );
      const setDescReadout = panel.addReadout('Description');

      panel.addSeparator();

      // --- Preview state (§15.4 "warning, active, ending... held indefinitely") -------------
      panel.addButton('Preview: warning', () => setPreviewState('warning'));
      panel.addButton('Preview: active', () => setPreviewState('active'));
      panel.addButton('Preview: ended', () => setPreviewState('ended'));
      panel.addButton('Clear (idle)', () => setPreviewState('idle'));
      const setStateReadout = panel.addReadout('Preview state');

      panel.addSeparator();

      // --- Environmental changes, individually togglable (§15.4) ----------------------------
      const setFootTrafficSelect = panel.addSelect('Foot traffic', FOOT_TRAFFIC_PRESETS, (v) => applyFootTraffic(Number(v)));
      setFootTrafficSelect(FOOT_TRAFFIC_PRESETS, String(footTrafficCount));
      panel.addButton("Apply selected event's foot traffic", () => {
        const preset = footTrafficPresetForMultiplier(currentEvent().effects.footTrafficMultiplier);
        setFootTrafficSelect(FOOT_TRAFFIC_PRESETS, preset);
        applyFootTraffic(Number(preset), Object.keys(currentEvent().effects.segmentWeightOverrides ?? {}).length > 0
          ? Object.keys(currentEvent().effects.segmentWeightOverrides ?? {})
          : SEGMENTS.map((s) => s.id));
      });
      panel.addToggle('District props visible', districtPropsVisible, (v) => {
        districtPropsVisible = v;
        if (districtProps) districtProps.visible = v;
      });
      panel.addToggle('Night lighting', nightLighting, (v) => {
        nightLighting = v;
        scene?.setNight(v);
      });
      const setCrowdSelect = panel.addSelect('Crowd density', CROWD_PRESETS, (v) => applyCrowd(Number(v)));
      setCrowdSelect(CROWD_PRESETS, String(crowdCount));
      panel.addSelect('Weather', WEATHER_OPTIONS, (v) => applyWeather(v as WeatherMode));
      const setWeatherReadout = panel.addReadout('Weather');

      panel.addSeparator();

      // --- Viewport size (§15.4 "inspected at several viewport sizes... without relaunching")
      panel.addSelect('Viewport size', VIEWPORT_PRESET_OPTIONS, (v) => applyViewportPreset(viewport, v));

      panel.addSeparator();

      panel.addSlider('Camera height', { min: 12, max: 40, step: 0.5, value: EVENT_CAMERA.height },
        (v) => camera?.setSettings({ height: v }));
      panel.addSlider('Camera distance', { min: 10, max: 42, step: 0.5, value: EVENT_CAMERA.distance },
        (v) => camera?.setSettings({ distance: v }));
      panel.addSlider('Camera angle', { min: -Math.PI, max: Math.PI, step: 0.02, value: EVENT_CAMERA.angle },
        (v) => camera?.setSettings({ angle: v }));
      panel.addSlider('Field of view', { min: 20, max: 80, step: 1, value: EVENT_CAMERA.fov },
        (v) => camera?.setSettings({ fov: v }));
      panel.addButton('Reset camera', () => camera?.setSettings({ ...EVENT_CAMERA }));

      const fpsReadout = panel.addReadout('FPS');

      function refreshReadouts(): void {
        setDescReadout(currentEvent().description);
        const entry = eventEntries()[0];
        setStateReadout(
          previewState === 'idle'
            ? 'idle (no event previewed)'
            : `${previewState}${entry?.state === 'warning' ? ` — starts in ${fmtSeconds(entry.startsInMs ?? 0)}`
              : entry?.state === 'active' ? ` — ${fmtSeconds(entry.endsInMs ?? 0)} left` : ''}`,
        );
        refreshBanner(bannerEl, titleEl, timeEl, descEl);
        setWeatherReadout(weather);
      }

      const resize = () => {
        const w = viewport.clientWidth;
        const h = Math.max(1, viewport.clientHeight);
        renderer?.setSize(w, h);
        camera?.setAspect(w / h);
      };
      observer = new ResizeObserver(resize);
      observer.observe(viewport);

      let last = performance.now();
      let fpsAccum = 0;
      let fpsFrames = 0;
      let readoutAccum = 0;

      const loop = (now: number) => {
        frame = requestAnimationFrame(loop);
        const realDt = Math.min(0.1, (now - last) / 1000);
        last = now;
        simClockMs += realDt * 1000;

        fpsAccum += realDt;
        fpsFrames += 1;
        readoutAccum += realDt;
        if (fpsAccum >= 0.5) {
          fpsReadout((fpsFrames / fpsAccum).toFixed(0));
          fpsAccum = 0;
          fpsFrames = 0;
        }
        if (readoutAccum >= 0.2) {
          refreshReadouts();
          readoutAccum = 0;
        }

        syncScene();

        if (scene && camera) {
          camera.update(realDt);
          renderer?.render(scene.scene, camera.camera);
        }
      };
      frame = requestAnimationFrame(loop);
      refreshReadouts();
    },

    dispose(): void {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      observer = null;
      // `scene.dispose()` traverses the whole graph disposing geometry/materials, which sweeps
      // up the crowd markers and district props too (both added as `scene.scene` children) —
      // same reasoning as kitchen-bottleneck-harness's broken-badge sprites.
      scene?.dispose();
      scene = null;
      renderer?.dispose();
      renderer = null;
      camera = null;
      crowdMarkers = [];
      districtProps = null;
      activeFootTrafficIds = [];
    },
  };
}
