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
//   customers  — STORY-004
//   orders     — STORY-005  (after customers: an order exists because a party ordered)
//   events     — STORY-011
//   scoring    — STORY-013  (last: it reads what everything else produced)

import { registerSystem } from '../simulation-loop.js';
import { movementSystem } from './movement-system.js';
import { eventSystem } from './event-system.js';

export function registerAllSystems() {
  registerSystem(movementSystem);
  // STORY-004: registerSystem(customerSystem);
  // STORY-005: registerSystem(orderSystem);
  registerSystem(eventSystem);
  // STORY-013: registerSystem(scoringSystem);
}
