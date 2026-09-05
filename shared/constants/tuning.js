// Single source of truth for cross-application constants.
//
// This file is plain JavaScript (with a sibling tuning.d.ts for TypeScript consumers)
// because the server is a vanilla Express JavaScript app per PRD §13 and must not be
// made to compile TypeScript. The client and harnesses import it through Vite, which
// picks up the .d.ts for types.

/**
 * The pinned Three.js version. PRD §13 "Three.js loading": Three.js is loaded from a
 * pinned CDN import map and is never bundled or added as an npm dependency. This constant
 * is the ONLY place the version is written; the import maps in client/index.html and
 * harnesses/index.html are verified against it by scripts/check-threejs-pin.mjs.
 */
export const THREE_VERSION = '0.180.0';
export const THREE_CDN_BASE = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;

/** Authoritative simulation tick rate, Hz. PRD §12 "Tick target": 10-20/sec. */
export const SIMULATION_TICK_HZ = 20;

/** Network state broadcast rate, Hz. PRD §12: 10/sec initially. */
export const BROADCAST_HZ = 10;

/**
 * Match phase durations in milliseconds. PRD §5 gives a full-length pacing target and a
 * shorter first-playable preset for fast balancing and multiplayer testing.
 *
 * A `null` duration means the phase has no deadline and ends on a condition instead — only
 * `lobby` is like that (it ends when every required player has connected and readied).
 *
 * `final_rush` is an ADDITIONAL phase after `service`, not a relabelled tail of it: PRD §5's
 * 10-minute breakdown lists "Main service: 6 minutes" and "Final rush: 1 minute" as separate
 * line items, and they have separate keys here.
 *
 * `smoke` is NOT a gameplay preset. It exists so the whole lifecycle can be driven end to end
 * over a real socket by scripts/smoke-phases.mjs in about eight seconds. Never run a real
 * match on it.
 */
export const PHASE_DURATIONS_MS = {
  full: {
    lobby: null, // variable — ends when both players ready
    market_reveal: 30_000,
    setup: 120_000,
    service: 300_000,
    final_rush: 60_000,
    results: 30_000,
  },
  prototype: {
    lobby: null,
    market_reveal: 15_000,
    setup: 45_000,
    service: 150_000,
    final_rush: 45_000,
    results: 20_000,
  },
  smoke: {
    lobby: null,
    market_reveal: 1_200,
    setup: 2_000,
    service: 2_000,
    final_rush: 1_200,
    results: 1_200,
  },
};

/** Every selectable preset name. `POST /api/rooms` accepts one of these and nothing else. */
export const PHASE_PRESETS = Object.freeze(Object.keys(PHASE_DURATIONS_MS));

/**
 * PRD §12 "Mode": the initial release is 1v1. A match seats this many players; a third
 * joiner is rejected with `match_full` rather than silently seated. A development match
 * created through `POST /api/dev/match` overrides this to 1 by default, or back to 2 (with a
 * bot seated in the second one — STORY-017) when the request passes `{"bot": true}`.
 */
export const PLAYERS_PER_MATCH = 2;

/** Restaurant floor bounds, in world units. The server clamps owner movement to these. */
export const RESTAURANT_BOUNDS = {
  minX: -9,
  maxX: 9,
  minZ: -12,
  maxZ: 12,
};

/** Owner movement. Sprint is server-enforced (PRD §8: limited by stamina or cooldown). */
export const OWNER_MOVE_SPEED = 4.2; // world units / second
export const OWNER_SPRINT_MULTIPLIER = 1.7;
export const OWNER_SPRINT_MAX_MS = 2_500;
export const OWNER_SPRINT_COOLDOWN_MS = 5_000;

/** Reconnect grace period. PRD §13 "Server responsibilities": handle reconnect grace. */
export const RECONNECT_GRACE_MS = 30_000;

/**
 * STORY-022 §24 "final score gap over time". How often `telemetry-system.js` samples the
 * revenue gap between the two restaurants — coarse on purpose (PRD §20 "logging is off the hot
 * path... must not perturb the 10-20 Hz simulation tick"), a running trend line, not a per-tick
 * one.
 */
export const TELEMETRY_SAMPLE_INTERVAL_MS = 5_000;

// --- events (STORY-011) -------------------------------------------------------------------
// PRD §9 "Dynamic events". Every number the seeded event deck uses lives here; `events.json`
// owns what an event DOES, this file owns when and how often one may happen.

/**
 * PRD §9 "Event cadence": "announced every 30-60 seconds during the service phase". These are
 * the bounds on the gap between one event's activation and the next, and the gap from the
 * start of service to the first activation.
 */
export const EVENT_MIN_GAP_MS = 30_000;
export const EVENT_MAX_GAP_MS = 60_000;

/**
 * An event scheduled this close to the end of the service window is not scheduled at all.
 * An event that activates two seconds before the doors shut is a notification, not a decision,
 * and PRD §9's first design rule is that an event must create an actionable decision.
 */
export const EVENT_TAIL_MARGIN_MS = 10_000;

/**
 * PRD §9 design rule: "Do not stack more than two high-impact events at once in MVP." The deck
 * builder enforces this while placing cards; it is not left to the cadence to make it unlikely.
 */
export const EVENT_MAX_CONCURRENT_HIGH_IMPACT = 2;

/**
 * How far an event's §16 district-level multipliers must move away from 1.0 for it to count as
 * "high impact". Measured as the largest absolute deviation from neutral across
 * `footTrafficMultiplier`, `partySizeMultiplier` and `dishTagDemandMultipliers` — the three
 * §16 keys that distort district DEMAND, which is what §9's stacking rule is about.
 */
export const EVENT_HIGH_IMPACT_THRESHOLD = 0.3;

/**
 * How long an event stays in `match_snapshot.events` with `state: 'ended'` after it finishes.
 * PRD §9 announcement flow step 5 is "event ends or transitions to the next event", and a
 * banner that vanishes on the same frame the effect stops never gets read.
 */
export const EVENT_ENDED_VISIBLE_MS = 5_000;

/**
 * PRD §9 announcement flow step 1: "a teaser or forecast appears 10-20 seconds before
 * activation when appropriate". `warningMs` of 0 in `events.json` means "not appropriate" —
 * nothing in the district telegraphs a power dip. Any NON-zero `warningMs` must fall in here.
 */
export const EVENT_TEASER_LEAD_BOUNDS_MS = Object.freeze({ min: 10_000, max: 20_000 });

/**
 * PRD §24: "Events should move demand materially enough that players notice: roughly 15-40%
 * for strong event-dish affinity, not 2-5%." Expressed as MULTIPLIER bounds rather than as
 * shifts on purpose: `1.15 - 1` is `0.14999999999999991` in IEEE-754, so a shift-based check
 * rejects an event authored at exactly the documented floor. Same class of trap as
 * `SEGMENT_WEIGHT_TOLERANCE` in `loader.js`; comparing the multipliers themselves is exact.
 */
export const EVENT_DEMAND_SHIFT_BAND = Object.freeze({ min: 1.15, max: 1.4 });
// ============================================================================================
// Customer lifecycle — PRD §6, §8, §17. STORY-004.
// ============================================================================================

/** The named RNG sub-stream (Decision 18) the customer system draws from. */
export const CUSTOMER_RNG_STREAM = 'customers';

