// PRD §15.5 Upgrade preview harness.
//
// Purpose: toggle any upgrade on/off (at any tier) and see the SAME physical change STORY-012
// wired into the live client, preview a capacity-adding upgrade's extra seating in place, read a
// numeric performance overlay for whichever upgrade is being inspected, and tune the upgrade
// terminal's interaction radius against a test owner position. PRD §10: "upgrades must produce a
// clearly visible physical change... prefer altering decisions or spatial flow over bumping a
// scalar" — this harness is where that claim gets checked, station by station, outside a live
// match.
//
// REUSES THE REAL VISUAL HOOKS, DOESN'T REBUILD THEM. `RestaurantScene#setStationUpgraded`,
// `#setPantryUpgraded` and `#setCarrying` are the exact methods `GameClient.ts` calls when a
// purchase actually lands (see its own `purchasedUpgradeIds.includes(...)` calls) — toggling a
// checkbox here calls the identical methods with the identical arguments, so what this harness
// shows IS what the live client would show, not a lookalike. `client/src/game/GameClient.ts`'s
// `WIRED_UPGRADE_IDS` is the CLIENT's list (used for the shop/affordability UI); the actual
// authority for which effect keys a purchase is even allowed for is
// `server/src/game/systems/upgrade-system.js`'s `KNOWN_EFFECT_KEYS`, which harnesses cannot
// import (`harnesses/tsconfig.json` doesn't include `server/`). So this file keeps its OWN
// switch over the same four keys that module reads — `resolveOwnedEffects` below — and an
// upgrade whose `effects` names anything else falls into the generic branch, labelled as
// unwired. That switch, not an imported id list, is what has to change the day a sixth effect
// key gets wired — same discipline `event-visualization-harness.ts` uses for not branching on
// an event id.
//
// DATA-DRIVEN, ON PURPOSE (this story's own AC). The ownership checklist and the "Inspect"
// dropdown both read `UPGRADES` straight from the imported `upgrades.json` array — nowhere does
// this file branch on an upgrade id. Add a twelfth upgrade and it appears in both with no code
// change; if its `effects` reuse an already-known key it even gets a numeric overlay for free.
//
// TOGGLING IS THE BEFORE/AFTER (§15.5 "via a toggle"). There is no separate split-view for
// grill/pantry — flicking the checkbox on and off IS the comparison, and it is the identical
// state transition a real purchase causes.
//
// ADDITIONAL TABLE, THE INTERACTION RANGE RING AND THE TEST-OWNER DISTANCE HAVE NO LIVE
// COUNTERPART. `RestaurantScene` builds its 6 tables once from static layout JSON with no public
// "add a table" method, so this harness builds one more, lightweight, reading
// `seatsPerAddedTable` from the upgrade's own effects rather than hardcoding a chair count — same
// "invented in the shape the data reserves" pattern kitchen-bottleneck-harness.ts uses for
// `repair`. The range ring and test-owner slider are this harness's own instrumentation for
// tuning `restaurant-layout.json`'s `upgrade_terminal.interactionRadius` — the distance check
// below is copied verbatim from `action-validator.js#handlePurchaseUpgrade`
// (`Math.hypot(dx, dz) > radius`, X/Z only) so the readout can never disagree with the real rule.

import * as THREE from 'three';
import type { SceneHarness } from './harness-shell';
import { RestaurantScene, CameraController, type OwnerRenderState } from './shared/scene-primitives';
import { DevControls } from './shared/dev-controls';
import { STATE_COLORS } from '../../client/src/game/state-colors';
import layout from '../../shared/game-data/restaurant-layout.json';
import upgradesData from '../../shared/game-data/upgrades.json';
import dishesData from '../../shared/game-data/dishes.json';
import segmentsData from '../../shared/game-data/customer-segments.json';
import { STATIONS } from '../../shared/schemas/messages';
import type { Station } from '../../shared/schemas/messages';
import type { Vec3 } from '../../shared/schemas/game-state';
import {
  OWNER_CARRY_CAPACITY,
  OWNER_INTERACT_RANGE,
  INVENTORY_RESTOCK_TRAVEL_MS,
} from '../../shared/constants/tuning';

