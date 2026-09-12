// Type declarations for kitchen-staging.js (Decision 4). See that file for the full rationale.

import type { OrderState } from '../schemas/game-state';

export interface KitchenStagingTicket {
  ticketId: string;
  orderId: string;
  state: OrderState;
}

export interface KitchenStagingEntry {
  ticketId: string;
  orderId: string;
  staged: boolean;
  waitingOnCount: number;
}

export declare function kitchenStaging(
  orders: KitchenStagingTicket[],
): KitchenStagingEntry[];
