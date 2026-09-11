// STORY-038. The ready-up path is deliberately three decisions: mains, extras, then prices.
// Server validation remains authoritative. Crew posts and a playable opening pantry are derived
// by the shared ready-up builder, so simplifying the screen never produces an incomplete setup.

import { useMemo, useState } from 'react';

import dishesData from '../../../shared/game-data/dishes.json';
import layoutData from '../../../shared/game-data/restaurant-layout.json';
import {
  MENU_ADDON_SLOTS,
  MENU_MAIN_SLOTS,
  inventoryCost,
  isPriceInRange,
  priceBoundsFor,
  priceGuidance,
  selectableAddons,
  selectableMains,
  toCents,
  type Dish,
  type PriceGuidance,
} from '../../../shared/schemas/setup-rules';
import {
  READY_UP_STAGES,
  buildReadyUpPayload,
  type ReadyUpStage,
} from '../../../shared/game-logic/ready-up-menu';
import { STARTING_CASH } from '../../../shared/constants/tuning';
import type { GameClientStatus, SetupSubmitPayload } from '../game/GameClient';
import { FoodModelPreview } from './FoodModelPreview';

const DISHES = dishesData.dishes as unknown as Dish[];
const INGREDIENTS = dishesData.ingredients as Record<string, { name: string; unitCost: number }>;
const LAYOUT = layoutData as unknown;
const MAIN_OPTIONS = selectableMains(DISHES, LAYOUT);
const EXTRA_OPTIONS = selectableAddons(DISHES, LAYOUT);
const DISH_BY_ID = new Map(DISHES.map((dish) => [dish.id, dish]));

const STAGE_COPY: Record<ReadyUpStage, { kicker: string; title: string; detail: string }> = {
  mains: {
    kicker: '01 / The lineup',
    title: 'Choose your mains',
    detail: `Pick exactly ${MENU_MAIN_SLOTS} dishes that define your restaurant.`,
  },
  extras: {
    kicker: '02 / Round it out',
    title: 'Choose your extras',
    detail: `Add up to ${MENU_ADDON_SLOTS} drinks or desserts, or continue without them.`,
  },
  prices: {
    kicker: '03 / Open the doors',
    title: 'Set your prices',
    detail: 'Balance value and margin, then ready up.',
  },
};

const money = (value: number): string => `$${value.toFixed(2)}`;

