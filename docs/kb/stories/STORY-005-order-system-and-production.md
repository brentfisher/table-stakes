---
id: STORY-005
title: Order system and kitchen production chain
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/005-order-system
worktree_path: /Users/brent/table-stakes-worktrees/story-005-order-system
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/7
is_architectural: true
approach_summary: A new `orders` system registered after `customers`; a `match.kitchen` facade (placeOrder/pollDelivery/cancelOrder/settleOrder/abandonOrder) is the only seam between the two, replacing customer-system's synthetic WAITING_FOR_FOOD duration with real ticket completion. Tickets walk dishes.json stationSteps through per-station queues with concurrency limits; freshness decays on the service pass; revenue is server-side at the player's set price, applied at PAYING.
created: 2026-08-28
updated: 2026-08-30
---

# Order system and kitchen production chain

PRD §17 defines the order lifecycle and what "order quality" means. This story builds the kitchen:
seated parties generate orders from the active menu, orders become tickets, tickets move through
each dish's `stationSteps` (prep → grill/oven → plating), finished dishes wait at the service
pass losing freshness, and delivery closes the loop into payment and satisfaction.

This is the heart of the "competitive operations game, not a clicker" pillar. The station queues
this story creates are the bottleneck the player physically intervenes in (STORY-008), the thing
the workers work (STORY-007), and the thing the kitchen harness visualizes (STORY-019).

Explicitly **no cooking minigames** — PRD §17 is direct that the skill is operational
prioritization, movement, and timing, not a button-sequence challenge.

## Acceptance Criteria

- [ ] `server/src/game/systems/order-system.js` generates an order for a seated party based on
      segment preferences, menu availability, price, and event context (§17 step 2).
- [ ] Orders decompose into per-dish tickets that traverse that dish's `stationSteps` from
      `dishes.json`, honouring each step's `station` and `durationMs` — no hardcoded timings.
- [ ] Each station has a queue with a concurrency limit; a ticket waits when its station is busy,
      and the queue depth is visible in `match_snapshot`.
- [ ] A dish that finishes plating moves to the service pass and begins losing freshness; a
      freshness window is defined in `tuning.ts` and expiring within it reduces order quality.
- [ ] Order quality combines the §17 factors available at MVP: correctness (right dish delivered),
      freshness (time since completion), customer preference fit, and service timing.
- [ ] Delivering an order advances the party to `EATING`, then `PAYING`, and applies revenue at
      the menu price the player set.
- [ ] An order whose dish becomes unavailable (ingredient shortage, STORY-006) can reach
      `CANCEL_ORDER`, and doing so applies the §11 canceled-order penalty path.
- [ ] Order entities appear in `match_snapshot.orders` with ticket state and target table.
- [ ] **No minigame**: no story-added input sequence, timing bar, or QTE gates dish production.
- [ ] Production is deterministic under a fixed seed given identical player inputs.

## Notes

- **Depends on STORY-002** (dish catalogue with `stationSteps`) and **STORY-003** (tick loop).
  Pairs closely with **STORY-004** — orders are meaningless without seated parties, so land 004
  first or coordinate the two on one base.
- `conventions.md` data-driven content: station durations, freshness window, and station
  concurrency all come from `shared/game-data/` and `tuning.ts`, never inline constants.
- `conventions.md` **Notable Pattern 1**: revenue is computed server-side only.
- PRD §17 "Order system" and "Order quality"; §14 for the station set the layout provides
  (`prep`, `grill`, `oven`, `plating`, service pass).
- Preparation-quality tiers and ingredient-quality upgrades are explicitly "later versions" in
  §17 — do not implement them here.
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Architectural: new system module and new snapshot entity.
