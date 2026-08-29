// Runtime enums for the authoritative match state that `match_snapshot` carries.
// PRD §8 "Customer state machine", §17 "Core systems specification".
//
// Plain JavaScript with a sibling game-state.d.ts (design Decision 4): the server owns this
// state and is not TypeScript. The entity SHAPES are declared in game-state.d.ts; only values
// a system compares against at runtime live here.

/**
 * PRD §8 "Customer state machine". The main path is:
 *
 *   ENTER_DISTRICT -> EVALUATE_RESTAURANTS -> APPROACH_OR_QUEUE -> SEATED -> ORDERING
 *   -> WAITING_FOR_FOOD -> EATING -> PAYING -> LEAVING -> REVIEW
 *
 * The PRD writes the terminal step as "REVIEW / REPUTATION_IMPACT". It is modelled here as
 * ONE state, `REVIEW`, because the review and its reputation effect are resolved together in
 * a single step — there is no interval in which a party is post-review but pre-impact.
 */
export const CUSTOMER_STATES = Object.freeze({
  ENTER_DISTRICT: 'ENTER_DISTRICT',
  EVALUATE_RESTAURANTS: 'EVALUATE_RESTAURANTS',
  APPROACH_OR_QUEUE: 'APPROACH_OR_QUEUE',
  SEATED: 'SEATED',
  ORDERING: 'ORDERING',
  WAITING_FOR_FOOD: 'WAITING_FOR_FOOD',
  EATING: 'EATING',
  PAYING: 'PAYING',
  LEAVING: 'LEAVING',
  REVIEW: 'REVIEW',

  // Exit states, PRD §8 "Exit states include:".
  CHOOSE_RIVAL: 'CHOOSE_RIVAL',
  LEAVE_DISTRICT: 'LEAVE_DISTRICT',
  ABANDON_QUEUE: 'ABANDON_QUEUE',
  CANCEL_ORDER: 'CANCEL_ORDER',
  LEAVE_ANGRY: 'LEAVE_ANGRY',
});

/**
 * The five PRD §8 exit states. A party in one of these is out of this restaurant's funnel and
 * must never be counted as served.
 */
export const CUSTOMER_EXIT_STATES = Object.freeze([
  CUSTOMER_STATES.CHOOSE_RIVAL,
  CUSTOMER_STATES.LEAVE_DISTRICT,
  CUSTOMER_STATES.ABANDON_QUEUE,
  CUSTOMER_STATES.CANCEL_ORDER,
  CUSTOMER_STATES.LEAVE_ANGRY,
]);

/** Every customer state, main path first then exits. */
export const CUSTOMER_STATE_LIST = Object.freeze(Object.values(CUSTOMER_STATES));

export function isExitState(state) {
  return CUSTOMER_EXIT_STATES.includes(state);
}

/** PRD §17 "Order system". A ticket walks its dish's stationSteps in order. */
export const ORDER_STATES = Object.freeze([
  'placed',
  'queued',
  'in_progress',
  'ready',
  'delivered',
  'cancelled',
]);

/**
 * PRD §17 "Customer acquisition system": every choice records why, for balance work and the
 * §11 end-of-match explanation layer.
 */
export const DECISION_REASONS = Object.freeze([
  'better_price',
  'better_menu_fit',
  'shorter_projected_wait',
  'higher_reputation',
  'event_affinity',
  'restaurant_full',
  'customer_abandoned_queue',
]);

/** PRD §7 "Staffing setup". MVP runs one cook, one server and the owner-player. */
export const WORKER_ROLES = Object.freeze(['cook', 'server', 'prep_worker', 'host']);

/** PRD §8 "Operational bottlenecks" — the signals the HUD and the harnesses surface. */
export const BOTTLENECK_KINDS = Object.freeze([
  'kitchen_backlog',
  'ingredient_shortage',
  'server_overload',
  'long_entry_queue',
  'unhappy_customer',
  'dirty_table',
  'equipment_failure',
  'cash_opportunity',
]);
