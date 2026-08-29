#!/usr/bin/env node
// Seeded event deck check — the executable half of STORY-011's acceptance criteria.
//
// The repo has no test framework (Milestone 0 Decision 8), so this is a runnable script, and
// like `check-match-lifecycle.mjs` it runs IN PROCESS: it constructs `Match` directly and steps
// it through `stepMatch` with synthetic `dtMs`. That is what makes a full 195-second service
// phase — and a few hundred of them — take milliseconds instead of hours, which is the only way
// a determinism property gets checked across enough seeds to mean anything.
//
// Run: node scripts/check-events.mjs

import { readFileSync } from 'node:fs';

import { Match } from '../server/src/game/match.js';
import { catalogue } from '../server/src/game/catalogue.js';
import { clearSystems, registerSystem, stepMatch } from '../server/src/game/simulation-loop.js';
import {
  eventSystem,
  buildEventTimeline,
  buildEventForecast,
  timelineDigest,
  dishDemandMultiplier,
  resolveEffects,
  neutralEventEffects,
  isHighImpact,
  eventImpactScore,
  EVENT_RNG_STREAM,
} from '../server/src/game/systems/event-system.js';
import { createRng } from '../server/src/game/rng.js';
import { STATIONS } from '../shared/schemas/messages.js';
import {
  EVENT_MIN_GAP_MS,
  EVENT_MAX_GAP_MS,
  EVENT_TAIL_MARGIN_MS,
  EVENT_MAX_CONCURRENT_HIGH_IMPACT,
  EVENT_ENDED_VISIBLE_MS,
  EVENT_TEASER_LEAD_BOUNDS_MS,
  EVENT_DEMAND_SHIFT_BAND,
  PHASE_DURATIONS_MS,
} from '../shared/constants/tuning.js';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const realLog = console.log;
function quiet(fn) {
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = realLog;
  }
}

const TICK_MS = 50;
const SEEDS = Array.from({ length: 120 }, (_, i) => `deck-seed-${i}`);
const PRESETS = ['prototype', 'full'];
const windowFor = (preset) =>
  PHASE_DURATIONS_MS[preset].service + PHASE_DURATIONS_MS[preset].final_rush;

/** Build a timeline for one market directly, independently of which market a seed selects. */
function timelineFor(market, seed, preset) {
  return buildEventTimeline({
    rng: createRng(`${seed}:${EVENT_RNG_STREAM}`),
    market,
    windowMs: windowFor(preset),
  });
}

/** Drive a match from the lobby to the end, sampling per tick. */
function runMatch(seed, preset, onTick) {
  const match = new Match({ id: `m_${seed}`, seed, phasePreset: preset });
  const outbound = [];
  quiet(() => {
    for (const id of ['p1', 'p2']) match.join({ fallbackPlayerId: id });
    for (const id of ['p1', 'p2']) match.setReady(id, true);
    for (let i = 0; i < 200_000 && !match.ended; i += 1) {
      stepMatch(match, TICK_MS, { onOutbound: (m) => outbound.push(m) });
      for (const id of ['p1', 'p2']) match.setReady(id, true); // skip setup quickly
      if (onTick) onTick(match, outbound);
    }
  });
  return { match, outbound };
}

console.log('Seeded event deck check\n');

clearSystems();
registerSystem(eventSystem);

