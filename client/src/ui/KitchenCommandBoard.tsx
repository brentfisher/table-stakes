import commandData from '../../../shared/game-data/kitchen-command.json';
import dishesData from '../../../shared/game-data/dishes.json';
import eventsData from '../../../shared/game-data/events.json';
import specialsData from '../../../shared/game-data/front-door-specials.json';
import type { GameClientStatus } from '../game/GameClient';

const DISH_NAMES = new Map(dishesData.dishes.map((dish) => [dish.id, dish.name]));
const EVENT_NAMES = new Map(eventsData.events.map((event) => [event.id, event.title]));
const SPECIAL_NAMES = new Map(specialsData.specials.map((special) => [special.id, special.name]));

export function KitchenCommandBoard({
  status,
  onFocus,
}: {
  status: GameClientStatus;
  onFocus: (focusId: string) => void;
}): JSX.Element | null {
  const command = status.kitchenCommand;
  // STORY-039. `status.restaurantId`, not `status.playerId` — see `GameClientStatus
  // .restaurantId`'s own comment.
  const restaurant = status.restaurants.find((item) => item.restaurantId === status.restaurantId);
  if (!command || !restaurant) return null;
  const active = commandData.focuses.find((focus) => focus.id === command.activeFocusId);
  const recommended = commandData.focuses.find((focus) => focus.id === command.recommendation.focusId);
  const cooks = (restaurant.workers ?? []).filter((worker) => worker.role === 'cook' || worker.role === 'prep_worker');
  const demand = [
    ...command.activeEventIds.map((id) => EVENT_NAMES.get(id) ?? id),
    ...(command.activeSpecialId ? [SPECIAL_NAMES.get(command.activeSpecialId) ?? command.activeSpecialId] : []),
  ];
  const activeSelections = command.selectionsByFocus[command.activeFocusId] ?? 0;

  return <aside className="kitchen-command-board" aria-label="Kitchen command board">
    <strong>KITCHEN COMMAND · {active?.name ?? command.activeFocusId}</strong>
    <div className="kitchen-pressure-grid">
      <span>QUEUES {command.stationQueues.map((item) => `${item.station.toUpperCase()} ${item.queued}`).join(' · ')}</span>
      <span>OLDEST READY {command.oldestReadyFoodMs > 0 ? `${Math.ceil(command.oldestReadyFoodMs / 1000)}s` : 'NONE'}</span>
      <span>AT-RISK GUESTS {command.atRiskGuests} · DIRECTED PICKS {activeSelections}</span>
      <span>DEMAND {demand.join(' · ') || 'NORMAL'}</span>
    </div>
    <div className="kitchen-shortage-state">
      {command.shortages.length > 0
        ? command.shortages.map((shortage) => <span key={`${shortage.station}:${shortage.ingredientId}`}>
          {shortage.ingredientId.replace(/_/g, ' ')} · {shortage.station} · {shortage.blockedTickets} blocked
          {shortage.restocking ? ' · restocking' : shortage.exhausted ? ' · exhausted' : ''}
        </span>)
        : <span>SHORTAGES: NONE</span>}
    </div>
    <div className="kitchen-menu-state">
      {command.menuAvailability.map((dish) => <span key={dish.dishId} className={dish.available ? 'is-available' : 'is-unavailable'}>
        {DISH_NAMES.get(dish.dishId) ?? dish.dishId}: {dish.available ? 'AVAILABLE' : 'UNAVAILABLE'}
      </span>)}
    </div>
    <p className="kitchen-recommendation">Suggested: <strong>{recommended?.name}</strong> — {command.recommendation.reason}</p>
    <div className="kitchen-worker-intent">
      {cooks.map((worker) => <span key={worker.workerId}>
        {worker.role.replace(/_/g, ' ')} · {worker.workerId.replace(/_/g, ' ')} · {worker.task ? `${worker.task.kind.replace(/_/g, ' ')} ${worker.task.station ?? ''}` : worker.needsHelp ? 'needs ingredient help' : 'idle'}
      </span>)}
    </div>
    <div className="kitchen-focus-options">{commandData.focuses.map((focus) => <button
      key={focus.id}
      className={focus.id === command.activeFocusId ? 'is-active' : ''}
      disabled={focus.id === command.activeFocusId || command.cooldownForMs > 0}
      onClick={() => onFocus(focus.id)}
    >
      <strong>{focus.name}</strong>
      <small>{focus.bestUse}</small>
      <small>{focus.benefit}</small>
      <small>Trade-off: {focus.downside}</small>
    </button>)}</div>
    {command.cooldownForMs > 0 ? <small>Focus committed for {Math.ceil(command.cooldownForMs / 1000)}s</small> : null}
  </aside>;
}
