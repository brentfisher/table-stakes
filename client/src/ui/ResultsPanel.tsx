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
import upgradesData from '../../../shared/game-data/upgrades.json';
import frontDoorData from '../../../shared/game-data/front-door-specials.json';
import kitchenCommandData from '../../../shared/game-data/kitchen-command.json';
import type { GameClientStatus } from '../game/GameClient';
import type { MatchResult } from '../../../shared/schemas/messages';
import { botProfileLabel } from './bot-profiles';

const DISH_NAMES = new Map<string, string>(
  (dishesData.dishes as Array<{ id: string; name: string }>).map((d) => [d.id, d.name]),
);
const SEGMENT_NAMES = new Map<string, string>(
  (segmentsData.segments as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]),
);
const EVENT_TITLES = new Map<string, string>(
  (eventsData.events as Array<{ id: string; title: string }>).map((e) => [e.id, e.title]),
);
const UPGRADE_INFO = new Map<string, { name: string; description: string }>(
  (upgradesData.upgrades as Array<{ id: string; name: string; description: string }>).map((upgrade) => [upgrade.id, upgrade]),
);
const SPECIAL_NAMES = new Map(frontDoorData.specials.map((special) => [special.id, special.name]));
const KITCHEN_FOCUSES = new Map(kitchenCommandData.focuses.map((focus) => [focus.id, focus]));
const CONSTRAINT_LABELS = {
  demand_conversion: 'Demand conversion',
  seating_service: 'Seating / service capacity',
  production: 'Production capacity',
  inventory: 'Inventory availability',
  prioritization: 'Prioritization',
};

