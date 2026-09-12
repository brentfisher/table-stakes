// STORY-050 "Next shift — coaching game plan". The recap category (STORY-047's nav shell) that
// turns `result.managerLedger.insights[]` from a single lead takeaway (STORY-047's
// `RecapHighlights.tsx` already shows `insights[0]` under "The move that matters") into a
// browsable, selectable, exportable session.
//
// CORRECTION vs this story's own Notes (kept here so the reasoning survives, not just the KB's
// approach_summary): the Notes cite `ResultsPanel.tsx`'s "What to change next match" section as
// the current home of this content. That section no longer exists there — STORY-047 already
// moved lead-insight rendering into `RecapHighlights.tsx`. This file does not touch that
// rendering; it is a second, independent presentation of the SAME array for the 'next-shift'
// category, per this story's own scope framing ("restructures its presentation ... does not
// change what an insight IS").
//
// DATA DISCIPLINE (same rule as every other `recap/*` module, see `ResultsPanel.tsx`'s own
// header): `insights[].observation`/`.recommendation` are used verbatim, never reworded. The
// evidence dialog below maps `insight.category` to REAL structured fields already on
// `MatchResult.managerLedger` (`constraints[]`/`specials[]`/`labor`) — never the insight's own
// text re-parsed, and never an invented number. `manager-ledger-system.js` is untouched by this
// story: this file only reads its already-published output.
//
// STATE SCOPE (AC5): `prominentIndex`/`gamePlan`/`evidenceIndex` are all plain `useState` in this
// component tree, mounted fresh every time `ResultsPanel.tsx` shows this category. No
// persistence, no server round-trip, no new wire field — refreshing or navigating away resets
// everything, which is the correct behavior per the AC, not a gap to fix later.

import { useEffect, useState } from 'react';
import type { MatchResult } from '../../../../shared/schemas/messages';
import { constraintLabel, specialName } from './catalogue';
import { formatMoney, formatMs, formatPoints, formatPercent } from './format';

export interface RecapNextShiftProps {
  result: MatchResult;
}

type Insight = MatchResult['managerLedger']['insights'][number];

/** The five `ManagerConstraintId` values get their catalogue label; the two non-constraint
 * categories get a plain proper-noun label. A `Record` over only the two literal string
 * categories (rather than a full switch) lets TypeScript narrow the `else` branch back down to
 * `ManagerConstraintId` for the `constraintLabel` call. */
const NON_CONSTRAINT_LABELS: Record<'specials' | 'labor', string> = { specials: 'Specials', labor: 'Labor' };
function topicLabel(category: Insight['category']): string {
  return category === 'specials' || category === 'labor' ? NON_CONSTRAINT_LABELS[category] : constraintLabel(category);
}

export function RecapNextShift({ result }: RecapNextShiftProps): JSX.Element {
  const insights = result.managerLedger.insights;

  // AC1's honest empty state — the exact string `RecapHighlights.tsx` already uses for
  // `insights[0]` being absent, reused verbatim rather than a second worded-differently copy for
  // what is the same underlying fact ("no tracked decision produced evidence").
  if (insights.length === 0) {
    return (
      <div className="recap-next-shift recap-next-shift--empty">
        <p className="recap-muted">
          No tracked management decision produced enough evidence for an additional recommendation.
        </p>
      </div>
    );
  }

  return <RecapNextShiftContent result={result} insights={insights} />;
}

