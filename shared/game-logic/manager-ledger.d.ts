export type ManagerConstraintId =
  | 'demand_conversion'
  | 'seating_service'
  | 'production'
  | 'inventory'
  | 'prioritization';
export type ManagerConstraintStatus = 'clear' | 'watch' | 'limiting';
export interface ManagerConstraintInput {
  chosenParties: number; lostToRival: number; leftDistrict: number;
  queueLength: number; longQueueThreshold: number; dirtyTables: number; unhappyGuests: number;
  queuedTickets: number; kitchenQueueThreshold: number; oldestReadyFoodMs: number; freshnessGraceMs: number;
  blockingTickets: number; unavailableDishes: number; pantryRisk: 'STOCKED' | 'WATCH' | 'AT RISK' | 'BLOCKING';
  activeFocusId: string; recommendedFocusId: string;
}
export interface ManagerConstraintSnapshot {
  id: ManagerConstraintId; score: number; status: ManagerConstraintStatus; evidence: string;
}
export declare const MANAGER_CONSTRAINT_IDS: readonly ManagerConstraintId[];
export declare function classifyManagerConstraints(input: ManagerConstraintInput): {
  constraints: ManagerConstraintSnapshot[];
  dominantConstraint: ManagerConstraintId | null;
};
