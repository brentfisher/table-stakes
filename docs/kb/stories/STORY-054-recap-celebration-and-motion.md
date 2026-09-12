---
id: STORY-054
title: Win celebration, Replay Reveal, and the Motion control
status: pending
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: false
approach_summary: >
  CORRECTION to this story's own AC2: "the staggered category-entrance animations STORY-047/048/
  049/050 each use" DO NOT EXIST — confirmed by reading `app.css` directly. No `.recap-card`/
  `.recap-content`/`.recap-hero` rule anywhere has an entrance animation; the AC's premise was
  written against the design mockup's visual description before those stories actually shipped,
  and none of them built one (only the mascot's looping idle bounce/sway and STORY-052's separate
  `.recap-teaser-enter` fact-reveal exist today). "Replay Reveal" is meaningless with nothing to
  replay, so this story must ALSO build a simple staggered entrance animation for the category
  content cards (a `.recap-content-enter`-style keyframe, applied to `.recap-card`/similar on
  mount) — a natural, necessary widening of scope, not a new feature invented beyond the ask.
  CONFIRMED ALREADY TRUE (verify, don't rebuild): `useRecapMotion.ts` already seeds
  `initialMotionEnabled()` from `prefers-reduced-motion` and already returns `[motionEnabled,
  setMotionEnabled]` — `setMotionEnabled` is unused today specifically so this story can wire a
  real toggle to it in one line. `.recap--motion-off *,*::before,*::after { animation: none
  !important; }` already exists in `app.css` as the one blanket motion-kill rule — the mascot's
  idle bounce/sway/tear-drip animations are ALREADY gated by this class (`recap-mascot--motion`
  only applies when `motionEnabled`). Both ACs 3/4's "verify this already exists" framing is
  correct — do not rebuild either.
  MOTION TOGGLE: add a visible control (e.g. a button in `ResultsPanel.tsx`'s existing
  `.recap-utility-bar`, alongside STORY-051's "Arrange" button and the "Rematch" button) calling
  `setMotionEnabled`. `useRecapMotion()` is already called in `ResultsPanel.tsx` — just start
  using the setter it already destructures (currently discarded via `const [motionEnabled] =
  useRecapMotion()`).
  ENTRANCE ANIMATION: a small new CSS keyframe (finite, no `infinite`) applied to the category
  content on mount/category-switch — reuse `.recap-teaser-enter`'s pattern (`animation: X 420ms
  ease both`) as the template, new keyframe name, applied at the `.recap-content`/`.recap-card`
  level. Motion-off suppression falls out for free from the EXISTING blanket `.recap--motion-off`
  rule — do not add a second gate.
  WIN CELEBRATION: build with plain CSS/DOM (small `<div>`s + CSS keyframes/transforms for
  particle bursts), matching `RecapMascot.tsx`'s own deliberate choice to use inline SVG/CSS
  instead of a second Three.js/WebGL context — cite that file's header comment directly (it
  explains why: no competing WebGL context with STORY-048's real 3D dish showcase, and it avoids
  this environment's known `document.visibilityState === 'hidden'`-blocks-`requestAnimationFrame`
  browser-automation verification gap, which a `requestAnimationFrame`-driven WebGL particle
  system would hit the same way a Three.js one would). Must be GENUINELY FINITE: a fixed-duration
  CSS animation (or a short `setTimeout`-bounded DOM particle lifecycle) that stops and removes
  itself, never `animation-iteration-count: infinite`. Trigger: plays once, automatically, the
  first time `outcome === 'win'` AND the highlights category is showing — track a "has played"
  flag lifted into `ResultsPanel.tsx` (same lifted-state precedent STORY-050/051 already
  established for their own session-only UI state) so switching tabs away and back does NOT
  replay it; only the new "Replay Reveal" control force-replays both the entrance animation and
  (on a win) the celebration together, by resetting a "play token"/incrementing a key rather than
  re-deriving "has it played" logic twice.
  SCOPE: no server change, no new shared/game-logic module, no wire-schema change — pure client
  CSS/React work wiring an existing hook and adding finite CSS animations, hence
  `is_architectural: false`. Does not touch `RecapMascot.tsx`'s own idle animations beyond what
  `motionEnabled` already gates (already correct); does not touch STORY-052's `RecapTeaser.tsx`
  (pre-`match_complete`, entirely separate from this post-reveal scope) or STORY-053's kitchen-
  staging work (unrelated system).
created: 2026-09-12
updated: 2026-09-12
---

# Win celebration, Replay Reveal, and the Motion control

**Split 2026-09-12 from the original combined STORY-052** ("Pre-reveal teaser, win celebration,
and motion controls"). This story is that story's original scope — everything AFTER the recap has
already mounted: a finite win celebration, a Replay Reveal control, and the shared Motion on/off
toggle. The other half — publishing results data early and shortening the dark pre-reveal wait —
is now STORY-052, a server+client story with a meaningfully different risk profile. **This story
does NOT depend on STORY-052** — read STORY-047 before assuming otherwise: it already built
`useRecapMotion()` (seeded from `prefers-reduced-motion`, already returning an unused
`setMotionEnabled` for exactly a later story like this one to wire up), so this story's Motion
control is wiring an EXISTING hook to a visible toggle, not building new state machinery, and has
nothing to do with STORY-052's teaser/tally work. Sequence these two stories in either order.

Reference: `docs/table-stakes-recap-menu.zip` → `table-stakes-menu-suite/story-screenshots/`
`10-victory-fireworks.png`; `RECAP-PREVIEW.md`'s "Replay reveal" and "Motion" bullets. See
`docs/PRD-recap-screen-redesign.md` for the full slice and its constraints — especially
constraint 5 (every earlier story's animation must be gateable by one shared convention this
story turns off).

## Acceptance Criteria

- [ ] On a win (`complete.winnerPlayerId === selfId`), a short, finite celebratory effect plays
  once when the highlights section first appears — the prototype uses colored particle bursts
  with trails over an ~8 second spawn window, then lets remaining particles expire
  (`10-victory-fireworks.png`); the exact visual is this story's own call (particles, confetti,
  a simpler CSS-only treatment) as long as it is genuinely FINITE (stops on its own, does not
  loop indefinitely) and reads as a celebration distinct from the mascot's own win reaction
  (STORY-047).
- [ ] A "Replay Reveal" control restarts the category-entrance animations (the staggered card
  drop-in STORY-047/048/049/050 each use) and, on a win, replays the celebration effect too.
- [ ] A single Motion control (on/off) disables every animated element the recap redesign added
  across ALL stories in this slice: card entrance/settle animations, mascot idle/reaction motion,
  and the win celebration — via the ONE shared convention STORY-047 established
  (`useRecapMotion()`, constraint 5 of the PRD), not by this story individually patching each
  earlier story's component. If STORY-047 did not actually leave a clean single hook, that's this
  story's finding to report back, not to silently work around with a scattered per-component fix.
- [ ] The system `prefers-reduced-motion: reduce` preference sets the Motion control's INITIAL
  state to off (matching `RECAP-PREVIEW.md`'s own "The system reduced-motion preference is
  respected initially" line) — VERIFY this against `useRecapMotion.ts`'s actual current
  implementation rather than assuming it still needs building; STORY-047 may have already done
  this (it seeded the hook from `prefers-reduced-motion` for its own `.recap--motion-off` root
  class). The player can still explicitly turn motion back on.
- [ ] With Motion off (whether by explicit toggle or by `prefers-reduced-motion`), no card
  animates in, the mascot holds a static pose, and no celebration plays regardless of outcome —
  every panel's DATA still renders normally, only motion is suppressed.
- [ ] `npm run check` (including `build:client`) stays green.

## Notes

- Depends on STORY-047 (the mascot component and, critically, the shared motion-gating
  convention constraint 5 asks STORY-047 to establish) — confirmed already built:
  `client/src/ui/recap/useRecapMotion.ts`.
- Does NOT depend on STORY-052 (the split sibling, pre-reveal teaser) — see this story's own
  header for why. Safe to build/kick off independently of that story's status.
- Cites: `table-stakes-menu-suite/src/recap-scene.js`'s finite-particle fireworks implementation
  as a mechanism reference (spawn window, particle lifetime, trail rendering) — port the APPROACH
  (finite, capped particle count, respects a motion-off flag), not the literal vanilla-Three.js
  code, into whatever rendering context STORY-047 chose for the mascot (confirm where STORY-047
  actually put the mascot/celebration canvas before assuming a location — see `RecapMascot.tsx`).
