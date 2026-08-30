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
/** STORY-005 will replace this synthetic kitchen wait with the real order-ticket duration once
 * the kitchen exists; until then it stands in for "food is being prepared". Calibrated (see
 * scripts/check-customer-lifecycle.mjs's balance run) so a table's average full occupancy —
 * greet + order + food wait + eating + paying, about 35s — lets six tables turn over enough in
 * one PRD §5 6-minute service window to land in the §24 "40-90 parties per restaurant" range
 * without abandonment dominating the outcome. */
export const CUSTOMER_FOOD_WAIT_MS_RANGE = [8_000, 18_000];
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

/**
 * The EVALUATE_RESTAURANTS placeholder (PRD §6 "Restaurant choice model" / §17 steps 3-5),
 * implemented against a SINGLE restaurant. STORY-010 replaces the function that reads these —
 * `resolveEvaluateRestaurants` in customer-system.js — with a real two-restaurant probabilistic
 * comparison. Until then, a flat probability stands in for "a real rival existed and won" so
 * CHOOSE_RIVAL stays reachable and exercised even with nothing to compare against, and queue
 * pressure — the one signal that IS real even with one restaurant (§6 "Actual queue length") —
 * drives LEAVE_DISTRICT.
 */
export const CUSTOMER_RIVAL_PLACEHOLDER_PROBABILITY = 0.08;
/** queued parties / total seats, above which a party may decide the wait isn't worth it. */
export const CUSTOMER_QUEUE_PRESSURE_LEAVE_THRESHOLD = 1.5;
export const CUSTOMER_QUEUE_PRESSURE_LEAVE_PROBABILITY = 0.5;

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
 * The numbers are measured, not guessed — see the per-station utilisation table
 * `scripts/check-orders.mjs` prints on its §24 balance run. `prep` is the wide one because
 * every dish in the catalogue routes through it and it would otherwise cap the whole kitchen
 * on its own; `plating` is next-widest for the same reason. `grill` and `oven` each serve a
 * subset of the menu, so they queue visibly under a burst without capping a normal service.
 *
 * A station named in a layout but absent here falls back to STATION_DEFAULT_CONCURRENCY.
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
