---
id: STORY-032
title: The Maitre d' Playbook
status: in-progress
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
- [ ] The board shows live queue, open tables, qualitative wait, current event, active special,
      rival queue, and tactical options.
- [ ] Exactly one server-authoritative special is active; its cost, eligibility, duration,
      cooldown, benefit, and downside come from shared data/tuning.
- [ ] Customer consideration remains probabilistic and server-authoritative.
- [ ] Active-special state is visible in the HUD, world, and board.
- [ ] A harness previews each special under customer-wave and event fixtures.

## Scope

Initial options: Lunch Express, Happy Hour, Half-Price Wine, Game-Day Combo, Chef's Feature,
and Waitlist Honesty. Mid-service per-dish price editing is excluded.