/** Ms spent in each brief "deciding" state before its outcome resolves. Kept short but
 * non-zero so the state is actually observable in a sampled snapshot, not skipped in one tick. */
export const CUSTOMER_ENTER_DISTRICT_MS = 400;
export const CUSTOMER_EVALUATE_RESTAURANTS_MS = 600;

/** Seated but not yet ordering — greeted, handed a menu. */
export const CUSTOMER_SEATED_GREET_MS = 1_000;
/** Deciding on and placing an order. STORY-005 may replace this with real menu-browsing time. */
export const CUSTOMER_ORDERING_MS = 6_000;
/* CUSTOMER_FOOD_WAIT_MS_RANGE IS GONE (STORY-005). It was a synthetic kitchen wait standing in
 * until a kitchen existed. One does now: how long a party waits for food is the sum of its
 * dishes' `stationSteps` durations from dishes.json plus whatever those tickets spent queueing
 * behind other tickets, and it is not a tunable number any more. Nothing replaces it here. */
/** How long a party spends eating once food arrives. */
export const CUSTOMER_EATING_MS_RANGE = [8_000, 16_000];
export const CUSTOMER_PAYING_MS = 3_000;
/** Walking out, after which the party enters REVIEW (Decision 13: one step, not two). */
export const CUSTOMER_LEAVING_MS = 1_500;

/** How long an exited/reviewed party lingers in match_snapshot.customers before removal, so the
 * HUD (and this story's own checks) can observe the outcome rather than it vanishing same-tick. */
export const CUSTOMER_EXIT_LINGER_MS = 2_000;

/** Safety bound on spawns processed in one tick, in case a very large dtMs (a paused tab, a
 * fast-forwarding script) would otherwise let the Poisson catch-up loop run unbounded. */
export const CUSTOMER_MAX_SPAWNS_PER_TICK = 200;

/**
 * PRD §6 "Each customer or party receives a hidden preference profile" — per PARTY, not per
 * segment. Without jitter, a public `segmentId` plus the client's own `customer-segments.json`
 * import (Decision 10: the browser gets the same catalogue files) would let the client
 * reconstruct the exact hidden `budget`/`patienceSeconds` anyway. Applied only to the two
 * numeric fields that vary meaningfully per party; `preferredTags`/`dislikedTags` and the four
 * choice weights stay archetype-level until a story gives them a reason to vary individually.
 */
export const CUSTOMER_PROFILE_JITTER = 0.15; // +/- 15%

/* THE EVALUATE_RESTAURANTS PLACEHOLDER IS GONE (STORY-010).
 *
 * `CUSTOMER_RIVAL_PLACEHOLDER_PROBABILITY` was a flat 8% chance that "a rival existed and won",
 * standing in for a comparison there was nothing to make. There is a real district now: both
 * restaurants are scored from public observables and the party picks probabilistically between
 * them. `CUSTOMER_QUEUE_PRESSURE_LEAVE_THRESHOLD`/`_PROBABILITY` go with it — a party now
 * leaves the district when no restaurant's PROJECTED WAIT fits inside its own patience budget,
 * which is the same signal (§6 "Actual queue length") expressed against the party's own profile
 * instead of a flat coin flip against a district-wide ratio. Everything the replacement reads
 * lives in the DISTRICT block at the bottom of this file. */

/**
 * Share of a party's OWN `patienceSeconds` budget (Decision: satisfaction uses the party's own
 * profile, PRD §8's "against the party's own patience profile") charged against each wait
 * factor when scoring how good/bad that wait felt. Not the abandonment threshold — patience
 * hitting zero is what causes ABANDON_QUEUE/CANCEL_ORDER; this is a separate, continuous
 * satisfaction input.
 */
export const CUSTOMER_WAIT_TOLERANCE_SHARE = Object.freeze({
  seating: 0.4,
  ordering: 0.25,
  food: 0.5,
});

/** Total visit duration is judged against this multiple of the party's raw patience budget,
 * since a full visit (seating + ordering + food + eating + paying) naturally runs longer than
 * the wait-only patience allotment. */
export const CUSTOMER_VISIT_DURATION_TOLERANCE_MULTIPLIER = 2.5;

/**
 * PRD §8's satisfaction factor list. Every key is declared now so a later story widens an
 * existing weighted term instead of restructuring the formula — see the seam comment on
 * `computeSatisfactionFactors` in customer-system.js for which story supplies which factor.
 * `combineSatisfaction` renormalizes over only the factors that currently return a real (non-
 * null) value, so the sum below need not equal 1 today; it is written as if it did so the
 * relative emphasis is legible, and stays exactly this once every factor is wired up.
 */
export const CUSTOMER_SATISFACTION_WEIGHTS = Object.freeze({
  waitToBeSeated: 0.15,
  waitToOrder: 0.05,
  waitForFood: 0.2,
  dishQuality: 0.15,
  dishPreferenceMatch: 0.1,
  priceFairness: 0.1,
  orderAccuracy: 0.05,
  tableCleanliness: 0.05,
  eventRelevance: 0.05,
  recoveryActions: 0.05,
  visitDurationVsPatience: 0.05,
});

/** Below this 0-100 satisfaction score, a party storms out (LEAVE_ANGRY) instead of calmly
 * paying and reviewing. */
export const CUSTOMER_ANGRY_SATISFACTION_THRESHOLD = 35;

// ============================================================================================
// Setup phase — PRD §7. STORY-009.
// ============================================================================================

/**
 * Cash each player starts the match with. PRD §7 "Setup phase" lists "Starting cash" among
 * what the player receives, but the document names no figure anywhere — §10's upgrade table
 * is the only economy number it gives, and those cost $110-$275.
 *
 * 600 is chosen so the opening decision is a real trade-off rather than a formality: it buys
 * the most expensive MVP upgrade ($275) AND a working ingredient allocation, or a cheap
 * upgrade and a deep pantry, but not everything. Treat it as a balance dial, not a fact.
 */
export const STARTING_CASH = 600;

/**
 * PRD §7 "Pricing": "Players set a price for each selected menu item within a bounded range."
 * The range is derived per dish from its own `suggestedPrice` in dishes.json, so a $5 espresso
 * and a $34 steak get proportionate freedom rather than one shared dollar band.
 *
 * 0.6x-1.6x is wide enough that both a loss-leader and a gouge are expressible — the §7
 * guidance labels have something to warn about — and narrow enough that a $2 steak or a $60
 * espresso is simply not on the table. `shared/schemas/setup-rules.js` rounds the derived
 * bounds to whole cents so the client's slider and the server's validator agree exactly.
 */
export const MENU_PRICE_BOUNDS = Object.freeze({ minMultiplier: 0.6, maxMultiplier: 1.6 });

/**
 * Thresholds behind the six PRD §7 qualitative labels. THESE NUMBERS ARE NEVER DISPLAYED:
 * §7 is explicit that the UI shows guidance, not "exact customer utility math", and
 * `priceGuidance()` in setup-rules.js returns label strings only — it has no numeric field
 * for a UI to leak.
 *
 * The value axis compares a price to the dish's suggested price, with the deviation scaled by
 * the market's `priceSensitivity` — so the suggested price always reads "Competitive", and it
 * is the market that decides how far above it becomes "Likely too expensive for this market".
 * The margin axis is the per-plate gross margin, (price - baseCost) / price.
 */
