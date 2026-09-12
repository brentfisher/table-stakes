// STORY-047. Static catalogue-name lookups shared across the recap sections — moved out of the
// old monolithic `ResultsPanel.tsx` (STORY-014). `dishesData` is the same public game-data JSON
// `SetupScreen.tsx`/`GameClient.ts` already import client-side (dish NAMES are public catalogue
// content, not a simulation result) — see `ResultsPanel.tsx`'s own header for why only a dish's
// NAME, never a count/margin/score, is allowed to come from anywhere but `match_complete`.

import dishesData from '../../../../shared/game-data/dishes.json';

const DISH_NAMES = new Map<string, string>(
  (dishesData.dishes as Array<{ id: string; name: string }>).map((d) => [d.id, d.name]),
);

export const dishName = (dishId: string): string => DISH_NAMES.get(dishId) ?? dishId;
