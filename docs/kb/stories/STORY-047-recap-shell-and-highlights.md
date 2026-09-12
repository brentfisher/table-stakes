---
id: STORY-047
title: Recap shell and opening highlights
status: merged
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: story/047-recap-shell-and-highlights
worktree_path: /Users/brent/table-stakes-story-047
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/66
is_architectural: false
approach_summary: >
  Replaces `client/src/ui/ResultsPanel.tsx`'s single-scroll layout with a category-navigation
  shell (`RecapCategory = 'highlights' | 'next-shift' | 'menu-stars' | 'numbers'`) and fills in
  only the 'highlights' category for real (the other three render as an explicit placeholder
  state STORY-048/049/050 replace). Highlights content is a direct restructuring of data
  `ResultsPanel.tsx` already reads verbatim: outcome/score from `complete`/`selfResult.score`
  vs `rivalResult.score` (gated on the existing `hasRival` check), best-seller spotlight with
  co-best-seller tie labeling from `result.bestSellingDishes` (`.count` equality — no new
  computation), and the lead takeaway from `result.managerLedger.insights[0]`. VISUAL-STYLE
  DECISION THIS STORY MUST MAKE EXPLICITLY: `client/src/scenes/ResultsScene.ts` is today a
  full-bleed DARK "curtain call" 3D backdrop (`SceneManager#setActiveScene('results')` swaps to
  it), but the mockup's whole aesthetic is a BRIGHT white card-based UI with only a SMALL inset
  3D mascot, not a full-screen dark stage — these visually conflict. Decide and document: either
  (a) stop swapping to `ResultsScene` during results and render the new bright shell over the
  default backdrop (or none), with the mascot in its own small canvas/viewport (the mockup's own
  `scene.js`/`recap-scene.js` pattern — one WebGL canvas, scissored viewports per small showroom,
  reusable here), or (b) keep `ResultsScene` but restyle it to sit correctly behind bright
  foreground cards. Do not silently keep BOTH the old dark full-bleed stage AND the new bright
  cards without addressing the clash. The mascot itself: the mockup's "tomato chef" is built from
  Three.js PRIMITIVES in `recap-scene.js#createMascot` (sphere + cone hat + primitive eyes/limbs),
  NOT a GLB asset — no new asset porting needed, a simple procedural equivalent (or even a
  non-3D/CSS treatment) satisfies the AC, which only asks that win/loss/draw read "at a glance".
  `is_architectural: false` — no new snapshot field, no new server message; this is the
  foundation client component this PRD's other five stories build a section within or hook a
  shared convention into (the category-navigation shape and a motion-toggle hook other stories
  will use), so its data contracts (the `RecapCategory` union, how a "section" plugs in) should
  be built generic from the start rather than a highlights-only special case retrofitted later.
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

- [x] A category navigation bar (at minimum "The highlights," reserving space/routing for
  "Next shift," "Menu stars," "The numbers" — STORY-048/049/050 fill those in) replaces the
  current single-scroll layout. Switching category shows/hides sections; this story only needs
  "The highlights" to have real content, but the navigation mechanism itself must be built to
  hold all four from the start (a `type RecapCategory = 'highlights' | 'next-shift' |
  'menu-stars' | 'numbers'` union, or similar, not a highlights-only special case later stories
  have to retrofit).
