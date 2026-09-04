// PRD §18 "HUD" — the full service-phase heads-up display (STORY-015), replacing STORY-003's
// placeholder (phase/timer/market/ready only).
//
// EVERY VALUE HERE COMES FROM `match_snapshot`, VERBATIM OR A ONE-LINE FORMAT/LOOKUP OF IT —
// same discipline `ResultsPanel.tsx`'s own header documents for `match_complete`. Dish/event/
// upgrade NAMES come from the static catalogue JSON already loaded client-side elsewhere
// (public game data, not a simulation result); every COUNT, PRICE, TIME and FLAG comes straight
// off `GameClientStatus`, which is itself a verbatim (or patch-on-change) copy of the last
// snapshot (`GameClient.ts`). Nothing here recomputes a bottleneck, a shortage, or which
// alert fires — `criticalAlerts` arrives already ranked and capped
// (`shared/game-logic/hud-alerts.js`), and `activeBottlenecks` (STORY-015's own
// `hud-bottleneck-system.js`) is what a few color choices below key off, never a threshold
// re-derived here.
//
// "SCORE COMPARISON" HAS NO LIVE NUMBER TO SHOW. `scoring-system.js` computes a composite score
// exactly once, at the `results` phase transition — there is no running score during `service`
// (Notable Pattern 10: qualitative guidance over fabricated simulation math). The scoreboard
// below renders PRD §18's "current score comparison" AND the compact rival summary's "rival
// score" from the same real, already-public, side-by-side fields instead: guests served and
// average satisfaction. Revenue and reputation are shown for the OWNER'S OWN column only —
// revenue is private (Decision 16, `you.revenue`) and reputation is simply not one of the three
// fields §18's compact rival summary names, so showing it for the rival would be exactly what
// that AC's "and nothing the PRD does not list" forbids, even though the field itself happens
// to be public on `restaurants[]`.

import dishesData from '../../../shared/game-data/dishes.json';
import upgradesData from '../../../shared/game-data/upgrades.json';
import type { GameClientStatus } from '../game/GameClient';
import type { CriticalAlert } from '../../../shared/game-logic/hud-alerts';
import { eventTitle } from './event-titles';

const DISH_NAMES = new Map<string, string>(
  (dishesData.dishes as Array<{ id: string; name: string }>).map((d) => [d.id, d.name]),
);
const UPGRADE_NAMES = new Map<string, string>(
  (upgradesData.upgrades as Array<{ id: string; name: string }>).map((u) => [u.id, u.name]),
);
const dishName = (dishId: string) => DISH_NAMES.get(dishId) ?? dishId;
const upgradeName = (upgradeId: string) => UPGRADE_NAMES.get(upgradeId) ?? upgradeId;

const PHASE_LABELS: Record<string, string> = {
  lobby: 'Lobby',
  market_reveal: 'Market Reveal',
  setup: 'Setup',
  service: 'Service',
  final_rush: 'Final Rush',
  results: 'Results',
};

/** PRD §8's operational-bottleneck vocabulary, in plain language for a general-suggestion
 * alert's text — the same seven-row table the visual-state-language story (STORY-016) will
 * eventually give a 3D indicator, named here because this HUD's alert list needs SOME words. */
const BOTTLENECK_SUGGESTIONS: Record<string, string> = {
  kitchen_backlog: 'Kitchen is backing up — tickets are queuing faster than they clear.',
  long_entry_queue: 'A long line has formed at the door.',
  dirty_table: 'A table needs clearing.',
};

function formatCountdown(ms: number | null): string {
  if (ms === null) return '—';
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Short form for an alert's own countdown/age — "12s", never mm:ss (these are always under a
 * couple of minutes by the time they are worth an alert at all). */
function formatSeconds(ms: number): string {
  return `${Math.max(0, Math.round(ms / 1000))}s`;
}

const money = (dollars: number | null): string => (dollars === null ? '—' : `$${dollars.toFixed(2)}`);

/** One line of alert text per `CriticalAlert` — the ONLY place this component turns a category
 * + detail into words. Every field read here is on the alert already; nothing is looked up
 * against `status` a second time. */
