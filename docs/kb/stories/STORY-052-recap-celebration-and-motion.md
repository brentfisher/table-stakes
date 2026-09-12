---
id: STORY-052
title: Win celebration and motion controls
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

# Win celebration and motion controls

A short celebratory effect on a win, a way to replay the recap's entrance animations, and a
single Motion toggle that turns off every animated element the redesign added (card entrances,
mascot idle motion, the win celebration) — respecting the system `prefers-reduced-motion`
preference by default.

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
  and the win celebration — via the ONE shared convention STORY-047 established (constraint 5 of
  the PRD), not by this story individually patching each earlier story's component. If STORY-047
  did not actually leave a clean single hook, that's this story's finding to report back, not to
  silently work around with a scattered per-component fix.
- [ ] The system `prefers-reduced-motion: reduce` preference sets the Motion control's INITIAL
  state to off (matching `RECAP-PREVIEW.md`'s own "The system reduced-motion preference is
  respected initially" line) — the player can still explicitly turn motion back on.
- [ ] With Motion off (whether by explicit toggle or by `prefers-reduced-motion`), no card
  animates in, the mascot holds a static pose, and no celebration plays regardless of outcome —
  every panel's DATA still renders normally, only motion is suppressed.
- [ ] `npm run check` (including `build:client`) stays green.

## Notes

- Depends on STORY-047 (the mascot component and, critically, the shared motion-gating
  convention constraint 5 asks STORY-047 to establish).
- Cites: `table-stakes-menu-suite/src/recap-scene.js`'s finite-particle fireworks implementation
  as a mechanism reference (spawn window, particle lifetime, trail rendering) — port the APPROACH
  (finite, capped particle count, respects a motion-off flag), not the literal vanilla-Three.js
  code, into whatever rendering context STORY-047 chose for the mascot (this story's own file
  header note applies: confirm where STORY-047 actually put the mascot/celebration canvas before
  assuming a location).
