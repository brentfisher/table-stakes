// STORY-024. PRD §12 room-flow steps 1-2/7's lobby, made real: two resolved slots, each one's
// connection and ready state, and — for the host, while the second seat is still open — the
// `InvitePanel` share link. Full-bleed overlay above the Three.js canvas, the exact same
// pattern `SetupScreen`/`ResultsPanel` already use for a pre/post-match screen (see
// `SetupScreen.tsx`'s own header) — `matchPhase === 'lobby'` and `matchPhase === 'setup'` are
// mutually exclusive PRD §5 phases, so this and `SetupScreen` never fight over the screen.
//
// EVERYTHING HERE COMES FROM `GameClientStatus`, VERBATIM — same discipline `HudPanel`/
// `ResultsPanel` already document for `match_snapshot`/`match_complete`. `status.players` is
// STORY-024's own narrow addition to that status (see `GameClient.ts`'s own comment); nothing
// here recomputes a connection or ready state the server has not already published.
//
// RECONNECT UX for the VIEWER'S OWN drop is deliberately NOT duplicated here: `ReconnectOverlay`
// (STORY-022) is already mounted, ungated by phase, above every other panel in `App.tsx`'s tree
// — a lobby drop is just as real a drop as a mid-match one, and reusing that overlay is exactly
// what this story's own Notes ask for ("reusing ReconnectOverlay's pattern... rather than
// duplicating it"). What THIS screen shows instead is the OPPONENT'S connection/ready state,
// which only a still-connected viewer can see in the first place.
//
// No cosmetic preview is rendered: nothing in this codebase publishes a cosmetic/avatar choice
// yet (there is no such system to preview), and inventing one is explicitly out of scope.

import { PLAYERS_PER_MATCH } from '../../../shared/constants/tuning';
import type { GameClientStatus, LobbySlot } from '../game/GameClient';
import { InvitePanel, type InviteInfo } from './InvitePanel';

interface LobbyScreenProps {
  status: GameClientStatus;
  onReady: (ready: boolean) => void;
  /** Non-null only for the host, and only while `invite.joinUrl` is still worth sharing — the
   * caller (the lobby route, not this component) knows whether it created the room and holds
   * the one-time `POST /api/rooms` response the token/link came from. */
  invite: InviteInfo | null;
}

/**
 * A slot is a filled seat (`status.players[i]`) or, while the room waits for its second player,
 * an empty placeholder. `Map` iteration order in `match.js#toSnapshot` is insertion order, and
 * the host is always the first to `join_room` (they create the room, then join it themselves),
 * so slot 0 reads as "Host" and slot 1 as "Guest" — a display label only, never sent back to
 * the server and never gating anything server-side.
 */
const SLOT_LABELS = ['Host', 'Guest'];

function slotStatusText(slot: LobbySlot): string {
  if (!slot.connected) return 'Disconnected — reconnecting…';
  if (slot.ready) return 'Ready';
  return 'Connected';
}

export function LobbyScreen({ status, onReady, invite }: LobbyScreenProps): JSX.Element {
  const slots: Array<LobbySlot | null> = [...status.players];
  while (slots.length < PLAYERS_PER_MATCH) slots.push(null);

  const self = status.players.find((p) => p.playerId === status.playerId) ?? null;
  const waitingForOpponent = status.players.length < PLAYERS_PER_MATCH;

  return (
    <div className="lobby">
      <div className="lobby-panel">
        <h2>Lobby</h2>
        <ul className="lobby-slots">
          {slots.map((slot, i) => (
            <li key={slot?.playerId ?? `empty-${i}`} className="lobby-slot">
              <span className="lobby-slot-label">{SLOT_LABELS[i] ?? `Player ${i + 1}`}</span>
              {slot ? (
                <>
                  <span className={`lobby-slot-dot ${slot.connected ? 'is-connected' : 'is-disconnected'}`} />
                  <span className="lobby-slot-status">
                    {slotStatusText(slot)}
                    {slot.playerId === status.playerId ? ' (you)' : ''}
                  </span>
                </>
              ) : (
                <span className="lobby-slot-status muted">Waiting for opponent…</span>
              )}
            </li>
          ))}
        </ul>

        {invite && waitingForOpponent ? <InvitePanel invite={invite} /> : null}

        <button
          type="button"
          className="lobby-ready"
          disabled={!self?.connected}
          onClick={() => onReady(!status.ready)}
        >
          {status.ready ? 'Ready ✓ (cancel)' : 'Ready up'}
        </button>
      </div>
    </div>
  );
}
