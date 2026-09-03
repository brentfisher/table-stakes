/**
 * Pure narrative-derivation math for STORY-014 (PRD §11 results-screen narrative layer, and the
 * PRD §21 Milestone 4 bar: "most players understand why they lost").
 *
 * Same discipline as ../scoring/score-formula.js: this module takes NO dependency on live match
 * state and does NOT import shared/constants/tuning.js. Every number it needs arrives as a plain
 * object/array parameter, which is what keeps it independently unit-testable and keeps
 * scoring-system.js's own job entirely translation (match state -> these plain-object inputs ->
 * `MatchResult`/`MatchCompleteMessage` fields).
 *
 * Everything here is computed ONCE, retroactively, at the `results` transition, from data other
 * systems already accumulated incrementally during the match:
 *   - customer-system.js's `district.segmentCounts` / `district.lostByReason` (districtSummary)
 *   - customer-system.js's `match.districtDecisions` (the §17 step-6 per-party decision log,
 *     never cleared — it outlives the simulation state that produced it precisely so this story
 *     can read it)
 *   - order-system.js's per-dish fulfillment tally (see order-system.js's `dishFulfillment`)
 *   - event-system.js's `match.eventTimeline` (already anchored to the match clock)
 *
 * Nothing here ticks, samples, or owns any state of its own — there is no STORY-014 equivalent
 * of a per-tick sampler. `scoring-system.js` still owns no live simulation state (see that
 * file's own header comment); it just reads more of what already exists, once, at the end.
 */

/**
 * Convert one event timeline's entries into absolute [startMs, endMs) windows, anchored to the
 * match clock the same way `scoring-system.js#countCriticFailures` already does. Returns []
 * when the timeline never anchored (no event system registered, or service never began, both of
 * which several `check-*.mjs` scripts deliberately exercise) — the honest "no events happened"
 * answer, never a guess.
 *
 * @param {Array<{ eventId: string, activateAtMs: number, endAtMs: number }>} entries
 * @param {number | null | undefined} anchorMs
 * @returns {Array<{ eventId: string, startMs: number, endMs: number }>}
 */
export function toEventWindows(entries, anchorMs) {
  if (anchorMs === null || anchorMs === undefined || !Array.isArray(entries)) return [];
  return entries.map((entry) => ({
    eventId: entry.eventId,
    startMs: anchorMs + entry.activateAtMs,
    endMs: anchorMs + entry.endAtMs,
  }));
}

/**
 * The eventId active at `atMs`, or null when no event window covers that instant. When more
 * than one event overlaps (PRD §9 permits concurrent low/high-impact stacking), the first match
 * in schedule order wins — good enough for a narrative attribution, not a scoring input.
 *
 * @param {Array<{ eventId: string, startMs: number, endMs: number }>} eventWindows
 * @param {number} atMs
 * @returns {string | null}
 */
export function eventAt(eventWindows, atMs) {
  const hit = (eventWindows ?? []).find((w) => atMs >= w.startMs && atMs < w.endMs);
  return hit ? hit.eventId : null;
}

/**
 * PRD §11 "Customer-segment breakdown" turned into "the segment that decided the match" — the
 * PRD's own worked example ("You won the lunch rush by serving 18 more office-worker parties").
 * The segment id with the largest served-count DIFFERENCE between the two restaurants, and
 * which restaurant led it. Null when the district served nobody, or every segment tied exactly
 * (a real possibility with two identical menus and prices) — the honest "nothing decided this"
 * answer rather than a fabricated pick among ties, per Notable Pattern 9.
 *
 * @param {Record<string, Record<string, number>>} segmentCountsByRestaurant - restaurantId -> segmentId -> served count
 * @param {[string, string]} restaurantIds - exactly 2
 * @returns {{ segmentId: string, leaderRestaurantId: string, servedDifferential: number } | null}
 */
