// The authoritative tick, and the seam every gameplay system attaches to.
//
// PRD §12 "Tick target": simulate at 10-20 Hz, broadcast at 10 Hz, and let the client
// interpolate between snapshots. Both rates come from tuning.js (Decision 3); nothing in the
// server may start a timer of its own.
//
// ============================================================================================
// THE SYSTEM-REGISTRATION SEAM  (STORY-003 — cite this block)
// ============================================================================================
// Stories 004 (customers), 005 (orders), 009 (setup) and 011 (events) all need to run code on
// the tick and to read the current phase. If each did that by editing `match.js`, four
// parallel branches would collide in one file. They don't have to. Adding a system is:
//
//   1. a new file under `server/src/game/systems/`, exporting a system object, and
//   2. one line in `server/src/game/systems/index.js`.
//
// Nothing in `match.js` and nothing in this file changes. A system object is:
//
//   export const customerSystem = {
//     id: 'customers',                       // unique, snake_case, appears in boot logs
//     phases: ['service', 'final_rush'],     // OMIT the key to run in every phase
//     update(match, dtMs) { ... },           // required
//     onPhaseChange(match, transition) {},   // optional: {from, to, atMs}
//   };
//
// Reading the phase: `match.phase` is the current phase, `match.timeRemainingMs` the ms left
// in it (null in `lobby`), and `match.isServicePhase` covers service + final_rush. Declaring
// `phases` is the same check written once — a system with `phases` simply is not called
// outside them, so it needs no phase guard of its own.
//
// Sending a message: push it with `match.enqueue(message)`. The loop drains the outbox after
// the systems run and broadcasts it to the room. A system never touches a socket.
//
// Deterministic draws: `match.createRngStream('your_system')` — seed-derived, reproducible,
// and independent of what any other system draws.
//
// ORDER IS THE CONTRACT. Systems run in registration order, which is the array order in
// `systems/index.js`, the same order for every match and every tick. STORY-005 will care that
// customers ticked before orders; the place to express that is the array.
//
// Guarantees, in tick order:
//   1. `match.advanceClock(dtMs)` runs FIRST, so every system sees the phase for this tick,
//      never the previous one.
//   2. `onPhaseChange` fires for each transition, in order, before any `update` this tick.
//   3. `update(match, dtMs)` runs for each system whose `phases` admit the current phase.
//   4. the outbox is drained and broadcast.
//   5. at the broadcast interval, one snapshot PER VIEWER is built and sent.
// Nothing after step 1 can observe a stale phase or a stale `timeRemainingMs`.
// ============================================================================================

import { SIMULATION_TICK_HZ, BROADCAST_HZ } from '../../../shared/constants/tuning.js';
import { MATCH_PHASES } from '../../../shared/schemas/messages.js';
import * as store from '../persistence/in-memory-store.js';

const TICK_MS = 1000 / SIMULATION_TICK_HZ;
const BROADCAST_MS = 1000 / BROADCAST_HZ;

let timer = null;
let lastTick = 0;
let sinceBroadcast = 0;

/** Registered systems, in the order they will run. */
const systems = [];

/**
 * Register one system against the tick. Throws at boot rather than misbehaving at runtime:
 * a duplicate id or a missing `update` is a wiring mistake, and the only good time to find
 * out is before the listener opens.
 */
export function registerSystem(system) {
  if (!system || typeof system !== 'object') {
    throw new Error('registerSystem(system): expected a system object');
  }
  if (typeof system.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(system.id)) {
    throw new Error(`registerSystem: id must be a snake_case string, got ${JSON.stringify(system.id)}`);
  }
  if (systems.some((s) => s.id === system.id)) {
    throw new Error(`registerSystem: duplicate system id "${system.id}"`);
  }
  if (typeof system.update !== 'function') {
    throw new Error(`registerSystem[${system.id}]: update(match, dtMs) must be a function`);
  }
  if (system.onPhaseChange !== undefined && typeof system.onPhaseChange !== 'function') {
    throw new Error(`registerSystem[${system.id}]: onPhaseChange must be a function when present`);
  }
  if (system.phases !== undefined) {
    if (!Array.isArray(system.phases) || system.phases.length === 0) {
      throw new Error(`registerSystem[${system.id}]: phases must be a non-empty array, or omitted`);
    }
    for (const phase of system.phases) {
      if (!MATCH_PHASES.includes(phase)) {
        throw new Error(`registerSystem[${system.id}]: unknown phase "${phase}"`);
      }
    }
  }
  systems.push(system);
  return system;
}

/** The registered systems in run order. For boot logging and for scripts/. */
export function registeredSystems() {
  return [...systems];
}

/** Drop every registration. Exists for scripts that drive the loop in-process. */
export function clearSystems() {
  systems.length = 0;
}

function runsInPhase(system, phase) {
  return system.phases === undefined || system.phases.includes(phase);
}

/**
 * Advance one match by `dtMs`: clock first, then phase-change hooks, then systems, then the
 * outbox. Exported so a script can step a match deterministically without sockets or a timer.
 */
export function stepMatch(match, dtMs, { onOutbound } = {}) {
  const transitions = match.advanceClock(dtMs);

  for (const transition of transitions) {
    for (const system of systems) {
      if (system.onPhaseChange) system.onPhaseChange(match, transition);
    }
  }

  if (!match.ended) {
    for (const system of systems) {
      if (runsInPhase(system, match.phase)) system.update(match, dtMs);
    }
  }

  const outbound = match.drainOutbox();
  if (onOutbound) for (const message of outbound) onOutbound(message);
  return { transitions, outbound };
}

/**
 * @param {object} io
 * @param {(room: object, message: object) => void} io.broadcast          same object to all sockets
 * @param {(room: object, build: (playerId: string|null) => object) => void} io.broadcastPerViewer
 */
export function startSimulationLoop({ broadcast, broadcastPerViewer }) {
  if (timer) return timer;
  lastTick = Date.now();

  timer = setInterval(() => {
    const now = Date.now();
    const dtMs = now - lastTick;
    lastTick = now;

    for (const room of store.listRooms()) {
      stepMatch(room.match, dtMs, {
        onOutbound: (message) => {
          if (room.sockets.size > 0) broadcast(room, message);
        },
      });
    }

    sinceBroadcast += dtMs;
    if (sinceBroadcast >= BROADCAST_MS) {
      sinceBroadcast = 0;
      for (const room of store.listRooms()) {
        // One snapshot per viewer: the `you` slice differs per player, and PRD §18 forbids
        // ever building it any other way.
        if (room.sockets.size > 0) {
          broadcastPerViewer(room, (playerId) => room.match.toSnapshot(playerId));
        }
      }
    }
  }, TICK_MS);

  console.log(
    `[sim] loop started: tick=${SIMULATION_TICK_HZ}Hz broadcast=${BROADCAST_HZ}Hz ` +
      `systems=[${systems.map((s) => s.id).join(', ') || 'none'}]`,
  );
  return timer;
}

export function stopSimulationLoop() {
  if (timer) clearInterval(timer);
  timer = null;
}