export const PRICE_GUIDANCE_THRESHOLDS = Object.freeze({
  excellentValueBelow: 0.9,
  competitiveBelow: 1.12,
  premiumBelow: 1.45,
  lowMarginBelow: 0.5,
  strongMarginAbove: 0.75,
});

/**
 * Ceiling on units of any ONE ingredient in the starting allocation. Cash is the real
 * constraint (PRD §7 item 3, and the validator's `inventory_over_budget` rule); this only
 * stops a submission that dumps the entire budget into salt from being technically legal.
 *
 * STORY-006 owns the inventory MODEL — depletion, spoilage, restock. Until it lands, the
 * allocation is a priced bag of units: it is validated, stored on the submission, and read by
 * nobody. See the note at the top of server/src/game/validators/setup-validator.js.
 */
export const STARTING_INVENTORY_MAX_UNITS_PER_INGREDIENT = 80;

/**
 * Thresholds behind the PRD §7 setup briefing's "Broad spending and patience indicators".
 * BROAD is the operative word: the briefing tells the player that a segment spends
 * "Comfortably" and waits "Patiently", never that its budget is 55 and its patience is 90
 * seconds. Same rule as the price guidance — the player gets a read on the market, not the
 * simulation's parameters. `shared/schemas/setup-rules.js` maps a segment onto these and
 * returns a label; the numbers stay here.
 */
export const BRIEFING_INDICATOR_THRESHOLDS = Object.freeze({
  spendModestBelow: 20,
  spendModerateBelow: 28,
  spendComfortableBelow: 45,
  patienceHurriedBelow: 60,
  patienceAverageBelow: 82,
});

// ============================================================================================
// Order system and kitchen production — PRD §17 "Order system" / "Order quality". STORY-005.
// ============================================================================================
//
// Everything here is a WHEN/HOW-MUCH dial. WHAT a dish costs to make — which stations it
// routes through and how long each step takes — lives in `shared/game-data/dishes.json`
// (`stationSteps[].station`, `stationSteps[].durationMs`) and is never duplicated here.

/** The named RNG sub-stream (Decision 18) the order system draws from. */
export const ORDER_RNG_STREAM = 'orders';

/**
 * How many tickets one station may work AT THE SAME TIME. This is the kitchen's throughput
 * ceiling and therefore the bottleneck PRD §8 "Operational bottlenecks" is about: a ticket
 * whose station is full waits in that station's queue instead of being worked.
 *
 * MEASURED, not guessed. `scripts/check-orders.mjs` prints per-station utilisation and peak
 * queue depth on its §24 balance run, over nine seeds and all three markets. At these values a
 * full service measures prep 22-46% busy, grill 22-80%, oven 6-47% and plating 19-28%, and
 * every market lands inside §24's "40-90 parties per restaurant".
 *
 * WHY prep IS 3 AND THE REST ARE 2, measured rather than argued: every dish in the catalogue
 * routes through prep, so prep and grill compound. Dropping prep to 2 pushes `stadium_district`
 * to 37-39 parties served with its busiest station near 70% — under the §24 band, for a
 * KITCHEN reason. At 3 the same seeds land 41-43. Raising any station to 4 moves parties served
 * by less than one across the whole seed set and only flattens the queues.
 *
 * Grill stays at 2 deliberately. It is the station that visibly backs up in `stadium_district`,
 * where fans order burgers — that queue is the bottleneck the player is meant to feel and
 * answer (a different menu, or the Faster Grill upgrade), and widening it removes the pressure
 * this whole system exists to create.
 *
 * The map is PER STATION rather than one scalar because PRD §10's upgrade table turns exactly
 * this dial per station — "Prep throughput / Prep Counter / Increases concurrent prep
 * capacity". A station named in a layout but absent here falls back to
 * STATION_DEFAULT_CONCURRENCY.
 */
export const STATION_CONCURRENCY = Object.freeze({
  prep: 3,
  grill: 2,
  oven: 2,
  plating: 2,
});
export const STATION_DEFAULT_CONCURRENCY = 1;

/**
 * PRD §17 order step 2, "Generates an order based on segment preferences, menu availability,
 * price, and event context". One main per guest; an add-on is a per-guest coin flip at this
 * probability, so a two-add-on menu shows up in the kitchen without doubling its load.
 */
export const ORDER_ADDON_PROBABILITY = 0.35;

/** Dish-choice weighting. A preferred tag multiplies the dish's weight up by this much per
 * matching tag; a disliked tag multiplies it down by this factor per matching tag. */
export const ORDER_PREFERRED_TAG_BONUS = 0.6;
export const ORDER_DISLIKED_TAG_PENALTY = 0.45;

/**
 * How sharply price suppresses a dish's chance of being ordered. Applied to the same
 * market-scaled value axis `priceGuidance()` uses in setup-rules.js — a dish at its suggested
 * price is neutral, and the market's `priceSensitivity` decides how much a mark-up hurts.
 */
export const ORDER_PRICE_ELASTICITY = 1.5;

/** A dish priced above the party's own hidden per-guest budget keeps only this share of its
 * weight — heavily discouraged, never impossible, so a party is never left unable to order. */
export const ORDER_OVER_BUDGET_WEIGHT = 0.05;

/**
 * The abstracted hand-off at the service pass: how long a completed order sits before it
 * reaches the table. STORY-007 (worker AI) and STORY-008 (the owner carrying plates) replace
 * this constant with a real runner who has to walk; until then it is the one place the
 * kitchen admits that nobody is actually carrying the plate.
 */
export const ORDER_PASS_HANDOFF_MS = 1_500;

/**
 * PRD §17 order quality, "Freshness: time since completion". A plated dish holds full marks
 * for the grace period, then decays linearly to the floor across the rest of the window. The
 * clock starts when THAT dish finished plating, so an order whose steak is still on the grill
 * is already losing marks on the espresso that finished first.
 */
export const ORDER_FRESHNESS_GRACE_MS = 4_000;
export const ORDER_FRESHNESS_WINDOW_MS = 30_000;
export const ORDER_FRESHNESS_FLOOR = 0.2;

/**
 * PRD §17 "Order quality should be a combination of". Only the factors the MVP can honestly
 * compute are weighted: "Preparation quality" and "Ingredient quality or upgrades" are named
 * in §17 as later versions and are deliberately absent rather than stubbed at 1.0.
 */
export const ORDER_QUALITY_WEIGHTS = Object.freeze({
  correctness: 0.3,
  freshness: 0.3,
  preferenceFit: 0.2,
  serviceTiming: 0.2,
});

/** How far one matching preferred/disliked tag moves a dish's preference fit off neutral. */
export const ORDER_PREFERENCE_TAG_STEP = 0.25;

/** How steeply price fairness falls away above a dish's market-scaled suggested price. */
export const ORDER_PRICE_FAIRNESS_SLOPE = 1.5;

/** How long a delivered or cancelled order stays in `match_snapshot.orders` before removal,
 * so the HUD can show the outcome instead of the ticket vanishing on the same frame. */
export const ORDER_SNAPSHOT_LINGER_MS = 2_000;

