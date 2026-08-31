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
import { OWNER_INTERACT_RANGE } from '../../../shared/constants/tuning';
import type { CustomerSnapshot, InteractAction, OrderSnapshot, RestaurantSnapshot } from '../../../shared/schemas/messages';

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

  setSnapshot(input: InteractionSnapshotInput): void {
    this.restaurantId = input.restaurantId;
    this.restaurant = input.restaurants.find((r) => r.restaurantId === input.restaurantId) ?? null;
    this.orders = input.orders;
    this.customers = input.customers;
    this.carrying = input.carrying;
    this.matchPhase = input.matchPhase;
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
    if (this.carrying.length === 0) return null;
    const orderId = this.carrying[0];
    const order = this.orders.find((o) => o.orderId === orderId);
    if (!order?.tableId) return null;
    const tablePos = this.tablePosition(order.tableId);
    if (!tablePos || distanceXZ(position, tablePos) > OWNER_INTERACT_RANGE) return null;
    return { targetId: order.tableId, action: 'deliver', label: `Deliver ${dishName(order.dishId)}` };
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
    if (this.carrying.length > 0) return null; // AC's one-plate baseline
    if (!this.inRange(position, 'service_pass')) return null;
    const ready = this.orders.find(
      (o) => o.restaurantId === this.restaurantId && o.state === 'ready',
    );
    if (!ready) return null;
    return { targetId: 'service_pass', action: 'pickup', label: `Pick Up ${dishName(ready.dishId)}` };
  }

  private seatCandidate(position: Vec3): InteractionPrompt | null {
    if (!this.inRange(position, 'host_stand')) return null;
    const waiting = this.customers.some(
      (c) => c.restaurantId === this.restaurantId && c.state === 'APPROACH_OR_QUEUE',
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