- [x] Opening highlights show: the outcome heading (win/loss/draw, reusing
  `complete.winnerPlayerId`/the existing outcome logic in `ResultsPanel.tsx`), the final score
  comparison (`selfResult.score` vs `rivalResult.score` when `hasRival`), the best-selling dish
  as a large featured card (`result.bestSellingDishes[0]`, with a **co-best-seller label when
  tied** — `.count` equality against the next entry, per `RECAP-PREVIEW.md`'s own "Caesar Salad
  and Smash Burger both sold six... labeled a co-best seller" example), smaller supporting-dish
  cards for the rest of `bestSellingDishes`, and the single lead management takeaway
  (`result.managerLedger.insights[0]`, if any — `dominantConstraint`-driven, matching
  `ResultsPanel.tsx`'s existing "What to change next match" section's own data source).
- [x] A mascot/reaction element communicates outcome at a glance (win/loss/draw states) — the
  prototype uses a bespoke 3D "tomato chef" model built from Three.js primitives
  (`table-stakes-menu-suite/src/recap-scene.js`'s `createMascot`, NOT a GLB asset — confirm this
  yourself by reading that file before assuming an asset needs porting). Building an equivalent
  is this story's own call: a simple procedural Three.js model (mirroring that file's approach),
  a 2D/CSS treatment, or reusing an existing in-repo visual primitive are all acceptable — the AC
  is "communicates win/loss/draw at a glance," not "matches the mockup's exact character design."
