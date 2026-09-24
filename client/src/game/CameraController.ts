// PRD §14 "Camera": a high-angle third-person/isometric camera that follows the owner with
// soft bounds. Rotation is deliberately limited in the initial version to preserve
// readability — a free camera looks impressive and makes restaurant state hard to read.

import * as THREE from 'three';
import { PEEK_CAMERA_DISTANCE, CAMERA_PROFILE_TRANSITION_MS } from '../../../shared/constants/tuning';

export interface CameraSettings {
  height: number;
  distance: number;
  angle: number; // radians, around Y
  fov: number;
}

// Framed around the actual restaurant rather than the surrounding street. The owner can still
// see the whole dining room and kitchen, while dishes, customers, and task labels read without
// needing an overview toggle.
//
// Reported: "the restaurant layout is too far away with the camera" — the wide, high-angle shot
// this constant used to describe (height 21, distance 24) read as an overview rather than a
// third-person view the player felt embodied in; the owner's own movement barely displaced the
// frame at that distance, which is also most of why panning didn't read as "the camera follows
// you" even though `update()`'s smoothed-target lerp below already does exactly that on every
// frame. Pulled in ~30% (same angle/fov, so the floor plan's proportions on screen are unchanged,
// just larger) rather than re-deriving new ones freehand. The OLD numbers are preserved verbatim
// as `WIDE_CAMERA` below, a `Settings.wideCameraView` toggle away, for anyone who preferred the
// original overview framing.
export const DEFAULT_CAMERA: CameraSettings = {
  height: 15,
  distance: 17,
  angle: Math.PI - 0.70,
  fov: 37.5,
};

/** The pre-zoom framing, verbatim — see `DEFAULT_CAMERA`'s own comment. Selected at
 * `GameClient` construction time from `Settings.wideCameraView` (`app/settings.ts`); not a
 * live-swappable profile like `PEEK_CAMERA`, since Settings is only reachable from the main
 * menu, never mid-match. */
export const WIDE_CAMERA: CameraSettings = {
  height: 21,
  distance: 24,
  angle: Math.PI - 0.70,
  fov: 37.5,
};

/**
 * STORY-045. A second, peek-only profile — same `height`/`angle`/`fov` as `DEFAULT_CAMERA`
 * (Peek still swings the SAME camera, not a different rig, and `fov` is deliberately left
 * unchanged — see `PEEK_CAMERA_DISTANCE`'s own comment, `shared/constants/tuning.js`, for why a
 * wider fov was tried and rejected: it shrinks the grazing angle at the frame's far edge enough
 * to make a walking party unreadably small there). Only `distance` differs, a modest pull-back
 * so more of the district street (STORY-044's population) sits inside a legibly-framed band of
 * the shot once `GameClient#handleFrame` retargets toward it (`PEEK_CAMERA_TARGET_Z`), rather
 * than the close, narrow shot tuned for the owner's own dining room. `GameClient#setPeeking`
 * swaps the controller onto this profile for as long as Peek is held, and back to
 * `DEFAULT_CAMERA` the instant it releases.
 */
export const PEEK_CAMERA: CameraSettings = {
  ...DEFAULT_CAMERA,
  distance: PEEK_CAMERA_DISTANCE,
};

