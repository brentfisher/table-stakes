---
id: STORY-051
title: Arrange board — reorderable recap sections
status: pending
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: null
approach_summary: null
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