- [x] A co-op match (`hasRival === false`, per `ResultsPanel.tsx`'s existing check) shows
  highlights without any rival-comparison element — no rival score, no rival column — exactly
  as today's `ResultsPanel.tsx` already degrades, not a new co-op-specific bug.
- [x] `npm run check` (including `build:client`) stays green.

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

## Implementation notes

**AC1 — category shell, built to hold all four from the start.** `client/src/ui/recap/recap-types.ts`
declares `type RecapCategory = 'highlights' | 'next-shift' | 'menu-stars' | 'numbers'` and
`RECAP_CATEGORIES: readonly RecapCategoryDef[]` (id + label), rather than four hard-coded JSX
buttons. `RecapCategoryNav.tsx` renders `categories.map(...)` from that array (accepted as a prop,
defaulting to `RECAP_CATEGORIES`) — STORY-051's "drag category handles to swap panels" mechanism
can hand this component a reordered copy of the same shape without touching it. `ResultsPanel.tsx`
holds `const [category, setCategory] = useState<RecapCategory>('highlights')` and a plain ternary
router (`category === 'highlights' ? <RecapHighlights .../> : <RecapPlaceholder category={category} />`).
Verified live: clicked all three placeholder tabs plus back to "The highlights" in the scratch
preview harness (see "Visual verification" below) — the nav switches content correctly and the
active tab underline follows.

**AC2 — opening highlights content, `client/src/ui/recap/RecapHighlights.tsx`.** All data comes
straight off `selfResult` (the viewer's own `MatchResult`), no rival dish data:
- **Best-seller spotlight + tie labeling.** Extracted into `shared/game-logic/recap-highlights.js`
  (`bestSellerSpotlight(bestSellingDishes)`), NOT inline JSX — this is the one piece of grouping
  logic in this story non-trivial enough to warrant its own check script (see below), following
  the exact `state-color-bands.js`/`manager-ledger.js` precedent (Decision 4's plain-JS-plus-
  `.d.ts` shape: two real runtime consumers — `RecapHighlights.tsx` and
  `scripts/check-recap-highlights.mjs` — that share no build step). Because
  `MatchResult.bestSellingDishes` is already server-sorted descending by `.count`
  (`order-system.js`), a tie group is just "every entry whose `.count` equals the first entry's" —
  a single `.filter()`, verified against 1-dish, 2-way-tie, 3-way-tie, and outright-leader cases
  in the check script. The featured card's eyebrow reads "Your co-best seller" when `tiedWith.length
  > 0` and "Your best seller" otherwise (mirroring `01-loss-highlights.png`/`02-win-highlights.png`);
  a tied supporting card gets a "· tied best" suffix; the tie note names every tied dish, not just
  one, so a genuine 3-way tie (not in either screenshot) still reads correctly.
- **Lead management takeaway.** `result.managerLedger.insights[0]`, with the exact same "no
  tracked management decision produced enough evidence..." fallback string
  `ResultsPanel.tsx` already used pre-redesign (PRD constraint 1: honest empty state, not
  invented copy).
- **Outcome heading + score comparison** are NOT inside `RecapHighlights.tsx` — see the "hero
  region" design decision below.

**AC3 — mascot, `client/src/ui/recap/RecapMascot.tsx`.** Confirmed by reading
`table-stakes-menu-suite/src/recap-scene.js#createMascot` that the mockup's "tomato chef" is
Three.js primitives (sphere body, cone/circle hat, primitive limbs), not a GLB — there was no
asset to port. Rather than building a second Three.js scene (a new `WebGLRenderer` plus the
mockup's own scissored-viewport pattern from `src/scene.js`, just to host one small reactive
face), this is a single inline SVG with three eyebrow/mouth path variants (win: raised brows +
upward curve; loss: slanted brows + downward curve + an animated tear; draw/co-op: flat brows +
flat mouth) plus a chef hat and stem-leaves matching the mockup's palette. This avoids competing
for a WebGL context with STORY-048's own real dish showcase, and — concretely useful for this
story's own verification — renders correctly under this environment's `document.visibilityState:
hidden` limitation, which blocks `requestAnimationFrame` but not CSS. STORY-048 should expect to
hit that same rAF wall when it adds the real 3D dish showcase and will need the same honest
limitation note STORY-041/045 set precedent for.

**AC4 — co-op degrades honestly, and gets its own explicit heading decision.** `hasRival` is the
exact pre-existing check (`rivalId !== null`); when false, the `recap-score-card` element is
omitted entirely from the hero (not replaced with a "no rival" placeholder — AC4 says "without
any rival-comparison element", so nothing rival-shaped renders at all), and `RecapHighlights`
already only ever reads `selfResult`, never `rivalResult`. One thing worth flagging explicitly:
`scoring-system.js` sets `winnerPlayerId = null` for ANY match without exactly two restaurants
("the same honest null a genuine draw would [get]", per that file's own comment) — so a co-op
match's `outcome` ternary in `ResultsPanel.tsx` evaluates to `'draw'` even though nothing was
actually drawn; there was no rival to draw against. Headlining a co-op shift "Draw" would read as
"you tied someone," which is false. `ResultsPanel.tsx` computes a separate `outcomeHeading` that
overrides to **"Shift complete"** whenever `!hasRival`, and reuses the neutral 'draw' mascot face
(calm, not tearful or triumphant) as the closest existing visual rather than inventing a fourth
mascot state for what is a heading-only distinction, not a new win/loss/draw. Verified live in the
scratch preview's `?mode=coop` fixture: heading reads "Shift complete" in the neutral amber color,
mascot is the calm face, and no score-comparison card renders.

**VISUAL-STYLE DECISION: `.recap` renders fully opaque over an UNCHANGED `ResultsScene`.**
Read `ResultsScene.ts` and `SceneManager.ts` fully. `ResultsScene` is two static, dimly-lit podium
blocks with ambient/key lighting and no per-frame motion of its own; `SceneManager#setActiveScene`
still swaps to it during `results`, untouched by this story. Rather than option (a)'s "stop
swapping" (which would touch `SceneManager`/`GameClient`'s phase-swap wiring, a working, tested
seam with no bug driving a change) or option (b)'s "restyle `ResultsScene`" (extra work styling a
scene that, once covered, contributes nothing visible), this story took the explicitly-sanctioned
third option: the new `.recap` root is **fully opaque** (`--recap-bg: #f7f4ec`, no alpha), where
the pre-STORY-047 `.results` class was only 94%-opaque (`rgba(10,12,15,0.94)`). Since
`ResultsScene`'s podium blocks have no motion worth preserving underneath a bright card UI, full
opacity loses nothing the 94% scrim wasn't already hiding almost entirely, and this is the
lowest-risk option: zero lines changed in `SceneManager.ts`/`GameClient.ts`. `.recap` has
`z-index: 3` exactly like the old `.results` did, so it still paints over `HudPanel` (`.hud`, no
explicit `z-index`) the same way the old dark scrim did — verified by reading `app.css`'s
z-index usage (nothing else in the sheet uses `z-index: 3`) rather than assumed. Nothing dark and
nothing bright are ever visible "at once" — the dark stage is simply never visible once the
opaque bright shell mounts, which is the one failure mode the story explicitly named to avoid.

**Shared motion convention: `client/src/ui/recap/useRecapMotion.ts`.** Returns
`[motionEnabled, setMotionEnabled]` (a real `useState` tuple, not just a read-only boolean),
seeded from `!matchMedia('(prefers-reduced-motion: reduce)').matches` (the mockup's own "system
reduced-motion preference is respected initially" behavior). `motionEnabled` is threaded down as
a prop to `RecapMascot` and applied as ONE root class, `recap--motion-off`, which sets
`animation: none !important` on every descendant — plus a `@media (prefers-reduced-motion: reduce)`
blanket override for a browser that reports the preference without any app-level state changing.
This story does not ship a Motion toggle control (STORY-052 owns that, per the PRD's own story
table) — `setMotionEnabled` is destructured-but-unused by this story's own JSX for that reason,
kept only so STORY-052's control is a one-line `onClick={() => setMotionEnabled(v => !v)}` instead
of a retrofit of this hook's shape. **Verified, not just asserted**: built a temporary scratch
preview (see below) with a `?motion=off` param that overrides `window.matchMedia` before mount,
then read `getComputedStyle(mascotSvg).animationName` in the browser console — `recap-mascot-sway`
with motion on, `none` with `recap--motion-off` applied. The class-toggle half of the convention
is confirmed working end-to-end in a real browser, not just plausible by code review.

**Data/formatting extraction for STORY-048/049/050's reuse.** Moved out of the old monolithic
`ResultsPanel.tsx` into `client/src/ui/recap/`: `format.ts` (`formatMoney`/`formatMs`/
`formatPoints`/`formatPercent`), `catalogue.ts` (`dishName`, off the same public
`shared/game-data/dishes.json` `SetupScreen.tsx` already imports), and `match-result.ts`
(`isScored`, unchanged signature). Each later category section imports from these rather than
re-declaring its own copy. `formatMs`/`formatPercent` and any per-dish/segment/event catalogue
maps this story doesn't itself need (`SEGMENT_NAMES`, `EVENT_TITLES`, `UPGRADE_INFO`,
`CONSTRAINT_LABELS`, `REASON_LABELS`, `TIE_BREAK_LABELS`, `KITCHEN_FOCUSES`, `SPECIAL_NAMES`) were
NOT moved — they have no consumer left in the tree after this restructuring (the sections that
used them are gone until STORY-049/050 rebuild them), and moving unused code "for later" would be
dead weight `noUnusedLocals` can't even catch since they'd be unused exports, not unused locals.
STORY-049/050 should add these back to `catalogue.ts`/`format.ts` (or their own equivalents) when
they actually need them, rather than resurrecting this story's now-deleted copies.

**What this redesign temporarily removes from the results screen (expected mid-slice state, not
a regression).** `ResultsPanel.tsx` shrank by ~420 lines. Gone until a later story restores it
under its own category:
- Both `StatColumn` blocks (the full stat table per restaurant: revenue, expenses, temp labor,
  specials spend, restock spend, market premium, stock orders, shortage time, net profit, guests
  served, lost-to-rival, avg satisfaction, avg wait, event objective, customer-segment breakdown,
  upgrades purchased, top-3 best-selling/highest-margin dishes) — STORY-049 ("The numbers").
- The "Why you won/lost" narrative list (`decidingSegment`, `selfResult.bestDish`'s fastest-
  fulfillment sentence, `rivalResult.largestLossCause`, `tieBreakDecided`) — no home yet in the
  PRD's four categories as named; likely STORY-049 or 050, flagged here rather than silently
  dropped.
- The full "Manager's ledger" section: dominant-constraint line, the three cost articles (labor/
  restocking/kitchen), the kitchen focus trade-off sentence, special-performance list, and every
  insight PAST the first (`insights[0]` alone survives into this story's lead takeaway) —
  STORY-050 ("Next shift — coaching game plan").
- "Key turning points" (`complete.turningPoints`) — STORY-049 or 050.
- Score breakdown table and penalty detail — STORY-049 ("The numbers").
`check-manager-ledger.mjs`'s own "the React HUD, tactical overview, results ledger..." assertion
was updated (`scripts/check-manager-ledger.mjs`) to check that `managerLedger.insights` is still
read from `client/src/ui/recap/RecapHighlights.tsx`, replacing a literal `/Manager's ledger/`
heading-text match against `ResultsPanel.tsx` that this restructuring made stale — the comment
left in place says to repoint that `read()` call, not reinstate a heading match, if STORY-050
relocates the takeaway again.

**New check script: `scripts/check-recap-highlights.mjs`** (wired into `package.json`'s
`check:recap-highlights` and the main `check` composite), exercising `bestSellerSpotlight` against
empty/single-dish/two-way-tie/three-way-tie/outright-leader cases. Falsified per
`docs/kb/conventions.md` rule 2 before trusting it: changed the tie filter from `===` to `>`,
confirmed 2 of 12 assertions failed with the expected FAIL output, then restored the correct
implementation and re-ran to confirm all 12 pass again. No other new check script was added —
following the `check-visual-state.mjs`/STORY-042 precedent, `RecapMascot`/`RecapCategoryNav`/
`RecapHighlights`'s own JSX rendering has no in-process test surface and `build:client`'s
`tsc --noEmit` is what proves that half type-checks; `useRecapMotion`'s `matchMedia` read and
`recapOutcome`'s two-branch ternary were both judged too trivial to be worth a second runtime
consumer just to justify a `shared/game-logic/` placement (the same reasoning STORY-042 gave for
NOT moving `buildStationMenuItems` there).

**Visual verification.** `npm run build:client`, `npm run build:harnesses`, and the full
`npm run check` (988 assertions across every `check-*.mjs` plus both smokes) all pass green after
`npm run install:all` in the fresh worktree. Beyond type-checking, this story got LIVE visual
confirmation, not just the honest-limitation note STORY-041/045 needed for their WebGL work: a
temporary scratch harness (`client/dev-recap-preview.html` + `client/src/dev-recap-preview.tsx`,
both deleted before this commit — never part of the tree) rendered `ResultsPanel` directly against
hand-built `GameClientStatus`-shaped fixtures (win, loss with a tied best-seller matching
`RECAP-PREVIEW.md`'s own "Caesar Salad and Smash Burger both sold six" description, and a co-op
match with no second restaurant key) — **fixture numbers were invented for this preview, never
taken from `data/recap-match.json`**, consistent with this whole PRD's "never copy this fixture's
specific numbers" rule. Screenshotted via `claude-in-chrome` against the Vite dev server
(`npm --prefix client run dev`) at `localhost:5174`/`5173`: loss state (frowning mascot, "You
lost", 32.7 vs 138.5, co-best-seller tie labeling, tied supporting card), win state (smiling
mascot, "You won", 186.4 vs 138.5, untied "Your best seller"), and co-op state ("Shift complete",
neutral mascot, no score card, single-restaurant best-seller data only) all render correctly and
match the visual intent of `01-loss-highlights.png`/`02-win-highlights.png`. Also clicked through
all three placeholder tabs ("Next shift", "Menu stars", "The numbers") and back to confirm nav
switching works and the hero region persists across categories. **This live verification was
possible specifically because the mascot is CSS/SVG, not Three.js** — this environment's
`document.visibilityState: hidden` limitation blocks `requestAnimationFrame`-driven WebGL scenes
(the precedent STORY-034/041/045 already documented for the game's own 3D canvas), but a plain
React/CSS overlay has no rAF dependency and rendered normally. STORY-048's real 3D dish showcase
will not have this same escape hatch and should expect to fall back to the honest-limitation note
this story didn't need.
