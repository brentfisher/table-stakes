// Static event-catalogue title lookup, shared by `HudPanel.tsx` and `EventBanner.tsx` (STORY-016)
// so the two panels can never quietly disagree about how an `eventId` reads as a title. Public
// game data, not a simulation result — same as `dishName`/`upgradeName` elsewhere.

import eventsData from '../../../shared/game-data/events.json';

const EVENT_TITLES = new Map<string, string>(
  (eventsData.events as Array<{ id: string; title: string }>).map((e) => [e.id, e.title]),
);

export function eventTitle(eventId: string): string {
  return EVENT_TITLES.get(eventId) ?? eventId;
}
