---
id: STORY-048
title: Menu stars — 3D dish showcase
status: merged
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: story/048-recap-menu-stars-showcase
worktree_path: /Users/brent/table-stakes-story-048
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/67
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

- [x] The featured (best-selling) dish renders as a large, live 3D model using
  `client/src/scenes/FoodModels.ts`'s existing `buildArcadeFoodProxy(assetId, options)` — the
  SAME loader `RestaurantScene.ts`'s `readyDishes`/`carriedDishes` pools already use, not a new
  asset pipeline. Every other sold dish (`result.bestSellingDishes`, beyond the featured one)
  renders as a smaller, selectable model in the same scene/canvas.
- [x] Selecting another dish's smaller model updates the featured display's title, 3D model, and
  metrics (sold count, revenue) to that dish — matching `05-menu-stars.png`'s click-to-inspect
  interaction.
- [x] A tie at the top of `bestSellingDishes` (equal `.count`) is labeled as a co-best-seller for
  BOTH tied dishes, not just whichever sorts first — consistent with STORY-047's own highlights
  tie-handling, reusing the same tie-detection logic rather than a second implementation (extract
  a small shared helper if STORY-047 didn't already leave one reusable).
- [x] Fastest fulfillment (`result.bestDish.avgFulfillmentMs`, the SAME field
  `ResultsPanel.tsx`'s existing narrative sentence already reads) and highest unit margin
  (`result.highestMarginDishes[0]`) are shown as their own distinct facts, clearly NOT conflated
  with sales-volume ranking — per `RECAP-PREVIEW.md`'s explicit "Espresso's fastest fulfillment
  does not make it the best seller" callout and `05-menu-stars.png`'s separate "Fastest to the
  pass" / "Best unit margin" cards.
- [x] A restaurant with zero recorded sales (a very short/aborted match) shows an honest empty
  state rather than crashing on an empty `bestSellingDishes` array — `ResultsPanel.tsx`'s
  existing `result.bestSellingDishes.length > 0` guards are the precedent.
- [x] `npm run check` (including `build:client`) stays green.

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

## Implementation notes

**CORRECTION carried through from the approach_summary, confirmed by direct reading of both
files before writing any code.** AC1's own literal wording still names
`buildArcadeFoodProxy(assetId, options)` against a hand-rolled scene, but the real reuse target is
`client/src/ui/FoodModelPreview.tsx` — a complete, already-shipped component
(`<FoodModelPreview assetId={...} label={...} compact={true|false} />`) that `SetupScreen.tsx`'s
ready-up showroom already uses for the identical need (many simultaneous small rotating dish
previews in a React panel). It routes through `client/src/scenes/food-preview-renderer.ts`'s
shared `THREE.WebGLRenderer` — that file's header documents a real incident this fixed: before the
shared renderer existed, each preview instance constructed its own `WebGLRenderer`, and a screen
with several simultaneous previews (the ready-up menu's 6 mains + 8 pantry icons) could exceed the
browser's WebGL-context cap and silently evict the MAIN GAME's own context, freezing the player's
screen with no recovery. `RecapMenuStars.tsx` constructs **zero** new `THREE.WebGLRenderer`/scene/
camera instances — every dish preview, featured or supporting, is a `<FoodModelPreview>` call, so
this story cannot reintroduce that bug. AC1 is satisfied against this better precedent, not the
literal one.

**New file: `client/src/ui/recap/RecapMenuStars.tsx`.** Split into two components:
`RecapMenuStars` (the exported one, taking `{ result: MatchResult }`) computes
`bestSellerSpotlight(result.bestSellingDishes)` and returns the AC5 empty state immediately when
it's `null`; only when a spotlight exists does it render `RecapMenuStarsContent`, which owns the
`useState<string>(spotlight.featured.dishId)` for the currently-featured dish. The split exists so
that `useState`'s initializer is a plain, always-valid `spotlight.featured.dishId` read — no hook
is ever called conditionally (React's actual rule), and `RecapMenuStarsContent` never needs a
defensive fallback for a null-spotlight case that cannot occur once it's mounted.

**AC2 — selection re-features another dish.** `allDishes` reassembles
`[spotlight.featured, ...spotlight.supporting]` (i.e. `result.bestSellingDishes` itself, in the
server's own descending-`.count` order); `featuredDish` looks up the currently-selected id in that
list, falling back to `spotlight.featured` only for the impossible case of a stale id.
`otherDishes` is `allDishes` minus the current `featuredDish`, rendered as a row of
`<FoodModelPreview compact>` buttons; clicking one calls `setFeaturedDishId`, which changes which
dish is the large `<FoodModelPreview compact={false}>` above, and its name/sold-count/revenue
line, which reads straight off `featuredDish`. Verified by reading `FoodModelPreview.tsx`'s
`useEffect` dependency array — `[assetId, compact]` — so a changed `assetId` prop (from
`setFeaturedDishId`) correctly tears down and reloads the GLB for the new dish rather than
silently keeping the old model.

**AC3 — co-best-seller tie labeling, reusing `bestSellerSpotlight` verbatim.** No second
`.count`-equality implementation. `topCount`/`tiedGroup` (`[spotlight.featured, ...spotlight.tiedWith]`
when `tiedWith.length > 0`, else `[]`) describe the actual server-ranked champions, independent of
whatever is currently featured. `isFeaturedTopTier`/`isFeaturedTied` then ask whether the
CURRENTLY SELECTED dish belongs to that set — this matters because the featured slot rotates with
user selection (AC2), so "is this a co-best-seller" and "is the CURRENT VIEW showing a
co-best-seller" are different questions once selection exists at all, which `RecapHighlights.tsx`
(no selection, always shows the real spotlight) never had to distinguish. The eyebrow reads "Your
co-best seller" / "Your best seller" / "Selected dish" from those two booleans; the tie note names
every OTHER member of `tiedGroup` (not just one), so a genuine 3-way tie still reads correctly,
matching STORY-047's own precedent for the identical wording.
  - **Bug caught by advisor review before commit, fixed:** the first draft copied
    `RecapHighlights.tsx`'s supporting-card suffix expression verbatim
    (`dish.count === topCount ? ' · tied best' : ''`), which is only safe there because
    `spotlight.supporting` never contains the featured dish. In this component the featured slot
    rotates with selection, so the outright top seller can land in the supporting row (once a
    lower-volume dish is selected) and would have wrongly read "tied best" against no one. Fixed
    to test `tiedGroup.some((d) => d.dishId === dish.dishId)` (true tie membership) before falling
    back to a plain `' · best seller'` label for an outright, untied leader sitting in that row.

**AC4 — fastest fulfillment / highest margin as distinct, unconflated facts.** `result.bestDish`
(`{ dishId, count, avgFulfillmentMs } | null`) and `result.highestMarginDishes[0] ?? null` are
plain field reads — no computation — rendered in their own `.recap-fact` cards inside a
`.recap-menu-facts` column next to (not inside) the featured-dish card, each with an explicit
one-line disclaimer ("Speed, not sales volume — this isn't the best seller." /
"Profit per dish sold — not how many sold.") echoing `RECAP-PREVIEW.md`'s own "fastest fulfillment
does not make it the best seller" callout. Both null cases (no fulfillment ever recorded; no
margin data) get their own honest one-line empty state rather than being hidden, since either can
independently be missing even when `bestSellingDishes` itself is non-empty.

**AC5 — zero-sales empty state.** `bestSellerSpotlight` already returns `null` for an empty
`bestSellingDishes` array (STORY-047's own contract); `RecapMenuStars` returns
`<div className="recap-menu-stars recap-menu-stars--empty">` with a one-line "No dish sales were
recorded this match — nothing to showcase." message in that case, mirroring
`RecapHighlights.tsx`'s equivalent empty-spotlight branch's tone, before `RecapMenuStarsContent`
(and its `useState`) ever mounts.

**PRD constraint 3 (co-op degrades honestly).** `RecapMenuStars`/`RecapMenuStarsContent` only ever
read `result` — the caller's own `selfResult`, per `ResultsPanel.tsx`'s existing
`<RecapMenuStars result={selfResult} />` call, the same prop convention `RecapHighlights` uses.
There is no rival-shaped data anywhere in a featured-dish/best-seller/margin display, so a co-op
match (no rival at all) renders this section identically to a rival match — no co-op branch was
needed here, unlike the hero region `ResultsPanel.tsx` itself owns.

**PRD constraint 5 (reduced motion) — a known, deliberately unfixed gap, flagged rather than
patched.** `food-preview-renderer.ts`'s turntable rotation
(`turntable.rotation.y = time * 0.00022`) is gated only by that file's own
`prefers-reduced-motion` media-query read at registration time, not by STORY-047's
`useRecapMotion`/`recap--motion-off` convention — that convention is a CSS
`animation: none !important` rule, which cannot stop a per-frame imperative Three.js rotation.
So STORY-052's eventual Motion toggle will not be able to turn off this section's dish rotation,
only STORY-047's own CSS-driven mascot/card animations. Threading `motionEnabled` through
`FoodModelPreview`'s registration into `food-preview-renderer.ts` is possible (both are shared
with `SetupScreen.tsx`, which has no motion toggle at all today) but is a change to a shared,
safety-critical renderer module on behalf of a caller (this story) that has no Motion-toggle AC of
its own — per the PRD's own "flag rather than fix unilaterally" precedent (the STORY-046 reference
in its "Why" section), this is named here for STORY-052 to pick up rather than patched now.

**Styling: `client/src/styles/app.css`, new `/* --- Menu stars (STORY-048) --- */` block**, added
after the existing highlights rules rather than a new stylesheet — follows the same
`.recap-card`/`--recap-*` custom-property vocabulary STORY-047 established (no new tokens). One
sizing detail worth naming explicitly: `.recap-menu-model--featured`/`--supporting` give the
`<FoodModelPreview>` canvas's parent an explicit `height` (220px / 84px), because
`food-preview-renderer.ts` reads `canvas.clientWidth`/`clientHeight` every frame to size its
render target (`.food-model-preview` itself is `width: 100%; height: 100%` of its parent) — an
unsized parent would leave the canvas at 0 height and render nothing. `.recap-menu-supporting-card`
resets `<button>` browser defaults (font, color, cursor, text-align) that `RecapHighlights.tsx`'s
non-interactive `.recap-card--supporting` divs never had to undo, since these cards are clickable
per AC2.

**No new `check-*.mjs` script.** This story reuses STORY-047's already-extracted
`bestSellerSpotlight` rather than adding new pure logic — `result.bestDish`/
`result.highestMarginDishes[0]` are plain field reads with no derivation. `build:client`'s
`tsc --noEmit` is the whole verification surface for this story's actual code, following
STORY-042/045/047's own precedent for client-rendering-only stories in this codebase.

**Verification: `npm run check` (all 39 steps, including `build:client` and `build:harnesses`) is
green**, exit code 0, `tsc --noEmit` reporting no errors against `FoodModelPreview`'s real prop
contract. **Visual/live verification was NOT obtainable in this environment, stated honestly
rather than claimed**: this environment's browser automation reports
`document.visibilityState: 'hidden'` for automated tabs, which kills `requestAnimationFrame` —
`food-preview-renderer.ts`'s entire render loop is rAF-driven — so a live rotating-3D-model
screenshot could not be produced here, the same limitation STORY-041/044/045/047 already
documented for this exact codebase (STORY-047's own Implementation notes even predicted STORY-048
would "hit that same rAF wall"). What WAS verified instead: a full read of `FoodModelPreview.tsx`'s
props/effect/cleanup against every call site added here (`assetId`/`label`/`compact` all supplied
correctly, `key={dish.dishId}` present on the mapped supporting cards so React remounts a fresh
preview per dish rather than reusing DOM across different assets), a full read of
`food-preview-renderer.ts`'s `canvas.clientWidth`/`clientHeight` sizing dependency (addressed by
this story's own explicit `.recap-menu-model*` heights, see above), and a clean `tsc --noEmit`
against `MatchResult`'s real field types (`bestDish: {...} | null`,
`highestMarginDishes: Array<{dishId, marginPerUnit}>`) read directly from
`shared/schemas/messages.d.ts` rather than assumed from this story's own prompt paraphrase.
