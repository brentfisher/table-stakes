# Design — Seeded event deck

Decisions later work must preserve or explicitly supersede. Numbering continues from
`match-lifecycle-and-phase-clock/design.md`, which ended at Decision 19.

> **Numbering note for whoever merges second.** STORY-004 and STORY-009 were implemented in
> parallel off the same base commit and may also have claimed numbers from 20. The headings
> below are stable *names*; renumber them, not the content, if they collide.

## Decision 20 — The event timeline is service-relative, and anchored once at the transition

The timeline is built as offsets from the first millisecond of the service phase, not as
absolute match-clock coordinates, and that is forced rather than stylistic. PRD §12 room-flow
step 7 ends setup "once both players are ready **or** the timer expires", so how much clock has
elapsed when service begins is a fact about how fast two humans clicked. An absolute timeline
could not be computed until that moment — and PRD §7 requires the forecast to exist *during*
setup, before it.

So `buildEventTimeline()` returns offsets, and `onPhaseChange(_, {to: 'service', atMs})` stamps
`timeline.anchorMs = atMs` exactly once. `atMs` is the phase *deadline* the clock carried
forward (Decision 14), never "now", so the event timeline inherits the phase machine's freedom
from drift rather than accumulating its own.

The window is `service + final_rush`: PRD §5 makes those separate phases, but the restaurant is
open for both, and §9 says events run "during the service phase". The system therefore declares
`phases: ['service', 'final_rush']`.

## Decision 21 — Effects are published onto match state; the event system never consumes them

`match.eventEffects` is a plain object, rewritten every tick, carrying the combined effect of
whatever is active at that instant. Six later stories read it. None of them may reach into the
event system, and the event system reaches into none of them.

**Every key is always present with a neutral value** — `1` for a `…Multiplier`, `{}` for a
`…Multipliers`, `0` for a `…Count`, the market's own weights for `segmentWeights`. A consumer
writes `match.eventEffects.patienceMultiplier` and is done; it never asks whether an event is
running. That is what Decision 12's "all four keys on every event so a consumer reads them
unconditionally" buys, extended to the extension keys and to the no-event case.

**Republished every tick, including when nothing is active.** Edge-triggering the write would
leave a consumer holding a stale multiplier through the gaps between events, and a check that
samples only inside an active window would never catch it.

**The key set is derived from `events.json`, not declared in code.** The module reads the
catalogue at load and collects every `…Multiplier`, `…Multipliers` and `…Count` key any event
uses. A designer adding `spoilageMultiplier` to an event gets it published, neutral-defaulted,
with no code change. The suffix convention (conventions.md "Naming") is doing real work here.

## Decision 22 — A dish's event demand is its STRONGEST matching tag, not the product of them

PRD §24 sets the magnitude: "roughly 15–40% for strong event-dish affinity, not 2–5%". The
obvious implementation — multiply every matching `dishTagDemandMultipliers` entry — misses that
band badly on the shipped catalogue. The MVP cheesecake is tagged `dessert`, `premium` and
`date-night`; the pre-theater event names all three at 1.2, 1.35 and 1.25. The product is
**2.03 — a 102% shift**, two and a half times the top of the band.

So the rule is: the strongest amplifying tag times the strongest dampening tag. For the shipped
data, where every tag multiplier amplifies, that is simply the strongest matching value.

Two consequences worth stating:

- **§24's band becomes a property of `events.json` alone.** The measured shift for any dish is
  exactly the largest number the designer wrote for a tag that dish carries, so balance is
  checkable by reading the data. `scripts/check-events.mjs` sweeps all ten events against all
  eight dishes and requires every strongest affinity to land in `EVENT_DEMAND_SHIFT_BAND`.
- **The band is expressed as multiplier bounds (`1.15`–`1.4`), not as shifts.** `1.15 - 1` is
  `0.14999999999999991` in IEEE-754, so a shift-based comparison rejects an event authored at
  exactly the documented floor — and one of the ten is. Same class of trap
  `SEGMENT_WEIGHT_TOLERANCE` exists for in `loader.js`; comparing the multipliers themselves is
  exact and needs no tolerance.

The design claim underneath: an event says how much the district wants that *kind* of food. A
dish that fits an event three ways is not two and a half times more wanted than one that fits it
once; it is wanted as much as its best fit.

## Decision 23 — "High impact" is scored from the §16 demand keys, and the cap is enforced while dealing

PRD §9: "Do not stack more than two high-impact events at once in MVP." Neither half of that is
free — the PRD does not say which events are high-impact, and leaving the cap to the cadence is
exactly the "left to chance" the story forbids.

**Scoring.** An event's impact is the largest absolute deviation from 1.0 across
`footTrafficMultiplier`, `partySizeMultiplier` and `dishTagDemandMultipliers`; at or above
`EVENT_HIGH_IMPACT_THRESHOLD` (0.3) it is high-impact. This splits the MVP catalogue 6/4.