// ============================================================================================
// Shared district and restaurant choice — PRD §4.2, §6, §17, §23. STORY-010.
// ============================================================================================
//
// Both restaurants draw from ONE customer population (§22 acceptance criterion). A party that
// enters the district scores every restaurant from public, observable properties, weights those
// scores with its OWN §6 profile weights, and then picks PROBABILISTICALLY. Every number that
// decides how sharp that pick is, or how far reputation may run, is here.

/** The named RNG sub-stream (Decision 18) the district choice draws from. Separate from
 * `CUSTOMER_RNG_STREAM` so that changing how a choice is made does not shift the ARRIVAL
 * sequence a seed produces — the two properties stay independently reproducible. */
export const DISTRICT_RNG_STREAM = 'district_choice';

/**
 * THE ANTI-SNOWBALL DIAL (PRD §23 "Early snowballing", §6 "Important design rule").
 *
 * Choice is a softmax over utilities in [0,1]: `p_i ∝ exp(u_i / T)`. T is the temperature, and
 * it alone decides how much a score edge is worth:
 *
 *     edge 0.02  ->  55/45      edge 0.05  ->  60/40
 *     edge 0.10  ->  70/30      edge 0.20  ->  84/16
 *
 * MEASURED, not guessed: `scripts/check-district-choice.mjs` reports the realised split for a
 * deliberately small score edge over many seeds and asserts it lands in a BAND — a lower T
 * (argmax-like) and a higher T (coin-flip) both fail it. 0.12 is the value that makes a
 * modestly better restaurant clearly preferred without ever sweeping the district.
 */
export const DISTRICT_CHOICE_TEMPERATURE = 0.12;

/**
 * The utility of walking away, scored on the same [0,1] axis as a restaurant, so LEAVE_DISTRICT
 * competes in the same softmax rather than being a separate coin flip. A restaurant that scores
 * below this is worse than nothing and mostly loses the party to the street; one that scores
 * above it mostly keeps them. PRD §24: "A badly priced menu should reduce customer conversion,
 * but should not make the restaurant completely empty" — a softmax term is never zero, so it
 * cannot.
 */
export const DISTRICT_LEAVE_UTILITY = 0.6;

/**
 * Weight given to event affinity, ADDED to the party's own four §6 weights (which sum to 1) and
 * renormalised. It is not one of the four because §6's profile does not contain it: the party's
 * appetite for what an event is pushing is a district condition, not a personality trait.
 */
export const DISTRICT_EVENT_AFFINITY_WEIGHT = 0.15;

/** How far a single component's WEIGHTED contribution must beat the rival's before the choice
 * is allowed to claim a §17 reason. Below it the two restaurants were effectively tied on
 * everything and `decisionReason` stays null — the same honesty the placeholder had. Fabricated
 * reasons would poison STORY-014's results screen, which is built entirely on this field. */
export const DISTRICT_REASON_EPSILON = 0.02;

// --- projected wait, PRD §6 "Actual queue length" / "Actual service speed" -------------------
//
// What a customer standing in the street can actually estimate: how many parties are already in
// the line, whether a table is free, and how backed up the kitchen looks. The kitchen half is
// read through `match.kitchen.queueDepth()` — the same number `match_snapshot.orders` derives —
// never from the order system's internals.

/**
 * How long one occupied table takes to come free again — one TABLE TURN. This is what a party
 * facing a full dining room is actually waiting for, and it is derived from this file's own
 * state durations rather than picked: greet 1s + ordering 6s + a kitchen wait in the 15-25s
 * range for a typical order + eating 8-16s + paying 3s + leaving 1.5s. A party sees a queue of
 * five in front of six tables and reads it as one turn; a party of four sees the same queue in
 * front of the THREE tables big enough for it and reads it as two.
 */
export const DISTRICT_TABLE_TURN_MS = 45_000;
/** Ms of wait attributed to each ticket already queued at a kitchen station. Roughly one
 * station step (dishes.json steps run 4-12s), because a queued ticket is one step of somebody
 * else's food between this party and its own. */
export const DISTRICT_BACKLOG_WAIT_PER_TICKET_MS = 6_000;
/** A projected wait at or above this multiple of the party's own patience budget scores 0 on
 * the speed axis; 0ms scores 1. Above 1.0 the restaurant is not a candidate at all — that is
 * the "queue exceeds the party's tolerance" gate, and it reports `restaurant_full`. */
export const DISTRICT_WAIT_INTOLERABLE_MULTIPLE = 1.0;

// --- price and menu fit, scored from the LOCKED menu ------------------------------------------

/**
 * How steeply the market-scaled deviation from a dish's `suggestedPrice` moves its perceived
 * value, and what that value is AT the suggested price. Applied to the same value axis
 * `priceGuidance()` uses in setup-rules.js, so "Excellent value" in the setup UI and a high
 * price score in the district are the same judgement.
 *
 * `DISTRICT_PRICE_NEUTRAL_VALUE` is below 1 on purpose, and the check script is what found it:
 * with the neutral point at 1.0 the axis is SATURATED at the suggested price, so undercutting
 * buys a player exactly nothing — which contradicts §11 ("A low price improves conversion with
 * price-sensitive diners") and leaves half the pricing decision invisible to demand. Leaving
 * headroom above neutral makes a discount a real, measurable lever in both directions.
 */
export const DISTRICT_PRICE_VALUE_SLOPE = 1.2;
export const DISTRICT_PRICE_NEUTRAL_VALUE = 0.75;
/** How far one matching preferred/disliked tag moves a dish's fit off neutral (0.5). */
export const DISTRICT_MENU_FIT_TAG_STEP = 0.25;

// --- reputation, PRD §4.2 "compound ... but not so strongly that the match becomes unwinnable"
//
// THE CAP IS THE POINT. Reputation is an exponential moving average of the satisfaction of the
// parties a restaurant actually served, so it compounds across a match — a run of happy guests
// lifts it, a run of walkouts drops it — but it is clamped into a band, so the most a perfect
// match can ever buy is `DISTRICT_REPUTATION_MAX`. Combined with the softmax, a restaurant at
// the ceiling facing one at the floor still loses a meaningful share of parties, which is the
// §23 mitigation "cap runaway advantages" stated as a number rather than a hope.

export const DISTRICT_REPUTATION_START = 60;
export const DISTRICT_REPUTATION_MIN = 25;
export const DISTRICT_REPUTATION_MAX = 90;
/**
 * Share of the gap between current reputation and the latest party's satisfaction taken by each
 * review. MEASURED against §4.2's "not so strongly that the match becomes unwinnable early":
 * at 0.08 a flawless opening two minutes (fifteen guests) took a restaurant from 60 to 89 —
 * essentially the whole band — and left the rival drawing under 30% of the district before the
 * match was a quarter old. At 0.03 the same fifteen guests reach the mid-70s and the full band
 * takes most of a match to cross, so reputation is an asset a player BUILDS rather than an
 * opening they cannot be caught from. `scripts/check-district-choice.mjs` asserts the
 * consequence, not the constant.
 */
export const DISTRICT_REPUTATION_REVIEW_WEIGHT = 0.03;
/** A party that gave up before being served leaves no review, but the queue it walked out of
 * was visible. Scored as a small fixed knock against the same band — one point, for the same
 * reason the review weight is small. */
export const DISTRICT_REPUTATION_WALKOUT_PENALTY = 1;

