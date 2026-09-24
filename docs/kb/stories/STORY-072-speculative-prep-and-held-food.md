---
type: Story
id: STORY-072
title: Speculative prep jobs and held food that fulfils a later order
description: Implement start_dish's prep intent — a production job with no backing ticket whose completed dish enters a held-food store the order system can draw on when a matching order arrives.
status: pending
# `status` here is flow's workflow vocabulary (pending/approved/in-progress/ready-for-pr/
# pr-opened/merged/...), not OKF's draft/stable/deprecated lifecycle — kept as-is because
# kickoff and open-prs read/write it directly across every repo using flow. Don't rename it.
prd_source: /Users/brent/table-stakes/docs/cooking-prd-interactive.pdf
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: null
approach_summary: null
created: 2026-09-23
updated: 2026-09-23
---

# Speculative prep jobs and held food that fulfils a later order

PRD Story 5 (pp. 8-9) is the PRD's real new decision-making power: a player may cook a dish
before anyone orders it, trading station capacity and freshness risk for speed later. STORY-070
ships `start_dish` with an `intent` field and deliberately rejects `"prep"`; this story
implements that branch and everything downstream of it.

Two new server concepts are needed, both named in the PRD's technical architecture (p. 13).
First, a **prep production job**: a unit of work at a station with the same ingredient claim,
capacity accounting, timer and completion path as a ticket, but with no `orderId` behind it.
`order-system.js` currently keys production off tickets belonging to orders, so the seam question
is whether a prep job is a ticket with a null order or a parallel record — whichever is chosen,
`toPublicOrderSnapshot` must stay the only function shaping `match.orders` (`key-files.md`), and
`check-orders.mjs`'s existing identity between a station's published queue depth and its derived
count must keep holding, the same constraint Decision 36 protected when it insisted blocked
tickets stay in the station queue. Second, a **held-food store**: completed prep dishes,
per restaurant, that a later matching order can consume instead of cooking from scratch.

The consumption path is where this story earns its keep and where it is most likely to go wrong.
An arriving order that matches held stock should be satisfiable from it, which means
`order-system.js`'s order placement and the ready/pass workflow both have to know held food
exists. The PRD's AC is precise about the trap: "Prepped food cannot be mistaken for an active
ticket unless it is assigned to one." A held dish is not a ticket, is not queued, and must not
appear in `you.kitchenQueueBoard` or inflate a station's queue depth — but once it is assigned to
a real order it follows the established service-pass workflow unchanged.

Freshness decay is explicitly **not** in this story — it is STORY-073 — and the display work is
STORY-074. What this story must publish is the state those two consume: a per-restaurant held-food
list under `you`, and a flag on active production saying whether it is demand-backed or
speculative. Both are private to the viewer, for the same reason `you.pantry` and
`you.kitchenQueueBoard` are.

## Acceptance Criteria

**Prep jobs**

- [ ] `start_dish` with `intent: "prep"` is accepted when the station supports the dish, capacity
      is free and ingredients are available — and still rejected, with its own reason, when any of
      those fails. The stub rejection STORY-070 added is removed in this commit.
- [ ] A prep job claims ingredients through the same path a ticket does, at the same moment —
      first station step dispatch. No second claim site.
- [ ] A prep job occupies station capacity exactly as a ticket does: a station full of prep jobs
      cannot also start a demanded ticket, which is the trade-off the PRD's balancing table on
      p. 9 ("Fill every station early — less capacity to react to new orders") depends on.

**Held food**

- [ ] A completed prep job produces a held-food record for that restaurant, carrying at least the
      dish id and the completion timestamp (the field STORY-073 will read).
- [ ] A later order for a matching dish can be fulfilled from held food instead of a fresh cook,
      and the fulfilled order proceeds through the existing ready/service-pass workflow unchanged.
- [ ] Held food never appears as a queued ticket: it is absent from `you.kitchenQueueBoard`, and
      `check-orders.mjs`'s station queue-depth identity still holds with held stock present.
- [ ] A held dish assigned to an order is distinguishable server-side from unassigned held stock,
      so the PRD's "cannot be mistaken for an active ticket unless it is assigned to one" is a
      checkable property, not a UI convention.
- [ ] Active production carries whether it is demand-backed or speculative, and that flag is
      published on the viewer's own snapshot slice for STORY-074 to render.
- [ ] Held food is published under `you` only (never `restaurants[]`), matching the scoping
      `you.pantry`/`you.kitchenQueueBoard` already use.

**Constraints**

- [ ] Nothing auto-starts prep. Kitchen-command focuses and events may later *recommend* it
      (STORY-078) but this story adds no automatic production — PRD Story 5: "must not
      automatically start production."
- [ ] All new tunables (capacity accounting, held-stock caps if any) live in
      `shared/constants/tuning.js` in a new named block, never inline.

**Verification**

- [ ] A `scripts/check-*.mjs` drives a full arc against a stepped `Match`: start a prep dish with
      zero demand, let it complete, place a matching order, assert it is fulfilled from held stock
      and that the station never double-counted. Registers `order`, `inventory`, `customer` and
      `worker` per `conventions.md` Testing rule 1.
- [ ] A dish completes exactly once — the PRD's Story 4 AC, and the race this story most risks
      by adding a second production kind. Assert it with both co-op players acting at one station.
- [ ] The new check is falsified before it is trusted (break the held-food consumption so orders
      always cook fresh; confirm failure; restore). Say so in the PR body.
- [ ] `npm run check` passes.

## Notes

- **PRD sections:** Story 5 "Speculative prep and held food", pp. 8-9; the "New or changed server
  concepts" list on p. 13 ("Prepared-food or held-food records", "Station active-job records that
  identify whether work is demand-backed or speculative").
- **Dependency: STORY-070 must land first** — this story implements the `intent: "prep"` branch
  that story defines and stubs. **STORY-073 (decay) and STORY-074 (display) both depend on this
  story** and must land after it.
- **This story extends Decision 35 (`openspec/changes/ingredient-inventory-and-restocking/
  design.md`)** — "ingredients are consumed when the first station step is dispatched" — to a new
  kind of production. The rule is preserved verbatim; only the set of things it applies to grows.
- **This story preserves Decision 36 (same file)** — the bin-empty/pantry-has-stock blocked
  behaviour and, critically, the reason blocked tickets stay in the station queue:
  `check-orders.mjs` asserts a station's published queue depth equals the count derived from the
  snapshot. A prep job must not break that identity in either direction.
- **This story preserves Decision 38 (same file)** — `dispatchQueues`' `claimIngredients()` hook
  reads `match.pantry` defensively so the kitchen behaves correctly with no inventory system
  registered. A prep job must claim through that same hook, keeping that property.
- **`key-files.md`:** `toPublicOrderSnapshot` in `order-system.js` is "the only function allowed
  to shape `match.orders`", and `match.js` should not gain gameplay — anything new is published by
  a system attaching a pre-shaped value, per `match.js`'s own note on that one narrow exception.
- **`key-files.md` hazard 1:** a per-system check hid a broken seam for three merges. This story
  spans `order-system.js` and `inventory-system.js`; its check must register both.
- **Open question for the kickoff approach gate:** whether a prep job is a ticket with a null
  `orderId` or a parallel record. Decide it explicitly and write down the trade-off — the first
  reuses every existing dispatch path but widens what "ticket" means everywhere; the second keeps
  the ticket invariant clean but duplicates dispatch.
