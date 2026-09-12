// STORY-047. Work item 3: an explicit "coming soon" state for the three categories this story
// does not fill in — STORY-048 ('menu-stars'), STORY-049 ('numbers'), STORY-050 ('next-shift')
// each replace their own case here with real content. Deliberately not a silent blank div: a
// player who clicks "The numbers" mid-slice should see a stated placeholder, not wonder whether
// the tab is broken.
//
// STORY-048/049 UPDATE: 'menu-stars' (STORY-048) and 'numbers' (STORY-049) now route to
// `RecapMenuStars.tsx`/`RecapNumbers.tsx` in `ResultsPanel.tsx`'s category router and no longer
// reach this component — both entries in `PLACEHOLDER_COPY` below are kept (not deleted) only
// because `RecapCategory`/`RECAP_CATEGORIES` still include them and this map's type is
// `Record<Exclude<RecapCategory, 'highlights'>, string>`; 'next-shift' is the only one that
// still lands here, until STORY-050 replaces it.

import { RECAP_CATEGORIES, type RecapCategory } from './recap-types';

const PLACEHOLDER_COPY: Record<Exclude<RecapCategory, 'highlights'>, string> = {
  'next-shift': "A coaching game plan you can build from this match's takeaways is coming soon.",
  'menu-stars': 'A larger 3D showcase of every dish you sold is coming soon.',
  numbers: 'A full financial and service breakdown is coming soon.',
};

export function RecapPlaceholder({ category }: { category: Exclude<RecapCategory, 'highlights'> }): JSX.Element {
  const label = RECAP_CATEGORIES.find((c) => c.id === category)?.label ?? category;
  return (
    <div className="recap-placeholder">
      <h2>{label}</h2>
      <p>{PLACEHOLDER_COPY[category]}</p>
    </div>
  );
}
