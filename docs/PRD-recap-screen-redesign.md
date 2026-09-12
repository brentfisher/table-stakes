# PRD — Recap screen redesign

## Source

A standalone design/prototype delivery at `docs/table-stakes-recap-menu.zip`
(`table-stakes-menu-suite/`), inspected 2026-09-11. The bundle bundles THREE separate previews
under one delivery: a neon start menu (`start.html`), a three-stage setup showroom (`index.html`),
and an "After Hours" recap redesign (`recap.html`, documented in `RECAP-PREVIEW.md`). **Only the
recap redesign is in scope for this PRD** — the user's request was specifically "the menus at the
end of a game in a recap." The start-menu and setup-showroom previews are a separate, not-yet-
requested body of work; do not slice or build against them here.

Design reference material (all inside the zip, already extracted for review):
- `RECAP-PREVIEW.md` — feature narrative.
- `story-screenshots/SCREENSHOT-INDEX.md` — 10 numbered screenshots with suggested
  user-story statements and acceptance cues; used directly below.
- `src/recap-model.js`, `src/recap.js`, `src/recap-scene.js`, `recap.css` — the prototype's own
  implementation, useful as an interaction-pattern reference, **not** as code to port verbatim
  (it's vanilla JS/DOM against a static fixture; the real game is React/TypeScript against a live
  `GameClientStatus`).
- `data/recap-match.json` — a transcription of a specific match's real PDF export, used ONLY to
  drive the prototype's own demo. **Never copy this fixture's specific numbers or copy-text into
  the real game** — every figure in the shipped recap must come from the live `MatchResult`, per
  the existing `ResultsPanel.tsx` header's own "EVERY NUMBER HERE COMES FROM `match_complete`,
  VERBATIM" discipline. That discipline is preserved, not weakened, by this redesign.

## Why

The current results screen (`client/src/ui/ResultsPanel.tsx`, STORY-014) is a single long,
plain-styled scroll of tables — score breakdown, stat columns, manager's ledger, turning points —
built to clear PRD §11's "players understand why they lost" bar, but with no visual hierarchy: the
single most useful fact (what to change next match) has the same visual weight as a penalty
sub-table. The recap redesign restructures the SAME data into a small set of focused sections a
player moves through deliberately, gives the single best actionable insight real visual priority,
and adds a 3D dish showcase reusing assets already in the codebase.

**Almost none of this requires new server computation.** Direct comparison against the current
`ResultsPanel.tsx`/`messages.d.ts` confirms every figure the redesign shows is already a field on
`MatchResult`/`ManagerLedgerResult`:
- best/co-best sellers with tie detection: `result.bestSellingDishes` (`.count` equality already
  IS the tie condition — nothing new to compute, just render).
- fastest fulfillment: `result.bestDish.avgFulfillmentMs`.
- highest margin: `result.highestMarginDishes`.
- coaching/insights: `result.managerLedger.insights[].observation`/`.recommendation`.
- temp labor breakdown (the mockup's own headline example — "$38 spent, 0 recorded tasks"):
  `result.managerLedger.labor.{laborExpenses,hireFees,wagesPaid,taskCompletions}`.
- financials, service metrics, rival comparison, score breakdown: all pre-existing `StatColumn`
  fields.

This PRD is therefore a **client-only visual/interaction redesign** of `ResultsPanel.tsx` and its
styles, reusing `client/src/scenes/FoodModels.ts`'s existing `buildArcadeFoodProxy` (the same GLB
loader `RestaurantScene.ts`'s `readyDishes`/`carriedDishes` already use) for the 3D dish showcase.
No new snapshot field, no new server message, no new `MatchResult` field is anticipated by any
story below — if an implementer finds one is genuinely needed, that's a deviation from this PRD
worth flagging back, not something to add unilaterally the way STORY-046 was told to flag rather
than fix a balance gap.

## Constraints (apply to every story below)

1. **Every displayed number still comes from `status.matchComplete`, verbatim** — the exact
   discipline `ResultsPanel.tsx`'s own file header states today. A story that needs to invent
   copy (e.g. a takeaway sentence for a `managerLedger.insights` entry with no matching real
   category) must fall back honestly (omit the section, or a generic "no additional recommendation"
   state — `ResultsPanel.tsx` already does exactly this in several places) rather than fabricate.
2. **This is a redesign, not a parallel feature** — `ResultsPanel.tsx` is replaced/restructured in
   place; there is no feature flag, no "classic results" fallback mode. (No feature-flag convention
   exists anywhere else in this codebase, per `docs/kb/conventions.md`; do not introduce one.)
3. **Co-op match handling must be preserved.** `ResultsPanel.tsx` already special-cases
   `hasRival === false` (a co-op match has one shared restaurant, no rival column, no rival-
   dependent narrative lines) — every new section must degrade the same honest way, not assume a
   rival always exists.
4. **The `demo`/win-loss-draw selector in the prototype is preview-only scaffolding** — the real
   game already knows its own outcome (`complete.winnerPlayerId`) and never needs a manual
   selector; do not port that control.
5. **Reduced motion**: the prototype's own "Motion" toggle and `prefers-reduced-motion` handling
   is a real, portable requirement (this codebase already documents PRD/accessibility awareness
   elsewhere) — story-052 below owns it, but every earlier story that adds its OWN animation
   (card drop-in, mascot idle motion) should not hard-code motion with no way for a later story to
   gate it off; use a simple shared convention (e.g. a CSS class toggle or a single boolean prop
   threaded through) rather than each section inventing its own.
6. **`npm run check`'s existing `check:hud`/`check:visual-state`/`build:client` discipline
   applies** — this is still a client-rendering feature area; follow the precedent STORY-042/045
   already set (client-only stories in this exact codebase) for whether a new check script is
   warranted versus `build:client`'s `tsc --noEmit` being sufficient.

## Story slice

Six stories, continuing numbering from STORY-046 (the last-merged story in this repo's KB):

| ID | Title | Depends on |
|---|---|---|
| STORY-047 | Recap shell and opening highlights | — (foundation) |
| STORY-048 | Menu stars — 3D dish showcase | STORY-047 |
| STORY-049 | The numbers — financial/service summary and detailed scorecard | STORY-047 |
| STORY-050 | Next shift — coaching game plan | STORY-047 |
| STORY-051 | Arrange board — reorderable recap sections | STORY-047, benefits from 048-050 |
| STORY-052 | Win celebration and motion controls | STORY-047 |

STORY-047 is the one hard dependency for everything else — it establishes the section-card/
category-navigation shell, the mascot component, and the shared motion-toggle plumbing every
later story either fills a section within or hooks into. STORY-048/049/050 can proceed in
parallel once STORY-047 lands (each owns its own section's content, no file overlap expected
beyond the shared shell). STORY-051 is easiest to build and test once at least a couple of the
content sections exist, but its own mechanism (drag/arrow reordering of section cards) does not
require their FINAL content. STORY-052 only needs the mascot/outcome plumbing from STORY-047.
