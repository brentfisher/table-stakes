# customer-acquisition

## ADDED Requirements

### Requirement: Both restaurants draw from one shared district pool

The server SHALL spawn parties into the district, not into a restaurant. A party SHALL carry no
`restaurantId` until `EVALUATE_RESTAURANTS` resolves, and every restaurant in the match SHALL
draw from that one arrival stream.

#### Scenario: One pool, two restaurants

- **WHEN** a 1v1 match runs a service phase
- **THEN** there is a single arrival log with no restaurant attached to any entry, and both
  restaurants have won parties from it

#### Scenario: Every party is accounted for

- **WHEN** the decisions recorded for a match are compared with the per-restaurant funnels
- **THEN** each decision is exactly one of: a party won by one restaurant, or a party that left
  the district

### Requirement: The choice is scored from public observables and is probabilistic

A party SHALL score every restaurant from menu fit, price, projected wait, visible reputation,
remaining capacity and event affinity, combined using that party's own `menuFitWeight`,
`priceWeight`, `serviceSpeedWeight` and `reputationWeight`. The choice SHALL be probabilistic:
a restaurant with a modestly better score SHALL win a proportionally higher share of comparable
parties, and SHALL NOT win all of them.

#### Scenario: A small edge is a split, not a sweep

- **WHEN** one restaurant undercuts an identical menu by 10%
- **THEN** it wins between 55% and 85% of comparable parties across many seeds, and the rival is
  never shut out

#### Scenario: The party's own weights decide

- **WHEN** the same reputation gap is presented to a reputation-led segment and a speed-led one
- **THEN** the reputation-led segment favours the better-reputation restaurant substantially more

#### Scenario: A party may choose neither restaurant

- **WHEN** no restaurant scores better than the street
- **THEN** the party SHALL enter `LEAVE_DISTRICT`, and a restaurant with a badly priced menu
  SHALL still draw parties

### Requirement: Live capacity and queue length change outcomes mid-match

A restaurant whose projected wait — derived from its live queue, its free tables and its
kitchen's station backlog — exceeds a party's own patience budget SHALL NOT be a candidate for
that party, and SHALL record `restaurant_full`.

#### Scenario: Filling a dining room mid-match

- **WHEN** one restaurant's tables are all occupied and a queue forms, during a match
- **THEN** parties measurably shift to the rival, and shift back when the tables free

#### Scenario: A kitchen backlog is visible to the street

- **WHEN** real orders stack up behind a station's concurrency limit
- **THEN** the projected wait the choice model scores rises with the depth reported by
  `match.kitchen.queueDepth()`

#### Scenario: Recovery through execution

- **WHEN** a player with a weaker, dearer menu keeps their kitchen clear while the rival's backs
  up
- **THEN** they win parties back, and those parties are recorded as won on
  `shorter_projected_wait`

### Requirement: Reputation compounds across a match and is capped

Reputation SHALL move with the satisfaction of the parties a restaurant serves, SHALL be bounded
above and below, and the maximum advantage it can confer SHALL leave the match winnable.

#### Scenario: The cap holds

- **WHEN** a restaurant receives an unbounded run of perfect reviews
- **THEN** its reputation stops at the ceiling

#### Scenario: A dominant early lead is not a won match

- **WHEN** one restaurant opens with fifteen perfect reviews and the rival with fifteen walkouts
- **THEN** the trailing restaurant still draws a large minority of the district

### Requirement: Every choice records a §17 decision reason, or none at all

Each decision SHALL record one of `better_price`, `better_menu_fit`, `shorter_projected_wait`,
`higher_reputation`, `event_affinity`, `restaurant_full`, `customer_abandoned_queue`, or `null`
where no comparison decided it. Reasons SHALL be stored on match state and SHALL survive to
`results`.

#### Scenario: No reason is invented

- **WHEN** two identical restaurants at identical prices split the district
- **THEN** no decision reason is recorded for any of those parties

#### Scenario: The record outlives the simulation

- **WHEN** a match reaches `results`
- **THEN** the full decision log and a per-restaurant roll-up remain on match state

### Requirement: No client receives the rival's hidden state

The public district view SHALL carry only the observables the choice model itself scores. A
player's menu, prices, cash and inventory SHALL NOT appear in any snapshot sent to their rival,
and the decision log SHALL NOT be serialized at all.

#### Scenario: Two viewers, one district

- **WHEN** snapshots are built for both players during service
- **THEN** neither carries the other's menu dishes or any private restaurant field, and both
  receive an identical public district view
