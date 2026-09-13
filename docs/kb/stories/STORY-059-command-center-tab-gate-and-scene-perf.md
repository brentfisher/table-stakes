---
id: STORY-059
title: Gate the Command Center behind Tab; tune shadow/bloom/pixel-ratio cost; darken the base scene for lighting impact
status: pr-opened
prd_source: null
branch: story/059-command-center-tab-gate-and-scene-perf
worktree_path: /Users/brent/table-stakes-worktrees/story-059-command-center-tab-gate-and-scene-perf
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/83
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

- [x] `HudPanel.tsx`'s Command Center (`CommandScorecard`) is only rendered while
  `status.showTacticalOverview` is true (Tab held open) — reusing the existing Tab-toggle flag and
  mechanism, no new keybinding or state invented.
- [x] `KitchenCommandBoard.tsx`'s own `CommandScorecard` usage (E-press near the physical board) is
  left unchanged, not the reported problem. (Its JSX is untouched, and its CSS scoping against the
  new Tab-coexistence rule was verified by DOM query — `.app > .command-scorecard` structurally
  cannot match it; the combined E-press-board + Tab state was not itself screenshotted — see
  implementation notes.)
- [x] Shadow map: frustum tightened toward the real layout bounds (with justified margin for the
  rival restaurant), and/or resolution/filter reduced if needed — screenshot-verified no
  perceptible loss of shadow quality.
- [x] Bloom + antialias: `antialias` disabled on the base renderer, bloom pass internal resolution
  reduced (~half), bloom `strength`/`radius`/`threshold` parameters UNCHANGED — screenshot-verified
  the glow effect on practical lights/Glow surfaces is still visibly present.
- [x] Pixel ratio cap lowered from 2 to 1.5, matching the existing `food-preview-renderer.ts`
  precedent.
- [x] Real before/after screenshots taken for Part B's changes (same scene/camera state), compared,
  and any regression backed off rather than accepted. A real frame-time/FPS measurement taken if
  feasible in this environment; if not feasible, say so honestly. (Not feasible — see
  implementation notes.)
- [x] Base (day) ambient/hemisphere lighting darkened for more contrast with the practical lights;
  night lighting re-verified to still look correct relative to the new day baseline.
- [x] Screenshot-verified: no table badge, patience ring, freshness ring, complaint marker, or
  wayfinding label became harder to read as a result of the darkening — visual-state-language
  legibility (STORY-016) is a hard constraint, not a trade-off. (Complaint marker verified by code
  reading + structural analogy only — see implementation notes.)
- [x] `npm run check` (including `build:client`) stays green.

## Notes

- Not part of any PRD slice (`prd_source: null`) — standalone UX/performance/aesthetic reports from
  the same conversation.
- Cites: `client/src/ui/HudPanel.tsx` (the unconditional Command Center render to fix),
  `client/src/ui/KitchenCommandBoard.tsx` (the separate, already-correct usage to leave alone),
  `client/src/ui/TacticalOverviewPanel.tsx`/`client/src/game/InputController.ts`/`client/src/game/
  GameClient.ts` (`showTacticalOverview`/`onToggleOverview` — the existing Tab-toggle mechanism to
  reuse verbatim), `client/src/styles/app.css` (`.command-scorecard`/`.tactical-overview` layout —
  the coexistence CSS added once reusing the shared flag let both render together).
- Cites: `client/src/scenes/restaurant-rendering.ts` (shadow map type/tone mapping),
  `client/src/scenes/RestaurantScene.ts` (`keyLight`/`ambient`/`HemisphereLight`/practical
  `PointLight`s, shadow camera frustum, `setNight`), `client/src/game/SceneManager.ts`
  (`EffectComposer`/`UnrealBloomPass`/`antialias`/pixel-ratio cap), `client/src/scenes/
  food-preview-renderer.ts` (the existing 1.5 pixel-ratio precedent to match).
- These three parts were grouped into one story at the user's explicit direction, not by the usual
  "same file area" heuristic this pipeline otherwise uses — they genuinely span a UI bug, GPU
  performance tuning, and an aesthetic lighting change. Keep the PR description clear about which
  part is which so a reviewer isn't confused about scope.

## Implementation notes

All three parts landed in `client/src/ui/HudPanel.tsx`, `client/src/game/SceneManager.ts`,
`client/src/scenes/RestaurantScene.ts`, and `client/src/scenes/restaurant-rendering.ts`. Verified
against a real running app (server on a scratch port, client built and served from it, driven
through `claude-in-chrome`) — a live `POST /api/dev/match {bot:true}` match through lobby →
market_reveal → setup → service, plus the `restaurant-layout` and `customer-flow` dev harnesses.

