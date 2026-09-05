// STORY-022. PRD §13's reconnect grace is a SERVER guarantee (STORY-003 holds the seat); this is
// the client half — "detects the drop, shows a reconnecting state... [and on] exceeding the
// grace window ends cleanly with a stated reason rather than hanging".
//
// Deliberately its own tiny overlay, not folded into `ResultsPanel`: `ResultsPanel` renders
// `complete.reason === 'player_disconnected'` as "Your opponent disconnected and did not
// reconnect in time" — true from the OTHER player's point of view, but this is the client of
// the player who WAS disconnected, and the same sentence would misdescribe their own drop as
// their opponent's. It also has no `MatchCompleteMessage` to read in the first place: their own
// socket already closed by the time the server would have broadcast one (see `GameClient`'s own
// comment on the `error: 'match_ended'` path). Full-bleed, highest z-index in the sheet — while
// this is up, no other panel's last-known snapshot should be mistaken for a live one.
export function ReconnectOverlay({
  reconnecting,
  disconnectedTerminal,
}: {
  reconnecting: boolean;
  disconnectedTerminal: { reason: string } | null;
}): JSX.Element | null {
  if (disconnectedTerminal) {
    return (
      <div className="reconnect-overlay">
        <p className="reconnect-title">Connection lost</p>
        <p className="reconnect-detail">
          {disconnectedTerminal.reason === 'unreachable'
            ? 'Could not reach the server again in time.'
            : `The match ended while you were disconnected (${disconnectedTerminal.reason}).`}
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
  if (!reconnecting) return null;
  return (
    <div className="reconnect-overlay">
      <p className="reconnect-title">Reconnecting…</p>
      <p className="reconnect-detail">Your seat is held — this should resolve in a few seconds.</p>
    </div>
  );
}
