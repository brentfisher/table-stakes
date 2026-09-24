---
type: Story
id: STORY-067
title: Kitchen operations camera state on entering the back of house
description: A third named CameraController profile that engages when the owner enters the kitchen zone, interpolated rather than snapped, with an instant non-disorienting swap under reduced motion.
status: ready-for-pr
# `status` here is flow's workflow vocabulary (pending/approved/in-progress/ready-for-pr/
# pr-opened/merged/...), not OKF's draft/stable/deprecated lifecycle — kept as-is because
# kickoff and open-prs read/write it directly across every repo using flow. Don't rename it.
prd_source: /Users/brent/table-stakes/docs/cooking-prd-interactive.pdf
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: false
approach_summary: >
  Add `KITCHEN_CAMERA` as a fourth named `CameraSettings` profile in
  `client/src/game/CameraController.ts`, following STORY-045's `PEEK_CAMERA` precedent exactly
  (same rig, differing fields documented in its own comment). The real work is that
  `setSettings()` currently applies height/distance/angle/fov IMMEDIATELY — only `this.smoothed`
  lerps toward `target` in `update()` — which is fine for Peek's single modest field change but
  reads as a hard cut for a profile that also drops height and swings angle; so profile changes
  must interpolate inside `update(dt)` over a new `Ms`-suffixed constant in a
  `shared/constants/tuning.js` block for this story, with `Settings.reducedMotion` bypassing the
  interpolation rather than disabling the state. Kitchen proximity is derived client-side from
  the `kitchen` zone already declared in `shared/game-data/restaurant-layout.json` (z 3-12, per
  STORY-057's own notes), checked on `GameClient#handleFrame` beside the existing camera
  retarget, and its precedence against `setPeeking` stated in a comment and made to hold in both
  orders. Files: `CameraController.ts`, `GameClient.ts`, `tuning.js`; verification by screenshots
  from `restaurant-layout-harness.ts` and `kitchen-bottleneck-harness.ts`. No server, schema or
  snapshot change — client presentation only, per the PRD's own Story 1 implementation note.
created: 2026-09-23
updated: 2026-09-24
---

# Kitchen operations camera state on entering the back of house

PRD Story 1 (pp. 3-4) asks that walking into the kitchen give the player "a closer, lower, or
more kitchen-oriented framing" so the back-wall queue board, the stations and their indicators
can all be read at once, and that leaving restore the default framing. Today
`client/src/game/CameraController.ts` already holds exactly the machinery this needs and has
already been extended this way once: `DEFAULT_CAMERA`, `WIDE_CAMERA` and STORY-045's
`PEEK_CAMERA` are three named `CameraSettings` profiles, and `GameClient#setPeeking` swaps the
controller between two of them live. This story adds a fourth profile, `KITCHEN_CAMERA`, and the
zone trigger that selects it.

Two things in the current controller are not yet good enough for this and are the real work.
First, `setSettings()` applies its new `height`/`distance`/`angle`/`fov` **immediately** — only
`this.target` is smoothed, by `update()`'s lerp. Peek gets away with that because it changes one
field by a modest amount while the player holds a key; a kitchen profile that also drops height
and swings angle would read as a hard cut. So the profile change itself needs to interpolate over
a tuned duration, which is a change to `CameraController` proper, not to its callers. Second,
nothing in the client currently asks "is the owner in the kitchen". `shared/game-data/
restaurant-layout.json` already defines named zones with z-extents (the `kitchen` zone spans
z 3-12; the `pass` zone z 1-3 — both quoted in STORY-057's own notes), so the trigger reads that
existing layout data rather than inventing a second spatial concept.

The camera half of this story is **client presentation only**. It adds no server field, no
snapshot change and no new authority concept: the PRD's own implementation note for Story 1 says
so explicitly, and the co-op consequence follows from it — each client picks its own camera state
from its own owner position, so one player entering the kitchen must not move the other player's
camera.

**Added after the camera landed, on request:** the owner could walk straight through the pickup
counter into the kitchen, because `movement-system.js` only ever clamped to `RESTAURANT_BOUNDS`
and this game has no obstacle collision anywhere. A closer kitchen camera makes that much more
obvious, so the pass counter becomes solid with a single opening at its left end. That half IS a
server-authoritative movement change — the only one this story carries — and it is server-side by
necessity: movement here is entirely server-driven with no client prediction, so a client-side
barrier would be both a lie and unenforceable. Scope
deliberately excludes what the camera is meant to make readable: the queue-board card states are
STORY-068 and the station indicator vocabulary is STORY-069. This story only has to prove the
framing, and that nothing it does breaks an interaction.

## Acceptance Criteria

**Camera profile**

- [ ] `client/src/game/CameraController.ts` exports a new `KITCHEN_CAMERA: CameraSettings`
      alongside `DEFAULT_CAMERA`/`WIDE_CAMERA`/`PEEK_CAMERA`, with a docstring saying which
      fields differ from `DEFAULT_CAMERA` and why (match `PEEK_CAMERA`'s own comment density).
- [ ] `CameraController` interpolates a profile change over time rather than applying it on the
      next frame: `setSettings()` (or a new sibling entry point) drives `height`/`distance`/
      `angle`/`fov` toward the target profile inside `update(dt)`, and the existing
      `setTarget`/`smoothed` follow behaviour is unchanged.
- [ ] The transition duration is a named constant in `shared/constants/tuning.js`, in a new
      named block for this story — not an inline number in `CameraController.ts`
      (conventions.md: "Never inline a constant"), with a `Ms` suffix.

**Zone trigger and precedence**

- [ ] Kitchen proximity is derived from the `kitchen` zone already declared in
      `shared/game-data/restaurant-layout.json`, read through the same client-side path that
      already reads layout entities — no new zone data file, and no new server field.
- [ ] Entering the zone engages `KITCHEN_CAMERA`; leaving it returns to whichever profile was
      active before (`DEFAULT_CAMERA` or `WIDE_CAMERA` per `Settings.wideCameraView`), not
      unconditionally to `DEFAULT_CAMERA`.
- [ ] Peek (`GameClient#setPeeking`, STORY-045) and the kitchen state resolve deterministically
      when both would apply — pick one precedence, state it in a comment, and make it hold in
      both orders (peek pressed while in the kitchen, and walking into the kitchen while peeking).
- [ ] With reduced motion on (`Settings.reducedMotion`, the boolean `SettingsPanel.tsx` already
      writes), the profile change applies immediately instead of interpolating.
- [ ] `GameClientStatus` gains no field that another system could mistake for authority; if the
      kitchen state is surfaced to React at all, its comment says it is presentation-only.

**Pass-counter barrier (added on request)**

- [ ] `shared/game-data/restaurant-layout.json` declares the barrier as data — the line it sits
      on and the range(s) where crossing is allowed — rather than hardcoding coordinates in a
      system.
- [ ] `shared/game-data/loader.js` validates it at boot, so a malformed barrier is a startup
      failure rather than one that silently fails open.
- [ ] `server/src/game/systems/movement-system.js` refuses a crossing outside the opening. Every
      movement path — walk, sprint and post-sprint slide — goes through one integrate helper, so
      no path clamps but forgets to collide.
- [ ] The test is a **line crossing**, not point-in-box, so it cannot be tunnelled by a fast tick
      at some future speed or geometry.
- [ ] A blocked move keeps its travel along the counter and loses only the component through it —
      walking into it slides toward the opening rather than sticking.
- [ ] The barrier blocks both directions: out of the kitchen as well as into it.
- [ ] Workers are deliberately NOT subject to it (the server worker must cross the pass to carry
      plates), and that cut is stated in a comment rather than left implicit.
- [ ] The pre-existing `RESTAURANT_BOUNDS` clamp still holds — `scripts/smoke-milestone0.mjs`
      depends on it.
- [ ] `scripts/check-movement-barriers.mjs` asserts blocked crossings, the allowed crossing, the
      slide, both sprint cases and the surviving clamp; it is registered in `npm run check`.
- [ ] That check is falsified before it is trusted — break the crossing rejection, confirm it
      fails, restore — and the PR says so.
- [ ] `restaurant-layout-harness.ts`'s existing "Blocked path probes" toggle renders the real
      barrier from the layout data instead of its three hand-placed boxes.

**Verification**

- [ ] A screenshot from `harnesses/src/restaurant-layout-harness.ts` shows the kitchen framing
      with the `kitchen_order_queue_board` back wall, the four stations and the pass all inside
      the frame, and no geometry clipping the near plane.
- [ ] Verified in `harnesses/src/kitchen-bottleneck-harness.ts` that station indicators remain
      legible at the kitchen framing, not only at `DEFAULT_CAMERA`.
- [ ] `npm run check` passes, and the client and harness builds pass.

## Notes

- **PRD sections:** Story 1 "Kitchen operations camera", pp. 3-4 (requirements, acceptance
  criteria and implementation notes), plus rollout step 1 on p. 15, which makes this the first
  story of the whole PRD — it is the perception pass everything after it is read through.
- **Companion art:** `docs/Kitchen indicator concept sheet` (a PNG despite having no extension),
  panel 1 "KITCHEN ZOOM VIEW — ORDER BOARD", is the framing this story is aiming at.
- **`key-files.md`:** `client/src/game/GameClient.ts` is "the client-side hub ... snapshot
  handling, derived UI state, the status callback React and the audio layer both subscribe to" —
  the zone check belongs on its frame path, next to the existing `handleFrame` camera retarget.
- **`conventions.md` Notable Pattern 11:** "React owns UI, Three.js owns the scene, and rules
  emit state while views render it." A camera profile is view state by construction; this story
  must not let it become anything the server or a rule reads.
- **This story preserves Decision 2 (server authority)** trivially — it writes no game state at
  all. Naming it here because "the camera changes what the player can do" is the misreading to
  avoid: interaction legality stays entirely in `action-validator.js`, which never sees a camera.
- **Direct precedent to copy, not re-derive:** STORY-045's `PEEK_CAMERA` and
  `GameClient#setPeeking`. That story already answered "how does a second camera profile get
  swapped in live", including why `fov` was left alone (see `PEEK_CAMERA_DISTANCE`'s own comment
  in `shared/constants/tuning.js` — a wider fov made a walking party unreadable at the frame
  edge). Read it before choosing `KITCHEN_CAMERA`'s numbers.
- **No dependency on any other story in this PRD.** STORY-068 and STORY-069 improve what this
  camera frames, but neither has to land first, and this one must not wait on them.
