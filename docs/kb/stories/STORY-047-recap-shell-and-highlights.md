---
id: STORY-047
title: Recap shell and opening highlights
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

# Recap shell and opening highlights

The current results screen (`client/src/ui/ResultsPanel.tsx`, STORY-014) is one long, flat scroll
of tables. This story replaces its outer shell with a small, categorized structure — a category
navigation bar and a card-based "opening highlights" section — establishing the foundation every
other recap story (STORY-048 through STORY-052) builds a section within or hooks into. Every
number shown still comes from `status.matchComplete`, unchanged in meaning, only restructured.

Reference: `docs/table-stakes-recap-menu.zip` → `table-stakes-menu-suite/story-screenshots/`
`01-loss-highlights.png` and `02-win-highlights.png`; `RECAP-PREVIEW.md`'s "The highlights"
section. See `docs/PRD-recap-screen-redesign.md` for the full slice and its constraints —
especially: every number stays sourced from `match_complete` verbatim, no feature flag, co-op
matches (`hasRival === false`) must degrade honestly, and motion must be gateable by a single
shared convention for STORY-052 to hook into later.

## Acceptance Criteria

- [ ] A category navigation bar (at minimum "The highlights," reserving space/routing for
  "Next shift," "Menu stars," "The numbers" — STORY-048/049/050 fill those in) replaces the
  current single-scroll layout. Switching category shows/hides sections; this story only needs
  "The highlights" to have real content, but the navigation mechanism itself must be built to
  hold all four from the start (a `type RecapCategory = 'highlights' | 'next-shift' |
  'menu-stars' | 'numbers'` union, or similar, not a highlights-only special case later stories
  have to retrofit).
- [ ] Opening highlights show: the outcome heading (win/loss/draw, reusing
  `complete.winnerPlayerId`/the existing outcome logic in `ResultsPanel.tsx`), the final score
  comparison (`selfResult.score` vs `rivalResult.score` when `hasRival`), the best-selling dish
  as a large featured card (`result.bestSellingDishes[0]`, with a **co-best-seller label when
  tied** — `.count` equality against the next entry, per `RECAP-PREVIEW.md`'s own "Caesar Salad
  and Smash Burger both sold six... labeled a co-best seller" example), smaller supporting-dish
  cards for the rest of `bestSellingDishes`, and the single lead management takeaway
  (`result.managerLedger.insights[0]`, if any — `dominantConstraint`-driven, matching
  `ResultsPanel.tsx`'s existing "What to change next match" section's own data source).
- [ ] A mascot/reaction element communicates outcome at a glance (win/loss/draw states) — the
  prototype uses a bespoke 3D "tomato chef" model built from Three.js primitives
  (`table-stakes-menu-suite/src/recap-scene.js`'s `createMascot`, NOT a GLB asset — confirm this
  yourself by reading that file before assuming an asset needs porting). Building an equivalent
  is this story's own call: a simple procedural Three.js model (mirroring that file's approach),
  a 2D/CSS treatment, or reusing an existing in-repo visual primitive are all acceptable — the AC
  is "communicates win/loss/draw at a glance," not "matches the mockup's exact character design."
- [ ] A co-op match (`hasRival === false`, per `ResultsPanel.tsx`'s existing check) shows
  highlights without any rival-comparison element — no rival score, no rival column — exactly
  as today's `ResultsPanel.tsx` already degrades, not a new co-op-specific bug.
- [ ] `npm run check` (including `build:client`) stays green.

## Notes

- Foundation story — no hard dependency on anything unmerged; can be kicked off immediately.
- Cites: `client/src/ui/ResultsPanel.tsx`'s own file header ("EVERY NUMBER HERE COMES FROM
  `match_complete`, VERBATIM") — this discipline is PRESERVED, not relaxed, by the redesign.
- Cites: `client/src/scenes/ResultsScene.ts` — the existing dim ambient 3D backdrop behind the
  results overlay; decide whether the new mascot lives in this same scene/canvas or is a separate
  small canvas (the prototype uses a second, small scissored-viewport canvas per
  `table-stakes-menu-suite/src/scene.js`'s pattern) — implementer's call, document which.
- This story's category-navigation mechanism is the ONE piece every other recap story depends on
  — get its shape (category enum, section-registration pattern) right, since retrofitting it
  after STORY-048/049/050 exist would touch all of them.
