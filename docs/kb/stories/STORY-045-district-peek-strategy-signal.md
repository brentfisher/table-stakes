---
id: STORY-045
title: Extend Peek to read district-wide conversion at a glance
status: in-progress
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: story/045-district-peek-strategy-signal
worktree_path: /Users/brent/table-stakes-story-045
base_branch: master
pr_url: null
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

- [ ] Peek's camera framing includes enough of the shared district space (not only the rival's
  decorative floor) that a player can see the crowd from STORY-044 actually walking/deciding —
  extend `CameraController`'s Peek target/framing, not necessarily replace it; the rival-floor
  view is still useful and should not be removed, only broadened or given a second peek state if
  that's the cleaner UX (implementer's call).
- [ ] Some signal — in-world (a visible skew in which direction the crowd walks) and/or a light
  HUD readout while peeking (e.g. this match's own `districtSummary`/`demand_conversion`-style
  figures, already computed server-side in `customer-system.js`/`manager-ledger.js`, just not
  currently surfaced during Peek) makes "am I under-attracting customers" answerable without
  waiting for the results screen.
- [ ] Peek remains a read-only camera mode — no new interact/action surface added to it; this
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
