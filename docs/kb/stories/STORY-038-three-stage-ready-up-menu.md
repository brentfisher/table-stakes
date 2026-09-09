---
id: STORY-038
title: Three-Stage Ready-Up Menu
status: complete
source: /Users/brent/Documents/Codex/2026-09-06/hlp/outputs/table-stakes-loadout.zip
---
# Three-Stage Ready-Up Menu

## Intent

Make opening a restaurant fast and visually clear. Replace the dense all-at-once setup screen
with three decisions the player can understand immediately: choose mains, choose extras, and set
prices.

## Player flow

1. Choose exactly three mains from live 3D dish cards.
2. Choose up to two optional extras from the drink and dessert catalogue.
3. Set a legal price for every selected dish, review the automatically stocked pantry, and ready
   up.

The player can return to an earlier completed stage without losing choices. Changing mains or
extras invalidates the later stage gate so the revised lineup must be confirmed again.

## Acceptance criteria

- [x] Ready up is presented as exactly three ordered stages: mains, extras, and prices.
- [x] The mains stage requires exactly three choices and visibly confirms selected cards.
- [x] The extras stage allows zero, one, or two choices and never requires an extra.
- [x] The pricing stage applies each dish's existing legal price bounds and qualitative market and
  margin guidance.
- [x] Dish choices and the focused pricing item use the authored GLBs supplied in the loadout.
- [x] The pricing review shows authored ingredient GLBs for the menu's generated opening pantry.
- [x] Back navigation retains choices, and forward navigation follows the completed stage gates.
- [x] Final confirmation sends the existing `setup_submit` shape through the unchanged
  server-authoritative validator.
- [x] The simplified flow supplies default legal crew posts and an affordable, menu-scoped opening
  inventory so service remains playable.
- [x] A standalone HTML/Three.js harness previews all three stages without a live match.

## Design decisions

- The supplied archive's 26 GLBs are byte-identical to the previously merged arcade-food library,
  so the ready-up UI references `assets/arcade-food` instead of checking in duplicate assets.
- Staffing, opening upgrades, policies, and manual stock allocation are removed from the ready-up
  interaction. Crew posts use each worker's first legal assignment, upgrade and policy choices are
  neutral, and the pantry uses the shared recommended-allocation rule.
- Inventory generation and payload shaping live in a shared pure helper used by the production UI
  and harness checks. The server still validates every rule and marks the player ready.
- Each preview owns and disposes its cloned model, WebGL renderer, geometry, and materials when a
  stage or screen unmounts.
