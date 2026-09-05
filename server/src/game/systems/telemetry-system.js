// STORY-022 §24 "final score gap over time". The one piece of the telemetry log that cannot be
// assembled after the fact from data another system already retains — an order's ledger and a
// party's decision both outlive the tick that produced them (`match.districtDecisions`,
// `order-system.js`'s own `deliverOrder`/`cancelOrder` log calls), but revenue is a live number
// with no history: `match.kitchen.revenueFor(playerId)` only ever answers "right now". This
// system's whole job is to sample that "right now" onto `match.telemetry` every
// `TELEMETRY_SAMPLE_INTERVAL_MS` of match time, so `telemetry-export.js` has a trend line to
// report instead of a single final number.
//
// THIS FILE OWNS NO SIMULATION STATE OTHERS READ, same shape as `hud-bottleneck-system.js`: it
// only reads `match.kitchen` (already published by `order-system.js`) and appends to
// `match.telemetry` via `Match#logEvent` — see that method's own header for why a plain object
// push is safe to call from a tick without perturbing the 10-20 Hz loop.
//
// REGISTRATION ORDER: last, after `scoring` — it depends on nothing scoring produces and
// nothing depends on it, so where it runs among the gameplay systems is not a contract, only a
// convention (registered last so a future system's ordering comment never has to mention it).

import { TELEMETRY_SAMPLE_INTERVAL_MS } from '../../../../shared/constants/tuning.js';

export const telemetrySystem = {
  id: 'telemetry',
  phases: ['service', 'final_rush'],

  update(match) {
    if (!match.kitchen) return; // order-system.js has not ticked yet this match.
    const state = (match._telemetrySampleState ??= { lastSampleMs: -Infinity });
    if (match.elapsedMs - state.lastSampleMs < TELEMETRY_SAMPLE_INTERVAL_MS) return;
    state.lastSampleMs = match.elapsedMs;

    const revenueByPlayer = {};
    for (const playerId of match.players.keys()) {
      revenueByPlayer[playerId] = match.kitchen.revenueFor(playerId);
    }
    match.logEvent('revenue_sample', { revenueByPlayer });
  },
};
