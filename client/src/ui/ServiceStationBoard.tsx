import data from '../../../shared/game-data/service-station.json';
import type { GameClientStatus } from '../game/GameClient';

export function ServiceStationBoard({ status, onCommand }: { status: GameClientStatus; onCommand: (command: string) => void }): JSX.Element {
  // STORY-039. `status.restaurantId`, not `status.playerId` — see `GameClientStatus
  // .restaurantId`'s own comment.
  const own = status.restaurants.find((restaurant) => restaurant.restaurantId === status.restaurantId);
  const service = status.serviceStation[status.restaurantId ?? ''];
  if (!own || !service) return <></>;
  const occupied = own.tables.filter((table) => table.occupiedBy).length;
  const dirty = own.tables.filter((table) => table.dirty).length;
  const ready = status.orders.filter((order) => order.restaurantId === status.restaurantId && order.state === 'ready').length;
  const workers = own.workers ?? [];
  const busy = workers.filter((worker) => worker.busy).length;
  const risk = status.customers.filter((customer) => customer.restaurantId === status.restaurantId && customer.unhappy).length;
  const activePriority = data.priorities.find((priority) => priority.id === service.priorityId);
  return <aside className="service-station-board" aria-label="Dining Room board">
    <strong>DINING ROOM BOARD</strong>
    <span>{occupied}/{own.tables.length} OCCUPIED · {own.seatsAvailable} OPEN · {dirty} DIRTY</span>
    <span>{ready} READY DISHES · WORKER LOAD {busy}/{workers.length} · {risk} AT RISK</span>
    <span>PAYROLL ${service.payrollBurn}/10s · LABOR SPEND ${service.laborExpenses}</span>
    <div className="service-contracts">{data.contracts.map((contract) => {
      const hire = service.contracts.find((item) => item.contractId === contract.id);
      return <div key={contract.id}>
        <strong>{contract.name}</strong><small>{contract.benefit}</small><small>Trade-off: {contract.downside}</small>
        {hire ? <><small>{hire.status === 'arriving' ? `ARRIVING ${Math.ceil(hire.arrivalForMs / 1000)}s` : `ACTIVE ${Math.ceil(hire.activeForMs / 1000)}s`}</small>
          <button disabled={hire.committedForMs > 0} onClick={() => onCommand(`release_${contract.id}`)}>Release</button></>
          : <button onClick={() => onCommand(`hire_${contract.id}`)}>Hire · ${contract.hireFee} + ${contract.wage}/10s</button>}
      </div>;
    })}</div>
    <strong>SERVICE PRIORITY</strong>
    {activePriority ? <small>{activePriority.benefit} Trade-off: {activePriority.downside}</small> : null}
    <div className="service-priorities">{data.priorities.map((priority) => <button
      key={priority.id}
      className={service.priorityId === priority.id ? 'is-active' : ''}
      disabled={service.priorityId === priority.id || service.priorityCooldownForMs > 0}
      onClick={() => onCommand(`priority_${priority.id}`)}
      title={`${priority.benefit} Trade-off: ${priority.downside}`}
    >{priority.name}</button>)}</div>
  </aside>;
}
