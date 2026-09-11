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
  autoMenuSecondsLeft = null,
  onSkip,
}: {
  reconnecting: boolean;
  disconnectedTerminal: { reason: string } | null;
  /** STORY-034. Seconds until `GameView`'s own timer navigates back to the menu, or `null` when
   * no countdown is running (every other branch of this component). `GameView` owns the timer —
   * this component only reads and displays it, same "one clock, not two" reasoning as
   * `GameClientStatus.timeRemainingMs` never being locally extrapolated. */
  autoMenuSecondsLeft?: number | null;
  /** Immediate "don't wait" escape hatch — optional only so this component still type-checks
   * without a handler in a context that never shows the terminal state at all. */
  onSkip?: () => void;
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
        {autoMenuSecondsLeft !== null ? (
          <p className="reconnect-detail reconnect-countdown">
            Returning to the menu in {autoMenuSecondsLeft}s…
          </p>
        ) : null}
        <div className="reconnect-actions">
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
          {onSkip ? (
            <button type="button" onClick={onSkip}>
              Skip to menu
            </button>
          ) : null}
        </div>
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
