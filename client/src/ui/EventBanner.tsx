// PRD §14 "An event banner top-centre with a district-level visual effect" (STORY-016). This is
// the React half of that AC: a small presentational overlay that reads `match_snapshot.events`
// verbatim (same discipline `HudPanel.tsx`'s own header documents — nothing here recomputes
// which event is active). The SCENE half — the whole-floor ambient light tint — is
// `RestaurantScene.ts#updateEventEffect`, driven from the exact same `events[]` array; see that
// method's own comment on the split. Deliberately its own tiny file rather than folded into
// `HudPanel` (which is a side dock, not a top-centre banner) or the scene layer (Notable Pattern
// 11: this is UI text, not a 3D indicator).

import type { GameClientStatus } from '../game/GameClient';
import { eventTitle } from './event-titles';

export function EventBanner({ status }: { status: GameClientStatus | null }): JSX.Element | null {
  const active = status?.events.find((e) => e.state === 'active') ?? null;
  if (!active) return null;
  return (
    <div className="event-banner">
      <span className="event-banner-title">{eventTitle(active.eventId)}</span>
      {typeof active.endsInMs === 'number' ? (
        <span className="event-banner-time">{Math.max(0, Math.round(active.endsInMs / 1000))}s left</span>
      ) : null}
    </div>
  );
}
