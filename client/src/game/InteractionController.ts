// PRD §8 "The interaction system should be contextual": resolves the single highest-value
// valid target within `OWNER_INTERACT_RANGE` of the owner and produces one prompt string in
// the `E — <verb> <object>` form. Pure game-logic, no React and no Three.js object — PRD §15's
// "game rules emit state, scene-view renders state" split, applied to input resolution the same
// way `InputController` applies it to key state.
//
// THIS DOES NOT DECIDE ANYTHING. Every candidate check here is a cheap, OPTIMISTIC read of the
// last snapshot, good enough to show a plausible prompt — never the authority.
// `action-validator.js` re-derives range, existence and legality server-side from its own
// facades and is free to reject an `interact` this controller thought was valid; the owner
// learns that from the dev log's `interact_rejected`, exactly as a `setup_rejected` surfaces a
// setup screen's own optimism being wrong. Decision 2's "the client never resolves an action"
// stops at "which button lights up", never reaches "what happens when it is pressed".
//
// PRIORITY, NOT NEAREST. When two targets are both in range (a dirty table next to an unhappy
// party's table, say), the choice is a short ordered list — the same "simple, explainable, not
// a scoring heuristic" rule PRD §17 states for the worker AI, applied here because this is the
// same kind of decision. Delivering a plate that is losing freshness and consoling a party about
// to walk both cost the player something if ignored; restocking rarely does at the moment it
// becomes available. The list below is that ordering.

import dishesData from '../../../shared/game-data/dishes.json';
import layoutData from '../../../shared/game-data/restaurant-layout.json';
import { OWNER_DELIVERY_RANGE, OWNER_INTERACT_RANGE } from '../../../shared/constants/tuning';
import type { CustomerSnapshot, InteractAction, OrderSnapshot, RestaurantSnapshot } from '../../../shared/schemas/messages';
// STORY-053. `pickupCandidate` below used to re-derive "every ticket on this order is
// ready/cancelled" independently (a THIRD expression of `order-system.js#allTicketsOffTheLine`'s
// rule, alongside this story's own new pass-display logic) — now shares the one client-side
// grouping function both places need, so the rule can only drift in one place if it ever does.
import { kitchenStaging } from '../../../shared/game-logic/kitchen-staging';

interface DishInfo {
  id: string;
  name: string;
}
const DISH_BY_ID = new Map<string, DishInfo>(
  (dishesData.dishes as DishInfo[]).map((dish) => [dish.id, dish]),
);
const dishName = (dishId: string | null): string => (dishId ? DISH_BY_ID.get(dishId)?.name ?? dishId : 'order');

interface LayoutEntity {
  id: string;
  type: string;
  station?: string;
  position: [number, number, number];
  /** STORY-012. `upgrade_terminal` is the one entity that declares its own interaction radius
   * in the layout, rather than using the owner's general `OWNER_INTERACT_RANGE` — it is a
   * fixed, single, always-known target, not a family of targets a generic range constant fits. */
  interactionRadius?: number;
}
const ENTITY_BY_ID = new Map<string, LayoutEntity>(
  (layoutData.entities as LayoutEntity[]).map((entity) => [entity.id, entity]),
);
const STATIONS = ['prep', 'grill', 'oven', 'plating'];

