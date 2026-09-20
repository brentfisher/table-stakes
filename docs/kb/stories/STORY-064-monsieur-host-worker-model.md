---
id: STORY-064
title: Put Monsieur the maître d' on the host worker
status: complete
prd_source: null
branch: story/064-monsieur-host-worker-model
worktree_path: null
base_branch: master
pr_url: null
is_architectural: false
approach_summary: >
  Depends on STORY-063 (cast export pipeline + generalized loader). Do not start until it lands.

  Monsieur is the French maître d' from the cast pack. The game already has a `host` worker role
  (`WORKER_ROLE_GLYPHS.host = 'H'` in `RestaurantScene.ts`) whose task vocabulary includes
  `seat_party` — a maître d' IS the host, so this is a direct, no-invention mapping.

  Integration point is `upsertWorker` (`RestaurantScene.ts` ~line 2454), which today builds EVERY
  worker role as one `CapsuleGeometry(0.3, 0.7, 6, 12)` at `y = 0.8` plus sprite glyphs. Capsule
  bottom sits at y = 0.15 and top at y = 1.45, so the effective footprint this model must match is
  ~1.45 m — derive it from that geometry the way `build_chef_blaze.py` derived 1.86 m from the
  owner's capsule, rather than picking a height independently.

  SCOPE IS THE `host` ROLE ONLY. `cook`, `server`, `prep_worker` and `busser` keep their primitive
  capsules — STORY-065 takes `server`. Workers are keyed by role colour (`WORKER_ROLE_COLORS`)
  today; a textured model replaces that signal for `host`, so confirm a host is still identifiable
  at a glance and keep the role glyph and task chips working above the model.

  EXACTLY ONE HOST IS EVER LIVE. `restaurant-layout.json`'s `staff.roster` has a single `host_1`,
  and no upgrade in `upgrades.json` adds staff — so this is a one-instance character, not a crowd,
  and it can carry Chef Blaze's hero-tier triangle budget. Still route it through STORY-063's
  shared-material path rather than the per-instance clone, so the role-to-model table STORY-065
  extends is consistent from the start; there is just no budget pressure here.

  `upsertWorker` runs at ~10 Hz snapshot cadence, and per-frame smoothing lives separately in
  `updateWorkerAnimations` / the `positionTarget` lerp (~line 2522). Drive the mixer from the
  per-frame path with real `dt`, thresholding position delta for idle-vs-walk the way
  `updateOwnerAnimations` already does — a raw 10 Hz delta is too noisy to feed the crossfade.
created: 2026-09-20
updated: 2026-09-20
---

# Put Monsieur the maître d' on the host worker

`Monsieur.glb` (built by STORY-063) replaces the primitive capsule for workers in the `host` role.
The maître d' maps onto the host role exactly — the role already exists, already has an `H` glyph,
and already owns the `seat_party` task.

## Acceptance Criteria

- [ ] Workers with `role === 'host'` render `Monsieur.glb` through the shared rigged-character
  loader; every other role keeps its current primitive capsule, untouched.
- [ ] The model is routed through STORY-063's shared-material path (for consistency with the
  role-to-model table STORY-065 extends), even though exactly one host is ever live.
- [ ] The model's footprint matches the primitive it replaces (~1.45 m, derived from
  `CapsuleGeometry(0.3, 0.7)` at `y = 0.8`), so nothing it stands next to suddenly reads wrong.
- [ ] Idle and walk clips crossfade off a per-frame, thresholded movement signal taken from the
  existing `positionTarget` smoothing — not off the ~10 Hz `upsertWorker` cadence.
- [ ] The `H` role glyph and all task chips (`SEATING`, `ORDER`, …) plus the "needs help" `!` marker
  stay visible and correctly positioned above the model.
- [ ] A host is still identifiable at a glance without its former role colour.
- [ ] Facing direction reads correctly in-game — confirm against the empirically-verified forward
  axis STORY-063 recorded for this character, with the model actually on screen.
- [ ] Frame cost is measured with the host live and animating, not just at export. STORY-059 already
  had to tune this scene's budget once, and this adds a second skinned mesh alongside the owner.
- [ ] `npm run check` stays green.

- [x] **Verified in the live scene** (asset-showcase harness, composed mode): `Monsieur.glb` is
  fetched 200 and rendered on the `host` worker — burgundy jacket, with the `H` role glyph and
  the `SEATING` task chip still correctly positioned above him, and the capsule gone.
  `prep_worker` alongside is still its olive capsule, confirming only mapped roles swap.

## Notes

- Depends on STORY-063. Cites `RestaurantScene.ts` (`upsertWorker`, `WORKER_ROLE_GLYPHS`,
  `WORKER_ROLE_COLORS`, `WORKER_TASK_LABELS`, `updateWorkerAnimations`), `docs/kb/model-asset-validation.md`.
- Out of scope: the other four worker roles, customers, both owner avatars.