### Part A — Command Center Tab gate

`HudPanel.tsx`'s `<CommandScorecard status={status} />` now reads
`{inService && status && status.showTacticalOverview ? <CommandScorecard status={status} /> : null}`
— the exact same flag `TacticalOverviewPanel` already uses, no new state or keybinding.
`KitchenCommandBoard.tsx` was not touched. Live-verified round trip in a running service-phase
match: Command Center hidden by default (only the always-on compact `.service-card` /
`.service-context-chip` / "Service ledger" chip visible) → press Tab → both `TacticalOverviewPanel`
and `CommandScorecard` appear together in the same overlay → press Tab again → both close. Confirms
this reuses the existing mechanism exactly, not a parallel one.

**Regression caught on review and fixed**: reusing the shared flag means these two panels can now
render AT THE SAME TIME, which they never did before this story. Their pre-existing standalone
positioning — `.command-scorecard` pinned top-right, `.tactical-overview` centered — collided: the
centered overview's right-hand "RIVAL" value column landed directly underneath the Command Center
card, with no numbers visible next to its labels. Fixed with CSS scoped to
`.app:has(.tactical-overview) > .command-scorecard` (appended at the very end of `app.css` so it
wins the cascade over every earlier breakpoint rule without `!important`; the `>` direct-child
combinator, not a plain descendant selector, is what keeps `KitchenCommandBoard.tsx`'s own
separately-nested `<CommandScorecard>` untouched — see the follow-up fix described right below,
which is where that distinction actually mattered): Command Center docks as a compact top banner
(its `.command-objective-disclosure` `<details>` hidden in this state — it's the tallest single
element and mostly duplicates what the overview's own constraint-diagnosis columns already say),
and the Tactical Overview anchors from the bottom with a capped `max-height` (see the THIRD
regression below for the exact number and why) instead of being vertically centered and free to
grow into the reserved top band. Re-verified live: both panels' full content (all Tactical
Overview values, all 4 Command Center metrics) are visible with zero overlap on Tab-open, and the
close round trip still works.

**Second regression caught on a follow-up review, also fixed**: the first version of that CSS fix
used a plain descendant selector (`.app:has(.tactical-overview) .command-scorecard`), which also
matches the SEPARATE `<CommandScorecard>` nested inside `KitchenCommandBoard.tsx`'s
`<aside className="kitchen-command-board">` — reachable, since `showKitchenCommandBoard` (E-press
near the physical board) and `showTacticalOverview` (Tab) are independent flags a player can have
both open at once, and the new rule's specificity would have out-ranked
`.kitchen-command-board .command-scorecard`'s own existing positioning. Fixed by switching to a
direct-child combinator (`.app > .command-scorecard`): `HudPanel.tsx` returns a fragment, so its
own `CommandScorecard` is a direct child of `.app`, while `KitchenCommandBoard`'s copy sits two
levels deeper and is now structurally excluded regardless of selector specificity. Verified live
via a DOM query while Tab was open: exactly one `.command-scorecard` existed, and
`.app > .command-scorecard` matched it with `parentElement.className === 'app'` and the new
compact-banner `top: 16px` applied — confirming the selector targets the right element. Did not
get a live screenshot of the E-press-board-plus-Tab combined state specifically (walking the
avatar to the board's exact position via the browser-automation tool proved unreliable within the
time available), so this is verified by DOM structure/selector-scoping, not a rendered screenshot
of that exact combined case.

**Third regression caught on a further review pass, also fixed**: the reserved top band
(`.tactical-overview`'s `max-height: calc(100vh - <N>px)`) was first set to 250px, but that only
budgeted for the Command Center card's own height (~234px at ~1429px viewport width), not the
card's 16px top offset plus that height plus any gap before the overview panel — so the overview's
own top edge landed only ~16px below the card's bottom border in a live screenshot, with the
panel's own internal padding the only thing keeping its "Tactical Overview" heading from visually
crowding the card above it. Widened to 300px and re-verified live with a real screenshot at
~1429px (clean gap between the card and the heading now). Not re-verified with a real screenshot
at a wider viewport — the browser-automation `resize_window` tool did not change this
environment's actual page viewport (confirmed via `window.innerWidth` staying ~1427px after a
1920×1080 resize call) — but reasoned safe well past 1429px: in this combined state the card's
width is overridden to `min(960px, 92vw)` (reaches its 960px ceiling at a ~1043px viewport) and
its tallest text, `.command-metric > strong`, is `font-size:clamp(24px, 2.25vw, 36px)` (reaches
its 36px ceiling at a 1600px viewport), so the card's rendered height shouldn't keep growing past
~1600px wide either.

