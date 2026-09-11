---
id: STORY-045
title: Extend Peek to read district-wide conversion at a glance
status: merged
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: story/045-district-peek-strategy-signal
worktree_path: /Users/brent/table-stakes-story-045
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/64
is_architectural: false
approach_summary: >
  Pure client-side extension — no new snapshot field needed, both pieces of data already exist.
  CAMERA: `GameClient.ts#handleFrame` (~line 1184) currently sets `this.scene.cameraController
  .setTarget(0, -23)` while `status.peeking`, framing only the rival's decorative floor
  (`RestaurantScene.ts`'s `RIVAL_FLOOR = { halfX: 8, halfZ: 4.5, centerZ: -24.5 }`, ~line 1158,
  i.e. world z∈[-29,-20]). The shared district street where STORY-044's population now walks and
  decides sits BETWEEN the owner's own floor (queue/entry at z≈-10/-11,
  `restaurant-layout.json`'s `queue_line`/`spawn.customerEntry`) and the rival floor — roughly
  z∈[-11,-20], currently entirely outside Peek's frame. `CameraController`'s `settings` (height/
  distance/angle/fov, ~line 19) are fixed constants, not per-call — this story either widens them
  specifically for peek (a second settings profile, e.g. `PEEK_CAMERA_SETTINGS` with a larger
  `distance`/`fov` to fit the whole span) or simply retargets `setTarget` to a z that's a wider
  compromise (implementer's call, AC1 explicitly allows either "broadened" framing or "a second
  peek state" — do not remove the existing rival-floor-only behavior, extend it). DATA READOUT:
  `you.managerLedger` (STORY-037, `manager-ledger-system.js`) is ALREADY published live every
  snapshot (`match.js` ~line 651, viewer-scoped, not phase-gated to results), and its
  `demand_conversion` constraint already carries a plain-English district-conversion
  `evidence` string sourced from `match.districtSummary` (`customer-system.js#districtSummary`,
  ~line 1688) — e.g. "0 of 0 evaluated parties chose elsewhere; 0 left the district." No new
  computation, no new wire field: surface the existing `status.managerLedger.constraints.find(c
  => c.id === 'demand_conversion')` (or the raw `districtSummary`-shaped numbers it's built
  from, implementer's call on which reads more like a HUD stat vs. a sentence) in a small new
  overlay shown ONLY while `status.peeking` is true — `TacticalOverviewPanel.tsx` (~line 169)
  already renders this exact constraint list elsewhere as a precedent for the display format, but
  this story's overlay must be its own small peek-specific readout, not a reuse of that whole
  panel (Peek is a full-screen camera mode with its own minimal HUD, not the tactical overview).
  `is_architectural: false` — no snapshot/data-model change, no new interact/action, purely
  camera framing + an existing-data readout gated on an existing client-only boolean.
created: 2026-09-10
updated: 2026-09-11
---

# Extend Peek to read district-wide conversion at a glance

With the district's full population now visibly walking to a chosen restaurant, the rival's, or
neither (STORY-044), a player should be able to use the existing Peek camera (bound to `Q`,
`InputController.ts`/`CameraController.ts`, currently re-aimed at the rival's floor per
`GameClient.ts`'s `status.peeking` branch and `RestaurantScene.RIVAL_FLOOR`) to judge — from
watching real crowd behavior — whether their own restaurant is under-attracting customers, and
be prompted toward a strategy change (price, menu, signage, upgrades) rather than only inferring
it from a lagging score number.

## Acceptance Criteria

- [x] Peek's camera framing includes enough of the shared district space (not only the rival's
  decorative floor) that a player can see the crowd from STORY-044 actually walking/deciding —
  extend `CameraController`'s Peek target/framing, not necessarily replace it; the rival-floor
  view is still useful and should not be removed, only broadened or given a second peek state if
  that's the cleaner UX (implementer's call).
- [x] Some signal — in-world (a visible skew in which direction the crowd walks) and/or a light
  HUD readout while peeking (e.g. this match's own `districtSummary`/`demand_conversion`-style
  figures, already computed server-side in `customer-system.js`/`manager-ledger.js`, just not
  currently surfaced during Peek) makes "am I under-attracting customers" answerable without
  waiting for the results screen.
- [x] Peek remains a read-only camera mode — no new interact/action surface added to it; this
  story is observability only, consistent with Peek's existing design.

## Notes

- Depends on STORY-044 (the population/movement this story lets a player observe must exist and
  be visible first).
- Cites: `client/src/game/CameraController.ts`, `client/src/game/InputController.ts` (`onPeek`),
  `client/src/scenes/RestaurantScene.ts` (`RIVAL_FLOOR`, `rivalWorldPosition`) as the exact seam
  to extend — this story EXTENDS Peek's existing camera-only design; it does not turn Peek into an
  interactive/actionable mode.
- Cites: `server/src/game/systems/manager-ledger-system.js`'s `demand_conversion` constraint and
  `customer-system.js#districtSummary` as already-computed data this story can surface rather than
  recompute — PRESERVES that computation, only asks for a new read-time exposure of it.

## Implementation notes

**AC1 — second peek-only camera profile, retarget does most of the work.** Chose "second peek
state" over "widen the single fixed profile": added `CameraController.ts#PEEK_CAMERA`, a full
`CameraSettings` object that spreads `DEFAULT_CAMERA` and overrides only `distance` (17 → 20,
`shared/constants/tuning.js#PEEK_CAMERA_DISTANCE`), leaving `height`/`angle`/`fov` untouched.
`GameClient.ts#setPeeking` swaps `this.scene.cameraController.setSettings(...)` wholesale between
`PEEK_CAMERA` and `DEFAULT_CAMERA` on the hold's true/false edges (not per-frame — cheaper, and
`applySettings` never blends a stale field from the other profile). `handleFrame`'s existing
`status.peeking` branch still owns the target, now `PEEK_CAMERA_TARGET_Z` (-17, replacing -23) —
this constant is what actually does AC1's framing work, not the distance pull-back.

