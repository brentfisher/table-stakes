// The seeded event deck and the PRD §9 announcement flow.
//
// PRD §9 "Dynamic events": events are announced every 30-60 seconds during service, drawn from
// a SEEDED DECK rather than free randomness, and — the property this whole file exists to
// protect — "each match receives the same event timeline for both players. Events may affect
// players asymmetrically only because their menus, prices, upgrades, and current restaurant
// states differ."
//
// THE FAIRNESS CONTRACT, stated so it cannot be eroded by accident:
//
//   The timeline is a property of the MATCH, not of a player. It is built once, from
//   `match.createRngStream('events')` (Decision 18) and the active market's `eventPool`, and
//   nothing in this file ever takes a player as an argument. There is no per-player draw to
//   remove later, because there is no per-player anything: `match.events`,
//   `match.eventForecast` and `match.eventEffects` are single values on the match, and
//   `toSnapshot` copies the same object into both viewers' snapshots. A future change that
//   wants an asymmetric event must express the asymmetry in the RESTAURANT, never here.
//
// EFFECTS ARE DATA (PRD §16, Decision 12). No event id appears anywhere in this module and no
// event's behaviour is written here — `scripts/check-events.mjs` greps this source for all ten
// ids and fails if one shows up. What this module knows is the effect VOCABULARY's naming
// convention, not any particular event: a key ending in `Multiplier` is a 1.0-relative scalar,
// a key ending in `Multipliers` is an object of them, a key ending in `Count` is additive. Add
// an event to `events.json`, pool it in a market, and it fires and publishes with no code
// change.
//
// WHAT THIS SYSTEM DOES NOT DO. It publishes effects; it does not consume them. Arrival rate
// (STORY-004), dish choice (STORY-010), station failure and repair (STORY-008), restock cost
// (STORY-005/007), reputation reward (STORY-013) and the HUD banner (STORY-015) all read
// `match.eventEffects`, whose every key is present with a neutral value at all times so a
// consumer never needs a defensive branch.

import {
  EVENT_MIN_GAP_MS,
  EVENT_MAX_GAP_MS,
  EVENT_TAIL_MARGIN_MS,
  EVENT_MAX_CONCURRENT_HIGH_IMPACT,
  EVENT_HIGH_IMPACT_THRESHOLD,
  EVENT_ENDED_VISIBLE_MS,
} from '../../../../shared/constants/tuning.js';
import { catalogue } from '../catalogue.js';

/** The RNG sub-stream name. Decision 18: named, so another system's draws cannot shift ours. */
export const EVENT_RNG_STREAM = 'events';

// ============================================================================================
// The effect vocabulary, derived from the data rather than declared here
// ============================================================================================

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The neutral value of every effect key ANY event in `events.json` uses, discovered by reading
 * the catalogue. This is what makes "read the effects unconditionally" true: a consumer asking
 * for `patienceMultiplier` gets 1.0 when no event is active, even though only two events in the
 * whole catalogue mention patience, and it keeps working when a designer adds a key.
 *
 * The suffix convention is repo convention (conventions.md "Naming"), not per-event knowledge:
 *   `…Multiplier`   a 1.0-relative scalar        -> neutral 1, combined by multiplication
 *   `…Multipliers`  an object of those, by key   -> neutral {}, combined per key
 *   `…Count`        an additive count            -> neutral 0, combined by addition
 * Anything else is an explicitly-handled structural key (see `resolveEffects`).
 */
const STRUCTURAL_KEYS = Object.freeze(['segmentWeightOverrides', 'specialPartySpawn']);

function deriveNeutralShape(events) {
  const scalars = new Set();
  const maps = new Set();
  const counts = new Set();
  for (const event of events) {
    for (const [key, value] of Object.entries(event.effects ?? {})) {
      if (STRUCTURAL_KEYS.includes(key)) continue;
      if (key.endsWith('Multipliers') && isPlainObject(value)) maps.add(key);
      else if (key.endsWith('Multiplier') && Number.isFinite(value)) scalars.add(key);
      else if (key.endsWith('Count') && Number.isFinite(value)) counts.add(key);
    }
  }
  return {
    scalars: Object.freeze([...scalars].sort()),
    maps: Object.freeze([...maps].sort()),
    counts: Object.freeze([...counts].sort()),
  };
}

const SHAPE = deriveNeutralShape(catalogue.events);

