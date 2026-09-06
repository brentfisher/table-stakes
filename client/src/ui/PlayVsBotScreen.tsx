// STORY-025 "Solo bot match menu flow". The configuration screen behind `MainMenu.tsx`'s
// "Play vs Bot" button — the AC's "opens a configuration screen for market scenario, bot
// profile/difficulty, and (development mode only) a fixed seed input."
//
// Same full-bleed `.menu-modal` pattern `HowToPlay.tsx`/`SettingsPanel.tsx` already use, so this
// is a modal over the menu, not a fourth top-level route (`router.ts` reserves route shapes for
// destinations a URL/bookmark should be able to reach directly — "configure a bot match" is a
// menu-local step, not one of those, the same reasoning `MainMenu`'s inline "Invite Opponent"
// flow already applies to its own room-creation step before handing off to `/lobby/:roomId`).
//
// On submit this calls `POST /api/rooms` with `{mode: 'solo_bot', ...}` — `routes.js`'s own
// STORY-025 comment on that branch explains why it reuses `matchManager.createRoom` +
// `attachBot` (the exact `POST /dev/match` path) rather than a second attachment mechanism.
// The response is a normal `roomStatus()` shape with `id` set, so this only ever has to
// `navigate('/game/:id')` — the AC's "follows the normal /game/:roomId route ... unchanged".

import { useEffect, useState } from 'react';
import { navigate } from '../app/router';
import { botProfileOptions, type BotProfile } from './bot-profiles';
import type { PublicMarket } from '../../../shared/schemas/messages';

type MarketsState = { status: 'loading' } | { status: 'ready'; markets: PublicMarket[] } | { status: 'error' };

/** `GET /api/markets` — the same public projection `SetupScreen.tsx`'s own market-reveal read
 * would eventually show, fetched here only for its `id`/`name` so the picker can offer a real
 * scenario name instead of a bare id. Failure degrades to "Random only" (the `<select>` still
 * works with just its own always-present first option), never a blocked screen — nothing about
 * choosing a market scenario is required to start a match. */
function useMarkets(): MarketsState {
  const [state, setState] = useState<MarketsState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    fetch('/api/markets')
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json();
      })
      .then((body: { markets?: PublicMarket[] }) => {
        if (cancelled) return;
        setState({ status: 'ready', markets: Array.isArray(body.markets) ? body.markets : [] });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function PlayVsBotScreen({ onClose }: { onClose: () => void }): JSX.Element {
  const markets = useMarkets();
  // STORY-025 AC: Balanced/Fast Service/Premium, plus a dev-only Practice — see
  // `bot-profiles.ts`'s own header for why this reads `BOT_DIFFICULTIES` rather than a second
  // enum. `import.meta.env.DEV` is Vite's own dev-vs-production-build flag (true only under
  // `npm run dev:client`, false in a `build:client` bundle) — the same gate a crafted request
  // straight at `POST /api/rooms` is NOT held to server-side; see this story's PR notes on why
  // that is an accepted, pre-existing trust boundary rather than a new gap this story opens.
  const profiles: BotProfile[] = botProfileOptions(import.meta.env.DEV);
  const [profileId, setProfileId] = useState<string>(
    () => profiles.find((p) => !p.devOnly)?.id ?? profiles[0]?.id ?? 'easy',
  );
  const [marketId, setMarketId] = useState<string>('');
  const [seed, setSeed] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const startMatch = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'solo_bot',
          botDifficulty: profileId,
          ...(marketId ? { marketId } : {}),
          // Dev-only field (not rendered at all outside `import.meta.env.DEV` — see the seed
          // input below), so `seed` is always '' here in a production build regardless of what
          // a player might otherwise type into a field that does not exist for them.
          ...(seed.trim() ? { seed: seed.trim() } : {}),
        }),
      });
      const body = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !body.id) {
        setError('Could not create a match. Try again.');
        return;
      }
      navigate(`/game/${encodeURIComponent(body.id)}`);
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="menu-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="menu-modal play-vs-bot"
        role="dialog"
        aria-modal="true"
        aria-labelledby="play-vs-bot-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="menu-modal-header">
          <h2 id="play-vs-bot-title">Play vs Bot</h2>
          <button type="button" className="menu-modal-close" onClick={onClose} aria-label="Close play vs bot">
            ×
          </button>
        </div>

        <section className="settings-section">
          <h3>Market scenario</h3>
          <div className="settings-field">
            <select value={marketId} onChange={(event) => setMarketId(event.target.value)} disabled={starting}>
              <option value="">Random (server picks)</option>
              {markets.status === 'ready'
                ? markets.markets.map((market) => (
                    <option key={market.id} value={market.id}>
                      {market.name}
                    </option>
                  ))
                : null}
            </select>
          </div>
          {markets.status === 'error' ? (
            <p className="muted settings-note">Couldn&rsquo;t load market names — Random still works.</p>
          ) : null}
        </section>

        <section className="settings-section">
          <h3>Bot profile</h3>
          <div className="bot-config-profiles" role="radiogroup" aria-label="Bot profile">
            {profiles.map((profile) => (
              <label
                key={profile.id}
                className={`bot-config-profile${profileId === profile.id ? ' bot-config-profile--selected' : ''}`}
              >
                <input
                  type="radio"
                  name="bot-profile"
                  value={profile.id}
                  checked={profileId === profile.id}
                  onChange={() => setProfileId(profile.id)}
                  disabled={starting}
                />
                <span className="bot-config-profile-label">
                  {profile.label}
                  {profile.devOnly ? <span className="main-menu-action-badge">Dev only</span> : null}
                </span>
                <span className="bot-config-profile-description muted">{profile.description}</span>
              </label>
            ))}
          </div>
        </section>

        {import.meta.env.DEV ? (
          <section className="settings-section">
            <h3>Fixed seed (development)</h3>
            <div className="settings-field">
              <input
                type="text"
                placeholder="leave blank for a random seed"
                value={seed}
                onChange={(event) => setSeed(event.target.value)}
                disabled={starting}
              />
            </div>
            <p className="muted settings-note">
              Pins the match seed (market draw, event schedule, bot RNG) for a reproducible run.
            </p>
          </section>
        ) : null}

        {error ? <p className="bot-config-error">{error}</p> : null}

        <button type="button" className="main-menu-action bot-config-submit" disabled={starting} onClick={startMatch}>
          {starting ? 'Starting…' : 'Start Match'}
        </button>
      </div>
    </div>
  );
}
