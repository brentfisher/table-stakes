// The one place systems are registered against the tick.
//
// TO ADD A SYSTEM: write `your-system.js` beside this file exporting a system object (see the
// seam documentation at the top of `../simulation-loop.js`), import it here, and add one
// `registerSystem(...)` line below. Nothing else changes — not `match.js`, not
// `simulation-loop.js`, not the message router. That is the whole point of this file: four
// stories fan out in parallel after STORY-003 and they must not collide in one module.
//
// ORDER IS THE CONTRACT. Systems run in the order registered here, identically for every
// match and every tick, so a system may rely on an earlier one having already run this tick.
// The order below is the intended MVP order; when a story inserts itself, it should say in
// its PR why it goes where it goes.
//
//   movement   — owner avatars (STORY-001/003)
//   setup      — STORY-009  (before customers: it is what guarantees a menu exists)
//   customers  — STORY-004
//   orders     — STORY-005  (after customers: an order exists because a party ordered)
//   events     — STORY-011
//   inventory  — STORY-006  (after customers: it decorates the restaurants[] array that system
//                            REASSIGNS wholesale during its own update, so anything written
//                            before it runs is discarded)
//   scoring    — STORY-013  (last: it reads what everything else produced)

import { registerSystem } from '../simulation-loop.js';
import { movementSystem } from './movement-system.js';
import { eventSystem } from './event-system.js';
import { customerSystem } from './customer-system.js';
import { orderSystem } from './order-system.js';
import { setupSystem } from './setup-system.js';
import { inventorySystem } from './inventory-system.js';

export function registerAllSystems() {
  registerSystem(movementSystem);
  // `setup` runs before the gameplay systems: its whole job happens at the setup -> service
  // transition, and it is what guarantees every restaurant HAS a locked, legal menu by the
  // time customers, orders and scoring first tick.
  registerSystem(setupSystem);
  registerSystem(customerSystem);
  // `orders` runs after `customers` because an order only exists because a party ordered: the
  // customer system hands the kitchen a new order during its own update, and the kitchen picks
  // it up in the same tick rather than a tick later.
  registerSystem(orderSystem);
  registerSystem(eventSystem);
  // `inventory` runs after `customers` because it decorates that system's `restaurants[]` with
  // the PRD §8 shortage signal, and `customer-system.js` reassigns that array wholesale in its
  // own update. Running last costs one tick of staleness on `match.dishAvailability`, which the
  // kitchen reads defensively — and costs nothing at the start of service, because
  // `onPhaseChange` runs for every system before any `update`, so the pantry facade and the
  // first availability map exist before `order-system.js` dispatches its first ticket.
  registerSystem(inventorySystem);
  // STORY-013: registerSystem(scoringSystem);
}
