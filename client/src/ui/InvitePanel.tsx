// STORY-024. PRD §12's private invite flow, client half: once `POST /api/rooms` has minted a
// `joinUrl`, this is the ONLY place that link is ever shown — see `LobbyScreen`'s own comment
// on why a guest never sees this panel at all (they already used the link to get here).
//
// Nothing here computes or re-derives the token: `joinUrl` and `hostDisplayName` are read
// straight off the `POST /api/rooms` response the caller already made, the same "component
// renders, never recomputes" discipline `HudPanel`/`ResultsPanel` document for `match_snapshot`
// and `match_complete`.

import { useState } from 'react';

export interface InviteInfo {
  joinUrl: string;
  hostDisplayName: string | null;
  /** `Date.now()`-comparable ms, straight off the room's `inviteExpiresAt`. */
  expiresAt: number;
}

function formatExpiry(expiresAt: number): string {
  const minutes = Math.max(0, Math.round((expiresAt - Date.now()) / 60_000));
  if (minutes <= 0) return 'expires any moment';
  if (minutes === 1) return 'expires in about 1 minute';
  return `expires in about ${minutes} minutes`;
}

export function InvitePanel({ invite }: { invite: InviteInfo }): JSX.Element {
  // Transient UI-only feedback for the copy button — never a claim about server state, so a
  // plain `useState` (not `GameClientStatus`) is the right home for it.
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(invite.joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied (permissions, insecure context); the link is still
      // selectable text in the input below, so this is a degraded-but-usable failure, not a
      // dead end.
    }
  };

  // Feature-detected, not user-agent-sniffed — `navigator.share` simply does not exist on most
  // desktop browsers, and calling it there throws rather than silently no-op-ing.
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const shareLink = () => {
    navigator.share({ title: 'Join my restaurant', url: invite.joinUrl }).catch(() => {
      // A user-canceled share rejects the promise; that is not an error worth surfacing.
    });
  };

  return (
    <div className="invite-panel">
      <p className="invite-lead">
        Share this link with your opponent — {invite.hostDisplayName ?? 'you'} will not start
        until they join.
      </p>
      <div className="invite-link-row">
        <input className="invite-link" type="text" readOnly value={invite.joinUrl} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" onClick={copyLink}>
          {copied ? 'Copied!' : 'Copy link'}
        </button>
        {canShare ? (
          <button type="button" onClick={shareLink}>
            Share…
          </button>
        ) : null}
      </div>
      <p className="invite-expiry muted">{formatExpiry(invite.expiresAt)}</p>
    </div>
  );
}
