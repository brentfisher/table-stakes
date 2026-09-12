// PRD §11 "End-of-match results" + the results-screen narrative layer (STORY-014), restructured
// by STORY-047 (PRD-recap-screen-redesign.md) into a small category-navigation shell instead of
// one long flat scroll. PRD §11's own framing is still the spec for this component: the results
// screen should "turn each match into a learning loop rather than a black-box simulation" (§11
// intro) and clear the §21 Milestone 4 bar — "most players understand why they lost" — not just
// dump every §11 field in a table.
//
// ============================================================================================
// EVERY NUMBER HERE (AND IN EVERY `client/src/ui/recap/*` MODULE THIS FILE COMPOSES) COMES FROM
// `match_complete`, VERBATIM. This component's only job is composing sections and routing
// between categories — dish/segment/event NAMES come from the same static catalogue JSON
// `SetupScreen.tsx`/`GameClient.ts` already import client-side (public game data, not a
// simulation result, see `recap/catalogue.ts`), but every COUNT, MARGIN, SCORE, and TIME comes
// straight out of `status.matchComplete`, which is `GameClient`'s untouched copy of the server
// message. If a number is not already a field on `MatchResult`/`MatchCompleteMessage`, it does
// not appear here — see messages.d.ts's own STORY-014 field comments for what each one means.
// ============================================================================================
//
// PRD §13 "React responsibilities": React owns application UI, mounted as a full-bleed overlay
// above the Three.js canvas — same `SetupScreen.tsx` pattern (`App.tsx` mounts this only when
// `status.matchComplete` exists, the same way `SetupScreen` mounts only during `setup`).
//
// STORY-047 VISUAL-STYLE DECISION: `ResultsScene.ts` remains the results-phase Three.js backdrop
// (`SceneManager#setActiveScene('results')` is UNCHANGED by this story) — this component's own
// `.recap` root simply renders FULLY OPAQUE over it, exactly the way the pre-STORY-047 `.results`
// class already did at 94% opacity (see `app.css`'s own comment on `.recap` for why 100%, not a
// restyle of `ResultsScene` itself, was the lower-risk choice: `ResultsScene` draws two static,
// dimly-lit podium blocks with no per-frame motion worth preserving underneath a bright card UI,
// so there is nothing gained by keeping it partially visible, and every risk in touching
// `SceneManager`/`GameClient`'s phase-swap wiring is avoided). Nothing dark is visible at once
// with the new bright cards — see this story's KB "Implementation notes" for the full reasoning.
//
// STORY-047 CATEGORY SHELL: this file now owns ONLY the always-visible "hero" (Game Over kicker,
// outcome heading, disconnect reason, the mascot, the score-comparison card, the countdown/
// rematch controls) plus the category nav and content router. Section CONTENT for each category
// lives in `client/src/ui/recap/*` — `RecapHighlights.tsx` for 'highlights', `RecapMenuStars.tsx`
// for 'menu-stars' (STORY-048), `RecapNumbers.tsx` for 'numbers' (STORY-049), and
// `RecapNextShift.tsx` for 'next-shift' (STORY-050, this one). `RecapPlaceholder.tsx` is kept
// (not deleted, even though every current category now has real content) as the defensive
// default below — see its own header and the final ternary branch's comment for why.

import { useState } from 'react';
import type { GameClientStatus } from '../game/GameClient';
import { botProfileLabel } from './bot-profiles';
import { isScored } from './recap/match-result';
import { formatPoints } from './recap/format';
import { RecapArrangeBoard } from './recap/RecapArrangeBoard';
import { RecapCategoryNav } from './recap/RecapCategoryNav';
import { RecapMascot } from './recap/RecapMascot';
import { RecapHighlights } from './recap/RecapHighlights';
import { RecapMenuStars } from './recap/RecapMenuStars';
import { RecapNextShift } from './recap/RecapNextShift';
import { RecapNumbers } from './recap/RecapNumbers';
import { RecapPlaceholder } from './recap/RecapPlaceholder';
import { useRecapMotion } from './recap/useRecapMotion';
import { RECAP_CATEGORIES, type RecapCategory, type RecapOutcome } from './recap/recap-types';