// ============================================================================================
// Inventory, ingredient bins and restocking — PRD §7 item 3, §8 "Ingredient shortage", §10
// "Restocking". STORY-006.
// ============================================================================================
//
// Two levels of stock, because PRD §8's bottleneck is a DISTANCE problem, not an arithmetic one:
// the restaurant's PANTRY holds what the player bought in setup, and each kitchen STATION holds
// a small working BIN. Production consumes from the bin; a restock walks stock from the pantry
// to the bin and takes time. The §10 "Restocking" upgrade category ("Organized Pantry", "Pantry
// Shelves — restock travel time -25%") only makes sense against a model where that walk has a
// duration, and the §9 `ingredient_shortage` event ("one ingredient restocks more slowly") only
// makes sense against a model where a restock has a duration to multiply.
//
// WHAT IS NOT HERE: how much of each ingredient a dish needs, and what a unit costs. Both live
// in `shared/game-data/dishes.json` (`dishes[].ingredients`, `ingredients[].unitCost`) and are
// never duplicated here.

/** The named RNG sub-stream (Decision 18) the inventory model draws from. Used only to pick
 * which ingredient the §9 `ingredient_shortage` event hits — one draw per match, per shortage. */
export const INVENTORY_RNG_STREAM = 'inventory';

/**
 * How many units of ONE ingredient a station bin can hold. This is the working stock at the
 * counter, not the reserve: it is deliberately smaller than a service's total consumption, so
 * that the walk to the pantry is a recurring operational cost rather than a one-off at open.
 *
 * MEASURED, not guessed — `scripts/check-inventory.mjs` prints, over a full service, how much of
 * the kitchen's time is spent with at least one ticket blocked on an empty bin. At 24 units that
 * lands in the low single-digit percent for a well-stocked restaurant: shortage is a thing that
 * happens and is felt, not a thing that defines the match.
 */
export const INVENTORY_STATION_BIN_CAPACITY = 24;

/** A bin at or below this level triggers a refill. Set well above zero so a restock that takes
 * `INVENTORY_RESTOCK_TRAVEL_MS` has a chance to land before the bin actually empties. */
export const INVENTORY_RESTOCK_THRESHOLD_UNITS = 8;

/**
 * PRD §10 "Restocking / Organized Pantry / Faster owner or staff ingredient retrieval", and the
 * §10 example table's "Pantry Shelves $150 — restock travel time -25%". The walk to the storage
 * room and back, before any handling: this is the number `restockTravelTimeMultiplier` scales,
 * and it is the reason that upgrade is worth $150.
 */
export const INVENTORY_RESTOCK_TRAVEL_MS = 3_500;

/** Handling: pulling and carrying one unit. Added to the travel time, so a big top-up costs more
 * than a small one and a restock is never instantaneous even at the pantry door. */
export const INVENTORY_RESTOCK_MS_PER_UNIT = 150;

/**
 * How many restocks one restaurant can have in flight at once. ONE, because a restock is a pair
 * of hands walking to the back — PRD §7's prep worker "restocks ingredients", singular, and §8's
 * whole point is that the owner has to physically go. STORY-007 (worker restocking) and
 * STORY-008 (the owner's restock interaction) are what widen this: each of them adds a body, and
 * this number becomes how many bodies are carrying rather than a global throttle.
 */
export const INVENTORY_MAX_CONCURRENT_RESTOCKS = 1;

/**
 * THE ABSTRACTED RESTOCKER — STORY-006's stand-in for a body, RETIRED BY STORY-007 the way this
 * repo retires a stand-in: not with a global switch, but per restaurant, behind the facade the
 * worker system publishes.
 *
 * It was the same admission `ORDER_PASS_HANDOFF_MS` made about the plate runner: the JOB model
 * (a timed pantry -> bin move, at `pantryFacade.requestRestock()`) is real and permanent, but
 * until something had legs, something had to decide WHEN to walk or the kitchen simply stopped
 * after one bin. STORY-006's own PR named flipping or deleting this as STORY-007/008's cleanup,
 * and Decision 40 records it.
 *
 * The cook now does the walking (PRD §17 cook rule 4, "if no order exists, perform low-priority
 * prep/restock"), at the same `INVENTORY_RESTOCK_THRESHOLD_UNITS` the abstraction used, so the
 * balance movement STORY-007 reports is attributable to a body having to get there rather than
 * to a retuned trigger. `brigade.ownsRestocking()` is what stands the abstraction down, and it
 * answers per restaurant — the same shape as `ownsDelivery`, `ownsSeating` and `ownsPayment`,
 * which retired the plate-runner, greet and payment abstractions in the same change.
 *
 * The flag itself stays TRUE, and stays a flag, because a match with no worker system registered
 * must still restock: that is what `check-inventory.mjs` measures the stock model against, and a
 * dev harness or a future story that wants the model without a brigade gets it for free. Turning
 * it false stops the kitchen dead in exactly those cases and is not how the body was fitted.
 */
export const INVENTORY_AUTO_RESTOCK = true;

/**
 * PRD §7 item 3, "Starting inventory allocation". A player who submits no allocation still opens
 * with a kitchen: `defaultSubmission()` spends this share of the cash left after the opening
 * upgrade on a balanced, menu-derived pantry. It is deliberately not all of it — §7's default is
 * meant to be "a working restaurant, not a good one", and cash held back is a legal (if timid)
 * strategy a real player might also choose.
 */
export const STARTING_INVENTORY_DEFAULT_CASH_SHARE = 0.6;

/**
 * How many servings of each menu dish the default allocation aims to cover. The allocation is
 * scaled down proportionally when the cash share cannot buy this many, so an expensive menu gets
 * a shallower pantry rather than an illegal submission.
 */
export const STARTING_INVENTORY_DEFAULT_SERVINGS = 45;

// ============================================================================================
// Worker AI — PRD §7 "Staffing setup", §17 "Worker AI system", §24. STORY-007.
// ============================================================================================
//
// PRD §17 gives the cook and the server ORDERED priority lists and says the rules must be
// "simple, explainable". Nothing here is a weight in a scoring function: these are the speeds
// and the durations the rules cost, and the rules themselves are an ordered `if` chain in
// `server/src/game/systems/worker-system.js`. Adding a weight here would be the first step to
// replacing an explainable list with a heuristic that merely behaves like one.

/** The named RNG sub-stream (Decision 18) the worker system draws from. Used only for
 * `WORKER_TASK_JITTER` — the rules themselves are deterministic. */
export const WORKER_RNG_STREAM = 'workers';

/**
 * PRD §17: "The owner-player should outperform workers in speed/flexibility but should not make
 * workers irrelevant." THE differential, as one named number, and the constant STORY-008 reads
 * when it gives the owner the same actions.
 *
 * It covers BOTH halves of "speed": the owner walks this much faster (`WORKER_MOVE_SPEED` is
 * `OWNER_MOVE_SPEED` divided by it) and performs the same task in this much less time (an owner
 * action costs `WORKER_TASK_DURATIONS_MS[kind] / OWNER_TASK_SPEED_ADVANTAGE`). The owner's sprint
 * (`OWNER_SPRINT_MULTIPLIER`) sits on top of it, so a sprinting owner is ~2.5x a worker's pace
 * in bursts.
 *
 * FLEXIBILITY is structural, not a number: a worker is scoped to the post `staffAssignments`
 * gave it and follows one fixed §17 list, while the owner may act anywhere in the restaurant, in
 * any order, and can pre-empt themselves at will. That is deliberately not expressed here —
 * turning it into a multiplier would be exactly the "scoring heuristic" §17 rules out.
 *
 * 1.5 rather than something larger: at 2x or more a single owner out-produces both workers put
 * together and the automation stops mattering, which is the failure §17 names in the same breath.
 */
