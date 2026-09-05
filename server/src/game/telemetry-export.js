// STORY-022. Turns a live `Match`'s scattered, already-published data into the two artifacts
// PRD §20/§21/§24 ask for: a diffable structured event log, and a per-match balance summary.
//
// WHY THIS IS A SEPARATE MODULE, NOT MORE OF `match.js`: both functions here only ever READ —
// `match.telemetry` (built incrementally by `Match#logEvent`, called from `match.js`,
// `message-router.js` and `order-system.js`'s own lifecycle points), `match.districtDecisions`
// (STORY-010/014), `match.eventTimeline` (STORY-011's own `timelineDigest`), `match.districtSummary`
// (STORY-014) and `match.brigade.routineWorkFor()` (STORY-007) — every one of them a value some
// other system already computed and published for its own reasons. Nothing here is a second
// copy of a simulation number; it is a reshaping pass, run once at export time, never on the
// simulation tick.
//
// DIFFABILITY (the AC: "replaying the same seed with the same inputs produces a matching event
// timeline"). Two things that would break it, deliberately avoided:
//   1. No wall-clock. Every timestamp in the exported body is `atMs`, a match-clock coordinate
//      (`match.elapsedMs` at the moment `logEvent` was called) — never `Date.now()` or
//      `match.createdAt`, both of which differ between two runs of the same seed.
//   2. No raw `playerId`. `connection-manager.js` hands them out from a module-level counter
//      that keeps incrementing across every match a server process has ever hosted, so the same
//      seed run twice in one process gets different ids ("player_3" vs "player_7"). `seatLabel`
//      below relabels every player/restaurant id to its JOIN-ORDER seat ("seat0"/"seat1"),
//      which the seed and the client's connection order fix identically in both runs.

import { timelineDigest } from './systems/event-system.js';

/** "seat0"/"seat1", in the order these players first joined — stable across two runs of the
 * same seed, unlike the raw `playerId` connection-manager.js hands out. */
function seatLabels(match) {
  const seatOf = new Map();
  let i = 0;
  for (const playerId of match.players.keys()) {
    seatOf.set(playerId, `seat${i}`);
    i += 1;
  }
  return seatOf;
}

/** Relabel the well-known scalar id fields on a flat telemetry record. Every `logEvent` payload
 * in this codebase is flat (see the call sites in match.js/message-router.js/order-system.js),
 * so a shallow pass is enough — there is no nested map keyed by playerId to walk. */
const ID_FIELDS = ['playerId', 'restaurantId', 'chosenRestaurantId', 'disconnectedPlayerId', 'winnerPlayerId'];
function relabel(entry, seatOf) {
  const out = { ...entry };
  for (const field of ID_FIELDS) {
    if (typeof out[field] === 'string' && seatOf.has(out[field])) out[field] = seatOf.get(out[field]);
  }
  if (out.revenueByPlayer) {
    out.revenueByPlayer = Object.fromEntries(
      Object.entries(out.revenueByPlayer).map(([id, v]) => [seatOf.get(id) ?? id, v]),
    );
  }
  return out;
}

/**
 * PRD §20 "server event logs and debug traces" / §21 Milestone 4. One flat, time-ordered array:
 * `match.telemetry`'s own incremental entries (connections, phase transitions, validated and
 * rejected actions, order lifecycles, revenue samples) merged with the two records that already
 * live elsewhere as a full match-long array — customer decisions and the event schedule — so a
 * caller diffing two runs has exactly one array to compare, not four.
 */
export function buildMatchLog(match) {
  const seatOf = seatLabels(match);

  const decisionEntries = (match.districtDecisions ?? []).map((d) => ({
    atMs: d.atMs,
    category: 'customer_decision',
    customerId: d.customerId,
    segmentId: d.segmentId,
    partySize: d.partySize,
    chosenRestaurantId: d.chosenRestaurantId,
    reason: d.reason,
  }));

  const eventEntries = timelineDigest(match.eventTimeline).map((e) => ({
    atMs: e.announceAtMs,
    category: 'event_scheduled',
    eventId: e.eventId,
    activateAtMs: e.activateAtMs,
    endAtMs: e.endAtMs,
    durationMs: e.durationMs,
    highImpact: e.highImpact,
  }));

  const events = [...match.telemetry, ...decisionEntries, ...eventEntries]
    .map((entry) => relabel(entry, seatOf))
    // Stable sort by atMs: Array#sort is stable per spec, so entries that share an atMs keep
    // the relative order they were produced/merged in above — itself deterministic given the
    // same seed and the same tick sequence.
    .sort((a, b) => a.atMs - b.atMs);

  return {
    seed: match.seed,
    marketId: match.config.marketId,
    layoutId: match.config.layoutId,
    phasePreset: match.phasePreset,
    events,
  };
}

/**
 * PRD §24's balance figures, read straight off what STORY-007/010/014 already computed —
 * nothing here recomputes a simulation number, it only picks the five §24 asks out of data
 * that already exists and relabels the ids the same way `buildMatchLog` does.
 */
export function buildMatchSummary(match) {
  const seatOf = seatLabels(match);
  const relabelId = (id) => seatOf.get(id) ?? id;

  const partiesServedByRestaurant = Object.fromEntries(
    (match.districtSummary ?? []).map((r) => [relabelId(r.restaurantId), r.guestsServed]),
  );

  const staffRoutineWorkShare = Object.fromEntries(
    [...match.players.keys()].map((playerId) => [
      relabelId(playerId),
      match.brigade?.routineWorkFor(playerId) ?? null,
    ]),
  );

  const actionEntries = match.telemetry.filter((e) => e.category === 'action');
  const playerInterventions = {};
  const upgradeCadence = {};
  for (const playerId of match.players.keys()) {
    const label = relabelId(playerId);
    playerInterventions[label] = actionEntries.filter(
      (e) => e.playerId === playerId && e.message === 'interact' && e.outcome === 'accepted',
    ).length;
    upgradeCadence[label] = actionEntries
      .filter((e) => e.playerId === playerId && e.message === 'purchase_upgrade' && e.outcome === 'accepted')
      .map((e) => ({ atMs: e.atMs, upgradeId: e.upgradeId }));
  }

  const revenueGapOverTime = match.telemetry
    .filter((e) => e.category === 'revenue_sample')
    .map((e) => {
      const byLabel = Object.fromEntries(
        Object.entries(e.revenueByPlayer).map(([id, v]) => [relabelId(id), v]),
      );
      const [a, b] = Object.values(byLabel);
      return { atMs: e.atMs, revenueByPlayer: byLabel, gap: a === undefined || b === undefined ? null : Math.abs(a - b) };
    });

  return {
    seed: match.seed,
    partiesServedByRestaurant,
    staffRoutineWorkShare,
    playerInterventions,
    upgradeCadence,
    revenueGapOverTime,
  };
}
