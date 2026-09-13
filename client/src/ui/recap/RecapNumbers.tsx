// STORY-049 "The numbers — financial/service summary and detailed scorecard". The recap
// category (STORY-047's nav shell) that prioritizes the two facts a player actually needs at a
// glance — net profit and service quality — over the old monolithic `ResultsPanel.tsx`'s flat
// `StatColumn` dump. See `docs/table-stakes-recap-menu.zip`'s `06-financial-summary.png` for the
// card layout this follows almost literally: a "business end" card (net profit headline, then
// revenue/expenses, then temp-staff/promotion spend called out as INCLUDED SUBSETS of expenses,
// then the rival's own receipt when `hasRival`) and a "how the floor felt" service-quality card
// (guests/satisfaction/wait, plus the rival's own numbers as a comparison sentence).
//
// SCOPE BOUNDARY WITH STORY-050 (see this story's own KB "Implementation notes" for the fuller
// reasoning): `result.managerLedger.insights` — the "what to change next match" takeaways — is
// STORY-050's "next shift" category, not this one. Nothing in this file or `RecapScorecard.tsx`
// reads `.insights`. Everything else this story's own Notes cited as "existing `StatColumn`/
// score-breakdown content" is fair game, and lives behind the "open detailed scorecard" dialog.
//
// Every number below is a plain read off `MatchResult`/`MatchCompleteMessage` — no derivation
// beyond what `format.ts`'s formatters need (see `ResultsPanel.tsx`'s own file-header discipline,
// which this whole `recap/` directory inherits).

import { useState } from 'react';
import type { MatchResult } from '../../../../shared/schemas/messages';
import { formatMoney, formatMs } from './format';
import { RecapScorecard } from './RecapScorecard';
import type { TurningPoint } from './RecapScorecard';
import type { RecapOutcome } from './recap-types';

export interface RecapNumbersProps {
  result: MatchResult;
  rivalResult: MatchResult | null;
  rivalTitle: string;
  hasRival: boolean;
  turningPoints: TurningPoint[];
  /** Only used to label a turning point's leader "You" vs "Your rival" — see
   * `RecapScorecard.tsx`'s own comment on why this is a plain id compare, not new derivation. */
  selfId: string;
  /** STORY-055. Passed straight through to `RecapScorecard` — see that file's own comment on
   * why "Key turning points" needs the single authoritative outcome, not a second derivation. */
  outcome: RecapOutcome;
}

export function RecapNumbers({
  result,
  rivalResult,
  rivalTitle,
  hasRival,
  turningPoints,
  selfId,
  outcome,
}: RecapNumbersProps): JSX.Element {
  const [scorecardOpen, setScorecardOpen] = useState(false);

  return (
    <div className="recap-numbers">
      <div className="recap-card recap-numbers-financial">
        <h3 className="recap-card-eyebrow">The business end</h3>
        <p className="recap-numbers-label">Your net profit</p>
        <p className={`recap-numbers-hero ${result.netProfit >= 0 ? 'recap-numbers-hero--positive' : 'recap-numbers-hero--negative'}`}>
          {formatMoney(result.netProfit)}
        </p>
        <p className="recap-muted">
          {result.netProfit >= 0
            ? "Revenue covered this shift's expenses."
            : "Revenue didn't cover this shift's expenses."}
        </p>

        <div className="recap-numbers-grid">
          <div>
            <span className="recap-numbers-mini-label">Revenue</span>
            <strong className="recap-numbers-mini-value">{formatMoney(result.revenue)}</strong>
          </div>
          <div>
            <span className="recap-numbers-mini-label">Total expenses</span>
            <strong className="recap-numbers-mini-value">{formatMoney(result.expenses)}</strong>
          </div>
        </div>

        {/* AC1: temp-staff/promotion spend as INCLUDED SUBSETS of `expenses`, not additional
            deductions. `result.laborExpenses`/`result.specialExpenses` — the SAME top-level
            fields `RecapScorecard.tsx`'s main table reads for these two rows, not
            `managerLedger.labor.laborExpenses`/a re-summed `managerLedger.specials[].spend` —
            two different accumulation paths for what must read as one number would let the
            summary card and the dialog one click away silently disagree. `check-scoring.mjs`'s
            own "expenses sum inventory, setup upgrade, service upgrade, and front-door special
            costs" assertion (`p1.expenses === 150 + 50 + 100 + 25 && p1.specialExpenses === 25`)
            is what confirms these are already folded into `expenses`, never subtracted twice. */}
        <div className="recap-numbers-subset-rows">
          <div className="recap-numbers-subset-row">
            <span>Temporary staff</span>
            <span>{formatMoney(result.laborExpenses)}</span>
          </div>
          <div className="recap-numbers-subset-row">
            <span>Front-door promotions</span>
            <span>{formatMoney(result.specialExpenses)}</span>
          </div>
        </div>
        <p className="recap-numbers-subset-note">Staff and promotions are included in total expenses.</p>

        {hasRival && rivalResult ? (
          <div className="recap-numbers-rival-receipt">
            <h4>{rivalTitle}&rsquo;s receipt</h4>
            <div className="recap-numbers-subset-row">
              <span>Revenue</span>
              <span>{formatMoney(rivalResult.revenue)}</span>
            </div>
            <div className="recap-numbers-subset-row">
              <span>Expenses</span>
              <span>{formatMoney(rivalResult.expenses)}</span>
            </div>
            <div className="recap-numbers-subset-row recap-numbers-subset-row--total">
              <span>Net profit</span>
              <span>{formatMoney(rivalResult.netProfit)}</span>
            </div>
          </div>
        ) : null}

        <button type="button" className="recap-numbers-scorecard-link" onClick={() => setScorecardOpen(true)}>
          Open detailed scorecard
        </button>
      </div>

      <div className="recap-card recap-numbers-service">
        <h3 className="recap-card-eyebrow">How the floor felt</h3>
        <p className="recap-numbers-service-headline">More than the scoreboard.</p>

        <div className="recap-numbers-service-grid">
          <div>
            <span className="recap-numbers-mini-label">Guests served</span>
            <strong className="recap-numbers-mini-value">{result.guestsServed}</strong>
          </div>
          <div>
            <span className="recap-numbers-mini-label">Avg. satisfaction</span>
            <strong className="recap-numbers-mini-value">{result.averageSatisfaction}</strong>
          </div>
          <div>
            <span className="recap-numbers-mini-label">Avg. wait</span>
            <strong className="recap-numbers-mini-value">{formatMs(result.averageWaitTimeMs)}</strong>
          </div>
        </div>

        {/* AC2: service-quality numbers "for both this restaurant and the rival when
            hasRival" — a plain sentence, the same narrative-sentence-from-verbatim-fields
            convention `ResultsPanel.tsx` (pre-STORY-047) already used elsewhere on this
            screen, rather than a second three-column grid duplicating the one above. */}
        {hasRival && rivalResult ? (
          <p className="recap-muted recap-numbers-service-compare">
            Your rival served {rivalResult.guestsServed} guest{rivalResult.guestsServed === 1 ? '' : 's'}, with{' '}
            {rivalResult.averageSatisfaction} satisfaction and {formatMs(rivalResult.averageWaitTimeMs)} average
            wait.
          </p>
        ) : null}
      </div>

      {scorecardOpen ? (
        <RecapScorecard
          result={result}
          rivalResult={rivalResult}
          rivalTitle={rivalTitle}
          hasRival={hasRival}
          turningPoints={turningPoints}
          selfId={selfId}
          outcome={outcome}
          onClose={() => setScorecardOpen(false)}
        />
      ) : null}
    </div>
  );
}