export function pickDecidingSegment(segmentCountsByRestaurant, restaurantIds) {
  const [aId, bId] = restaurantIds;
  const a = segmentCountsByRestaurant[aId] ?? {};
  const b = segmentCountsByRestaurant[bId] ?? {};
  const segmentIds = new Set([...Object.keys(a), ...Object.keys(b)]);

  let bestSegmentId = null;
  let bestMargin = 0;
  let bestLeaderId = null;
  for (const segmentId of segmentIds) {
    const diff = (a[segmentId] ?? 0) - (b[segmentId] ?? 0);
    if (Math.abs(diff) > bestMargin) {
      bestMargin = Math.abs(diff);
      bestSegmentId = segmentId;
      bestLeaderId = diff > 0 ? aId : bId;
    }
  }
  if (bestSegmentId === null) return null;
  return { segmentId: bestSegmentId, leaderRestaurantId: bestLeaderId, servedDifferential: bestMargin };
}

/**
 * PRD §11 results narrative: "the player's best-performing dish by fulfillment time". The dish
 * this restaurant sold at least one of, with the LOWEST average time from order placement to
 * that dish coming off the line — see order-system.js's `dishFulfillment` for how the average is
 * built. Scans the FULL per-dish list, not just the top-5 `bestSellingDishes`/
 * `highestMarginDishes` slices: the fastest dish need not be a best-seller. Null when nothing
 * sold — no dish to praise.
 *
 * @param {Array<{ dishId: string, count: number, avgFulfillmentMs: number | null }>} dishFulfillment -
 *   `avgFulfillmentMs` is null for an entry with sales but no timing sample; see the field
 *   comment on order-system.js's own `dishFulfillment` for why that must never read as 0.
 * @returns {{ dishId: string, count: number, avgFulfillmentMs: number } | null}
 */
export function pickBestDish(dishFulfillment) {
  let best = null;
  for (const entry of dishFulfillment) {
    // `avgFulfillmentMs === null` means "sold, but no real fulfillment comparison exists for
    // it" — skipped rather than treated as an unbeatable 0ms, per Notable Pattern 9.
    if (entry.count <= 0 || entry.avgFulfillmentMs === null || entry.avgFulfillmentMs === undefined) continue;
    if (best === null || entry.avgFulfillmentMs < best.avgFulfillmentMs) best = entry;
  }
  return best ? { dishId: best.dishId, count: best.count, avgFulfillmentMs: best.avgFulfillmentMs } : null;
}

/**
 * PRD §11 results narrative: "the rival's largest single loss cause, tied to the event that
 * caused it" — the PRD's own worked example ("your rival lost 11 customers to queue abandonment
 * after the transit-delay event"). `lostByReason` (customer-system.js's `districtSummary`)
 * already tallies §17 decision reasons against the restaurant that lost the party; this picks
 * the largest bucket, then asks which event was active for a MAJORITY of that bucket's own
 * occurrences (from `decisions`, the exact per-party log the bucket was tallied from) —
 * majority, not "any overlap": a handful of coincidental timestamps under an unrelated event
 * must not fabricate a causal story the way `scoring-system.js#countCriticFailures`'s looser
 * "any overlap" test would be wrong to use here.
 *
 * @param {Record<string, number>} lostByReason - reason -> count, THIS restaurant's own (the one that lost parties)
 * @param {Array<{ atMs: number, chosenRestaurantId: string | null, reason: string | null }>} decisions - full district decision log
 * @param {string} restaurantId - the restaurant this loss cause is FOR
 * @param {Array<{ eventId: string, startMs: number, endMs: number }>} eventWindows
 * @returns {{ reason: string, count: number, eventId: string | null } | null}
 */
export function pickLargestLossCause(lostByReason, decisions, restaurantId, eventWindows) {
  let bestReason = null;
  let bestCount = 0;
  for (const [reason, count] of Object.entries(lostByReason)) {
    if (count > bestCount) {
      bestCount = count;
      bestReason = reason;
    }
  }
  if (bestReason === null) return null;

  const matching = decisions.filter(
    (d) => d.reason === bestReason && d.chosenRestaurantId !== null && d.chosenRestaurantId !== restaurantId,
  );

  const eventCounts = new Map();
  for (const d of matching) {
    const eventId = eventAt(eventWindows, d.atMs);
    if (eventId === null) continue;
    eventCounts.set(eventId, (eventCounts.get(eventId) ?? 0) + 1);
  }
  let taggedEventId = null;
  let taggedCount = 0;
  for (const [eventId, count] of eventCounts) {
    if (count > taggedCount) {
      taggedCount = count;
      taggedEventId = eventId;
    }
  }
  const eventId = matching.length > 0 && taggedCount * 2 > matching.length ? taggedEventId : null;

  return { reason: bestReason, count: bestCount, eventId };
}

