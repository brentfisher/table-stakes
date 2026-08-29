// The one place the game-data catalogue is loaded, and the one place it can fail.
//
// STORY-002 shipped shared/game-data/loader.js but nothing imported it, so a malformed
// catalogue was still a runtime surprise. This module closes that: it is imported (directly
// or transitively) by server/src/index.js, so `loadCatalogue()` runs during module evaluation
// at boot. A CatalogueError thrown here aborts the process with a non-zero exit before the
// HTTP listener opens — design Decision 9's "fails loudly at startup", made real.
//
// Node-only, per Decision 10: the loader uses readFileSync and must never reach the browser.

import { loadCatalogue } from '../../../shared/game-data/loader.js';

let loaded;
try {
  loaded = loadCatalogue();
} catch (err) {
  console.error('[boot] refusing to start: shared/game-data is not a valid catalogue.');
  console.error(err.message);
  throw err;
}

/** The validated, indexed catalogue. Frozen indexes come from the loader. */
export const catalogue = loaded;

console.log(
  `[boot] catalogue ok: ${catalogue.dishes.length} dishes, ${catalogue.markets.length} markets, ` +
    `${catalogue.segments.length} segments, ${catalogue.events.length} events, ` +
    `${catalogue.upgrades.length} upgrades`,
);

/**
 * The public projection of a market — PRD §12 room-flow step 5, "Both clients receive
 * identical public market data". Every field a player is allowed to read while deciding a
 * strategy, and nothing else.
 *
 * `eventPool` is withheld deliberately: it is the draw pile STORY-011's seeded event deck
 * reads from, and publishing it hands both players the event timeline before service starts.
 * PRD §5 does want the market reveal to show "district, customer segments, nearby businesses,
 * initial forecast", which is what the fields below are.
 */
export function publicMarket(market) {
  if (!market) return null;
  return {
    id: market.id,
    name: market.name,
    daypart: market.daypart,
    description: market.description,
    segmentWeights: { ...market.segmentWeights },
    priceSensitivity: market.priceSensitivity,
    baseFootTrafficPerMinute: market.baseFootTrafficPerMinute,
    preferredTags: [...market.preferredTags],
  };
}
