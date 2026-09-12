// STORY-047 AC2 (the "opening highlights" tab content): the best-selling dish as a large
// featured card with co-best-seller tie labeling, smaller supporting-dish cards for the rest,
// and the single lead management takeaway. The outcome heading / score comparison / mascot are
// deliberately NOT here — see `ResultsPanel.tsx`'s own comment on why those render as a
// persistent hero above the category nav instead (visible while "highlights" is active, same as
// this AC asks, but not torn down when a player switches tabs).

import type { MatchResult } from '../../../../shared/schemas/messages';
import { bestSellerSpotlight } from '../../../../shared/game-logic/recap-highlights';
import { dishName } from './catalogue';
import { formatMoney } from './format';

export interface RecapHighlightsProps {
  result: MatchResult;
}

export function RecapHighlights({ result }: RecapHighlightsProps): JSX.Element {
  const spotlight = bestSellerSpotlight(result.bestSellingDishes);
  // STORY-014's own "no additional recommendation" fallback string, reused verbatim rather than
  // re-worded — PRD constraint 1: an honest empty state, not invented copy, when
  // `managerLedger.insights` has nothing to show.
  const leadInsight = result.managerLedger.insights[0] ?? null;

  return (
    <div className="recap-highlights">
      <div className="recap-card recap-card--featured">
        <h3 className="recap-card-eyebrow">
          {spotlight && spotlight.tiedWith.length > 0 ? 'Your co-best seller' : 'Your best seller'}
        </h3>
        {spotlight ? (
          <>
            {spotlight.tiedWith.length > 0 ? <span className="recap-badge">Crowd favorite</span> : null}
            <p className="recap-featured-name">{dishName(spotlight.featured.dishId)}</p>
            <p className="recap-featured-stats">
              <span>
                <strong>{spotlight.featured.count}</strong> sold
              </span>
              <span className="recap-muted">{formatMoney(spotlight.featured.revenue)} revenue</span>
            </p>
            {spotlight.tiedWith.length > 0 ? (
              <p className="recap-tie-note">
                Tied with {spotlight.tiedWith.map((d) => dishName(d.dishId)).join(' and ')} at{' '}
                {spotlight.featured.count} sold. Both earned the spotlight.
              </p>
            ) : null}
            {spotlight.supporting.length > 0 ? (
              <div className="recap-supporting-dishes">
                {spotlight.supporting.map((dish) => (
                  <div className="recap-card recap-card--supporting" key={dish.dishId}>
                    <p className="recap-supporting-name">{dishName(dish.dishId)}</p>
                    <p className="recap-supporting-stats">
                      {dish.count} sold{dish.count === spotlight.featured.count ? ' · tied best' : ''}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="recap-muted">No dish sales were recorded this match.</p>
        )}
      </div>

      <div className="recap-card recap-card--takeaway">
        <h3 className="recap-card-eyebrow">The move that matters</h3>
        {leadInsight ? (
          <>
            <p className="recap-takeaway-observation">{leadInsight.observation}</p>
            <p className="recap-takeaway-recommendation">{leadInsight.recommendation}</p>
          </>
        ) : (
          <p className="recap-muted">
            No tracked management decision produced enough evidence for an additional recommendation.
          </p>
        )}
      </div>
    </div>
  );
}
