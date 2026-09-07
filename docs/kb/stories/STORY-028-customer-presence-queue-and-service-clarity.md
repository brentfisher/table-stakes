---
id: STORY-028
title: Customer presence, queueing, and service clarity
status: in-progress
prd_source: PRD §4.4, §8, §14, §17
branch: null
worktree_path: null
base_branch: master
pr_url: null
is_architectural: false
approach_summary: Show the actual customer flow in the shared restaurant scene and make owner delivery targets forgiving enough to use.
created: 2026-09-07
updated: 2026-09-07
---

# Customer presence, queueing, and service clarity

The service simulation can process many customer parties while the restaurant looks almost empty:
queued parties share one world position, seating snaps between state positions, and a server can
move a party to a table before the player has seen it arrive. Once seated, an order is only
legible from kitchen state, so a player cannot read what a party is waiting for. Finally, the
delivery interaction uses the same small radius as equipment even though the player approaches a
table through chairs and the service-pass side.

## Acceptance Criteria

- [x] Queued parties occupy distinct positions in the street/entry queue instead of overlapping
      at one `queue_line` coordinate.
- [x] A party remains visibly queued for a short server-authoritative minimum before seating can
      occur; owner prompts and worker selection respect the same gate.
- [x] Customer rendering eases between public positions, so an arrival and seating transition is
      visible instead of a teleport.
- [x] A seated party renders its actual party size as diners around the table.
- [x] Once an order is placed, a readable `WANTS …` text chip above that party is derived from
      public order tickets and disappears when there is no active order.
- [x] Ordering and eating remain visible long enough to read the arrival → queue → seat → order
      → food → eat sequence in a normal match.
- [x] Owner delivery uses a shared, table-specific range in both the optimistic client prompt and
      authoritative server validator; every other interaction retains its existing range.
- [x] Existing customer lifecycle, owner-action, scenery, client, and harness checks pass.

## Notes

- The server continues to own party state, queue eligibility, order selection, and delivery.
  The client only eases positions and labels dishes that already appear in public order tickets.
- The `WANTS` chip deliberately shows a compact list of the first two distinct dish names. It is
  an order-intent cue, not a disclosure of hidden budget or preference weights.
- This is a presentation and pacing story. It does not alter restaurant-choice probabilities,
  kitchen step durations, or scoring formulas.
