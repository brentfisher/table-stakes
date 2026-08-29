# event-system

## ADDED Requirements

### Requirement: A match's event timeline is built from its seed and is identical for both players

The server SHALL build one event timeline per match, from `match.createRngStream('events')` and
the active market's `eventPool`. The same seed and market SHALL produce the same timeline. No
part of the timeline SHALL depend on which player is being served — asymmetry between the two
restaurants SHALL come only from their menus, prices, upgrades and restaurant state.

#### Scenario: The same seed replays the same match

- **WHEN** two matches are created with the same seed and the same phase preset
- **THEN** their timelines are byte-identical: the same events, in the same order, at the same
  service-relative offsets

#### Scenario: Two players in one match

- **WHEN** `match_snapshot` is built for each of the two players on any tick of any phase
- **THEN** the `events` and `eventForecast` arrays are byte-identical between them, and every
  `event_announce` is broadcast once to the room rather than composed per player

#### Scenario: Another system draws from the seed

- **WHEN** a system registered beside the event system draws from its own named RNG stream
- **THEN** the event timeline is unchanged, because the deck draws from the `events` sub-stream
  and not from a shared generator

### Requirement: Events fire every 30–60 seconds during service

Event activations SHALL be spaced by between `EVENT_MIN_GAP_MS` and `EVENT_MAX_GAP_MS`, from the
start of the service phase through the end of the final rush. No duration SHALL be written
anywhere but `shared/constants/tuning.js`.

#### Scenario: A full service phase

- **WHEN** a timeline is built for any market on either the `full` or the `prototype` preset
- **THEN** the first activation falls 30–60 s after service begins, every subsequent gap is
  30–60 s, and the trailing quiet stretch is no longer than one maximum gap plus the tail margin

#### Scenario: An event too late to matter

- **WHEN** the next activation slot would fall within `EVENT_TAIL_MARGIN_MS` of the end of the
  service window
- **THEN** no event is scheduled there, because an event that activates as the doors shut is a
  notification rather than the actionable decision PRD §9 requires

### Requirement: No more than two high-impact events overlap

The deck builder SHALL enforce PRD §9's rule that at most two high-impact events are active at
once. It SHALL do so while placing cards, not by relying on the cadence to make a violation
unlikely, and SHALL resolve a conflict by choosing a different card rather than by moving the
activation outside the 30–60 s band.

#### Scenario: A card would stack a third high-impact event

- **WHEN** the next card in the deck would be active at the same time as two high-impact events
- **THEN** it is left in the deck and the first card that fits is dealt instead, and the
  activation time does not move

#### Scenario: A pool with no admissible card

- **WHEN** every card in a market's pool would break the cap at some slot
- **THEN** the builder throws with the market, the pool and the offending time, rather than
  quietly breaking either the cap or the cadence

### Requirement: The PRD §9 announcement flow

A scheduled event SHALL announce itself once, activate, apply its effects, and end. The
announcement SHALL be an `event_announce` message matching the PRD §12 envelope, and the
event's lifecycle SHALL be visible in `match_snapshot.events`.

#### Scenario: An event the district telegraphs

- **WHEN** an event with a non-zero `warningMs` is `warningMs` away from activating
- **THEN** one `event_announce` is enqueued carrying `eventId`, `title`, `description`,
  `startsInMs` counting down to activation, and `durationMs`; and the snapshot carries a
  `warning` entry for it with a decreasing `startsInMs`

#### Scenario: An event nothing telegraphs

- **WHEN** an event with `warningMs: 0` activates
- **THEN** its `event_announce` is enqueued at activation with `startsInMs: 0`, and the snapshot
  goes straight to `active`

#### Scenario: An event ends

- **WHEN** an active event reaches the end of its `durationMs`
- **THEN** its effects stop being published in the same tick, and its snapshot entry reads
  `ended` for a short, tuned interval before disappearing

### Requirement: Event effects come from data and are published as neutral-defaulted match state

Every event's behaviour SHALL come from its `effects` in `events.json`. No event id and no
event's behaviour SHALL appear in the event system's source. The combined effect of the active
events SHALL be published on `match.eventEffects` every tick, carrying every key with a neutral
value when no event supplies one.

#### Scenario: A consumer reads an effect

- **WHEN** any system reads `match.eventEffects.<anyKey>` at any point during service
- **THEN** it gets a number (neutral `1`), an object (`{}`), a count (`0`) or the market's own
  `segmentWeights` — never `undefined` — whether or not an event is active

#### Scenario: A designer adds an event

- **WHEN** a new event is added to `events.json` and named in some market's `eventPool`
- **THEN** it can be drawn, announced and applied with no change to the event system, and its
  effect keys are published under the same naming convention

#### Scenario: Two events overlap

- **WHEN** two events are active at the same instant
- **THEN** their multipliers compose, their `dishTagDemandMultipliers` merge per tag, and a
  segment weight named by both takes the later activation's value

#### Scenario: A segment weight override

- **WHEN** an active event overrides a segment's weight
- **THEN** `match.eventEffects.segmentWeights` replaces that segment's market weight, spreads
  the remaining weight proportionally over the segments not named, and still sums to 1

### Requirement: A strong event-dish affinity moves demand 15–40%

The demand multiplier an event places on a dish SHALL be large enough for a player to notice,
per PRD §24: within `EVENT_DEMAND_SHIFT_BAND` for the dishes an event most strongly favours.

#### Scenario: A dish matching an event's strongest tag

- **WHEN** an event is active and a dish carries the tag the event amplifies most
- **THEN** its demand multiplier is between 1.15 and 1.40, measurable by comparing two seeded
  runs of the same match with and without the event system

#### Scenario: A dish matching several of an event's tags

- **WHEN** a dish carries three tags an event names
- **THEN** its demand multiplier is that of its strongest matching tag, not the product of all
  of them, so it stays inside the band

### Requirement: The setup phase carries an event forecast that reveals no firing times

`match_snapshot.eventForecast` SHALL be populated from the match's timeline and SHALL be public
and identical for both players. It SHALL NOT reveal when any event fires.

#### Scenario: A player plans during setup

- **WHEN** a player reads the forecast during `market_reveal` or `setup`
- **THEN** they see every distinct event in this match's timeline with its title, plain-language
  description, duration, occurrence count and whether it will be telegraphed

#### Scenario: The forecast is not a schedule

- **WHEN** the forecast is inspected for any field or ordering that would locate an event in
  time
- **THEN** there is none: no offsets are carried, and the entries are ordered by `eventId`
  rather than by firing order