const dishName = (dishId: string) => DISH_NAMES.get(dishId) ?? dishId;
const segmentName = (segmentId: string) => SEGMENT_NAMES.get(segmentId) ?? segmentId;
const eventTitle = (eventId: string) => EVENT_TITLES.get(eventId) ?? eventId;
const upgradeName = (upgradeId: string) => UPGRADE_INFO.get(upgradeId)?.name ?? upgradeId;

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

  // STORY-039. `status.restaurantId`, not `status.playerId` — `complete.results` is keyed by
  // restaurant id (`scoring-system.js`), and a co-op guest's own `playerId` is never one of
  // those keys (see `GameClientStatus.restaurantId`'s own comment). Falls back to `playerId`
  // only for the theoretical case of a stale cached build predating that field.
  const selfId = status.restaurantId ?? status.playerId;
  const restaurantIds = Object.keys(complete.results);
  // STORY-039. No `?? restaurantIds[0]` fallback: a match with only ONE restaurant id (a co-op
  // match, or the pre-existing solo `/dev/match` case) has no rival to find, and the honest
  // answer is null — falling back to `restaurantIds[0]` would resolve to `selfId` ITSELF
  // (there is nothing else in the array), which would render your own restaurant a second time
  // labeled "Rival" showing your own score back at you.
  const rivalId = restaurantIds.find((id) => id !== selfId) ?? null;
  const selfResult = selfId ? complete.results[selfId] : undefined;
  const rivalResult = rivalId ? complete.results[rivalId] : undefined;
  const hasRival = rivalId !== null;
  // STORY-025 AC: "identifies the bot opponent by name/profile rather than showing generic
  // 'Player 2'". `status.bots` is empty for a human-vs-human match, so `rivalBot` is null and
  // `rivalTitle` below is exactly the pre-STORY-025 "Rival" — this only changes anything for an
  // actual bot match.
  const rivalBot = status.bots.find((bot) => bot.playerId === rivalId) ?? null;
  const rivalTitle = rivalBot ? `Rival — ${botProfileLabel(rivalBot.difficulty)} Bot` : 'Rival';

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
          {/* STORY-034. Reported: the match-end transition read as the screen "going black" —
              this backdrop (`ResultsScene.ts`) is a deliberately dim "curtain call" stage, and
              the win/loss headline it sits behind was the same 26px size as every other label
              on this panel, easy to miss on the first glance that matters most. A short, large,
              unmissable "GAME OVER" kicker makes the state change itself obvious before the
              reader has processed anything else on the panel. */}
          <p className="results-game-over">Game Over</p>
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

      {!selfResult || !isScored(selfResult) || (hasRival && (!rivalResult || !isScored(rivalResult))) ? (
        <div className="results-region results-empty">
          No score was recorded for this match — it ended before scoring ran.
        </div>
      ) : (
        <>
          {/* STORY-039. `hasRival` is false for a co-op match (one shared restaurant, no rival
              to compare against — scoring/win-condition for co-op is explicitly out of this
              story's scope, see its own "Implementation notes"): the rival column, and every
              narrative line below that depends on a rival's result, simply do not render rather
              than showing a duplicate of the player's own restaurant mislabeled "Rival". */}
          <div className="results-region results-stats">
            <StatColumn title="You" result={selfResult} />
            {hasRival && rivalResult && isScored(rivalResult) ? (
              <StatColumn title={rivalTitle} result={rivalResult} />
            ) : null}
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
              {hasRival && rivalResult && isScored(rivalResult) && rivalResult.largestLossCause ? (
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
              {!complete.decidingSegment &&
              !selfResult.bestDish &&
              !(hasRival && rivalResult && isScored(rivalResult) && rivalResult.largestLossCause) ? (
                <li>Not enough happened this match to point to a single deciding factor.</li>
              ) : null}
            </ul>
          </div>

          <div className="results-region results-manager-ledger">
            <h2>Manager's ledger</h2>
            <p className="manager-ledger-dominant">
              <span>Dominant constraint</span>
              <strong>{selfResult.managerLedger.dominantConstraint
                ? CONSTRAINT_LABELS[selfResult.managerLedger.dominantConstraint]
                : 'No sustained constraint observed'}</strong>
            </p>

            <div className="manager-ledger-costs">
              <article>
                <span>Temporary labor</span>
                <strong>{formatMoney(selfResult.managerLedger.labor.laborExpenses)}</strong>
                <small>{formatMoney(selfResult.managerLedger.labor.hireFees)} hire fees · {formatMoney(selfResult.managerLedger.labor.wagesPaid)} wages · {selfResult.managerLedger.labor.taskCompletions} tasks completed</small>
              </article>
              <article>
                <span>Service restocks</span>
                <strong>{formatMoney(selfResult.managerLedger.restocking.expense)}</strong>
                <small>{formatMoney(selfResult.managerLedger.restocking.marketPremiumPaid)} market premium · {selfResult.managerLedger.restocking.ordersPlaced} orders</small>
              </article>
              <article>
                <span>Kitchen direction</span>
                <strong>{KITCHEN_FOCUSES.get(selfResult.managerLedger.kitchen.finalFocusId)?.name ?? selfResult.managerLedger.kitchen.finalFocusId}</strong>
                <small>{selfResult.managerLedger.kitchen.focusChanges} changes · {Object.values(selfResult.managerLedger.kitchen.selectionsByFocus).reduce((sum, count) => sum + count, 0)} tracked selections</small>
              </article>
            </div>

            {(() => {
              const focus = KITCHEN_FOCUSES.get(selfResult.managerLedger.kitchen.finalFocusId);
              return focus ? <p className="manager-ledger-tradeoff"><strong>{focus.benefit}</strong> Trade-off: {focus.downside}</p> : null;
            })()}

            <h3>Special performance</h3>
            {selfResult.managerLedger.specials.length > 0 ? (
              <ul className="manager-ledger-specials">
                {selfResult.managerLedger.specials.map((special) => (
                  <li key={special.specialId}>
                    <strong>{SPECIAL_NAMES.get(special.specialId) ?? special.specialId}</strong> ran {special.activations}× for {formatMoney(special.spend)}. During its active windows, {special.observedConversions} of {special.observedDecisions} observed district decisions chose you; {special.deliveredOrders} delivered orders produced {formatMoney(special.observedRevenue)}
                    {special.averageCheck === null ? '' : ` at a ${formatMoney(special.averageCheck)} average check`}; {special.averageSatisfaction === null ? 'no satisfaction sample' : `average satisfaction ${special.averageSatisfaction}`}; peak queue {special.peakQueue}.
                  </li>
                ))}
              </ul>
            ) : <p className="muted">No front-door special was activated, so no special outcome is claimed.</p>}

            {selfResult.managerLedger.insights.length > 0 ? (
              <>
                <h3>What to change next match</h3>
                <ul className="manager-ledger-insights">
                  {selfResult.managerLedger.insights.map((insight, index) => (
                    <li key={`${insight.category}-${index}`}>
                      <strong>{insight.observation}</strong> {insight.recommendation}
                    </li>
                  ))}
                </ul>
              </>
            ) : <p className="muted">No tracked management decision produced enough evidence for an additional recommendation.</p>}
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
          <tr><td>Temporary labor</td><td>{formatMoney(result.laborExpenses)}</td></tr>
          <tr><td>Front-door specials</td><td>{formatMoney(result.specialExpenses)}</td></tr>
          <tr><td>Service restock spend</td><td>{formatMoney(result.inventoryExpenses)}</td></tr>
          <tr><td>Market premium</td><td>{formatMoney(result.marketPremiumPaid)}</td></tr>
          <tr><td>Stock orders</td><td>{result.stockOrdersPlaced}</td></tr>
          <tr><td>Shortage time</td><td>{formatMs(result.shortageDurationMs)}</td></tr>
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
          <ul>{result.upgradesPurchased.map((id) => (
            <li key={id}><strong>{upgradeName(id)}:</strong> {UPGRADE_INFO.get(id)?.description ?? 'Purchased during service.'}</li>
          ))}</ul>
        </>
      ) : null}
    </div>
  );
}
