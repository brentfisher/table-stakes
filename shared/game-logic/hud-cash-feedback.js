// PRD §14 "Floating cash/tip feedback only for major moments, not every transaction". A pure
// decision, split out the same way `hud-alerts.js` is (Decision 4's plain-JS-plus-`.d.ts` shape,
// under `shared/` because `GameClient.ts` and `scripts/check-hud.mjs` are its only two callers
// and neither can import the other's runtime) — small enough to live in its own file rather than
// crowd `hud-alerts.js`'s "ranked critical alerts" concern with an unrelated one.
//
// THE ONE SUBTLETY: the guard against firing on the FIRST real value. `you.revenue` goes from
// `null` (before `service`) to whatever it already is the moment `match.kitchen` exists — reading
// THAT jump as a "moment" would report the viewer's entire early revenue as one payment. Only a
// genuine number-to-number increase counts.
//
// `HUD_CASH_FEEDBACK_MIN_DELTA` itself (`shared/constants/tuning.js`) carries the measured
// number this rule needs to actually satisfy "not every transaction" — see that constant's own
// comment for the organic-match measurement behind it.

/**
 * @param {number | null} previousRevenue
 * @param {number | null} nextRevenue
 * @param {number} minDelta
 * @returns {{ amount: number } | null}
 */
export function cashFeedbackFor(previousRevenue, nextRevenue, minDelta) {
  if (typeof previousRevenue !== 'number' || typeof nextRevenue !== 'number') return null;
  const delta = nextRevenue - previousRevenue;
  if (delta < minDelta) return null;
  return { amount: delta };
}