// --- 1. the data the deck draws from ---------------------------------------------------
{
  const nonZero = catalogue.events.filter((e) => e.warningMs > 0);
  check(
    'every non-zero `warningMs` is a PRD §9 teaser lead of 10-20 seconds',
    nonZero.length > 0 &&
      nonZero.every(
        (e) =>
          e.warningMs >= EVENT_TEASER_LEAD_BOUNDS_MS.min &&
          e.warningMs <= EVENT_TEASER_LEAD_BOUNDS_MS.max,
      ),
    `${nonZero.length}/${catalogue.events.length} telegraphed: ` +
      nonZero.map((e) => `${e.id}=${e.warningMs}ms`).join(' '),
  );

  // §9's stacking rule and the 30-60s cadence are only jointly satisfiable if every pool has a
  // card the cap can always admit. Without this, a pool of nothing but high-impact events would
  // force the builder either to skip a slot (breaking the cadence) or to throw.
  const poolsWithEscape = catalogue.markets.map((m) => ({
    id: m.id,
    low: m.eventPool.filter((id) => !isHighImpact(catalogue.eventsById[id])),
  }));
  check(
    "every market's eventPool contains at least one low-impact card the cap always admits",
    poolsWithEscape.every((p) => p.low.length > 0),
    poolsWithEscape.map((p) => `${p.id}:${p.low.length}`).join(' '),
  );

  // PRD §9: "avoid pure negative events that feel unavoidable and random". An event qualifies
  // either by carrying an upside a player can aim at, or by scoping its penalty to a subset
  // they can route around — never both absent.
  const ingredientCount = Object.keys(catalogue.ingredients).length;
  const unavoidable = catalogue.events.filter((e) => {
    const fx = e.effects;
    const hasUpside =
      fx.footTrafficMultiplier > 1 ||
      fx.partySizeMultiplier > 1 ||
      Object.values(fx.dishTagDemandMultipliers ?? {}).some((m) => m > 1) ||
      Object.entries(fx).some(([k, v]) => k.endsWith('Multiplier') && k !== 'ingredientCostMultiplier' &&
        k !== 'ingredientRestockDurationMultiplier' && Number.isFinite(v) && v > 1) ||
      Boolean(fx.specialPartySpawn);
    const stationsHit = Object.keys(fx.stationSpeedMultipliers ?? {});
    const routableStations = stationsHit.length > 0 && stationsHit.length < STATIONS.length;
    const routableIngredients =
      Number.isFinite(fx.affectedIngredientCount) &&
      fx.affectedIngredientCount > 0 &&
      fx.affectedIngredientCount < ingredientCount;
    return !hasUpside && !routableStations && !routableIngredients;
  });
  check(
    'no event is a pure unavoidable negative — each has an upside or a penalty to route around',
    unavoidable.length === 0,
    unavoidable.length ? unavoidable.map((e) => e.id).join(', ') : 'all 10 events',
  );

  check(
    'every event description is plain language that names what to consider (§9 design rule)',
    catalogue.events.every(
      (e) =>
        typeof e.description === 'string' &&
        e.description.length >= 40 &&
        /[.!]$/.test(e.description.trim()) &&
        !/[{}_]|Multiplier/.test(e.description),
    ),
    `shortest ${Math.min(...catalogue.events.map((e) => e.description.length))} chars`,
  );
}

// --- 2. effects are data, not code -------------------------------------------------------
{
  const source = readFileSync(new URL('../server/src/game/systems/event-system.js', import.meta.url), 'utf8');
  const leaked = catalogue.events.map((e) => e.id).filter((id) => source.includes(id));
  check(
    'no event id appears in event-system.js — every behaviour comes from events.json',
    leaked.length === 0,
    leaked.length ? `hardcoded: ${leaked.join(', ')}` : 'checked all 10 ids against the source',
  );

  // And the effect vocabulary is discovered from the data: every key any event uses is present
  // and neutral even when nothing is running.
  const neutral = neutralEventEffects(catalogue.markets[0]);
  const usedKeys = new Set(catalogue.events.flatMap((e) => Object.keys(e.effects)));
  const missing = [...usedKeys].filter((k) => !(k in neutral) && k !== 'specialPartySpawn');
  check(
    'the neutral effects object carries every key any event uses, so consumers never branch',
    missing.length === 0 &&
      neutral.footTrafficMultiplier === 1 &&
      neutral.patienceMultiplier === 1 &&
      neutral.affectedIngredientCount === 0 &&
      Object.keys(neutral.stationSpeedMultipliers).length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : [...usedKeys].sort().join(', '),
  );
}