// --- Upgrade catalogue (data-driven; see this file's own header) ------------------------------

interface UpgradeEffects {
  [effectKey: string]: unknown;
}
interface UpgradeDef {
  id: string;
  name: string;
  category: string;
  cost: number;
  tier: number;
  requires?: string;
  description: string;
  effects: UpgradeEffects;
}
// `as unknown as` — same justification as `event-visualization-harness.ts`'s cast of
// `eventsData.events`: eleven heterogeneous `effects` shapes infer an eleven-way union that no
// single `UpgradeEffects` interface satisfies directly; the JSON is trusted input.
const UPGRADES = upgradesData.upgrades as unknown as UpgradeDef[];

interface DishStep { station: Station; durationMs: number }
interface DishDef { id: string; stationSteps: DishStep[] }
const DISHES = dishesData.dishes as unknown as DishDef[];

interface SegmentDef { id: string; patienceSeconds: number }
const SEGMENTS = segmentsData.segments as unknown as SegmentDef[];
const AVERAGE_PATIENCE_SECONDS = SEGMENTS.reduce((sum, s) => sum + s.patienceSeconds, 0) / SEGMENTS.length;

/** First catalogue dish whose steps touch `station` — a real duration, not an invented one. Every
 * station in `STATIONS` has at least one dish (checked against `dishes.json` directly), so this
 * never falls through for a station key any upgrade could plausibly name. */
function representativeDurationMs(station: string): number {
  for (const dish of DISHES) {
    const step = dish.stationSteps.find((s) => s.station === station);
    if (step) return step.durationMs;
  }
  return 0;
}

interface ResolvedEffects {
  ownerCarryCapacity: number;
  stationSpeedMultipliers: Record<string, number>;
  seatedPatienceMultiplier: number;
  restockTravelTimeMultiplier: number;
}

/** The same fold `upgrade-system.js#resolveEffects` runs server-side, over whichever upgrades
 * are checked in the ownership list. Only the four keys that module actually reads are folded —
 * an owned upgrade naming any other key contributes nothing here, matching live behaviour. */
function resolveOwnedEffects(owned: Set<string>): ResolvedEffects {
  const effects: ResolvedEffects = {
    ownerCarryCapacity: OWNER_CARRY_CAPACITY,
    stationSpeedMultipliers: {},
    seatedPatienceMultiplier: 1,
    restockTravelTimeMultiplier: 1,
  };
  for (const id of owned) {
    const upgrade = UPGRADES.find((u) => u.id === id);
    if (!upgrade) continue;
    for (const [key, value] of Object.entries(upgrade.effects)) {
      if (key === 'ownerCarryCapacity' && typeof value === 'number') {
        effects.ownerCarryCapacity = Math.max(effects.ownerCarryCapacity, value);
      } else if (key === 'stationSpeedMultipliers' && typeof value === 'object' && value) {
        for (const [station, multiplier] of Object.entries(value as Record<string, number>)) {
          effects.stationSpeedMultipliers[station] = (effects.stationSpeedMultipliers[station] ?? 1) * multiplier;
        }
      } else if (key === 'seatedPatienceMultiplier' && typeof value === 'number') {
        effects.seatedPatienceMultiplier *= value;
      } else if (key === 'restockTravelTimeMultiplier' && typeof value === 'number') {
        effects.restockTravelTimeMultiplier *= value;
      }
    }
  }
  return effects;
}

/** §15.5 "performance overlay ... numeric effect of the selected upgrade" — independent of what
 * is currently owned, so an upgrade's effect size can be read without owning anything else
 * first. Generic over effect KEYS (see this file's header), never over an upgrade id. */