export interface InteractionPrompt {
  targetId: string;
  action: InteractAction;
  /** The verb + object half of §8's `E — Cook Smash Burger`; the HUD supplies the `E — `. */
  label: string;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** One frame's worth of what the controller needs, refreshed once per `match_snapshot` — see
 * `GameClient`'s call site, which is the only caller of `setSnapshot`. */
export interface InteractionSnapshotInput {
  restaurantId: string | null;
  restaurants: RestaurantSnapshot[];
  orders: OrderSnapshot[];
  customers: CustomerSnapshot[];
  carrying: string[];
  /** `action-validator.js` rejects every interact outside service/final_rush (`wrong_phase`) —
   * mirrored here so the prompt never offers an action the server is certain to refuse. */
  matchPhase: string | null;
  /** STORY-012. `OWNER_CARRY_CAPACITY` unless a Serving Tray upgrade raised it — read off the
   * owner's own public `PlayerSnapshot.carryCapacity` rather than duplicated here. */
  carryCapacity: number;
}

const INTERACT_PHASES = new Set(['service', 'final_rush']);

const distanceXZ = (a: Vec3, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

export class InteractionController {
  private restaurantId: string | null = null;
  private restaurant: RestaurantSnapshot | null = null;
  private orders: OrderSnapshot[] = [];
  private customers: CustomerSnapshot[] = [];
  private carrying: string[] = [];
  private matchPhase: string | null = null;
  private carryCapacity = 1;

  setSnapshot(input: InteractionSnapshotInput): void {
    this.restaurantId = input.restaurantId;
    this.restaurant = input.restaurants.find((r) => r.restaurantId === input.restaurantId) ?? null;
    this.orders = input.orders;
    this.customers = input.customers;
    this.carrying = input.carrying;
    this.matchPhase = input.matchPhase;
    this.carryCapacity = input.carryCapacity;
  }

  /**
   * STORY-012. Whether the owner is close enough to the upgrade terminal to browse it.
   * Deliberately separate from `resolve()`/the `E —` prompt system: the terminal has no single
   * verb+object action, it is a browse-and-pick affordance, so walking into range opens the
   * shop overlay directly rather than requiring an `E` press first.
   */
  nearUpgradeTerminal(position: Vec3): boolean {
    const entity = ENTITY_BY_ID.get('upgrade_terminal');
    if (!entity) return false;
    const radius = entity.interactionRadius ?? OWNER_INTERACT_RANGE;
    return distanceXZ(position, this.entityVec(entity)) <= radius;
  }

  /**
   * STORY-042. Which station (by name, e.g. `'grill'`) the owner is close enough to browse a
   * "what to cook here" menu for, or null. Same `nearUpgradeTerminal` shape — a proximity read,
   * not a prompt — deliberately kept OUT of `resolve()`'s candidate list: `stationCandidate`
   * already owns the single-tap `E — Cook X` prompt for non-co-op play, and this method adds a
   * second, independent read of the exact same range check rather than touching that list, so a
   * non-co-op match's existing prompt behavior is provably unaffected by this story (AC4). The
   * four station entities sit `>=4` apart on the x axis versus `OWNER_INTERACT_RANGE`'s `2.2`,
   * so at most one station can ever be in range at once — first match in `STATIONS` order wins,
   * same as `cookCandidate`'s own loop.
   */
  nearStation(position: Vec3): string | null {
    for (const station of STATIONS) {
      if (this.inRange(position, `station_${station}`)) return station;
    }
    return null;
  }

  /** The owner's own position/facing, sampled the same way the render loop samples it —
   * interpolated, not raw server state, since this is a UX hint and the small playback delay
   * (`StateInterpolator`'s ~110ms) is invisible at prompt-refresh cadence. */
  resolve(ownerPosition: Vec3): InteractionPrompt | null {
    if (!this.restaurantId) return null;
    if (!this.matchPhase || !INTERACT_PHASES.has(this.matchPhase)) return null;
    const candidates = [
      this.deliverCandidate(ownerPosition),
      this.handleComplaintCandidate(ownerPosition),
      this.clearTableCandidate(ownerPosition),
      this.pickupCandidate(ownerPosition),
      this.seatCandidate(ownerPosition),
      this.plateCandidate(ownerPosition),
      this.cookCandidate(ownerPosition),
      this.restockCandidate(ownerPosition),
    ];
    // First non-null wins: the array above IS the priority order, not sorted by anything else.
    for (const candidate of candidates) {
      if (candidate) return candidate;
    }
    return null;
  }

  private inRange(position: Vec3, entityId: string): boolean {
    const entity = ENTITY_BY_ID.get(entityId);
    return entity !== undefined && distanceXZ(position, this.entityVec(entity)) <= OWNER_INTERACT_RANGE;
  }

  /** Shared proximity read for command-post overlays; it never authorizes an action. */
  inRangeOf(position: Vec3, entityId: string): boolean {
    return this.inRange(position, entityId);
  }

  private entityVec(entity: LayoutEntity): Vec3 {
    const [x, y, z] = entity.position;
    return { x, y, z };
  }

  private tablePosition(tableId: string): Vec3 | null {
    const table = this.restaurant?.tables.find((t) => t.id === tableId);
    const layoutTable = ENTITY_BY_ID.get(tableId);
    if (!table || !layoutTable) return null;
    return this.entityVec(layoutTable);
  }

  private deliverCandidate(position: Vec3): InteractionPrompt | null {
    // STORY-012. Carrying more than one order (Serving Tray) means the nearest one's table, not
    // always `carrying[0]`'s, is the one actually in range.
    for (const orderId of this.carrying) {
      const order = this.orders.find((o) => o.orderId === orderId);
      if (!order?.tableId) continue;
      const tablePos = this.tablePosition(order.tableId);
      if (!tablePos || distanceXZ(position, tablePos) > OWNER_DELIVERY_RANGE) continue;
      return { targetId: order.tableId, action: 'deliver', label: `Deliver ${dishName(order.dishId)}` };
    }
    return null;
  }

  private handleComplaintCandidate(position: Vec3): InteractionPrompt | null {
    const unhappy = this.customers.find(
      (c) => c.restaurantId === this.restaurantId && c.unhappy && c.tableId,
    );
    if (!unhappy?.tableId) return null;
    const tablePos = this.tablePosition(unhappy.tableId);
    if (!tablePos || distanceXZ(position, tablePos) > OWNER_INTERACT_RANGE) return null;
    return { targetId: unhappy.tableId, action: 'handle_complaint', label: 'Handle Complaint' };
  }

  private clearTableCandidate(position: Vec3): InteractionPrompt | null {
    const dirty = this.restaurant?.tables.find((t) => t.dirty);
    if (!dirty) return null;
    const tablePos = this.tablePosition(dirty.id);
    if (!tablePos || distanceXZ(position, tablePos) > OWNER_INTERACT_RANGE) return null;
    return { targetId: dirty.id, action: 'clear_table', label: 'Clear Table' };
  }

  private pickupCandidate(position: Vec3): InteractionPrompt | null {
    // STORY-012. `OWNER_CARRY_CAPACITY` baseline unless a Serving Tray upgrade raised it.
    if (this.carrying.length >= this.carryCapacity) return null;
    if (!this.inRange(position, 'service_pass')) return null;
    // A party's order can decompose into several tickets (one per dish) sharing one `orderId`,
    // and `order-system.js#readyOrders` — the pool the real `pickup` interact reads — only
    // offers an order once EVERY ticket on it is `ready` (or `cancelled`); STORY-031's
    // `carrying[]` treats a whole order as one carry slot, not one dish. A single ticket can
    // individually be `ready` (and render READY/GOING COLD at the pass, STORY-030) while a
    // sibling dish on the same order is still cooking — offering "E to pick up" then looks
    // legitimate but the server silently rejects it `nothing_ready`. STORY-053's
    // `kitchenStaging` computes exactly this ("does a `ready` ticket have a sibling still
    // `queued`/`in_progress`?") for the pass display, so this prompt now reads the SAME function
    // instead of re-deriving the rule a third time (`allTicketsOffTheLine` being the first) —
    // only offer the prompt for a `ready` ticket whose order is NOT staged.
    const mine = this.orders.filter((o) => o.restaurantId === this.restaurantId);
    const stagingByTicketId = new Map(kitchenStaging(mine).map((s) => [s.ticketId, s]));
    let best: OrderSnapshot | null = null;
    for (const ticket of mine) {
      if (ticket.state !== 'ready') continue;
      if (stagingByTicketId.get(ticket.ticketId)?.staged) continue;
      if (!best || ticket.readyAgeMs > best.readyAgeMs) best = ticket;
    }
    if (!best) return null;
    return { targetId: 'service_pass', action: 'pickup', label: `Pick Up ${dishName(best.dishId)}` };
  }

  private seatCandidate(position: Vec3): InteractionPrompt | null {
    if (!this.inRange(position, 'host_stand')) return null;
    const waiting = this.customers.some(
      (c) => c.restaurantId === this.restaurantId && c.state === 'APPROACH_OR_QUEUE' && c.readyToSeat,
    );
    if (!waiting) return null;
    return { targetId: 'host_stand', action: 'seat', label: 'Seat Party' };
  }

  private stationCandidate(position: Vec3, station: string, action: 'cook' | 'plate'): InteractionPrompt | null {
    const targetId = `station_${station}`;
    if (!this.inRange(position, targetId)) return null;
    const queued = this.orders.find(
      (o) => o.restaurantId === this.restaurantId && o.station === station && o.state === 'queued',
    );
    if (!queued) return null;
    const verb = action === 'plate' ? 'Plate' : 'Cook';
    return { targetId, action, label: `${verb} ${dishName(queued.dishId)}` };
  }

  private plateCandidate(position: Vec3): InteractionPrompt | null {
    return this.stationCandidate(position, 'plating', 'plate');
  }

  private cookCandidate(position: Vec3): InteractionPrompt | null {
    for (const station of STATIONS) {
      if (station === 'plating') continue;
      const found = this.stationCandidate(position, station, 'cook');
      if (found) return found;
    }
    return null;
  }

  private restockCandidate(position: Vec3): InteractionPrompt | null {
    if (!this.inRange(position, 'pantry')) return null;
    const [shortage] = this.restaurant?.shortages ?? [];
    if (!shortage) return null;
    return {
      targetId: 'pantry',
      action: 'restock',
      label: `Restock ${shortage.ingredientId.replace(/_/g, ' ')}`,
    };
  }
}
