---
id: STORY-054
title: Win celebration, Replay Reveal, and the Motion control
status: pending
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: null
approach_summary: null
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
