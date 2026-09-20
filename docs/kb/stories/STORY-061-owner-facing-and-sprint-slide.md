---
id: STORY-061
title: Owner never faces its movement direction; Chef Blaze's rig only visibly animates the legs; add a sprint slide-overshoot
status: in-progress
prd_source: null
branch: story/061-owner-facing-and-sprint-slide
worktree_path: /Users/brent/table-stakes-worktrees/story-061-owner-facing-and-sprint-slide
base_branch: master
pr_url: null
is_architectural: false
approach_summary: >
  Three asks bundled by the user into one report; treat as three sub-fixes with different
  confidence levels.

  (1) FACING — CONFIRMED ROOT CAUSE, not just a STORY-060 regression: the owner has never turned
  to face its direction of travel, primitive placeholder or Chef Blaze model, because
  `InputController.setFacing()` (`client/src/game/InputController.ts` line 84) is defined but
  **never called anywhere in the client** (confirmed by repo-wide grep — zero call sites).
  `facing` is hard-initialized to `0` (line 26) and stays there for the life of the page.
  `GameClient.ts` line 1394 reads `this.input.getFacing()` and ships that stale `0` to the server
  every input tick; `server/src/game/match.js` line 363 stores whatever it's sent
  (`player.facing = message.facing`) and broadcasts it (line 693); `RestaurantScene.ts` line 1769
  (`group.rotation.y = state.facing;`, with the line-1682 comment confirming this rotates "the
  whole group, primitive or not") then applies that same frozen `0` to every owner every frame.
  The fix is one call site: `server/src/game/bot/bot-controller.js` line 356 already establishes
  the house convention for deriving a facing angle from a movement vector —
  `facing: Math.atan2(x, z)` — the client should do the same thing with its own move intent right
  before sending input (`GameClient.ts` ~line 1389-1396, where `getMoveIntent()` is already
  called), calling `this.input.setFacing(Math.atan2(x, z))` whenever the intent vector is nonzero,
  and leaving `facing` at its last value when the player is stationary (an idle owner should hold
  its last heading, not snap to `0`). This single fix satisfies both "the character doesn't
  change direction" and "let the new character face where you're running" — once `facing` carries
  a real value, the existing `group.rotation.y = state.facing` line already applies it to
  whichever model is in the group, no separate model-facing code needed.

  (2) RIG ANIMATION — UNCONFIRMED, NEEDS REPRODUCTION FIRST, own root cause distinct from (1).
  The user describes the walk animation moving only the legs ("like he's hanging on a pole").
  This is NOT a missing-keyframes problem — read `assets/chef-blaze/build_chef_blaze.py` lines
  296-317: `WALK_BONES` (line 201) explicitly keyframes `thigh`, `shin`, `foot`, `upper_arm`,
  `forearm` (both sides), plus `pelvis` (bob + rotation) and `spine.chest` rotation, every frame
  of `ChefBlaze_Walk_InPlace`. `ChefBlazeModel.ts`'s idle/walk crossfade logic (lines 105-121) was
  re-read and is correct despite looking suspicious at a glance (`moving` is reassigned to
  `nextMoving` on line 108 BEFORE the `from`/`to` ternaries on 109-110 read it, so the swap
  direction is right) — don't waste time re-deriving that, it isn't the bug. The likely areas,
  in order of suspicion, needing actual reproduction (load `ChefBlaze.glb` in isolation, e.g. via
  the existing Asset Showcase harness, and inspect): (a) `build_chef_blaze.py` lines 161-166 —
  `vertex_group_limit_total(limit=4)` + `vertex_group_normalize_all(...)` run AFTER decimating the
  body mesh (line 154); if the decimate step's edge collapses concentrated upper-body vertices
  onto a dominant single bone (spine/root) during the merge, capping+normalizing afterward would
  lock those vertices rigid even though the arm/chest bones are correctly animated underneath —
  this reads as exactly "legs move, torso/arms don't." Check actual per-vertex weight
  distribution on the exported mesh's arm/chest region, not just the pre-decimate source. (b) The
  glTF export (`export_def_bones=True`, line 381) exports only bones flagged as deform bones —
  confirm `upper_arm.*`/`forearm.*`/`spine.chest` are actually flagged deform in the armature (the
  rig's IK control bones per `RIG-README.md` are a separate, non-deforming collection — make sure
  nothing scoped the FK arm bones out along with them). (c) Only after ruling out (a) and (b): a
  runtime issue in `ChefBlazeModel.ts`'s `SkeletonUtils.clone` + manual geometry/material clone
  (lines 77-87) somehow only preserving correct skin binding for leg vertex groups. State which
  of these was the actual cause once found — don't guess in the PR description.

  (3) SPRINT SLIDE-OVERSHOOT — new feature, not a bug. "a little bit of ice" when sprint stops:
  the owner should coast/slide a short distance past where sprint input was released before
  fully stopping, rather than halting the instant input goes to zero. `server/src/game/systems
  /movement-system.js` currently has NO velocity state at all — position is set directly from
  input each tick (lines 50-60) and there is no momentum to build this on. Per Decision 2
  ("server authority is absolute... never computed in the browser"), this MUST be a server-side
  simulation change, not a client-only visual trick: add a per-player velocity (or "slide
  remaining" vector) to `movement-system.js`, populated while `player.sprinting` is true, decayed
  toward zero over a short window once sprint input drops (whether because the key was released
  or `OWNER_SPRINT_MAX_MS` ran out) rather than zeroed instantly, still integrated through the
  existing `clamp(...)` calls so restaurant bounds are never violated mid-slide. New tunables
  belong in `shared/constants/tuning.js` alongside the existing `OWNER_SPRINT_*` block (line
  103-106) — name them in that family (e.g. a slide-deceleration-rate and/or a max slide
  distance/duration), not inline. No client change should be needed for this to render correctly:
  `StateInterpolator` already smooths whatever position the server broadcasts, and
  `RestaurantScene`'s idle/walk animation state is already derived from actual position deltas
  (STORY-060), so a server-side slide will already read as "still walking/running" client-side
  for free.

  Cross-check before finishing: `scripts/check-owner-actions.mjs` line ~897-921 already asserts
  sprint stamina/cooldown behavior (`player.sprinting`, `player.sprintCooldownMs`) against a
  synthetic match — confirm adding velocity/slide state doesn't change what that check observes at
  the moments it samples, and that `smoke-milestone0.mjs`'s out-of-bounds-intent clamp check still
  passes with the new integration path.
created: 2026-09-19
updated: 2026-09-19
---

# Owner never faces its movement direction; Chef Blaze's rig only visibly animates the legs; add a sprint slide-overshoot

Reported by the user after merging STORY-060 (PR #89): the rigged Chef Blaze model's walk cycle
visibly moves only the legs — "like he's hanging on a pole" — with the rest of the body static.
The user also flagged that this is likely tied to a second, older issue: the owner (in either its
old primitive form or the new model) has never turned to face the direction it's moving. Separately,
the user asked for a new movement feel addition: a slight slide/overshoot when sprinting stops, "like
a little bit of ice," for extra sprint dexterity.

Static investigation (see `approach_summary`) already found and confirmed the root cause of the
facing bug with high confidence — it's a one-line omission, not a design problem. The rig
animation defect is NOT yet root-caused; the walk action's authored keyframes do cover the full
body, so reproduction against the actual exported mesh is required before touching any code. The
slide feature is new work with an architectural constraint (must be server-authoritative) worth
getting right the first time.

## Acceptance Criteria

- [ ] `InputController`'s `facing` is derived from the current movement intent
  (`Math.atan2(x, z)`, matching `bot-controller.js`'s existing convention) whenever that intent is
  nonzero, and holds its last value while stationary — sent to the server every input tick same as
  today.
- [ ] Both the rival's primitive owner and the player's own Chef Blaze model visibly turn to face
  the direction of travel during movement (this should fall out of the single fix above via the
  existing `group.rotation.y = state.facing` line — confirm it does, don't add a second code path).
- [ ] Reproduced and root-caused: confirmed which of (a) post-decimation skin-weight capping, (b)
  deform-bone export scoping, or (c) a runtime clone/binding issue is actually why only the legs
  visibly deform during `ChefBlaze_Walk_InPlace`, with the arms/chest/pelvis motion the action
  already authors. State which one, in the PR description.
- [ ] The Chef Blaze model's arms, chest, and pelvis visibly move during the walk animation, not
  just the legs — verified by actually watching it play (in the live scene or the Asset Showcase
  harness), not just by confirming keyframes exist.
- [ ] Sprinting owners slide/coast a short distance past the point where sprint input drops
  (key released, or stamina exhausted) before coming to a full stop, integrated server-side in
  `movement-system.js` with new named tunables in `shared/constants/tuning.js`'s existing
  `OWNER_SPRINT_*` block — not a client-only visual effect.
- [ ] The slide still respects `RESTAURANT_BOUNDS` at every tick (reuses the existing `clamp(...)`
  calls) and doesn't let a player slide through/into something the normal movement clamp already
  prevents.
- [ ] `npm run check` stays green, specifically confirmed for `check-owner-actions.mjs`'s sprint
  stamina/cooldown assertions and `smoke-milestone0.mjs`'s out-of-bounds clamp check.

## Notes

- Not part of any PRD slice (`prd_source: null`) — a direct bug report plus a feature request from
  the user, filed together because the user believes (and static reading partially confirms) they
  touch related code.
- Cites: `client/src/game/InputController.ts` (`setFacing`/`getFacing`/`facing`),
  `client/src/game/GameClient.ts` (~line 1389-1396, the input-send tick),
  `server/src/game/bot/bot-controller.js` line 356 (`Math.atan2(x, z)` convention to reuse),
  `server/src/game/match.js` (`player.facing`), `client/src/scenes/RestaurantScene.ts` line 1769
  (`group.rotation.y = state.facing`), `assets/chef-blaze/build_chef_blaze.py` (`WALK_BONES`,
  the decimate + `vertex_group_limit_total`/`vertex_group_normalize_all` steps, the
  `export_def_bones` glTF export flag), `client/src/scenes/ChefBlazeModel.ts` (crossfade logic —
  already re-checked and is NOT the bug), `server/src/game/systems/movement-system.js` (no
  velocity state today — this is where slide integration goes),
  `shared/constants/tuning.js` lines 103-106 (`OWNER_SPRINT_*` block to extend),
  `scripts/check-owner-actions.mjs` and `scripts/smoke-milestone0.mjs` (existing movement/sprint
  checks to keep green).
- The rig-animation sub-issue is the lowest-confidence-in-root-cause part of this story —
  reproduction against the actual exported `ChefBlaze.glb` is the required first step, not
  optional groundwork, same discipline STORY-058 used for its own "reproduce first" clock bug.
- Scope stays the same as STORY-060: the player's own owner only for anything Chef-Blaze-specific
  (item 2); facing (item 1) and sprint slide (item 3) are owner-movement mechanics and apply to
  both players symmetrically, same as sprint itself already does.
