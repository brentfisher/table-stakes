// STORY-048 "Menu stars — 3D dish showcase". The recap category (STORY-047's nav shell) that
// shows the match's sold dishes as real, live 3D models instead of a table row.
//
// CORRECTION vs this story's own original Notes (kept here so the reasoning survives, not just
// the KB's approach_summary): the Notes guessed the right reuse target was a raw
// `buildArcadeFoodProxy(assetId, options)` call against a hand-rolled scene/camera/renderer.
// Direct inspection found a better, already-complete precedent instead —
// `client/src/ui/FoodModelPreview.tsx` — which `SetupScreen.tsx`'s ready-up showroom already uses
// for exactly this need (many simultaneous small rotating dish previews in a React panel).
// `FoodModelPreview` already routes through `client/src/scenes/food-preview-renderer.ts`'s shared
// `THREE.WebGLRenderer` — see that file's own header for the real incident it fixed (each preview
// owning its own WebGL context could exhaust the browser's context cap and silently evict the
// main game's own context, freezing the player's screen with no recovery). This component MUST
// NOT construct a second `THREE.WebGLRenderer`/scene/camera anywhere — every dish preview here,
// featured or supporting, is a `<FoodModelPreview>` instance for exactly that reason.
//
// Tie detection reuses STORY-047's `bestSellerSpotlight` verbatim rather than a second
// `.count`-equality implementation — see `RecapHighlights.tsx` for the sibling usage this
// mirrors. Fastest fulfillment (`result.bestDish`) and highest unit margin
// (`result.highestMarginDishes[0]`) are plain field reads, not sales-volume ranking — kept in
// their own fact cards, deliberately separate from the featured/supporting dish grid, per
// `RECAP-PREVIEW.md`'s explicit "fastest fulfillment does not make it the best seller" callout
// (PRD-recap-screen-redesign.md's "Why" section).
//
// PRD constraint 3 (co-op degrades honestly): this component only ever reads `result` — the
// caller's `selfResult` — and never a rival's. There is no rival-shaped data anywhere in a
// featured/best-seller/margin display, so a co-op match (no rival at all) renders identically to
// a rival match; nothing here needed its own co-op branch.
//
// PRD constraint 5 (reduced motion) — KNOWN GAP, flagged rather than fixed here: this section's
// turntable rotation is `food-preview-renderer.ts`'s own `turntable.rotation.y = time * 0.00022`,
// gated only by that file's own `prefers-reduced-motion` media-query read, NOT by STORY-047's
// `useRecapMotion`/`.recap--motion-off` convention (which is CSS-only and cannot stop a
// per-frame JS rotation). STORY-052 owns the Motion toggle; wiring `motionEnabled` through
// `FoodModelPreview`/`food-preview-renderer.ts`'s registration (both shared with `SetupScreen.tsx`)
// is that story's call to make, not a change to bolt on here to a shared, safety-critical
// renderer for one caller. See this story's Implementation notes.

import { useState } from 'react';
import type { MatchResult } from '../../../../shared/schemas/messages';
import { bestSellerSpotlight } from '../../../../shared/game-logic/recap-highlights';
import { FoodModelPreview } from '../FoodModelPreview';
import { dishName } from './catalogue';
import { formatMoney, formatMs } from './format';

export interface RecapMenuStarsProps {
  result: MatchResult;
}

export function RecapMenuStars({ result }: RecapMenuStarsProps): JSX.Element {
  const spotlight = bestSellerSpotlight(result.bestSellingDishes);

  // AC5: a restaurant with zero recorded sales (a very short/aborted match) must show an honest
  // empty state, not crash on `[...spotlight.supporting]`/`spotlight.featured.dishId` below. This
  // component itself calls no hook, so the early return is unconditional and safe (React's rule
  // is about hook calls, not early returns) — the real point of splitting `RecapMenuStarsContent`
  // out is that ITS `useState` initializer can be a plain, always-valid `spotlight.featured.dishId`
  // read, with no defensive `?? someFallback` for a null-spotlight case that can no longer occur
  // once that component is even mounted.
  if (!spotlight) {
    return (
      <div className="recap-menu-stars recap-menu-stars--empty">
        <p className="recap-muted">No dish sales were recorded this match — nothing to showcase.</p>
      </div>
    );
  }

  return <RecapMenuStarsContent result={result} spotlight={spotlight} />;
}

