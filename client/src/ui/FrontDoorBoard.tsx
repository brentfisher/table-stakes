import specialsData from '../../../shared/game-data/front-door-specials.json';
import type { GameClientStatus } from '../game/GameClient';

/** STORY-032's physical host-stand read. Decisions land with the timed-special authority; this
 * first surface deliberately reads only published operational state. */
export function FrontDoorBoard({ status, onActivate, onSeat }: { status: GameClientStatus; onActivate: (id: string) => void; onSeat: () => void }): JSX.Element {
  // STORY-039. `status.restaurantId`, not `status.playerId` — a co-op guest's own `playerId`
  // is never a key into `restaurants[]`/`frontDoor`/`customers[]` (see
  // `GameClientStatus.restaurantId`'s own comment).
  const own = status.restaurants.find((r) => r.restaurantId === status.restaurantId);
  const rival = status.restaurants.find((r) => r.restaurantId !== status.restaurantId);
  const event = status.events.find((item) => item.state === 'active' || item.state === 'warning');
  if (!own) return <></>;
  const wait = own.queueLength === 0 ? 'CLEAR' : own.queueLength < 3 ? 'SHORT WAIT' : 'LONG WAIT';
  const special = status.frontDoor[status.restaurantId ?? ''];
  const canSeat = status.customers.some((customer) => customer.restaurantId === status.restaurantId && customer.readyToSeat);
  return <aside className="front-door-board" aria-label="Front door board">
    <strong>MAITRE D' BOARD</strong>
    <span>{own.queueLength} WAITING · {own.seatsAvailable} OPEN TABLES · {wait}</span>
    <span>{event ? event.eventId.replace(/_/g, ' ').toUpperCase() : 'NO DISTRICT EVENT'} · RIVAL QUEUE {rival?.queueLength ?? 0}</span>
    <button onClick={onSeat} disabled={!canSeat}>Seat next party</button>
    <small>One timed special at a time.</small>
    {special?.activeSpecialId ? <small>ACTIVE: {special.activeSpecialId.replace(/_/g, ' ').toUpperCase()} · {Math.ceil(special.activeForMs / 1000)}s{special.featuredDishId ? ` · ${special.featuredDishId.replace(/_/g, ' ').toUpperCase()}` : ''}</small> : (
      <div className="front-door-options">{specialsData.specials.map((item) => {
        const eligible = special?.eligibleSpecialIds.includes(item.id) ?? false;
        return <button key={item.id} onClick={() => onActivate(item.id)} disabled={!eligible || (special?.cooldownForMs ?? 0) > 0} title={`${item.benefit} Trade-off: ${item.downside}`}>
          <strong>{item.name} · ${item.cost}</strong><small>{item.benefit}</small><small>Trade-off: {item.downside}</small>
        </button>;
      })}</div>
    )}
  </aside>;
}