// --- 3. the same seed yields the same timeline -------------------------------------------
{
  let identical = true;
  let distinctAcrossSeeds = new Set();
  for (const market of catalogue.markets) {
    for (const preset of PRESETS) {
      for (const seed of SEEDS.slice(0, 40)) {
        const a = JSON.stringify(timelineDigest(timelineFor(market, seed, preset)));
        const b = JSON.stringify(timelineDigest(timelineFor(market, seed, preset)));
        if (a !== b) identical = false;
        if (preset === 'prototype' && market.id === catalogue.markets[0].id) {
          distinctAcrossSeeds.add(a);
        }
      }
    }
  }
  check(
    'the same seed builds a byte-identical timeline, every market, both presets',
    identical,
    `${catalogue.markets.length} markets x ${PRESETS.length} presets x 40 seeds`,
  );
  check(
    'different seeds build different timelines — the deck is seeded, not fixed',
    distinctAcrossSeeds.size > 30,
    `${distinctAcrossSeeds.size} distinct timelines from 40 seeds`,
  );

  // And through the real match, drawn from the named sub-stream (Decision 18).
  const { match: m1 } = runMatch('twin-seed', 'prototype');
  const { match: m2 } = runMatch('twin-seed', 'prototype');
  check(
    'two matches on one seed produce the same timeline through the real system and clock',
    JSON.stringify(timelineDigest(m1.eventTimeline)) ===
      JSON.stringify(timelineDigest(m2.eventTimeline)) && m1.eventTimeline.entries.length > 0,
    `${m1.eventTimeline.entries.length} events: ${timelineDigest(m1.eventTimeline)
      .map((e) => `${e.eventId}@${e.activateAtMs}`)
      .join(' ')}`,
  );
}

// --- 4. both players receive the identical timeline ---------------------------------------
{
  // THE fairness contract (PRD §9, Decision 6). Asserted on EVERY tick of a full match, not on
  // samples: a per-player draw would only have to differ once.
  let ticks = 0;
  let mismatchAt = null;
  let sawWarning = false;
  let sawActive = false;
  let sawEnded = false;
  let sawForecast = false;

  const { outbound } = runMatch('fairness', 'prototype', (match) => {
    const p1 = match.toSnapshot('p1');
    const p2 = match.toSnapshot('p2');
    ticks += 1;
    if (
      mismatchAt === null &&
      (JSON.stringify(p1.events) !== JSON.stringify(p2.events) ||
        JSON.stringify(p1.eventForecast) !== JSON.stringify(p2.eventForecast))
    ) {
      mismatchAt = match.elapsedMs;
    }
    for (const e of p1.events) {
      if (e.state === 'warning') sawWarning = true;
      if (e.state === 'active') sawActive = true;
      if (e.state === 'ended') sawEnded = true;
    }
    if (p1.matchPhase === 'setup' && p1.eventForecast.length > 0) sawForecast = true;
  });

  check(
    'both players receive byte-identical `events` and `eventForecast` on EVERY tick of a match',
    mismatchAt === null && ticks > 0 && sawWarning && sawActive,
    `${ticks} ticks compared, no per-player state exists to diverge`,
  );
  check(
    'the §9 announcement flow is observable: warning -> active -> ended in match_snapshot.events',
    sawWarning && sawActive && sawEnded,
    `warning=${sawWarning} active=${sawActive} ended=${sawEnded} (ended lingers ${EVENT_ENDED_VISIBLE_MS}ms)`,
  );
  check(
    'the §7 setup forecast is populated during setup, before service starts',
    sawForecast,
    'match_snapshot.eventForecast',
  );

  const announces = outbound.filter((m) => m.type === 'event_announce');
  check(
    'event_announce is broadcast to the room through the outbox — a system never touches a socket',
    announces.length > 0,
    `${announces.length} announcements`,
  );
}

