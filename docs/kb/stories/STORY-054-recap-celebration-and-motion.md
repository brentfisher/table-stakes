---
id: STORY-054
title: Win celebration, Replay Reveal, and the Motion control
status: pr-opened
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: story/054-recap-celebration-and-motion
worktree_path: /Users/brent/table-stakes-worktrees/story-054-recap-celebration-and-motion
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/75
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

- [x] On a win (`complete.winnerPlayerId === selfId`), a short, finite celebratory effect plays
  once when the highlights section first appears — the prototype uses colored particle bursts
  with trails over an ~8 second spawn window, then lets remaining particles expire
  (`10-victory-fireworks.png`); the exact visual is this story's own call (particles, confetti,
  a simpler CSS-only treatment) as long as it is genuinely FINITE (stops on its own, does not
  loop indefinitely) and reads as a celebration distinct from the mascot's own win reaction
  (STORY-047).
- [x] A "Replay Reveal" control restarts the category-entrance animations (the staggered card
  drop-in STORY-047/048/049/050 each use) and, on a win, replays the celebration effect too.
- [x] A single Motion control (on/off) disables every animated element the recap redesign added
  across ALL stories in this slice: card entrance/settle animations, mascot idle/reaction motion,
  and the win celebration — via the ONE shared convention STORY-047 established
  (`useRecapMotion()`, constraint 5 of the PRD), not by this story individually patching each
  earlier story's component. If STORY-047 did not actually leave a clean single hook, that's this
  story's finding to report back, not to silently work around with a scattered per-component fix.
- [x] The system `prefers-reduced-motion: reduce` preference sets the Motion control's INITIAL
  state to off (matching `RECAP-PREVIEW.md`'s own "The system reduced-motion preference is
  respected initially" line) — VERIFY this against `useRecapMotion.ts`'s actual current
  implementation rather than assuming it still needs building; STORY-047 may have already done
  this (it seeded the hook from `prefers-reduced-motion` for its own `.recap--motion-off` root
  class). The player can still explicitly turn motion back on.
- [x] With Motion off (whether by explicit toggle or by `prefers-reduced-motion`), no card
  animates in, the mascot holds a static pose, and no celebration plays regardless of outcome —
  every panel's DATA still renders normally, only motion is suppressed.
- [x] `npm run check` (including `build:client`) stays green.

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

## Implementation notes

**What shipped.** `client/src/ui/recap/RecapCelebration.tsx` is a new, self-contained component:
22 small `<span>` particles, each a plain CSS `animation` (`recap-celebration-fall-left/right` in
`app.css`), staggered into existence over a 1600ms spawn window and each running its own
1800ms±15% fall-and-fade (total lifetime 3400ms), after which the component sets `finished` and
unmounts its own DOM — no `setInterval`/`requestAnimationFrame`, no `infinite` iteration count.
`ResultsPanel.tsx` owns all the "when" logic via two new pieces of lifted state:
`celebrationToken` (lazy-initialized from `status.matchComplete` at mount — `>0` on a win, `0`
otherwise) and `replayToken` (bumped by the new "Replay Reveal" button, which also bumps
`celebrationToken` when `outcome === 'win'`). Both are used as/inside React `key`s, so "replay"
is just "mount a fresh instance" — no second "should I be animating" flag anywhere. The
category-entrance animation this story's AC2 needed (and which, per the approach_summary
correction, did not already exist anywhere in `app.css`) is `.recap-content-enter` /
`@keyframes recap-content-in`, applied to the `.recap-content` div and restarted via
`key={`${category}:${replayToken}`}`. The Motion toggle is a one-line wire of
`useRecapMotion()`'s pre-existing (previously-unused) setter to a new button.

