import { useEffect, useState } from 'react';
import dishesData from '../../../shared/game-data/dishes.json';
import type { GameClientStatus } from '../game/GameClient';

const DISH_NAMES = new Map(
  (dishesData.dishes as Array<{ id: string; name: string }>).map((dish) => [dish.id, dish.name]),
);
const money = (value: number) => `$${value.toFixed(2)}`;
const seconds = (ms: number) => `${Math.ceil(ms / 1000)}s`;

export function PantryBoard({
  status,
  onOrder,
  onMoveToKitchen,
}: {
  status: GameClientStatus;
  onOrder: (productId: string, ingredientId: string) => void;
  onMoveToKitchen: () => void;
}): JSX.Element | null {
  const pantry = status.pantry;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (pantry && !pantry.ingredients.some((ingredient) => ingredient.ingredientId === selectedId)) {
      setSelectedId(pantry.ingredients[0]?.ingredientId ?? null);
    }
  }, [pantry, selectedId]);
  if (!pantry) return null;
  const selected = pantry.ingredients.find((ingredient) => ingredient.ingredientId === selectedId)
    ?? pantry.ingredients[0] ?? null;

  return (
    <aside className="pantry-board" aria-label="Pantry supplier board">
      <header>
        <div>
          <span className="board-kicker">STOCKROOM TERMINAL</span>
          <h2>PANTRY · {pantry.overallRisk}</h2>
        </div>
        <button type="button" className="pantry-move" onClick={onMoveToKitchen}>
          Send stock to kitchen
        </button>
      </header>

      {pantry.deliveries.length > 0 ? (
        <section className="pantry-deliveries" aria-label="Inbound deliveries">
          <strong>INBOUND</strong>
          {pantry.deliveries.map((delivery) => (
            <div key={delivery.orderId}>
              <span>{delivery.productName} · {delivery.ingredientName} +{delivery.units}</span>
              <span>{seconds(delivery.arrivesInMs)}</span>
              <progress max={delivery.totalMs} value={delivery.totalMs - delivery.arrivesInMs} aria-label="Delivery in progress" />
            </div>
          ))}
        </section>
      ) : null}

      <div className="pantry-grid">
        <nav className="pantry-ingredients" aria-label="Active menu ingredients">
          {pantry.ingredients.map((ingredient) => (
            <button
              type="button"
              key={ingredient.ingredientId}
              className={ingredient.ingredientId === selected?.ingredientId ? 'selected' : ''}
              onClick={() => setSelectedId(ingredient.ingredientId)}
            >
              <span><strong>{ingredient.name}</strong><b className={`risk-${ingredient.risk.toLowerCase().replace(/ /g, '-')}`}>{ingredient.risk}</b></span>
              <span>{ingredient.count} on hand{ingredient.incomingUnits > 0 ? ` · +${ingredient.incomingUnits} inbound` : ''}</span>
              <small>{ingredient.ordersRemaining} orders left · {ingredient.priceDirection}</small>
            </button>
          ))}
        </nav>

        {selected ? (
          <section className="pantry-detail">
            <h3>{selected.name}</h3>
            <p className="pantry-cause">{selected.explanation}</p>
            <p>
              Affects {selected.affectedDishIds.map((id) => DISH_NAMES.get(id) ?? id).join(', ')}
              {selected.blockedTickets > 0
                ? ` · BLOCKING ${selected.blockedTickets} TICKET${selected.blockedTickets === 1 ? '' : 'S'}`
                : ' · 0 tickets blocked'}
            </p>
            <div className="pantry-quotes">
              {selected.quotes.map((quote) => (
                <button
                  type="button"
                  key={quote.productId}
                  disabled={!quote.available}
                  onClick={() => onOrder(quote.productId, selected.ingredientId)}
                  title={quote.unavailableReason ?? quote.description}
                >
                  <strong>{quote.name}</strong>
                  <span>+{quote.units} · {money(quote.cost)}</span>
                  <span>{seconds(quote.deliveryMs)} · {quote.priceDirection}</span>
                  <small>{quote.available ? quote.description : quote.unavailableReason?.replace(/_/g, ' ')}</small>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