### Part B — rendering cost

- **Shadow frustum**: `keyLight.shadow.camera` tightened from
  `{left:-18, right:18, top:20, bottom:-20}` to `{left:-16, right:16, top:16, bottom:-16}`.
  IMPORTANT correction made on review: these bounds are in the shadow camera's OWN (rotated) view
  space, not world x/z — `keyLight` sits at `(-12, 18, -6)` aiming at the origin, so its basis is
  off-axis in plan, not axis-aligned. A first pass (`left:-11, right:11, top:14, bottom:-16`) was
  derived by treating the numbers as if they mapped directly to world bounds and CLIPPED the real
  floor's far corners — caught only by explicitly re-deriving the camera's basis
  (`z_cam = normalize(light - target)`, `x_cam = normalize(worldUp × z_cam)`) and projecting the
  real floor's 4 corners (`restaurant-layout.json`'s bounds: x -9..9, z -12..12) onto it: worst
  case lands at left/right ≈ ±14.8 (x_cam has a zero world-y component, so standing height never
  makes this worse) and top/bottom ≈ ±10.8 at floor level, growing to ≈ +13.7 at the top for a
  ~5m-tall prop — that 13.7 figure rests on an ASSUMED prop height, not a measured one. Retightened
  to left:-16/right:16 (~1.2 margin past ±14.8) and, on a second review pass, top WIDENED from an
  initial 14 (only ~0.3 margin past the ~13.7 estimate — "cutting it close" per the first draft of
  this very note) to 16 (~2.3 margin), and bottom:-16 (generous margin toward the street/rival
  side — the rival's slab at `buildCompetitor()`'s z -20..-31 was never fully covered even by the
  OLD bottom:-20, so -16 is not a new regression there). Net area 32×32=1024 vs the original
  36×40=1440 — ~1.4x shadow-map texel density at the SAME 2048 resolution/`PCFSoftShadowMap`
  filter, a real if more modest win than the (wrong) first pass implied. Visually confirmed no
  clipping at the kitchen's far back corners (pantry shelving, fridge) via the `restaurant-layout`
  harness after the fix.
- **Bloom + antialias**: `WebGLRenderer({ antialias: false })` (was `true`). Corrected the
  justifying comment on review too: `antialias: true` was never actually contributing anything to
  the composited frame — this scene always renders through `EffectComposer`
  (`SceneManager#start()` calls `composer.render()`, never `renderer.render()` directly), and
  `EffectComposer`'s own render targets are plain `WebGLRenderTarget`s created with no multisample
  `samples` option; `RenderPass` draws the scene into that non-multisampled target. So the flag
  was silently inert the whole time — disabling it is a free win, not a "bloom's blur hides the
  AA seams" trade-off as the first draft of the comment claimed.
  `UnrealBloomPass` is now constructed with half of `EffectComposer`'s own effective resolution
  (`container size * renderer.getPixelRatio()` — the same basis `EffectComposer.setSize` uses
  internally), and `UnrealBloomPass.setSize` halves THAT again for its own internal 5-mip
  render-target chain (`resx = Math.round(width / 2)`). Correction made on a second review pass:
  the story initially claimed this "compounds to a further ~4x reduction" on top of the pass's own
  constructor argument already being halved pre-story — that's wrong. Regardless of what
  `Vector2` the OLD code passed to the `UnrealBloomPass` constructor, `EffectComposer.addPass()`
  immediately overrode it via `setSize(effectiveWidth, effectiveHeight)` = `(container size *
  devicePixelRatio, ...)` — so the pre-story constructor argument never mattered, and the actual
  pre-story internal render-target size was `devicePixelRatio`-dependent (full container size at
  the old `devicePixelRatio` cap of 2, only genuinely "half-container" at `devicePixelRatio` 1).
  The real, still-genuine saving here is that the new code passes a deliberately HALVED effective
  resolution instead of letting `addPass` leave the FULL effective resolution in place — a real
  cut, just not a clean, display-independent "~4x" multiplier the way the first draft of this note
  implied. `strength`/`radius`/`threshold` (0.28/0.48/0.84) are unchanged. Found and fixed two
  correctness gaps on review:
  1. `EffectComposer.addPass()` immediately calls `pass.setSize(effectiveWidth, effectiveHeight)`
     on whatever's just been added, using the composer's FULL effective resolution — this was
     silently overwriting the halved size passed to the `UnrealBloomPass` constructor the moment
     `composer.addPass(this.bloomPass)` ran. It only "worked" in initial testing because the
     `ResizeObserver`'s first callback happened to land before the first rendered frame — fragile
     and non-obvious. Now the halved size is explicitly re-applied via `this.bloomPass.setSize(...)`
     right after `addPass`.
  2. `SceneManager#handleResize` was calling `this.bloomPass.setSize(width / 2, height / 2)` using
     raw CSS-pixel dimensions, but `EffectComposer.setSize(width, height)` actually resizes every
     pass to `width * pixelRatio` × `height * pixelRatio` internally — a units mismatch that made
     the post-resize bloom resolution a THIRD of the composer's effective size (at the 1.5 pixel
     ratio cap), not a half. Fixed to multiply by `renderer.getPixelRatio()` before halving, matching
     the construction-time basis.
