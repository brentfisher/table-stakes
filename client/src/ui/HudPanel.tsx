// Minimal Milestone 0 HUD. The full §18 HUD — timer, score, cash, queue, satisfaction,
// events, alerts, rival summary — is STORY-015.

import type { GameClientStatus } from '../game/GameClient';

export function HudPanel({ status }: { status: GameClientStatus | null }): JSX.Element {
  const connection = status?.connection ?? 'connecting';
  return (
    <div className="hud">
      <h1>Rival Restaurant</h1>
      <dl>
        <dt>Server</dt>
        <dd className={`status-${connection}`}>{connection}</dd>
        <dt>Room</dt>
        <dd>{status?.roomId ?? '—'}</dd>
        <dt>You</dt>
        <dd>{status?.playerId ?? '—'}</dd>
        <dt>Seed</dt>
        <dd>{status?.seed ?? '—'}</dd>
        <dt>Owners</dt>
        <dd>{status?.playerCount ?? 0}</dd>
        <dt>Match time</dt>
        <dd>{status ? `${(status.serverTime / 1000).toFixed(1)}s` : '—'}</dd>
      </dl>
    </div>
  );
}
