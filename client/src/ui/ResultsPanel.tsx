// PRD §11 "End-of-match results" + the results-screen narrative layer (STORY-014). PRD §11's
// own framing is the spec for this component: the results screen should "turn each match into
// a learning loop rather than a black-box simulation" (§11 intro) and clear the §21 Milestone 4
// bar — "most players understand why they lost" — not just dump every §11 field in a table.
//
// ============================================================================================
// EVERY NUMBER HERE COMES FROM `match_complete`, VERBATIM. This component's only job is
// formatting and sentence assembly — dish/segment/event NAMES come from the same static
// catalogue JSON `SetupScreen.tsx`/`GameClient.ts` already import client-side (public game
// data, not a simulation result), but every COUNT, MARGIN, SCORE, and TIME comes straight out
// of `status.matchComplete`, which is `GameClient`'s untouched copy of the server message. If a
// number is not already a field on `MatchResult`/`MatchCompleteMessage`, it does not appear
// here — see messages.d.ts's own STORY-014 field comments for what each one means.
// ============================================================================================
//
// PRD §13 "React responsibilities": React owns application UI, mounted as a full-bleed overlay
// above the Three.js canvas — same `SetupScreen.tsx` pattern (`App.tsx` mounts this only when
// `status.matchComplete` exists, the same way `SetupScreen` mounts only during `setup`), and
// `ResultsScene.ts` is the ambient backdrop behind it, not a data source.

import dishesData from '../../../shared/game-data/dishes.json';
import segmentsData from '../../../shared/game-data/customer-segments.json';
import eventsData from '../../../shared/game-data/events.json';
import type { GameClientStatus } from '../game/GameClient';
import type { MatchResult } from '../../../shared/schemas/messages';

const DISH_NAMES = new Map<string, string>(
  (dishesData.dishes as Array<{ id: string; name: string }>).map((d) => [d.id, d.name]),
);
const SEGMENT_NAMES = new Map<string, string>(
  (segmentsData.segments as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]),
);
const EVENT_TITLES = new Map<string, string>(
  (eventsData.events as Array<{ id: string; title: string }>).map((e) => [e.id, e.title]),
);

const dishName = (dishId: string) => DISH_NAMES.get(dishId) ?? dishId;
const segmentName = (segmentId: string) => SEGMENT_NAMES.get(segmentId) ?? segmentId;
const eventTitle = (eventId: string) => EVENT_TITLES.get(eventId) ?? eventId;

/** §17 decision-reason vocabulary (customer-system.js's `REASON_BY_COMPONENT`, plus the
 * capacity-driven `restaurant_full`), in plain language for a narrative sentence. */
const REASON_LABELS: Record<string, string> = {
  better_price: 'a better price',
  better_menu_fit: 'a better menu match',
  shorter_projected_wait: 'a shorter projected wait',
  higher_reputation: 'higher reputation',
  event_affinity: 'a menu that fit the event better',
  restaurant_full: 'the queue looking too long to bother with',
};
const reasonLabel = (reason: string) => REASON_LABELS[reason] ?? reason.replace(/_/g, ' ');

const TIE_BREAK_LABELS: Record<string, string> = {
  averageSatisfaction: 'higher average satisfaction',
  guestsServed: 'more guests served',
  netRevenue: 'higher net revenue',
  abandonedParties: 'fewer abandoned parties',
};

const formatMoney = (dollars: number) => `$${dollars.toFixed(2)}`;
const formatMs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const formatPoints = (points: number) => points.toFixed(1);
const formatPercent = (fraction: number) => `${Math.round(fraction * 100)}%`;

export interface ResultsPanelProps {
  status: GameClientStatus;
  onRematch: () => void;
}

/** True once the payload carries a real `MatchResult` rather than the §12 `{}` fallback a
 * disconnect-triggered end sends (see match.js's own comment on `matchCompleteMessage`). */
function isScored(result: MatchResult | Record<string, never>): result is MatchResult {
  return 'score' in result;
}