// --- 5. the §12 event_announce envelope and its timing ------------------------------------
{
  const { match, outbound } = runMatch('announce', 'full');
  const announces = outbound.filter((m) => m.type === 'event_announce');
  const entries = match.eventTimeline.entries;

  const wellFormed = announces.every(
    (m) =>
      Object.keys(m).sort().join(',') ===
        'description,durationMs,eventId,startsInMs,title,type' &&
      typeof m.eventId === 'string' &&
      typeof m.title === 'string' &&
      typeof m.description === 'string' &&
      Number.isFinite(m.startsInMs) &&
      m.startsInMs >= 0 &&
      Number.isFinite(m.durationMs) &&
      m.durationMs > 0 &&
      m.title === catalogue.eventsById[m.eventId].title &&
      m.durationMs === catalogue.eventsById[m.eventId].durationMs,
  );
  check(
    'every event_announce carries exactly the PRD §12 envelope, with data-sourced fields',
    wellFormed && announces.length === entries.length,
    `${announces.length} announcements for ${entries.length} scheduled events; ` +
      `example ${JSON.stringify(announces[0])}`,
  );

  // The countdown: an event with a teaser announces `warningMs` early (within one tick), an
  // event with none announces at activation with startsInMs 0.
  const paired = entries.map((entry, i) => ({ entry, msg: announces[i] }));
  const leadOk = paired.every(({ entry, msg }) => {
    if (entry.warningMs === 0) return msg.startsInMs === 0;
    return (
      msg.startsInMs > 0 &&
      Math.abs(msg.startsInMs - entry.warningMs) <= TICK_MS &&
      msg.startsInMs >= EVENT_TEASER_LEAD_BOUNDS_MS.min - TICK_MS &&
      msg.startsInMs <= EVENT_TEASER_LEAD_BOUNDS_MS.max
    );
  });
  check(
    'the announcement leads activation by the event\'s teaser lead, or fires at 0 when untelegraphed',
    leadOk && paired.length > 0,
    paired.map(({ entry, msg }) => `${entry.eventId}:${msg.startsInMs}ms`).join(' '),
  );

  check(
    'each scheduled occurrence announces exactly once — no repeat on the next tick',
    announces.length === entries.length &&
      new Set(announces.map((m, i) => i)).size === entries.length,
    `${announces.length} messages, ${entries.length} occurrences`,
  );
}

// --- 6. cadence: an event every 30-60 seconds ---------------------------------------------
{
  let worstGap = null;
  let worstFirst = null;
  let worstTail = null;
  let total = 0;
  let violations = 0;

  for (const market of catalogue.markets) {
    for (const preset of PRESETS) {
      for (const seed of SEEDS) {
        const timeline = timelineFor(market, seed, preset);
        const times = timeline.entries.map((e) => e.activateAtMs);
        if (times.length === 0) violations += 1;
        total += 1;

        const first = times[0];
        if (first < EVENT_MIN_GAP_MS || first > EVENT_MAX_GAP_MS) violations += 1;
        if (worstFirst === null || first > worstFirst) worstFirst = first;

        for (let i = 1; i < times.length; i += 1) {
          const gap = times[i] - times[i - 1];
          if (gap < EVENT_MIN_GAP_MS || gap > EVENT_MAX_GAP_MS) violations += 1;
          if (worstGap === null || gap > worstGap) worstGap = gap;
        }
        // The tail: the deck stops when the next slot would leave an event no room to matter,
        // so the trailing quiet stretch is bounded by one max gap plus that margin.
        const tail = timeline.windowMs - times.at(-1);
        if (tail > EVENT_MAX_GAP_MS + EVENT_TAIL_MARGIN_MS) violations += 1;
        if (worstTail === null || tail > worstTail) worstTail = tail;
      }
    }
  }
  check(
    'events fire every 30-60s across a full service phase, every market, both presets',
    violations === 0,
    `${total} timelines; longest gap ${worstGap}ms, first event by ${worstFirst}ms, ` +
      `longest tail ${worstTail}ms (bound ${EVENT_MAX_GAP_MS + EVENT_TAIL_MARGIN_MS}ms)`,
  );
}

