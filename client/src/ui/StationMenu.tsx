// STORY-042. Rendered by `GameView.tsx` whenever `status.nearStation && status.sharedRestaurant`
// — the exact `status?.nearX` → conditional-panel pattern `UpgradeTerminal` established for
// `nearUpgradeTerminal` (see that component's own header), applied to a station instead of the
// upgrade terminal. Co-op only (AC4): with no automated cook (STORY-040), a co-op player at a
// station has no worker choosing for them and needs the same "what's most needed" read the AI
// cook gets (`worker-system.js#selectCookTask`'s rule 2/3, via `compareTickets`).
//
// THIS PANEL DOES NOT PICK WHICH TICKET STARTS. `action-validator.js#resolveCookOrPlate` is
// still the only thing that decides that — always the oldest queued ticket at the station,
// unconditionally, regardless of which row below was clicked. Every enabled row calls
// `GameClient#cookOrPlateAt(station)`, which sends the IDENTICAL `{targetId: 'station_<x>',
// action: 'cook'|'plate'}` payload the pre-existing single-tap `E —` prompt already sends
// (`InteractionController#stationCandidate`) — no new action type, no per-item selection on the
// wire, per this story's own AC3. Rows with nothing queued are disabled rather than wired to a
// button that would just come back `nothing_queued` — see `resolveCookOrPlate`.
//
// RANKING. `buildStationMenuItems` mirrors `worker-system.js#compareTickets`'s two rules as
// closely as the PUBLIC snapshot allows:
//   - Rule 3 (patience risk) has a direct public analog: `CustomerSnapshot.patienceRemaining`,
//     joined ticket -> order -> customer. `patienceRisk` there is `1 - patienceRemaining`, so
//     the item whose queued ticket belongs to the least-patient customer sorts first among
//     items that both have demand.
//   - Rule 2 (queue-age bucket) has NO public analog: `queueAgeMs` is computed inside
//     `order-system.js`'s private ticket state and is never published on `OrderSnapshot`
//     (compare `readyAgeMs`, which IS published, but only exists once a ticket leaves
//     `queued`). Reconstructing it from `orders[]`'s array position would rest on an
//     undocumented invariant (`order-system.js`'s own header documents queue DEPTH as
//     array-derived, a `.filter().length`, never array ORDER as FIFO) — so this menu does not
//     attempt rule 2 at all. A dish with a queued ticket always outranks a dish with none
//     (that alone satisfies AC2's "distinguished ... sorted first"); ties among demanded dishes
//     break on patience only, then on how many tickets are queued, then alphabetically.

import dishesData from '../../../shared/game-data/dishes.json';
import type { GameClientStatus } from '../game/GameClient';

interface DishData {
  id: string;
  name: string;
  stationSteps: Array<{ station: string; durationMs: number }>;
}
const DISHES = dishesData.dishes as DishData[];
const DISH_BY_ID = new Map(DISHES.map((dish) => [dish.id, dish]));

export interface StationMenuItem {
  dishId: string;
  name: string;
  /** Queued tickets for this dish at this station, this restaurant, right now. */
  queuedCount: number;
  hasDemand: boolean;
}

/**
 * Pure — no snapshot mutation, no network access. A single real consumer (`StationMenu` below);
 * exported for the sake of an eventual client-only test, not a second runtime.
 */
