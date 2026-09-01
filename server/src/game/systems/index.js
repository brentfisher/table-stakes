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
//   workers    — STORY-007  (after inventory: same decoration trap, plus it reads the freshest
//                            shortage state when the cook decides whether to walk to the pantry)
//   upgrades   — STORY-012  (last of the gameplay systems: republishes `match.upgradeEffects`
//                            fresh every tick, so the tick AFTER a purchase is the first one
//                            other systems see it — one tick (50ms) of staleness, the same
//                            class `inventory`/`workers` already accept. Facade calls made
//                            directly off `match.upgrades` — the carry-capacity check in
//                            `action-validator.js`, a purchase itself — are never stale; only
//                            the three systems that read the republished `match.upgradeEffects`
//                            map inside their own tick are.)
//   scoring    — STORY-013  (last: it reads what everything else produced)

import { registerSystem } from '../simulation-loop.js';
import { movementSystem } from './movement-system.js';
import { eventSystem } from './event-system.js';
import { customerSystem } from './customer-system.js';
import { orderSystem } from './order-system.js';
import { setupSystem } from './setup-system.js';
import { inventorySystem } from './inventory-system.js';
import { workerSystem } from './worker-system.js';
import { upgradeSystem } from './upgrade-system.js';

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
  // `workers` runs LAST for two reasons. It decorates `restaurants[]` with `workers[]`, and both
  // `customer-system.js` (which reassigns that array wholesale) and `inventory-system.js` must
  // already have run or the decoration is discarded. And the cook's §17 rule 4 decision — is any
  // bin worth a trip to the pantry — is read from `match.pantry` AFTER this tick's restock
  // progress and shortage recomputation, so the cook never sets off for a bin that was filled
  // earlier in the same tick. The cost is one tick (50ms) of dispatch latency: a ticket the cook
  // loads is started here and burns its first `dtMs` next tick. That is the same staleness class
  // `inventory` already documents and accepts, and it is invisible at a 10 Hz broadcast.
  registerSystem(workerSystem);
  // `upgrades` runs last of the gameplay systems — see the header comment above.
  registerSystem(upgradeSystem);
  // STORY-013: registerSystem(scoringSystem);
}
