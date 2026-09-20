---
id: STORY-065
title: Put Vivienne the concierge on the server worker
status: ready
prd_source: null
branch: story/065-vivienne-server-worker-model
worktree_path: null
base_branch: master
pr_url: null
is_architectural: false
approach_summary: >
  Depends on STORY-063 (cast export pipeline + generalized loader), and lands after STORY-064,
  which establishes the worker-role model path in `upsertWorker`. This story should REUSE that
  path, not build a second one — if STORY-064 left the role-to-model mapping hardcoded to `host`,
  generalize it to a table here rather than branching twice.

  Vivienne is the cast pack's "luxury concierge" — a uniformed front-of-house character. She maps
  to the existing `server` worker role (`WORKER_ROLE_GLYPHS.server = 'S'`, tasks `deliver_order`,
  `take_order`, `collect_payment`). This is the loosest of the three role mappings: concierge is not
  literally a server, but her navy-and-burgundy uniform reads as front-of-house waitstaff and the
  cast pack supplies no closer fit.

  EXACTLY ONE SERVER IS EVER LIVE — `restaurant-layout.json`'s `staff.roster` has a single
  `server_1` and no upgrade adds staff. So this is not a crowd-budget story; it can carry the same
  hero-tier budget as Monsieur.

  WHAT IT IS instead is the story where WALK QUALITY gets tested. The server's posts are
  `dining_room`, `pass` and `host_stand` — it is the one character continuously crossing open floor,
  so it is seen in profile constantly, and the cast pack README concedes weak side profiles. Check
  that specifically in-game before calling this done, and say plainly in the PR if it does not hold
  up.

  Vivienne also carries two `pearl drop earring` meshes parented to her rig. Confirm STORY-063's
  export kept or dropped them deliberately, and that they do not shear off the head during the walk.
created: 2026-09-20
updated: 2026-09-20
---

# Put Vivienne the concierge on the server worker

`Vivienne.glb` (built by STORY-063) replaces the primitive capsule for workers in the `server`
role, reusing the role-to-model path STORY-064 established for `host`.

## Acceptance Criteria

- [ ] Workers with `role === 'server'` render `Vivienne.glb`; `cook`, `prep_worker` and `busser`
  keep their primitive capsules.
- [ ] The role-to-model mapping is a single table covering both `host` and `server`, not two
  parallel hardcoded branches.
- [ ] Shared-material path, matching footprint (~1.45 m), per-frame thresholded idle/walk crossfade,
  and intact `S` glyph / task chips / help marker — same bar as STORY-064.
- [ ] **Profile view is explicitly checked in-game.** Servers cross the floor constantly and the
  cast pack concedes weak side profiles. If it reads badly, say so in the PR rather than shipping it
  silently.
- [ ] Earrings stay attached through the full walk cycle, or are deliberately excluded at export.
- [ ] Frame cost measured with the server live and animating alongside the owner and the host — three
  skinned meshes in the scene, where STORY-060 sized for one.
- [ ] `npm run check` stays green.

## Notes

- Depends on STORY-063; sequenced after STORY-064.
- Role mapping rationale is recorded above because it is the loosest of the three — a reviewer
  should be able to see it was a considered choice, not an accident.
- Out of scope: the other three worker roles, customers, both owner avatars.
