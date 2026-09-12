// STORY-051 "Arrange board — reorderable recap sections". The dedicated full-view mode
// `ResultsPanel.tsx` swaps in for `RecapCategoryNav` + `.recap-content` while its `arranging`
// flag is true — AC4 frames "Finish Arranging" as returning to "the normal focused
// single-category view", which reads as arrange mode being a distinct screen, not an overlay on
// top of the live section content, so this component owns its own full layout rather than
// wrapping the nav/content pair.
//
// IDENTITY CARDS, NOT LIVE CONTENT (see this story's own `approach_summary` in its KB frontmatter
// for the full reasoning): the design mockups (`08-rearrangeable-board.png`/
// `09-board-service-and-finances.png`) this story is sourced from show each card rendering real
// match data — net profit, best-seller dish, etc. — simultaneously, effectively a second
// dashboard of the same numbers `RecapNumbers.tsx`/`RecapMenuStars.tsx` already show one at a
// time. This story's own Notes explicitly scope that down to "the section container abstraction,
// not their final content": these cards show only a category's own static label plus a one-line
// description of what that tab holds, never a `MatchResult` field. That is also what makes AC3
// (reordering must never touch match values or another section's own saved state) trivially true
// rather than something to carefully re-verify here — there is no live section state anywhere in
// this component's render tree to accidentally disturb.

import { useState } from 'react';
import { RECAP_CATEGORIES, type RecapCategory } from './recap-types';

/** A short, static description of what each category's tab holds — never a live `MatchResult`
 * field (see this file's own header). Independent of `RecapPlaceholder.tsx`'s `PLACEHOLDER_COPY`,
 * which describes content that ISN'T built yet; every category here already has real content as
 * of STORY-050, so this describes what the tab actually shows today. */
const CATEGORY_BLURBS: Record<RecapCategory, string> = {
  highlights: 'The opening score comparison and the single takeaway that mattered most.',
  'menu-stars': 'A showcase of the dishes that carried, or cost, your service.',
  numbers: 'The full financial and service breakdown, compared against your rival.',
  'next-shift': 'A browsable, exportable coaching game plan built from this match.',
};

export interface RecapArrangeBoardProps {
  categoryOrder: RecapCategory[];
  onChangeOrder: (next: RecapCategory[]) => void;
  onFinish: () => void;
}

export function RecapArrangeBoard({ categoryOrder, onChangeOrder, onFinish }: RecapArrangeBoardProps): JSX.Element {
  // Which card is mid-drag, tracked by its CURRENT position in `categoryOrder` (not its category
  // id) — the drop handler below only ever needs two positions to swap. Cleared on both drop and
  // drag-end: the latter covers a drag cancelled or dropped outside any card (Escape, or letting
  // go outside the window), without which a stale index could silently swap on a later, unrelated
  // drag.
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // AC1's own wording: dragging (or an arrow) "swaps the two" positions — a two-element swap, not
  // a full-list splice/insert reflow, so every OTHER card's position stays put when two cards
  // trade places.
  const swap = (a: number, b: number) => {
    if (a === b) return;
    const next = categoryOrder.slice();
    [next[a], next[b]] = [next[b], next[a]];
    onChangeOrder(next);
  };

  const handleDrop = (dropIndex: number) => {
    if (draggedIndex !== null) swap(draggedIndex, dropIndex);
    setDraggedIndex(null);
  };

  // AC2: reset goes back to `RECAP_CATEGORIES`'s own declared order, not a second hardcoded
  // literal list — the exact same array `ResultsPanel.tsx` seeds `categoryOrder` from initially,
  // so "reset" and "the order a fresh results screen starts in" can never drift apart.
  const resetOrder = () => onChangeOrder(RECAP_CATEGORIES.map((category) => category.id));

  return (
    <div className="recap-arrange-board">
      <div className="recap-arrange-board-header">
        <h2>Arrange your recap</h2>
        <p className="recap-muted">Drag a card, or use the arrows, to change which tab shows first.</p>
      </div>

      <div className="recap-arrange-cards">
        {categoryOrder.map((categoryId, index) => {
          const def = RECAP_CATEGORIES.find((category) => category.id === categoryId);
          // Defensive only: `categoryOrder` is always a permutation of `RECAP_CATEGORIES`'s own
          // ids — seeded from it in `ResultsPanel.tsx`, only ever reordered by `swap` above, never
          // appended to or spliced from — so this `find` cannot actually miss. The `?? categoryId`
          // fallback beats silently rendering `undefined` if that invariant is ever broken later.
          const label = def?.label ?? categoryId;
          return (
            <div
              key={categoryId}
              className={`recap-arrange-card${draggedIndex === index ? ' recap-arrange-card--dragging' : ''}`}
              draggable
              onDragStart={(event) => {
                // Firefox refuses to start a drag at all unless `dragstart` writes something to
                // the transfer object — Chrome/Safari don't enforce this, which is how this went
                // unnoticed until review. The payload itself is unused (the swap below reads
                // `draggedIndex`, not the transfer data); this call exists purely to arm the drag.
                event.dataTransfer.setData('text/plain', categoryId);
                event.dataTransfer.effectAllowed = 'move';
                setDraggedIndex(index);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                handleDrop(index);
              }}
              onDragEnd={() => setDraggedIndex(null)}
            >
              {/* Decorative, not the actual drag origin — `draggable` is on the whole card above
                  (a deliberate deviation from AC1's literal "drag handle" wording, see this
                  story's KB Implementation notes), so dragging works from anywhere on the card,
                  not just this glyph. The arrows are the accessible equivalent AC1 itself names
                  ("arrows offer the same reordering via keyboard/touch"), so this glyph needs no
                  label of its own. */}
              <div className="recap-arrange-card-handle" aria-hidden="true">
                ⠿
              </div>
              <div className="recap-arrange-card-body">
                <h3>{label}</h3>
                <p>{CATEGORY_BLURBS[categoryId]}</p>
              </div>
              <div className="recap-arrange-card-arrows">
                <button
                  type="button"
                  className="recap-arrange-arrow"
                  disabled={index === 0}
                  aria-label={`Move ${label} earlier`}
                  onClick={() => swap(index, index - 1)}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="recap-arrange-arrow"
                  disabled={index === categoryOrder.length - 1}
                  aria-label={`Move ${label} later`}
                  onClick={() => swap(index, index + 1)}
                >
                  ›
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="recap-arrange-board-footer">
        <button type="button" className="recap-arrange-reset" onClick={resetOrder}>
          Reset order
        </button>
        <button type="button" className="recap-arrange-finish" onClick={onFinish}>
          Finish Arranging
        </button>
      </div>
    </div>
  );
}
