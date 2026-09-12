// STORY-053 "Kitchen staging — don't show an incomplete order's early dishes as neglected".
//
// Reported: "if the entire table's food isn't ready, you can't deliver it... I don't like seeing
// the food queuing up that it's getting cold." Investigated: the all-or-nothing delivery rule
// (`order-system.js#allTicketsOffTheLine` gates `order.state -> 'ready'`, and therefore
// pickup/delivery, until EVERY ticket on the order is off the line) is correct and intentional —
// a deliberate "serve the table together" design. This story does not touch that rule. The
// actual bug is presentation: a ticket that finishes cooking early is rendered at the pass with
// the exact same READY/GOING COLD chip a genuinely deliverable dish gets, which misleadingly
// reads as "you forgot to pick this up and it's spoiling" instead of "the kitchen isn't done with
// this table yet." This module computes what the pass display needs to tell the difference.
//
// Extracted into its own pure module the same way `recap-highlights.js`/`district-population.js`
// were (Decision 4's plain-JS-plus-`.d.ts` shape) rather than inlined in `GameClient.ts`: this
// makes the grouping logic checkable by a real `check-orders.mjs` assertion (pure data in, data
// out) instead of only reachable via `tsc --noEmit`/manual browser verification, and gives
// `GameClient.ts` (client TypeScript) and `scripts/check-orders.mjs` (plain Node) their only two
// callers — neither can import the other's runtime.
//
// Input is the FULL per-restaurant `orders[]` snapshot array (`OrderSnapshot[]`, one entry per
// TICKET, every state — NOT pre-filtered to `state === 'ready'`) because "how many siblings are
// still outstanding" needs to see the still-cooking ones too. `orders[]` carries no
// `order.tickets` grouping on the wire — that is server-internal shape, never published (see
// `order-system.js`'s own "public projection" header) — so this groups the flat per-ticket array
// by `orderId` itself, client-side, from data already sent (no new wire field).

/**
 * @param {Array<{ticketId: string, orderId: string, state: string}>} orders
 *   The full per-restaurant `orders[]` snapshot array, every ticket in every state.
 * @returns {Array<{ticketId: string, orderId: string, staged: boolean, waitingOnCount: number}>}
 *   One entry per `state === 'ready'` ticket in `orders`. `staged` is true iff at least one OTHER
 *   ticket sharing its `orderId` is still `'queued'` or `'in_progress'` — the precise logical
 *   inverse of `order-system.js#allTicketsOffTheLine`'s own predicate
 *   (`order.tickets.every((t) => t.state === 'ready' || t.state === 'cancelled')`), applied here
 *   per-order from the flat snapshot array instead of the server's internal `order.tickets` list,
 *   so this display logic's definition of "order complete" can never quietly drift from the
 *   server's real one. `waitingOnCount` is how many such outstanding siblings there are.
 */
export function kitchenStaging(orders) {
  const byOrder = new Map();
  for (const ticket of orders) {
    const group = byOrder.get(ticket.orderId);
    if (group) group.push(ticket);
    else byOrder.set(ticket.orderId, [ticket]);
  }

  const out = [];
  for (const ticket of orders) {
    if (ticket.state !== 'ready') continue;
    const siblings = byOrder.get(ticket.orderId) ?? [];
    // `ticket` itself is already known to be 'ready' (the filter above), so it can never appear
    // in this count — no separate self-exclusion needed. 'cancelled' siblings don't count either
    // (a voided dish is off the line, same as `allTicketsOffTheLine` treats it).
    const outstanding = siblings.filter((t) => t.state === 'queued' || t.state === 'in_progress');
    out.push({
      ticketId: ticket.ticketId,
      orderId: ticket.orderId,
      staged: outstanding.length > 0,
      waitingOnCount: outstanding.length,
    });
  }
  return out;
}