**The fov-widening path was tried, computed out, and rejected — recorded so this isn't
re-litigated.** A first pass set `PEEK_CAMERA` to `{ distance: 26, fov: 52 }` (a ~1.5x/1.3x
pull-back+widen, per the approach_summary's own suggestion) and retargeted to z=-17. Before
committing to it, worked the actual vertical-frustum geometry `applySettings` implements
(`camera.position` offset by `distance`/`angle`/`height` from the smoothed target, `camera.lookAt`
back at it): the ground-plane intersection of the frame's near/far edges, at pitch angle
`θ_center = atan(height/distance)` and half-fov `h = fov/2`, lands at horizontal distance
`D = height / tan(θ_center ∓ h)` from the camera, mapping to world z via
`z(D) ≈ target.z + (D − distance) · cos(angle−π)` (the view axis's z-component at this camera's
fixed `angle`). At `distance=26, fov=52`: `θ_center=36.2°`, and the far (top-of-screen) edge sits
at only `36.2−26=10.2°` above grazing — `D_far≈106`, i.e. `z_far≈+60`, roughly 75 of the ~92
visible world-z units past the owner's own floor into empty ground toward the horizon, with the
actual crowd (street z∈[-11,-20], rival floor z∈[-20,-29]) compressed into the near third of the
frame where perspective foreshortening is worst. AC1 asks that a player can see the crowd actually
walking/deciding, not merely that the street sits somewhere inside the frustum — a wide-open fov
at this camera's fixed low `angle`/`height` buys frustum area at the direct cost of making the new
content smaller and harder to read, the opposite of the goal. Reworked with `fov` left at
`DEFAULT_CAMERA`'s 40 and `distance` bumped only to 20: `θ_center=43.5°`, far edge at `43.5−20=
23.5°` (comfortably above the ~22° threshold below which the shipped-and-rejected pass sat, and
close to `DEFAULT_CAMERA`'s own ~28.2° margin at target=-23/distance=17), giving `z_far≈+5.7`,
`z_near≈-27.1` — a ~33-unit span centred on the district street with the rival floor's near ~9
units still inside it at a legible angle, versus the rival-floor-only sliver the pre-045 fixed
`setTarget(0,-23)` produced. This reasoning — and the specific numbers — are recorded in
`PEEK_CAMERA_DISTANCE`'s own comment in `tuning.js` so a future widening pass doesn't reintroduce
the same horizon-compression mistake without re-deriving why it was rejected once already.

**Angle invariant, worth stating explicitly.** `PEEK_CAMERA.angle` is `DEFAULT_CAMERA.angle`,
unchanged — `handleFrame` feeds `cameraController.getSettings().angle` into
`this.input.getMoveIntent(...)` every frame regardless of `peeking`, so WASD movement direction
does not silently reorient while Peek is held. If a future story widens Peek further by also
touching `angle`, this coupling is the thing that would break; recorded here and in
`PEEK_CAMERA`'s own comment so it isn't rediscovered by a movement bug report.

**No visual confirmation of the actual on-screen result.** Same limitation as prior camera/UI
stories in this repo (STORY-041/042): this environment's browser automation cannot drive the
WebGL render loop (`document.visibilityState` reports `hidden` in the automated tab, which blocks
`requestAnimationFrame`), so the frustum-angle math above was worked from `applySettings`'s own
formula and cross-checked against the pre-045 profile's own numbers, not confirmed by an actual
screenshot of the framed shot. No claim of live visual verification is made.

**AC2 — `PeekReadout.tsx`, a new minimal component, not a `TacticalOverviewPanel` reuse.** Reads
`status.managerLedger?.constraints.find(c => c.id === 'demand_conversion') ?? null` — the exact
field `TacticalOverviewPanel.tsx` (~line 169) already renders for all five constraints, confirmed
still live and phase-agnostic by reading `match.js#toSnapshot` directly: `you.managerLedger:
this.managerLedger?.privateFor(viewerRestaurantId) ?? null` (line 651) is populated on every
`match_snapshot`, not gated to `results` or any particular `matchPhase`. No new wire field, no
touch to `manager-ledger-system.js`'s scoring or `customer-system.js#districtSummary`'s
computation — this is a read-time-only exposure, exactly as the story's notes require. Shows only
`demand_conversion` (not the other four constraints `TacticalOverviewPanel` also carries): Peek's
question is narrowly "am I under-attracting customers", and reusing the whole five-constraint,
both-floors panel was explicitly ruled out by the approach_summary and would have answered a
different, broader question than the one a quick held glance is for. Renders the constraint's own
`evidence` sentence verbatim (e.g. "0 of 0 evaluated parties chose elsewhere; 0 left the
district.") plus a `status`-derived badge (`limiting`/`watch`/`clear`) and, when not `clear`, a
short static nudge sentence ("Consider your price, menu fit, or a front-door special before the
next rush.") — this nudge is plain client UI copy, not a read of
`manager-ledger-system.js`'s server-internal `RECOMMENDATIONS` object (which is never published;
it is only assembled into `insights` at match end, in `ManagerLedgerResult`, a results-only shape
Peek must not wait on). Degrades to "Not enough district activity recorded yet." when
`managerLedger` is `null` (pre-`service`), so no phase gate was needed on the overlay itself.

**AC2 — in-world signal, already satisfied by AC1's retarget, not a second mechanism.** The story
explicitly allows "in-world ... and/or ... HUD readout"; the widened/retargeted framing from AC1
already puts STORY-044's population — genuinely walking toward the owner's floor, the rival's, or
away via `exitPosition` — inside Peek's frame, so the in-world half of AC2 falls out of AC1's
camera work rather than needing its own separate implementation. `PeekReadout` is the HUD half,
additive on top.

**AC3 — read-only, by construction (same argument shape as STORY-042's AC4).** `PeekReadout`
takes a single `status` prop, has no `onX` callback prop, and never imports or touches
`clientRef`/`GameClient` — verifiable directly from `PeekReadout.tsx`'s own signature
(`{ status: GameClientStatus }`, no other prop). `.peek-readout`'s CSS sets `pointer-events:
none` (`app.css`), so it cannot even become a click target by accident. No new `NetworkClient`
message, no new `action-validator.js` case, no new `GameClient` method beyond the pre-existing
`setPeeking` (whose own signature — `(peeking: boolean): void`, camera-and-status-only — is
unchanged in shape by this story, only in what it additionally does internally).

**Wiring (`GameView.tsx`).** `PeekReadout` renders under `status?.peeking ? <PeekReadout
status={status} /> : null`, placed directly after the existing `peek-button` block — gated on the
`peeking` boolean alone, the same gate `handleFrame`'s camera branch uses, not on `matchPhase`;
`PeekReadout`'s own null-safe fallback text (above) makes an extra phase check redundant, and
matches this file's existing mix of phase-gated (`FrontDoorBoard`, etc.) and ungated (`HudPanel`,
`ReconnectOverlay`) panels — this one follows the ungated precedent since its content is already
self-describing when empty.

**Tunables (`shared/constants/tuning.js`, `STORY-045` block, plus `tuning.d.ts`).**
`PEEK_CAMERA_DISTANCE = 20` and `PEEK_CAMERA_TARGET_Z = -17` — both named constants per house
convention (no inline magic numbers in `CameraController.ts`/`GameClient.ts`), each with the
frustum-angle reasoning above in its own comment. No `PEEK_CAMERA_FOV` constant exists — the
fov-widening path was rejected (above), so `PEEK_CAMERA` reuses `DEFAULT_CAMERA.fov` directly via
object spread rather than naming a tunable that would just re-state the default's value.

**Verification: no new check script, following STORY-042's own precedent directly.** This story's
only new logic is (1) a camera-settings profile swap plus a retargeted `setTarget` call — pure
presentational/camera math with no server-side equivalent to call, and (2) a `.find()` over an
already-published, already-tested array plus a static label/copy lookup — no new pure function
complex enough to warrant isolated testing. `check-upgrades.mjs`'s own header (cited directly by
STORY-042's Implementation notes) states this exact class of client-only TypeScript surface is
proven by `npm run build:client`'s `tsc --noEmit`, not a new `check-*.mjs`; nothing here differs
in kind. No new script was added, `package.json`'s `check:*` list is unchanged, and per the house
rule this triggers no falsification step — there is no new check to break/restore/re-verify.

**Full verification run.** `npm run install:all` (fresh worktree, no `node_modules`), then `npm
run check` — every existing `check-*.mjs`, `build:client` (`tsc --noEmit` + `vite build`), and
`build:harnesses`, all green, exit code 0, unmodified script list. `you.managerLedger`'s
`demand_conversion` entries visible in the full-check smoke-test transcripts (`smoke-phases.mjs`,
`smoke-bot.mjs`) confirm the exact evidence-string shape `PeekReadout` reads
(`"0 of 0 evaluated parties chose elsewhere; 0 left the district."`) is real, live wire data, not
a shape assumed from reading source alone.
