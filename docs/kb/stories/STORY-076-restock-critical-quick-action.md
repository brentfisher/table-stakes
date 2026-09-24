---
type: Story
id: STORY-076
title: Restock Critical — a one-step replenish for whatever is blocking production
description: A server-side resolver that proposes only the ingredients needed to clear active or imminent blocks, and a compact in-kitchen action strip that shows items, cost, timing and reason before confirming.
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

# Restock Critical — a one-step replenish for whatever is blocking production

PRD Story 6's second half (pp. 9-10) asks for "a quick path to restock critical ingredients
without hiding it behind a management panel": when at least one ingredient crosses the critical
threshold, a compact action appears that defaults to restocking only what is needed to resolve
active or imminent production blocks, shows the items, total cost, timing and the reason before
confirming, and gives a short inline confirmation afterwards.

Everything underneath already exists and must be reused, not bypassed. `inventory-system.js`
computes per-ingredient `risk` and `blockedTickets`, builds supplier quotes per product from
`shared/game-data/pantry-restock.json`, and exposes `placeSupplierOrder(restaurantId, productId,
ingredientId)`; `action-validator.js`'s `pantry_order` case already routes to it with a
range check against the pantry entity; `you.cash` already publishes the viewer's spendable money.
The PRD is explicit that this path "does not bypass normal cost, inventory, delivery, or server
validation rules" — so the new work is a **recommendation resolver**, not a new purchase path.

The resolver is server-side by necessity. Deciding which ingredients are blocking or about to
block, and which supplier product best resolves each, is game logic; computing it in React would
break `conventions.md` Notable Pattern 1 and PRD Story 7's rendering-layer prohibition. It
publishes a proposal — items, quantities, total cost, expected timing, and a qualitative reason —
under `you`, alongside the pantry state STORY-075 renders. The PRD's own words for it are "a
quick-restock recommendation resolver that proposes valid restock items but never bypasses server
checks" (p. 13).

The one real design question is whether confirming sends one `pantry_order` per proposed
ingredient or a single new action. One action is fewer round trips and makes "restock outcomes
synchronize for both co-op players" a single atomic event, but it is a second purchase path to
keep validated. Several `pantry_order` sends reuse an already-validated path exactly, at the cost
of partial success when cash runs out mid-way. Whichever is chosen, the partial-failure behaviour
must be stated and checkable — the PRD's AC "cannot accidentally restock unavailable or
unaffordable items without a clear error explanation" is precisely about that case.

## Acceptance Criteria

**Server**

- [ ] A resolver in `server/src/game/systems/inventory-system.js` proposes, per restaurant, only
      the ingredients needed to clear active or imminent production blocks — not a full top-up of
      everything below par.
- [ ] The proposal carries: the ingredients, the quantities, the total cost, the delivery/
      availability timing, and a qualitative reason per item (never a raw score —
      `conventions.md` Notable Pattern 10).
- [ ] The proposal appears only when at least one relevant ingredient is at the critical
      threshold, and the threshold is a named constant in `shared/constants/tuning.js` in a new
      block, not an inline number and not a re-derivation of `publicFor`'s own `risk` bands.
- [ ] Costs and quotes come from the existing supplier path (`pantry-restock.json`,
      `supplierQuote`) — no second pricing implementation.
- [ ] Confirming routes through validation that enforces cash, availability, delivery and range
      exactly as `pantry_order` does today. No path reaches `placeSupplierOrder` unvalidated.
- [ ] Partial failure is defined and checkable: if cash covers some items but not all, the
      documented behaviour holds (all-or-nothing, or ordered-until-exhausted with a clear reason
      returned) and a check asserts it.
- [ ] Unaffordable and unavailable each return their own distinguishable rejection reason.
- [ ] The proposal is published under `you` only — never on `restaurants[]`.
- [ ] A `scripts/check-*.mjs` drives a `Match` into a critical shortage, asserts the proposal
      names the blocking ingredient and nothing else, confirms it, and asserts stock arrives via
      the normal delivery timing rather than instantly. Registers `inventory`, `order` and
      `customer` per `conventions.md` Testing rule 1.
- [ ] The check is falsified before it is trusted (make the resolver propose every ingredient;
      confirm failure; restore). Say so in the PR body.

**Client**

- [ ] A compact action strip appears in the kitchen when a proposal exists, without opening
      `PantryBoard`, showing items, total cost, timing and reason before confirming.
- [ ] After confirming, a short inline confirmation shows the updated critical-state count.
- [ ] Both co-op players see the restock and its outcome — verify with two clients, not by
      reasoning from the snapshot shape.
- [ ] `PantryBoard.tsx` remains the full interface for advanced selection and broader shopping,
      unchanged in scope.
- [ ] The strip is keyboard reachable with accessible names, and does not obscure the queue board,
      the pass, or station affordances.
- [ ] Verified in `harnesses/src/pantry-board-harness.ts` and
      `harnesses/src/kitchen-bottleneck-harness.ts`, plus a screenshot of the strip in-scene.
- [ ] `npm run check` passes; client and harness builds pass.

## Notes

- **PRD sections:** Story 6, pp. 9-10 (the Restock Critical requirements and every acceptance
  criterion); "New or changed server concepts", p. 13, for the resolver's framing.
- **Companion art:** `docs/Kitchen indicator concept sheet` panel 3 — the alert strip with
  per-ingredient badges and one prominent `RESTOCK CRITICAL` button, in red-to-brass urgency.
- **Dependency: STORY-075 must land first.** That story establishes the in-kitchen risk readout
  this action hangs off; shipping the button without the signal inverts the PRD's own sequence
  ("see ingredient risk before running out and quickly replenish").
- **This story preserves Decision 39 (`openspec/changes/ingredient-inventory-and-restocking/
  design.md`)** — stock levels stay off the shared `restaurants[]` array; the proposal is
  `you`-scoped like `you.pantry` already is.
- **This story preserves Decision 40 (same file)** — `INVENTORY_AUTO_RESTOCK` and
  `brigade.ownsRestocking()` decide *who walks to the pantry*, a separate concern from a player
  purchasing supply. This action must not change when or whether the automatic restocker runs,
  and must not become a second way to trigger a bin refill. A supplier order and a pantry-to-bin
  trip are different things; keep them different.
- **This story preserves Decision 37 (same file)** — the `ingredient_shortage` event's
  `ingredientRestockDurationMultiplier` applies to the affected ingredient's delivery timing. The
  proposal's quoted timing must reflect it, or a shortage event would silently cost nothing here.
- **`conventions.md` Notable Pattern 5:** systems talk through published facades read defensively.
  The resolver reads `match.pantry`; the client reads the published proposal. Neither reaches in.
- **`key-files.md` hazard 1:** this story spans `inventory-system.js`, `action-validator.js` and
  `order-system.js`'s blocked tickets. Its check must register all of them.
