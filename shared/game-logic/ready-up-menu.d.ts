import type { Dish } from '../schemas/setup-rules';

export type ReadyUpStage = 'mains' | 'extras' | 'prices';
export declare const READY_UP_STAGES: readonly ReadyUpStage[];

export interface ReadyUpPayload {
  menu: Array<{ dishId: string; price: number }>;
  addons: Array<{ dishId: string; price: number }>;
  startingUpgradeId: null;
  staffAssignments: Record<string, string>;
  startingInventory: Record<string, number>;
  policyId: null;
  policyDishId: null;
}

export declare function buildReadyUpPayload(input: {
  mainIds: string[];
  extraIds: string[];
  prices: Record<string, number>;
  dishes: Dish[];
  ingredients: Record<string, { unitCost: number }>;
  layout: unknown;
  /** STORY-040. `Match#sharedRestaurant` — a co-op match's empty roster. Defaults to `false`. */
  sharedRestaurant?: boolean;
}): ReadyUpPayload;
