// STORY-054 AC1: "a short, finite win celebration plays once when highlights first appears on a
// win, distinct from the mascot's own reaction."
//
// VISUAL-STYLE DECISION, same one `RecapMascot.tsx`'s own header already made and documented —
// plain CSS/DOM particles, NOT a second Three.js/WebGL context, for the same two reasons: (1) it
// never competes with STORY-048's real 3D dish showcase for a WebGL context, and (2) a plain CSS
// `animation` keeps running and is screenshot-verifiable in this environment, where
// `document.visibilityState` reports `'hidden'` during browser-automation verification and
// blocks `requestAnimationFrame` — a `rAF`-driven particle loop (Three.js or hand-rolled) would
// hit that same gap. Mirrors the mockup's finite spawn-window fireworks
// (`table-stakes-menu-suite/src/recap-scene.js`, `10-victory-fireworks.png`) in APPROACH only —
// a capped particle count, staggered into existence over a spawn window, each with its own
// bounded fall-and-fade lifetime — not the literal vanilla-Three.js particle system.
//
// Deliberately NOT a duplicate of the mascot's own win reaction (`recap-mascot--win` in
// `app.css`): that is a small, CONTINUOUS, looping bob tied to the mascot's idle state for as
// long as motion is on. This is a one-shot burst of short-lived particles that spawns, plays,
// and is gone — see `TOTAL_LIFETIME_MS` below for the bound that makes it "genuinely finite"
// (AC1), never `animation-iteration-count: infinite`.
//
// TRIGGER/REPLAY: this component has no "should I play right now" logic of its own — it always
// plays once, fully, whenever it is mounted. `ResultsPanel.tsx` owns deciding WHEN that mount
// happens (its own `celebrationToken` comment) via a React `key`, and owns not rendering this
// component at all when motion is off (AC5 — a burst of static, motionless particle divs would
// be a visual bug, not "no celebration"; there is no second motion gate in here to keep that
// true, only the caller's render guard).

import { useEffect, useState } from 'react';

const PARTICLE_COUNT = 22;
// Particles are staggered into existence across this window ("spawn window" in the mockup's own
// language), then each runs its own fall-and-fade for PARTICLE_LIFETIME_MS before disappearing.
const SPAWN_WINDOW_MS = 1600;
const PARTICLE_LIFETIME_MS = 1800;
// The absolute latest moment any particle can still be on screen — the component unmounts its
// own DOM after this, so nothing lingers once the burst is over (AC1's "genuinely finite").
const TOTAL_LIFETIME_MS = SPAWN_WINDOW_MS + PARTICLE_LIFETIME_MS;

// The `--recap-*` bright-theme accent colors (`app.css`'s `.recap` token block) plus the mascot's
// tomato-red/leaf-green, reused rather than inventing a new "fireworks" palette — this scene
// already has a defined color language and the celebration should read as part of it.
const PARTICLE_COLORS = ['#f0a63b', '#3f8f52', '#e8604a', '#58c9e4', '#b98a2e'];

interface Particle {
  id: number;
  leftPct: number;
  delayMs: number;
  durationMs: number;
  color: string;
  /** Alternates the particle between the left-drifting and right-drifting keyframe (see
   * `app.css`) — two fixed trajectories, not a per-particle random custom property, which is
   * enough to read as a "burst fanning outward" without inline custom-CSS-property typing. */
  driftLeft: boolean;
}

function makeParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    id: i,
    leftPct: Math.random() * 100,
    delayMs: Math.random() * SPAWN_WINDOW_MS,
    durationMs: PARTICLE_LIFETIME_MS * (0.85 + Math.random() * 0.3),
    color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
    driftLeft: i % 2 === 0,
  }));
}

export function RecapCelebration(): JSX.Element | null {
  // Generated once per mount (lazy initializer), not per render — a fresh mount (a new `key`
  // from `ResultsPanel.tsx`) is exactly what "play again" means, so a fresh random layout each
  // time is the correct behavior, not a bug to memoize away.
  const [particles] = useState<Particle[]>(makeParticles);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setFinished(true), TOTAL_LIFETIME_MS);
    // Cleanup matters here specifically: if `ResultsPanel.tsx` remounts this component again
    // (Replay Reveal, or `ResultsPanel` itself remounting for a new match) before this timer
    // fires, the OLD timer must not fire a `setFinished` on an unmounted instance.
    return () => window.clearTimeout(timer);
  }, []);

  if (finished) return null;

  return (
    <div className="recap-celebration" aria-hidden="true">
      {particles.map((p) => (
        <span
          key={p.id}
          className={`recap-celebration-particle${p.driftLeft ? ' recap-celebration-particle--drift-left' : ' recap-celebration-particle--drift-right'}`}
          style={{
            left: `${p.leftPct}%`,
            backgroundColor: p.color,
            animationDelay: `${p.delayMs}ms`,
            animationDuration: `${p.durationMs}ms`,
          }}
        />
      ))}
    </div>
  );
}
