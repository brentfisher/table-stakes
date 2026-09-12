---
id: STORY-048
title: Menu stars — 3D dish showcase
status: in-progress
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: story/048-recap-menu-stars-showcase
worktree_path: /Users/brent/table-stakes-story-048
base_branch: master
pr_url: null
is_architectural: false
approach_summary: >
  CORRECTION to this story's own Notes section (found by direct inspection, not assumed): the
  right reuse target is NOT a raw `buildArcadeFoodProxy` call — it's the already-complete
  `client/src/ui/FoodModelPreview.tsx` component plus `client/src/scenes/food-preview-renderer.ts`,
  which `SetupScreen.tsx`'s menu showroom already uses for exactly this need (many simultaneous
  small rotating 3D dish previews in a React panel). `food-preview-renderer.ts`'s own header
  documents a real incident this fixed: each preview used to own its own `THREE.WebGLRenderer`,
  and a screen with several simultaneous previews could exhaust the browser's WebGL context cap
  and silently evict the MAIN GAME's own context. The fix already shipped: one shared renderer,
  round-robin-rendered into an offscreen canvas and blitted to each preview's own plain 2D
  `<canvas>` (`register`/`unregister`, turntable rotation, `prefers-reduced-motion` respected,
  graceful `data-failed` fallback if WebGL is unavailable at all). `<FoodModelPreview
  assetId={...} label={...} compact={true|false} />` is a complete, drop-in component — this
  story's "Menu stars" section is almost entirely: React state for which dish is currently
  featured, one large `<FoodModelPreview compact={false}>` for it, and a `.map` over the rest of
  `result.bestSellingDishes` rendering `<FoodModelPreview compact>` with an onClick to change the
  featured selection. No new Three.js scene, camera, or renderer code should be written — reusing
  this exact component IS the point (it already solves the multi-simultaneous-preview safety
  problem this story would otherwise reintroduce from scratch). Tie-detection: reuse
  `shared/game-logic/recap-highlights.js#bestSellerSpotlight` (STORY-047, already extracted and
  exported for this — do not reimplement `.count`-equality grouping a second time). Fastest
  fulfillment (`result.bestDish`) and highest margin (`result.highestMarginDishes[0]`) are plain
  data reads, no computation. `is_architectural: false` — no new snapshot field, reuses existing
  client infrastructure end to end.
created: 2026-09-11
updated: 2026-09-12
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