export const OWNER_TASK_SPEED_ADVANTAGE = 1.25;

/** Worker walking pace, world units/second. Derived from the owner's, never set independently:
 * the differential above is the thing being tuned, and two free numbers would let it drift. */
export const WORKER_MOVE_SPEED = OWNER_MOVE_SPEED / OWNER_TASK_SPEED_ADVANTAGE;

/** How close a worker must get to its destination to start working. Small enough that travel
 * across the room is real, large enough that a worker never jitters around a target. */
export const WORKER_ARRIVAL_EPSILON = 0.35;

/**
 * How long each §17 task takes ONCE THE WORKER IS THERE, before travel. Travel is not in these
 * numbers — it is integrated per tick from `WORKER_MOVE_SPEED` and the actual distance, which is
 * what makes "a server across the room is genuinely slower to deliver" true rather than asserted.
 *
 * `tend_station` is the cook loading one ticket onto its station: the STATION then cooks it for
 * the `stationSteps` duration from dishes.json, concurrently, exactly as before. The cook's cost
 * is the loading, not the cooking — see the worker system's header for why.
 *
 * A restock has no entry here on purpose: its duration is whatever `pantry.requestRestock()`
 * returns (STORY-006's `INVENTORY_RESTOCK_TRAVEL_MS` + per-unit handling), so there is exactly
 * one definition of what a pantry trip costs.
 */
/*
 * MEASURED, not guessed. These are the numbers §24's 60-75% band is actually tuned on.
 * `scripts/check-workers.mjs` prints, over nine seeded full matches with no player, the routine
 * work the brigade completed and the parties each restaurant served. The sweep, at multiples of
 * the base durations, so the next person does not repeat it:
 *
 *     x1.00   pooled 78.3%   front of house 72.2%   11-23 parties served
 *     x1.15   pooled 76.9%   front of house 70.1%   10-21
 *     x1.25   pooled 74.1%   front of house 66.9%   13-21   <- these numbers
 *     x1.40   pooled 73.8%   front of house 66.2%   11-20
 *
 * The share is bought almost entirely between x1.15 and x1.25 and then flattens: past that point
 * slower hands turn parties away as fast as they leave work undone, so the ratio stops moving and
 * only throughput falls. x1.25 is therefore the slowest setting that buys anything — it is inside
 * §24's band with the throughput cost of roughly one party per restaurant.
 */
export const WORKER_TASK_DURATIONS_MS = Object.freeze({
  seat_party: 750,
  take_order: 1_000,
  deliver_order: 875,
  clear_table: 1_250,
  collect_payment: 875,
  tend_station: 625,
});

/** Per-task variation, drawn from `WORKER_RNG_STREAM`. Workers are people, not clockwork; the
 * §17 rules stay deterministic and only how long a hand takes wobbles. Seed-derived, so a match
 * still replays exactly. Applied to the durations above and never to travel. */
export const WORKER_TASK_JITTER = 0.12;

/**
 * PRD §17 cook rule 1, "Continue current task if near completion", as a number: a cook whose
 * current task has this much or less of its work left is never pre-empted, however urgent the
 * ticket that just landed. Above it, a strictly more urgent ticket takes the hands.
 */
export const WORKER_TASK_NEAR_COMPLETION_FRACTION = 0.25;

/**
 * PRD §17 cook rules 2 and 3 are separate lines, so rule 2 must leave something for rule 3 to
 * decide. Rule 2 ranks queued tickets by how long they have waited at the station, in buckets
 * this wide; rule 3 then picks, among the equally-urgent tickets in the top bucket, the one whose
 * ORDER has the least patience left. Tickets queued within this window are "as urgent as each
 * other", which is what a person would say looking at the rail.
 */
export const WORKER_TICKET_URGENCY_BUCKET_MS = 2_000;

/**
 * A bin at or under this level is worth a pantry trip when the cook has nothing to cook (§17 cook
 * rule 4). Deliberately the SAME threshold STORY-006's abstracted restocker used, so flipping
 * `INVENTORY_AUTO_RESTOCK` off changed WHO walks and not WHEN — the balance movement reported in
 * STORY-007's PR is therefore attributable to the body, not to a retuned trigger.
 */
export const WORKER_RESTOCK_THRESHOLD_UNITS = INVENTORY_RESTOCK_THRESHOLD_UNITS;

// ============================================================================================
// STORY-008 — owner interaction. PRD §8 "Player avatar"/"Interactions", §4.1 (active ownership).
// ============================================================================================

/** How close the owner must stand to a target for `action-validator.js` to accept an
 * `interact` naming it. One number for every action: PRD §8's contextual prompt is "near a
 * valid object", not a per-object radius, and `upgrade_terminal`'s own `interactionRadius` in
 * `restaurant-layout.json` is the one deliberate exception (a terminal purchase is STORY-012's,
 * not read here). */
export const OWNER_INTERACT_RANGE = 2.2;

/**
 * The owner's per-action duration, derived from the worker's — never a second set of numbers,
 * for the same reason `WORKER_MOVE_SPEED` is derived rather than tuned: the differential is the
 * thing under test, and two free numbers would let it drift silently. See
 * `OWNER_TASK_SPEED_ADVANTAGE`'s comment, which names this exact formula.
 *
 * `pickup` and `drop_carry` have no worker equivalent — a worker server is never modeled as
 * carrying a plate, it delivers atomically — so those two get their own small base costs,
 * scaled by the same advantage for consistency.
 */
export const OWNER_ACTION_BASE_DURATIONS_MS = Object.freeze({
  pickup: 400,
  drop_carry: 200,
});

export const OWNER_TASK_DURATIONS_MS = Object.freeze({
  cook: Math.round(WORKER_TASK_DURATIONS_MS.tend_station / OWNER_TASK_SPEED_ADVANTAGE),
  plate: Math.round(WORKER_TASK_DURATIONS_MS.tend_station / OWNER_TASK_SPEED_ADVANTAGE),
  pickup: Math.round(OWNER_ACTION_BASE_DURATIONS_MS.pickup / OWNER_TASK_SPEED_ADVANTAGE),
  deliver: Math.round(WORKER_TASK_DURATIONS_MS.deliver_order / OWNER_TASK_SPEED_ADVANTAGE),
  drop_carry: Math.round(OWNER_ACTION_BASE_DURATIONS_MS.drop_carry / OWNER_TASK_SPEED_ADVANTAGE),
  restock: Math.round(WORKER_TASK_DURATIONS_MS.tend_station / OWNER_TASK_SPEED_ADVANTAGE),
  seat: Math.round(WORKER_TASK_DURATIONS_MS.seat_party / OWNER_TASK_SPEED_ADVANTAGE),
  clear_table: Math.round(WORKER_TASK_DURATIONS_MS.clear_table / OWNER_TASK_SPEED_ADVANTAGE),
  handle_complaint: Math.round(WORKER_TASK_DURATIONS_MS.collect_payment / OWNER_TASK_SPEED_ADVANTAGE),
});

