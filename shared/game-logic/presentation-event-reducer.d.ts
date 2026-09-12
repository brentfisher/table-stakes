// Type declarations for presentation-event-reducer.js (Decision 4). See that file for the full
// rationale. PRD-027 §9 "Presentation Event Reducer".

import type { OrderSnapshot } from '../schemas/game-state';
import type { SnapshotEventEntry } from '../schemas/messages';

/**
 * PRD-027 §9's `PresentationEvent` union, reproduced field for field with one deliberate
 * addition: `ticket-ready` also carries `ticketId`. See the file header's own comment on why
 * `orderId` alone (the PRD's literal field list) is not a safe dedup/display identity once a
 * party's order decomposes into more than one ticket — the same distinction
 * `shared/game-logic/hud-alerts.js#foodReadyAlerts` already had to make.
 */
export type PresentationEvent =
  | {
      type: 'ticket-ready';
      orderId: string;
      ticketId: string;
      dishName: string;
      tableId: string;
      readyAgeMs: number;
    }
  | {
      type: 'owner-picked-up';
      orderId: string;
      dishName: string;
      tableId: string;
    }
  | {
      type: 'order-delivered';
      orderId: string;
      dishName: string;
      tableId: string;
      revenue?: number;
    }
  | {
      type: 'event-warning' | 'event-active' | 'event-ended';
      eventId: string;
      title: string;
      description: string;
    }
  | {
      type: 'customer-critical' | 'customer-lost-to-rival' | 'customer-abandoned';
      customerId: string;
      tableId?: string;
    }
  | {
      type: 'ingredient-blocked';
      ingredientId: string;
      stationId: string;
    }
  | {
      /**
       * STORY-031. NOT produced by `reducePresentationEvents` — see the .js file header's own
       * "ONE TYPE IN THE UNION IS NOT PRODUCED HERE AT ALL" comment. `GameClient.ts` builds this
       * directly from an `interact_rejected` error message (`reason` is the server's own
       * `action-validator.js` reason string, e.g. `wrong_table`/`not_ready`) and hands it to
       * `ArcadeToast.tsx` with a freshly-minted key, bypassing `alreadyEmittedKeys` entirely: a
       * rejection is not a state transition, so there is nothing to deduplicate against.
       */
      type: 'delivery-rejected';
      reason: string;
      /**
       * STORY-053 AC6. How many sibling dishes on the carried order are still `queued`/
       * `in_progress`, attached ONLY when `reason === 'not_ready'` AND `GameClient.ts`'s own
       * `kitchenStaging` lookup genuinely found a nonzero count for the carried order — never
       * fabricated for the OTHER things `not_ready` can mean (the defensive `!match.kitchen`
       * guard in `action-validator.js`, or a race where the order was cancelled out from under
       * an already-carried plate), which have nothing real to count. `undefined`, not `0`, is
       * the "no detail available" case — `ArcadeToast.tsx` falls back to the generic string.
       */
      waitingOnCount?: number;
    };

export type PresentationEventType = PresentationEvent['type'];

/**
 * The narrow slice of a `match_snapshot` this reducer actually reads — not the raw wire message
 * — so the pure function stays testable against constructed fragments the same way
 * `hud-alerts.js#buildCriticalAlerts`'s own input shape is. `selfRestaurantId` scopes
 * `ticket-ready` to the viewing player's own kitchen (PRD-027 §7 "React owns screen-space
 * HUD/toasts" for THIS viewer, not the rival's); `events` is match-wide and unfiltered, same as
 * `EventBanner.tsx`'s own read of `match_snapshot.events`.
 */
export interface PresentationSnapshotInput {
  selfRestaurantId: string | null;
  orders: OrderSnapshot[];
  events: SnapshotEventEntry[];
  /**
   * STORY-031. This viewer's OWN owner's `PlayerSnapshot.carrying` (order ids), straight off the
   * wire — read by `detectOwnerPickedUpEvents`/`detectOrderDeliveredEvents` to diff pickup/
   * delivery the same "previous vs. next snapshot" way `orders`/`events` already are. Optional
   * (defaults to `[]` inside the detectors) so existing callers/fixtures built before STORY-031
   * that never pass it keep working unchanged.
   */
  carrying?: string[];
}

/** One reducer output: a `PresentationEvent` plus the stable §9 key it was emitted under. */
export interface EmittedPresentationEvent {
  key: string;
  event: PresentationEvent;
}

/** `presentationType:entityId:stateVersion`, PRD-027 §9's literal key format. */
export declare function presentationEventKey(
  presentationType: string,
  entityId: string,
  stateVersion: string,
): string;

/**
 * Pure diff of `previous` versus `next`. `previous === null` means "no prior snapshot exists yet"
 * (a fresh join/reconnect) and always yields `[]` — see the file header's first-value guard.
 * `alreadyEmittedKeys` is read-only: the caller (GameClient) owns accumulating returned keys into
 * its own Set across calls, the same division of responsibility `hud-cash-feedback.js`'s pure
 * decision function has with its caller's timer/patch side effects.
 */
export declare function reducePresentationEvents(
  previous: PresentationSnapshotInput | null,
  next: PresentationSnapshotInput,
  alreadyEmittedKeys: ReadonlySet<string>,
): EmittedPresentationEvent[];

/**
 * PRD-027 §6.1 "Use the existing service-HUD priority order" — this is THAT order
 * (`shared/game-logic/hud-alerts.js#ALERT_CATEGORIES`), read for a `PresentationEvent` instead of
 * a `CriticalAlert`. 1 is most urgent. See the file header for the full presentation-type-to-
 * category mapping and why `owner-picked-up`/`order-delivered` fall to the lowest tier.
 */
export declare function presentationEventPriority(event: PresentationEvent): number;
