---
id: STORY-051
title: Arrange board — reorderable recap sections
status: merged
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: story/051-recap-arrange-board
worktree_path: /Users/brent/table-stakes-worktrees/story-051-recap-arrange-board
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/72
is_architectural: false
approach_summary: >
  Checked the mockup's own screenshots (`08-rearrangeable-board.png`/`09-board-service-and-
  finances.png`): the prototype's arrange mode is a full 2x2 grid showing each category's LIVE
  summary content (net profit, best-seller card, etc.) simultaneously with a drag handle + arrows
  per card. Do NOT build that — this story's own Notes explicitly scope it down to "the section
  container abstraction, not their final content," and AC3 (reordering must never touch a
  section's own internal state, e.g. STORY-050's game-plan `Set`) is trivially guaranteed rather
  than something to carefully verify if arrange-mode cards never mount the real section
  components at all. Build lightweight IDENTITY cards instead (icon-free, just each category's
  `RECAP_CATEGORIES` `label` + a short static one-line description) — arrange mode never touches
  `result`/`gamePlan`/any match data, so there is nothing live to preserve.
  Mechanism: lift a new `categoryOrder: RecapCategory[]` (session `useState`, seeded from
  `RECAP_CATEGORIES.map(c => c.id)`) into `ResultsPanel.tsx`, alongside a boolean `arranging`
  toggle. `RecapCategoryNav.tsx` ALREADY accepts an optional `categories` prop for exactly this
  purpose (its own header comment: "lets STORY-051's... mechanism later pass a REORDERED copy...
  in without touching this component at all") — pass it a `categoryOrder`-mapped array of
  `RecapCategoryDef`s (label lookup from `RECAP_CATEGORIES`) when arranging is active or not;
  either way the active single-category content view (`ResultsPanel`'s existing ternary router)
  is completely unaffected by arrange mode — reordering only permutes which nav tab is FIRST/
  which order they read in, never which category is currently selected/rendered.
  New `client/src/ui/recap/RecapArrangeBoard.tsx`: renders `categoryOrder` as cards with a drag
  handle (native HTML5 `draggable`/`onDragStart`/`onDragOver`/`onDrop` — no existing precedent in
  this codebase, first use, keep it simple: store the dragged index, swap-on-drop per AC1's own
  "swaps the two" wording, not a full-reflow insert) plus move-left/move-right buttons (disabled
  at each boundary) and a "Reset order" control (resets to `RECAP_CATEGORIES`'s own declared
  order — AC2 is explicit this is about the mechanism working, not matching the mockup's literal
  category-name framing). Entry point: a new "Arrange" button in `ResultsPanel.tsx`'s existing
  `.recap-utility-bar` (next to Rematch) toggling `arranging`; "Finish Arranging" (inside
  `RecapArrangeBoard`) toggles it back off. All new state is session-only (component state, reset
  when `ResultsPanel` itself remounts) — same precedent STORY-050 already established.
  No new shared/server module, no wire-schema change, no persistence, no touching of any other
  recap section's props or content — hence `is_architectural: false`. Flag the native drag-and-
  drop path as needing a real manual browser check for the same reason STORY-050's download path
  did (this environment's automated sandbox has known gaps around some native browser
  interactions) — the arrow-button path is the one `npm run check`/manual keyboard testing can
  actually exercise directly.
created: 2026-09-11
updated: 2026-09-12
---

# Arrange board — reorderable recap sections

Lets a player choose which recap category cards appear first, by dragging a handle or using
arrow controls, with a reset back to the default order. Session-only preference — no server
state, no persistence across matches.

Reference: `docs/table-stakes-recap-menu.zip` → `table-stakes-menu-suite/story-screenshots/`
`08-rearrangeable-board.png`, `09-board-service-and-finances.png`; `RECAP-PREVIEW.md`'s "Arrange
board" bullet. See `docs/PRD-recap-screen-redesign.md` for the full slice and its constraints.

## Acceptance Criteria

- [ ] An "Arrange board" mode reveals every recap category as an independent card with a drag
  handle and move-left/move-right (or up/down, matching whatever layout STORY-047 actually
  shipped) arrow buttons. Dragging a handle onto another card's position swaps the two; arrows
  offer the same reordering via keyboard/touch, disabled at whichever end is already boundary
  (first card's "move earlier" arrow, last card's "move later" arrow) — per
  `08-rearrangeable-board.png`'s own cue.
- [ ] "Reset order" restores the default category order (matching STORY-047's own default:
  highlights, next shift, menu stars, numbers, per `09-board-service-and-finances.png`'s stated
  default "dishes, coaching, service, then finances" — reconcile the exact default naming against
  whatever STORY-047/048/049/050 actually shipped, this AC is about the RESET mechanism working,
  not a specific literal order name).
- [ ] Reordering changes card DISPLAY ORDER only — it must not alter any match value, any saved
  game-plan selection (STORY-050), or any other section's own internal state. Per
  `09-board-service-and-finances.png`'s explicit "Swapping changes order without changing match
  values or saved tips" cue — verify this concretely (reorder, then confirm STORY-050's game-plan
  selections and STORY-048's selected-dish state are both unchanged).
- [ ] "Finish Arranging" exits arrange mode and returns to the normal focused single-category
  view, retaining the new order.
- [ ] The chosen order persists for the page session only (no new persistent storage, no server
  field) — matches STORY-050's own session-only precedent.
- [ ] `npm run check` (including `build:client`) stays green.

## Notes

- Depends on STORY-047 (the category-navigation shell and its section-registration pattern —
  this story reorders WHICHEVER sections STORY-047 established, generically, not a hardcoded
  four-item list). Benefits from STORY-048/049/050 having landed first so there's real content to
  verify reordering against, but its own mechanism only needs the section container abstraction,
  not their final content — implementer's call on whether to build/test this against STORY-047's
  placeholder-only sections if the others haven't merged yet.
- Cites: `table-stakes-menu-suite/src/recap.js`'s drag/arrow reordering logic as an
  INTERACTION-PATTERN reference (the general mechanism), not code to port — the real
  implementation is React/TypeScript against React-owned section components, not raw DOM.

## Implementation notes

**Bug caught and fixed before finalizing (a real defect, not just an unverified path):** the
first cut of `RecapArrangeBoard.tsx`'s `onDragStart` never called
`event.dataTransfer.setData(...)`. Chrome and Safari will start a native HTML5 drag anyway, but
Firefox refuses to arm a drag at all unless `dragstart` writes something to the transfer object —
so the whole drag-and-drop path would have silently done nothing in Firefox. Fixed by calling
`event.dataTransfer.setData('text/plain', categoryId)` (the payload itself is unused; the actual
swap reads `draggedIndex` state, not the transfer data — this call exists purely to satisfy the
browser's own gate) and setting `effectAllowed`/`dropEffect` for the correct cursor. Caught via a
second-opinion review, not manual browser testing, since this environment can't reliably exercise
native drag gestures (see the flag below) — but it's a straightforward spec-compliance fix, not
something that needed a browser to diagnose.

**Deliberate deviations from `approach_summary`, and why:**

- **"Drag handle" (AC1's literal wording) is decorative; the whole card is `draggable`.** The `⠿`
  glyph has no `onDragStart` of its own — dragging works from anywhere on the card. This is a
  superset of AC1's requirement (a handle-only drag would also satisfy "dragging a handle onto
  another card's position swaps the two," but whole-card dragging does too, and is more forgiving
  for a first-use-in-this-codebase interaction with no existing precedent to match). Flagging it
  explicitly because a reviewer skimming for "does clicking only the glyph work" would find it
  doesn't — that's expected, not a bug.
- **The "Arrange" button is hidden (not shown-but-disabled) for an unscored/disconnect-ended
  match.** Not called out in the approach_summary. `isUnscored` was extracted from the pre-existing
  inline ternary (previously computed twice, once implicitly per branch) so both the empty-shell
  branch and the new button could share one condition — arrange mode replaces the nav+content pair,
  which that branch never renders, so there's nothing for the button to swap in during an unscored
  match.
- **The hero (outcome heading, mascot, final-score card) stays visible during arrange mode**; only
  the nav+content pair swaps out for `RecapArrangeBoard`. The approach_summary left this as "your
  call" — kept it visible for consistency with the pre-existing behavior that the hero already
  shows on every category tab, rather than tearing down match context the instant arrange mode
  opens.
- **Cards lay out in a responsive `auto-fill` grid**, not a fixed 2x2 like the mockup screenshots.
  These are small identity cards (label + one line), not the mockup's live-content dashboard cards,
  so a rigid 2x2 would leave excess dead space at typical window widths.

**Verification actually performed:** `tsc --noEmit` (via `build:client`) plus the full
`npm run check` (`build:client` + `build:harnesses` + every `check-*.mjs`/`smoke-*.mjs` script) —
all green, twice (once before, once after the drag-and-drop fix). No new `check-*.mjs` script was
added: there is no non-trivial derivation/grouping logic here (`RECAP_CATEGORIES.map`/array swap
is not the kind of logic STORY's other `check:*` scripts exist to protect). AC3 ("reordering must
never alter match values or another section's saved state") was verified by construction/code
trace, not by running the UI and clicking through: `RecapArrangeBoard.tsx` never imports or reads
`MatchResult`, `nextShiftGamePlan`, `nextShiftProminentIndex`, `selfResult`, or `rivalResult`
anywhere in its module — there is no live match state in its render tree for a reorder to
possibly disturb. That is an argument from the code's own import graph, not an observation from
manually reordering cards and then checking STORY-050's game plan afterward in a browser.

**Flag for manual verification (same category of gap STORY-050's download-trigger path
flagged):** the native HTML5 drag-and-drop path (`draggable`/`onDragStart`/`onDragOver`/`onDrop`
in `RecapArrangeBoard.tsx`) has no prior precedent in this codebase and was never exercised in an
actual browser — this environment's automated sandbox has known gaps around some native browser
interaction patterns. Needs a real manual drag-and-drop check across at least Chrome and Firefox
before treating AC1's drag path as fully verified (the Firefox `dataTransfer.setData` fix above
was reasoned from the HTML5 drag-and-drop spec, not confirmed against an actual Firefox drag). The
arrow-button reordering path, by contrast, was reasoned through by full code trace (swap logic,
boundary-disabling conditions) and is straightforward to click-test manually if further assurance
is wanted; it has no equivalent cross-browser API gap the way native drag does.

**Known minor UX rough edge, not fixed:** repeatedly clicking a card's "move earlier" arrow until
it reaches index 0 leaves that arrow `disabled` with no explicit focus management — focus falls
back to `<body>` rather than moving to a still-enabled control (e.g. "move later" on the same
card). Keyboard users can still tab to the next control, but a rapid repeated-click/keyboard-enter
reordering flow stalls at the boundary. Not required by any AC; left as a possible follow-up.
