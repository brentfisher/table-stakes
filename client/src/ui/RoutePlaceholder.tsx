// STORY-023. The route table (`client/src/app/router.ts`) reserves `/join/:token`,
// `/lobby/:roomId` and `/dev/harnesses` for STORY-024/026 before those stories exist, per this
// story's own AC: "other suggested routes ... may render a placeholder if their owning story
// hasn't landed." This is that one placeholder, parameterized by what to say — a clearly
// disabled affordance, never a dead 404, so a shared link to one of these paths tells the
// visitor what is actually going on instead of looking broken.
//
// Escape returns to the menu, matching the AC's "Escape-based back navigation" — the same
// convention `HowToPlay`/`SettingsPanel` use for closing an overlay, just landing on `/`
// instead of closing in place since there is no menu underneath a route (as opposed to a modal
// over one).

import { useEffect } from 'react';
import { navigate } from '../app/router';

export function RoutePlaceholder({
  title,
  detail,
  badge = 'Coming soon',
}: {
  title: string;
  detail: string;
  /** Distinguishes "not built yet" (the default, used by /join, /lobby, /dev/harnesses) from a
   * genuine unrecognized path — a 404 is not "coming soon", it is just wrong. */
  badge?: string;
}): JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') navigate('/');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="app route-placeholder">
      <div className="route-placeholder-card">
        <p className="route-placeholder-badge">{badge}</p>
        <h1>{title}</h1>
        <p className="route-placeholder-detail">{detail}</p>
        <button type="button" autoFocus onClick={() => navigate('/')}>
          Back to menu
        </button>
        <p className="muted route-placeholder-hint">
          Press <kbd>Esc</kbd> to go back.
        </p>
      </div>
    </div>
  );
}