// --- 7. no more than two high-impact events overlap ---------------------------------------
{
  const overlapPeak = (entries, onlyHighImpact) => {
    const points = [];
    for (const e of entries) {
      if (onlyHighImpact && !e.highImpact) continue;
      points.push({ at: e.activateAtMs, d: 1 }, { at: e.endAtMs, d: -1 });
    }
    points.sort((a, b) => a.at - b.at || a.d - b.d);
    let cur = 0;
    let peak = 0;
    for (const p of points) {
      cur += p.d;
      if (cur > peak) peak = cur;
    }
    return peak;
  };

  let peakHigh = 0;
  let peakAny = 0;
  let count = 0;
  for (const market of catalogue.markets) {
    for (const preset of PRESETS) {
      for (const seed of SEEDS) {
        const { entries } = timelineFor(market, seed, preset);
        peakHigh = Math.max(peakHigh, overlapPeak(entries, true));
        peakAny = Math.max(peakAny, overlapPeak(entries, false));
        count += 1;
      }
    }
  }
  check(
    'no more than two high-impact events are ever active at once (§9 design rule)',
    peakHigh <= EVENT_MAX_CONCURRENT_HIGH_IMPACT,
    `${count} timelines, peak high-impact concurrency ${peakHigh}, peak of any kind ${peakAny}`,
  );

  // The cap is ENFORCED, not merely unlikely. With shipped data the 30-60s cadence already
  // bounds concurrency at two, so the enforcement path never runs — prove it works by feeding
  // the builder events long enough to stack three, and requiring the low-impact escape card to
  // be swapped in rather than the cap to be broken.
  const stress = {
    heavy_a: { id: 'heavy_a', title: 'A', description: 'x', warningMs: 0, durationMs: 120_000,
      effects: { footTrafficMultiplier: 2, segmentWeightOverrides: {}, dishTagDemandMultipliers: {}, partySizeMultiplier: 1 } },
    heavy_b: { id: 'heavy_b', title: 'B', description: 'x', warningMs: 0, durationMs: 120_000,
      effects: { footTrafficMultiplier: 2, segmentWeightOverrides: {}, dishTagDemandMultipliers: {}, partySizeMultiplier: 1 } },
    heavy_c: { id: 'heavy_c', title: 'C', description: 'x', warningMs: 0, durationMs: 120_000,
      effects: { footTrafficMultiplier: 2, segmentWeightOverrides: {}, dishTagDemandMultipliers: {}, partySizeMultiplier: 1 } },
    mild_d: { id: 'mild_d', title: 'D', description: 'x', warningMs: 0, durationMs: 120_000,
      effects: { footTrafficMultiplier: 1.05, segmentWeightOverrides: {}, dishTagDemandMultipliers: {}, partySizeMultiplier: 1 } },
  };
  const stressMarket = {
    id: 'stress_market',
    segmentWeights: catalogue.markets[0].segmentWeights,
    eventPool: ['heavy_a', 'heavy_b', 'heavy_c', 'mild_d'],
  };
  let stressPeak = 0;
  let mildUsed = 0;
  let stressed = 0;
  for (const seed of SEEDS) {
    const t = buildEventTimeline({
      rng: createRng(`${seed}:stress`),
      market: stressMarket,
      windowMs: 600_000,
      eventsById: stress,
    });
    stressPeak = Math.max(stressPeak, overlapPeak(t.entries, true));
    mildUsed += t.entries.filter((e) => e.eventId === 'mild_d').length;
    stressed += 1;
  }
  check(
    'the cap is enforced by the builder: 120s events that would stack three swap in a low-impact card',
    stressPeak <= EVENT_MAX_CONCURRENT_HIGH_IMPACT && mildUsed > 0,
    `${stressed} stress timelines, peak ${stressPeak}, low-impact card used ${mildUsed} times`,
  );

  // And an unschedulable pool fails loudly rather than quietly breaking a rule.
  let threw = false;
  try {
    buildEventTimeline({
      rng: createRng('impossible'),
      market: { id: 'no_escape', segmentWeights: {}, eventPool: ['heavy_a', 'heavy_b', 'heavy_c'] },
      windowMs: 600_000,
      eventsById: stress,
    });
  } catch {
    threw = true;
  }
  check(
    'a pool of nothing but high-impact long events throws at build time instead of breaking the cap',
    threw,
    'loud failure, in the spirit of CatalogueError',
  );
}

