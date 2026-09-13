import { CommandIcon } from './CommandIcon';
import commandData from '../../../shared/game-data/kitchen-command.json';
import type { GameClientStatus } from '../game/GameClient';

/** Live snapshot values; no invented scores, targets, or combo multipliers. */
export function CommandScorecard({ status }: { status: GameClientStatus }): JSX.Element | null {
  const self = status.restaurants.find((r) => r.restaurantId === status.restaurantId);
  if (!self) return null;
  const command = status.kitchenCommand;
  const focus = commandData.focuses.find((f) => f.id === command?.activeFocusId);
  const recommended = commandData.focuses.find((f) => f.id === command?.recommendation.focusId);
  const occupied = self.tables.filter((t) => t.occupiedBy !== null).length;
  const ready = status.orders.filter((o) => o.restaurantId === self.restaurantId && o.state === 'ready').length;
  const available = command?.menuAvailability.filter((d) => d.available).length ?? 0;
  const menuCount = command?.menuAvailability.length ?? 0;
  const queueWarning = self.activeBottlenecks?.includes('long_entry_queue');
  const phaseLabel = status.matchPhase === 'final_rush' ? 'Final rush' : status.matchPhase === 'results' ? 'Results' : 'Service';
  const seconds = Math.max(0, Math.ceil((status.timeRemainingMs ?? 0) / 1000));
  return <section className="command-scorecard" aria-label="Live service scoreboard">
    <header className="command-heading"><h2>COMMAND CENTER <span>/ {focus?.name ?? 'LIVE SERVICE'}</span></h2><div><strong>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</strong><small>{phaseLabel} · Live</small></div></header>
    <div className="command-metrics">
      <div className="command-metric command-metric--gold"><span>REVENUE</span><strong><i><CommandIcon name="coin" /></i>{status.revenue === null ? '—' : `$${Math.round(status.revenue).toLocaleString()}`}</strong><small>Cash {status.cash === null ? '—' : `$${Math.round(status.cash).toLocaleString()}`}</small><div className="command-cash-caption">SERVICE TAKINGS</div></div>
      <div className="command-metric"><span>GUESTS SERVED</span><strong><i><CommandIcon name="guests" /></i>{self.guestsServed}</strong><small>{occupied} / {self.tables.length} tables occupied</small><progress aria-label="Occupied tables" value={occupied} max={self.tables.length || 1} /></div>
      <div className="command-metric command-metric--gold"><span>DISHES READY</span><strong><i><CommandIcon name="dish" /></i>{ready}</strong><small>{available} / {menuCount} dishes available</small><progress aria-label="Available menu dishes" value={available} max={menuCount || 1} /></div>
      <div className={`command-metric ${queueWarning ? 'command-metric--gold command-metric--busy' : ''}`}><span>QUEUE HEALTH</span><strong><i><CommandIcon name="guests" /></i>{queueWarning ? 'Busy' : 'Good'}</strong><small>{self.queueLength} waiting</small><div className="command-queue-indicator" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <b key={index} className={index < Math.min(5, self.queueLength) ? 'is-lit' : ''} />)}</div></div>
    </div>
    <details className="command-objective-disclosure"><summary className="command-objective"><span className="command-objective-icon"><CommandIcon name="crown" /></span><div><small>{recommended && recommended.id !== focus?.id ? 'SUGGESTED OBJECTIVE' : 'CURRENT OBJECTIVE'}</small><strong>{recommended?.name ?? focus?.name ?? 'Keep the pass moving'}</strong><p>{command?.recommendation.reason ?? 'Serve your guests and keep the kitchen moving.'}</p></div><span className="command-objective-arrow" aria-hidden="true">›</span></summary><div className="command-objective-detail"><span>{occupied} tables in service</span><span>{ready} dishes ready for pickup</span><span>{command?.atRiskGuests ?? 0} guests at risk</span><p>{recommended?.benefit ?? focus?.benefit ?? 'Keep food moving from the kitchen to your guests.'}</p></div></details>
  </section>;
}
