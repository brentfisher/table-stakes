// STORY-049 AC4: "An 'open detailed scorecard' action opens a dialog with a full You/Rival
// comparison table, plus additional management detail expandable below it." This is the dialog
// itself — `RecapNumbers.tsx` only owns the trigger button and the open/closed state (so
// "closing returns to whatever category was showing before it opened" is automatic: this
// component is unmounted, `ResultsPanel.tsx`'s own `category` state was never touched).
//
// Modal pattern reused from `HowToPlay.tsx`/`SettingsPanel.tsx` (`role="dialog"`, `aria-modal`,
// Escape-to-close, backdrop click-to-close, `stopPropagation` on the card itself) — see that
// file's own header. Not literally their `.menu-modal` classes, though: those are the app's dark
// theme, and `.recap` is deliberately the one bright surface in the app (`app.css`'s own comment
// on why `--recap-*` tokens are scoped, not shared) — this dialog gets its own
// `.recap-scorecard-*` rules built on the same `--recap-*` tokens instead.
//
// Field list for the main table is `ResultsPanel.tsx`'s (pre-STORY-047) `StatColumn` component's
// own core `<table>`, verbatim (see `git show 5fde531:client/src/ui/ResultsPanel.tsx`) — every
// row here is a plain `MatchResult` field read, not a recomputation. `StatColumn`'s remaining two
// trailing lists — customer-segment breakdown and upgrades purchased — are folded into the
// "additional management detail" `<details>` below (self-restaurant only, same scoping the old
// per-column `StatColumn` gave them): neither field has any other owner in this six-story slice,
// and the task's own scope framing is explicit that only `managerLedger.insights` is STORY-050's
// boundary, everything else this story's Notes cited is "fair game." `bestSellingDishes`/
// `highestMarginDishes` are the one deliberate exception — STORY-048's `RecapMenuStars.tsx`
// already owns that content with a richer 3D treatment (`PRD-recap-screen-redesign.md`'s "Why"
// section names both fields as that story's own reuse target), so repeating them here as plain
// text would only duplicate it.

import { useEffect } from 'react';
import type { MatchResult, MatchCompleteMessage } from '../../../../shared/schemas/messages';
import { formatMoney, formatMs, formatPercent, formatPoints } from './format';
import { constraintLabel, eventTitle, kitchenFocus, segmentName, specialName, upgradeInfo, upgradeName } from './catalogue';

export type TurningPoint = MatchCompleteMessage['turningPoints'][number];

export interface RecapScorecardProps {
  result: MatchResult;
  rivalResult: MatchResult | null;
  rivalTitle: string;
  hasRival: boolean;
  turningPoints: TurningPoint[];
  selfId: string;
  onClose: () => void;
}

/** One row of the main You/Rival table — `rival` is omitted entirely (not rendered as a blank
 * cell) when `!hasRival`, matching PRD constraint 3's "no rival column at all" co-op pattern. */
function StatRow({ label, self, rival }: { label: string; self: string | number; rival: string | number | null }): JSX.Element {
  return (
    <tr>
      <td>{label}</td>
      <td>{self}</td>
      {rival !== null ? <td>{rival}</td> : null}
    </tr>
  );
}

