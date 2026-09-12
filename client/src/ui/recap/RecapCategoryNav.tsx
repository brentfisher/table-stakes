// STORY-047 AC1: the category-navigation bar. Rendered from `RECAP_CATEGORIES` (an ordered
// array, not four hard-coded buttons) so STORY-051's "drag category handles to swap panels" can
// later pass a REORDERED copy of that same array in without touching this component at all.

import { RECAP_CATEGORIES, type RecapCategory } from './recap-types';

export interface RecapCategoryNavProps {
  active: RecapCategory;
  onSelect: (category: RecapCategory) => void;
  /** Defaults to `RECAP_CATEGORIES`'s own declared order — accepting it as a prop (rather than
   * importing the constant directly in the render below) is what lets STORY-051 hand this
   * component a rearranged order later without editing it. */
  categories?: readonly { id: RecapCategory; label: string }[];
}

export function RecapCategoryNav({ active, onSelect, categories = RECAP_CATEGORIES }: RecapCategoryNavProps): JSX.Element {
  return (
    <nav className="recap-nav" aria-label="Recap categories">
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          className={`recap-nav-tab${category.id === active ? ' recap-nav-tab--active' : ''}`}
          aria-current={category.id === active ? 'true' : undefined}
          onClick={() => onSelect(category.id)}
        >
          {category.label}
        </button>
      ))}
    </nav>
  );
}
