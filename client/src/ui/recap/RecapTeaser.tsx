// STORY-052 "Pre-reveal teaser". `scoring-system.js#onPhaseChange('results')` computes this
// restaurant's own final `MatchResult` SYNCHRONOUSLY the instant the match enters `results` —
// see `match.js#toSnapshot`'s own comment on `you.resultsPreview`. `match_complete` (the message
// `ResultsPanel` needs) does not arrive until the whole results-phase timer runs out, which used
// to mean 20-30s of a dark, empty stage with nothing on it. This component fills that specific
// window: it shows a small, honest slice of the viewer's OWN numbers, building up progressively,
// finishing with a tallying score — all BEFORE any win/loss/draw heading exists to show, because
// `resultsPreview` (a per-restaurant `MatchResult`) carries no `winnerPlayerId` and this component
// never reads `status.matchComplete` to find one. This deliberately inverts STORY-047's normal
// "outcome first" order for this one moment; `ResultsPanel` still declares the outcome, and is
// the ONLY component that ever does, once `match_complete` actually arrives (see `GameView.tsx`'s
// `!status.matchComplete` gate on this component, which is what guarantees the two never overlap).
//
// SCOPE: the tally-up interpolator lives HERE ONLY. `ResultsPanel.tsx`'s own hero score card
// (`.recap-score-card`) must not gain one — that card re-renders on every category-tab switch
// while `ResultsPanel` stays mounted for the whole results screen, so a tally there would
// re-animate on every click. This component mounts once, tallies once, and is gone the moment
// `matchComplete` arrives (React unmounts it — `GameView.tsx` swaps it out for `ResultsPanel` in
// the same render).
//
// MOTION: gated by STORY-047's shared `useRecapMotion()` convention, not a second one — with
// motion off, every fact appears at once and the score is shown at its final value immediately,
// no count-up. The CSS entrance animation is additionally covered by `.recap--motion-off`'s
// existing global `animation: none` override (see `app.css`), so motion is off in two
// independent, redundant ways rather than one.

import { useEffect, useState } from 'react';
import type { MatchResult } from '../../../../shared/schemas/messages';
import { formatMoney, formatPoints } from './format';
import { useRecapMotion } from './useRecapMotion';

export interface RecapTeaserProps {
  /** The viewer's own already-computed result — `status.resultsPreview`, never the rival's. */
  result: MatchResult;
}

// How long each fact sits alone on screen before the next one joins it. Chosen to be read
// comfortably (a short phrase plus a number) without feeling like a delay for its own sake — see
// this story's KB "Implementation notes" for the arithmetic this was chosen against, together
// with `shared/constants/tuning.js`'s new `results` duration.
const REVEAL_STEP_MS = 900;
// How many non-score facts build up before the score section joins them.
const FACT_COUNT = 3;
// The score count-up's own duration, once it starts.
const TALLY_DURATION_MS = 1400;

/** A plain `requestAnimationFrame` interpolator from 0 to `target`, eased so it settles rather
 * than stopping abruptly. There is no existing count-up/tally mechanism anywhere else in this
 * codebase (confirmed by search before writing this) — this is the one place it is built, and it
 * stays local to this file per this file's own header. `active=false` (motion off, or the caller
 * not ready to start yet) skips the animation entirely and returns `target` right away. */
