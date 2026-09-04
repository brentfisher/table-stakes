// Mocked state generators. The whole point of a harness is that it runs on state a human
// dialed in rather than state a live match produced (PRD §15).

import type { OwnerRenderState } from '../../../client/src/scenes/RestaurantScene';
import type { OrderSnapshot, RestaurantSnapshot } from '../../../shared/schemas/game-state';

export function mockOwner(
  playerId: string,
  x: number,
  z: number,
  facing = 0,
  isSelf = false,
): OwnerRenderState {
  return { playerId, position: { x, y: 0, z }, facing, isSelf };
}

/** Walks a mock owner in a slow circle so movement and camera follow can be eyeballed. */
export function orbitOwner(
  base: OwnerRenderState,
  elapsedSeconds: number,
  radius = 4,
): OwnerRenderState {
  const angle = elapsedSeconds * 0.6;
  return {
    ...base,
    position: { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius - 3 },
    facing: -angle + Math.PI / 2,
  };
}

/**
 * STORY-016 PRD §8 "distinct signals for each" bottleneck. A hand-built snapshot fragment that
 * puts a real kitchen backlog at `prep` (5 queued, unblocked tickets — over
 * `HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD`) beside a pure ingredient shortage at `grill`
 * (2 tickets, all blocked — zero real queue). `RestaurantScene#updateFloorState` renders these
 * two differently on purpose: a growing orange box-stack at `prep`, a fixed red `!` glyph and NO
 * boxes at `grill`. Live two-restaurant play could not reliably reproduce this side by side in
 * one frame (the district choice model stops sending customers to a restaurant with ANY
 * zero-stock ingredient, so a genuine shortage rarely coincides with an active queue elsewhere on
 * the same floor) — this harness fixture is the actual comparison the AC asserts.
 */
export function mockShortageVsQueueDemo(restaurantId: string): {
  restaurants: RestaurantSnapshot[];
  orders: OrderSnapshot[];
} {
  const prepBacklog: OrderSnapshot[] = Array.from({ length: 5 }, (_, i) => ({
    orderId: `demo_prep_order_${i}`,
    ticketId: `demo_prep_ticket_${i}`,
    restaurantId,
    customerId: `demo_customer_${i}`,
    tableId: null,
    dishId: 'smash_burger',
    price: 14,
    state: 'queued',
    station: 'prep',
    currentStepIndex: 0,
    remainingMs: 0,
    readyAgeMs: 0,
    blockedByIngredientId: null,
  }));
  const grillShortage: OrderSnapshot[] = Array.from({ length: 2 }, (_, i) => ({
    orderId: `demo_grill_order_${i}`,
    ticketId: `demo_grill_ticket_${i}`,
    restaurantId,
    customerId: `demo_customer_grill_${i}`,
    tableId: null,
    dishId: 'smash_burger',
    price: 14,
    state: 'queued',
    station: 'grill',
    currentStepIndex: 0,
    remainingMs: 0,
    readyAgeMs: 0,
    blockedByIngredientId: 'ground_beef',
  }));
  const restaurant: RestaurantSnapshot = {
    restaurantId,
    playerId: restaurantId,
    reputation: 60,
    queueLength: 0,
    seatsTotal: 12,
    seatsAvailable: 12,
    projectedWaitMs: 0,
    guestsServed: 0,
    averageSatisfaction: 0,
    abandonedParties: 0,
    tables: [],
    shortages: [
      { station: 'grill', ingredientId: 'ground_beef', blockedTickets: 2, restocking: false, exhausted: false },
    ],
  };
  return { restaurants: [restaurant], orders: [...prepBacklog, ...grillShortage] };
}
