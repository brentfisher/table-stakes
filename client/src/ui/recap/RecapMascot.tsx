// STORY-047 AC3: "A mascot/reaction element communicates outcome (win/loss/draw) at a glance."
//
// VISUAL-STYLE DECISION (documented in this story's KB "Implementation notes" too): the mockup's
// own mascot (`table-stakes-menu-suite/src/recap-scene.js#createMascot`) is a Three.js model
// built from primitives (sphere body, cone hat, primitive limbs) — confirmed by reading that
// file, NOT a GLB asset, so there was never an asset to port. This component reaches the same
// "communicates win/loss/draw at a glance" bar (the story's own stated AC bar, not "matches the
// mockup's exact character") with inline SVG instead of a second Three.js scene: no new
// `WebGLRenderer`/scissored-viewport plumbing (the mockup's `scene.js#viewport` pattern) is
// needed for one small reactive face, this codebase's results overlay is plain React/CSS
// already (`ResultsPanel.tsx`'s own header: "React owns application UI"), and it renders
// correctly even where this environment's browser automation cannot run a WebGL animation loop
// (`document.visibilityState` reports `hidden`, blocking `requestAnimationFrame` — see this
// story's Implementation notes for why that limitation does NOT apply to this CSS component).
// STORY-048 owns the real 3D dish showcase (`FoodModels.ts`'s GLB loader) — this mascot is
// deliberately not that, and does not compete with it for a WebGL context.

import type { RecapOutcome } from './recap-types';

export interface RecapMascotProps {
  outcome: RecapOutcome;
  /** STORY-047's shared motion convention — see `useRecapMotion.ts`. `false` disables the idle
   * bob/bounce and the loss tear-drip animation; the face itself (which shape mouth/eyebrows
   * render) is never motion-gated, only the CSS animations layered on top of it. */
  motionEnabled: boolean;
}

/** The mockup's own tomato-red/white-hat palette (`recap-scene.js`'s `red`/`white` constants),
 * translated to flat 2D fills — not `app.css`'s dark-theme tokens, which this bright card scene
 * intentionally does not inherit (see `app.css`'s own `.recap` comment). */
const TOMATO_RED = '#e8604a';
const LEAF_GREEN = '#4a8a63';
const INK = '#33404a';
const HAT_WHITE = '#fffaf2';

export function RecapMascot({ outcome, motionEnabled }: RecapMascotProps): JSX.Element {
  return (
    <div
      className={`recap-mascot recap-mascot--${outcome}${motionEnabled ? ' recap-mascot--motion' : ''}`}
      role="img"
      aria-label={
        outcome === 'win'
          ? 'A smiling tomato chef mascot, celebrating the win'
          : outcome === 'loss'
            ? 'A frowning tomato chef mascot, tearing up over the loss'
            : 'A calm, neutral tomato chef mascot'
      }
    >
      <svg viewBox="0 0 120 130" className="recap-mascot-svg" aria-hidden="true">
        {/* stem leaves */}
        <g fill={LEAF_GREEN}>
          <ellipse cx="60" cy="24" rx="7" ry="13" transform="rotate(-28 60 24)" />
          <ellipse cx="60" cy="20" rx="7" ry="14" />
          <ellipse cx="60" cy="24" rx="7" ry="13" transform="rotate(28 60 24)" />
        </g>
        {/* chef hat */}
        <g fill={HAT_WHITE} stroke="#e2d9c8" strokeWidth="1.5">
          <rect x="42" y="30" width="36" height="12" rx="4" />
          <circle cx="49" cy="30" r="10" />
          <circle cx="60" cy="27" r="11" />
          <circle cx="71" cy="30" r="10" />
        </g>
        {/* body */}
        <ellipse cx="60" cy="82" rx="34" ry="32" fill={TOMATO_RED} />
        {/* arms */}
        <g stroke={TOMATO_RED} strokeWidth="9" strokeLinecap="round" fill="none">
          <path d="M30 88 Q16 96 14 112" />
          <path d="M90 88 Q104 96 106 112" />
        </g>
        <circle cx="14" cy="116" r="7" fill={HAT_WHITE} />
        <circle cx="106" cy="116" r="7" fill={HAT_WHITE} />
        {/* eyes */}
        <g fill="#fff">
          <ellipse cx="47" cy="76" rx="9" ry="11" />
          <ellipse cx="73" cy="76" rx="9" ry="11" />
        </g>
        <g fill={INK} className="recap-mascot-pupils">
          <circle cx="48" cy="78" r="4.5" />
          <circle cx="74" cy="78" r="4.5" />
        </g>
        {/* eyebrows — the one shape that differs sharply per outcome */}
        {outcome === 'loss' ? (
          <g stroke={INK} strokeWidth="3.5" strokeLinecap="round" fill="none">
            <path d="M37 61 L55 67" />
            <path d="M83 61 L65 67" />
          </g>
        ) : outcome === 'win' ? (
          <g stroke={INK} strokeWidth="3.5" strokeLinecap="round" fill="none">
            <path d="M38 65 Q47 59 56 64" />
            <path d="M82 65 Q73 59 64 64" />
          </g>
        ) : (
          <g stroke={INK} strokeWidth="3.5" strokeLinecap="round" fill="none">
            <path d="M39 64 L57 64" />
            <path d="M81 64 L63 64" />
          </g>
        )}
        {/* mouth */}
        {outcome === 'win' ? (
          <path d="M45 96 Q60 112 75 96" stroke={INK} strokeWidth="4" strokeLinecap="round" fill="none" />
        ) : outcome === 'loss' ? (
          <path d="M45 104 Q60 90 75 104" stroke={INK} strokeWidth="4" strokeLinecap="round" fill="none" />
        ) : (
          <path d="M47 99 L73 99" stroke={INK} strokeWidth="4" strokeLinecap="round" fill="none" />
        )}
        {/* the loss state's single animated tear */}
        {outcome === 'loss' ? (
          <ellipse className="recap-mascot-tear" cx="80" cy="86" rx="4" ry="6" fill="#58c9e4" />
        ) : null}
      </svg>
    </div>
  );
}
