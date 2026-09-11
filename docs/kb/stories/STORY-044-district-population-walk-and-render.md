---
id: STORY-044
title: Animate the district's full customer population walking to their chosen restaurant, or neither
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

# Animate the district's full customer population walking to their chosen restaurant, or neither

Reported: "it seems like [customers] just show up at yours" — the shared district's full customer
population (`shared-district-choice` openspec change, `customer-system.js`) isn't visually
legible. Investigation for this story found TWO gaps, not one:

1. **Rendering**: `match.customers` (`customer-system.js:1558`) already publishes EVERY party in
   EVERY state — `ENTER_DISTRICT`, `EVALUATE_RESTAURANTS`, `CHOOSE_RIVAL`, `LEAVE_DISTRICT`
   included, not just parties already queued/seated at a restaurant (`toPublicCustomerSnapshot`
   has no state filter). The client (`RestaurantScene.ts#upsertCustomer`) likely only renders
   customers once they're meaningfully at a restaurant. This part IS a pure rendering gap.
2. **Movement is NOT currently a real walk**: `party.position` is set directly at specific state
   transitions (`customer-system.js` lines ~382, ~949, ~1062, ~1216, ~1380 as of this writing) —
   there is no per-tick incremental movement for a party crossing the district, unlike the owner/
   worker `stepToward()` model (`worker-system.js`). A party's position JUMPS between states
   rather than walking there. This is why it "just shows up" — that report is accurate, and this
   is a real simulation gap, not only a rendering one.

This story covers both: real per-tick district movement, and rendering every party (including
those who choose neither restaurant) with real character models.

## Acceptance Criteria

- [ ] Parties in `ENTER_DISTRICT`/`EVALUATE_RESTAURANTS`/en route to a chosen restaurant or to
  `LEAVE_DISTRICT` move incrementally toward their destination each tick (a `stepToward`-style
  integration against a real move speed), rather than jumping to a new position the instant their
  state changes. Reuse the existing pattern (`worker-system.js#stepToward`) rather than inventing
  a second movement model.
- [ ] A party that chooses this restaurant walks visibly toward it; one that chooses the rival's
  walks toward that one; a party in `CHOOSE_RIVAL`/`LEAVE_DISTRICT` (chose neither, or chose the
  rival) is rendered with a real character model — the same `CustomerRenderState`/`upsertCustomer`
  machinery already used for queued/seated customers, not a new proxy type — walking to its actual
  exit, not simply despawning at the decision instant.
- [ ] `RestaurantScene.ts#upsertCustomer`/`GameClient.ts`'s `customers` registry reconciliation
  (`EntityViewRegistry`) is extended to spawn/despawn/position district-only customers using their
  real snapshot `position`, the same seam `readyDishes`/`workers` already use.
- [ ] `npm run check` — including whatever `check-customers.mjs`/`check-district`-equivalent
  coverage exists — still passes; a check proving district-population movement is real (position
  changes across consecutive ticks pre-decision, not just at decision instants) is added.

## Notes

- Independent of Part A (co-op mode) — no dependency either direction.
- Cites: `openspec/changes/shared-district-choice/proposal.md` — this story PRESERVES the choice
  model itself (softmax over scored candidates, STORY-010) entirely; it only adds real movement
  and rendering for states the model already produces. Do not touch the decision math.
- Cites: `server/src/game/systems/customer-system.js` line numbers above are AS OF THIS WRITING
  (2026-09-10) — re-verify against current `git blame`/line numbers at implementation time, they
  will drift.
- STORY-045 (Peek extension) and STORY-046 (crowd density tuning) both depend on this story
  landing first — they read the population this story makes visible.
