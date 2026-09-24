---
type: Story
id: STORY-078
title: Qualitative kitchen recommendations that never force a choice
description: Label recommended dishes on the queue board and station menu with reasons like Urgent or Good prep, make the active kitchen focus legible where cooking decisions are made, and keep every other valid dish selectable.
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

# Qualitative kitchen recommendations that never force a choice

PRD Story 7 (pp. 10-11) is the last behavioural story and the one the rollout list on p. 15 does
not enumerate. It asks the kitchen to help under pressure without taking the decision away: the
queue board and station menu may recommend dishes based on active queue, customer patience, known
event pressure, ingredient risk or the kitchen focus; the recommendation must be qualitative
("Urgent", "Good prep", "Low stock risk", "Event demand", "Premium opportunity"); raw utility
scores and hidden customer preferences stay hidden; any other valid dish remains selectable; and
the active kitchen-command focus becomes understandable in the local kitchen context.

That last requirement is the one with history. `openspec/changes/coop-kitchen-queue-board/
design.md` **Decision 72** deliberately accepted a divergence: under a non-default
`kitchen_focus_*`, `selectCookTask` picks through `rankTicketsForFocus`, so the AI cook can start
a different ticket than the queue board's top row. Decision 72 ruled that acceptable because "the
panel's own copy says 'priority order', never 'what the cook will do next'" — a true claim that
sidestepped the gap rather than closing it. `KitchenQueueBoard.tsx`'s header repeats the argument
verbatim. PRD Story 7 asks for the gap to be closed: the focus must be understandable *at the
board and the relevant station menu*. **This story revises Decision 72.** It should say so in the
code, in the design note, and in the PR, because a diff that makes the board focus-aware reads
from the outside like it broke an invariant someone argued for at length.

Everything here is derived server-side and rendered client-side, with no exceptions. The
recommendation reasons are game logic over queue state, patience, `match.eventEffects`,
`match.pantry` risk and `match.kitchenCommand`'s active focus; computing any of it in React is the
thing PRD Story 7's own acceptance criterion forbids ("Recommendations do not compute game logic
in the rendering layer") and `conventions.md` Notable Pattern 1 forbids generally. What crosses
the wire is a label and nothing else — not the inputs, not a score, not a ranking weight.

The hard constraint is that a recommendation is advice. Nothing in this story may disable a valid
row, reorder a menu so a non-recommended dish becomes unreachable, or auto-start production. PRD
Story 5 already said focuses "may recommend prep opportunities but must not automatically start
production", and this story is where that rule gets tested.

## Acceptance Criteria

**Labels**

- [ ] Recommendation labels are computed server-side and published as qualitative strings from a
      closed set (at minimum the PRD's five: urgent, good prep, low stock risk, event demand,
      premium opportunity), under `you`.
- [ ] No raw utility score, weight, patience number, or hidden customer preference is added to the
      wire by this story (`conventions.md` Notable Pattern 10; PRD Story 7).
- [ ] A player can see **why** a dish is recommended — the label carries its reason, it is not a
      bare star.
- [ ] Labels appear on both surfaces the PRD names: the queue board and the station menu.

**Never forced**

- [ ] Every valid non-recommended dish stays selectable, at the same number of interactions as a
      recommended one. Nothing is disabled, hidden, or reordered out of reach.
- [ ] Nothing auto-starts. A recommendation never begins production, and a kitchen focus still
      only biases worker prioritisation — verify with a check that a focus change alone starts
      no ticket.

**Kitchen focus (revises Decision 72)**

- [ ] The active kitchen-command focus is legible at the queue board and at the relevant station
      menu, in the local kitchen context, not only at `kitchen_command_board`.
- [ ] Where the focus reprioritises differently from the board's `compareTickets` order, the
      surfaces say so honestly rather than silently showing two orders — this is the Decision 72
      divergence, now explained instead of sidestepped.
- [ ] `KitchenQueueBoard.tsx`'s header comment and
      `openspec/changes/coop-kitchen-queue-board/design.md` are both updated to record that
      Decision 72 is revised by this story, with the new position stated.

**Verification**

- [ ] Recommendations degrade cleanly when a source is absent — no kitchen command system, no
      active event, no inventory system — matching `conventions.md` Notable Pattern 5's defensive
      facade reads.
- [ ] A `scripts/check-*.mjs` asserts: each label fires for its own cause; no label leaks a
      numeric input; a non-recommended valid dish is still startable; and a focus change starts
      nothing. Registers `order`, `inventory`, `event`, `kitchen-command` and `worker` per
      `conventions.md` Testing rule 1.
- [ ] The check is falsified before it is trusted. Say so in the PR body.
- [ ] `npm run check` passes; client and harness builds pass.

## Notes

- **PRD sections:** Story 7 "Kitchen recommendations without forced play", pp. 10-11 — all
  requirements and all three acceptance criteria. Note that the p. 15 rollout list does not
  enumerate this story; it belongs after the decision-making stories and before telemetry.
- **This story revises Decision 72 (`openspec/changes/coop-kitchen-queue-board/design.md`)** —
  which accepted that the queue board's top row can diverge from what the AI cook starts under a
  non-default kitchen focus, on the grounds that the board's copy never claimed otherwise. PRD
  Story 7 requires the focus to be understandable at the board, so the divergence must now be
  surfaced rather than merely not-claimed. Do not silently change the board's ordering to match
  the focus: Decision 72's other half — that this board shows `compareTickets` priority order, not
  focus-adjusted order — is a separate claim, and revising it too is a bigger change that needs
  its own justification.
- **This story preserves Decision 67 and Decision 68 (same file)** — one ranking implementation,
  and an unfiltered restaurant-wide facade. Recommendations are a layer over that ordering, never
  a second ordering.
- **This story preserves PRD Story 5's rule** that focuses and events "may recommend prep
  opportunities but must not automatically start production."
- **Dependency: STORY-071 should land first** if labels are to appear on the station menu, since
  that story rebuilds it. **STORY-068 should land first** for the board-side labels, since it
  establishes how a qualitative tier reaches a world card. Neither is strictly blocking — this
  story can ship against whichever surfaces exist and say which in the PR.
- **`key-files.md`:** `server/src/game/systems/kitchen-command-system.js` owns
  `rankTicketsForFocus`; `worker-system.js` owns `selectCookTask` and `compareTickets`. Read both
  before deciding where the label derivation lives.
