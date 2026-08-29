// PRD §12 "Tick target": the server broadcasts at ~10 Hz and the client renders at
// requestAnimationFrame, so snapshots must be interpolated or movement visibly steps.
//
// Buffers the last two snapshots per player and interpolates between them on a small
// playback delay, which is the standard trade of ~1 broadcast interval of latency for
// smooth motion. Deliberately NOT rollback netcode — PRD §12 says not to over-engineer it.

export interface PlayerState {
  playerId: string;
  position: { x: number; y: number; z: number };
  facing: number;
  sprinting?: boolean;
  connected?: boolean;
}

interface Sample {
  time: number;
  state: PlayerState;
}

const PLAYBACK_DELAY_MS = 110;

function shortestAngleTo(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export class StateInterpolator {
  private readonly buffers = new Map<string, Sample[]>();

  push(players: PlayerState[], receivedAt = performance.now()): void {
    const seen = new Set<string>();
    for (const state of players) {
      seen.add(state.playerId);
      const buffer = this.buffers.get(state.playerId) ?? [];
      buffer.push({ time: receivedAt, state });
      while (buffer.length > 3) buffer.shift();
      this.buffers.set(state.playerId, buffer);
    }
    for (const id of [...this.buffers.keys()]) {
      if (!seen.has(id)) this.buffers.delete(id);
    }
  }

  sample(now = performance.now()): PlayerState[] {
    const renderTime = now - PLAYBACK_DELAY_MS;
    const out: PlayerState[] = [];

    for (const [playerId, buffer] of this.buffers) {
      if (buffer.length === 0) continue;
      if (buffer.length === 1) {
        out.push(buffer[0].state);
        continue;
      }

      const to = buffer[buffer.length - 1];
      const from = buffer[buffer.length - 2];
      const span = to.time - from.time;
      const t = span <= 0 ? 1 : Math.max(0, Math.min(1, (renderTime - from.time) / span));

      out.push({
        playerId,
        position: {
          x: from.state.position.x + (to.state.position.x - from.state.position.x) * t,
          y: from.state.position.y + (to.state.position.y - from.state.position.y) * t,
          z: from.state.position.z + (to.state.position.z - from.state.position.z) * t,
        },
        facing: from.state.facing + shortestAngleTo(from.state.facing, to.state.facing) * t,
        sprinting: to.state.sprinting,
        connected: to.state.connected,
      });
    }
    return out;
  }

  clear(): void {
    this.buffers.clear();
  }
}