/**
 * STORY-067 PRD Story 1 (pp. 3-4): entering the kitchen zone should give "a closer, lower, or
 * more kitchen-oriented framing" so the back-wall queue board, the four stations and the pass
 * all read together, without a separate overview toggle. Unlike `PEEK_CAMERA` (one field,
 * `distance`, over `DEFAULT_CAMERA`), three fields move here, because the ask is a genuinely
 * different vantage on the SAME floor, not a pull-back from the same one:
 * - `height`/`distance` both pull in from `DEFAULT_CAMERA`'s 15/17 — closer AND lower, per the
 *   PRD wording, rather than just one or the other, since either alone still reads as looking
 *   down at a diagram instead of standing near the pass.
 * - `angle` is unchanged from `DEFAULT_CAMERA` — the kitchen's own stations/board are already
 *   square to the world axes this angle frames the dining room from (`RestaurantScene`'s own
 *   `zones[]` boxes), so swinging it would rotate the shot relative to the geometry everyone
 *   already reads DEFAULT/WIDE/PEEK from, for no legibility gain.
 * - `fov` widens modestly (37.5 -> 44) to keep the four stations (`restaurant-layout.json`
 *   x -6..6) inside frame at the shorter `distance` — the opposite tradeoff `PEEK_CAMERA_DISTANCE`
 *   made (that one rejected a wider fov because it thinned a FAR edge; this profile's subject is
 *   NEAR, so the same widening only pulls more of the kitchen's own width into frame, not less).
 * `GameClient#handleFrame` pairs this with a fixed look-at z (`KITCHEN_CAMERA_TARGET_Z`,
 * `shared/constants/tuning.js`) rather than the usual owner-clamped target, the same reasoning
 * `PEEK_CAMERA_TARGET_Z` gives: the default follow clamps z within +-1.5 of center regardless of
 * how far into the kitchen (z 3-12) the owner actually walks, so without an explicit retarget the
 * closer/lower framing above would center on the pass, not the back wall it needs to show.
 */
