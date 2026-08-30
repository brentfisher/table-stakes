// PRD §18 "Setup UI" — the strategic half of the game, on one screen.
//
// Layout is §18's, literally: market briefing and customer forecast at LEFT, menu slots and
// dish options in the CENTRE, prices/margins/starting resources at RIGHT, staff assignments
// and upgrade/perk selection at the BOTTOM, countdown and opponent-ready status on TOP.
//
// ============================================================================================
// PRD §7 "Pricing", the rule this screen exists to keep: "The UI should display qualitative
// guidance, not exact customer utility math." Nothing here renders a utility score, a
// segment weight, a conversion probability or a projected wait. Price feedback is the six §7
// label strings and nothing else, and they arrive already computed from
// `shared/schemas/setup-rules.js` — this component cannot leak a number it never receives.
//
// What it DOES show in figures is the player's own money: the price they set, the dish's
// catalogue cost, their cash, their allocation. PRD §7 hands the player "starting cash" and a
// "dish catalog" including cost and suggested price; those are the inputs to the decision, not
// the simulation's opinion of it.
// ============================================================================================
//
// PRD §13 "React responsibilities": React owns application UI. This component re-renders on
// the snapshot callback (~10 Hz) and on local edits; it touches no Three.js object and
// reconciles no scene entity — GameClient owns the scene, exactly as before.
//
// Milestone 0 Decision 2: everything disabled here is disabled for UX only.
// `server/src/game/validators/setup-validator.js` re-derives every one of these rules and
// rejects an illegal submission whatever this screen allowed.

import { useMemo, useState } from 'react';

import dishesData from '../../../shared/game-data/dishes.json';
import upgradesData from '../../../shared/game-data/upgrades.json';
import policiesData from '../../../shared/game-data/policies.json';
import segmentsData from '../../../shared/game-data/customer-segments.json';
import layoutData from '../../../shared/game-data/restaurant-layout.json';

import {
  MENU_ADDON_SLOTS,
  MENU_MAIN_SLOTS,
  inventoryCost,
  isPriceInRange,
  priceBoundsFor,
  priceGuidance,
  rosterOf,
  segmentForecast,
  selectableAddons,
  selectableMains,
  toCents,
  type Dish,
  type PriceGuidance,
} from '../../../shared/schemas/setup-rules';
import { STARTING_CASH } from '../../../shared/constants/tuning';
import type { GameClientStatus, SetupSubmitPayload } from '../game/GameClient';

interface Upgrade {
  id: string;
  name: string;
  cost: number;
  description: string;
}
interface Policy {
  id: string;
  name: string;
  description: string;
  intendedStrategy: string;
  requiresMenuDish: boolean;
}
interface Segment {
  id: string;
  name: string;
  primaryPriority: string;
  budget: number;
  patienceSeconds: number;
  preferredTags: string[];
}

// The JSON files are typed structurally by `resolveJsonModule`, which widens every string
// literal; these casts name the shapes the catalogue actually carries. Decision 10: browser
// code imports the JSON directly and never touches the Node-only loader.
const LAYOUT = layoutData as unknown;
const DISHES = dishesData.dishes as unknown as Dish[];
const INGREDIENTS = dishesData.ingredients as Record<string, { name: string; unitCost: number }>;
const UPGRADES = upgradesData.upgrades as unknown as Upgrade[];
const POLICIES = policiesData.policies as unknown as Policy[];
const SEGMENTS = segmentsData.segments as unknown as Segment[];
const ROSTER = rosterOf(LAYOUT);

const MAIN_OPTIONS = selectableMains(DISHES, LAYOUT);
const ADDON_OPTIONS = selectableAddons(DISHES, LAYOUT);

const money = (value: number): string => `$${value.toFixed(2)}`;