/** The keys `match.eventEffects` always carries. Exported so the check script can assert it. */
export const EVENT_EFFECT_KEYS = Object.freeze({
  scalars: SHAPE.scalars,
  maps: SHAPE.maps,
  counts: SHAPE.counts,
});

/**
 * A fresh, fully-neutral effects object. `segmentWeights` is the market's own distribution
 * when no event overrides it, so a consumer never has to know whether to fall back.
 */
export function neutralEventEffects(market = null) {
  const fx = {
    activeEventIds: [],
    segmentWeightOverrides: {},
    segmentWeights: market ? { ...market.segmentWeights } : null,
    specialPartySpawns: [],
  };
  for (const key of SHAPE.scalars) fx[key] = 1;
  for (const key of SHAPE.maps) fx[key] = {};
  for (const key of SHAPE.counts) fx[key] = 0;
  return fx;
}

// ============================================================================================
// Impact classification — PRD §9 "Do not stack more than two high-impact events at once"
// ============================================================================================

/**
 * How far an event moves the DISTRICT's demand, as the largest absolute deviation from neutral
 * across the §16 keys that describe demand: `footTrafficMultiplier`, `partySizeMultiplier` and
 * `dishTagDemandMultipliers`.
 *
 * Deliberately NOT every multiplier the event carries. §9's stacking rule is about two demand
 * shocks landing on top of each other; a slow restock or a slow grill is an operational
 * problem, not a demand shock, and counting those classifies nine of the ten MVP events as
 * high-impact — which leaves `stadium_district`'s four-card pool with nothing the cap can ever
 * admit, and makes the cap and the 30-60s cadence mutually unsatisfiable. Scoring the three
 * demand keys leaves every market pool at least one admissible card, which
 * `scripts/check-events.mjs` asserts directly.
 *
 * `segmentWeightOverrides` is also excluded: it redistributes a fixed total rather than
 * changing it, and its magnitude is only meaningful relative to a particular market, so it
 * cannot be scored on the event alone.
 */
export function eventImpactScore(effects) {
  let score = 0;
  const consider = (value) => {
    if (Number.isFinite(value)) score = Math.max(score, Math.abs(value - 1));
  };
  consider(effects?.footTrafficMultiplier);
  consider(effects?.partySizeMultiplier);
  for (const value of Object.values(effects?.dishTagDemandMultipliers ?? {})) consider(value);
  return score;
}

export function isHighImpact(event) {
  return eventImpactScore(event?.effects) >= EVENT_HIGH_IMPACT_THRESHOLD;
}

/** Largest number of the given [start, end) intervals overlapping at any instant. */
function maxConcurrency(intervals) {
  const points = [];
  for (const { start, end } of intervals) {
    points.push({ at: start, delta: 1 });
    points.push({ at: end, delta: -1 });
  }
  // Ends sort before starts at the same instant: an event ending exactly as another begins is
  // a hand-off, not an overlap.
  points.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = 0;
  let peak = 0;
  for (const { delta } of points) {
    current += delta;
    if (current > peak) peak = current;
  }
  return peak;
}

// ============================================================================================
// The deck
// ============================================================================================