export const KITCHEN_CAMERA: CameraSettings = {
  height: 9,
  distance: 11,
  angle: DEFAULT_CAMERA.angle,
  fov: 44,
};

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  private settings: CameraSettings = { ...DEFAULT_CAMERA };
  private readonly target = new THREE.Vector3(0, 0, -2);
  private readonly smoothed = new THREE.Vector3(0, 0, -2);

  // STORY-067. `setSettings` used to apply `height`/`distance`/`angle`/`fov` to `this.settings`
  // (and so to the camera, via `applySettings`) on the very next frame — fine for `PEEK_CAMERA`'s
  // single modest `distance` change while a key is held, but a hard cut for a profile that also
  // drops height and swings fov. `this.settings` is now the CURRENTLY-RENDERED (possibly
  // mid-transition) profile; `transitionFrom`/`transitionTarget` bound the lerp `update(dt)`
  // drives it through, over `CAMERA_PROFILE_TRANSITION_MS` (`shared/constants/tuning.js`) real
  // milliseconds — same "duration, not decay-rate" shape as that constant's own name, deliberately
  // NOT the `this.smoothed`/`target` follow lerp just below, which stays exactly as it was: that
  // one lags the camera behind owner movement every frame forever, this one runs once per profile
  // change and then holds still at the target. `reducedMotion` (`Settings.reducedMotion`, read
  // once at construction — Settings is only reachable from the main menu, same reasoning
  // `baseCamera`'s own comment in `GameClient.ts` gives for `wideCameraView`) skips the lerp
  // entirely: `setSettings` lands on the target in one step, same as pre-067 behaviour.
  private transitionFrom: CameraSettings = { ...DEFAULT_CAMERA };
  private transitionTarget: CameraSettings = { ...DEFAULT_CAMERA };
  private transitionElapsedMs = CAMERA_PROFILE_TRANSITION_MS;

  constructor(aspect: number, private readonly reducedMotion = false) {
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, aspect, 0.1, 400);
    this.applySettings();
  }

  /**
   * Interpolates toward the merged profile over `CAMERA_PROFILE_TRANSITION_MS`, restarting from
   * whatever is currently rendered (so a second call mid-transition redirects smoothly rather
   * than jumping back to the pre-transition start). Used for every LIVE, mid-match profile swap
   * (`GameClient#setPeeking`, the STORY-067 kitchen-zone trigger) — see `setSettingsImmediate`
   * for the one case that deliberately skips this (the wide-camera base profile, applied once at
   * construction, before the first frame ever renders).
   */
  setSettings(partial: Partial<CameraSettings>): void {
    const nextTarget = { ...this.settings, ...partial };
    if (this.reducedMotion) {
      this.settings = nextTarget;
      this.transitionFrom = { ...nextTarget };
      this.transitionTarget = { ...nextTarget };
      this.transitionElapsedMs = CAMERA_PROFILE_TRANSITION_MS;
      this.applySettings();
      return;
    }
    this.transitionFrom = { ...this.settings };
    this.transitionTarget = nextTarget;
    this.transitionElapsedMs = 0;
  }

  /**
   * Applies a profile change in one step, bypassing the `setSettings` lerp — the pre-STORY-067
   * behaviour, kept for the one caller that must never animate: `GameClient`'s constructor
   * selecting `WIDE_CAMERA` as this match's base profile, before the scene has rendered a single
   * frame. Going through the lerping `setSettings` there would visibly zoom the opening frame in
   * from `DEFAULT_CAMERA` over `CAMERA_PROFILE_TRANSITION_MS` — a transition with nothing to
   * transition FROM, since nothing was ever shown at the old profile.
   */
  setSettingsImmediate(partial: Partial<CameraSettings>): void {
    this.settings = { ...this.settings, ...partial };
    this.transitionFrom = { ...this.settings };
    this.transitionTarget = { ...this.settings };
    this.transitionElapsedMs = CAMERA_PROFILE_TRANSITION_MS;
    this.applySettings();
  }

  getSettings(): CameraSettings {
    return { ...this.settings };
  }

  setTarget(x: number, z: number): void {
    this.target.set(x, 0, z);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.applySettings();
  }

  /** Soft follow — the camera lags the owner so the frame does not jitter with input. */
  update(dt: number): void {
    // STORY-067. Only recomputed while an active transition hasn't reached its target — once
    // `transitionElapsedMs` reaches `CAMERA_PROFILE_TRANSITION_MS`, `this.settings` already
    // equals `transitionTarget` exactly, so re-lerping every idle frame would only reintroduce
    // float drift for no visual change.
    if (this.transitionElapsedMs < CAMERA_PROFILE_TRANSITION_MS) {
      this.transitionElapsedMs = Math.min(CAMERA_PROFILE_TRANSITION_MS, this.transitionElapsedMs + dt * 1000);
      const t = this.transitionElapsedMs / CAMERA_PROFILE_TRANSITION_MS;
      this.settings = {
        height: THREE.MathUtils.lerp(this.transitionFrom.height, this.transitionTarget.height, t),
        distance: THREE.MathUtils.lerp(this.transitionFrom.distance, this.transitionTarget.distance, t),
        // Every named profile's `angle` sits within a fraction of a radian of the others (all
        // derive from `DEFAULT_CAMERA.angle` today), so a plain lerp never has a wraparound
        // shorter path to worry about. A future profile picking a genuinely opposite angle would
        // need this to go through `THREE.MathUtils.lerp` on the shortest angular distance instead.
        angle: THREE.MathUtils.lerp(this.transitionFrom.angle, this.transitionTarget.angle, t),
        fov: THREE.MathUtils.lerp(this.transitionFrom.fov, this.transitionTarget.fov, t),
      };
    }
    this.smoothed.lerp(this.target, Math.min(1, dt * 3.2));
    this.applySettings();
  }

  private applySettings(): void {
    const { height, distance, angle, fov } = this.settings;
    // Preserve the floor's horizontal coverage on narrow windows too.
    this.camera.fov = this.camera.aspect < 1.25
      ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * 1.25 / this.camera.aspect))
      : fov;
    this.camera.position.set(
      this.smoothed.x + Math.sin(angle) * distance,
      height,
      this.smoothed.z + Math.cos(angle) * distance,
    );
    this.camera.lookAt(this.smoothed.x, 0, this.smoothed.z);
    this.camera.updateProjectionMatrix();
  }
}
