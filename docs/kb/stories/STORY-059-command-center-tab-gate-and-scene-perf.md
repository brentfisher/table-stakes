---
id: STORY-059
title: Gate the Command Center behind Tab; tune shadow/bloom/pixel-ratio cost; darken the base scene for lighting impact
status: in-progress
prd_source: null
branch: story/059-command-center-tab-gate-and-scene-perf
worktree_path: /Users/brent/table-stakes-worktrees/story-059-command-center-tab-gate-and-scene-perf
base_branch: master
pr_url: null
is_architectural: false
approach_summary: >
  Three grouped asks, all client-only rendering/UI tuning, no server/schema change for any of
  them.
  PART A — Command Center dominates the screen. Root cause confirmed by reading the current
  code: `client/src/ui/HudPanel.tsx` line ~185 renders `<CommandScorecard status={status} />`
  UNCONDITIONALLY for the entire service phase — `{inService && status ? <CommandScorecard
  status={status} /> : null}` — not gated by Tab, not gated by proximity to anything. This is a
  SEPARATE render from `client/src/ui/KitchenCommandBoard.tsx` line 34, which also renders
  `<CommandScorecard status={status} />` but is itself already correctly gated (E-press near the
  physical `kitchen_command_board` entity, `GameView.tsx`'s `nearKitchenCommandBoard &&
  showKitchenCommandBoard`) — that copy is legitimately contextual and already "minimized when
  not in use" by construction; LEAVE IT ALONE, it is not the reported problem. Fix ONLY
  `HudPanel.tsx`'s unconditional copy: this codebase already has an established, tested Tab-toggle
  mechanism for exactly this "open only on Tab, otherwise not rendered at all" behavior —
  `TacticalOverviewPanel.tsx`, driven by `status.showTacticalOverview`
  (`GameClient.ts` line ~366/484), toggled by `InputController.ts`'s `onToggleOverview` (bound to
  the Tab key, wired in `GameClient.ts` line ~662-663:
  `this.patchStatus({ showTacticalOverview: !this.status.showTacticalOverview })`), and
  force-closed on leaving service/final_rush (`GameClient.ts` line ~1094). Reuse this SAME flag —
  change `HudPanel.tsx`'s condition to also require `status.showTacticalOverview` — rather than
  inventing a second Tab-bound flag/keybinding. "Minimize when not in use" = not rendered at all
  when the flag is false, matching `TacticalOverviewPanel`'s own existing behavior exactly (it
  returns nothing when `showTacticalOverview` is false — see `GameView.tsx`'s own conditional
  around it). Verify in the browser afterward that a player can still see SOME minimal service
  status without Tab held open (`HudPanel`'s own always-on compact scoreboard, separate from
  `CommandScorecard`, already exists for that — confirm it's untouched and still sufficient).
  PART B — rendering cost tuning (concrete numbers, not guesses; a concurrent PR, "polish kitchen
  lighting", recently added all of this to the MAIN gameplay scene, not just a decorative one):
  (1) SHADOWS: `client/src/scenes/restaurant-rendering.ts` sets `renderer.shadowMap.type =
  THREE.PCFSoftShadowMap` (the most expensive filter) at `RestaurantScene.ts`'s
  `keyLight.shadow.mapSize.set(2048, 2048)`. The shadow camera's frustum
  (`Object.assign(this.keyLight.shadow.camera, { left: -18, right: 18, top: 20, bottom: -20,
  near: 1, far: 60 })`, ~line 856) is roughly DOUBLE the real playable floor
  (`shared/game-data/restaurant-layout.json`'s own `bounds`: x -9..9, z -12..12, an 18×24 area) —
  a needlessly generous frustum wastes shadow-map texel density. Tighten the frustum toward the
  real bounds (with a sensible margin for the rival restaurant slab across the street, which sits
  further out — z as far as -26 per `buildCompetitor`; the CURRENT frustum's bottom=-20 doesn't
  even reach that today, so tightening further is not a new regression there, but verify visually
  both restaurant halves keep acceptable shadow coverage before finalizing a number) — a tighter
  frustum at the SAME 2048 resolution reads SHARPER, not worse, so this alone may already look
  like a quality improvement, not a compromise. Additionally consider dropping the shadow-map
  resolution itself (2048→1024) and/or the filter type (`PCFSoftShadowMap`→`PCFShadowMap`, still
  soft-edged but cheaper) if the tightened frustum alone isn't sufficient — screenshot-compare
  before deciding how far to go.
  (2) BLOOM + ANTIALIAS: `client/src/game/SceneManager.ts` runs a FULL `EffectComposer`
  (`RenderPass`+`UnrealBloomPass`+`OutputPass`) unconditionally every frame, at full container
  resolution, on TOP of `antialias: true` on the base `WebGLRenderer` (~line 50/83-96). Running
  native MSAA and a full-resolution post-process pass together is largely wasted cost — the AA
  benefit is diminished once bloom blurs the frame anyway. Fix: turn off `antialias` on the
  renderer (rely on the composer's own `OutputPass` for the final image) AND reduce
  `UnrealBloomPass`'s internal resolution to roughly half the container size (a standard bloom
  optimization — the blur itself hides the downsample, cost drops close to 4x for a barely
  perceptible difference, since bloom is a soft/diffuse effect by nature). Do NOT change the
  bloom `strength`/`radius`/`threshold` parameters (0.28/0.48/0.84) — those control the LOOK, not
  the cost; only the resolution/AA changes are pure cost cuts.
  (3) PIXEL RATIO: `SceneManager.ts` caps `devicePixelRatio` at 2
  (`this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`, ~line 52) — every cost
  above scales with shaded pixel count, so 2x ratio means 4x the fragment work of 1x on a
  Retina/HiDPI display. This SAME codebase already uses a LOWER cap elsewhere for exactly this
  reason: `client/src/scenes/food-preview-renderer.ts` uses `Math.min(devicePixelRatio, 1.5)`.
  Match that precedent here — change the cap from 2 to 1.5. This is the single highest-leverage,
  lowest-risk change of the three (near-imperceptible at this game's camera distance/style,
  confirmed already acceptable elsewhere in this same codebase).
  MANDATORY VERIFICATION for Part B (explicit user instruction): take real BEFORE and AFTER
  screenshots (same camera angle/scene state, e.g. a live dev-bot match at the same match
  timestamp/phase if achievable, or at minimum the same static harness scene) via `claude-in-chrome`
  or equivalent, and visually compare — confirm no perceptible quality loss (shadows still read as
  soft/present, bloom glow on practical lights/Glow surfaces still visible, no new aliasing/jaggies
  egregious enough to be distracting) before finalizing. If any change DOES look worse, back off
  that specific number rather than accepting a visible regression — "no loss of quality" is a hard
  requirement here, not a nice-to-have. If a real frame-time/FPS measurement is feasible in this
  environment (e.g. sampling `performance.now()` deltas via a console script, or a DevTools
  performance capture through the browser tooling available), take one before and after too, to
  back the "improved performance" claim with a real number rather than code-reasoning alone; if not
  feasible, say so honestly rather than fabricating a measurement.
  PART C — darken the base scene for more lighting impact/contrast (explicit user request, an
  aesthetic/mood tuning, not a bug fix). Current base lighting in `RestaurantScene.ts`'s
  constructor: `AmbientLight(0xffffff, 0.48)`, `HemisphereLight(0xc5dcf2, 0x695138, 0.65)`, plus
  `keyLight` (DirectionalLight) at intensity 2.6 — all FLAT/uniform illumination that washes out
  contrast against the 3 new practical `PointLight`s (intensities 4.2/3.1/1.25) and the bloom pass
  meant to make those lights pop. Classic technique: lower the flat ambient/hemisphere
  contribution (and optionally `restaurant-rendering.ts`'s `renderer.toneMappingExposure`, currently
  1.05, slightly down) so the practical lights read as a bigger relative jump from the base level —
  this can make the SAME point lights look more dramatic without raising their own intensity or
  the bloom pass's cost (may even let bloom read effectively at a LOWER strength than today,
  synergizing with Part B's cost-cutting rather than fighting it). Preserve `setNight()`'s existing
  relative day/night behavior (`RestaurantScene.ts` ~line 2490s: ambient 0.48↔0.32, keyLight
  2.6↔0.85, practicalLights scaled ×0.72 at night) — darken the DAY baseline, keep the night
  baseline's own already-darker proportion intact (or re-tune it too if it no longer reads
  correctly relative to the new day value — implementer's judgment, verify visually both states).
  HARD CONSTRAINT: this game's entire visual-state language (STORY-016 — table badges, patience
  rings, freshness rings, the complaint marker from STORY-056, wayfinding labels) depends on
  colors/glyphs staying legible at a glance from the normal play camera. Verify via screenshot that
  darkening the scene does NOT make any of these harder to read — if it does, back off rather than
  accept a readability regression for the sake of mood.
created: 2026-09-13
updated: 2026-09-13
---

# Gate the Command Center behind Tab; tune shadow/bloom/pixel-ratio cost; darken the base scene for lighting impact

Three grouped asks from the same conversation, all touching the client's rendering/UI layer:

1. **"the screen is dominated by the command center, make it open only if you press 'tab' and minimize when not in use"** — root cause: `HudPanel.tsx` renders the Command Center scorecard unconditionally for the whole service phase. A separate, already-correctly-gated copy exists elsewhere and is not in scope.
2. **Performance**: three concrete, recently-added GPU cost sources (shadow map, bloom+antialias redundancy, pixel ratio) identified by reading the actual renderer/scene setup code, not guessed. User confirmed: implement options #1-#3, verified with real before/after screenshots so no visual quality is lost.
3. **"is it possible to make the entire scene darker to improve the impact of lighting?"** — an aesthetic request: lower the flat ambient/hemisphere lighting so the new practical point lights and bloom pass read with more contrast/drama.

## Acceptance Criteria

- [ ] `HudPanel.tsx`'s Command Center (`CommandScorecard`) is only rendered while
  `status.showTacticalOverview` is true (Tab held open) — reusing the existing Tab-toggle flag and
  mechanism, no new keybinding or state invented.
- [ ] `KitchenCommandBoard.tsx`'s own `CommandScorecard` usage (E-press near the physical board) is
  left unchanged — confirmed still working, not the reported problem.
- [ ] Shadow map: frustum tightened toward the real layout bounds (with justified margin for the
  rival restaurant), and/or resolution/filter reduced if needed — screenshot-verified no
  perceptible loss of shadow quality.
- [ ] Bloom + antialias: `antialias` disabled on the base renderer, bloom pass internal resolution
  reduced (~half), bloom `strength`/`radius`/`threshold` parameters UNCHANGED — screenshot-verified
  the glow effect on practical lights/Glow surfaces is still visibly present.
- [ ] Pixel ratio cap lowered from 2 to 1.5, matching the existing `food-preview-renderer.ts`
  precedent.
- [ ] Real before/after screenshots taken for Part B's changes (same scene/camera state), compared,
  and any regression backed off rather than accepted. A real frame-time/FPS measurement taken if
  feasible in this environment; if not feasible, say so honestly.
- [ ] Base (day) ambient/hemisphere lighting darkened for more contrast with the practical lights;
  night lighting re-verified to still look correct relative to the new day baseline.
- [ ] Screenshot-verified: no table badge, patience ring, freshness ring, complaint marker, or
  wayfinding label became harder to read as a result of the darkening — visual-state-language
  legibility (STORY-016) is a hard constraint, not a trade-off.
- [ ] `npm run check` (including `build:client`) stays green.

## Notes

- Not part of any PRD slice (`prd_source: null`) — standalone UX/performance/aesthetic reports from
  the same conversation.
- Cites: `client/src/ui/HudPanel.tsx` (the unconditional Command Center render to fix),
  `client/src/ui/KitchenCommandBoard.tsx` (the separate, already-correct usage to leave alone),
  `client/src/ui/TacticalOverviewPanel.tsx`/`client/src/game/InputController.ts`/`client/src/game/
  GameClient.ts` (`showTacticalOverview`/`onToggleOverview` — the existing Tab-toggle mechanism to
  reuse verbatim).
- Cites: `client/src/scenes/restaurant-rendering.ts` (shadow map type/tone mapping),
  `client/src/scenes/RestaurantScene.ts` (`keyLight`/`ambient`/`HemisphereLight`/practical
  `PointLight`s, shadow camera frustum, `setNight`), `client/src/game/SceneManager.ts`
  (`EffectComposer`/`UnrealBloomPass`/`antialias`/pixel-ratio cap), `client/src/scenes/
  food-preview-renderer.ts` (the existing 1.5 pixel-ratio precedent to match).
- These three parts were grouped into one story at the user's explicit direction, not by the usual
  "same file area" heuristic this pipeline otherwise uses — they genuinely span a UI bug, GPU
  performance tuning, and an aesthetic lighting change. Keep the PR description clear about which
  part is which so a reviewer isn't confused about scope.