export function RecapScorecard({
  result,
  rivalResult,
  rivalTitle,
  hasRival,
  turningPoints,
  selfId,
  onClose,
}: RecapScorecardProps): JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // A single narrowed local, not a bare `showRival` boolean — TypeScript can follow `rival`'s
  // own null-check inside each `rival ? ... : null` below, which a separately-named boolean
  // variable checked against the still-nullable `rivalResult` cannot narrow through.
  const rival = hasRival ? rivalResult : null;
  const focus = kitchenFocus(result.managerLedger.kitchen.finalFocusId);
  const trackedSelections = Object.values(result.managerLedger.kitchen.selectionsByFocus).reduce(
    (sum, count) => sum + count,
    0,
  );

  return (
    <div className="recap-scorecard-backdrop" role="presentation" onClick={onClose}>
      <div
        className="recap-scorecard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recap-scorecard-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="recap-scorecard-header">
          <div>
            <p className="recap-card-eyebrow">The details</p>
            <h2 id="recap-scorecard-title">The full scorecard</h2>
          </div>
          <button type="button" className="recap-scorecard-close" onClick={onClose} aria-label="Close detailed scorecard">
            ×
          </button>
        </div>

        <table className="recap-scorecard-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>You</th>
              {rival ? <th>{rivalTitle}</th> : null}
            </tr>
          </thead>
          <tbody>
            <StatRow label="Score" self={formatPoints(result.score)} rival={rival ? formatPoints(rival.score) : null} />
            <StatRow label="Revenue" self={formatMoney(result.revenue)} rival={rival ? formatMoney(rival.revenue) : null} />
            <StatRow label="Expenses" self={formatMoney(result.expenses)} rival={rival ? formatMoney(rival.expenses) : null} />
            <StatRow label="Net profit" self={formatMoney(result.netProfit)} rival={rival ? formatMoney(rival.netProfit) : null} />
            <StatRow
              label="Temporary labor"
              self={formatMoney(result.laborExpenses)}
              rival={rival ? formatMoney(rival.laborExpenses) : null}
            />
            <StatRow
              label="Front-door specials"
              self={formatMoney(result.specialExpenses)}
              rival={rival ? formatMoney(rival.specialExpenses) : null}
            />
            <StatRow
              label="Service restock spend"
              self={formatMoney(result.inventoryExpenses)}
              rival={rival ? formatMoney(rival.inventoryExpenses) : null}
            />
            <StatRow
              label="Market premium"
              self={formatMoney(result.marketPremiumPaid)}
              rival={rival ? formatMoney(rival.marketPremiumPaid) : null}
            />
            <StatRow
              label="Stock orders"
              self={result.stockOrdersPlaced}
              rival={rival ? rival.stockOrdersPlaced : null}
            />
            <StatRow
              label="Shortage time"
              self={formatMs(result.shortageDurationMs)}
              rival={rival ? formatMs(rival.shortageDurationMs) : null}
            />
            <StatRow label="Guests served" self={result.guestsServed} rival={rival ? rival.guestsServed : null} />
            <StatRow
              label="Lost to rival"
              self={result.customersLostToRival}
              rival={rival ? rival.customersLostToRival : null}
            />
            <StatRow
              label="Average satisfaction"
              self={result.averageSatisfaction}
              rival={rival ? rival.averageSatisfaction : null}
            />
            <StatRow
              label="Average wait"
              self={formatMs(result.averageWaitTimeMs)}
              rival={rival ? formatMs(rival.averageWaitTimeMs) : null}
            />
            <StatRow
              label="Event objective"
              self={formatPercent(result.eventPerformance.eventObjectiveFraction)}
              rival={rival ? formatPercent(rival.eventPerformance.eventObjectiveFraction) : null}
            />
            {result.eventPerformance.criticFailures > 0 || (rival && rival.eventPerformance.criticFailures > 0) ? (
              <StatRow
                label="Failed critic visits"
                self={result.eventPerformance.criticFailures}
                rival={rival ? rival.eventPerformance.criticFailures : null}
              />
            ) : null}
          </tbody>
        </table>

        {/* AC4's "additional management detail, expandable below it" — a native <details>
            disclosure rather than a second piece of open/close state, since this content only
            ever needs to be shown/hidden, not synchronized with anything else on the page. */}
        <details className="recap-scorecard-detail">
          <summary>Additional management detail</summary>

          <h4>Score breakdown — {formatPoints(result.score)} pts</h4>
          <table className="recap-scorecard-table">
            <tbody>
              <tr><td>Revenue</td><td>{formatPoints(result.scoreBreakdown.revenueScore)}</td></tr>
              <tr><td>Guests served</td><td>{formatPoints(result.scoreBreakdown.guestsServedScore)}</td></tr>
              <tr><td>Satisfaction</td><td>{formatPoints(result.scoreBreakdown.satisfactionScore)}</td></tr>
              <tr><td>Reputation</td><td>{formatPoints(result.scoreBreakdown.reputationBonus)}</td></tr>
              <tr><td>Event objective</td><td>{formatPoints(result.scoreBreakdown.eventObjectiveBonus)}</td></tr>
              <tr className="recap-scorecard-penalty-row">
                <td>Penalties</td>
                <td>-{formatPoints(result.scoreBreakdown.penaltyScore)}</td>
              </tr>
            </tbody>
          </table>

          {/* Honest empty state (PRD constraint 1 / AC5): the old code never rendered a penalty
              table at all when nothing was penalized, rather than a table of zeroes. */}
          {result.scoreBreakdown.penaltyScore > 0 ? (
            <>
              <h4>Penalty detail</h4>
              <table className="recap-scorecard-table">
                <tbody>
                  {result.penaltyBreakdown.abandonmentPoints > 0 ? (
                    <tr><td>Abandoned parties</td><td>-{formatPoints(result.penaltyBreakdown.abandonmentPoints)}</td></tr>
                  ) : null}
                  {result.penaltyBreakdown.cancelledOrderPoints > 0 ? (
                    <tr><td>Cancelled orders</td><td>-{formatPoints(result.penaltyBreakdown.cancelledOrderPoints)}</td></tr>
                  ) : null}
                  {result.penaltyBreakdown.severeDissatisfactionPoints > 0 ? (
                    <tr><td>Severe dissatisfaction</td><td>-{formatPoints(result.penaltyBreakdown.severeDissatisfactionPoints)}</td></tr>
                  ) : null}
                  {result.penaltyBreakdown.wastePoints > 0 ? (
                    <tr><td>Unserved food waste</td><td>-{formatPoints(result.penaltyBreakdown.wastePoints)}</td></tr>
                  ) : null}
                  {result.penaltyBreakdown.criticFailurePoints > 0 ? (
                    <tr><td>Failed critic events</td><td>-{formatPoints(result.penaltyBreakdown.criticFailurePoints)}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </>
          ) : null}

          <h4>Key turning points</h4>
          {/* AC5 / SCREENSHOT-INDEX #07's own cue: "truncated later turning points must not be
              invented" — `turningPoints` is already capped server-side
              (`RESULTS_TURNING_POINTS_MAX`), so rendering the array as given is most of the job.
              The empty state is NOT one honest sentence, though: per `messages.d.ts`'s own
              comment, `turningPoints` is empty both when nothing swung AND on "any match with
              other than exactly 2 restaurants" (a co-op match) — those are different facts, and
              turning points are inherently rival-relative (a "lead" only exists relative to a
              rival), so a co-op match gets its own honest "no rival" line rather than reusing
              the "nothing swung" wording, which would misleadingly imply a rival existed but
              stayed close the whole match. */}
          {!hasRival ? (
            <p className="recap-muted">No rival to compare against this shift.</p>
          ) : turningPoints.length > 0 ? (
            <ol className="recap-scorecard-turning-points">
              {turningPoints.map((point) => (
                <li key={point.atMs}>
                  {point.leaderRestaurantId === selfId ? 'You' : 'Your rival'} pulled ahead by {point.swing}{' '}
                  {point.swing === 1 ? 'party' : 'parties'}
                  {point.eventId
                    ? ` during the ${eventTitle(point.eventId)} event`
                    : point.phase
                      ? ` in ${point.phase === 'final_rush' ? 'the final rush' : 'service'}`
                      : ''}
                  .
                </li>
              ))}
            </ol>
          ) : (
            <p className="recap-muted">No single moment swung this match enough to call out.</p>
          )}

          <h4>Manager&rsquo;s ledger</h4>
          <p className="recap-scorecard-dominant">
            <span>Dominant constraint</span>
            <strong>
              {result.managerLedger.dominantConstraint
                ? constraintLabel(result.managerLedger.dominantConstraint)
                : 'No sustained constraint observed'}
            </strong>
          </p>
          <p className="recap-scorecard-dominant">
            <span>Kitchen direction</span>
            <strong>{focus?.name ?? result.managerLedger.kitchen.finalFocusId}</strong>
          </p>
          <p className="recap-muted">
            {result.managerLedger.kitchen.focusChanges} change{result.managerLedger.kitchen.focusChanges === 1 ? '' : 's'} ·{' '}
            {trackedSelections} tracked selections
            {focus ? ` — ${focus.benefit} Trade-off: ${focus.downside}` : ''}
          </p>

          {result.managerLedger.specials.length > 0 ? (
            <ul className="recap-scorecard-specials">
              {result.managerLedger.specials.map((special) => (
                <li key={special.specialId}>
                  <strong>{specialName(special.specialId)}</strong> ran {special.activations}× for{' '}
                  {formatMoney(special.spend)}. {special.observedConversions} of {special.observedDecisions} observed
                  district decisions chose you during its active windows; {special.deliveredOrders} delivered orders
                  produced {formatMoney(special.observedRevenue)}
                  {special.averageCheck === null ? '' : ` at a ${formatMoney(special.averageCheck)} average check`};{' '}
                  {special.averageSatisfaction === null ? 'no satisfaction sample' : `average satisfaction ${special.averageSatisfaction}`}.
                </li>
              ))}
            </ul>
          ) : (
            <p className="recap-muted">No front-door special was activated, so no special outcome is claimed.</p>
          )}

          {/* `StatColumn`'s (pre-STORY-047) remaining two lists — self-restaurant only, same
              scoping the old per-column `StatColumn` gave them. `bestSellingDishes`/
              `highestMarginDishes` are DELIBERATELY not repeated here: STORY-048's
              `RecapMenuStars.tsx` already owns that content with a richer 3D treatment
              (`PRD-recap-screen-redesign.md`'s "Why" section names both fields as that story's
              own reuse target), and showing them a second time, as plain text, would just be a
              duplicate. These two fields have no other owner in the slice, so they land here
              rather than being silently dropped. */}
          {Object.keys(result.customerSegmentBreakdown).length > 0 ? (
            <>
              <h4>Customer segments served</h4>
              <ul className="recap-scorecard-plain-list">
                {Object.entries(result.customerSegmentBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([segmentId, count]) => (
                    <li key={segmentId}>
                      {segmentName(segmentId)} — {count}
                    </li>
                  ))}
              </ul>
            </>
          ) : null}

          {result.upgradesPurchased.length > 0 ? (
            <>
              <h4>Upgrades</h4>
              <ul className="recap-scorecard-plain-list">
                {result.upgradesPurchased.map((id) => (
                  <li key={id}>
                    <strong>{upgradeName(id)}:</strong> {upgradeInfo(id)?.description ?? 'Purchased during service.'}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </details>
      </div>
    </div>
  );
}
