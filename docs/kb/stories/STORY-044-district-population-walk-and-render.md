---
id: STORY-044
title: Animate the district's full customer population walking to their chosen restaurant, or neither
status: in-progress
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: story/044-district-population-walk-and-render
worktree_path: /Users/brent/table-stakes-story-044
base_branch: master
pr_url: null
is_architectural: true
approach_summary: >
  Two real gaps, confirmed by direct inspection, matching the story's own two-part framing.
  MOVEMENT: `customer-system.js` sets `party.position` by direct assignment at exactly five call
  sites — `spawnParty` (~line 541, the party's birth position, correctly instant, leave as-is),
  `collectPayment` (~line 388, jump to `state.entryPosition` on LEAVING), `sendToRestaurant`
  (~line 955, jump to queue position on a restaurant decision), `tryToSeat` (~line 1068, jump to
  table position), and one more exit jump in the `~1220`/`~1386` region (re-verify exact line at
  implementation time — story's own note says these drift). Add a `party.destinationPosition`
  field set at each of those decision points INSTEAD of `party.position` directly, and integrate
  `party.position` toward it every tick inside `advanceParty` (~line 1263, called from the
  registered `customerSystem.update(match, dtMs)`, ~line 1551) using a generalized version of
  `worker-system.js`'s existing `stepToward(worker, target, dtMs)` (~line 740) — that function
  only reads `.position`, so promote/export it (same justified-promotion move as STORY-043's
  `compareTickets`) rather than reimplementing the integration math a second time. A new
  `CUSTOMER_MOVE_SPEED` tunable in `shared/constants/tuning.js` (no existing customer speed
  constant — `WORKER_MOVE_SPEED`/`OWNER_MOVE_SPEED` are the only precedents), with its own
  arrival epsilon mirroring `WORKER_ARRIVAL_EPSILON`. Movement is purely cosmetic and must not
  gate any state-timer transition (`msInState` thresholds stay authoritative, exactly like a
  worker's task assignment is instant while only the walk animation takes time) — decisions
  (queue occupancy, table assignment, money) remain immediate at the moment they're decided, only
  the rendered position catches up over subsequent ticks. RENDERING: `GameClient.ts`'s
  `handleFrame` (~line 827) filters `customers` to `c.restaurantId === restaurantId` BEFORE
  reconciling through `EntityViewRegistry` — confirmed this is why "they just show up": a party
  in `ENTER_DISTRICT`/`EVALUATE_RESTAURANTS` (restaurantId not yet assigned) or `CHOOSE_RIVAL`
  (assigned to the OTHER restaurant) never reaches `upsertCustomer` at all today. Loosen this
  filter to also include district-transit states regardless of `restaurantId` (own decision:
  render them relative to the VIEWER's own restaurant's local space using the shared district
  `entryPosition`/queue landmark both restaurants' layouts already share, not the rival's
  internal table coordinates — table id collision is exactly why the existing filter exists, per
  that code's own comment, so this must add a state-based OR, not remove the restaurantId
  equality check outright). `RestaurantScene.ts#upsertCustomer`/`CustomerRenderState` needs no
  new fields — same real character model, just fed a wider set of customers with real per-tick
  positions instead of a narrower, jump-cut set. `is_architectural: true`: this changes
  customer-system.js's internal position-mutation contract (a cross-cutting behavior change to
  the core district simulation, not just a new snapshot field) and the client's reconciliation
  filter contract — worth an OpenSpec decision trail given how central this system is, even
  though no new wire field is added.
created: 2026-09-10
updated: 2026-09-11
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
