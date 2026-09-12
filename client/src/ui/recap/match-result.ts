// STORY-047. `isScored` moved out of the old monolithic `ResultsPanel.tsx` (STORY-014) so every
// recap section component (this story's `RecapHighlights.tsx`, and STORY-048/049/050's own
// sections) can narrow a `MatchResult | Record<string, never>` the same way, rather than each
// re-declaring the same `'score' in result` check.

import type { MatchResult } from '../../../../shared/schemas/messages';

/** True once the payload carries a real `MatchResult` rather than the §12 `{}` fallback a
 * disconnect-triggered end sends (see match.js's own comment on `matchCompleteMessage`). */
export function isScored(result: MatchResult | Record<string, never>): result is MatchResult {
  return 'score' in result;
}
