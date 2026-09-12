// STORY-047. Static catalogue-name lookups shared across the recap sections — moved out of the
// old monolithic `ResultsPanel.tsx` (STORY-014). `dishesData` is the same public game-data JSON
// `SetupScreen.tsx`/`GameClient.ts` already import client-side (dish NAMES are public catalogue
// content, not a simulation result) — see `ResultsPanel.tsx`'s own header for why only a dish's
// NAME, never a count/margin/score, is allowed to come from anywhere but `match_complete`.

import dishesData from '../../../../shared/game-data/dishes.json';
import eventsData from '../../../../shared/game-data/events.json';
import frontDoorData from '../../../../shared/game-data/front-door-specials.json';
import kitchenCommandData from '../../../../shared/game-data/kitchen-command.json';
import segmentsData from '../../../../shared/game-data/customer-segments.json';
import upgradesData from '../../../../shared/game-data/upgrades.json';
import type { ManagerConstraintId } from '../../../../shared/game-logic/manager-ledger';

const DISH_NAMES = new Map<string, string>(
  (dishesData.dishes as Array<{ id: string; name: string }>).map((d) => [d.id, d.name]),
);

export const dishName = (dishId: string): string => DISH_NAMES.get(dishId) ?? dishId;

const SEGMENT_NAMES = new Map<string, string>(
  (segmentsData.segments as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]),
);
export const segmentName = (segmentId: string): string => SEGMENT_NAMES.get(segmentId) ?? segmentId;

interface UpgradeInfo {
  id: string;
  name: string;
  description: string;
}
const UPGRADE_INFO = new Map<string, UpgradeInfo>(
  (upgradesData.upgrades as UpgradeInfo[]).map((upgrade) => [upgrade.id, upgrade]),
);
export const upgradeName = (upgradeId: string): string => UPGRADE_INFO.get(upgradeId)?.name ?? upgradeId;
export const upgradeInfo = (upgradeId: string): UpgradeInfo | undefined => UPGRADE_INFO.get(upgradeId);

// STORY-049. The remaining static catalogue lookups the old monolithic `ResultsPanel.tsx`
// (STORY-014) used for its manager's-ledger/turning-points sections — moved here rather than
// re-declared in `RecapNumbers.tsx`/`RecapScorecard.tsx` so this file stays the one place recap
// sections resolve a catalogue id to a display name (same reasoning as `dishName` above).

const EVENT_TITLES = new Map<string, string>(
  (eventsData.events as Array<{ id: string; title: string }>).map((e) => [e.id, e.title]),
);
export const eventTitle = (eventId: string): string => EVENT_TITLES.get(eventId) ?? eventId;

const SPECIAL_NAMES = new Map<string, string>(
  frontDoorData.specials.map((special) => [special.id, special.name]),
);
export const specialName = (specialId: string): string => SPECIAL_NAMES.get(specialId) ?? specialId;

interface KitchenFocus {
  id: string;
  name: string;
  benefit: string;
  downside: string;
}
const KITCHEN_FOCUSES = new Map<string, KitchenFocus>(
  (kitchenCommandData.focuses as KitchenFocus[]).map((focus) => [focus.id, focus]),
);
export const kitchenFocus = (focusId: string): KitchenFocus | undefined => KITCHEN_FOCUSES.get(focusId);

/** §17/manager-ledger constraint vocabulary, in plain language — same map `ResultsPanel.tsx`
 * (pre-STORY-047) declared inline for its "Dominant constraint" line. */
export const CONSTRAINT_LABELS: Record<ManagerConstraintId, string> = {
  demand_conversion: 'Demand conversion',
  seating_service: 'Seating / service capacity',
  production: 'Production capacity',
  inventory: 'Inventory availability',
  prioritization: 'Prioritization',
};
export const constraintLabel = (constraintId: ManagerConstraintId): string => CONSTRAINT_LABELS[constraintId];