// --- 8. every event in events.json can fire ------------------------------------------------
{
  const fired = new Set();
  for (const market of catalogue.markets) {
    for (const preset of PRESETS) {
      for (const seed of SEEDS) {
        for (const entry of timelineFor(market, seed, preset).entries) fired.add(entry.eventId);
      }
    }
  }
  const never = catalogue.events.map((e) => e.id).filter((id) => !fired.has(id));
  check(
    'every event in events.json is reachable — each one fires in some seeded timeline',
    never.length === 0 && fired.size === catalogue.events.length,
    `${fired.size}/${catalogue.events.length} events fired${never.length ? `; never: ${never.join(', ')}` : ''}`,
  );
}

// --- 9. effects are applied from the data --------------------------------------------------
{
  // Each of the four §16 keys, resolved from the catalogue and nothing else.
  const market = catalogue.marketsById.stadium_district;
  const baseball = catalogue.eventsById.baseball_game_ends;
  const fx = resolveEffects(market, [baseball]);
  const weightSum = Object.values(fx.segmentWeights).reduce((s, w) => s + w, 0);
  check(
    'the four §16 effect keys resolve straight from events.json onto match state',
    fx.footTrafficMultiplier === baseball.effects.footTrafficMultiplier &&
      fx.partySizeMultiplier === baseball.effects.partySizeMultiplier &&
      fx.dishTagDemandMultipliers.stadium === baseball.effects.dishTagDemandMultipliers.stadium &&
      fx.segmentWeights.event_fan === baseball.effects.segmentWeightOverrides.event_fan &&
      Math.abs(weightSum - 1) < 1e-9,
    `footTraffic=${fx.footTrafficMultiplier} partySize=${fx.partySizeMultiplier} ` +
      `event_fan ${market.segmentWeights.event_fan} -> ${fx.segmentWeights.event_fan}, sums to ${weightSum.toFixed(6)}`,
  );

  // Decision 12: an override replaces, the rest redistributes proportionally, ratios preserved.
  const untouched = ['office_worker', 'neighborhood_regular'];
  const baseRatio = market.segmentWeights[untouched[0]] / market.segmentWeights[untouched[1]];
  const afterRatio = fx.segmentWeights[untouched[0]] / fx.segmentWeights[untouched[1]];
  check(
    'a segment override replaces its weight and the rest redistributes proportionally (Decision 12)',
    Math.abs(baseRatio - afterRatio) < 1e-9 &&
      fx.segmentWeights.office_worker < market.segmentWeights.office_worker,
    `office_worker ${market.segmentWeights.office_worker} -> ${fx.segmentWeights.office_worker.toFixed(4)}, ratio held`,
  );

  // Every event's own effects survive the round trip, including the Decision 12 extensions.
  const roundTrip = catalogue.events.every((event) => {
    const r = resolveEffects(market, [event]);
    return Object.entries(event.effects).every(([key, value]) => {
      if (key.endsWith('Multiplier') && Number.isFinite(value)) return r[key] === value;
      if (key.endsWith('Multipliers')) {
        return Object.entries(value).every(([k, v]) => r[key][k] === v);
      }
      if (key === 'specialPartySpawn') return r.specialPartySpawns[0]?.segment === value.segment;
      return true;
    });
  });
  check(
    'all ten events publish their authored effects, §16 keys and named extensions alike',
    roundTrip,
    'patienceMultiplier, stationSpeedMultipliers, ingredient*, specialPartySpawn, …',
  );

  // Two overlapping events compose rather than one silently winning.
  const both = resolveEffects(market, [
    catalogue.eventsById.happy_hour_nearby,
    catalogue.eventsById.transit_delay,
  ]);
  const expectedFoot =
    catalogue.eventsById.happy_hour_nearby.effects.footTrafficMultiplier *
    catalogue.eventsById.transit_delay.effects.footTrafficMultiplier;
  check(
    'two simultaneously active events compose multiplicatively',
    both.footTrafficMultiplier === expectedFoot && both.activeEventIds.length === 2,
    `${both.activeEventIds.join(' + ')} -> footTraffic ${both.footTrafficMultiplier.toFixed(4)}`,
  );

  // Neutral between events, republished every tick.
  const idle = resolveEffects(market, []);
  check(
    'with no event active every key reads neutral, so a consumer needs no defensive branch',
    idle.footTrafficMultiplier === 1 &&
      idle.partySizeMultiplier === 1 &&
      idle.patienceMultiplier === 1 &&
      idle.activeEventIds.length === 0 &&
      Object.keys(idle.dishTagDemandMultipliers).length === 0 &&
      JSON.stringify(idle.segmentWeights) === JSON.stringify({ ...market.segmentWeights }),
    'segmentWeights fall back to the market unchanged',
  );
}