function alertText(alert: CriticalAlert): string {
  switch (alert.category) {
    case 'customer_abandonment_imminent': {
      const d = alert.detail as { patienceRemaining: number };
      return `A party is about to walk out (${Math.round(d.patienceRemaining * 100)}% patience left)`;
    }
    case 'food_ready_undelivered': {
      const d = alert.detail as { dishId: string; readyAgeMs: number };
      return `${dishName(d.dishId)} has been ready ${formatSeconds(d.readyAgeMs)} and still isn't delivered`;
    }
    case 'ingredient_shortage': {
      const d = alert.detail as { ingredientId: string; blockedTickets: number };
      return `Out of ${d.ingredientId.replace(/_/g, ' ')} — blocking ${d.blockedTickets} order${d.blockedTickets === 1 ? '' : 's'}`;
    }
    case 'event_countdown': {
      const d = alert.detail as { eventId: string; startsInMs: number };
      return `${eventTitle(d.eventId)} starts in ${formatSeconds(d.startsInMs)}`;
    }
    case 'upgrade_available': {
      const d = alert.detail as { upgradeId: string | null };
      return d.upgradeId ? `You can afford ${upgradeName(d.upgradeId)}` : 'An upgrade is affordable';
    }
    case 'general_suggestion':
    default: {
      const d = alert.detail as { bottleneck: string };
      return BOTTLENECK_SUGGESTIONS[d.bottleneck] ?? 'Something on the floor needs attention.';
    }
  }
}

/** PRD §18 §14 colour vocabulary, restricted to what an alert's OWN priority band means —
 * never a second severity judgement, just which of the six state colours this band maps to. */
function alertClass(alert: CriticalAlert): string {
  if (alert.priority <= 2) return 'hud-alert-critical'; // red — abandonment, food dying on the pass
  if (alert.priority <= 4) return 'hud-alert-warning'; // orange — shortage, equipment
  return 'hud-alert-info'; // yellow/blue — event countdown, upgrade, suggestions
}

