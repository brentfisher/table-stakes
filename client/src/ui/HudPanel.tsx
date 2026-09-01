// Minimal HUD. The full §18 HUD — score, cash, queue, satisfaction, events, alerts, rival
// summary — is STORY-015. STORY-003 adds only what the phase clock needs: which phase the
// match is in, how long is left in it, the revealed market, and a ready control.
//
// The countdown here is PURELY a render of `status.timeRemainingMs`. There is no interval, no
// requestAnimationFrame decrement and no local extrapolation: PRD §12 gives the server the
// match timer, and the snapshot arrives ten times a second, which is a smooth enough clock.

import type { GameClientStatus } from '../game/GameClient';

const PHASE_LABELS: Record<string, string> = {
  lobby: 'Lobby',
  market_reveal: 'Market Reveal',
  setup: 'Setup',
  service: 'Service',
  final_rush: 'Final Rush',
  results: 'Results',
};

function formatCountdown(ms: number | null): string {
  if (ms === null) return '—';
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function HudPanel({
  status,
  onReady,
}: {
  status: GameClientStatus | null;
  onReady: (ready: boolean) => void;
}): JSX.Element {
  const connection = status?.connection ?? 'connecting';
  const phase = status?.matchPhase ?? null;
  // The two phases the server accepts a readiness change in — see Match#setReady.
  const canReady = phase === 'lobby' || phase === 'setup';

  return (
    <div className="hud">
      <h1>Rival Restaurant</h1>
      <dl>
        <dt>Server</dt>
        <dd className={`status-${connection}`}>{connection}</dd>
        <dt>Phase</dt>
        <dd>{phase ? (PHASE_LABELS[phase] ?? phase) : '—'}</dd>
        <dt>Time left</dt>
        <dd>{formatCountdown(status?.timeRemainingMs ?? null)}</dd>
        <dt>Market</dt>
        <dd>{status?.market?.name ?? 'not revealed'}</dd>
        {/* STORY-012 AC: ambient awareness of an affordable upgrade, without a trip to the
            terminal to find out. The terminal itself (`UpgradeTerminal.tsx`) is the full §10
            shop; the rest of the §18 HUD (cash amount, score, satisfaction, events, alerts,
            rival summary) is STORY-015's, not this line's. */}
        {status?.canAffordUpgrade ? (
          <>
            <dt>Upgrade</dt>
            <dd className="status-open">available</dd>
          </>
        ) : null}
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

      {status?.endReason ? (
        <p className="hud-note">
          Match over —{' '}
          {status.endReason === 'player_disconnected' ? 'opponent disconnected' : 'completed'}.
        </p>
      ) : (
        <button type="button" disabled={!canReady} onClick={() => onReady(!status?.ready)}>
          {status?.ready ? 'Ready ✓ (cancel)' : 'Ready up'}
        </button>
      )}
    </div>
  );
}
