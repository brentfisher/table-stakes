// PRD §4.4 / §14 "visual state language" — pure functions that turn an already-published
// snapshot value into one of the four severity bands the six §14 colors express (green healthy,
// yellow attention soon, orange active bottleneck, red critical). Split out the same way
// `hud-alerts.js` and `hud-cash-feedback.js` were for STORY-015 (Decision 4's plain-JS-plus-
// `.d.ts` shape): `client/src/scenes/RestaurantScene.ts` and `scripts/check-visual-state.mjs`
// are its only two callers, and neither can import the other's runtime.
//
// THIS FILE COMPUTES NO GAME STATE. Every input is a value `match_snapshot` already publishes
// (`CustomerSnapshot.patienceRemaining`, a station's queued-ticket count derived from
// `orders[]`); this only classifies it. Notable Pattern 11: rules emit state, views render it —
// a band name IS the view's rendering decision, never a new simulation judgment.
//
// RED IS NEVER A THIRD, INDEPENDENTLY-TUNED CUTOFF. `patienceColorBand`'s critical band starts
// exactly at `UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD` — the same line `CustomerSnapshot.unhappy`
// already crosses server-side and the HUD's "customer abandonment imminent" alert (STORY-015)
// already keys off. Giving the ring its own separate red threshold would let the 3D scene and
// the HUD disagree about whether a given party is critical; reusing the constant makes them
// agree by construction, not by coincidence kept in sync by hand.

/**
 * @param {number} patienceRemaining 0..1, `CustomerSnapshot.patienceRemaining` verbatim.
 * @param {{ attention: number, bottleneck: number, critical: number }} thresholds
 *   `PATIENCE_RING_ATTENTION_THRESHOLD`, `PATIENCE_RING_BOTTLENECK_THRESHOLD` and
 *   `UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD` (as `critical`), from `shared/constants/tuning.js`.
 * @returns {'healthy' | 'attention' | 'bottleneck' | 'critical'}
 */
export function patienceColorBand(patienceRemaining, thresholds) {
  const { attention, bottleneck, critical } = thresholds;
  if (patienceRemaining <= critical) return 'critical';
  if (patienceRemaining <= bottleneck) return 'bottleneck';
  if (patienceRemaining <= attention) return 'attention';
  return 'healthy';
}

/**
 * A station's queue-depth band. `queueDepth` is the count of `queued`, NOT ingredient-blocked
 * tickets at one station — a shortage is a categorically different signal (§8 requires the two
 * to look distinct) and is never fed through this function; see `RestaurantScene`'s own comment
 * on why the shortage icon is a separate glyph at a separate anchor, not a color on this bar.
 *
 * @param {number} queueDepth
 * @param {{ attention: number, bottleneck: number }} thresholds
 *   `STATION_QUEUE_ATTENTION_THRESHOLD` and `HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD` (as
 *   `bottleneck` — the same line `hud-bottleneck-system.js#hasKitchenBacklog` already draws
 *   between ordinary queuing and a kitchen falling behind).
 * @returns {'healthy' | 'attention' | 'bottleneck'}
 */
export function stationQueueColorBand(queueDepth, thresholds) {
  const { attention, bottleneck } = thresholds;
  if (queueDepth > bottleneck) return 'bottleneck';
  if (queueDepth >= attention) return 'attention';
  return 'healthy';
}