/**
 * PRD §7 "one plate" baseline. A server-side property, not a client constant, so STORY-012's
 * Serving Tray upgrade can raise it to 2 then 3 by reading it off the match rather than the
 * client asserting its own capacity.
 */
export const OWNER_CARRY_CAPACITY = 1;

/**
 * PRD §8 "Unhappy customer" bottleneck: a party whose patience has fallen this far or further is
 * the red-meter state a "Handle complaint" prompt targets. Above this fraction, the wait is
 * normal impatience, not yet the state PRD §8 pairs with "Deliver, apologize, comp item".
 */
export const UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD = 0.35;

/**
 * The "comp item" a handled complaint buys: extra patience, expressed as a share of the party's
 * OWN total budget so a patient segment and an impatient one both get a proportionate reprieve
 * rather than the same flat number of seconds.
 */
export const OWNER_COMPLAINT_PATIENCE_RELIEF_FRAC = 0.3;

// --- STORY-013: scoring, penalties, tie-breakers ------------------------------------------------
//
// PRD §11 "Recommended score composition": Restaurant Score = Revenue Score + Guests Served
// Score + Satisfaction Score + Reputation Bonus + Event Objective Bonus − Penalty Score. The
// PRD gives WEIGHTS (40/20/25/10/5%) but not units — revenue is dollars, satisfaction and
// reputation are already 0-100-ish scales, guests served is a raw count. `SCORE_POINTS_SCALE`
// is the arbitrary total a perfect (fraction=1 on every component) restaurant scores before
// penalties, so every component is normalized to a [0,1] fraction against a REFERENCE value
// before its weight applies — the reference constants below are that normalization, not PRD
// text, and are named as an interpretation of "weight" as a points contribution rather than a
// literal percentage of an unbounded raw number.

/** The perfect-restaurant point total before any penalty is subtracted. Arbitrary but fixed —
 * only relative scores and the sign of a comparison ever matter, never this number alone. */
export const SCORE_POINTS_SCALE = 1000;

/** PRD §11's MVP weighting, verbatim. Sums to 1.0 — the point scale IS the 100%. */
export const SCORE_WEIGHT_NET_REVENUE = 0.4;
export const SCORE_WEIGHT_GUESTS_SERVED = 0.2;
export const SCORE_WEIGHT_SATISFACTION = 0.25;
export const SCORE_WEIGHT_REPUTATION = 0.1;
export const SCORE_WEIGHT_EVENT_OBJECTIVE = 0.05;

/** Net revenue (revenue minus ingredient and upgrade expenses) that earns a full 1.0 Revenue
 * Score fraction. Above this, the fraction clamps at 1.0 rather than rewarding degenerate
 * over-earning further — the whole point of a composite score per §11's own rationale. */
export const SCORE_NET_REVENUE_REFERENCE = 1200;

/** Guests served that earns a full 1.0 Guests Served Score fraction — the midpoint of §24's
 * "approximately 40-90 customer parties per restaurant" hypothesis. */
export const SCORE_GUESTS_SERVED_REFERENCE = 65;

/** §11 penalties, each a fixed point deduction per occurrence (or per dollar, for waste) —
 * data, not a hardcoded magnitude inside `scoring-system.js`. */
export const SCORE_PENALTY_ABANDONMENT_POINTS = 8;
export const SCORE_PENALTY_CANCELLED_ORDER_POINTS = 6;
export const SCORE_PENALTY_SEVERE_DISSATISFACTION_POINTS = 10;
export const SCORE_PENALTY_WASTE_POINTS_PER_DOLLAR = 0.05;
export const SCORE_PENALTY_CRITIC_FAILURE_POINTS = 50;

// --- STORY-014: results-screen narrative layer ---------------------------------------------------
//
// PRD §11 "Key turning points" and the results-screen narrative section. Everything here is
// derived RETROACTIVELY at the `results` transition from `match.districtDecisions` (the §17
// step-6 decision log, already recorded incrementally by customer-system.js) and
// `match.eventTimeline` (already anchored by event-system.js) — see
// `server/src/game/scoring/narrative.js`. No new per-tick sampler was added: `scoring-system.js`
// still owns no live simulation state (see that file's own header), it just reads more of what
// already exists once, at the end.

/** How many turning points the results screen shows, ranked by the size of the swing. Three
 * matches the AC's "key turning points" (plural, but a short list) without turning the results
 * screen into a full match transcript. */
export const RESULTS_TURNING_POINTS_MAX = 3;

// --- STORY-015: HUD critical-alert prioritization ------------------------------------------------
//
// PRD §18 "Alert prioritization": "Limit critical alerts to prevent alarm fatigue." These are
// UI-noise thresholds, not balance numbers — they decide when a real, already-published signal
// is worth a player's attention, not how the simulation behaves. Where an existing constant
// already means the same thing (a ready dish's freshness grace, the unhappy-customer patience
// line, the §7 event-teaser window), it is reused directly rather than duplicated under a new
// name, so the alert rule and the system it describes can never quietly disagree.
//
// `hud-bottleneck-system.js` is the ONE place these thresholds turn a raw count into a
// `BottleneckKind`; `shared/game-logic/hud-alerts.js` (client AND `scripts/check-hud.mjs`) never
// re-derives the same judgment from a lower-level number — it only asks "did the server already
// flag this restaurant?" and, if so, picks out WHICH entity earns the alert text.

/** More than this many `queued`, not-ingredient-blocked tickets sitting at this restaurant's
 * stations at once is a kitchen that cannot keep pace, not just momentary queuing — PRD §8's
 * `kitchen_backlog` row. A single queued ticket is normal service; this is the line past it. */
export const HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD = 3;

/** A queue this long at the door is PRD §8's `long_entry_queue` row — long enough that a
 * passerby would notice, not just the ordinary handful waiting for a table to turn. */
export const HUD_LONG_ENTRY_QUEUE_THRESHOLD = 4;

/** PRD §18 alert-priority item 5, "Event countdown": telegraphed by the same 10-20s window §7
 * gives the event teaser itself (`SnapshotEventEntry.startsInMs`, already published by
 * `event-system.js`) — an event more than this far out is still just the forecast, not yet
 * something to interrupt the player over. */
export const HUD_EVENT_COUNTDOWN_ALERT_MS = 20_000;

/** PRD §18 "Limit critical alerts to prevent alarm fatigue" (§23's workload-exhaustion risk).
 * The MAXIMUM number of critical alerts shown at once, across every priority band — lower-
 * priority alerts are suppressed once this many higher-priority ones are already showing, never
 * queued behind them. Four is enough to name the worst thing in each of the two most urgent
 * bands without turning the HUD into a second results screen. */
export const HUD_CRITICAL_ALERTS_MAX = 4;

/**
 * PRD §14 "Floating cash/tip feedback only for major moments, not every transaction". The
 * viewer's own `you.revenue` (this story) has to jump by at least this many dollars between one
 * snapshot and the next for the floating feedback to fire.
 *
 * MEASURED, not guessed (per Decision 8's "a balance claim carries a measured number"): an
 * organic six-seed, two-menu probe match (real customer arrivals, no forced fixtures) averaged
 * $52.27 revenue per SETTLED PARTY (`order.revenue` — a whole party's order, not one dish),
 * ranging $31-$83 across twelve restaurant-runs. A threshold anywhere near that average would
 * fire on most ordinary parties, exactly what "not every transaction" forbids. $100 sits clearly
 * above the measured ceiling, so only an unusually large party (several covers, or a
 * premium-menu order) reads as a "moment" — a routine single-dish or two-top sale stays silent.
 */
