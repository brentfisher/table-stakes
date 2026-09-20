---
id: STORY-062
title: Key-light shadow camera frustum is set but never applied, causing intermittent black patches in the scene
status: pr-opened
prd_source: null
branch: story/062-shadow-camera-frustum-never-applied
worktree_path: /Users/brent/table-stakes-worktrees/story-062-shadow-camera-frustum-never-applied
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/90
is_architectural: false
approach_summary: >
  CONFIRMED root cause via static reading plus a user follow-up that ruled out the alternative
  hypothesis. Reported: "the screen now flashes black on about half the screen at random" after
  merging STORY-060 (PR #89). The user confirmed, when asked, that this is a PATCH WITHIN the 3D
  scene flickering — not the whole canvas going black — which rules out an unhandled per-frame
  exception dropping a whole `composer.render()` call (that was the other live hypothesis; see
  Notes) and points squarely at the scene's own shadow rendering.

  `RestaurantScene.ts` line 892: `Object.assign(this.keyLight.shadow.camera, { left: -16, right:
  16, top: 16, bottom: -16, near: 1, far: 60 });` — STORY-059's own comment above this line
  (lines 871-891) documents in detail why these particular bounds were chosen (a real
  frustum-fitting exercise against the restaurant floor's actual corners). The bug: `Object.assign`
  only sets the plain properties on the `OrthographicCamera` instance; it never calls
  `updateProjectionMatrix()`. Three.js's shadow-map path (`WebGLShadowMap` →
  `LightShadow.updateMatrices`) uses the shadow camera's existing `projectionMatrix` as-is every
  frame and never recomputes it from `left/right/top/bottom/near/far` on its own — confirmed
  against the installed `three` version's source during investigation. So the shadow camera has
  been rendering with `DirectionalLightShadow`'s constructor-default frustum
  (`OrthographicCamera(-5, 5, 5, -5, 0.5, 500)`) this entire time, not the intended ±16/near-1/
  far-60 one — STORY-059's frustum-fitting work has never actually taken effect. `git log -p`
  confirms this `Object.assign`-without-`updateProjectionMatrix` pattern predates STORY-060
  entirely; STORY-060 didn't introduce the bug, it made it far more visible by adding a large,
  actively moving `castShadow = true` humanoid (`ChefBlazeModel.ts` — previous shadow casters were
  small capsule/cone primitives) whose silhouette now regularly crosses in and out of that
  much-smaller-than-intended real frustum, plus STORY-059 separately darkened the base scene's
  ambient/hemisphere lighting (line ~895's comment) — both together make an incorrect shadow
  frustum's artifacts (surfaces outside the actual ±5 range reading as full shadow/black, or
  shadow-map texel wraparound at the frustum edge) read as sudden black patches tracking a moving
  character, i.e. exactly "flashes black... at random."

  The fix is one line: call `this.keyLight.shadow.camera.updateProjectionMatrix()` immediately
  after the `Object.assign` on line 892 (`OrthographicCamera` exposes this method precisely to
  recompute `projectionMatrix` after any of those fields change — same method every other camera
  resize/FOV-change path in three.js code is expected to call). No other `Object.assign` onto a
  `.shadow.camera` or bare `.camera` exists anywhere else in `RestaurantScene.ts` (checked via
  grep) — this is a single, isolated fix, not a pattern to hunt down elsewhere.

  Verification must be visual, not just "it compiles": load the scene (live client or the
  restaurant-layout / asset-showcase harness, whichever most easily shows the key light's
  shadows), walk the owner (ideally with the new Chef Blaze model) across the full floor,
  including the far corners STORY-059's comment specifically called out (pantry shelving,
  fridge/wash station, the rival's slab), and confirm no black/missing-shadow patches appear
  anywhere any more — plus confirm the shadow quality/coverage now visually matches what
  STORY-059's frustum math actually intended (tighter, higher-texel-density shadows over the real
  floor bounds), since that improvement was never actually live until this fix.
created: 2026-09-19
updated: 2026-09-19
---

# Key-light shadow camera frustum is set but never applied, causing intermittent black patches in the scene

Reported by the user right after merging STORY-060: random black patches flashing inside the
rendered scene (confirmed via follow-up to be a patch within the 3D view, not the whole canvas
going black). Static investigation found a confirmed, pre-existing bug: STORY-059's carefully
computed shadow-camera frustum (`RestaurantScene.ts` line 892) has never actually been applied to
the shadow camera's projection matrix, because `Object.assign` doesn't trigger the recompute that
`OrthographicCamera.updateProjectionMatrix()` performs. The shadow camera has been silently
rendering with three.js's tiny default frustum this whole time. STORY-060 didn't cause this bug,
but its new, larger, actively-moving shadow-casting character made the resulting artifacts finally
obvious enough to notice.

## Acceptance Criteria

