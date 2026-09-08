---
id: STORY-036
title: The Kitchen Command Board
status: complete
prd_source: docs/rival-restaurant-manager-command-stories.pdf pp. 10-11
---
# The Kitchen Command Board

Make the kitchen manager-directed without requiring per-worker micromanagement. The command board
lives at the expediter's pass, where ticket urgency, ready food, and dining-room handoff meet, and
allows one clear production focus with a visible benefit and opportunity cost.

## What ships

- An in-world command surface at the service pass with a clear interaction range.
- A kitchen overview showing station queues, ready-food age, shortages, menu availability, and
  active event or special pressure.
- One server-authoritative kitchen focus at a time. Each focus biases worker task selection and
  never overrides the underlying simulation rules.
- Visible worker roles and current jobs that explain how the active focus changes priorities.
- Six data-defined initial focuses:

| Focus | Benefit | Trade-off |
| --- | --- | --- |
| Rush the Pass | Prioritizes near-ready tickets and handoff to clear freshness pressure | New tickets can wait longer |
| Protect the Special | Favors tickets for an event or promoted dish | Other dishes can fall behind |
| Clear the Queue | Favors shorter or constrained tickets to recover station backlog | Premium or high-value tickets may wait |
| Save Ingredients | Avoids or deprioritizes scarce ingredients to protect menu availability | Conversion and menu choice can fall |
| Premium First | Favors critic, VIP, or high-margin tickets | Broad throughput can suffer |
| Recovery Mode | Favors the oldest patience-risk tables | Immediate production efficiency falls |

## Player flow

1. Walk to the expedite pass and inspect the current kitchen pressure.
2. Choose one focus using queue, shortage, event, special, and patience context.
3. Observe worker task changes and queue movement in the world.
4. Personally cover the bottleneck the selected focus cannot solve.
5. Respect a cooldown or commitment cost before switching again.

## Acceptance criteria

- [x] The expedite or service-pass area exposes an in-range kitchen-command interaction.
- [x] The panel shows station queues, ready-food age, shortages, menu availability, and active
  special or event demand.
- [x] Exactly one server-authoritative kitchen priority can be active initially.
- [x] Every mode has an explicit benefit and opportunity cost.
- [x] Worker priorities remain explainable through visible role/current-job state and telemetry.
- [x] A policy cannot bypass inventory, station failure, carry, range, or validation rules.
- [x] The current kitchen focus is visible in the HUD, tactical overview, and at the pass.
- [x] Recommendations use qualitative language without exposing utility math.
- [x] A kitchen harness compares the same ticket mix under every mode.

## Scope

Focuses alter task ranking only. They do not create inventory, complete tickets, move plates,
repair stations, or guarantee customer outcomes. Balance content belongs in shared data, and the
server applies every selection and cooldown.

## Design decisions

- The command board sits beside the service pass so opening it does not intercept ready-food
  pickup at the pass itself.
- The active focus only reorders the cook's existing startable candidates. Ingredient claims,
  station capacity, worker execution, carry limits, and interaction validation keep their
  existing owners.
- A shared pure ranking function drives both live worker selection and the comparison harness,
  keeping the harness representative of production behavior.
- The command snapshot is private because exact menu availability comes from the player's locked
  menu. The selected focus is repeated on the HUD, tactical overview, and in-world pass board.
- An eight-second commitment window prevents rapid focus switching while keeping the intervention
  responsive during a service rush.
