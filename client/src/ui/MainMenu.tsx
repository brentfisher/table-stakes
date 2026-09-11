// STORY-023. The game's actual entry point — `App.tsx` mounted `GameClient` unconditionally
// before this story; now `/` renders this instead. See `router.ts` for the routing layer this
// slots into.
//
// Every item on the PRD's acceptance list is present as SOME affordance (never a dead link,
// per this story's own framing): Play Online renders disabled/"coming soon" (no matchmaking
// queue exists). Join Private Match, Invite Opponent (STORY-024) and, as of STORY-025, Play vs
// Bot are real, working actions.
//
// STORY-025 wires "Play vs Bot" to `PlayVsBotScreen` — the same `activeModal` pattern
// `HowToPlay`/`SettingsPanel` already use, rather than a fourth top-level route (see that
// screen's own header for why).
//
// STORY-032 restyled this into the two-column "neon marquee" layout from the source design
// (`docs/table-stakes-neon-menu.zip`'s `start.html`) — brand header, `NeonSignHero` on the left,
// this real menu panel on the right, brand/version footer. Every action below is the SAME
// already-real wiring from STORY-023/024/025 — only the surrounding markup/classes changed.

import { useEffect, useState, type FormEvent } from 'react';
import { navigate } from '../app/router';
import { cacheInvite, type CreatedRoom } from '../app/invite-lobby-types';
import { HowToPlay } from './HowToPlay';
import { SettingsPanel } from './SettingsPanel';
import { PlayVsBotScreen } from './PlayVsBotScreen';
import { NeonSignHero, MENU_SIGN_SETTINGS_CHANGED_EVENT } from './NeonSignHero';
import { loadSettings, saveSettings } from '../app/settings';

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

/** The header's quick "SIGN EFFECTS ON/STEADY" toggle — the same on/off pairing
 * `SettingsPanel`'s two menu-sign fields already expose individually, collapsed into one button
 * for a fast toggle without opening Settings. Reads/writes the same `loadSettings()`/
 * `saveSettings()` source of truth and fires the same event `SettingsPanel` does, so
 * `NeonSignHero` hears about it identically either way. */
function useSignEffectsToggle(): [boolean, () => void] {
  const [enabled, setEnabled] = useState(() => {
    const s = loadSettings();
    return s.menuSignSparks && !s.reducedMotion;
  });

  const toggle = () => {
    const settings = loadSettings();
    const next = !(settings.menuSignSparks && !settings.reducedMotion);
    saveSettings({ ...settings, menuSignSparks: next, reducedMotion: !next });
    setEnabled(next);
    window.dispatchEvent(new CustomEvent(MENU_SIGN_SETTINGS_CHANGED_EVENT));
  };

  return [enabled, toggle];
}

