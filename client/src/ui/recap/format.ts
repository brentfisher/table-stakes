// STORY-047. Number formatting shared across the recap sections — moved out of the old
// monolithic `ResultsPanel.tsx` (STORY-014) so STORY-048/049/050's own category sections import
// the same formatters rather than each re-declaring `formatMoney`/`formatPoints`. Pure
// presentation, no rounding/derivation beyond what the string needs — every number handed to
// these functions must already be the exact value off `MatchResult`, per this whole feature's
// "EVERY NUMBER... VERBATIM" discipline (see `ResultsPanel.tsx`'s own header).

export const formatMoney = (dollars: number): string => `$${dollars.toFixed(2)}`;
export const formatMs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
export const formatPoints = (points: number): string => points.toFixed(1);
export const formatPercent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

// STORY-055. Found live, not guessed: playing a real (dev bot) match to completion produced an
// exact score tie (53.8 vs 53.8, both to `formatPoints`'s own 1-decimal precision AND the raw
// composite score underneath — server log: "tie-break decided on netRevenue") under a decisive
// "You won" heading, with NOTHING on screen explaining why a tied score still produced a winner.
// `MatchCompleteMessage.tieBreakDecided` (`messages.d.ts`'s own comment: PRD §11 "state
// tie-break resolution explicitly rather than silently") exists on the wire for exactly this
// case but was never read by any client component — the PRD's own explicit anti-silence
// requirement was unmet. This is the same FAMILY of bug as the turning-points fix above (a
// results-screen fact left unexplained, inviting a reader to conclude the screen contradicts
// itself) even though it is not literally the reported "loss heading, win elsewhere" shape —
// see this story's own Implementation notes for the live repro.
const TIE_BREAK_CRITERION_LABELS: Record<'averageSatisfaction' | 'guestsServed' | 'netRevenue' | 'abandonedParties', string> = {
  averageSatisfaction: 'average satisfaction',
  guestsServed: 'guests served',
  netRevenue: 'net revenue',
  abandonedParties: 'fewer abandoned parties',
};

export const tieBreakCriterionLabel = (
  criterion: 'averageSatisfaction' | 'guestsServed' | 'netRevenue' | 'abandonedParties',
): string => TIE_BREAK_CRITERION_LABELS[criterion];
