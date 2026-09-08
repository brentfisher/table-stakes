---
id: STORY-037
title: The Manager's Ledger
status: complete
prd_source: docs/rival-restaurant-manager-command-stories.pdf pp. 12-14
---
# The Manager's Ledger

## Intent

Connect the Maitre d', dining room, pantry, and kitchen into one clear management identity. Keep
the player's active choices visible during service, diagnose the constraint currently limiting the
restaurant, and explain the value, cost, and trade-offs of those choices after the match using
recorded outcomes.

## What ships

- Compact HUD chips for the active front-door special, staffing and payroll, kitchen focus, and
  pantry risk.
- A tactical overview that combines demand conversion, seating and service capacity, production
  capacity, inventory availability, and prioritization.
- Decision telemetry and match-end results covering special performance, labor and restock costs,
  kitchen direction, the dominant constraint, and evidence-based guidance for a rematch.
- An interactive HTML harness that previews steady service and each of the five constraint classes
  through the same shared classification logic used by the game server.

## Player flow

1. The player sees all four management posts in the service HUD without opening a panel.
2. The tactical overview expands those active policies and shows all five restaurant constraints.
3. The server samples constraint pressure and records management decisions and outcomes during the
   match.
4. Results show the recorded cost and outcome of specials, temporary labor, restocking, and kitchen
   focus choices, then recommend what to change in the next match.

## Acceptance criteria

- [x] The service HUD shows the active front-door special, staffing and payroll state, kitchen
  focus, and pantry risk in a compact form.
- [x] The tactical overview combines demand, seating and service, kitchen, inventory, and
  prioritization constraints.
- [x] Results report special performance, incremental labor expense, restock expense, market
  premium, and the key trade-offs of the recorded choices.
- [x] Narrative insights are backed by recorded decision and outcome data.
- [x] Telemetry supports limiting-factor classification for demand conversion, seating and service
  capacity, production capacity, inventory availability, and prioritization.
- [x] Result copy makes no causal claim unless the relationship was observed and tracked.

## Design decisions

- The ledger reads the existing front-door, service-station, kitchen-command, pantry, customer,
  order, and restaurant facades. Those systems remain authoritative for gameplay.
- Live ledger state is private under `you` because it combines the player's menu, inventory, and
  payroll information.
- Constraint samples use the existing five-second telemetry cadence. Temporary-worker task
  completions are recorded so labor results include an observed work outcome.
- Special reporting correlates only district decisions and delivered orders whose timestamps fall
  inside a recorded activation window. It does not estimate counterfactual sales lift.
- Front-door special spend is included in match expenses because the same spend already reduces
  the player's live cash.
