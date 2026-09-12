import { useEffect, useState, type CSSProperties } from 'react';
import { RecapMascot } from './RecapMascot';
import { formatPoints } from './format';
import type { RecapOutcome } from './recap-types';
interface Props { score: number; rivalScore?: number; motionEnabled: boolean; outcome?: RecapOutcome; onReveal?: () => void; facts?: { label: string; value: string }[]; }
/** Presentation only. Pre-results receives no rival or outcome and never invents either. */
export function RecapArcadeStage({ score, rivalScore, motionEnabled, outcome, onReveal, facts = [] }: Props): JSX.Element {
  const [skipped, setSkipped] = useState(false);
  const [elapsed, setElapsed] = useState(motionEnabled ? 0 : 6000);
  useEffect(() => {
    if (!motionEnabled) { setElapsed(6000); return; }
    setSkipped(false);
    setElapsed(0);
    const start = performance.now(); let frame = 0;
    const tick = (now: number) => { const time = Math.min(now - start, 6000); setElapsed(time); if (time < 6000) frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [motionEnabled, score]);
  const time = skipped ? 6000 : elapsed;
  const progress = Math.min(1, time / 4200), ready = time >= 6000;
  // Three real portions of the total, with a short breath between each count.
  // These are presentation beats, never invented score categories or bonuses.
  const beats = [{ start: 0, duration: 1300, from: 0, to: .55 }, { start: 1600, duration: 1100, from: .55, to: .85 }, { start: 3050, duration: 1150, from: .85, to: 1 }];
  const beat = time < 1600 ? beats[0] : time < 3050 ? beats[1] : beats[2];
  const fraction = Math.min(1, Math.max(0, (time - beat.start) / beat.duration));
  const value = score * (beat.from + (beat.to - beat.from) * (1 - Math.pow(1 - fraction, 3)));
  const counting = time < 4200;
  const suspense = !ready && !counting;
  const revealed = !!outcome && ready;
  const heading = revealed ? outcome === 'win' ? 'THIS HOUSE WINS!' : outcome === 'loss' ? 'NEXT SHIFT. NEW SHOT.' : rivalScore === undefined ? 'SHIFT COMPLETE!' : 'EVEN STEVENS!' : 'WHO TAKES THE FLOOR?';
  return <section className={`recap-arcade ${ready ? 'recap-arcade--ready' : ''} ${motionEnabled ? 'recap-arcade--motion' : 'recap-arcade--still'} ${suspense ? 'recap-arcade--suspense' : ''} ${revealed ? 'recap-arcade--revealed' : ''}`} aria-label="Shift wrap-up">
    <div key={revealed ? 'reveal' : 'tally'} className="recap-arcade-confetti" aria-hidden="true">{motionEnabled && Array.from({length: 28}, (_, i) => <i key={i} style={{'--i': i, '--x': `${(i * 37) % 100}%`, '--turn': `${i * 47}deg`} as CSSProperties} />)}</div>
    <aside className="recap-stage-chef recap-stage-chef--you"><RecapMascot outcome={revealed ? outcome! : 'draw'} motionEnabled={motionEnabled} /><span>★ &nbsp; YOU &nbsp; ★</span></aside>
    <div className="recap-arcade-board">
      <span className="recap-arcade-crown" aria-hidden="true">♛</span>
      <p className="recap-arcade-overline">AFTER HOURS / YOUR SHIFT, REPLAYED</p>
      <h1>{heading}</h1>
      <p className="recap-arcade-label">{ready ? 'THE FINAL TALLY' : progress === 1 ? 'AND THE FLOOR GOES TO…' : progress < .32 ? 'COUNTING EVERY PLATE' : progress < .7 ? 'ADDING A LITTLE EXTRA' : 'BRINGING IT HOME'}</p>
      <div className="recap-arcade-score-wrap"><span className="recap-arcade-score-rays" aria-hidden="true" /><div className="recap-arcade-number" aria-hidden="true">{formatPoints(value)}</div></div>
      <span className="recap-arcade-label">YOUR TOTAL SCORE</span>
      <div className="recap-arcade-track" aria-hidden="true"><i style={{width: `${progress * 100}%`}} /></div>
      <div className="recap-arcade-matchup">
        {rivalScore === undefined ? facts.map((fact, index) => <div key={fact.label} className={time > index * 1000 || !motionEnabled ? '' : 'recap-fact-pending'}><span>{fact.label}</span><strong>{fact.value}</strong></div>) : <><div><span>YOU</span><strong>{formatPoints(value)}</strong></div><b className="recap-arcade-vs">VS</b><div><span>RIVAL</span><strong>{ready ? formatPoints(rivalScore) : '•••'}</strong></div></>}
      </div>
      <p className="recap-arcade-motto" role="status">{ready ? `Your final score: ${formatPoints(score)}. ${revealed ? outcome === 'win' ? 'You win! Big service. Bigger smiles.' : outcome === 'loss' ? 'Rival wins. Different shift. Another shot.' : 'Shift complete. Every plate counted.' : 'Waiting for the floor…'}` : 'GOOD FOOD. GOOD COMPANY. ONE LAST COUNT.'}</p>
    </div>
    <aside className="recap-stage-chef recap-stage-chef--rival"><RecapMascot outcome={revealed ? outcome === 'win' ? 'loss' : outcome === 'loss' ? 'win' : 'draw' : 'draw'} motionEnabled={motionEnabled} /><span>{rivalScore === undefined ? 'THE FLOOR' : 'RIVAL'}</span></aside>
    <div className="recap-arcade-next"><div><span>NEXT UP</span><strong>THE DETAILS.</strong></div><p>Break down your menu stars,<br />key moments, and more.</p><div><button type="button" disabled={!ready || !onReveal} onClick={onReveal}>{ready && onReveal ? 'EXPLORE YOUR RECAP →' : 'WRAPPING THE SHIFT…'}</button><small>{ready && onReveal ? 'EVERY PLATE HAS A STORY' : 'FIRST, WRAP THE SHIFT'}</small></div></div>
   {!ready && <button className="recap-arcade-skip" type="button" onClick={() => setSkipped(true)}>Skip tally →</button>}
  </section>;
}