// --- 10. PRD §24 magnitude: a strong affinity moves demand 15-40% ---------------------------
{
  const rows = [];
  let inBand = true;
  for (const event of catalogue.events) {
    const tags = Object.keys(event.effects.dishTagDemandMultipliers ?? {});
    if (tags.length === 0) continue; // an operational event has no dish affinity to measure
    const fx = resolveEffects(catalogue.markets[0], [event]);
    let strongest = { dishId: null, m: 1 };
    for (const dish of catalogue.dishes) {
      const m = dishDemandMultiplier(fx, dish.tags);
      if (m > strongest.m) strongest = { dishId: dish.id, m };
    }
    rows.push(`${event.id}/${strongest.dishId}=${((strongest.m - 1) * 100).toFixed(0)}%`);
    if (strongest.m < EVENT_DEMAND_SHIFT_BAND.min || strongest.m > EVENT_DEMAND_SHIFT_BAND.max) {
      inBand = false;
    }
  }
  check(
    'the strongest event-dish affinity moves demand 15-40% for every event that has one (§24)',
    inBand && rows.length >= 5,
    rows.join(' '),
  );

  // The A/B the acceptance criterion asks for: two seeded runs of the SAME match, one with the
  // event system registered and one without, sampling the demand multiplier for a dish that
  // matches an event's strongest tag. The control is flat 1.0 by construction; the treatment
  // moves only while the event is active, and by exactly the authored amount.
  const seed = SEEDS.find((s) => {
    const m = new Match({ id: 'probe', seed: s, phasePreset: 'prototype' });
    return m.config.marketId === 'stadium_district';
  });
  const nachos = catalogue.dishesById.nachos;

  clearSystems(); // control: no event system at all
  const control = [];
  runMatch(seed, 'prototype', (match) => {
    if (match.isServicePhase) control.push(dishDemandMultiplier(match.eventEffects, nachos.tags));
  });

  clearSystems();
  registerSystem(eventSystem);
  const treatment = [];
  let duringBaseball = [];
  const { match: treated } = runMatch(seed, 'prototype', (match) => {
    if (!match.isServicePhase) return;
    const m = dishDemandMultiplier(match.eventEffects, nachos.tags);
    treatment.push(m);
    if (match.eventEffects.activeEventIds.includes('baseball_game_ends')) duringBaseball.push(m);
  });

  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  const controlMean = mean(control);
  const duringMean = mean(duringBaseball);
  const shiftPct = ((duringMean / controlMean - 1) * 100);
  check(
    'measured A/B: nachos demand during Baseball Game Ends vs the same seeded run with no events',
    control.length > 0 &&
      duringBaseball.length > 0 &&
      controlMean === 1 &&
      duringMean / controlMean >= EVENT_DEMAND_SHIFT_BAND.min &&
      duringMean / controlMean <= EVENT_DEMAND_SHIFT_BAND.max,
    `market ${treated.config.marketId}, seed "${seed}": control x${controlMean.toFixed(4)} over ` +
      `${control.length} ticks, event x${duringMean.toFixed(4)} over ${duringBaseball.length} ticks ` +
      `= +${shiftPct.toFixed(1)}% (band 15-40%)`,
  );

  // The rule that keeps it in band: strongest matching tag, not the product of all of them.
  const theater = resolveEffects(catalogue.markets[1], [catalogue.eventsById.theater_curtain_call]);
  const cheesecake = catalogue.dishesById.cheesecake;
  const product = cheesecake.tags.reduce(
    (p, t) => p * (theater.dishTagDemandMultipliers[t] ?? 1),
    1,
  );
  check(
    'the strongest-tag rule keeps a triple-matching dish in band where the product rule would not',
    dishDemandMultiplier(theater, cheesecake.tags) <= EVENT_DEMAND_SHIFT_BAND.max &&
      product > EVENT_DEMAND_SHIFT_BAND.max,
    `cheesecake under theater_curtain_call: strongest-tag x${dishDemandMultiplier(theater, cheesecake.tags)} ` +
      `vs product x${product.toFixed(3)} (+${((product - 1) * 100).toFixed(0)}%)`,
  );
}