- [x] `this.keyLight.shadow.camera.updateProjectionMatrix()` is called right after the
  `Object.assign(...)` on `RestaurantScene.ts` line 892 (or the assignment is restructured to set
  the fields directly on the camera followed by the same call — either way, the intended
  left/right/top/bottom/near/far actually takes effect on the rendered shadow map).
- [x] Confirmed via grep that no other `Object.assign` onto any `.shadow.camera` or camera object
  exists elsewhere in the client missing the same call (STORY's own investigation found none, but
  don't skip re-checking as part of the fix).
- [x] Visually verified (live client or an appropriate harness): walking the owner across the
  full restaurant floor, including the far corners STORY-059's comment calls out by name (pantry
  shelving, fridge/wash station, the rival's slab), shows no black/missing-shadow patches any more.
- [x] Visually confirmed the shadow quality now actually reflects STORY-059's intended tighter
  frustum (higher effective shadow-map texel density over the real floor bounds) — since that
  improvement was never live before this fix, note in the PR whether it's now visibly sharper.
  **Correction found during verification: it is NOT sharper — see Notes below.**
- [x] `npm run check` stays green.

## Notes

- Not part of any PRD slice (`prd_source: null`) — a direct bug report.
- Cites: `client/src/scenes/RestaurantScene.ts` lines 865-897 (`keyLight` construction, STORY-059's
  frustum-fitting comment, the buggy `Object.assign` on line 892), `client/src/scenes
  /ChefBlazeModel.ts` (`castShadow = true`, the new large moving shadow caster that exposed this),
  `shared/game-data/restaurant-layout.json` (`bounds` — the floor corners STORY-059's math was
  fitted against).
- An earlier hypothesis (an unhandled per-frame exception in the render loop silently dropping a
  whole frame, presenting as the entire canvas going black) was investigated and ruled out by the
  user's own confirmation that the black patch is inside the scene, not the whole canvas — no
  render-loop error-handling change is needed for this report. `SceneManager.ts`'s render loop
  genuinely has no try/catch around its per-frame work, which remains true and could still matter
  for some other future symptom, but is out of scope here since it isn't this bug.
- Separately noted during investigation, NOT part of this story: `ChefBlazeModel.ts` line 101's
  `let disposed = false` is never set to `true` (dead code) — harmless today because
  `RestaurantScene.removeOwner` already removes the group before disposal runs, but worth a
  one-line cleanup if anyone is back in that file for another reason.
- **Fix landed and verified (2026-09-19).** The one-line fix
  (`this.keyLight.shadow.camera.updateProjectionMatrix()` right after the `Object.assign` on
  `RestaurantScene.ts`) is in. Confirmed via grep (`Object.assign.*\.camera` and a broader
  `shadow\.camera` search) that no other camera in the client has this set-without-apply pattern.
- **Correction to the "sharper shadows" expectation above**: it's the opposite, and the arithmetic
  says so directly. The frustum that was ACTUALLY rendering all along was three.js's constructor
  default (`-5..5`, 10×10 area), not STORY-059's old `±18/±20` (36×40=1440) or new `±16` (32×32=1024)
  numbers — both of those were always larger than what was live. So this fix moves the covered area
  from 100 to 1024 world-units² at the same 2048 map size and `radius: 4` PCF blur — that's a
  ~10x drop in texel density over the region that was already covered, meaning shadows near the
  center may read softer/blockier now, not sharper. What the fix actually buys is coverage: props
  and the owner far from center, previously outside the tiny default frustum and silently
  unshadowed, are now shadowed at all. The `RestaurantScene.ts` comment block above the fix was
  updated in the same commit to correct this (the old comment's "1.4x texel density" and "no
  clipping" claims were both observations of the broken default frustum, not the intended one).
- **Verification method and a real gap**: visual verification used the `restaurant-layout` dev
  harness (which imports the actual production `RestaurantScene`, not a stand-in). Did an A/B by
  temporarily disabling the `updateProjectionMatrix()` call and temporarily widening the harness's
  `orbitOwner` radius (both reverted before commit — not part of the shipped diff) so the owner's
  orbit reaches the real floor edges. Pre-fix: the owner's shadow disappears entirely once it
  orbits past the tiny default frustum. Post-fix: the shadow stays present across the full floor,
  including the kitchen's far corners (pantry shelving, wash station). This directly confirms the
  diagnosed root cause and its fix. However, the harness did **not** reproduce the user's originally
  reported symptom ("flashes black... at random") in either state — what was observed was a
  vanishing shadow, not a flashing black patch. The fix is still correct for the diagnosed bug
  (the frustum genuinely was never applied), but the specific black-flash symptom was not
  independently reproduced and confirmed cured in this harness; that connection rests on the
  root-cause reasoning in `approach_summary` above, not on a reproduction.
- `npm run check` is green (all 34 check scripts + 5 smoke scripts).
