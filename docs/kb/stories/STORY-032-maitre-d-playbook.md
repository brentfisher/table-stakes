---
id: STORY-032
title: The Maitre d' Playbook
status: complete
prd_source: docs/rival-restaurant-manager-command-stories.pdf pp. 2-3
base_branch: master
is_architectural: false
---

# The Maitre d' Playbook

Give the owner a live, physical front-door command post. A host-stand board must show queue and
capacity context, let the owner choose one timed, data-driven special, and make its effect visible
without revealing hidden customer-choice math.

## Acceptance Criteria

- [x] The host stand has an in-range contextual command prompt and opens a front-door board.
- [x] The board shows live queue, open tables, qualitative wait, current event, active special,
      rival queue, and tactical options.
- [x] Exactly one server-authoritative special is active; its cost, eligibility, duration,
      cooldown, benefit, and downside come from shared data/tuning.
- [x] Customer consideration remains probabilistic and server-authoritative.
- [x] Active-special state is visible in the HUD, world, and board.
- [x] A standalone harness previews every special under customer-wave and event fixtures.

## Scope

Initial options: Lunch Express, Happy Hour, Half-Price Wine, Game-Day Combo, Chef's Feature,
and Waitlist Honesty. Mid-service per-dish price editing is excluded.

Chef's Feature automatically promotes the available menu item with the strongest active-event
fit. This keeps the command to one contextual action while making the promoted dish explicit.
