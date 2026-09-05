// STORY-023. A `Router`-shaped module keyed off `window.location.pathname` — the story's own
// Notes are explicit that no routing library is required ("the PRD suggests routes only, not a
// library"), and the route set is tiny (menu, one game route, a handful of placeholders), so a
// dependency would be pure overhead. This is the entire routing layer: a pathname matcher, a
// `navigate()` that uses the History API instead of a full reload, and a hook that re-renders
// `App` on both `navigate()` and browser back/forward.
//
// Deliberately NOT nested/declarative (no `<Route>` JSX, no loaders) — `App.tsx` just switches
// on `matchRoute(pathname).name`. If this grows real nesting later, that is a reason to adopt a
// library then, not to build one here.

import { useEffect, useState } from 'react';

/** Every path this app currently recognizes. STORY-023 AC: "/", "/game/:roomId" and
 * "/results/:roomId" must be recognized "at minimum"; "/join/:token", "/lobby/:roomId" and
 * "/dev/harnesses" are the PRD's other suggested routes, reserved here as named route shapes
 * so STORY-024/025/026 only have to swap a placeholder for a real component — see
 * `RoutePlaceholder.tsx` and its own header for why they render disabled rather than 404. */
export type Route =
  | { name: 'menu' }
  | { name: 'game'; roomId: string }
  | { name: 'results'; roomId: string }
  | { name: 'join'; token: string }
  | { name: 'lobby'; roomId: string }
  | { name: 'dev-harnesses' }
  | { name: 'not-found'; pathname: string };

export function matchRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'menu' };
  if (parts[0] === 'game' && parts[1]) return { name: 'game', roomId: decodeURIComponent(parts[1]) };
  if (parts[0] === 'results' && parts[1]) return { name: 'results', roomId: decodeURIComponent(parts[1]) };
  if (parts[0] === 'join' && parts[1]) return { name: 'join', token: decodeURIComponent(parts[1]) };
  if (parts[0] === 'lobby' && parts[1]) return { name: 'lobby', roomId: decodeURIComponent(parts[1]) };
  if (parts[0] === 'dev' && parts[1] === 'harnesses') return { name: 'dev-harnesses' };
  return { name: 'not-found', pathname };
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** `history.pushState` does not fire `popstate` on its own (only real back/forward does), so
 * every in-app navigation has to fan out to subscribers itself — this is the one place that
 * happens, which is what keeps `navigate()` safe to call from anywhere (menu buttons, the
 * join-code form, a placeholder's "back to menu" link) without each call site re-deriving how
 * to force a re-render. */
export function navigate(path: string): void {
  if (path !== window.location.pathname) {
    window.history.pushState({}, '', path);
  }
  listeners.forEach((listener) => listener());
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => listeners.forEach((listener) => listener()));
}

/** Subscribes `App` (or any component) to the current pathname, re-rendering on `navigate()`
 * and on browser back/forward alike. */
export function usePathname(): string {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  useEffect(() => {
    const listener = () => setPathname(window.location.pathname);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return pathname;
}
