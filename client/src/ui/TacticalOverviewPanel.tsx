// PRD §8 "Tab: tactical overview panel" / §14 "Optional strategic overhead view via Tab". A
// zoomed-out comparison overlay, toggled by Tab (`InputController#onToggleOverview`, gated to
// `service`/`final_rush` — see that file's own comment on why Tab does nothing in `setup`).
//
// This is deliberately MORE than the compact HUD scoreboard, not a duplicate of it: `HudPanel`
// is built for constant peripheral awareness (small, always on screen, capped alert count);
// this panel is a deliberate full-attention check-in the player opens when they want the whole
// picture — every bottleneck on both floors, not just the highest-ranked ones. It can afford to
// show more because opening it is the player's own choice to look away from the floor for a
// moment, the same tradeoff a strategic overhead camera view would cost.
//
// PRIVACY: `restaurants[]` is the ONE array both players receive identically (Decision 16) — so
// `activeBottlenecks`, `tables[]`, `shortages[]` and `queueLength` are exactly as legitimate to
// show for the rival here as `HudPanel`'s scoreboard showing rival `guestsServed`/
// `averageSatisfaction`. `cash`/`revenue` stay owner-only (`you`, never `restaurants[]`) and
// are not shown for the rival, same boundary `HudPanel` already respects.

import type { GameClientStatus } from '../game/GameClient';
import type { RestaurantSnapshot, BottleneckKind } from '../../../shared/schemas/game-state';
import eventsData from '../../../shared/game-data/events.json';

const EVENT_TITLES = new Map<string, string>(
  (eventsData.events as Array<{ id: string; title: string }>).map((e) => [e.id, e.title]),
);
const eventTitle = (eventId: string) => EVENT_TITLES.get(eventId) ?? eventId;

/** Short badge text for a bottleneck kind — distinct from `HudPanel`'s full alert sentences,
 * since this panel shows every active kind for both restaurants at once, not a ranked top few. */
const BOTTLENECK_LABELS: Record<BottleneckKind, string> = {
  kitchen_backlog: 'kitchen backlog',
  ingredient_shortage: 'ingredient shortage',
  server_overload: 'food piling up',
  long_entry_queue: 'long queue',
  unhappy_customer: 'unhappy customer',
  dirty_table: 'dirty table',
  equipment_failure: 'equipment problem',
  cash_opportunity: 'cash opportunity',
};

function RestaurantColumn({
  title,
  restaurant,
  isSelf,
}: {
  title: string;
  restaurant: RestaurantSnapshot | null;
  isSelf: boolean;
}): JSX.Element {
  if (!restaurant) {
    return (
      <div className="tactical-column">
        <h3>{title}</h3>
        <p className="muted">Not available yet.</p>
      </div>
    );
  }
  const occupied = restaurant.seatsTotal - restaurant.seatsAvailable;
  const dirtyTables = restaurant.tables.filter((t) => t.dirty).length;
  const bottlenecks = restaurant.activeBottlenecks ?? [];
  return (
    <div className="tactical-column">
      <h3>{title}</h3>
      <dl>
        <dt>Seated</dt>
        <dd>{occupied} / {restaurant.seatsTotal}</dd>
        <dt>Queue</dt>
        <dd>{restaurant.queueLength}</dd>
        <dt>Guests served</dt>
        <dd>{restaurant.guestsServed}</dd>
        <dt>Avg satisfaction</dt>
        <dd>{restaurant.averageSatisfaction}</dd>
        <dt>Reputation</dt>
        <dd>{restaurant.reputation}</dd>
        <dt>Abandoned</dt>
        <dd>{restaurant.abandonedParties}</dd>
        <dt>Dirty tables</dt>
        <dd>{dirtyTables}</dd>
        {isSelf ? (
          <>
            <dt>Shortages</dt>
            <dd>{(restaurant.shortages ?? []).length}</dd>
          </>
        ) : null}
      </dl>
      <div className="tactical-bottlenecks">
        {bottlenecks.length === 0 ? (
          <span className="muted">No active bottlenecks</span>
        ) : (
          bottlenecks.map((kind) => (
            <span key={kind} className="tactical-badge">
              {BOTTLENECK_LABELS[kind] ?? kind}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

export function TacticalOverviewPanel({ status }: { status: GameClientStatus }): JSX.Element {
  const self = status.restaurants.find((r) => r.restaurantId === status.playerId) ?? null;
  const rival = status.restaurants.find((r) => r.restaurantId !== status.playerId) ?? null;
  const activeEvents = status.events.filter((e) => e.state === 'active');
  const upcomingEvents = [...status.events]
    .filter((e) => e.state === 'warning')
    .sort((a, b) => (a.startsInMs ?? 0) - (b.startsInMs ?? 0));

  return (
    <div className="tactical-overview">
      <div className="tactical-header">
        <h2>Tactical Overview</h2>
        <span className="tactical-hint">
          <kbd>Tab</kbd> to close
        </span>
      </div>
      <div className="tactical-columns">
        <RestaurantColumn title="You" restaurant={self} isSelf />
        <RestaurantColumn title="Rival" restaurant={rival} isSelf={false} />
      </div>
      <div className="tactical-events">
        <h3>Events</h3>
        {activeEvents.length === 0 && upcomingEvents.length === 0 ? (
          <p className="muted">Nothing active or forecast right now.</p>
        ) : (
          <ul>
            {activeEvents.map((e) => (
              <li key={e.eventId}>
                {eventTitle(e.eventId)} — active
                {typeof e.endsInMs === 'number' ? `, ${Math.max(0, Math.round(e.endsInMs / 1000))}s left` : ''}
              </li>
            ))}
            {upcomingEvents.map((e) => (
              <li key={e.eventId} className="muted">
                {eventTitle(e.eventId)} — in {Math.max(0, Math.round((e.startsInMs ?? 0) / 1000))}s
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
