---
id: STORY-051
title: Arrange board — reorderable recap sections
status: pending
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: null
worktree_path: null
base_branch: null
pr_url: null
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
updated: 2026-09-11
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
