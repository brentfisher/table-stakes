// PRD §4.4 / §14 "visual state language" — THE ONE SOURCE OF TRUTH for the six state colors.
// Every 3D indicator STORY-016 adds (patience ring, table badge, station queue/shortage,
// worker needs-help glow, food-ready icon, event effect, rival activity) imports its color from
// here rather than hardcoding a hex value locally — that is this story's own AC #1.
//
// The CUTOFFS that decide which band a value falls into (patience fraction, queue depth) are a
// simulation-adjacent concern and live in `shared/constants/tuning.js` +
// `shared/game-logic/state-color-bands.js` (importable by the server-side check script); these
// hex values are a pure rendering concern and have no reason to be reachable from Node, so they
// stay client-side, alongside `RestaurantScene.ts`'s existing `ZONE_COLORS`/`STATION_COLORS`.
// `harnesses/tsconfig.json` includes `client/src/game`, so harnesses import this module the same
// way `scene-primitives.ts` already re-exports `RestaurantScene`/`CameraController` from here.

import type { StateColorBand, StationQueueColorBand } from '../../../shared/game-logic/state-color-bands';

/** PRD §14's six-color vocabulary, verbatim. */
export const STATE_COLORS = {
  /** Green — healthy. */
  healthy: 0x4fd15a,
  /** Yellow — attention soon. */
  attention: 0xe0c02f,
  /** Orange — active bottleneck. */
  bottleneck: 0xe0812f,
  /** Red — critical. */
  critical: 0xe0402f,
  /** Blue — customer/event opportunity. */
  opportunity: 0x4a90d9,
  /** Purple — premium/high-value. */
  premium: 0xa855d9,
} as const;

/** `patienceColorBand`/`stationQueueColorBand`'s band name straight to a §14 hex — the one
 * lookup every indicator that already computed a band name uses to finish the job. A station's
 * queue never reaches "critical" (see `state-color-bands.js`'s own comment on why a shortage is
 * a separate glyph, not a queue-bar color), so this map covers `StationQueueColorBand` too. */
export function colorForBand(band: StateColorBand | StationQueueColorBand): number {
  return STATE_COLORS[band];
}

/** §14 MVP entity table: "color-coded workers" — a per-ROLE identity color, distinct in kind
 * from the six operational-state colors above (a role never changes mid-match; a state does).
 * Reusing a state color here would make a cook's cap read as, say, a permanent "critical" glow,
 * which is not what it means. */
export const WORKER_ROLE_COLORS: Record<string, number> = {
  cook: 0xd97a3a,
  server: 0x3ab0d9,
  prep_worker: 0x8fa33a,
  host: 0xb08a5e,
};

/** Fallback for a role this map has not been told about (WORKER_ROLES may grow). Neutral gray,
 * never one of the six state colors — an unrecognized role is not itself a state signal. */
export const WORKER_ROLE_COLOR_FALLBACK = 0x8a8f96;

/**
 * §14 MVP entity table: "segment-cued customers". A per-SEGMENT identity tint on the customer's
 * own body — distinct in kind from the patience ring beneath them (a segment is fixed for the
 * party's whole visit; patience depletes). Two independent visual channels on one entity, the
 * same split `upsertWorker` already makes between its role-colored body and its state-colored
 * task/needsHelp glyph. Ids come from `shared/game-data/customer-segments.json`.
 */
export const CUSTOMER_SEGMENT_COLORS: Record<string, number> = {
  office_worker: 0x7c8a99,
  affluent_couple: 0xc9a15a,
  event_fan: 0xd9574a,
  tourist: 0x5ac9a0,
  neighborhood_regular: 0xb08a5e,
};

/** Fallback for a segment id this map has not been told about (the catalogue may grow). Neutral
 * tan, matching the body color STORY-016 shipped with before segment cueing existed. */
export const CUSTOMER_SEGMENT_COLOR_FALLBACK = 0xd7c9b0;