export interface ResultsPanelProps {
  status: GameClientStatus;
  onRematch: () => void;
}

export function ResultsPanel({ status, onRematch }: ResultsPanelProps): JSX.Element | null {
  const complete = status.matchComplete;
  const [category, setCategory] = useState<RecapCategory>('highlights');
  // STORY-047's shared motion convention (PRD-recap-screen-redesign.md constraint 5) — see
  // `useRecapMotion.ts`'s own header. `setMotionEnabled` is unused by this component (no Motion
  // toggle control ships here; STORY-054 owns that, split off from the original combined
  // STORY-052 on 2026-09-12) but is returned now so wiring one in later is a one-line change,
  // not a retrofit of this hook's shape.
  const [motionEnabled] = useRecapMotion();
  // STORY-050. `RecapNextShift.tsx`'s "which takeaway is prominent" / "game plan selection"
  // state, OWNED HERE rather than inside that component — `ResultsPanel` stays mounted for the
  // whole results screen, while `RecapNextShift` only mounts while `category === 'next-shift'`.
  // If these lived as `useState` inside `RecapNextShift` itself, switching to another category
  // and back would remount it and silently wipe a curated game plan — neither "refreshing" nor
  // "leaving the results screen" per AC5's own two reset triggers. See `RecapNextShift.tsx`'s
  // own header for the fuller reasoning; this is still plain component state either way, reset
  // whenever `ResultsPanel` itself remounts (a genuine "leave the results screen").
  const [nextShiftProminentIndex, setNextShiftProminentIndex] = useState(0);
  const [nextShiftGamePlan, setNextShiftGamePlan] = useState<Set<number>>(() => new Set());
  // STORY-051. `categoryOrder` holds only ids (a permutation of `RECAP_CATEGORIES.map(c => c.id)`)
  // rather than a reordered copy of the `RecapCategoryDef` objects themselves — labels are always
  // looked up fresh from `RECAP_CATEGORIES` below, so there is exactly one place a category's
  // label text lives. Session-only component state (AC5): it resets whenever `ResultsPanel` itself
  // remounts, the same precedent STORY-050's `nextShiftGamePlan` above already established, and
  // deliberately does NOT touch `nextShiftProminentIndex`/`nextShiftGamePlan`/`selfResult`/
  // `rivalResult` anywhere below — reordering only ever permutes which nav tab reads in which
  // position (AC3).
  const [categoryOrder, setCategoryOrder] = useState<RecapCategory[]>(() => RECAP_CATEGORIES.map((c) => c.id));
  const [arranging, setArranging] = useState(false);

  if (!complete) return null;

  // STORY-039. `status.restaurantId`, not `status.playerId` — `complete.results` is keyed by
  // restaurant id (`scoring-system.js`), and a co-op guest's own `playerId` is never one of
  // those keys (see `GameClientStatus.restaurantId`'s own comment). Falls back to `playerId`
  // only for the theoretical case of a stale cached build predating that field.
  const selfId = status.restaurantId ?? status.playerId;
  const restaurantIds = Object.keys(complete.results);
  // STORY-039. No `?? restaurantIds[0]` fallback: a match with only ONE restaurant id (a co-op
  // match, or the pre-existing solo `/dev/match` case) has no rival to find, and the honest
  // answer is null — falling back to `restaurantIds[0]` would resolve to `selfId` ITSELF
  // (there is nothing else in the array), which would render your own restaurant a second time
  // labeled "Rival" showing your own score back at you.
  const rivalId = restaurantIds.find((id) => id !== selfId) ?? null;
  const selfResult = selfId ? complete.results[selfId] : undefined;
  const rivalResult = rivalId ? complete.results[rivalId] : undefined;
  const hasRival = rivalId !== null;
  // STORY-025 AC: "identifies the bot opponent by name/profile rather than showing generic
  // 'Player 2'". `status.bots` is empty for a human-vs-human match, so `rivalBot` is null and
  // `rivalTitle` below is exactly the pre-STORY-025 "Rival" — this only changes anything for an
  // actual bot match.
  const rivalBot = status.bots.find((bot) => bot.playerId === rivalId) ?? null;
  const rivalTitle = rivalBot ? `Rival — ${botProfileLabel(rivalBot.difficulty)} Bot` : 'Rival';

  const outcome: RecapOutcome =
    complete.winnerPlayerId === null ? 'draw' : complete.winnerPlayerId === selfId ? 'win' : 'loss';

  // STORY-047 co-op decision (PRD constraint 3: co-op matches must degrade honestly, never
  // silently reuse a two-rival narrative). `scoring-system.js` sets `winnerPlayerId = null` for
  // ANY match without exactly two restaurants — "the same honest null a genuine draw would [get]"
  // per its own comment — so a co-op match's `outcome` above is definitionally `'draw'` even
  // though nothing was actually drawn; there was no rival to draw against. Rather than headline
  // a co-op shift "Draw" (which reads as "you tied someone"), `!hasRival` gets its own honest
  // label and reuses the neutral 'draw' mascot face (calm, not tearful/triumphant) as the closest
  // real visual for "nothing to compare against" — no new mascot state was worth inventing for a
  // heading-only distinction that isn't a win/loss/draw. See this story's Implementation notes.
  const outcomeHeading = !hasRival ? 'Shift complete' : outcome === 'draw' ? 'Draw' : outcome === 'win' ? 'You won' : 'You lost';

  // Named (rather than left inline in the ternary below) so the STORY-051 "Arrange" button can
  // gate on the same condition: arrange mode replaces the nav+content pair, which only renders in
  // the scored branch below, so an unscored/disconnect-ended match has nothing for it to swap in.
  const isUnscored = !selfResult || !isScored(selfResult) || (hasRival && (!rivalResult || !isScored(rivalResult)));

  return (
    <div className={`recap${motionEnabled ? '' : ' recap--motion-off'}`}>
      <div className="recap-utility-bar">
        {status.matchPhase === 'results' && status.timeRemainingMs !== null ? (
          <div className="recap-countdown">Next match in {Math.ceil(status.timeRemainingMs / 1000)}s</div>
        ) : null}
        {/* STORY-051. Hidden (not just disabled) for an unscored/disconnect-ended match — arrange
            mode replaces the nav+content pair below, which that branch never renders, so there
            would be nothing for the button to swap in. */}
        {isUnscored ? null : (
          <button type="button" className="recap-arrange-toggle" onClick={() => setArranging(true)}>
            Arrange
          </button>
        )}
        <button type="button" className="recap-rematch" onClick={onRematch}>
          Rematch
        </button>
      </div>

      {isUnscored ? (
        <div className="recap-empty-shell">
          <p className="recap-kicker">Game Over</p>
          <h1 className={`recap-outcome recap-outcome--${outcome}`}>{outcomeHeading}</h1>
          {/* The `{}`-results disconnect fallback (`match.js`'s own comment on
              `matchCompleteMessage`) is exactly the case that lands here — an unscored match is
              usually a disconnect-triggered end, so this sentence belongs in THIS branch at
              least as much as the scored one below. Kept in both rather than hoisted above the
              ternary so each branch stays a self-contained, readable block. */}
          {complete.reason === 'player_disconnected' ? (
            <p className="recap-reason">Your opponent disconnected and did not reconnect in time.</p>
          ) : null}
          <p className="recap-empty">No score was recorded for this match — it ended before scoring ran.</p>
        </div>
      ) : (
        <>
          {/* The always-visible hero — outcome heading, mascot, and (when there's a rival to
              compare against) the final score. AC2 lists these as part of "opening highlights",
              and they ARE shown whenever 'highlights' is the active category (the default); this
              story keeps them visible on every category too, rather than tearing the "match just
              ended" context down the instant a player looks at "The numbers" tab — see this
              story's own Implementation notes for why that's a superset of the AC, not a gap. */}
          <div className="recap-hero">
            <div className="recap-hero-text">
              <p className="recap-kicker">Game Over</p>
              <h1 className={`recap-outcome recap-outcome--${outcome}`}>{outcomeHeading}</h1>
              {complete.reason === 'player_disconnected' ? (
                <p className="recap-reason">Your opponent disconnected and did not reconnect in time.</p>
              ) : null}
            </div>
            <div className="recap-hero-mascot">
              <RecapMascot outcome={outcome} motionEnabled={motionEnabled} />
            </div>
            {hasRival && rivalResult && isScored(rivalResult) ? (
              <div className="recap-score-card">
                <h3 className="recap-card-eyebrow">The final score</h3>
                <div className="recap-score-comparison">
                  <div>
                    <span className="recap-score-label">You</span>
                    <strong className="recap-score-value">{formatPoints(selfResult.score)}</strong>
                  </div>
                  <span className="recap-score-vs">vs</span>
                  <div>
                    <span className="recap-score-label">{rivalTitle}</span>
                    <strong className="recap-score-value">{formatPoints(rivalResult.score)}</strong>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* STORY-051. Arrange mode fully replaces the nav+content pair (AC4's "returns to the
              normal focused single-category view" phrasing reads as arrange mode being its own
              distinct screen, not a layer on top of live category content) — the hero above stays
              visible either way, same as it already does across every category tab. */}
          {arranging ? (
            <RecapArrangeBoard
              categoryOrder={categoryOrder}
              onChangeOrder={setCategoryOrder}
              onFinish={() => setArranging(false)}
            />
          ) : (
            <>
              <RecapCategoryNav
                active={category}
                onSelect={setCategory}
                // `categoryOrder`-mapped, label looked up fresh from `RECAP_CATEGORIES` each
                // render (see this file's own `categoryOrder` comment) — `RecapCategoryNav`
                // itself is untouched by this story, exactly as STORY-047 set it up to allow.
                categories={categoryOrder.map((id) => ({
                  id,
                  label: RECAP_CATEGORIES.find((c) => c.id === id)?.label ?? id,
                }))}
              />

              <div className="recap-content">
                {category === 'highlights' ? (
                  <RecapHighlights result={selfResult} />
                ) : category === 'menu-stars' ? (
                  <RecapMenuStars result={selfResult} />
                ) : category === 'next-shift' ? (
                  // STORY-050. Self-restaurant only, same reasoning `RecapMenuStars.tsx`'s own
                  // comment gives: management takeaways are this restaurant's own coaching notes,
                  // not a rival-comparison view — there is no rival-shaped data anywhere in
                  // `managerLedger.insights`.
                  <RecapNextShift
                    result={selfResult}
                    prominentIndex={nextShiftProminentIndex}
                    onProminentIndexChange={setNextShiftProminentIndex}
                    gamePlan={nextShiftGamePlan}
                    onGamePlanChange={setNextShiftGamePlan}
                  />
                ) : category === 'numbers' ? (
                  <RecapNumbers
                    result={selfResult}
                    rivalResult={hasRival && rivalResult && isScored(rivalResult) ? rivalResult : null}
                    rivalTitle={rivalTitle}
                    hasRival={hasRival && !!rivalResult && isScored(rivalResult)}
                    turningPoints={complete.turningPoints}
                    // STORY-049. `selfId` is guaranteed non-null in this branch: `selfResult`
                    // (checked in the outer `if` above) is only ever looked up via
                    // `selfId ? complete.results[selfId] : undefined`, so a truthy `selfResult`
                    // implies a truthy `selfId` — TypeScript just can't see that dependency across
                    // the two variables. The assertion (rather than a defensive `?? ''`) keeps a
                    // turning point's leader label from silently going wrong if this invariant were
                    // ever broken by a future change.
                    selfId={selfId as string}
                  />
                ) : (
                  // Every `RecapCategory` member has an explicit branch above as of STORY-050 —
                  // this default is provably dead for the CURRENT union, kept anyway as the
                  // honest "coming soon" a future fifth category should get if a later story adds
                  // one here without also adding its own branch, rather than silently falling
                  // through to whichever branch happens to be last (see `RecapPlaceholder.tsx`'s
                  // own header).
                  <RecapPlaceholder category={category} />
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