function formatCountdown(ms: number | null): string {
  if (ms === null) return '—';
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function guidanceClass(label: string): string {
  if (label === 'Excellent value') return 'value-good';
  if (label === 'Premium' || label === 'Strong margin, demand risk') return 'value-high';
  if (label === 'Likely too expensive for this market' || label === 'Low margin') return 'value-bad';
  return 'value-fair';
}

function GuidanceChips({ guidance }: { guidance: PriceGuidance }): JSX.Element {
  return <div className="ready-price-guidance">
    {guidance.valueLabel ? <span className={guidanceClass(guidance.valueLabel)}>{guidance.valueLabel}</span> : null}
    {guidance.marginLabel ? <span className={guidanceClass(guidance.marginLabel)}>{guidance.marginLabel}</span> : null}
  </div>;
}

export function SetupScreen({
  status,
  onSubmit,
}: {
  status: GameClientStatus;
  onSubmit: (payload: SetupSubmitPayload) => void;
}): JSX.Element {
  const [stageIndex, setStageIndex] = useState(0);
  const [furthestStageIndex, setFurthestStageIndex] = useState(0);
  const [mainIds, setMainIds] = useState<string[]>([]);
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [priceFocusId, setPriceFocusId] = useState<string | null>(null);
  const stage = READY_UP_STAGES[stageIndex];
  const market = status.market;

  const chosenIds = [...mainIds, ...extraIds];
  const chosenDishes = chosenIds
    .map((id) => DISH_BY_ID.get(id))
    .filter((dish): dish is Dish => Boolean(dish));
  const payload = useMemo(() => buildReadyUpPayload({
    mainIds,
    extraIds,
    prices,
    dishes: DISHES,
    ingredients: INGREDIENTS,
    layout: LAYOUT,
    // STORY-040. A co-op restaurant has no roster — see that param's own comment.
    sharedRestaurant: status.sharedRestaurant,
  }), [mainIds, extraIds, prices, status.sharedRestaurant]);
  const stockCost = inventoryCost(payload.startingInventory, INGREDIENTS) ?? 0;
  const inventoryEntries = Object.entries(payload.startingInventory)
    .map(([id, units]) => ({ id, units, ...INGREDIENTS[id] }))
    .filter((entry) => entry.units > 0);

  const setDishPrice = (dish: Dish, value: number): void => {
    setPrices((current) => ({ ...current, [dish.id]: toCents(value) }));
    setPriceFocusId(dish.id);
  };

  const toggleDish = (dish: Dish, kind: 'main' | 'extra'): void => {
    const ids = kind === 'main' ? mainIds : extraIds;
    const limit = kind === 'main' ? MENU_MAIN_SLOTS : MENU_ADDON_SLOTS;
    const setter = kind === 'main' ? setMainIds : setExtraIds;
    setFurthestStageIndex((current) => kind === 'main' ? 0 : Math.min(current, 1));
    if (ids.includes(dish.id)) {
      setter(ids.filter((id) => id !== dish.id));
      return;
    }
    if (ids.length >= limit) return;
    setter([...ids, dish.id]);
    setPrices((current) => ({ ...current, [dish.id]: current[dish.id] ?? dish.suggestedPrice }));
  };

  const priceBlocker = chosenDishes.find((dish) => !isPriceInRange(
    dish,
    prices[dish.id] ?? dish.suggestedPrice,
  ));
  const stageBlocked = stage === 'mains'
    ? mainIds.length !== MENU_MAIN_SLOTS
    : stage === 'prices' && (mainIds.length !== MENU_MAIN_SLOTS || Boolean(priceBlocker));

  const continueFlow = (): void => {
    if (stageBlocked) return;
    if (stageIndex < READY_UP_STAGES.length - 1) {
      const nextStage = stageIndex + 1;
      setStageIndex(nextStage);
      setFurthestStageIndex((current) => Math.max(current, nextStage));
      if (stage === 'extras') setPriceFocusId(chosenIds[0] ?? null);
      return;
    }
    onSubmit(payload as SetupSubmitPayload);
  };

  const renderDishCards = (options: Dish[], kind: 'main' | 'extra') => {
    const selected = kind === 'main' ? mainIds : extraIds;
    const limit = kind === 'main' ? MENU_MAIN_SLOTS : MENU_ADDON_SLOTS;
    return <div className={`ready-dish-grid ready-dish-grid--${kind}`}>
      {options.map((dish, index) => {
        const isSelected = selected.includes(dish.id);
        const disabled = !isSelected && selected.length >= limit;
        return <button
          key={dish.id}
          type="button"
          className={`ready-dish-card${isSelected ? ' is-selected' : ''}`}
          disabled={disabled}
          aria-pressed={isSelected}
          onClick={() => toggleDish(dish, kind)}
        >
          <span className="ready-dish-number">{String(index + 1).padStart(2, '0')}</span>
          <span className="ready-dish-check">{isSelected ? '✓' : '+'}</span>
          <FoodModelPreview assetId={dish.id} label={dish.name} />
          <strong>{dish.name}</strong>
          <small>{dish.tags.slice(0, 3).join(' · ')}</small>
          <span className="ready-dish-cost">Cost {money(dish.baseCost)} · Suggested {money(dish.suggestedPrice)}</span>
        </button>;
      })}
    </div>;
  };

  const focusedDish = DISH_BY_ID.get(priceFocusId ?? chosenIds[0] ?? '') ?? chosenDishes[0];

  return <div className="ready-up">
    <header className="ready-up-topbar">
      <div className="ready-up-brand"><b>T/S</b><span>TABLE<br />STAKES</span></div>
      <nav className="ready-up-progress" aria-label="Ready-up stages">
        {READY_UP_STAGES.map((item, index) => <button
          key={item}
          type="button"
          className={`${index === stageIndex ? 'is-current' : ''}${index !== stageIndex && index < furthestStageIndex ? ' is-complete' : ''}`}
          disabled={index > furthestStageIndex}
          onClick={() => setStageIndex(index)}
        >
          <span>{index < stageIndex ? '✓' : String(index + 1).padStart(2, '0')}</span>
          {item}
        </button>)}
      </nav>
      <div className="ready-up-status">
        <span className="ready-up-clock">{formatCountdown(status.timeRemainingMs)}</span>
        <span className={status.opponentReady ? 'is-ready' : ''}>Rival {status.opponentReady ? 'ready' : 'choosing'}</span>
      </div>
    </header>

    <main className="ready-up-main">
      <section className="ready-up-heading">
        <div>
          <span>{STAGE_COPY[stage].kicker} · {market?.name ?? 'Market pending'}</span>
          <h1>{STAGE_COPY[stage].title}</h1>
          <p>{STAGE_COPY[stage].detail}</p>
        </div>
        <aside>
          <span>District taste</span>
          <strong>{market?.preferredTags?.slice(0, 3).join(' · ') || 'Awaiting forecast'}</strong>
          <small>{market?.anchors?.slice(0, 2).join(' · ')}</small>
        </aside>
      </section>

      {stage === 'mains' ? renderDishCards(MAIN_OPTIONS, 'main') : null}
      {stage === 'extras' ? renderDishCards(EXTRA_OPTIONS, 'extra') : null}
      {stage === 'prices' ? <section className="ready-price-stage">
        <div className="ready-price-showcase">
          <span>Live 3D menu preview</span>
          {focusedDish ? <FoodModelPreview assetId={focusedDish.id} label={focusedDish.name} /> : null}
          <strong>{focusedDish?.name}</strong>
          <small>{focusedDish?.tags.join(' · ')}</small>
        </div>
        <div className="ready-price-list">
          {chosenDishes.map((dish) => {
            const bounds = priceBoundsFor(dish);
            const price = prices[dish.id] ?? dish.suggestedPrice;
            const guidance = priceGuidance(dish, price, market);
            return <article key={dish.id} className={dish.id === focusedDish?.id ? 'is-focused' : ''}>
              <button type="button" onClick={() => setPriceFocusId(dish.id)}>
                <strong>{dish.name}</strong>
                <small>{money(bounds?.minPrice ?? 0)}–{money(bounds?.maxPrice ?? 0)} · plate cost {money(dish.baseCost)}</small>
              </button>
              <label>
                <span>$</span>
                <input
                  type="number"
                  min={bounds?.minPrice ?? 0}
                  max={bounds?.maxPrice ?? 0}
                  step={0.25}
                  value={price}
                  onFocus={() => setPriceFocusId(dish.id)}
                  onChange={(event) => setDishPrice(dish, Number(event.target.value))}
                  aria-label={`${dish.name} price`}
                />
              </label>
              <input
                type="range"
                min={bounds?.minPrice ?? 0}
                max={bounds?.maxPrice ?? 0}
                step={0.25}
                value={price}
                onFocus={() => setPriceFocusId(dish.id)}
                onChange={(event) => setDishPrice(dish, Number(event.target.value))}
                aria-label={`${dish.name} price slider`}
              />
              <GuidanceChips guidance={guidance} />
            </article>;
          })}
        </div>
        <aside className="ready-inventory">
          <div className="ready-inventory-head">
            <div><span>Opening pantry</span><strong>Stocked automatically for this menu</strong></div>
            <div><span>Inventory</span><strong>{money(stockCost)}</strong></div>
            <div><span>Cash reserve</span><strong>{money(STARTING_CASH - stockCost)}</strong></div>
          </div>
          <div className="ready-inventory-models">
            {inventoryEntries.slice(0, 8).map((entry) => <div key={entry.id}>
              <FoodModelPreview assetId={entry.id} label={entry.name} compact />
              <span>{entry.name}</span><b>{entry.units}u</b>
            </div>)}
          </div>
          {inventoryEntries.length > 8 ? <small>Plus {inventoryEntries.length - 8} more stocked ingredients.</small> : null}
        </aside>
      </section> : null}
    </main>

    <footer className="ready-up-footer">
      <button type="button" className="ready-back" disabled={stageIndex === 0} onClick={() => setStageIndex(stageIndex - 1)}>← Back</button>
      <div>
        <strong>{stage === 'mains' ? `${mainIds.length} of ${MENU_MAIN_SLOTS} mains selected` : stage === 'extras' ? `${extraIds.length} of ${MENU_ADDON_SLOTS} extras selected` : `${chosenIds.length} dishes ready to price`}</strong>
        <span>{stageBlocked ? (priceBlocker ? `${priceBlocker.name} is outside its legal price range.` : `Choose exactly ${MENU_MAIN_SLOTS} mains to continue.`) : status.setupRejection ? `Server rejected the lineup: ${status.setupRejection.detail}` : status.setup ? 'Lineup submitted. Waiting for your rival.' : stage === 'prices' ? 'Recommended inventory and crew posts will be included automatically.' : 'Your choices are saved when you move between stages.'}</span>
      </div>
      <button type="button" className="ready-next" disabled={stageBlocked} onClick={continueFlow}>
        {stage === 'prices' ? (status.setup ? 'Update & ready ✓' : 'Confirm & ready ✓') : 'Confirm & next →'}
      </button>
    </footer>
  </div>;
}