function useCountUp(target: number, durationMs: number, active: boolean): number {
  const [value, setValue] = useState<number>(active ? 0 : target);

  useEffect(() => {
    if (!active) {
      setValue(target);
      return undefined;
    }
    let frame = 0;
    const startedAt = performance.now();
    const step = (now: number) => {
      const elapsed = now - startedAt;
      const t = Math.min(1, elapsed / durationMs);
      // Ease-out cubic: fast at first, settling into the final number rather than snapping to
      // it — a plain deceleration curve, not a physics simulation this moment doesn't need.
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, active]);

  return value;
}

/** Mounted only once every earlier fact has shown (`revealedCount >= FACT_COUNT` in the parent)
 * — a fresh mount is exactly what makes `useCountUp`'s "start from 0 on mount" behavior line up
 * with "the score joins the sequence last", with no extra state to coordinate the two.
 *
 * The label reads "Your score", not "so far" or "running total" — `score` IS the real, final
 * `MatchResult.score` the whole time; only its DISPLAYED value counts up while `tallied` catches
 * up to it. Wording the label as if the score itself were still accruing would be exactly the
 * kind of invented claim this codebase's "never fabricate" convention (see `narrative.js`'s own
 * header) forbids — the number is honest, only its reveal is animated. */
function TeaserScore({ score, motionEnabled }: { score: number; motionEnabled: boolean }): JSX.Element {
  const tallied = useCountUp(score, TALLY_DURATION_MS, motionEnabled);
  return (
    <div className="recap-teaser-score recap-teaser-enter">
      <span className="recap-teaser-score-label">Your score</span>
      <strong className="recap-teaser-score-value">{formatPoints(tallied)}</strong>
    </div>
  );
}

export function RecapTeaser({ result }: RecapTeaserProps): JSX.Element {
  // Its own call, not a prop from `ResultsPanel.tsx` — the two components never render at the
  // same time (`GameView.tsx`'s `!status.matchComplete` gate), so there is nothing to keep in
  // sync between them, the same reasoning this story's approach_summary gives for why no shared
  // toggle state is needed.
  const [motionEnabled] = useRecapMotion();

  // AC2's "building teaser sequence": facts join one at a time. Motion off means every fact
  // (including the score) is simply already there — no staggered reveal either, not just no
  // count-up, since a staged appearance IS an animation the same reduced-motion preference asks
  // this app to skip.
  const [revealedCount, setRevealedCount] = useState(motionEnabled ? 0 : FACT_COUNT);
  useEffect(() => {
    if (!motionEnabled) {
      setRevealedCount(FACT_COUNT);
      return undefined;
    }
    setRevealedCount(0);
    const timers = Array.from({ length: FACT_COUNT }, (_, i) =>
      setTimeout(() => setRevealedCount(i + 1), (i + 1) * REVEAL_STEP_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [motionEnabled]);

  // Deliberately plain, guest-facing facts — no comparison to a rival (there is none in
  // `resultsPreview`, by design) and nothing that reads as an outcome. `reputation` is
  // `result.reputation` itself (`DISTRICT_REPUTATION_MIN`..`MAX`, 25-90, the same field
  // `customer-system.js#toPublicRestaurantSnapshot` already exposes live during `service`) —
  // NOT `result.scoreBreakdown.reputationBonus`, the derived score contribution
  // `RecapScorecard.tsx` shows in the full recap. Two different numbers on the same
  // `MatchResult`; this teaser deliberately shows the plain guest-facing figure, not the
  // scoring-internal one, so it reads as a fact rather than a hint at the composite score.
  const facts = [
    { key: 'guests', label: 'Guests served', value: String(result.guestsServed) },
    { key: 'revenue', label: 'Revenue earned', value: formatMoney(result.revenue) },
    { key: 'reputation', label: 'District reputation', value: formatPoints(result.reputation) },
  ];

  return (
    <div className={`recap recap-teaser${motionEnabled ? '' : ' recap--motion-off'}`}>
      <div className="recap-teaser-shell">
        <p className="recap-kicker">Tallying the shift…</p>
        <div className="recap-teaser-facts">
          {facts.slice(0, revealedCount).map((fact) => (
            <div className="recap-teaser-fact recap-teaser-enter" key={fact.key}>
              <span className="recap-teaser-fact-label">{fact.label}</span>
              <strong className="recap-teaser-fact-value">{fact.value}</strong>
            </div>
          ))}
        </div>
        {revealedCount >= FACT_COUNT ? <TeaserScore score={result.score} motionEnabled={motionEnabled} /> : null}
      </div>
    </div>
  );
}
