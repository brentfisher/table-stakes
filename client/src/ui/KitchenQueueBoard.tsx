// STORY-043 "Kitchen order queue board, with real dish models". Rendered by `GameView.tsx`
// whenever `status.nearKitchenOrderQueueBoard && status.showKitchenOrderQueueBoard` — same
// `nearX`/`showXBoard` toggle-on-`E` pattern `KitchenCommandBoard` already uses, not
// `UpgradeTerminal`'s simpler always-on-proximity pattern (see `GameClient.ts#onInteract`).
//
// THIS IS NOT `KitchenCommandBoard`. That board is about `kitchen_focus_*` policy — a player
// CHOOSING which pressure to optimize for. This board makes no choice and sends no interact at
// all: it is a pure read of PRD §17 rules 2/3 (queue-age bucket, then patience risk), the exact
// comparator `worker-system.js#compareTickets` already uses to pick the AI cook's own next move
// — restaurant-wide, across every station, not one focus's reprioritization of it. See this
// story's own `openspec/changes/coop-kitchen-queue-board/design.md` Decision 72 for why this
// panel's own copy says "priority order" and never "what the cook will do next": under a
// non-default kitchen focus, `selectCookTask` can legitimately start a different ticket than
// this board's own top row (the focus reprioritizes; this board deliberately does not).
//
// Server-authoritative (Decision 2): every field below — including the RANK ORDER itself — comes
// straight off `status.kitchenQueueBoard` (`you.kitchenQueueBoard` on the wire, already sorted by
// `order-system.js#queuedTicketsAcrossStations`). This component sorts nothing.

import dishesData from '../../../shared/game-data/dishes.json';
import type { GameClientStatus } from '../game/GameClient';

const DISH_NAMES = new Map(dishesData.dishes.map((dish) => [dish.id, dish.name]));

export function KitchenQueueBoard({ status }: { status: GameClientStatus }): JSX.Element | null {
  const entries = status.kitchenQueueBoard;

  return (
    <aside className="kitchen-queue-board" aria-label="Kitchen order queue board">
      <strong>EXPO RAIL · PRIORITY ORDER, ALL STATIONS</strong>
      {entries.length === 0 ? (
        <p className="kitchen-queue-board-empty">Nothing queued anywhere in the kitchen.</p>
      ) : (
        <ol>
          {entries.map((entry, rank) => (
            <li key={entry.ticketId} className={entry.blockedByIngredientId ? 'is-blocked' : ''}>
              <span className="kitchen-queue-board-rank">{rank + 1}</span>
              <span className="kitchen-queue-board-name">{DISH_NAMES.get(entry.dishId) ?? entry.dishId}</span>
              <span className="kitchen-queue-board-station">{entry.station.toUpperCase()}</span>
              <span className="kitchen-queue-board-remaining">
                ~{Math.ceil(entry.remainingProductionMs / 1000)}s of work left
              </span>
              {entry.blockedByIngredientId ? (
                <span className="kitchen-queue-board-blocked">
                  blocked: {entry.blockedByIngredientId.replace(/_/g, ' ')}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {/* This board never picks a ticket for anyone — every station's own single-tap `E — Cook
          X`/`E — Plate X` prompt (or, in co-op, `StationMenu`) is still the only way to actually
          start one. Said explicitly, same as `StationMenu.tsx`'s own note, so "priority order"
          never reads as "click here to start". */}
      <p className="kitchen-queue-board-note">Read-only. Start tickets at their own station.</p>
    </aside>
  );
}
