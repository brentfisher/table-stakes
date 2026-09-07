import type { GameClientStatus } from '../game/GameClient';

/** STORY-032's physical host-stand read. Decisions land with the timed-special authority; this
 * first surface deliberately reads only published operational state. */
export function FrontDoorBoard({ status }: { status: GameClientStatus }): JSX.Element {
  const own = status.restaurants.find((r) => r.restaurantId === status.playerId);
  const rival = status.restaurants.find((r) => r.restaurantId !== status.playerId);
  const event = status.events.find((item) => item.state === 'active' || item.state === 'warning');
  if (!own) return <></>;
  const wait = own.queueLength === 0 ? 'CLEAR' : own.queueLength < 3 ? 'SHORT WAIT' : 'LONG WAIT';
  return <aside className="front-door-board" aria-label="Front door board">
    <strong>MAITRE D' BOARD</strong>
    <span>{own.queueLength} WAITING · {own.seatsAvailable} OPEN TABLES · {wait}</span>
    <span>{event ? event.eventId.replace(/_/g, ' ').toUpperCase() : 'NO DISTRICT EVENT'} · RIVAL QUEUE {rival?.queueLength ?? 0}</span>
    <small>Timed specials are being prepared. Keep the line moving with E.</small>
  </aside>;
}