export const HUD_CASH_FEEDBACK_MIN_DELTA = 100;

/** How long the floating cash/tip feedback stays on screen before clearing itself. */
export const HUD_CASH_FEEDBACK_DISPLAY_MS = 2_500;

// --- STORY-016: 3D visual state language color bands ---------------------------------------
//
// PRD §4.4 / §14 "visual state language". These are the CUTOFFS that turn a 0..1 or integer
// signal into one of the six §14 state colors — the colors themselves are hex values and live
// in `client/src/game/state-colors.ts` (a rendering concern), not here (a threshold concern).
// The pure functions that apply these cutoffs live in `shared/game-logic/state-color-bands.js`
// so `scripts/check-visual-state.mjs` can exercise them without a browser, the same split
// `hud-bottleneck-system.js` (thresholds here) / `hud-alerts.js` (pure logic in shared/) already
// established for STORY-015.

/**
 * `CustomerSnapshot.patienceRemaining` at or below this fraction crosses from "healthy" (green)
 * into "attention soon" (yellow) on the patience ring. Deliberately ABOVE
 * `UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD`: the ring's yellow band is an early, ambient warning a
 * player can catch before the party is even the HUD's "unhappy" — full patience always reads
 * green, and this is simply where the party is more than a third of the way to being uncomfortable.
 */
export const PATIENCE_RING_ATTENTION_THRESHOLD = 0.7;

/**
 * `patienceRemaining` at or below this fraction crosses from "attention soon" (yellow) into
 * "active bottleneck" (orange) — visibly getting close, but not yet the red "about to walk out"
 * state. Sits strictly between `PATIENCE_RING_ATTENTION_THRESHOLD` and
 * `UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD`, which is what the ring's red band reuses directly (see
 * `state-color-bands.js`'s own comment on why red is never a second, independently-tuned cutoff).
 */
export const PATIENCE_RING_BOTTLENECK_THRESHOLD = 0.5;

/**
 * A station with at least this many QUEUED, not-shortage-blocked tickets crosses from "healthy"
 * (green) into "attention soon" (yellow) on its queue indicator — the first ticket waiting in
 * line is already worth a glance, well before it is `HUD_KITCHEN_BACKLOG_QUEUED_TICKETS
 * _THRESHOLD`'s "falling behind" (orange, reused directly — see `state-color-bands.js`).
 */
export const STATION_QUEUE_ATTENTION_THRESHOLD = 1;

// ============================================================================================
// STORY-017: bot opponent for solo and development play
// ============================================================================================
// PRD §12's bot fallback and §20's MVP scope, implemented as a real client
// (`server/src/game/bot/`) that sends `setup_submit`/`player_input`/`interact` through the
// exact same `message-router.js` -> validator path a human's browser uses — see
// `bot-controller.js`'s header for why that split is load-bearing (conventions.md Notable
// Pattern 1: the bot is a client from the server's point of view, not a privileged branch).
//
// All bot randomness is one named RNG sub-stream, `match.createRngStream(BOT_RNG_STREAM)`
// (Decision 18) — never `Math.random()` — so a bot match is reproducible from its seed under
// deterministic tick-stepping (see `bot-controller.js#advance`'s own note on why wall-clock
// `setInterval` driving would NOT be reproducible the same way).

/** The named RNG sub-stream every bot draw comes from. Decision 18. */
export const BOT_RNG_STREAM = 'bot';

/** The only two difficulty levels STORY-017 ships. Both run the SAME bot code
 * (`bot-controller.js`) — difficulty is a cadence/threshold knob, never a second AI. */
export const BOT_DIFFICULTIES = Object.freeze(['easy', 'hard']);
export const BOT_DEFAULT_DIFFICULTY = 'easy';

/**
 * How often (game-ms, not wall-ms) the bot re-evaluates what to do next during service. A
 * shorter interval reacts to a changing floor faster and wastes less time walking toward a
 * target that stopped being the best choice — this is the single biggest lever on how
 * "on top of it" the bot's restaurant looks, which is why difficulty turns on it first.
 */
export const BOT_DECISION_INTERVAL_MS = Object.freeze({ easy: 900, hard: 220 });

/**
 * Probability, per decision tick, that the bot does nothing that tick instead of acting —
 * simulated imperfect attention, not a bug. `easy` misses roughly a third of its own
 * opportunities to help (still leaves the restaurant running at the §17 worker-automation
 * floor, per `worker-system.js`'s PRD §24 60-75% figure, which is what keeps `easy` beatable
 * rather than broken); `hard` misses almost none, which is what "punishes idleness" means in
 * practice — an idle human owner gets no help at all, while a hard bot owner is a near-constant
 * second pair of hands.
 */
export const BOT_MISTAKE_PROBABILITY = Object.freeze({ easy: 0.35, hard: 0.05 });

/** Whether the bot spends its stamina sprinting between tasks. `easy` walks; `hard` sprints
 * whenever `movement-system.js`'s own stamina rules allow it, same as a sharp human would. */
export const BOT_SPRINT_ENABLED = Object.freeze({ easy: false, hard: true });

/** `setup_submit` menu-choice weighting (`bot/bot-setup.js`). One point per dish tag that
 * matches the active market's `preferredTags` — the AC's named signal — plus a smaller nudge
 * from the dish's own catalogued `marketAffinity` for this market, when it has one. Neither
 * number is a probability; they are additive scores compared only to each other. */
export const BOT_TAG_MATCH_WEIGHT = 1;
export const BOT_MARKET_AFFINITY_WEIGHT = 0.5;

/**
 * Price choice within a dish's legal `priceBoundsFor()` band (`setup-rules.js`), as a lean
 * toward the low end (`0`) or the high end (`1`) of that band, before jitter. A price-SENSITIVE
 * market (`priceSensitivity` above the neutral value of 1) punishes a high price harder, so the
 * bot leans lower there; an insensitive market can be pushed toward the top of its band. This
 * is a heuristic, not the market's real demand curve — the bot has no more insight into
 * `order-system.js`'s price-elasticity math than a human reading the same qualitative
 * `priceGuidance()` labels would.
 */
export const BOT_PRICE_SENSITIVITY_LEAN = 0.2;
/** +/- this fraction of the price band, applied after the lean, from the bot's own RNG stream —
 * so two otherwise-identical dishes do not always land on exactly the same fraction of their
 * band, without breaking reproducibility (still drawn from `BOT_RNG_STREAM`). */
export const BOT_MENU_PRICE_JITTER = 0.12;

/** How close (world units) the bot's owner avatar must be to a walk destination before
 * `bot-controller.js#walkToward` calls it "arrived" and releases movement input, rather than
 * jittering in place. The same job `worker-system.js`'s `WORKER_ARRIVAL_EPSILON` does for a
 * worker body — kept as its own named constant rather than imported, matching this file's own
 * `bot-controller.js` header on why cross-system values are duplicated, not shared, here. */
export const BOT_ARRIVAL_EPSILON = 0.35;
