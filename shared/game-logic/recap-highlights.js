// STORY-047 "Recap shell and opening highlights". Pure tie-detection for the recap's "opening
// highlights" best-seller spotlight — split out the same way `state-color-bands.js`/
// `manager-ledger.js` were (Decision 4's plain-JS-plus-`.d.ts` shape): `RecapHighlights.tsx`
// (client TypeScript) and `scripts/check-recap-highlights.mjs` (plain Node) are its only two
// callers, and neither can import the other's runtime.
//
// THIS FILE COMPUTES NO NEW NUMBER. `MatchResult.bestSellingDishes` is already server-ranked
// descending by `.count` (`order-system.js`'s own `bestSellingDishes` sort) — the PRD's own
// framing is that tie detection is "`.count` equality already IS the tie condition — nothing
// new to compute, just render." This module is that one piece of grouping logic, extracted so
// it has a name and a check script rather than living inline in JSX.

/**
 * @param {Array<{dishId: string, count: number, revenue: number}>} bestSellingDishes
 *   `MatchResult.bestSellingDishes`, verbatim — already sorted descending by `count`.
 * @returns {{
 *   featured: {dishId: string, count: number, revenue: number},
 *   tiedWith: Array<{dishId: string, count: number, revenue: number}>,
 *   supporting: Array<{dishId: string, count: number, revenue: number}>,
 * } | null}
 *   `null` when nothing sold. `tiedWith` is every OTHER dish sharing `featured.count` — empty
 *   when `featured` outright led. Because the input is already sorted descending, a dish later
 *   in `supporting` can only equal `featured.count`, never exceed it, so a plain equality
 *   filter is the whole algorithm — a three-way tie (`entry[2].count === entry[1].count ===
 *   entry[0].count`) is caught by the same filter as a two-way one. `supporting` is every dish
 *   after `featured`, in the server's own order, whether or not it is part of the tie — the
 *   caller (`RecapHighlights.tsx`) labels each supporting card individually.
 */
export function bestSellerSpotlight(bestSellingDishes) {
  if (bestSellingDishes.length === 0) return null;
  const [featured, ...supporting] = bestSellingDishes;
  const tiedWith = supporting.filter((dish) => dish.count === featured.count);
  return { featured, tiedWith, supporting };
}