// --- 11. the setup forecast reveals what, not when ------------------------------------------
{
  clearSystems();
  registerSystem(eventSystem);

  let setupSnapshot = null;
  const { match } = runMatch('forecast', 'full', (m) => {
    if (m.phase === 'setup' && !setupSnapshot) setupSnapshot = m.toSnapshot('p1');
  });
  const forecast = setupSnapshot?.eventForecast ?? [];
  const timelineIds = new Set(match.eventTimeline.entries.map((e) => e.eventId));

  const noTimes = forecast.every((f) => {
    const keys = Object.keys(f);
    return (
      keys.every((k) => !/^(activateAt|announceAt|endAt|startsIn|endsIn|warning)/.test(k)) &&
      keys.sort().join(',') === 'description,durationMs,eventId,occurrences,telegraphed,title'
    );
  });
  const sortedById = JSON.stringify(forecast.map((f) => f.eventId)) ===
    JSON.stringify([...forecast.map((f) => f.eventId)].sort());
  const firstFiring = [...timelineIds][0];

  check(
    'the setup forecast lists every event in the timeline and no firing time of any kind',
    forecast.length > 0 &&
      noTimes &&
      forecast.every((f) => timelineIds.has(f.eventId)) &&
      [...timelineIds].every((id) => forecast.some((f) => f.eventId === id)),
    `${forecast.length} distinct events: ${forecast.map((f) => `${f.eventId}x${f.occurrences}`).join(' ')}`,
  );
  check(
    'the forecast is ordered by event id, so its ORDER does not leak the schedule either',
    sortedById && forecast.length > 1,
    `first forecast entry "${forecast[0]?.eventId}", first to fire "${firstFiring}"`,
  );

  // And the forecast is deterministic and identical for both players, like everything else.
  const a = buildEventForecast(match.eventTimeline);
  check(
    'the forecast is derived from the timeline, so it is the same for both players by construction',
    JSON.stringify(a) === JSON.stringify(match.eventForecast),
    'buildEventForecast(timeline)',
  );
}

// --- 12. impact classification is data-derived ----------------------------------------------
{
  const scored = catalogue.events.map((e) => ({
    id: e.id,
    score: eventImpactScore(e.effects),
    high: isHighImpact(e),
  }));
  const highs = scored.filter((s) => s.high);
  check(
    'high impact is scored from the §16 demand keys, splitting the catalogue rather than tagging it',
    highs.length > 0 && highs.length < scored.length,
    scored.map((s) => `${s.id}=${s.score.toFixed(2)}${s.high ? '*' : ''}`).join(' '),
  );
}

clearSystems();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
