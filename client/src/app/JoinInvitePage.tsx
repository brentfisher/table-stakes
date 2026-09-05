// STORY-024. The `/join/:token` route: validates the invite BEFORE ever mounting `GameClient`
// (`GET /api/rooms/by-invite/:token`, read-only — see `routes.js`'s own header on why this
// lookup mutates nothing), so a bad link renders a clear reason and a way back rather than a
// blank Three.js canvas silently failing its `join_room`.

import { useEffect, useState } from 'react';

interface JoinInvitePageProps {
  token: string;
  onJoined: (state: { roomId: string; inviteToken: string }) => void;
  onBackHome: () => void;
}

/** Plain-language copy for every ERROR_CODES member this lookup can return (messages.js). */
const JOIN_ERROR_COPY: Record<string, string> = {
  invite_not_found: "This invite link doesn't match any match. Check that you copied the whole link.",
  invite_expired: 'This invite link has expired. Ask your host to send a new one.',
  invite_canceled: 'Your host canceled this match before you joined.',
  already_started: 'This match already started without you.',
  match_full: 'This match already has two players.',
};

type LoadState = { status: 'loading' } | { status: 'error'; error: string };

export function JoinInvitePage({ token, onJoined, onBackHome }: JoinInvitePageProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/rooms/by-invite/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (cancelled) return;
        const body = (await res.json()) as { id?: string; error?: string };
        if (!res.ok || !body.id) {
          setState({ status: 'error', error: body.error ?? 'invite_not_found' });
          return;
        }
        onJoined({ roomId: body.id, inviteToken: token });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', error: 'invite_not_found' });
      });
    return () => {
      cancelled = true;
    };
    // Re-run only if the token itself changes (a different link) — `onJoined`/`onBackHome` come
    // from `App.tsx`'s route dispatch, not state this effect should react to.
  }, [token]);

  if (state.status === 'loading') {
    return (
      <div className="join-invite">
        <div className="join-invite-panel">
          <p>Checking invite…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="join-invite">
      <div className="join-invite-panel">
        <h2>Can&rsquo;t join this match</h2>
        <p>{JOIN_ERROR_COPY[state.error] ?? 'This invite link is no longer valid.'}</p>
        <button type="button" onClick={onBackHome}>
          Back to menu
        </button>
      </div>
    </div>
  );
}