export function MainMenu(): JSX.Element {
  const [version, retryVersion] = useVersion();
  const [joinCode, setJoinCode] = useState('');
  const [activeModal, setActiveModal] = useState<'how-to-play' | 'settings' | 'play-vs-bot' | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [signEffectsOn, toggleSignEffects] = useSignEffectsToggle();

  const submitJoinCode = (event: FormEvent) => {
    event.preventDefault();
    const token = joinCode.trim();
    if (!token) return;
    navigate(`/join/${encodeURIComponent(token)}`);
  };

  // STORY-024. `POST /api/rooms` mints the room + invite; the freshly-minted token/link is
  // cached (`cacheInvite`) under the room's id so `App.tsx`'s `'lobby'` route — the very next
  // thing `navigate` mounts — can read it back without a second round trip. See
  // `invite-lobby-types.ts`'s own header for why this is sessionStorage rather than route state.
  const inviteOpponent = async () => {
    setInviting(true);
    setInviteError(null);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'private_human' }),
      });
      const body = (await res.json()) as CreatedRoom & { error?: string };
      if (!res.ok || !body.id) {
        setInviteError('Could not create a match. Try again.');
        return;
      }
      cacheInvite(body.id, {
        inviteToken: body.inviteToken,
        joinUrl: body.joinUrl,
        hostDisplayName: body.hostDisplayName,
        expiresAt: body.inviteExpiresAt,
      });
      navigate(`/lobby/${body.id}`);
    } catch {
      setInviteError('Could not reach the server. Try again.');
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="app main-menu">
      <header className="menu-topbar">
        <span className="menu-brand" aria-label="Table Stakes">
          T<span>/</span>S
        </span>
        <span className="menu-topbar-rule" />
        <span className="menu-edition">
          A little hospitality.
          <br />
          <b>A lot of competition.</b>
        </span>
        <button
          type="button"
          className="sign-effects-toggle"
          aria-pressed={signEffectsOn}
          onClick={toggleSignEffects}
        >
          <i /> Sign effects {signEffectsOn ? 'on' : 'steady'}
        </button>
      </header>

      <main className="menu-main">
        <NeonSignHero />

        <section className="menu-panel" aria-label="Main menu">
          <div className="menu-panel-top">
            <span className="eyebrow">Pull up a chair</span>
          </div>

          <h2>
            Let&rsquo;s eat.
            <br />
            <em>Let&rsquo;s compete.</em>
          </h2>
          <p className="menu-panel-intro">Choose how you take the floor.</p>

          <nav className="play-options">
            {/* PRD acceptance list: "Play Online" — no matchmaking queue exists yet (only
                direct room-id/invite joins do), so this is disabled rather than silently
                creating a lobby nobody else can find. */}
            <button type="button" className="mode unavailable" disabled aria-disabled="true" title="No matchmaking queue exists yet">
              <span className="mode-icon">◎</span>
              <span>
                <b>Play Online</b>
                <small>Find your next rival</small>
              </span>
              <span className="mode-badge">Unavailable</span>
            </button>

            <button
              type="button"
              className="mode"
              disabled={inviting}
              aria-disabled={inviting}
              onClick={inviteOpponent}
            >
              <span className="mode-icon">↗</span>
              <span>
                <b>{inviting ? 'Creating…' : 'Invite Opponent'}</b>
                <small>Settle it over dinner</small>
              </span>
              <span className="mode-arrow">↗</span>
            </button>

            <button type="button" className="mode featured" onClick={() => setActiveModal('play-vs-bot')}>
              <span className="mode-icon">▣</span>
              <span>
                <b>Play vs Bot</b>
                <small>Your next shift starts here</small>
              </span>
              <span className="mode-arrow">→</span>
            </button>
          </nav>
          {inviteError ? <p className="menu-invite-error">{inviteError}</p> : null}

          <form className="join-form" onSubmit={submitJoinCode}>
            <label htmlFor="join-code">Join private match</label>
            <div className="join-row">
              <input
                id="join-code"
                type="text"
                placeholder="Room code or invite token"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                autoComplete="off"
              />
              <button type="submit" disabled={!joinCode.trim()}>
                Join <span>→</span>
              </button>
            </div>
          </form>

          <div className="menu-utility">
            <button type="button" onClick={() => setActiveModal('how-to-play')}>
              <span>?</span> How to Play
            </button>
            <button type="button" onClick={() => setActiveModal('settings')}>
              <span>⚙</span> Settings
            </button>
          </div>

          <div className="menu-panel-foot">
            <span>
              <i /> Kitchen&rsquo;s ready. Are you?
            </span>
          </div>
        </section>
      </main>

      <footer className="menu-footer">
        <span>
          Table Stakes <b>/</b> The Restaurant Rivalry Game
        </span>
        {version.status === 'loading' ? <span className="muted">Checking server…</span> : null}
        {version.status === 'ready' ? (
          <span className="muted num">
            Build {version.server} · three.js {version.threeVersion}
          </span>
        ) : null}
        {version.status === 'error' ? (
          <span className="menu-footer-error">
            Can&rsquo;t reach the server.{' '}
            <button type="button" className="menu-footer-retry" onClick={retryVersion}>
              Retry
            </button>
          </span>
        ) : null}
      </footer>

      {activeModal === 'how-to-play' ? <HowToPlay onClose={() => setActiveModal(null)} /> : null}
      {activeModal === 'settings' ? <SettingsPanel onClose={() => setActiveModal(null)} /> : null}
      {activeModal === 'play-vs-bot' ? <PlayVsBotScreen onClose={() => setActiveModal(null)} /> : null}
    </div>
  );
}
