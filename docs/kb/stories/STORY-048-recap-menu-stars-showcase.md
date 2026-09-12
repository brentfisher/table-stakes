---
id: STORY-048
title: Menu stars — 3D dish showcase
status: pending
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: null
approach_summary: null
created: 2026-09-11
updated: 2026-09-11
---

# Menu stars — 3D dish showcase

A "Menu stars" category (STORY-047's navigation shell) showing a larger, interactive 3D display
of the match's sold dishes — reusing real GLB assets already in the codebase, not new art.

Reference: `docs/table-stakes-recap-menu.zip` → `table-stakes-menu-suite/story-screenshots/`
`05-menu-stars.png`; `RECAP-PREVIEW.md`'s "Menu stars" bullet. See
`docs/PRD-recap-screen-redesign.md` for the full slice and its constraints.

## Acceptance Criteria

- [ ] The featured (best-selling) dish renders as a large, live 3D model using
  `client/src/scenes/FoodModels.ts`'s existing `buildArcadeFoodProxy(assetId, options)` — the
  SAME loader `RestaurantScene.ts`'s `readyDishes`/`carriedDishes` pools already use, not a new
  asset pipeline. Every other sold dish (`result.bestSellingDishes`, beyond the featured one)
  renders as a smaller, selectable model in the same scene/canvas.
- [ ] Selecting another dish's smaller model updates the featured display's title, 3D model, and
  metrics (sold count, revenue) to that dish — matching `05-menu-stars.png`'s click-to-inspect
  interaction.
- [ ] A tie at the top of `bestSellingDishes` (equal `.count`) is labeled as a co-best-seller for
  BOTH tied dishes, not just whichever sorts first — consistent with STORY-047's own highlights
  tie-handling, reusing the same tie-detection logic rather than a second implementation (extract
  a small shared helper if STORY-047 didn't already leave one reusable).
- [ ] Fastest fulfillment (`result.bestDish.avgFulfillmentMs`, the SAME field
  `ResultsPanel.tsx`'s existing narrative sentence already reads) and highest unit margin
  (`result.highestMarginDishes[0]`) are shown as their own distinct facts, clearly NOT conflated
  with sales-volume ranking — per `RECAP-PREVIEW.md`'s explicit "Espresso's fastest fulfillment
  does not make it the best seller" callout and `05-menu-stars.png`'s separate "Fastest to the
  pass" / "Best unit margin" cards.
- [ ] A restaurant with zero recorded sales (a very short/aborted match) shows an honest empty
  state rather than crashing on an empty `bestSellingDishes` array — `ResultsPanel.tsx`'s
  existing `result.bestSellingDishes.length > 0` guards are the precedent.
- [ ] `npm run check` (including `build:client`) stays green.

## Notes

- Depends on STORY-047 (the category-navigation shell this section mounts inside, and the mascot/
  outcome plumbing this section does NOT need directly but the shared page structure does).
- Cites: `client/src/scenes/FoodModels.ts`'s `buildArcadeFoodProxy`/`ARCADE_FOOD_BY_ID` as the
  exact, already-working asset-loading seam — confirm the eight real dish ids
  (`shared/game-data/dishes.json`) all resolve through it before assuming any new model is needed;
  they should, since `RestaurantScene.ts` already renders every one of them in-match.
- Cites: `table-stakes-menu-suite/src/recap-model.js`'s stable best-seller ranking/tie-labeling
  logic as an INTERACTION-PATTERN reference only — its actual computation reads a static fixture,
  not the live `MatchResult`; re-derive from `result.bestSellingDishes`/`result.highestMarginDishes`
  directly, per the PRD's "verbatim from match_complete" constraint.