export function HudPanel({
  status,
  onReady,
}: {
  status: GameClientStatus | null;
  onReady: (ready: boolean) => void;
}): JSX.Element {
  const connection = status?.connection ?? 'connecting';
  const phase = status?.matchPhase ?? null;
  // The two phases the server accepts a readiness change in — see Match#setReady.
  const canReady = phase === 'lobby' || phase === 'setup';
  const inService = phase === 'service' || phase === 'final_rush';

  const self = status?.restaurants.find((r) => r.restaurantId === status.playerId) ?? null;
  const rival = status?.restaurants.find((r) => r.restaurantId !== status.playerId) ?? null;

  // PRD §18 "Customer count / queue warning": CURRENTLY in the dining room plus currently
  // waiting — distinct from `guestsServed` (the scoreboard's cumulative, all-match count).
  // Plain subtraction of two already-published numbers, not new simulation math.
  const occupiedSeats = self ? self.seatsTotal - self.seatsAvailable : 0;
  const customersNow = self ? occupiedSeats + self.queueLength : 0;
  const rivalCustomersNow = rival ? rival.seatsTotal - rival.seatsAvailable + rival.queueLength : 0;
  const queueIsWarning = Boolean(self?.activeBottlenecks?.includes('long_entry_queue'));

  const activeEvent = status?.events.find((e) => e.state === 'active') ?? null;
  const upcomingEvent =
    status?.events
      .filter((e) => e.state === 'warning' && typeof e.startsInMs === 'number')
      .sort((a, b) => (a.startsInMs ?? 0) - (b.startsInMs ?? 0))[0] ?? null;

  const carriedDishes = (status?.carrying ?? []).map((orderId) => {
    const ticket = status?.orders.find((o) => o.orderId === orderId);
    return ticket ? dishName(ticket.dishId) : orderId;
  });

  return (
    <>
      <div className="hud">
        <h1>Rival Restaurant</h1>
        <dl>
          <dt>Server</dt>
          <dd className={`status-${connection}`}>{connection}</dd>
          <dt>Phase</dt>
          <dd>{phase ? (PHASE_LABELS[phase] ?? phase) : '—'}</dd>
          <dt>Time left</dt>
          <dd>{formatCountdown(status?.timeRemainingMs ?? null)}</dd>
          <dt>Market</dt>
          <dd>{status?.market?.name ?? 'not revealed'}</dd>

          {inService ? (
            <>
              {/* PRD §18 "Revenue and available cash" — two different private numbers, both
                  from `you`, neither client-computed. */}
              <dt>Cash</dt>
              <dd>{money(status?.cash ?? null)}</dd>
              <dt>Revenue</dt>
              <dd>{money(status?.revenue ?? null)}</dd>
              {/* PRD §18 "Customer count / queue warning". */}
              <dt>Customers now</dt>
              <dd className={queueIsWarning ? 'status-closed' : undefined}>
                {customersNow} in house{self && self.queueLength > 0 ? `, ${self.queueLength} waiting` : ''}
              </dd>
              {/* PRD §18 "Average satisfaction". */}
              <dt>Avg satisfaction</dt>
              <dd>{self ? self.averageSatisfaction : '—'}</dd>
              {/* PRD §18 "Owner carry inventory". */}
              <dt>Carrying</dt>
              <dd>{carriedDishes.length > 0 ? carriedDishes.join(', ') : 'nothing'}</dd>
              {/* PRD §18 "Selected contextual interaction" — the same resolved prompt
                  `App.tsx`'s bottom-center `.interact-prompt` already renders; shown here too
                  so this one panel accounts for every §18 element on its own. */}
              <dt>Interaction</dt>
              <dd>{status?.prompt?.label ?? '—'}</dd>
            </>
          ) : null}

          {/* STORY-012 AC: ambient awareness of an affordable upgrade, without a trip to the
              terminal to find out. Now names which one (STORY-015's `affordableUpgradeId`). */}
          {status?.canAffordUpgrade ? (
            <>
              <dt>Upgrade</dt>
              <dd className="status-open">
                {status.affordableUpgradeId ? upgradeName(status.affordableUpgradeId) : 'available'}
              </dd>
            </>
          ) : null}
          <dt>Room</dt>
          <dd>{status?.roomId ?? '—'}</dd>
          <dt>You</dt>
          <dd>{status?.playerId ?? '—'}</dd>
          <dt>Seed</dt>
          <dd>{status?.seed ?? '—'}</dd>
          <dt>Owners</dt>
          <dd>{status?.playerCount ?? 0}</dd>
        </dl>

        {status?.endReason ? (
          <p className="hud-note">
            Match over —{' '}
            {status.endReason === 'player_disconnected' ? 'opponent disconnected' : 'completed'}.
          </p>
        ) : (
          <button type="button" disabled={!canReady} onClick={() => onReady(!status?.ready)}>
            {status?.ready ? 'Ready ✓ (cancel)' : 'Ready up'}
          </button>
        )}
      </div>

      {/* PRD §18 "Current score comparison" + the compact rival summary's "Rival score,
          rival customer count, rival satisfaction trend" — one panel, since both AC bullets
          resolve to the same real, comparable fields. See this file's own header for why there
          is no single "score" number. */}
      {inService && self && rival ? (
        <div className="hud-scoreboard">
          <h2>Scoreboard</h2>
          <table>
            <thead>
              <tr>
                <th />
                <th>You</th>
                <th>Rival</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Customers now</td>
                <td>{customersNow}</td>
                <td>{rivalCustomersNow}</td>
              </tr>
              <tr>
                <td>Guests served</td>
                <td>{self.guestsServed}</td>
                <td>{rival.guestsServed}</td>
              </tr>
              <tr>
                <td>Avg satisfaction</td>
                <td>{self.averageSatisfaction}</td>
                <td>{rival.averageSatisfaction}</td>
              </tr>
              <tr>
                <td>Reputation</td>
                <td>{self.reputation}</td>
                <td className="muted">—</td>
              </tr>
            </tbody>
          </table>
          <p className="hud-scoreboard-note">
            No live score exists mid-match — scoring runs once, at the end.
          </p>

          {/* PRD §18 "Current active event" / "Upcoming event warning". */}
          {activeEvent || upcomingEvent ? (
            <div className="hud-events">
              {activeEvent ? (
                <div className="hud-event-active">
                  {eventTitle(activeEvent.eventId)}
                  {typeof activeEvent.endsInMs === 'number' ? ` — ${formatSeconds(activeEvent.endsInMs)} left` : ''}
                </div>
              ) : null}
              {upcomingEvent ? (
                <div className="hud-event-upcoming">
                  Next: {eventTitle(upcomingEvent.eventId)} in {formatSeconds(upcomingEvent.startsInMs ?? 0)}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* PRD §18 "Critical alerts" — already ranked (§18 priority order) and capped
          (`HUD_CRITICAL_ALERTS_MAX`) by `GameClient.ts`; this only renders the list it was
          handed, in order, with no re-sorting or re-filtering here. */}
      {inService && status && status.criticalAlerts.length > 0 ? (
        <div className="hud-alerts">
          {status.criticalAlerts.map((alert) => (
            <div key={alert.key} className={`hud-alert ${alertClass(alert)}`}>
              {alertText(alert)}
            </div>
          ))}
        </div>
      ) : null}

      {/* PRD §14 "Floating cash/tip feedback only for major moments, not every transaction". */}
      {status?.cashFeedback ? (
        <div key={status.cashFeedback.atMs} className="hud-cash-feedback">
          +{money(status.cashFeedback.amount)}
        </div>
      ) : null}
    </>
  );
}
