// The React shell. PRD §13 "React responsibilities": React owns application UI and
// lower-frequency game state panels. It must NOT reconcile Three.js entities as JSX state
// every simulation tick — the scene is mounted once into a plain div and driven by
// GameClient, and React only re-renders on the low-frequency status callback.
//
// STORY-023. This used to unconditionally mount `GameClient` (there was no menu and no way to
// reach the game except by already having a `?room=`). It is now route-aware: `App` itself does
// nothing but read the current pathname (`router.ts`) and pick which top-level screen to
// render. Every panel that used to live directly in this file (`HudPanel`, `SetupScreen`,
// `ResultsPanel`, etc.) moved, unchanged, into `GameView.tsx` — see that file's own header.
//
// STORY-024 wires the 'join' and 'lobby' routes to real screens instead of `RoutePlaceholder`.

import { useEffect } from 'react';
import { matchRoute, navigate, usePathname } from './router';
import { MainMenu } from '../ui/MainMenu';
import { GameView } from './GameView';
import { RoutePlaceholder } from '../ui/RoutePlaceholder';
import { JoinInvitePage } from './JoinInvitePage';
import { cacheInvite, readCachedInvite } from './invite-lobby-types';

export function App(): JSX.Element {
  const pathname = usePathname();
  const route = matchRoute(pathname);

  // Pre-STORY-023, the only way into a game was `/?room=<id>` (there was no `/game/:roomId`).
  // `/` now renders `MainMenu` instead of `GameView`, so an old link would otherwise land a
  // returning player on the menu with their room id silently ignored. One-time redirect to the
  // real route keeps those links working instead of just no-op'ing them. `replace: true` (see
  // `router.ts`'s own comment on it) so this redirect is not itself a Back-button stop.
  useEffect(() => {
    if (route.name !== 'menu') return;
    const legacyRoomId = new URLSearchParams(window.location.search).get('room');
    if (legacyRoomId) navigate(`/game/${encodeURIComponent(legacyRoomId)}`, { replace: true });
  }, [route.name]);

  switch (route.name) {
    case 'menu':
      return <MainMenu />;
    case 'game':
    case 'results':
      // Both routes hand the same roomId into the same live view — see `GameView.tsx`'s own
      // header for exactly what `/results/:roomId` does and does not do (verified against the
      // real server, not assumed). No `lobbyUi` here: this is the pre-existing bare dev/bot
      // `?room=` flow (redirected above) or a shared mid-match link, neither of which goes
      // through the invite/lobby entry points `LobbyScreen` is for.
      return <GameView roomId={route.roomId} />;
    case 'join':
      // STORY-024. Validates the token BEFORE mounting `GameClient` (see `JoinInvitePage`'s own
      // header); on success, cache what the lobby route needs and hand off to it the same way
      // `MainMenu`'s "Invite Opponent" does below.
      return (
        <JoinInvitePage
          token={route.token}
          onJoined={({ roomId, inviteToken }) => {
            cacheInvite(roomId, { inviteToken });
            navigate(`/lobby/${roomId}`, { replace: true });
          }}
          onBackHome={() => navigate('/')}
        />
      );
    case 'lobby': {
      // STORY-024. `cacheInvite`/`readCachedInvite` is the hand-off from whichever entry point
      // got here (`MainMenu`'s "Invite Opponent", or `JoinInvitePage` above) — see that
      // module's own header for why this is sessionStorage rather than route state: it is also
      // what survives a hard reload of this exact URL.
      const cached = readCachedInvite(route.roomId);
      const invite =
        cached?.joinUrl && cached.expiresAt !== undefined
          ? { joinUrl: cached.joinUrl, hostDisplayName: cached.hostDisplayName ?? null, expiresAt: cached.expiresAt }
          : null;
      return (
        <GameView roomId={route.roomId} inviteToken={cached?.inviteToken} lobbyUi invite={invite} />
      );
    }
    case 'dev-harnesses':
      // STORY-026's job (asset showcase) and the existing standalone `harnesses/` app already
      // cover this in development — this route is reserved, not yet backed by anything here.
      return (
        <RoutePlaceholder
          title="Dev harness index isn't here yet"
          detail="The scene harnesses run from the standalone harnesses/ app for now; an in-client index isn't built yet."
        />
      );
    case 'not-found':
    default:
      return (
        <RoutePlaceholder
          badge="Not found"
          title="Page not found"
          detail={`Nothing is routed at "${route.name === 'not-found' ? route.pathname : pathname}".`}
        />
      );
  }
}
