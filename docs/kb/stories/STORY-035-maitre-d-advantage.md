---
id: STORY-035
title: The Maitre d' Advantage
status: complete
prd_source: docs/rival-restaurant-manager-command-stories.pdf pp. 8-9
---
# The Maitre d' Advantage

Turn the Maitre d' stand into a strategic investment path for restaurants whose acquisition,
queue, seating, handoff, or guest recovery is limiting service.

## Acceptance criteria

- [x] The shared upgrade catalogue includes Host Stand Toolkit, Street Chalkboard, Queue Pager
  System, Guest Recovery Kit, Maitre d Radio, and Window Display.
- [x] Purchases use the existing server-authoritative terminal flow, which validates service
  phase, physical range, cash, ownership, prerequisites, and implemented effect keys.
- [x] Every front-door category has one tier and no upgrade category exceeds three tiers.
- [x] Host Stand Toolkit shortens host processing only after a party has chosen the restaurant
  and a fitting table is available; it does not create demand or capacity.
- [x] Street Chalkboard adds a bounded consideration bonus before the existing probabilistic
  restaurant-choice draw; it never guarantees a customer.
- [x] Queue Pager System slows only visible queue-patience decay and does not add tables or speed
  the kitchen.
- [x] Guest Recovery Kit strengthens the existing owner recovery action while preserving its
  once-per-party limit and direct purchase cost.
- [x] Maitre d Radio shortens only server seating-handoff work.
- [x] Window Display amplifies only an eligible active special's consideration effect.
- [x] Every owned front-door upgrade creates a persistent visible prop at the restaurant entrance.
- [x] The HUD identifies active front-door investment, the tactical overview explains each owned
  effect, and post-match results retain the purchase names and descriptions.
- [x] The upgrade-preview harness toggles the real front-door scene props and compares numeric
  seating, attraction, queue, recovery, handoff, and promotion effects.

## Design decisions

- The existing upgrade terminal remains the dedicated purchase point, so front-door investment
  inherits one consistent authority and cash model.
- The recovery kit improves the existing limited owner apology/comp action instead of adding a
  second recovery verb with overlapping rules.
- Front-door visuals are driven only by server-published owned upgrade IDs. The props communicate
  state; the server systems remain authoritative for every gameplay effect.
