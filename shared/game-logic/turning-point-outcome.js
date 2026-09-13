// STORY-055 "Fix results-screen outcome mismatch". Pure logic for one specific, REPRODUCED
// disagreement in the results screen (see this story's own KB "Implementation notes" for the
// repro): `computeTurningPoints` (`server/src/game/scoring/narrative.js`) intentionally ranks
// "Key turning points" by SWING MAGNITUDE, not chronologically and not by whether that swing's
// direction is who the match actually ended up favoring — its own header says as much ("the
// largest swings ... ", nothing about "the ones that decided it"). That is the right thing for
// that function to compute; the bug is downstream, in `RecapScorecard.tsx`'s "Key turning
// points" list, which used to render every point's "{You/Your rival} pulled ahead by N parties"
// with no indication that a EARLY/MID-MATCH swing being the single biggest one is completely
// independent of who actually won — a lopsided early swing in the eventual LOSER's favor can
// easily outrank the smaller swings that actually decided the match, and land as the FIRST,
// most prominent bullet in the list, directly under a "You lost" heading. That reads exactly
// like the reported bug ("I lost ... but when you dig in, it says I won").
//
// IMPORTANT CORRECTION (caught before this story shipped, not after): `swing` is a WINDOWED
// DELTA — "who gained more decisions than the other DURING THIS ONE WINDOW"
// (`narrative.js#computeTurningPoints`: `swing = margin - previousMargin`, the CHANGE in
// cumulative margin across the window, not the cumulative margin itself). It is NOT a standing
// lead, and `leaderRestaurantId` is NOT "who was ahead at that point" — it is "who gained ground
// in that window", which a restaurant can do while still being far behind overall. The first
// draft of this fix used "pulled ahead"/"led by" wording, which keeps asserting a standing lead
// that was never computed — see this story's own Implementation notes for the corrected wording
// this module now backs ("won N more parties than ... during/in ...", never "ahead"/"led").
//
// This module computes ONE new fact — whether a given turning point's windowed swing DIRECTION
// favored the side that also went on to win the match — reusing `ResultsPanel.tsx`'s own
// already-authoritative `outcome` (win/loss/draw) rather than re-deriving a winner id here:
// `outcome` and `selfId` are already exactly enough information to answer "did the self
// restaurant end up winning", and `leaderIsSelf` (a point's `leaderRestaurantId === selfId`,
// already computed at the call site the same way `RecapScorecard.tsx`'s existing "You"/"Your
// rival" label is) is enough to answer "did self gain ground in this window". No new
// restaurant-id plumbing, no second outcome derivation — see this story's own Notes for why a
// second, independently-computed win/loss value anywhere on this screen is itself the exact
// failure mode being fixed.
//
// Plain-JS-plus-`.d.ts` shape (Decision 4), same precedent `recap-highlights.js` set: this is a
// two-line boolean, but it is the one thing on this screen that decides whether a turning-point
// bullet needs a "the match still ended the other way" caveat, and `RecapScorecard.tsx` (client
// TypeScript) and `scripts/check-recap-turning-points.mjs` (plain Node) are its only two
// callers, neither of which can import the other's runtime.

/**
 * @param {boolean} leaderIsSelf - whether this turning point's `leaderRestaurantId` is the
 *   viewer's own restaurant (i.e. `point.leaderRestaurantId === selfId`) — who gained ground
 *   during this specific window, NOT who was ahead overall.
 * @param {'win' | 'loss' | 'draw'} outcome - the match's single authoritative outcome from the
 *   viewer's own perspective (`ResultsPanel.tsx`'s `outcome`), never re-derived here.
 * @returns {boolean} true when this window's swing direction favored the side that also went on
 *   to win the match. A draw never "favored the winner" for either side — there was no
 *   winner — so every turning point in a drawn match reports false here, honestly.
 */
export function turningPointFavoredWinner(leaderIsSelf, outcome) {
  if (outcome === 'draw') return false;
  return leaderIsSelf === (outcome === 'win');
}