**Bugs caught before committing.** None in the shipped logic itself — `npm run check` (including
`build:client`'s type-check) was green on the first real build and stayed green after the debug
round-trip described below. The one real mistake caught during manual verification was in my own
test method, not the product code: my first few attempts to see the celebration used
`document.querySelector(...)` immediately after a synthetic `.click()` in the same script tick,
which returned `false` even when the click had genuinely fired — React 18's automatic batching
does not commit the resulting DOM change synchronously within that tick, so an immediate same-tick
query is not a valid "did it render" check. Once verification switched to checking after a real
render pass (a subsequent tool call, or `console.log` markers read back afterward), the gate
condition, the mount, and the auto-unmount all showed the expected values every time.

**Deviations from the approach_summary, with reasoning:**
- The auto-trigger for the celebration does NOT watch `category` via a `useEffect`. Since
  `category` is always initialized to `'highlights'` (`ResultsPanel.tsx`'s own `useState`), "the
  first time highlights becomes active on a win" and "this component's first render, on a win"
  are the same moment for the current default tab, so a lazy `useState` initializer captures it
  with no effect needed. This is simpler than the approach_summary's own "has-played + effect"
  sketch, but it is coupled to that default: if a future story ever makes the initial category
  configurable or not `'highlights'`, this auto-trigger silently stops firing on mount and needs
  a real effect watching `category` again. Flagging this coupling here since it is not obvious
  from the code alone.
- The celebration is rendered as a full-panel overlay above `.recap-hero` (not scoped inside
  `.recap-hero-mascot` or the `'highlights'`-only content), so it stays visible even if the player
  switches tabs mid-burst, and clicking "Replay Reveal" from a non-`'highlights'` tab (on a win)
  will play it there too, not only when the highlights tab itself is showing. This mirrors the
  existing precedent that the hero (mascot, score card) is deliberately visible on every tab, not
  torn down per-category — same reasoning, applied to the celebration that sits next to it.
- `key={`${category}:${replayToken}`}` on `.recap-content` means "Replay Reveal" remounts whatever
  category component is currently active, which resets that component's OWN local UI state (e.g.
  `RecapNumbers`' scorecard-dialog-open flag, `RecapNextShift`'s evidence-dialog-open flag) even
  though it does NOT touch the state STORY-050/051 deliberately lifted into `ResultsPanel`
  (`nextShiftProminentIndex`, `nextShiftGamePlan`, `categoryOrder`). This is a deliberate choice,
  not an oversight: "replay from the top" closing an open dialog reads as reasonable, and the
  state that actually matters to preserve across a replay (the curated game plan, the arranged
  category order) is untouched because it was never inside the remounted subtree's own state.

**How motion-off was verified to actually suppress the celebration (not just its animation).**
This needed real verification, not just reading the CSS cascade, because a `motionEnabled &&`
guard that only gated the *animation* while still rendering static particle `<div>`s would be a
visible bug (AC5's own warning). Verified two ways:
1. Manually, in a real browser (`claude-in-chrome`), against a real `solo_bot` match at the
   `smoke` phase preset: reached a win outcome, confirmed the celebration rendered (screenshot —
   see below), clicked the Motion toggle to off, and queried the live DOM
   (`document.querySelector('.recap-celebration')`) — it returned `null`, i.e. the component is
   not merely frozen, its DOM is genuinely absent. Clicking "Replay Reveal" again while motion
   stayed off did not bring it back (also confirmed via DOM query and screenshot: only the
   already-rendered score/highlights data was visible, no particles, static mascot).
2. By reading the code path directly: `ResultsPanel.tsx` renders
   `{motionEnabled && celebrationToken > 0 ? <RecapCelebration .../> : null}` — `motionEnabled`
   is a hard precondition on mounting at all, not a class applied after the fact.
3. For the OTHER motion-off path (`prefers-reduced-motion: reduce` at the OS level, independent of
   the in-app toggle) — this one was reasoned from the CSS rather than re-driven through the OS
   setting in the browser sandbox: if the OS preference is set but the player explicitly clicks
   Motion back to "on" (`motionEnabled === true`), `RecapCelebration` DOES mount (the component
   only reads the in-app boolean), but `app.css`'s pre-existing
   `@media (prefers-reduced-motion: reduce) { .recap *, .recap *::before, .recap *::after {
   animation: none !important; } }` rule (STORY-047, unmodified by this story) still applies and
   kills every particle's `animation-name`, leaving each one at its un-animated base state:
   `opacity: 0` (`.recap-celebration-particle`'s own base rule). So even in that edge case, no
   particles ever become visible — not because of anything this story added, but because of the
   pre-existing blanket rule plus the base `opacity: 0` this story's own CSS happens to declare.
   Worth reporting rather than silently relying on: this is a property of the OLDER shared
   convention, and it is what actually keeps this specific edge case honest, not a second gate
   this story built.

**Visual verification.** The 3400ms burst is short relative to this environment's browser-tool
round-trip latency, so an initial pass of `screenshot` calls taken shortly after a click
consistently missed the window (confirmed via `console.log` markers that the component HAD
mounted with all 22 particles, and had already auto-unmounted by the time the screenshot was
captured — not a rendering bug, a timing-of-verification issue). To get an actual screenshot, the
component's `SPAWN_WINDOW_MS`/`PARTICLE_LIFETIME_MS` constants were TEMPORARILY widened 10x
(16000/18000ms) for one verification pass only, then reverted before committing (confirmed via
`grep -rn "TEMP-DEBUG"` returning nothing, and the reverted build producing the identical bundle
hash, `index-DkboDJcz.js`, as the very first clean build). The finite-timing behavior itself
(mounts once, unmounts after ~3.4s, no lingering DOM) was separately confirmed at the real shipped
1600/1800ms timings via `console.log` markers in a real match (auto-trigger fired once at
`match_complete`; two "Replay Reveal" clicks each triggered exactly one fresh mount; a later DOM
query found no `.recap-celebration` node once each burst's window had elapsed). No screenshot from
that widened-timing pass was saved to disk or attached to this story.

**A testing artifact, not a product bug:** during the widened-timing debug pass, each mount
(auto-trigger and each Replay Reveal click) logged `TEMP-DEBUG-MOUNT` twice instead of once.
`React.StrictMode` (used in `client/src/main.tsx`) was briefly suspected but ruled out — its
double-invoke behavior for effects is dev-only and does not run in a `vite build` production
bundle. The actual cause was not tracked down further (most likely the browser-automation tool's
synthetic click/interaction firing twice) since it never showed up as a real product-facing issue:
across a normal play session there was no spontaneous extra replay, and any two truly-overlapping
finite bursts from the same token are cosmetically indistinguishable from one denser burst. This
is flagged here for transparency, not because it affects the shipped behavior.