/** Fisher-Yates, drawing from `rng`. Deterministic for a given stream position. */
function shuffled(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Build the match's event timeline.
 *
 * Times are SERVICE-RELATIVE — offsets from the first millisecond of the service phase — not
 * absolute match times, and that is forced rather than stylistic: the setup phase ends either
 * on its deadline OR as soon as both players ready (PRD §12 step 7), so the absolute clock
 * coordinate of the service phase is not knowable when the timeline is built. Offsets are
 * knowable at match construction, which is what lets the §7 setup forecast exist at all. The
 * loop anchors them at the `service` transition.
 *
 * @param {object}   args
 * @param {() => number} args.rng      `match.createRngStream('events')`
 * @param {object}   args.market       the active market — its `eventPool` is the draw pile
 * @param {number}   args.windowMs     service + final_rush; the restaurant is open for both
 * @param {object}   [args.eventsById] override for tests; defaults to the catalogue
 */
export function buildEventTimeline({ rng, market, windowMs, eventsById = catalogue.eventsById }) {
  const pool = (market?.eventPool ?? []).map((id) => {
    const event = eventsById[id];
    if (!event) throw new Error(`event pool of market "${market?.id}" names unknown event "${id}"`);
    return event;
  });

  const entries = [];
  if (pool.length === 0 || !(windowMs > 0)) return { windowMs, entries: [] };

  let bag = shuffled(pool, rng);
  let lastScheduledId = null;

  const refill = () => {
    const next = shuffled(pool, rng);
    // A card cannot immediately repeat itself across a reshuffle. The same event twice in a
    // row reads as a bug to a player even when it is honestly drawn.
    if (pool.length > 1 && lastScheduledId !== null && next[0].id === lastScheduledId) {
      next.push(next.shift());
    }
    return next;
  };

  /**
   * Take the first card the cap will admit, leaving rejected cards at the front of the bag so
   * they are offered again at the next slot. A rejected card is SWAPPED PAST, never used to
   * skip the slot: skipping would push the realized gap to 60-120s and break the §9 cadence,
   * so the two rules would contradict each other. If a whole reshuffled deck fits nowhere the
   * data is unschedulable and we say so loudly, in the same spirit as `CatalogueError`.
   */
  const draw = (admits) => {
    if (bag.length === 0) bag = refill();
    let index = bag.findIndex(admits);
    if (index === -1) {
      bag = refill();
      index = bag.findIndex(admits);
      if (index === -1) return null;
    }
    return bag.splice(index, 1)[0];
  };

  const highImpactIntervals = [];
  let atMs = 0;

  // Bounded by the shortest legal gap: the loop cannot outlive the window.
  const maxSlots = Math.ceil(windowMs / EVENT_MIN_GAP_MS) + 1;
  for (let slot = 0; slot < maxSlots; slot += 1) {
    const gapMs = Math.round(EVENT_MIN_GAP_MS + rng() * (EVENT_MAX_GAP_MS - EVENT_MIN_GAP_MS));
    atMs += gapMs;
    if (atMs + EVENT_TAIL_MARGIN_MS > windowMs) break;

    const card = draw((event) => {
      if (!isHighImpact(event)) return true;
      const candidate = { start: atMs, end: atMs + event.durationMs };
      return (
        maxConcurrency([...highImpactIntervals, candidate]) <= EVENT_MAX_CONCURRENT_HIGH_IMPACT
      );
    });

    if (card === null) {
      throw new Error(
        `event deck: market "${market.id}" has no card that can activate at ${atMs}ms without ` +
          `stacking more than ${EVENT_MAX_CONCURRENT_HIGH_IMPACT} high-impact events ` +
          `(pool: ${pool.map((e) => e.id).join(', ')}). Pool at least one low-impact event.`,
      );
    }

    const warningMs = Math.min(card.warningMs, atMs); // a teaser cannot precede service
    entries.push({
      index: entries.length,
      eventId: card.id,
      announceAtMs: atMs - warningMs,
      activateAtMs: atMs,
      endAtMs: atMs + card.durationMs,
      warningMs,
      durationMs: card.durationMs,
      highImpact: isHighImpact(card),
    });
    if (isHighImpact(card)) highImpactIntervals.push({ start: atMs, end: atMs + card.durationMs });
    lastScheduledId = card.id;
  }

  return { windowMs, entries };
}

/**
 * PRD §7 "Initial event forecast, if any", built from the timeline.
 *
 * Deliberately ORDERED BY EVENT ID, not by firing time, and carrying no offset of any kind.
 * §9 lists "event forecasting in setup" as a reason to seed the deck, so the player is meant
 * to plan for what the district can throw at them — but handing over the schedule turns setup
 * into a lookup. What a player gets is: which events, how long each lasts, how many times,
 * and the plain-language description. When they come is what service is for.
 */
export function buildEventForecast(timeline, eventsById = catalogue.eventsById) {
  const counts = new Map();
  for (const entry of timeline.entries) {
    counts.set(entry.eventId, (counts.get(entry.eventId) ?? 0) + 1);
  }
  return [...counts.keys()]
    .sort()
    .map((eventId) => {
      const event = eventsById[eventId];
      return {
        eventId,
        title: event.title,
        description: event.description,
        durationMs: event.durationMs,
        occurrences: counts.get(eventId),
        telegraphed: event.warningMs > 0,
      };
    });
}

// ============================================================================================
// Effect resolution
// ============================================================================================

/**
 * Decision 12: an override REPLACES the market's weight for the named segment while the event
 * is active, and the remaining weight is redistributed proportionally across the segments not
 * named — which is why overrides need not sum to anything themselves. The result is normalised
 * so it stays the probability distribution `loader.js` requires a market's weights to be.
 */
export function applySegmentWeightOverrides(baseWeights, overrides) {
  const out = { ...baseWeights };
  const named = Object.keys(overrides);
  if (named.length === 0) return out;

  let overrideSum = 0;
  for (const segmentId of named) {
    out[segmentId] = Math.max(0, overrides[segmentId]);
    overrideSum += out[segmentId];
  }

  const others = Object.keys(out).filter((id) => !named.includes(id));
  const otherBase = others.reduce((sum, id) => sum + (baseWeights[id] ?? 0), 0);
  const remaining = Math.max(0, 1 - overrideSum);
  const scale = otherBase > 0 ? remaining / otherBase : 0;
  for (const id of others) out[id] = (baseWeights[id] ?? 0) * scale;

  // Overrides summing past 1.0 leave nothing to redistribute; renormalise rather than emit a
  // distribution that does not sum to one.
  const total = Object.values(out).reduce((sum, w) => sum + w, 0);
  if (total > 0 && Math.abs(total - 1) > 1e-9) {
    for (const id of Object.keys(out)) out[id] /= total;
  }
  return out;
}

/**
 * Combine the effects of every currently-active event into one object carrying every key.
 * `activeEvents` must be in activation order; where two active events override the same
 * segment weight, the later activation wins, which is the same "most recent news" rule a
 * player would apply.
 */
export function resolveEffects(market, activeEvents) {
  const fx = neutralEventEffects(market);
  const overrides = {};

  for (const event of activeEvents) {
    fx.activeEventIds.push(event.id);
    for (const [key, value] of Object.entries(event.effects ?? {})) {
      if (key === 'segmentWeightOverrides') {
        for (const [segmentId, weight] of Object.entries(value ?? {})) overrides[segmentId] = weight;
      } else if (key === 'specialPartySpawn') {
        if (isPlainObject(value)) fx.specialPartySpawns.push({ eventId: event.id, ...value });
      } else if (key.endsWith('Multipliers') && isPlainObject(value)) {
        const map = (fx[key] ??= {});
        for (const [inner, m] of Object.entries(value)) {
          if (Number.isFinite(m)) map[inner] = (map[inner] ?? 1) * m;
        }
      } else if (key.endsWith('Multiplier') && Number.isFinite(value)) {
        fx[key] = (fx[key] ?? 1) * value;
      } else if (key.endsWith('Count') && Number.isFinite(value)) {
        fx[key] = (fx[key] ?? 0) + value;
      }
    }
  }

  fx.segmentWeightOverrides = overrides;
  fx.segmentWeights = applySegmentWeightOverrides(market?.segmentWeights ?? {}, overrides);
  return fx;
}

/**
 * The demand multiplier the active events place on one dish, from its tags. THE §24 knob:
 * "roughly 15-40% for strong event-dish affinity, not 2-5%".
 *
 * Combination rule: the STRONGEST amplifying tag times the STRONGEST dampening tag — not the
 * product of every matching tag. The product is the obvious reading of "multipliers" and it is
 * wrong at this magnitude: the MVP catalogue's cheesecake is tagged dessert, premium and
 * date-night, and the pre-theater event names all three, so the product is 1.35 x 1.25 x 1.2 =
 * 2.03 — a 102% demand shift, two and a half times outside the band the PRD asks for.
 * `scripts/check-events.mjs` measures exactly that comparison. Under the strongest-tag rule the
 * measured shift for any dish is exactly the strongest value the designer authored, so §24's
 * band is enforced by `events.json` alone and is checkable by reading it. The design claim
 * underneath: an event says how much the district wants that KIND of food, and a dish that fits
 * an event three ways is not two-and-a-half times more wanted than one that fits it once — it
 * is wanted as much as its best fit.
 */
export function dishDemandMultiplier(effects, tags) {
  const byTag = effects?.dishTagDemandMultipliers ?? {};
  let strongestAmplifier = 1;
  let strongestDampener = 1;
  for (const tag of tags ?? []) {
    const m = byTag[tag];
    if (!Number.isFinite(m)) continue;
    if (m > strongestAmplifier) strongestAmplifier = m;
    if (m < strongestDampener) strongestDampener = m;
  }
  return strongestAmplifier * strongestDampener;
}

// ============================================================================================
// The system
// ============================================================================================

/** PRD §12 server-to-client example 2, field for field. */
function announceMessage(event, startsInMs) {
  return {
    type: 'event_announce',
    eventId: event.id,
    title: event.title,
    description: event.description,
    startsInMs: Math.max(0, Math.round(startsInMs)),
    durationMs: event.durationMs,
  };
}

/**
 * Build the timeline once, the first time anything asks for it. Called from `onPhaseChange`
 * (which fires for every system regardless of its `phases` filter, so `market_reveal` is a
 * legal place to do this) and defensively from `update`.
 */
function ensureTimeline(match) {
  if (match.eventTimeline) return match.eventTimeline;

  const windowMs = (match.durations.service ?? 0) + (match.durations.final_rush ?? 0);
  const timeline = buildEventTimeline({
    rng: match.createRngStream(EVENT_RNG_STREAM),
    market: match.market,
    windowMs,
  });
  timeline.anchorMs = null;
  timeline.announced = new Set();
  match.eventTimeline = timeline;
  match.eventForecast = buildEventForecast(timeline);
  return timeline;
}

/** The scheduled shape, with no runtime state — what "same seed, same timeline" is asserted on. */
export function timelineDigest(timeline) {
  return (timeline?.entries ?? []).map((e) => ({
    eventId: e.eventId,
    announceAtMs: e.announceAtMs,
    activateAtMs: e.activateAtMs,
    endAtMs: e.endAtMs,
    durationMs: e.durationMs,
    highImpact: e.highImpact,
  }));
}

export const eventSystem = {
  id: 'events',
  phases: ['service', 'final_rush'],

  onPhaseChange(match, { to, atMs }) {
    if (to === 'market_reveal' || to === 'setup') {
      // Early enough for PRD §7's setup forecast, and before anything can draw from the stream.
      ensureTimeline(match);
      match.eventEffects ??= neutralEventEffects(match.market);
      match.events ??= [];
    }
    if (to === 'service') {
      const timeline = ensureTimeline(match);
      // THE ANCHOR. Service-relative offsets become match-clock coordinates here, once, at the
      // exact millisecond the phase began (the deadline the clock carried forward, never "now").
      timeline.anchorMs = atMs;
      match.events = [];
      match.eventEffects = neutralEventEffects(match.market);
    }
    if (to === 'results') {
      // Nothing is announced after the doors shut, and a snapshot of the results screen must
      // not carry an event frozen mid-flight.
      match.events = [];
      match.eventEffects = neutralEventEffects(match.market);
    }
  },

  update(match) {
    const timeline = ensureTimeline(match);
    if (timeline.anchorMs === null) timeline.anchorMs = match.phaseStartedAtMs;

    const nowMs = match.elapsedMs - timeline.anchorMs;
    const visible = [];
    const active = [];

    for (const entry of timeline.entries) {
      const event = catalogue.eventsById[entry.eventId];

      if (!timeline.announced.has(entry.index) && nowMs >= entry.announceAtMs) {
        timeline.announced.add(entry.index);
        // PRD §9 steps 1 and 2 are one message: §12 defines exactly one event message, and its
        // `startsInMs` IS the countdown step 2 asks for. An event nothing telegraphs
        // (`warningMs: 0`) announces at activation with `startsInMs: 0`, which is precisely
        // what the envelope documents that value to mean.
        match.enqueue(announceMessage(event, entry.activateAtMs - nowMs));
      }

      if (nowMs >= entry.announceAtMs && nowMs < entry.activateAtMs) {
        visible.push({
          eventId: entry.eventId,
          state: 'warning',
          startsInMs: Math.round(entry.activateAtMs - nowMs),
        });
      } else if (nowMs >= entry.activateAtMs && nowMs < entry.endAtMs) {
        visible.push({
          eventId: entry.eventId,
          state: 'active',
          endsInMs: Math.round(entry.endAtMs - nowMs),
        });
        active.push(event);
      } else if (nowMs >= entry.endAtMs && nowMs < entry.endAtMs + EVENT_ENDED_VISIBLE_MS) {
        visible.push({ eventId: entry.eventId, state: 'ended' });
      }
    }

    // Republished EVERY tick, active or not. Edge-triggering this would leave a consumer
    // reading a stale multiplier through the gaps between events, and no check that samples
    // only inside an active window would ever notice.
    match.events = visible;
    match.eventEffects = resolveEffects(match.market, active);
  },
};
