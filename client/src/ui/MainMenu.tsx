// STORY-023. The game's actual entry point — `App.tsx` mounted `GameClient` unconditionally
// before this story; now `/` renders this instead. See `router.ts` for the routing layer this
// slots into.
//
// Every item on the PRD's acceptance list is present as SOME affordance (never a dead link,
// per this story's own framing): Play Online and, unless STORY-024/025 have landed on this
// branch's base, Invite Opponent and Play vs Bot render disabled/"coming soon" — implementing
// their real flows is explicitly out of scope here (those stories' own job). Join Private Match
// is a real, working text input: it does not need STORY-024 to exist, only to accept a token
// and navigate to the route STORY-024 will fill in.
//
// `PLAY_VS_BOT_AVAILABLE`/`INVITE_AVAILABLE` are the two knobs STORY-024/025 flip when they
// land — see each constant's own comment for why they are false right now and how a rebase
// would turn them true instead of requiring this file to be rewritten.

import { useEffect, useState, type FormEvent } from 'react';
import { navigate } from '../app/router';
import { HowToPlay } from './HowToPlay';
import { SettingsPanel } from './SettingsPanel';

/** STORY-024 (private invite lobby) has not landed on this branch's base (`master` @ this
 * story's kickoff) — flip to `true` once it has, which is the whole of what wiring in the real
 * "Invite Opponent" flow requires here (the button below already calls through a single
 * handler). */
const INVITE_AVAILABLE = false;
/** STORY-025 (solo bot match menu flow) has not landed on this branch's base — same shape as
 * `INVITE_AVAILABLE` above. */
const PLAY_VS_BOT_AVAILABLE = false;

type VersionState =
  | { status: 'loading' }
  | { status: 'ready'; server: string; threeVersion: string }
  | { status: 'error' };

/** `GET /api/version` — `server/src/http/routes.js`'s existing endpoint (unchanged by this
 * story). The menu's own "failed-backend" state (AC: "failed-backend ... states are explicit
 * and actionable from the menu") is driven by this fetch, not by anything `GameClientStatus`
 * carries — there is no `GameClient` instance on this screen at all, deliberately: the whole
 * point of a menu is that it does not connect a socket or mount a scene until a player asks it
 * to. */
function useVersion(): [VersionState, () => void] {
  const [state, setState] = useState<VersionState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetch('/api/version')
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json();
      })
      .then((body: { server?: string; threeVersion?: string }) => {
        if (cancelled) return;
        setState({
          status: 'ready',
          server: String(body.server ?? 'unknown'),
          threeVersion: String(body.threeVersion ?? 'unknown'),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return [state, () => setAttempt((n) => n + 1)];
}

export function MainMenu(): JSX.Element {
  const [version, retryVersion] = useVersion();
  const [joinCode, setJoinCode] = useState('');
  const [activeModal, setActiveModal] = useState<'how-to-play' | 'settings' | null>(null);

  const submitJoinCode = (event: FormEvent) => {
    event.preventDefault();
    const token = joinCode.trim();
    if (!token) return;
    navigate(`/join/${encodeURIComponent(token)}`);
  };

  return (
    <div className="app main-menu">
      <div className="main-menu-panel">
        <header className="main-menu-header">
          <h1>Rival Restaurant</h1>
          <p className="muted">Run the floor. Beat the restaurant next door for the same customers.</p>
        </header>

        <nav className="main-menu-actions" aria-label="Main menu">
          {/* PRD acceptance list: "Play Online" — no matchmaking queue exists yet (only
              direct room-id/invite joins do), so this is disabled rather than silently
              creating a lobby nobody else can find. */}
          <button type="button" className="main-menu-action" disabled aria-disabled="true" title="No matchmaking queue exists yet">
            Play Online
            <span className="main-menu-action-badge">Unavailable</span>
          </button>

          <button
            type="button"
            className="main-menu-action"
            disabled={!INVITE_AVAILABLE}
            aria-disabled={!INVITE_AVAILABLE}
            title={INVITE_AVAILABLE ? undefined : 'Coming soon — private invite lobby (STORY-024)'}
          >
            Invite Opponent
            {!INVITE_AVAILABLE ? <span className="main-menu-action-badge">Coming soon</span> : null}
          </button>

          <button
            type="button"
            className="main-menu-action"
            disabled={!PLAY_VS_BOT_AVAILABLE}
            aria-disabled={!PLAY_VS_BOT_AVAILABLE}
            title={PLAY_VS_BOT_AVAILABLE ? undefined : 'Coming soon — solo bot match menu (STORY-025)'}
          >
            Play vs Bot
            {!PLAY_VS_BOT_AVAILABLE ? <span className="main-menu-action-badge">Coming soon</span> : null}
          </button>

          <form className="main-menu-join" onSubmit={submitJoinCode}>
            <label htmlFor="join-code">Join Private Match</label>
            <div className="main-menu-join-row">
              <input
                id="join-code"
                type="text"
                placeholder="Room code or invite token"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                autoComplete="off"
              />
              <button type="submit" disabled={!joinCode.trim()}>
                Join
              </button>
            </div>
          </form>

          <div className="main-menu-secondary">
            <button type="button" onClick={() => setActiveModal('how-to-play')}>
              How to Play
            </button>
            <button type="button" onClick={() => setActiveModal('settings')}>
              Settings
            </button>
          </div>
        </nav>

        <footer className="main-menu-footer">
          {version.status === 'loading' ? <span className="muted">Checking server…</span> : null}
          {version.status === 'ready' ? (
            <span className="muted num">
              Build {version.server} · three.js {version.threeVersion}
            </span>
          ) : null}
          {version.status === 'error' ? (
            <span className="main-menu-backend-error">
              Can&rsquo;t reach the server.{' '}
              <button type="button" className="main-menu-retry" onClick={retryVersion}>
                Retry
              </button>
            </span>
          ) : null}
        </footer>
      </div>

      {activeModal === 'how-to-play' ? <HowToPlay onClose={() => setActiveModal(null)} /> : null}
      {activeModal === 'settings' ? <SettingsPanel onClose={() => setActiveModal(null)} /> : null}
    </div>
  );
}