// Split out so this component's hooks only ever mount once `insights` is known non-empty — same
// reasoning as `RecapMenuStars.tsx`'s own `RecapMenuStarsContent` split: `useState(0)` below is a
// plain, always-valid index into a non-empty array, not a defensive fallback for a case that can
// no longer occur once we're here.
function RecapNextShiftContent({ result, insights }: { result: MatchResult; insights: Insight[] }): JSX.Element {
  const [prominentIndex, setProminentIndex] = useState(0);
  // AC2: a session-only SET of array indices, not a copy of the insight objects — toggling is an
  // index membership flip, and the prominent card / list row both derive their "saved" look from
  // membership in this same set, so the two views can never disagree about what's selected.
  const [gamePlan, setGamePlan] = useState<Set<number>>(() => new Set());
  // AC3: which insight's evidence dialog is open, by index — `null` means closed. An index
  // (rather than a boolean + relying on `prominentIndex`) so the dialog can be opened from a
  // LIST row without first having to make that row prominent.
  const [evidenceIndex, setEvidenceIndex] = useState<number | null>(null);

  const canCycle = insights.length > 1;
  const prominent = insights[prominentIndex];

  const toggleGamePlan = (index: number) => {
    setGamePlan((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const cycle = (direction: 1 | -1) => {
    setProminentIndex((current) => (current + direction + insights.length) % insights.length);
  };

  // AC4: a plain client-side text file from only the SELECTED insights' real text — no network
  // request, no server round-trip (PRD "no data is sent to a game server" framing). New pattern
  // for this codebase (no prior `Blob`/`createObjectURL`/`<a download>` precedent) — kept as
  // simple as the browser API allows: build the string, hand it to a throwaway anchor, click it.
  const exportGamePlan = () => {
    const selected = insights.filter((_, index) => gamePlan.has(index));
    if (selected.length === 0) return;
    const lines = ['Next shift — game plan', ''];
    for (const insight of selected) {
      lines.push(topicLabel(insight.category));
      lines.push(insight.observation);
      lines.push(insight.recommendation);
      lines.push('');
    }
    const blob = new Blob([lines.join('\n').trimEnd() + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    // A temporary, never-mounted-in-the-tree anchor — the standard `<a download>` trigger
    // pattern for a same-origin blob URL. Removed and revoked immediately after the synchronous
    // `click()`; nothing here persists past this function call.
    const link = document.createElement('a');
    link.href = url;
    link.download = 'next-shift-game-plan.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const otherInsights = insights
    .map((insight, index) => ({ insight, index }))
    .filter(({ index }) => index !== prominentIndex);

  return (
    <div className="recap-next-shift">
      <div className="recap-card recap-card--takeaway recap-next-shift-prominent">
        <div className="recap-next-shift-prominent-header">
          <h3 className="recap-card-eyebrow">{topicLabel(prominent.category)}</h3>
          {/* AC1: arrows hidden entirely (not just disabled) when there's only one insight — a
              lone insight has nothing to cycle to, so a visible-but-permanently-disabled control
              would just be confusing chrome. */}
          {canCycle ? (
            <div className="recap-next-shift-arrows">
              <button type="button" className="recap-next-shift-arrow" onClick={() => cycle(-1)} aria-label="Previous takeaway">
                ‹
              </button>
              <button type="button" className="recap-next-shift-arrow" onClick={() => cycle(1)} aria-label="Next takeaway">
                ›
              </button>
            </div>
          ) : null}
        </div>
        <p className="recap-takeaway-observation">{prominent.observation}</p>
        <p className="recap-takeaway-recommendation">{prominent.recommendation}</p>
        <div className="recap-next-shift-actions">
          <button
            type="button"
            className={`recap-next-shift-toggle${gamePlan.has(prominentIndex) ? ' recap-next-shift-toggle--selected' : ''}`}
            aria-pressed={gamePlan.has(prominentIndex)}
            onClick={() => toggleGamePlan(prominentIndex)}
          >
            {gamePlan.has(prominentIndex) ? '✓ In your game plan' : 'Add to game plan'}
          </button>
          <button type="button" className="recap-next-shift-evidence-link" onClick={() => setEvidenceIndex(prominentIndex)}>
            View evidence
          </button>
        </div>
      </div>

      {/* AC1: "the rest as a selectable list" — the prominent card above already covers its own
          insight, so the list only holds the OTHER insights; cycling the prominent one (or
          clicking a row here, which also makes that row prominent, mirroring
          `RecapMenuStars.tsx`'s supporting-card-click-to-feature convention) moves entries
          between the two views without duplicating any insight on screen twice at once. */}
      {otherInsights.length > 0 ? (
        <div className="recap-next-shift-list">
          {otherInsights.map(({ insight, index }) => (
            <div
              key={index}
              className={`recap-next-shift-row${gamePlan.has(index) ? ' recap-next-shift-row--selected' : ''}`}
            >
              <button type="button" className="recap-next-shift-row-main" onClick={() => setProminentIndex(index)}>
                <span className="recap-next-shift-row-topic">{topicLabel(insight.category)}</span>
                <span className="recap-next-shift-row-observation">{insight.observation}</span>
              </button>
              <button
                type="button"
                className="recap-next-shift-row-toggle"
                aria-pressed={gamePlan.has(index)}
                aria-label={gamePlan.has(index) ? 'Remove from game plan' : 'Add to game plan'}
                onClick={(event) => {
                  // Toggling the row's game-plan membership must not also re-fire the sibling
                  // "make prominent" button beneath it — both are real `<button>`s stacked in one
                  // row, not a nested-interactive-element hack, so `stopPropagation` here is only
                  // guarding against a future wrapping click handler, not undoing bad markup.
                  event.stopPropagation();
                  toggleGamePlan(index);
                }}
              >
                {gamePlan.has(index) ? '✓' : '+'}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="recap-next-shift-export">
        <button type="button" className="recap-next-shift-export-button" disabled={gamePlan.size === 0} onClick={exportGamePlan}>
          Download game plan{gamePlan.size > 0 ? ` (${gamePlan.size})` : ''}
        </button>
      </div>

      {evidenceIndex !== null ? (
        <RecapNextShiftEvidence result={result} insight={insights[evidenceIndex]} onClose={() => setEvidenceIndex(null)} />
      ) : null}
    </div>
  );
}

/** AC3's dialog. Maps `insight.category` to the real structured evidence already on
 * `MatchResult.managerLedger` — never a recomputation, never the mockup's own hardcoded numbers.
 * The five `ManagerConstraintId` values look up their own `constraints[]` entry by `.id`;
 * `'specials'`/`'labor'` map to their own top-level ledger fields. If a category ever has no
 * matching entry (shouldn't happen in practice — every category `manager-ledger-system.js`
 * pushes an insight for has a corresponding always-present ledger field), the insight's own
 * `observation` text is shown instead of fabricating a number that isn't on the wire. */
function RecapNextShiftEvidence({
  result,
  insight,
  onClose,
}: {
  result: MatchResult;
  insight: Insight;
  onClose: () => void;
}): JSX.Element {
  // Escape-to-close, the exact convention `HowToPlay.tsx`/`RecapScorecard.tsx` already use.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const ledger = result.managerLedger;
  const label = topicLabel(insight.category);

  return (
    <div className="recap-evidence-backdrop" role="presentation" onClick={onClose}>
      <div
        className="recap-evidence"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recap-evidence-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="recap-evidence-header">
          <div>
            <p className="recap-card-eyebrow">Evidence</p>
            <h2 id="recap-evidence-title">{label}</h2>
          </div>
          <button type="button" className="recap-evidence-close" onClick={onClose} aria-label="Close evidence">
            ×
          </button>
        </div>

        {insight.category === 'specials' ? (
          <SpecialsEvidence specials={ledger.specials} />
        ) : insight.category === 'labor' ? (
          <LaborEvidence labor={ledger.labor} />
        ) : (
          <ConstraintEvidence constraint={ledger.constraints.find((c) => c.id === insight.category) ?? null} insight={insight} />
        )}
      </div>
    </div>
  );
}

/** One of the five `ManagerConstraintId` categories — `observedMs`/`limitingMs`/`peakScore`/
 * `evidence` off that constraint's own `managerLedger.constraints[]` entry, the exact fields
 * `04-staffing-evidence.png`'s sibling constraint panels show, sourced live rather than the
 * mockup's own hardcoded figures (AC3). */
function ConstraintEvidence({
  constraint,
  insight,
}: {
  constraint: MatchResult['managerLedger']['constraints'][number] | null;
  insight: Insight;
}): JSX.Element {
  // Defensive fallback (AC3's own "shouldn't happen in practice" case): every constraint category
  // an insight is ever generated for has a corresponding always-present `constraints[]` entry
  // (`manager-ledger-system.js` tracks all five every match), so this branch is not expected to
  // run — but showing the insight's own real observation text beats fabricating a number that
  // isn't on the wire.
  if (!constraint) {
    return <p className="recap-evidence-fallback">{insight.observation}</p>;
  }
  return (
    <>
      <dl className="recap-evidence-stats">
        <div>
          <dt>Observed pressure</dt>
          <dd>{formatMs(constraint.observedMs)}</dd>
        </div>
        <div>
          <dt>Time actually limiting</dt>
          <dd>{formatMs(constraint.limitingMs)}</dd>
        </div>
        <div>
          <dt>Peak severity score</dt>
          <dd>{formatPoints(constraint.peakScore)}</dd>
        </div>
      </dl>
      {/* `<dl>`'s content model only permits `dt`/`dd` pairs (optionally `<div>`-wrapped) — the
          plain-language evidence sentence is a sibling paragraph, not a third `dl` child, so this
          stays valid HTML rather than a `<p>` dropped inside the description list. */}
      <p className="recap-evidence-note">{constraint.evidence}</p>
    </>
  );
}

/** The `'specials'` category — every front-door special that ran this match, `managerLedger.
 * specials[]` verbatim (same fields/formatting `RecapScorecard.tsx`'s own specials list uses, so
 * the two don't silently disagree on how a special's numbers read). */
function SpecialsEvidence({ specials }: { specials: MatchResult['managerLedger']['specials'] }): JSX.Element {
  if (specials.length === 0) {
    // Same honest-empty-state line `RecapScorecard.tsx` already uses for this exact fact.
    return <p className="recap-muted">No front-door special was activated, so no special outcome is claimed.</p>;
  }
  return (
    <ul className="recap-evidence-list">
      {specials.map((special) => (
        <li key={special.specialId}>
          <strong>{specialName(special.specialId)}</strong> ran {special.activations}× for {formatMoney(special.spend)}.{' '}
          {special.observedConversions} of {special.observedDecisions} observed district decisions chose you during
          its active windows
          {special.observedConversionRate !== null ? ` (${formatPercent(special.observedConversionRate)})` : ''};{' '}
          {special.deliveredOrders} delivered orders produced {formatMoney(special.observedRevenue)}
          {special.averageCheck === null ? '' : ` at a ${formatMoney(special.averageCheck)} average check`};{' '}
          {special.averageSatisfaction === null ? 'no satisfaction sample' : `average satisfaction ${special.averageSatisfaction}`}.
        </li>
      ))}
    </ul>
  );
}

/** The `'labor'` category — `managerLedger.labor`'s own fields verbatim, the exact ones AC3
 * names (`laborExpenses`/`hireFees`/`wagesPaid`/`taskCompletions`), plus the per-kind breakdown
 * already computed server-side rather than re-summing `taskCompletionsByKind` a second way. */
function LaborEvidence({ labor }: { labor: MatchResult['managerLedger']['labor'] }): JSX.Element {
  const kinds = Object.entries(labor.taskCompletionsByKind).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <dl className="recap-evidence-stats">
        <div>
          <dt>Temporary staffing cost</dt>
          <dd>{formatMoney(labor.laborExpenses)}</dd>
        </div>
        <div>
          <dt>Hire fees</dt>
          <dd>{formatMoney(labor.hireFees)}</dd>
        </div>
        <div>
          <dt>Wages paid</dt>
          <dd>{formatMoney(labor.wagesPaid)}</dd>
        </div>
        <div>
          <dt>Tasks completed</dt>
          <dd>{labor.taskCompletions}</dd>
        </div>
      </dl>
      {/* Same `<dl>` content-model reason as `ConstraintEvidence`'s own comment — the per-kind
          breakdown is a sibling list, not a fifth `dl` child. */}
      {kinds.length > 0 ? (
        <ul className="recap-evidence-list">
          {kinds.map(([kind, count]) => (
            <li key={kind}>
              {kind} — {count}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
