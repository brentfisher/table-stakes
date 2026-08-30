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
//   scoring    — STORY-013  (last: it reads what everything else produced)

import { registerSystem } from '../simulation-loop.js';
import { movementSystem } from './movement-system.js';
import { eventSystem } from './event-system.js';
import { customerSystem } from './customer-system.js';
import { setupSystem } from './setup-system.js';

export function registerAllSystems() {
  registerSystem(movementSystem);
  // `setup` runs before the gameplay systems: its whole job happens at the setup -> service
  // transition, and it is what guarantees every restaurant HAS a locked, legal menu by the
  // time customers, orders and scoring first tick.
  registerSystem(setupSystem);
  registerSystem(customerSystem);
  // STORY-005: registerSystem(orderSystem);
  registerSystem(eventSystem);
  // STORY-013: registerSystem(scoringSystem);
}