export function ResultsPanel({ status, onRematch }: ResultsPanelProps): JSX.Element | null {
  const complete = status.matchComplete;
  if (!complete) return null;

  const selfId = status.playerId;
  const restaurantIds = Object.keys(complete.results);
  const rivalId = restaurantIds.find((id) => id !== selfId) ?? restaurantIds[0] ?? null;
  const selfResult = selfId ? complete.results[selfId] : undefined;
  const rivalResult = rivalId ? complete.results[rivalId] : undefined;

  const outcome =
    complete.winnerPlayerId === null
      ? 'Draw'
      : complete.winnerPlayerId === selfId
        ? 'You won'
        : 'You lost';

  return (
    <div className="results">
      <div className="results-top">
        <div>
          <h1 className={`results-outcome results-outcome--${complete.winnerPlayerId === selfId ? 'win' : complete.winnerPlayerId === null ? 'draw' : 'loss'}`}>
            {outcome}
          </h1>
          {complete.reason === 'player_disconnected' ? (
            <p className="results-reason">Your opponent disconnected and did not reconnect in time.</p>
          ) : null}
        </div>
        <div className="results-top-right">
          {status.matchPhase === 'results' && status.timeRemainingMs !== null ? (
            <div className="results-countdown">Next match in {Math.ceil(status.timeRemainingMs / 1000)}s</div>
          ) : null}
          <button type="button" className="results-rematch" onClick={onRematch}>
            Rematch
          </button>
        </div>
      </div>

      {!selfResult || !isScored(selfResult) || !rivalResult || !isScored(rivalResult) ? (
        <div className="results-region results-empty">
          No score was recorded for this match — it ended before scoring ran.
        </div>
      ) : (
        <>
          <div className="results-region results-stats">
            <StatColumn title="You" result={selfResult} />
            <StatColumn title="Rival" result={rivalResult} />
          </div>

          <div className="results-region results-narrative">
            <h2>Why you {complete.winnerPlayerId === selfId ? 'won' : complete.winnerPlayerId === null ? 'drew' : 'lost'}</h2>
            <ul>
              {complete.decidingSegment ? (
                <li>
                  {complete.decidingSegment.leaderRestaurantId === selfId ? 'You' : 'Your rival'} won the{' '}
                  {segmentName(complete.decidingSegment.segmentId)} segment, by{' '}
                  {complete.decidingSegment.servedDifferential} more{' '}
                  {segmentName(complete.decidingSegment.segmentId).toLowerCase()} parties served.
                </li>
              ) : null}
              {selfResult.bestDish ? (
                <li>
                  Your {dishName(selfResult.bestDish.dishId)} had the fastest average fulfillment time —{' '}
                  {formatMs(selfResult.bestDish.avgFulfillmentMs)} order-to-plate, across {selfResult.bestDish.count}{' '}
                  orders.
                </li>
              ) : null}
              {rivalResult.largestLossCause ? (
                <li>
                  Your rival's biggest loss was {rivalResult.largestLossCause.count} parties choosing you for{' '}
                  {reasonLabel(rivalResult.largestLossCause.reason)}
                  {rivalResult.largestLossCause.eventId
                    ? `, mostly during the ${eventTitle(rivalResult.largestLossCause.eventId)} event`
                    : ''}
                  .
                </li>
              ) : null}
              {complete.tieBreakDecided ? (
                <li>
                  The match was tied on score — {complete.tieBreakDecided.winnerPlayerId === selfId ? 'you' : 'your rival'}{' '}
                  won the tie-break on {TIE_BREAK_LABELS[complete.tieBreakDecided.criterion] ?? complete.tieBreakDecided.criterion}.
                </li>
              ) : null}
              {!complete.decidingSegment && !selfResult.bestDish && !rivalResult.largestLossCause ? (
                <li>Not enough happened this match to point to a single deciding factor.</li>
              ) : null}
            </ul>
          </div>

          {complete.turningPoints.length > 0 ? (
            <div className="results-region results-turning-points">
              <h2>Key turning points</h2>
              <ol>
                {complete.turningPoints.map((point) => (
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
            </div>
          ) : null}

          <div className="results-region results-breakdown">
            <h2>Score breakdown — you: {formatPoints(selfResult.score)} pts</h2>
            <table>
              <tbody>
                <tr><td>Revenue</td><td>{formatPoints(selfResult.scoreBreakdown.revenueScore)}</td></tr>
                <tr><td>Guests served</td><td>{formatPoints(selfResult.scoreBreakdown.guestsServedScore)}</td></tr>
                <tr><td>Satisfaction</td><td>{formatPoints(selfResult.scoreBreakdown.satisfactionScore)}</td></tr>
                <tr><td>Reputation</td><td>{formatPoints(selfResult.scoreBreakdown.reputationBonus)}</td></tr>
                <tr><td>Event objective</td><td>{formatPoints(selfResult.scoreBreakdown.eventObjectiveBonus)}</td></tr>
                <tr className="results-penalty-row">
                  <td>Penalties</td>
                  <td>-{formatPoints(selfResult.scoreBreakdown.penaltyScore)}</td>
                </tr>
              </tbody>
            </table>
            {selfResult.scoreBreakdown.penaltyScore > 0 ? (
              <>
                <h3>Penalty detail</h3>
                <table>
                  <tbody>
                    {selfResult.penaltyBreakdown.abandonmentPoints > 0 ? (
                      <tr><td>Abandoned parties</td><td>-{formatPoints(selfResult.penaltyBreakdown.abandonmentPoints)}</td></tr>
                    ) : null}
                    {selfResult.penaltyBreakdown.cancelledOrderPoints > 0 ? (
                      <tr><td>Cancelled orders</td><td>-{formatPoints(selfResult.penaltyBreakdown.cancelledOrderPoints)}</td></tr>
                    ) : null}
                    {selfResult.penaltyBreakdown.severeDissatisfactionPoints > 0 ? (
                      <tr><td>Severe dissatisfaction</td><td>-{formatPoints(selfResult.penaltyBreakdown.severeDissatisfactionPoints)}</td></tr>
                    ) : null}
                    {selfResult.penaltyBreakdown.wastePoints > 0 ? (
                      <tr><td>Unserved food waste</td><td>-{formatPoints(selfResult.penaltyBreakdown.wastePoints)}</td></tr>
                    ) : null}
                    {selfResult.penaltyBreakdown.criticFailurePoints > 0 ? (
                      <tr><td>Failed critic events</td><td>-{formatPoints(selfResult.penaltyBreakdown.criticFailurePoints)}</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function StatColumn({ title, result }: { title: string; result: MatchResult }): JSX.Element {
  return (
    <div className="results-stat-column">
      <h2>{title}</h2>
      <table>
        <tbody>
          <tr><td>Score</td><td>{formatPoints(result.score)}</td></tr>
          <tr><td>Revenue</td><td>{formatMoney(result.revenue)}</td></tr>
          <tr><td>Expenses</td><td>{formatMoney(result.expenses)}</td></tr>
          <tr><td>Net profit</td><td>{formatMoney(result.netProfit)}</td></tr>
          <tr><td>Customers served</td><td>{result.guestsServed}</td></tr>
          <tr><td>Lost to rival</td><td>{result.customersLostToRival}</td></tr>
          <tr><td>Avg satisfaction</td><td>{result.averageSatisfaction}</td></tr>
          <tr><td>Avg wait</td><td>{formatMs(result.averageWaitTimeMs)}</td></tr>
          <tr><td>Event objective</td><td>{formatPercent(result.eventPerformance.eventObjectiveFraction)}</td></tr>
          {result.eventPerformance.criticFailures > 0 ? (
            <tr><td>Failed critic visits</td><td>{result.eventPerformance.criticFailures}</td></tr>
          ) : null}
        </tbody>
      </table>

      {result.bestSellingDishes.length > 0 ? (
        <>
          <h3>Best-selling dishes</h3>
          <ol>
            {result.bestSellingDishes.slice(0, 3).map((d) => (
              <li key={d.dishId}>{dishName(d.dishId)} — {d.count} sold ({formatMoney(d.revenue)})</li>
            ))}
          </ol>
        </>
      ) : null}

      {result.highestMarginDishes.length > 0 ? (
        <>
          <h3>Highest-margin dishes</h3>
          <ol>
            {result.highestMarginDishes.slice(0, 3).map((d) => (
              <li key={d.dishId}>{dishName(d.dishId)} — {formatMoney(d.marginPerUnit)}/unit</li>
            ))}
          </ol>
        </>
      ) : null}

      {Object.keys(result.customerSegmentBreakdown).length > 0 ? (
        <>
          <h3>Customer segments served</h3>
          <ul>
            {Object.entries(result.customerSegmentBreakdown)
              .sort((a, b) => b[1] - a[1])
              .map(([segmentId, count]) => (
                <li key={segmentId}>{segmentName(segmentId)} — {count}</li>
              ))}
          </ul>
        </>
      ) : null}

      {result.upgradesPurchased.length > 0 ? (
        <>
          <h3>Upgrades</h3>
          <p>{result.upgradesPurchased.join(', ')}</p>
        </>
      ) : null}
    </div>
  );
}
