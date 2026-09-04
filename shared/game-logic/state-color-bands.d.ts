// Type declarations for state-color-bands.js (Decision 4). See that file for the full rationale.

export type StateColorBand = 'healthy' | 'attention' | 'bottleneck' | 'critical';
export type StationQueueColorBand = 'healthy' | 'attention' | 'bottleneck';

export declare function patienceColorBand(
  patienceRemaining: number,
  thresholds: { attention: number; bottleneck: number; critical: number },
): StateColorBand;

export declare function stationQueueColorBand(
  queueDepth: number,
  thresholds: { attention: number; bottleneck: number },
): StationQueueColorBand;
