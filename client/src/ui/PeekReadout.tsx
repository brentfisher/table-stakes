// STORY-045. Peek (STORY-034, held `Q`) already puts the crowd from STORY-044 on screen once
// `CameraController.ts#PEEK_CAMERA`/`GameClient.ts`'s widened target bring the shared district
// street into frame — this small overlay adds the EXPLICIT reading a player would otherwise
// only get from `ResultsPanel` after the match ends. It surfaces the exact same
// `demand_conversion` constraint `TacticalOverviewPanel.tsx` already renders for all five
// constraints (`status.managerLedger.constraints`, STORY-037) — same field, same `evidence`
// string, no new computation and no new wire data (`match.js`'s own comment on `you.managerLedger`
// confirms it is already published live, every snapshot, phase-agnostic).
//
// Deliberately NOT a reuse of `TacticalOverviewPanel` — that panel is a full five-constraint,
// both-floors, deliberate full-attention Tab overview; Peek is a quick held glance with its own
// minimal HUD (see `GameClient.ts`'s `peeking` field doc comment), and the player's question
// while peeking is narrowly "am I under-attracting customers", not "what's every bottleneck on
// both floors". Showing only `demand_conversion` here keeps that framing honest.
//
// Read-only, same as every other Peek surface: this component has no `onX` callback and sends
// nothing to `GameClient`/the server (AC3 — Peek stays observability-only).

import type { GameClientStatus } from '../game/GameClient';

/**
 * Static UI copy, not scoring. `manager-ledger-system.js`'s own `RECOMMENDATIONS.demand_conversion`
 * text ("Revisit the front-door offer, price, or menu fit before the next rush.") is
 * server-internal — it is only ever assembled into `insights` at match end
 * (`ManagerLedgerResult`, STORY-037's results-only summary), never published on the live
 * `ManagerLedgerSnapshot` this overlay reads from. Peek needs a live nudge, not a wait for
 * results, so this mirrors that recommendation's INTENT as plain client copy rather than
 * exposing or duplicating its computation.
 */
const STRATEGY_NUDGE = 'Consider your price, menu fit, or a front-door special before the next rush.';

const STATUS_LABEL: Record<string, string> = {
  limiting: 'Losing customers',
  watch: 'Worth watching',
  clear: 'Holding steady',
};

export function PeekReadout({ status }: { status: GameClientStatus }): JSX.Element {
  const constraint = status.managerLedger?.constraints.find((entry) => entry.id === 'demand_conversion') ?? null;

  return (
    <div className="peek-readout" role="status">
      <h3>District signal</h3>
      {constraint ? (
        <>
          <p className={`peek-readout-status peek-readout-status--${constraint.status}`}>
            {STATUS_LABEL[constraint.status] ?? constraint.status}
          </p>
          <p className="peek-readout-evidence">{constraint.evidence}</p>
          {constraint.status !== 'clear' ? <p className="peek-readout-nudge">{STRATEGY_NUDGE}</p> : null}
        </>
      ) : (
        <p className="peek-readout-evidence">Not enough district activity recorded yet.</p>
      )}
    </div>
  );
}
