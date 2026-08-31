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
 * created through `POST /api/dev/match` overrides this to 1.
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
 * THE ABSTRACTED RESTOCKER, and the one place this story admits nobody is actually walking.
 *
 * Exactly the same admission `ORDER_PASS_HANDOFF_MS` makes about the plate runner: the JOB model
 * (a timed pantry -> bin move, at `pantryFacade.requestRestock()`) is real and permanent, but
 * until STORY-007 gives the prep worker legs and STORY-008 gives the owner an `interact` action,
 * something has to decide WHEN to walk or the kitchen simply stops after one bin. When true, the
 * inventory system requests a refill for any bin at or under the threshold. STORY-007/008 replace
 * this TRIGGER — not the job, not the duration, not the shortage state — with a body that has to
 * get there.
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
