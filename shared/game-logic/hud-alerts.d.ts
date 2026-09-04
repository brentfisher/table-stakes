// Type declarations for hud-alerts.js (Decision 4). See that file for the full rationale.

import type { RestaurantSnapshot, CustomerSnapshot, OrderSnapshot, BottleneckKind } from '../schemas/game-state';
import type { SnapshotEventEntry } from '../schemas/messages';

export type AlertCategory =
  | 'customer_abandonment_imminent'
  | 'food_ready_undelivered'
  | 'ingredient_shortage'
  | 'equipment_problem'
  | 'event_countdown'
  | 'upgrade_available'
  | 'general_suggestion';

export declare const ALERT_CATEGORIES: readonly AlertCategory[];

export interface AbandonmentAlertDetail {
  customerId: string;
  tableId: string | null;
  patienceRemaining: number;
}
export interface FoodReadyAlertDetail {
  orderId: string;
  ticketId: string;
  dishId: string;
  tableId: string | null;
  readyAgeMs: number;
}
export interface ShortageAlertDetail {
  station: string;
  ingredientId: string;
  blockedTickets: number;
}
export interface EventCountdownAlertDetail {
  eventId: string;
  startsInMs: number;
}
export interface UpgradeAvailableAlertDetail {
  upgradeId: string | null;
}
export interface GeneralSuggestionAlertDetail {
  bottleneck: BottleneckKind;
}

export interface CriticalAlert {
  key: string;
  category: AlertCategory;
  /** 1 (most urgent) through `ALERT_CATEGORIES.length` (least), PRD §18 order. */
  priority: number;
  detail:
    | AbandonmentAlertDetail
    | FoodReadyAlertDetail
    | ShortageAlertDetail
    | EventCountdownAlertDetail
    | UpgradeAvailableAlertDetail
    | GeneralSuggestionAlertDetail;
}

export declare function buildCriticalAlerts(input: {
  selfRestaurantId: string | null;
  restaurants: RestaurantSnapshot[];
  customers: CustomerSnapshot[];
  orders: OrderSnapshot[];
  events: SnapshotEventEntry[];
  canAffordUpgrade: boolean;
  affordableUpgradeId?: string | null;
}): CriticalAlert[];

export declare function capCriticalAlerts(alerts: CriticalAlert[], maxDisplayed: number): CriticalAlert[];
