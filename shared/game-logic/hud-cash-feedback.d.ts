// Type declarations for hud-cash-feedback.js (Decision 4). See that file for the full rationale.

export declare function cashFeedbackFor(
  previousRevenue: number | null,
  nextRevenue: number | null,
  minDelta: number,
): { amount: number } | null;