/**
 * PRD §11 "Key turning points": the largest swings in cumulative party-acquisition margin
 * between the two restaurants, each tied to the event window (or, absent an event, the
 * service/final_rush phase) during which it happened.
 *
 * The margin is a step function of DECISION COUNT (which restaurant a party picked at each
 * `district.decisions` entry), not revenue or the full composite score — the story's own design
 * note explicitly sanctions a simpler, honestly-available proxy over recomputing
 * `computeCompositeScore` at every instant, which nothing has ever sampled live. Reconstructed
 * retroactively; no live per-tick sampler (see this module's own header).
 *
 * Boundaries are drawn at every event window's start/end plus the first and last decision's own
 * timestamp, so every measured window is either entirely inside one event or entirely in a gap
 * — `eventAt`, sampled at each window's midpoint, is therefore unambiguous.
 *
 * @param {Array<{ atMs: number, chosenRestaurantId: string | null }>} decisions - district decision log
 * @param {[string, string]} restaurantIds - exactly 2, [a, b]
 * @param {Array<{ eventId: string, startMs: number, endMs: number }>} eventWindows
 * @param {number | null} finalRushStartMs - absolute elapsedMs `final_rush` began, or null if unknown
 * @param {number} maxPoints
 * @returns {Array<{ atMs: number, eventId: string | null, phase: 'service' | 'final_rush' | null, leaderRestaurantId: string, swing: number }>}
 */
export function computeTurningPoints(decisions, restaurantIds, eventWindows, finalRushStartMs, maxPoints) {
  const [aId, bId] = restaurantIds;
  const chosen = decisions
    .filter((d) => d.chosenRestaurantId === aId || d.chosenRestaurantId === bId)
    .slice()
    .sort((x, y) => x.atMs - y.atMs);
  if (chosen.length === 0) return [];

  const firstMs = chosen[0].atMs;
  const lastMs = chosen[chosen.length - 1].atMs;
  const edges = new Set([firstMs, lastMs]);
  for (const w of eventWindows) {
    if (w.startMs > firstMs && w.startMs < lastMs) edges.add(w.startMs);
    if (w.endMs > firstMs && w.endMs < lastMs) edges.add(w.endMs);
  }
  const sortedEdges = [...edges].sort((x, y) => x - y);
  if (sortedEdges.length < 2) return [];

  let cursor = 0;
  let runningA = 0;
  let runningB = 0;
  const marginAt = (ms) => {
    while (cursor < chosen.length && chosen[cursor].atMs <= ms) {
      if (chosen[cursor].chosenRestaurantId === aId) runningA += 1;
      else runningB += 1;
      cursor += 1;
    }
    return runningA - runningB;
  };

  const points = [];
  let previousMargin = marginAt(sortedEdges[0]);
  for (let i = 1; i < sortedEdges.length; i += 1) {
    const startMs = sortedEdges[i - 1];
    const endMs = sortedEdges[i];
    const margin = marginAt(endMs);
    const swing = margin - previousMargin;
    if (swing !== 0) {
      const midMs = (startMs + endMs) / 2;
      const eventId = eventAt(eventWindows, midMs);
      const phase = finalRushStartMs === null ? null : midMs >= finalRushStartMs ? 'final_rush' : 'service';
      points.push({
        atMs: endMs,
        eventId,
        phase,
        leaderRestaurantId: swing > 0 ? aId : bId,
        swing: Math.abs(swing),
      });
    }
    previousMargin = margin;
  }

  return points.sort((x, y) => y.swing - x.swing).slice(0, maxPoints);
}
