// STORY-047 "Recap shell and opening highlights". Shared shape for the category-navigation
// mechanism every later recap story (STORY-048/049/050) fills a section within, and STORY-051
// (arrange board) reorders. Kept in its own file, not inline in `ResultsPanel.tsx`, because it
// is the one contract those four other stories all depend on — see this story's own KB notes.

/**
 * The four recap categories, per `RECAP-PREVIEW.md`'s own list. This story gives only
 * `'highlights'` real content; the other three render `RecapPlaceholder` until STORY-048
 * (`'menu-stars'`), STORY-049 (`'numbers'`), and STORY-050 (`'next-shift'`) replace them. A
 * union, not a highlights-only special case, so adding a category later never means widening
 * this type from a boolean/enum-of-one — it already holds all four.
 */
export type RecapCategory = 'highlights' | 'next-shift' | 'menu-stars' | 'numbers';

export interface RecapCategoryDef {
  id: RecapCategory;
  /** The nav tab's own label — `RECAP-PREVIEW.md`'s own category names ("The highlights",
   * "Next shift", "Menu stars", "The numbers"), not a paraphrase. */
  label: string;
}

/**
 * The nav's DEFAULT order, as a plain array rather than four hard-coded JSX buttons — this is
 * exactly what STORY-051's "drag category handles to swap panels" mechanism needs to permute
 * (its own arrange-board state holds a reordered copy of this same shape, not a rewritten nav).
 */
export const RECAP_CATEGORIES: readonly RecapCategoryDef[] = [
  { id: 'highlights', label: 'The highlights' },
  { id: 'next-shift', label: 'Next shift' },
  { id: 'menu-stars', label: 'Menu stars' },
  { id: 'numbers', label: 'The numbers' },
];

/** Win/loss/draw, reusing `ResultsPanel.tsx`'s own pre-existing outcome ternary (never moved
 * into `shared/game-logic/` — it is a two-branch comparison against already-resolved IDs, not a
 * grouping algorithm like `bestSellerSpotlight`, so extracting it would only manufacture a
 * second runtime consumer to justify the move). `RecapMascot` reads this to pick a face. */
export type RecapOutcome = 'win' | 'loss' | 'draw';