// Split out so the hook below only ever mounts once `spotlight` is known non-null — keeps the
// `useState` initializer a plain, always-valid `spotlight.featured.dishId` read instead of a
// defensive fallback for a case that can no longer occur once we're here.
function RecapMenuStarsContent({
  result,
  spotlight,
}: {
  result: MatchResult;
  spotlight: NonNullable<ReturnType<typeof bestSellerSpotlight>>;
}): JSX.Element {
  const [featuredDishId, setFeaturedDishId] = useState(spotlight.featured.dishId);

  // `result.bestSellingDishes` itself, in the server's own descending-`.count` order — the same
  // list `spotlight.featured`/`spotlight.supporting` were split from. Reassembling it here (
  // rather than re-reading `result.bestSellingDishes` directly) keeps this component's only
  // dependency on the raw array the one line above; everything else reads through `spotlight`.
  const allDishes = [spotlight.featured, ...spotlight.supporting];
  const featuredDish = allDishes.find((d) => d.dishId === featuredDishId) ?? spotlight.featured;
  const otherDishes = allDishes.filter((d) => d.dishId !== featuredDish.dishId);

  // AC3: a tie at the TOP of `bestSellingDishes` is a co-best-seller for every tied dish, not
  // just whichever one is currently featured. `topCount`/`tiedGroup` describe the actual server-
  // ranked champions; `isFeaturedTopTier` decides whether the CURRENTLY SELECTED dish (which may
  // be a manually-picked supporting dish, per AC2) is one of them, so clicking a merely-supporting
  // dish honestly drops the "best seller" framing instead of claiming it for whatever's featured.
  const topCount = spotlight.featured.count;
  const tiedGroup = spotlight.tiedWith.length > 0 ? [spotlight.featured, ...spotlight.tiedWith] : [];
  const isFeaturedTopTier = featuredDish.count === topCount;
  const isFeaturedTied = tiedGroup.some((d) => d.dishId === featuredDish.dishId);
  const tiedOthers = tiedGroup.filter((d) => d.dishId !== featuredDish.dishId);

  const eyebrow = isFeaturedTopTier ? (isFeaturedTied ? 'Your co-best seller' : 'Your best seller') : 'Selected dish';

  const topMargin = result.highestMarginDishes[0] ?? null;

  return (
    <div className="recap-menu-stars">
      <div className="recap-card recap-card--featured recap-menu-featured">
        <h3 className="recap-card-eyebrow">{eyebrow}</h3>
        {isFeaturedTied ? <span className="recap-badge">Crowd favorite</span> : null}
        <div className="recap-menu-model recap-menu-model--featured">
          <FoodModelPreview assetId={featuredDish.dishId} label={dishName(featuredDish.dishId)} compact={false} />
        </div>
        <p className="recap-featured-name">{dishName(featuredDish.dishId)}</p>
        <p className="recap-featured-stats">
          <span>
            <strong>{featuredDish.count}</strong> sold
          </span>
          <span className="recap-muted">{formatMoney(featuredDish.revenue)} revenue</span>
        </p>
        {isFeaturedTied && tiedOthers.length > 0 ? (
          <p className="recap-tie-note">
            Tied with {tiedOthers.map((d) => dishName(d.dishId)).join(' and ')} at {topCount} sold. Both earned
            the spotlight.
          </p>
        ) : null}
      </div>

      <div className="recap-menu-facts">
        {/* AC4: fastest fulfillment and highest unit margin are their own facts — deliberately
            not folded into the sales-count card above, so neither reads as a sales ranking. */}
        <div className="recap-card recap-fact">
          <h3 className="recap-card-eyebrow">Fastest to the pass</h3>
          {result.bestDish ? (
            <>
              <p className="recap-fact-name">{dishName(result.bestDish.dishId)}</p>
              <p className="recap-fact-value">{formatMs(result.bestDish.avgFulfillmentMs)} avg</p>
              <p className="recap-muted">Speed, not sales volume — this isn't the best seller.</p>
            </>
          ) : (
            <p className="recap-muted">No fulfillment times were recorded this match.</p>
          )}
        </div>
        <div className="recap-card recap-fact">
          <h3 className="recap-card-eyebrow">Highest unit margin</h3>
          {topMargin ? (
            <>
              <p className="recap-fact-name">{dishName(topMargin.dishId)}</p>
              <p className="recap-fact-value">{formatMoney(topMargin.marginPerUnit)} / unit</p>
              <p className="recap-muted">Profit per dish sold — not how many sold.</p>
            </>
          ) : (
            <p className="recap-muted">No margin data was recorded this match.</p>
          )}
        </div>
      </div>

      {otherDishes.length > 0 ? (
        <div className="recap-menu-supporting">
          {otherDishes.map((dish) => (
            <button
              type="button"
              key={dish.dishId}
              className="recap-card recap-card--supporting recap-menu-supporting-card"
              onClick={() => setFeaturedDishId(dish.dishId)}
            >
              <div className="recap-menu-model recap-menu-model--supporting">
                <FoodModelPreview assetId={dish.dishId} label={dishName(dish.dishId)} compact />
              </div>
              <p className="recap-supporting-name">{dishName(dish.dishId)}</p>
              <p className="recap-supporting-stats">
                {/* Unlike `RecapHighlights.tsx`'s equivalent line, `dish.count === topCount`
                    alone is NOT a safe tie test here: the featured slot rotates with selection
                    (AC2), so the outright top seller itself can land in this row (selected out
                    from under it), where it would wrongly read "tied best" against no one.
                    `tiedGroup` is the actual champion set (empty when there's no tie at all), so
                    membership in it — not a bare count match — is the real tie condition. */}
                {dish.count} sold
                {tiedGroup.some((d) => d.dishId === dish.dishId)
                  ? ' · tied best'
                  : dish.count === topCount
                    ? ' · best seller'
                    : ''}
              </p>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
