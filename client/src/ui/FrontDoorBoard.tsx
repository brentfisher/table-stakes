import specialsData from '../../../shared/game-data/front-door-specials.json';
import type { GameClientStatus } from '../game/GameClient';

/** STORY-032's physical host-stand read. Decisions land with the timed-special authority; this
 * first surface deliberately reads only published operational state. */
export function FrontDoorBoard({ status, onActivate }: { status: GameClientStatus; onActivate: (id: string) => void }): JSX.Element {
  const own = status.restaurants.find((r) => r.restaurantId === status.playerId);
  const rival = status.restaurants.find((r) => r.restaurantId !== status.playerId);
  const event = status.events.find((item) => item.state === 'active' || item.state === 'warning');
  if (!own) return <></>;
  const wait = own.queueLength === 0 ? 'CLEAR' : own.queueLength < 3 ? 'SHORT WAIT' : 'LONG WAIT';
  const special = status.frontDoor[status.playerId ?? ''];
  return <aside className="front-door-board" aria-label="Front door board">
    <strong>MAITRE D' BOARD</strong>
    <span>{own.queueLength} WAITING · {own.seatsAvailable} OPEN TABLES · {wait}</span>
    <span>{event ? event.eventId.replace(/_/g, ' ').toUpperCase() : 'NO DISTRICT EVENT'} · RIVAL QUEUE {rival?.queueLength ?? 0}</span>
    <small>One timed special at a time. Keep the line moving with E.</small>
    {special?.activeSpecialId ? <small>ACTIVE: {special.activeSpecialId.replace(/_/g, ' ').toUpperCase()}</small> : <div>{specialsData.specials.map((item) => <button key={item.id} onClick={() => onActivate(item.id)} disabled={(special?.cooldownForMs ?? 0) > 0}>{item.name} ${item.cost}</button>)}</div>}
  </aside>;
}