export function buildStationMenuItems({
  station,
  restaurantId,
  menuDishIds,
  orders,
  customers,
}: {
  station: string;
  restaurantId: string | null;
  /** The viewer's OWN accepted menu + addon dish ids (`status.setup.menu`/`.addons`) — never
   * the rival's, which the wire never sends (PRD §18, Decision 16). Duplicates collapse. */
  menuDishIds: string[];
  orders: GameClientStatus['orders'];
  customers: GameClientStatus['customers'];
}): StationMenuItem[] {
  const queuedTicketsByDish = new Map<string, GameClientStatus['orders']>();
  for (const ticket of orders) {
    if (ticket.restaurantId !== restaurantId || ticket.station !== station || ticket.state !== 'queued') continue;
    const list = queuedTicketsByDish.get(ticket.dishId);
    if (list) list.push(ticket);
    else queuedTicketsByDish.set(ticket.dishId, [ticket]);
  }
  // A ticket whose party has no matching `CustomerSnapshot` (already exited, or this snapshot's
  // `customers[]` momentarily lagging `orders[]`) is treated as MAXIMUM risk (`0`, not `1`) —
  // "unaccounted for" is never read as "perfectly patient", which would wrongly sort it last.
  const patienceRemainingOf = (orderId: string): number => {
    const customer = customers.find((c) => c.orderId === orderId);
    return customer ? customer.patienceRemaining : 0;
  };

  const items = [...new Set(menuDishIds)]
    .map((dishId) => DISH_BY_ID.get(dishId))
    .filter((dish): dish is DishData => dish !== undefined && dish.stationSteps.some((step) => step.station === station))
    .map((dish) => {
      const queued = queuedTicketsByDish.get(dish.id) ?? [];
      const worstPatienceRemaining = queued.length
        ? Math.min(...queued.map((ticket) => patienceRemainingOf(ticket.orderId)))
        : 1;
      return {
        dishId: dish.id,
        name: dish.name,
        queuedCount: queued.length,
        hasDemand: queued.length > 0,
        worstPatienceRemaining,
      };
    });

  items.sort((a, b) => {
    if (a.hasDemand !== b.hasDemand) return a.hasDemand ? -1 : 1;
    if (a.worstPatienceRemaining !== b.worstPatienceRemaining) return a.worstPatienceRemaining - b.worstPatienceRemaining;
    if (a.queuedCount !== b.queuedCount) return b.queuedCount - a.queuedCount;
    return a.name.localeCompare(b.name);
  });

  return items.map(({ dishId, name, queuedCount, hasDemand }) => ({ dishId, name, queuedCount, hasDemand }));
}

export function StationMenu({
  status,
  station,
  onSelect,
}: {
  status: GameClientStatus;
  station: string;
  onSelect: (station: string) => void;
}): JSX.Element | null {
  // STORY-042. Own restaurant only — `status.setup` is the viewer's own accepted submission
  // (never the rival's), and is null until `setup_submit` is accepted, which always happens
  // before `service` starts (the only phase this panel is gated to render in, in `GameView.tsx`).
  const menuDishIds = [
    ...(status.setup?.menu ?? []),
    ...(status.setup?.addons ?? []),
  ].map((slot) => slot.dishId);

  const items = buildStationMenuItems({
    station,
    restaurantId: status.restaurantId,
    menuDishIds,
    orders: status.orders,
    customers: status.customers,
  });
  const verb = station === 'plating' ? 'Plate' : 'Cook';

  return (
    <aside className="station-menu" aria-label={`${station} station menu`}>
      <h2>{station.toUpperCase()} · WHAT TO {verb.toUpperCase()}</h2>
      {items.length === 0 ? (
        <p className="station-menu-empty">Nothing on the menu is made here.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.dishId} className={item.hasDemand ? 'has-demand' : 'no-demand'}>
              <span className="station-menu-name">{item.name}</span>
              {item.hasDemand ? <span className="station-menu-count">×{item.queuedCount}</span> : null}
              <button type="button" disabled={!item.hasDemand} onClick={() => onSelect(station)}>
                {verb}
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* AC3: every button above sends the identical station-level `cook`/`plate` interact —
          the server always starts the oldest queued ticket at THIS station, not necessarily the
          row clicked. Said explicitly here, not just in this file's own header comment, per
          AC2's "a player should be able to tell" being about what's on screen. */}
      <p className="station-menu-note">Starts the oldest order waiting at this station.</p>
    </aside>
  );
}
