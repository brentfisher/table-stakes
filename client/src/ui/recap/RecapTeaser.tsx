import type { MatchResult } from '../../../../shared/schemas/messages';
import { formatMoney, formatPoints } from './format';
import { useRecapMotion } from './useRecapMotion';
import { RecapArcadeStage } from './RecapArcadeStage';
export interface RecapTeaserProps { result: MatchResult; }
/** Only the viewer's server-computed result is known here. Winner and rival stay hidden
 * until GameView replaces this with ResultsPanel on match_complete. */
export function RecapTeaser({ result }: RecapTeaserProps): JSX.Element {
  const [motionEnabled, setMotionEnabled] = useRecapMotion();
  return <div className={`recap recap-arcade-shell${motionEnabled ? '' : ' recap--motion-off'}`}>
    <header className="recap-arcade-header"><strong>T/S <span>TABLE<br />STAKES</span></strong><span>AFTER HOURS / YOUR SHIFT, REPLAYED</span><button type="button" className="recap-motion-toggle" onClick={() => setMotionEnabled(m => !m)}>Motion {motionEnabled ? 'on' : 'off'}</button></header>
    <RecapArcadeStage score={result.score} motionEnabled={motionEnabled} facts={[{label: 'Guests served', value: String(result.guestsServed)}, {label: 'Revenue', value: formatMoney(result.revenue)}, {label: 'Reputation', value: formatPoints(result.reputation)}]} />
  </div>;
}