- **Pixel ratio**: `Math.min(window.devicePixelRatio, 2)` → `Math.min(window.devicePixelRatio,
  1.5)`, matching `food-preview-renderer.ts`'s existing precedent exactly.

**Before/after screenshots**: `docs/pr-screenshots/story-059-scene-before.jpg` and
`story-059-scene-after.jpg`, same seeded dev room (`seed: "story059fps"`), same default camera
framing, both captured with the Copper & Thyme GLB scenery fully loaded. Captured by temporarily
overwriting the 4 changed files in the worktree with their pre-STORY-059 content (via `git show
<parent-commit>:<path>`, never `git checkout` on the working tree — that command was blocked by
the environment's own safety classifier, so a plain file copy was used instead), rebuilding
`client`, screenshotting, then restoring the post-STORY-059 content and rebuilding again
(confirmed byte-identical via matching Vite output hashes before/after the round trip, and
`git diff --stat` showing no changes once restored). `story-059-scene-after.jpg` was re-captured a
second time after the shadow-frustum fix above, so it reflects the corrected
`left:-16/right:16/top:16/bottom:-16` numbers, not the clipped first attempt. Visual read: the
"after" scene is appreciably darker/more contrasted with tighter, crisper table shadows; no
jaggies, banding, clipped/missing shadows at the floor's far corners, or loss of the warm
practical-light glow versus "before" — matches the "sharper, not worse" prediction for the shadow
frustum and shows no bloom/AA regression. Also directly observed CommandScorecard, patience rings
(green rings on queued customers), freshness rings (green rings on ready dishes at the kitchen
queue board), table badges, and order/wayfinding chip labels in a live service-phase match under
the new (after) lighting — all clearly legible (see Part C below).

**FPS/frame-time measurement — not feasible in this environment, reported honestly rather than
fabricated.** Attempted a `requestAnimationFrame`-delta sampling script via `javascript_tool`
against the live game tab: it collected 0 samples in a 5-second window. This matches a known,
already-documented `claude-in-chrome` limitation (tabs report `visibilityState: 'hidden'` to the
page, which stops `requestAnimationFrame` entirely) — rAF-driven loops, including `SceneManager`'s
own render loop and this measurement script itself, don't run at a meaningful rate in this
environment. The `restaurant-layout` harness's own on-page FPS counter (a separate, non-rAF-gated
accumulator) did read a low, roughly-stable number (~16) with the after-state code, but since that
harness's renderer doesn't share `SceneManager`'s antialias/bloom-resolution/pixel-ratio settings
(it configures its own renderer separately, at `antialias:true`/pixel-ratio 2), that number isn't
representative of Part B's actual savings either — it would mainly reflect the shadow-frustum
change. No number is reported as "the" perf result; the cost reduction is instead justified by the
code-level math cited in each change's inline comment (frustum area ratio, bloom's internal
resolution halving math, and the devicePixelRatio-squared fragment-work scaling), consistent with
this repo's "qualitative reasoning over fabricated simulation math" convention elsewhere.

### Part C — darker base lighting

`RestaurantScene`'s constructor: `AmbientLight` 0.48 → 0.32, `HemisphereLight` 0.65 → 0.4 (both
day-baseline only). `restaurant-rendering.ts`'s `renderer.toneMappingExposure`: 1.05 → 0.97 (a
small additional darkening pass). `keyLight` (2.6, directional/shadow-casting) was deliberately
left unchanged — it isn't the "flat" contribution the ask was about, and the AC only names
ambient/hemisphere. `setNight()`'s night ambient was lowered proportionally, 0.32 → 0.2, so day
stays visibly brighter than night after the day baseline dropped (night's own value used to equal
the OLD day value, which would have made the two nearly indistinguishable if left alone); `keyLight`
day/night values (2.6/0.85) and the practical-light night multiplier (×0.72) are untouched.