function formatCountdown(ms: number | null): string {
  if (ms === null) return '—';
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Colour is a hint, never information: the label string is the whole message. */
function chipClass(label: string): string {
  if (label === 'Excellent value') return 'setup-chip value-good';
  if (label === 'Premium' || label === 'Strong margin, demand risk') return 'setup-chip value-high';
  if (label === 'Likely too expensive for this market' || label === 'Low margin') {
    return 'setup-chip value-bad';
  }
  return 'setup-chip value-fair';
}

function GuidanceChips({ guidance }: { guidance: PriceGuidance }): JSX.Element {
  return (
    <div className="setup-guidance">
      {guidance.valueLabel ? (
        <span className={chipClass(guidance.valueLabel)}>{guidance.valueLabel}</span>
      ) : null}
      {guidance.marginLabel ? (
        <span className={chipClass(guidance.marginLabel)}>{guidance.marginLabel}</span>
      ) : null}
    </div>
  );
}

export function SetupScreen({
  status,
  onSubmit,
}: {
  status: GameClientStatus;
  onSubmit: (payload: SetupSubmitPayload) => void;
}): JSX.Element {
  // dishId -> chosen price. Two maps rather than one, because the two slot kinds have
  // different capacities and PRD §7 counts them separately.
  const [mains, setMains] = useState<Record<string, number>>({});
  const [addons, setAddons] = useState<Record<string, number>>({});
  const [allocation, setAllocation] = useState<Record<string, number>>({});
  const [upgradeId, setUpgradeId] = useState<string | null>(null);
  const [policyId, setPolicyId] = useState<string | null>(null);
  const [policyDishId, setPolicyDishId] = useState<string | null>(null);
  const [posts, setPosts] = useState<Record<string, string>>(() =>
    Object.fromEntries(ROSTER.map((worker) => [worker.id, worker.posts[0]])),
  );

  const market = status.market;
  const forecast = useMemo(() => segmentForecast(market, SEGMENTS), [market]);
  const chosenIds = [...Object.keys(mains), ...Object.keys(addons)];
  const chosenDishes = chosenIds
    .map((id) => DISHES.find((d) => d.id === id))
    .filter((d): d is Dish => Boolean(d));

  // Only the ingredients the chosen menu actually needs are worth stocking, so the allocation
  // panel is scoped to them. The server accepts any known ingredient; this is UX.
  const relevantIngredients = useMemo(() => {
    const ids = new Set<string>();
    for (const d of chosenDishes) for (const key of Object.keys(d.ingredients)) ids.add(key);
    return [...ids].sort();
  }, [chosenIds.join(',')]);

  const upgradeCost = upgradeId ? (UPGRADES.find((u) => u.id === upgradeId)?.cost ?? 0) : 0;
  const stockCost = inventoryCost(allocation, INGREDIENTS) ?? 0;
  const cashRemaining = toCents(STARTING_CASH - upgradeCost - stockCost);

  const selectedPolicy = POLICIES.find((p) => p.id === policyId) ?? null;
  const needsPolicyDish = Boolean(selectedPolicy?.requiresMenuDish);

  const toggle = (
    map: Record<string, number>,
    setMap: (next: Record<string, number>) => void,
    limit: number,
    d: Dish,
  ): void => {
    const next = { ...map };
    if (d.id in next) {
      delete next[d.id];
      if (policyDishId === d.id) setPolicyDishId(null);
    } else {
      if (Object.keys(next).length >= limit) return;
      next[d.id] = d.suggestedPrice;
    }
    setMap(next);
  };

  const setPrice = (
    map: Record<string, number>,
    setMap: (next: Record<string, number>) => void,
    dishId: string,
    price: number,
  ): void => setMap({ ...map, [dishId]: toCents(price) });

  // Client-side legality, for the submit button only. The server decides.
  const blockers: string[] = [];
  if (Object.keys(mains).length !== MENU_MAIN_SLOTS) {
    blockers.push(`Choose exactly ${MENU_MAIN_SLOTS} main dishes.`);
  }
  if (Object.keys(addons).length > MENU_ADDON_SLOTS) {
    blockers.push(`At most ${MENU_ADDON_SLOTS} add-ons.`);
  }
  for (const d of chosenDishes) {
    const price = mains[d.id] ?? addons[d.id];
    if (!isPriceInRange(d, price)) blockers.push(`${d.name} is priced outside its range.`);
  }
  if (cashRemaining < 0) blockers.push('The upgrade and allocation cost more than your cash.');
  if (needsPolicyDish && !policyDishId) blockers.push('Pick the dish your House Special applies to.');
  for (const worker of ROSTER) {
    if (!posts[worker.id]) blockers.push(`${worker.name} needs a post.`);
  }

  const submitted = status.setup;
  const submit = (): void =>
    onSubmit({
      menu: Object.entries(mains).map(([dishId, price]) => ({ dishId, price })),
      addons: Object.entries(addons).map(([dishId, price]) => ({ dishId, price })),
      startingUpgradeId: upgradeId,
      staffAssignments: { ...posts },
      startingInventory: Object.fromEntries(
        Object.entries(allocation).filter(([, units]) => units > 0),
      ),
      policyId,
      policyDishId: needsPolicyDish ? policyDishId : null,
    });

  const priceSlot = (
    d: Dish,
    map: Record<string, number>,
    setMap: (next: Record<string, number>) => void,
  ): JSX.Element => {
    const bounds = priceBoundsFor(d);
    const price = map[d.id];
    const guidance = priceGuidance(d, price, market);
    return (
      <div className="setup-slot" key={d.id}>
        <div className="head">
          <span>{d.name}</span>
          <span className="num">{money(price)}</span>
        </div>
        <input
          type="range"
          min={bounds?.minPrice ?? 0}
          max={bounds?.maxPrice ?? 0}
          step={0.25}
          value={price}
          onChange={(e) => setPrice(map, setMap, d.id, Number(e.target.value))}
          aria-label={`${d.name} price`}
        />
        <div className="row muted num" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{money(bounds?.minPrice ?? 0)}</span>
          <span>plate cost {money(d.baseCost)}</span>
          <span>{money(bounds?.maxPrice ?? 0)}</span>
        </div>
        <GuidanceChips guidance={guidance} />
      </div>
    );
  };

  const dishButton = (
    d: Dish,
    map: Record<string, number>,
    setMap: (next: Record<string, number>) => void,
    limit: number,
  ): JSX.Element => {
    const isSelected = d.id in map;
    return (
      <button
        key={d.id}
        type="button"
        className={`setup-dish${isSelected ? ' is-selected' : ''}`}
        disabled={!isSelected && Object.keys(map).length >= limit}
        onClick={() => toggle(map, setMap, limit, d)}
      >
        <span className="name">{d.name}</span>
        <span className="num muted">
          {money(d.baseCost)} → {money(d.suggestedPrice)}
        </span>
        <span className="tags">{d.tags.join(' · ')}</span>
      </button>
    );
  };

  return (
    <div className="setup">
      {/* TOP — countdown clock and opponent-ready status (§18). */}
      <div className="setup-region setup-top">
        <span className="setup-clock">{formatCountdown(status.timeRemainingMs)}</span>
        <span className="setup-title">Setup — {market?.name ?? 'market pending'}</span>
        <span className="spacer" />
        <span className={`setup-badge${status.ready ? ' is-ready' : ''}`}>
          You: {status.ready ? 'submitted' : 'still deciding'}
        </span>
        <span className={`setup-badge${status.opponentReady ? ' is-ready' : ''}`}>
          Rival: {status.opponentReady ? 'ready' : 'still deciding'}
        </span>
      </div>

      {/* LEFT — market briefing and customer forecast (§18, contents from §7). */}
      <div className="setup-region setup-left">
        <h2>Market briefing</h2>
        <h3>{market?.name ?? '—'}</h3>
        <p className="muted">{market?.description}</p>
        <div className="setup-field">
          <span className="muted">Daypart</span>
          <span>{market?.daypart ?? '—'}</span>
        </div>
        <div className="setup-field">
          <span className="muted">Starting cash</span>
          <span className="num">{money(STARTING_CASH)}</span>
        </div>
        <div className="setup-field">
          <span className="muted">Layout</span>
          <span>{(layoutData as { name: string }).name}</span>
        </div>

        <h3>Nearby anchors</h3>
        <ul>
          {(market?.anchors ?? []).map((anchor) => (
            <li key={anchor}>{anchor}</li>
          ))}
        </ul>

        <h3>Customer forecast</h3>
        <ul className="setup-forecast">
          {forecast.map((segment) => (
            <li key={segment.id}>
              <div className="row">
                <strong>{segment.name}</strong>
                <span className="num muted">{Math.round(segment.share * 100)}%</span>
              </div>
              <div className="muted">{segment.primaryPriority}</div>
              {/* PRD §7: BROAD spending and patience indicators — labels, not budgets. */}
              <div className="muted">
                Spends: {segment.spending} · Waits: {segment.patience}
              </div>
              <div className="muted">Looks for: {segment.preferredTags.join(', ')}</div>
            </li>
          ))}
        </ul>

        <h3>District taste</h3>
        <p className="muted">{(market?.preferredTags ?? []).join(', ') || '—'}</p>

        <h3>Event forecast</h3>
        <p className="muted">
          No events forecast. The seeded event deck lands with STORY-011; until then the
          district runs quiet.
        </p>

        <h3>Your crew</h3>
        <ul>
          {ROSTER.map((worker) => (
            <li key={worker.id} className="muted">
              {worker.name} — {worker.description}
            </li>
          ))}
          <li className="muted">You — the owner, on the floor once service starts.</li>
        </ul>
      </div>

      {/* CENTRE — menu slots and dish options (§18). */}
      <div className="setup-region setup-center">
        <h2>
          Menu — {Object.keys(mains).length}/{MENU_MAIN_SLOTS} mains,{' '}
          {Object.keys(addons).length}/{MENU_ADDON_SLOTS} add-ons
        </h2>
        <h3>Main dishes</h3>
        {MAIN_OPTIONS.map((d) => dishButton(d, mains, setMains, MENU_MAIN_SLOTS))}
        <h3>Add-ons — drinks, desserts, sides</h3>
        {ADDON_OPTIONS.map((d) => dishButton(d, addons, setAddons, MENU_ADDON_SLOTS))}
        <p className="muted">
          Only dishes this kitchen can physically produce are listed (PRD §7). The menu cannot
          be changed once service begins.
        </p>
      </div>

      {/* RIGHT — prices, margins, starting resources, readiness (§18). */}
      <div className="setup-region setup-right">
        <h2>Prices &amp; resources</h2>
        {chosenIds.length === 0 ? <p className="muted">Choose dishes to price them.</p> : null}
        {MAIN_OPTIONS.filter((d) => d.id in mains).map((d) => priceSlot(d, mains, setMains))}
        {ADDON_OPTIONS.filter((d) => d.id in addons).map((d) => priceSlot(d, addons, setAddons))}

        <h3>Starting inventory</h3>
        {relevantIngredients.length === 0 ? (
          <p className="muted">Pick a menu and its ingredients appear here.</p>
        ) : null}
        {relevantIngredients.map((id) => (
          <div className="setup-field" key={id}>
            <span>
              {INGREDIENTS[id]?.name}{' '}
              <span className="muted num">{money(INGREDIENTS[id]?.unitCost ?? 0)}/unit</span>
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={allocation[id] ?? 0}
              onChange={(e) =>
                setAllocation({ ...allocation, [id]: Math.max(0, Math.floor(Number(e.target.value))) })
              }
              aria-label={`${INGREDIENTS[id]?.name} units`}
            />
          </div>
        ))}

        <h3>Cash</h3>
        <div className="setup-field">
          <span className="muted">Upgrade</span>
          <span className="num">{money(upgradeCost)}</span>
        </div>
        <div className="setup-field">
          <span className="muted">Ingredients</span>
          <span className="num">{money(stockCost)}</span>
        </div>
        <div className="setup-field">
          <span className="muted">Remaining</span>
          <span className="num" style={{ color: cashRemaining < 0 ? 'var(--bad)' : undefined }}>
            {money(cashRemaining)}
          </span>
        </div>

        <button className="setup-submit" type="button" disabled={blockers.length > 0} onClick={submit}>
          {submitted ? 'Resubmit setup' : 'Submit setup & ready up'}
        </button>
        {blockers.length > 0 ? <p className="setup-error">{blockers[0]}</p> : null}
        {status.setupRejection ? (
          <p className="setup-error">
            Server rejected it ({status.setupRejection.reason}): {status.setupRejection.detail}
          </p>
        ) : null}
        {submitted && blockers.length === 0 && !status.setupRejection ? (
          <p className="setup-ok">
            Submitted. Service begins when both owners are ready or the clock runs out.
          </p>
        ) : null}
      </div>

      {/* BOTTOM — staff assignments and upgrade/perk selection (§18). */}
      <div className="setup-region setup-bottom">
        <div className="setup-column">
          <h2>Staff assignments</h2>
          {ROSTER.map((worker) => (
            <div className="setup-field" key={worker.id}>
              <span>{worker.name}</span>
              <select
                value={posts[worker.id] ?? ''}
                onChange={(e) => setPosts({ ...posts, [worker.id]: e.target.value })}
                aria-label={`${worker.name} post`}
              >
                {worker.posts.map((postId) => (
                  <option key={postId} value={postId}>
                    {postId.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="setup-column">
          <h2>Opening upgrade</h2>
          <label className={`setup-option${upgradeId === null ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="upgrade"
              checked={upgradeId === null}
              onChange={() => setUpgradeId(null)}
            />
            None — keep the cash
          </label>
          {UPGRADES.map((upgrade) => {
            const affordable = upgrade.cost + stockCost <= STARTING_CASH;
            return (
              <label
                key={upgrade.id}
                className={
                  `setup-option${upgradeId === upgrade.id ? ' is-selected' : ''}` +
                  `${affordable ? '' : ' is-disabled'}`
                }
              >
                <input
                  type="radio"
                  name="upgrade"
                  checked={upgradeId === upgrade.id}
                  disabled={!affordable}
                  onChange={() => setUpgradeId(upgrade.id)}
                />
                {upgrade.name} <span className="num muted">{money(upgrade.cost)}</span>
                <span className="why">{upgrade.description}</span>
              </label>
            );
          })}
        </div>

        <div className="setup-column">
          <h2>Restaurant policy</h2>
          <label className={`setup-option${policyId === null ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="policy"
              checked={policyId === null}
              onChange={() => {
                setPolicyId(null);
                setPolicyDishId(null);
              }}
            />
            None
          </label>
          {POLICIES.map((policy) => (
            <label
              key={policy.id}
              className={`setup-option${policyId === policy.id ? ' is-selected' : ''}`}
            >
              <input
                type="radio"
                name="policy"
                checked={policyId === policy.id}
                onChange={() => setPolicyId(policy.id)}
              />
              {policy.name}
              <span className="why">
                {policy.description} ({policy.intendedStrategy})
              </span>
            </label>
          ))}
          {needsPolicyDish ? (
            <div className="setup-field">
              <span>Applies to</span>
              <select
                value={policyDishId ?? ''}
                onChange={(e) => setPolicyDishId(e.target.value || null)}
                aria-label="House Special dish"
              >
                <option value="">choose a dish…</option>
                {chosenDishes.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <p className="muted">
            PRD §7 caps the MVP at two policies; the other three arrive with the balance pass.
          </p>
        </div>
      </div>
    </div>
  );
}
