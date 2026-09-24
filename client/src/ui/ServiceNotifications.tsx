import type { GameClientStatus } from '../game/GameClient';
import { ArcadeToast } from './ArcadeToast';
import { EventBanner } from './EventBanner';
import { HudAlerts } from './HudPanel';

/** One flow for all service notices: changing text height never changes their separation. */
export function ServiceNotifications({ status }: { status: GameClientStatus | null }): JSX.Element | null {
  if (!status || (status.matchPhase !== 'service' && status.matchPhase !== 'final_rush')) return null;
  return <aside className="service-notifications" aria-label="Service notifications" tabIndex={0}>
    <HudAlerts status={status} />
    <ArcadeToast status={status} />
    {status.serviceStationNotice ? <div className="service-station-confirmation" role="status">{status.serviceStationNotice}</div> : null}
    <EventBanner status={status} />
    <HudAlerts status={status} advisory />
  </aside>;
}
