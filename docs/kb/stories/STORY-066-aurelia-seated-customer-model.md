---
id: STORY-066
title: Put Aurelia on seated customers
status: pr-opened
prd_source: null
branch: story/066-aurelia-seated-customer-model
worktree_path: null
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/94
is_architectural: false
approach_summary: >
  Depends on STORY-063. Sequenced LAST because it has a problem the other two do not — but it is
  `ready`, not blocked: authoring a pose the source scene lacks is exactly what
  `build_chef_blaze.py` already did for the walk cycle, so this is known work, not an unknown.

  THE SEATED-POSE PROBLEM. Customers in this game are SEATED DINERS, not walkers. `upsertCustomer`
  (`RestaurantScene.ts` ~line 2315) builds a party of up to several `diner` groups around a table,
  each a `CapsuleGeometry(0.18, 0.2, 5, 10)` torso at `y = 0.45` with a `SphereGeometry(0.17)` head
  at `y = 0.82` — roughly a 1.0 m seated silhouette, and deliberately small because several ring one
  table. Aurelia's rig ships exactly ONE action: a 120-frame standing breathing loop. There is no
  seated pose anywhere in `cast-pack.blend`, and a standing model dropped into a seated slot will
  read as a diner levitating through the tabletop.

  So this story cannot be a straight port the way STORY-064/065 are. Someone must author a seated
  pose — hips and knees flexed to ~90°, torso settled — as a new action in the build script, the same
  way `build_chef_blaze.py` authored a walk cycle the source file did not have. That is the bulk of
  the work here and the reason for the separate story.

  BUDGET IS TIGHTEST HERE, AND THIS IS THE ONLY REAL CROWD. `restaurant-layout.json` has 6 tables
  and `customer-segments.json` caps `partySize` at 4, so the worst case is **24 simultaneous seated
  diners** — against exactly one host, one server and one owner. Aurelia is therefore the only
  character where instancing and triangle budget genuinely bite: STORY-063 targets <= 8,000
  triangles for her so a full dining room stays near ~192,000 triangles of skinned geometry. Re-check
  that against measured frame cost and decimate further if it does not hold.

  IDENTITY. Diners are currently tinted by customer segment (`segmentColor`, from
  customer-segments.json) — a textured model in an ivory pantsuit overrides that signal. Decide
  where segment identity goes instead (a ring, a chip, a tint on an accessory) rather than dropping
  it. And every diner at every table being the same blonde woman is its own problem: either vary
  her, or apply her to only one seat per party, or accept and document it.
created: 2026-09-20
updated: 2026-09-20
---

# Put Aurelia on seated customers

`Aurelia.glb` (built by STORY-063) replaces the primitive diner capsule for seated customers — but
only after a seated pose exists, which the source scene does not supply.

## Acceptance Criteria

- [ ] A seated idle action is authored in `build_cast.py` (hips/knees flexed, torso settled) and
  exported as a named clip, following the precedent of `build_chef_blaze.py` authoring a walk cycle
  its source file lacked.
- [ ] The seated model sits correctly at the table — feet, seat and tabletop all read right, no
  intersection with the table mesh and no floating.
- [ ] The model matches the ~1.0 m seated silhouette of the primitive it replaces
  (`CapsuleGeometry(0.18, 0.2)` at `y = 0.45`, head at `y = 0.82`), so party spacing around the
  table still works at the existing diner offsets.
- [ ] Shared-geometry/shared-material crowd path — 24 diners must not each own a copy of the mesh
  and materials. This is the one character where that path is load-bearing rather than a formality.
- [ ] Customer segment identity survives: the tint that `segmentColor` used to carry is re-expressed
  somewhere visible, not silently dropped.
- [ ] The "every diner is the same woman" problem is addressed deliberately — varied, limited to one
  seat per party, or accepted and documented in the PR with the reason.
- [ ] The patience ring and unhappy/complaint markers still read correctly against the model.
- [ ] Frame cost measured with all 6 tables full (24 diners) animating, alongside the owner, host and
  server — 27 skinned meshes, where STORY-060 sized this scene for one.
- [ ] `npm run check` stays green.

- [x] **Verified in the live scene** (asset-showcase harness, composed mode): seated Aurelia renders
  on customers through `upsertCustomer`, on her segment disc, with the patience ring intact. Also
  shown in the new **Cast Models** harness, which lines up all four rigged characters at close
  range through the production loader.
- [x] **Two rigging defects in the source were found and fixed in the build**, both of which also
  affected the already-merged workers and owner avatar:
  - Every `.R` vertex group in `cast-pack.blend` carries ZERO weight, so the right arm and right
    leg of all three cast characters were welded rigidly to the torso. `mirror_side_weights`
    populates them from the `.L` side via a KD-tree spatial match on the dense mesh.
  - `WALK_BONES` paired each bone with the OPPOSITE amp on the other side, on the assumption of a
    mirrored rig. These rigs are not mirrored, so the opposite amp cancelled the opposite phase and
    both legs swung IN UNISON. Fixed here and in `build_chef_blaze.py` — the player's own avatar
    had been hopping rather than walking since STORY-060.

## Notes

- The seated-pose authoring is the bulk of this story and the reason it is split out. If it proves
  more expensive than STORY-063's walk cycle, the fallback is to leave seated diners as primitives
  and use Aurelia only for a standing waiting-party customer at the queue/host stand.
- Depends on STORY-063; sequenced after STORY-064 and STORY-065.
- Out of scope: worker roles, both owner avatars.