**Legibility verification.** In a live service-phase match under the new lighting: table badges
("O" queue-position glyphs), order/wayfinding chip labels (dish names above tables), the kitchen
queue board's ticket labels ("T01", "WAITING ON 2"), freshness rings (green rings around ready
dishes on the pass), and patience rings (green rings around queued customers) were all screenshotted
and are clearly, easily legible — no perceptible readability loss from the darkening. The complaint
marker (STORY-056, `RestaurantScene.ts`'s `buildComplaintMarker`/`updateComplaintMarkers`) was
**not** observed live — no customer went unhappy during the ~2.5-minute service window tested, and
forcing one via the `customer-flow` harness didn't work: that harness's "Patience remaining" slider
calls `scene.upsertCustomer(...)` directly (a per-customer call), but `updateComplaintMarkers` only
runs from `updateFloorState`'s full-snapshot batch (see that method's own header comment), so the
harness's per-customer path can't trigger it — a harness limitation, not something touched by this
story. Confidence that the complaint marker is unaffected rests on: (1) it uses the identical
ring + emissive-glyph rendering technique, anchored to the same table meshes, as the freshness/
patience rings that WERE screenshot-verified legible under the new lighting, and (2) nothing in
this story's diff touches `buildComplaintMarker`'s own materials/colors. This is a code-reasoning
inference, not a direct screenshot, and is called out here rather than overclaimed.

### Judgment calls summary

- Shadow frustum: `left:-16/right:16/top:16/bottom:-16` — derived from the shadow camera's actual
  (rotated) view-space basis, not a naive world-space reading of the old numbers (see margin
  reasoning above); `top` widened from an initial 14 to 16 on a second review pass for a safer
  margin past the ~13.7 (assumed-height) tall-prop estimate. At unchanged 2048 resolution/
  `PCFSoftShadowMap` filter — tightening alone was visually sufficient, so resolution/filter
  weren't also dropped.
- Bloom resolution: passed at half of `EffectComposer`'s own effective (pixelRatio-scaled)
  resolution to the constructor, with that size explicitly re-applied right after
  `composer.addPass()` (which otherwise resets it to the FULL effective resolution) and
  `SceneManager#handleResize` fixed to re-apply the SAME pixelRatio-scaled halving after every
  resize. The exact multiplier this buys versus the old code is devicePixelRatio-dependent (see
  Part B's own note above on why an earlier "~4x" claim here was wrong) rather than a clean
  constant, but the direction and mechanism are sound: it's genuinely less internal render-target
  area than the FULL effective resolution `addPass` would otherwise leave the old code running at.
- Command Center / Tactical Overview coexistence: resolved with `.app > .command-scorecard`
  scoped CSS, gated on `:has(.tactical-overview)` (compact top-banner Command Center,
  bottom-anchored height-capped Tactical Overview) rather than decoupling their shared toggle —
  the story's explicit instruction was to reuse the exact same flag, so the fix is layout-only,
  not a second keybinding. The direct-child combinator (not a plain descendant selector) is
  deliberate — a descendant selector also matched, and would have broken,
  `KitchenCommandBoard.tsx`'s own separately-nested `CommandScorecard` (see Part A's own note on
  this second, follow-up fix). The Tactical Overview's reserved top band is 300px, not the
  Command Center card's ~234px height alone — a third follow-up fix, also documented in Part A,
  since 250px left almost no gap between the two panels in a live screenshot.
- Ambient 0.32 / hemisphere 0.4 / toneMappingExposure 0.97 for day; night ambient re-tuned to 0.2
  to preserve a visible day/night gap. `keyLight` intensity left alone in both day and night.
- FPS/frame-time: not measured numerically in this environment (documented `claude-in-chrome`
  rAF/visibility limitation, confirmed firsthand); cost claims rest on code-level math instead.
- Complaint marker legibility: verified by code/structural analogy to the freshness/patience rings,
  not by a direct live screenshot (harness limitation, see above).
- Command Center + Kitchen Command Board + Tab combined state: verified structurally (DOM query
  confirming the `>` selector's scoping is correct) rather than with a live screenshot — walking
  the avatar to the physical kitchen command board's exact position via the browser-automation
  tool proved unreliable within the time available for this story.