function performanceOverlayLines(upgrade: UpgradeDef): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(upgrade.effects)) {
    if (key === 'ownerCarryCapacity' && typeof value === 'number') {
      lines.push(`Owner carries: ${OWNER_CARRY_CAPACITY} plate(s) → ${value} plate(s)`);
    } else if (key === 'stationSpeedMultipliers' && typeof value === 'object' && value) {
      for (const [station, multiplier] of Object.entries(value as Record<string, number>)) {
        const before = representativeDurationMs(station);
        lines.push(`${station} step duration: ${before}ms → ${Math.round(before * multiplier)}ms (×${multiplier})`);
      }
    } else if (key === 'seatedPatienceMultiplier' && typeof value === 'number') {
      const after = AVERAGE_PATIENCE_SECONDS * value;
      lines.push(`Seated patience (avg segment): ${AVERAGE_PATIENCE_SECONDS.toFixed(0)}s → ${after.toFixed(0)}s (×${value})`);
    } else if (key === 'restockTravelTimeMultiplier' && typeof value === 'number') {
      lines.push(`Restock travel time: ${INVENTORY_RESTOCK_TRAVEL_MS}ms → ${Math.round(INVENTORY_RESTOCK_TRAVEL_MS * value)}ms (×${value})`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)} — not yet wired to a live system (a purchase of this upgrade is rejected server-side; see upgrade-system.js KNOWN_EFFECT_KEYS)`);
    }
  }
  return lines;
}

// --- Spatial reference points -------------------------------------------------------------------

type LayoutEntity = { id: string; type: string; position: number[]; interactionRadius?: number };
const ENTITIES = layout.entities as LayoutEntity[];
function entityPos(id: string): Vec3 {
  const entity = ENTITIES.find((e) => e.id === id);
  if (!entity) throw new Error(`layout entity not found: ${id}`);
  const [x, , z] = entity.position;
  return { x, y: 0, z };
}
const TERMINAL_POS = entityPos('upgrade_terminal');
const TERMINAL_ENTITY = ENTITIES.find((e) => e.id === 'upgrade_terminal');
/** The real shipped radius (`restaurant-layout.json`), not an invented default — the harness
 * starts from what would actually be tuned. */
const DEFAULT_TERMINAL_RADIUS = TERMINAL_ENTITY?.interactionRadius ?? OWNER_INTERACT_RANGE;

/** Tables already occupy x ∈ {−6,−2,2} at z −5/−1, and the terminal sits at (7,0,−3)
 * (`restaurant-layout.json`) — z≈0.3 (dining zone's own far edge, z max is 1) clears both the
 * six real tables and the terminal/range-ring by a comfortable margin. */
const ADDITIONAL_TABLE_POS: Vec3 = { x: 6, y: 0, z: 0.3 };

const OWNER_ID = 'harness_owner';
const UPGRADE_CAMERA = { height: 20, distance: 19, angle: -0.5, fov: 46 } as const;

export const upgradePreviewHarness: SceneHarness = createUpgradePreviewHarness();

function createUpgradePreviewHarness(): SceneHarness {
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: RestaurantScene | null = null;
  let camera: CameraController | null = null;
  let frame = 0;
  let observer: ResizeObserver | null = null;

  let ownedUpgradeIds = new Set<string>();
  let selectedUpgradeIndex = 0;
  let additionalTableGroup: THREE.Group | null = null;
  let rangeRing: THREE.Mesh | null = null;
  let terminalRadius = DEFAULT_TERMINAL_RADIUS;
  let ownerDistance = Math.min(1.5, DEFAULT_TERMINAL_RADIUS);

  function selectedUpgrade(): UpgradeDef {
    return UPGRADES[selectedUpgradeIndex];
  }

  function applyOwnedVisuals(): void {
    if (!scene) return;
    const effects = resolveOwnedEffects(ownedUpgradeIds);
    for (const station of STATIONS) {
      const multiplier = effects.stationSpeedMultipliers[station];
      scene.setStationUpgraded(station, typeof multiplier === 'number' && multiplier < 1);
    }
    scene.setPantryUpgraded(effects.restockTravelTimeMultiplier < 1);
    scene.setCarrying(OWNER_ID, Math.max(0, Math.min(3, effects.ownerCarryCapacity)));
    if (additionalTableGroup) additionalTableGroup.visible = ownedUpgradeIds.has('additional_table_1');
  }

  /** A lightweight lookalike of `RestaurantScene#buildEntity`'s 'table' case — that method is
   * private and tables are otherwise built once from static layout, so there is no public "add a
   * table" call to reuse. Chair count reads `seatsPerAddedTable` off the upgrade's own effects
   * rather than a hardcoded 2 (see this file's header). */
  function buildAdditionalTable(seats: number): THREE.Group {
    const group = new THREE.Group();
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 0.12, 20),
      new THREE.MeshStandardMaterial({ color: 0xcbb79a, roughness: 0.7 }),
    );
    top.position.y = 0.75;
    group.add(top);
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.75, 10),
      new THREE.MeshStandardMaterial({ color: 0x6b5b47 }),
    );
    leg.position.y = 0.375;
    group.add(leg);
    for (let i = 0; i < seats; i += 1) {
      const angle = (i / seats) * Math.PI * 2;
      const chair = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.5, 0.42),
        new THREE.MeshStandardMaterial({ color: 0x8b7a63 }),
      );
      chair.position.set(Math.cos(angle) * 1.45, 0.25, Math.sin(angle) * 1.45);
      group.add(chair);
    }
    group.position.set(ADDITIONAL_TABLE_POS.x, 0, ADDITIONAL_TABLE_POS.z);
    group.visible = false;
    return group;
  }

  function ownerPosition(): Vec3 {
    return { x: TERMINAL_POS.x, y: 0, z: TERMINAL_POS.z + ownerDistance };
  }

  /** Verbatim copy of `action-validator.js#handlePurchaseUpgrade`'s own rule (X/Z distance only)
   * — see this file's header on why that specific formula, not a 3D or box-surface distance. */
  function distanceToTerminal(): number {
    const pos = ownerPosition();
    return Math.hypot(pos.x - TERMINAL_POS.x, pos.z - TERMINAL_POS.z);
  }

  function syncTerminalRing(): void {
    if (!rangeRing) return;
    rangeRing.scale.set(terminalRadius, terminalRadius, 1);
    const inRange = distanceToTerminal() <= terminalRadius;
    (rangeRing.material as THREE.MeshBasicMaterial).color.setHex(inRange ? STATE_COLORS.healthy : STATE_COLORS.critical);
  }

  return {
    id: 'upgrade-preview',
    title: 'Upgrade Preview',
    description:
      'Toggle any upgrade on or off at any tier and see the real station/pantry/carry-capacity ' +
      'visuals STORY-012 wired, preview added seating, read the numeric effect of the selected ' +
      "upgrade, and tune the terminal's interaction range. PRD §15.5.",

    mount(container: HTMLElement): void {
      const viewport = document.createElement('div');
      viewport.className = 'harness-viewport';
      const panel = new DevControls('Upgrade preview controls');
      container.append(viewport, panel.element);

      scene = new RestaurantScene({ showDebugGrid: false, showCompetitor: false });
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(viewport.clientWidth, Math.max(1, viewport.clientHeight));
      viewport.appendChild(renderer.domElement);

      camera = new CameraController(viewport.clientWidth / Math.max(1, viewport.clientHeight));
      camera.setSettings(UPGRADE_CAMERA);
      camera.setTarget(2, -3);

      // --- reset all mock/harness-only state fresh on every mount ---------------------------
      ownedUpgradeIds = new Set();
      selectedUpgradeIndex = 0;
      terminalRadius = DEFAULT_TERMINAL_RADIUS;
      ownerDistance = Math.min(1.5, DEFAULT_TERMINAL_RADIUS);

      const additionalTableUpgrade = UPGRADES.find((u) => u.id === 'additional_table_1');
      const seats = Number(additionalTableUpgrade?.effects.seatsPerAddedTable ?? 2);
      additionalTableGroup = buildAdditionalTable(seats);
      scene.scene.add(additionalTableGroup);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1.0, 32),
        new THREE.MeshBasicMaterial({ color: STATE_COLORS.healthy, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(0, 0.03, 0);
      const terminalMesh = scene.scene.getObjectByName('upgrade_terminal');
      terminalMesh?.add(ring);
      rangeRing = ring;

      scene.upsertOwner({ playerId: OWNER_ID, position: ownerPosition(), facing: 0, isSelf: true } satisfies OwnerRenderState);
      applyOwnedVisuals();
      syncTerminalRing();

      // --- Ownership checklist (§15.5 "every upgrade toggled on and off, at each tier") -----
      for (const upgrade of UPGRADES) {
        panel.addToggle(`${upgrade.name} (tier ${upgrade.tier}, $${upgrade.cost})`, false, (owned) => {
          if (owned) ownedUpgradeIds.add(upgrade.id);
          else ownedUpgradeIds.delete(upgrade.id);
          applyOwnedVisuals();
        });
      }
      const setEffectsReadout = panel.addReadout('Live resolved effects');

      panel.addSeparator();

      // --- Inspect: description + performance overlay for one selected upgrade --------------
      panel.addSelect('Inspect upgrade', UPGRADES.map((u, i) => ({ value: String(i), label: u.name })), (v) => {
        selectedUpgradeIndex = Number(v);
      });
      const setDescReadout = panel.addReadout('Description');
      const setOverlayReadout = panel.addReadout('Performance overlay');

      panel.addSeparator();

      // --- Terminal interaction range (§15.5 "rendered as a visible volume ... adjustable") --
      panel.addSlider('Terminal radius (m)', { min: 0.5, max: 4, step: 0.1, value: terminalRadius }, (v) => {
        terminalRadius = v;
        syncTerminalRing();
      });
      panel.addSlider('Test owner distance (m)', { min: 0, max: 5, step: 0.1, value: ownerDistance }, (v) => {
        ownerDistance = v;
        scene?.upsertOwner({ playerId: OWNER_ID, position: ownerPosition(), facing: Math.PI, isSelf: true });
        syncTerminalRing();
      });
      const setRangeReadout = panel.addReadout('Range check');

      panel.addSeparator();

      panel.addSlider('Camera height', { min: 10, max: 34, step: 0.5, value: UPGRADE_CAMERA.height },
        (v) => camera?.setSettings({ height: v }));
      panel.addSlider('Camera distance', { min: 8, max: 34, step: 0.5, value: UPGRADE_CAMERA.distance },
        (v) => camera?.setSettings({ distance: v }));
      panel.addSlider('Camera angle', { min: -Math.PI, max: Math.PI, step: 0.02, value: UPGRADE_CAMERA.angle },
        (v) => camera?.setSettings({ angle: v }));
      panel.addSlider('Field of view', { min: 20, max: 80, step: 1, value: UPGRADE_CAMERA.fov },
        (v) => camera?.setSettings({ fov: v }));
      panel.addButton('Reset camera', () => camera?.setSettings({ ...UPGRADE_CAMERA }));

      const fpsReadout = panel.addReadout('FPS');

      function refreshReadouts(): void {
        const effects = resolveOwnedEffects(ownedUpgradeIds);
        setEffectsReadout(
          `carry ${effects.ownerCarryCapacity} · grill ×${(effects.stationSpeedMultipliers.grill ?? 1).toFixed(2)} · ` +
          `patience ×${effects.seatedPatienceMultiplier.toFixed(2)} · restock ×${effects.restockTravelTimeMultiplier.toFixed(2)}`,
        );

        const upgrade = selectedUpgrade();
        setDescReadout(`${upgrade.description}${upgrade.requires ? ` (requires ${upgrade.requires})` : ''}`);
        setOverlayReadout(performanceOverlayLines(upgrade).join(' · '));

        const distance = distanceToTerminal();
        const inRange = distance <= terminalRadius;
        setRangeReadout(
          `${distance.toFixed(2)}m from terminal — ${inRange ? 'IN RANGE' : 'OUT OF RANGE'} ` +
          `(radius ${terminalRadius.toFixed(1)}m; OWNER_INTERACT_RANGE fallback = ${OWNER_INTERACT_RANGE}m)`,
        );
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
      // up the additional-table group and the range ring too (both added as `scene.scene`/
      // terminal-mesh children) — same reasoning as kitchen-bottleneck's broken-badge sprites.
      // It also rebuilds a fresh `RestaurantScene` (new materials) on the NEXT mount, so a
      // grill/pantry tint set here cannot leak into a later harness activation.
      scene?.dispose();
      scene = null;
      renderer?.dispose();
      renderer = null;
      camera = null;
      additionalTableGroup = null;
      rangeRing = null;
      ownedUpgradeIds = new Set();
    },
  };
}
