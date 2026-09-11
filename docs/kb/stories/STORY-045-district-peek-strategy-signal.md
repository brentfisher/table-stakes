---
id: STORY-045
title: Extend Peek to read district-wide conversion at a glance
status: pending
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: null
approach_summary: null
created: 2026-09-10
updated: 2026-09-10
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