Deliberately **not** every multiplier an event carries. Scoring the operational extensions too
(a 2× restock, a 0.7× grill) classifies nine of ten events as high-impact — and then
`stadium_district`'s four-card pool contains nothing the cap can ever admit, at which point the
cap and the 30–60 s cadence are mutually unsatisfiable and two acceptance criteria contradict
each other. §9's stacking rule is about demand shocks landing on top of one another; a slow
grill is an operational problem, not a demand shock. `segmentWeightOverrides` is excluded for a
different reason: it redistributes a fixed total rather than changing it, and its magnitude is
only meaningful against a particular market, so it cannot be scored on the event alone.

**The invariant that makes the cap satisfiable: every market's `eventPool` must contain at
least one low-impact card.** That is checked directly, per market, rather than assumed.

**Enforcement.** The builder places a card only if the resulting high-impact concurrency stays
at or under `EVENT_MAX_CONCURRENT_HIGH_IMPACT`. A card that would break it is *swapped past* —
left at the front of the bag to be offered at the next slot — never used to skip the slot,
because skipping would push the realized gap to 60–120 s and break the cadence. If a whole
reshuffled deck fits nowhere, the builder **throws**, in the same spirit as `CatalogueError` at
boot and `registerSystem` on a wiring mistake.

With the shipped data the cadence already bounds concurrency at two (events *i* and *i+2*
overlap only if two consecutive gaps sum to less than one duration, and 30 + 30 ≥ 60), so the
enforcement path never runs in a real match. That is a knife-edge, not a proof — a 90-second
event authored tomorrow would cross it — so the check script proves the enforcement works by
feeding the builder 120-second events and requiring the low-impact card to be swapped in.

## Decision 24 — §9's five-step announcement flow is one `event_announce` plus snapshot state

PRD §9 lists teaser → announcement with countdown → activation → district update → end. PRD §12
defines exactly one event message. Rather than invent a second message type or a second lead
constant, the two are mapped like this:

- `event_announce` fires **once per scheduled occurrence**, at `activateAtMs - warningMs`, with
  `startsInMs` carrying the remaining countdown — which is §9 step 2's "countdown" and requires
  the message to be pre-activation. An event nothing telegraphs (`warningMs: 0`) announces at
  activation with `startsInMs: 0`, which is exactly what the envelope documents that value to
  mean.
- The snapshot's `events[]` entry carries the rest: `warning` with a decreasing `startsInMs`
  (§9 step 1), `active` with `endsInMs` (steps 3–4), then `ended` for
  `EVENT_ENDED_VISIBLE_MS` (step 5) so a banner that appears on the last frame of an effect can
  still be read.

`warningMs` in the data is the §9 "10–20 seconds before activation **when appropriate**" lead;
`0` means not appropriate. The check script asserts every non-zero lead falls in that band.

The §12 snapshot example shows `baseball_game_ends` in `warning` with `startsInMs: 18000`
against a `warningMs` of 15000. That is a hand-written number in an illustration, and it is not
worth a second tuning constant to reproduce.

## Decision 25 — Two lines of `match.js`, because the snapshot has no contribution seam

Decision 15 says adding a system never edits `match.js`, and this change adds no system logic
there. But `toSnapshot` hardcodes `events: []`, and the acceptance criterion is that warning
state appears in `match_snapshot.events`. There is no seam; the literal has to go.

The edit is two lines and no more: `events: this.events ?? []` and
`eventForecast: this.eventForecast ?? []`. **No constructor change**, deliberately — the
optional read means the fields exist only once a system sets them, so there is no new field for
STORY-004 or STORY-009 to collide with while they add `customers` and `restaurants` beside it.

The alternative considered and rejected was folding the forecast into `events[]` under a
synthetic `state`. `EVENT_STATES` is a three-member enum the client and STORY-015's banner
switch on; widening it so setup could borrow the array would push a setup-phase concept into
every consumer of a service-phase one.

## Decision 26 — The forecast reveals what the district can do, never when

PRD §7 gives the player an "initial event forecast, if any" and §9 lists "event forecasting in
setup" as a reason to seed the deck. Both stop short of saying how much to reveal, and the
extremes are both wrong: nothing makes setup a guess, and the schedule makes service a lookup.

`eventForecast[]` carries, per distinct event in the timeline: `eventId`, `title`,
`description`, `durationMs`, `occurrences`, and `telegraphed` (whether it will be teased in
advance). It carries no offset of any kind, and it is **ordered by `eventId`, not by firing
order**, so the ordering leaks nothing either. What a player plans against is which events this
district can throw at them, how long each lasts, and how many are coming. When they land is
what service is for.

`market.eventPool` stays withheld from `publicMarket()` (Decision 16). The forecast is a
narrower disclosure: the pool would say what *could* have been drawn, the forecast says what
*was* — which is more useful to a player and less useful for reverse-engineering the deck.
