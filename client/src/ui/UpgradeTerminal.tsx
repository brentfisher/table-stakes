// PRD §10 "Upgrades" / §8's physical terminal. Rendered by `App.tsx` whenever
// `status.nearUpgradeTerminal` is true — walking up to the terminal opens the shop directly,
// no `E` press first, since browsing isn't a single verb+object action the contextual-prompt
// system fits (see `InteractionController#nearUpgradeTerminal`'s own comment).
//
// Milestone 0 Decision 2: everything disabled here is disabled for UX only.
// `server/src/game/validators/action-validator.js#handlePurchaseUpgrade` re-derives every one
// of these rules (range, cost, prerequisite, already-owned, effect wired) and rejects an
// illegal purchase whatever this screen allowed.
//
// SCOPE: only `WIRED_UPGRADE_IDS` — catalogue entries with a live effect — are
// offered here. The remaining entries exist in `upgrades.json` but nothing reads their effect yet
// (`upgrade-system.js`'s `KNOWN_EFFECT_KEYS`); listing them as buyable would let a player spend
// real cash for nothing, so they simply are not shown.

import upgradesData from '../../../shared/game-data/upgrades.json';
import { STAFF_ONLY_UPGRADE_IDS, WIRED_UPGRADE_IDS } from '../game/GameClient';

interface Upgrade {
  id: string;
  name: string;
  cost: number;
  description: string;
  requires?: string;
}

const UPGRADES = (upgradesData.upgrades as Upgrade[]).filter((u) => WIRED_UPGRADE_IDS.includes(u.id));
const UPGRADE_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

const money = (cents: number): string => `$${cents.toFixed(0)}`;

export function UpgradeTerminal({
  cash,
  purchasedUpgradeIds,
  sharedRestaurant,
  onBuy,
}: {
  cash: number | null;
  purchasedUpgradeIds: string[];
  /** STORY-040. `Match#sharedRestaurant` — locks `STAFF_ONLY_UPGRADE_IDS` with a stated reason
   * instead of a plain "Requires ..."/disabled buy button, so the player understands WHY rather
   * than wondering if it's a bug (this story's own AC). Every pre-existing mode passes `false`. */
  sharedRestaurant: boolean;
  onBuy: (upgradeId: string) => void;
}): JSX.Element {
  return (
    <div className="upgrade-terminal">
      <h2>Upgrade Terminal</h2>
      <div className="upgrade-terminal-cash">{cash === null ? '—' : money(cash)}</div>
      {UPGRADES.map((upgrade) => {
        const owned = purchasedUpgradeIds.includes(upgrade.id);
        const requiredUpgrade = upgrade.requires ? UPGRADE_BY_ID.get(upgrade.requires) : undefined;
        const locked = Boolean(upgrade.requires) && !purchasedUpgradeIds.includes(upgrade.requires as string);
        const staffOnlyLocked = sharedRestaurant && STAFF_ONLY_UPGRADE_IDS.includes(upgrade.id);
        const affordable = cash !== null && cash >= upgrade.cost;
        const buyable = !owned && !locked && !staffOnlyLocked && affordable;
        return (
          <div
            key={upgrade.id}
            className={`upgrade-terminal-row${owned ? ' is-owned' : ''}${locked || staffOnlyLocked ? ' is-locked' : ''}`}
          >
            <div className="upgrade-terminal-row-header">
              <span className="upgrade-terminal-name">{upgrade.name}</span>
              <span className="num muted">{money(upgrade.cost)}</span>
            </div>
            <span className="why">{upgrade.description}</span>
            {owned ? (
              <button type="button" disabled>
                Owned
              </button>
            ) : staffOnlyLocked ? (
              <button type="button" disabled title="This upgrade only helps automated staff, and a co-op restaurant has none.">
                No staff to upgrade
              </button>
            ) : locked ? (
              <button type="button" disabled>
                Requires {requiredUpgrade?.name ?? upgrade.requires}
              </button>
            ) : (
              <button type="button" disabled={!buyable} onClick={() => onBuy(upgrade.id)}>
                {affordable ? `Buy ${money(upgrade.cost)}` : `Need ${money(upgrade.cost)}`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
