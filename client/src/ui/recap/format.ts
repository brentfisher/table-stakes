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
