// The authoritative tick. PRD §12 "Tick target": simulate at 10-20 Hz, broadcast at 10 Hz,
// and let the client interpolate between snapshots. Every system added by a later story
// hangs off this loop rather than starting a timer of its own.

import { SIMULATION_TICK_HZ, BROADCAST_HZ } from '../../../shared/constants/tuning.js';
import * as store from '../persistence/in-memory-store.js';

const TICK_MS = 1000 / SIMULATION_TICK_HZ;
const BROADCAST_MS = 1000 / BROADCAST_HZ;

let timer = null;
let lastTick = 0;
let sinceBroadcast = 0;

export function startSimulationLoop({ broadcast }) {
  if (timer) return timer;
  lastTick = Date.now();

  timer = setInterval(() => {
    const now = Date.now();
    const dtMs = now - lastTick;
    lastTick = now;

    for (const room of store.listRooms()) {
      room.match.tick(dtMs);
    }

    sinceBroadcast += dtMs;
    if (sinceBroadcast >= BROADCAST_MS) {
      sinceBroadcast = 0;
      for (const room of store.listRooms()) {
        if (room.sockets.size > 0) broadcast(room, room.match.toSnapshot());
      }
    }
  }, TICK_MS);

  console.log(`[sim] loop started: tick=${SIMULATION_TICK_HZ}Hz broadcast=${BROADCAST_HZ}Hz`);
  return timer;
}

export function stopSimulationLoop() {
  if (timer) clearInterval(timer);
  timer = null;
}
