import { useState, type Dispatch, type SetStateAction } from 'react';

// STORY-047. PRD-recap-screen-redesign.md constraint 5: "every earlier story that adds its OWN
// animation ... should not hard-code motion with no way for a later story to gate it off; use a
// simple shared convention ... rather than each section inventing its own." This hook IS that
// convention: a single boolean, seeded from the system `prefers-reduced-motion` preference (the
// mockup's own "The system reduced-motion preference is respected initially" behavior), threaded
// down as a prop and applied as ONE root CSS class (`recap--motion-off` — see `app.css`'s
// `.recap` rules) rather than every section reading `matchMedia` itself.
//
// STORY-054 ("win celebration and motion controls", split off from the original combined
// STORY-052 on 2026-09-12) owns the actual on-screen Motion toggle control and the
// fireworks/idle-animation payoff — this story does not add that button, only the state and the
// setter it will call. Returning the setter (not just the boolean) now is what makes that later
// addition a one-line wire-up instead of a retrofit: a `[value, setValue]` pair is the whole
// contract STORY-054 needs, already in place. STORY-052 (post-split: the pre-reveal teaser) is a
// second, independent consumer of the boolean half only — see `RecapTeaser.tsx`.

/** `false` (motion off) whenever the OS/browser reports `prefers-reduced-motion: reduce`, or in
 * a non-browser render (harness/SSR-style contexts with no `matchMedia`) — never assume motion
 * is safe when the query can't be answered. */
function initialMotionEnabled(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useRecapMotion(): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [motionEnabled, setMotionEnabled] = useState<boolean>(initialMotionEnabled);
  return [motionEnabled, setMotionEnabled];
}
