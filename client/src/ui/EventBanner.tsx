import { useState } from 'react';
import type { GameClientStatus } from '../game/GameClient';
import eventsData from '../../../shared/game-data/events.json';
import { CommandIcon } from './CommandIcon';
import { eventTitle } from './event-titles';

/** Compact outside-event notifications. Dismissal lasts for the current event state. */
export function EventBanner({ status }: { status: GameClientStatus | null }): JSX.Element | null {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const visible = (status?.events ?? []).filter((e) => (e.state === 'active' || e.state === 'warning') && !dismissed.includes(`${e.eventId}:${e.state}`)).slice(0, 3);
  if (!visible.length) return null;
  return <div className="outside-event-stack" aria-label="Outside events">{visible.map((event, index) => {
    const active = event.state === 'active';
    const key = `${event.eventId}:${event.state}`;
    const definition = eventsData.events.find((item) => item.id === event.eventId);
    const seconds = Math.max(0, Math.ceil((active ? event.endsInMs ?? 0 : event.startsInMs ?? 0) / 1000));
    const time = seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${seconds}s`;
    const risk = ['ingredient_shortage', 'power_fluctuation'].includes(event.eventId);
    const premium = event.eventId === 'food_critic_spotted';
    const traffic = definition ? Math.round((definition.effects.footTrafficMultiplier - 1) * 100) : 0;
    const effect = event.eventId === 'ingredient_shortage' ? 'Ingredient restocks take twice as long'
      : event.eventId === 'power_fluctuation' ? 'Grill & oven running at 70% speed'
      : premium ? 'High-value party · Protect premium dishes'
      : traffic ? `${traffic > 0 ? '+' : ''}${traffic}% foot traffic · ${active ? 'Active now' : 'Get ready'}`
      : definition?.description ?? 'Keep an eye on the street';
    return <section className={`event-banner ${risk ? 'event-banner--risk' : premium || !active ? 'event-banner--incoming' : 'event-banner--live'}`} key={key} style={{ animationDelay: `${index * 65}ms` }}>
      <span className="event-banner-icon" aria-hidden="true"><CommandIcon name={risk ? 'warning' : premium ? 'crown' : active ? 'spark' : 'clock'} /></span>
      <div className="event-banner-copy" role="status"><span className="event-banner-title">{eventTitle(event.eventId)}</span><small>{effect}</small></div>
      <span className="event-banner-time">{active ? `${time} left` : `In ${time}`}</span>
      <button type="button" aria-label={`Dismiss ${eventTitle(event.eventId)}`} onClick={() => setDismissed((prev) => [...prev.slice(-19), key])}>×</button>
    </section>;
  })}</div>;
}
