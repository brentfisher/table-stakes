## Purpose

Turns the raw §11 end-of-match numbers into a server-computed explanation of why a match was
won or lost — the deciding customer segment, each player's best-performing dish, the rival's
largest single loss cause, the largest turning points, an explicit score/penalty breakdown, and
an explicit tie-break statement — so the results screen can clear PRD §21 Milestone 4's bar
("most players understand why they lost") without any client-side recomputation.

## ADDED Requirements

### Requirement: Composite score breakdown is on the wire, per restaurant

Each restaurant's `MatchResult` SHALL carry `scoreBreakdown`, the composite score's own five
component contributions (`revenueScore`, `guestsServedScore`, `satisfactionScore`,
`reputationBonus`, `eventObjectiveBonus`) plus `penaltyScore`, such that summing all six
(subtracting `penaltyScore`) equals that restaurant's `score` field exactly.

#### Scenario: Components sum back to the reported score

- **WHEN** a match ends and a restaurant's `MatchResult` is built
- **THEN** `revenueScore + guestsServedScore + satisfactionScore + reputationBonus + eventObjectiveBonus - penaltyScore` equals `score`

### Requirement: Penalty breakdown names which term cost the points

Each restaurant's `MatchResult` SHALL carry `penaltyBreakdown`, the individual point cost of
each of the five §11 penalty terms (abandonment, cancelled orders, severe dissatisfaction,
unserved-food waste, failed critic events), such that summing all five equals
`scoreBreakdown.penaltyScore` exactly.

#### Scenario: Penalty terms sum to the total penalty

- **WHEN** a match ends and a restaurant incurred more than one kind of penalty
- **THEN** the five `penaltyBreakdown` values sum to exactly `scoreBreakdown.penaltyScore`

### Requirement: Best dish is selected by average fulfillment time, not sales volume

Each restaurant's `MatchResult` SHALL carry `bestDish`, identifying the dish that restaurant
delivered at least once with the LOWEST average time from order placement to that dish becoming
ready, scanning every dish sold (not only the highest-selling or highest-margin ones). It SHALL
be `null` when the restaurant delivered nothing.

#### Scenario: A low-volume dish can win on speed

- **WHEN** a restaurant's best-selling dish has a slower average fulfillment time than a
  low-volume dish it also sold
- **THEN** `bestDish` names the low-volume, faster dish, not the best-seller

#### Scenario: Nothing sold

- **WHEN** a restaurant delivered zero dishes
- **THEN** `bestDish` is `null`

### Requirement: Largest loss cause is the biggest reasoned-decision bucket, event-tagged only on a real majority

Each restaurant's `MatchResult` SHALL carry `largestLossCause`, naming the single §17 decision
reason under which that restaurant lost the most parties (to the rival, or to no restaurant),
its count, and an `eventId` — set only when a single event covers MORE THAN HALF of that
bucket's own decision timestamps, and `null` otherwise. It SHALL be `null` when the restaurant
lost no party to a reasoned decision.

#### Scenario: The largest bucket wins, not the first one recorded

- **WHEN** a restaurant lost more parties to one decision reason than to any other
- **THEN** `largestLossCause.reason` is that reason and `largestLossCause.count` is its count

#### Scenario: An event covering a real majority is named

- **WHEN** more than half of the largest bucket's decisions fell inside one event's active
  window
- **THEN** `largestLossCause.eventId` is that event's id

#### Scenario: A scattered bucket names no event

- **WHEN** no single event covers a majority of the largest bucket's decisions (including when
  none of them fall inside any event window)
- **THEN** `largestLossCause.eventId` is `null`

### Requirement: The deciding customer segment is the largest served-count differential

`MatchCompleteMessage` SHALL carry `decidingSegment`, naming the customer segment with the
largest difference in served-party count between the two restaurants, which restaurant led it,
and the differential itself. It SHALL be `null` when neither restaurant served anyone, or when
every segment's served count is exactly equal between the two restaurants.

#### Scenario: The largest differential is picked over the largest raw count

- **WHEN** one segment has a smaller served-count total than another but a larger DIFFERENCE
  between the two restaurants
- **THEN** `decidingSegment` names the segment with the larger difference

#### Scenario: An exact tie across every segment names none

- **WHEN** both restaurants served the exact same count of every segment
- **THEN** `decidingSegment` is `null`

### Requirement: Turning points are the largest party-acquisition swings, tied to their event or phase

`MatchCompleteMessage` SHALL carry `turningPoints`, at most `RESULTS_TURNING_POINTS_MAX`
entries, each identifying a window of the match (bounded by event start/end or the first/last
recorded decision) in which the cumulative party-acquisition margin between the two restaurants
swung by the largest amounts, ranked by swing size descending. Each entry SHALL name which
restaurant benefited, the size of the swing, and either the event active during that window or
(when none was active) the service/final_rush phase it fell in.

#### Scenario: Ranked by swing, descending

- **WHEN** a match produces more than one qualifying turning point
- **THEN** `turningPoints[0].swing` is greater than or equal to every subsequent entry's `swing`

#### Scenario: An event-driven swing is tagged with that event

- **WHEN** the largest swing occurred while one event was active
- **THEN** that entry's `eventId` names the event

#### Scenario: A swing with no event names the phase instead

- **WHEN** a qualifying swing occurred with no event active
- **THEN** that entry's `eventId` is `null` and `phase` names `service` or `final_rush`

### Requirement: Tie-break resolution is stated explicitly when it decides the match

`MatchCompleteMessage` SHALL carry `tieBreakDecided`, naming which of the four §11 tie-break
criteria decided the winner and the winning restaurant id, but ONLY when the two restaurants'
composite scores were exactly equal and the tie-break chain itself (not a genuine draw) produced
a winner. It SHALL be `null` in every other case, including an ordinary match where the scores
simply differ, and a genuine draw where every tie-break criterion also ties.

#### Scenario: A real tie-break is named

- **WHEN** two restaurants' composite scores are exactly equal and they differ on average
  satisfaction (or, failing that, guests served, net revenue, or abandoned parties, in that
  order)
- **THEN** `tieBreakDecided.criterion` names the first criterion in that order on which they
  differ, and `tieBreakDecided.winnerPlayerId` is the restaurant that criterion favors

#### Scenario: An ordinary decided match states nothing

- **WHEN** the two restaurants' composite scores differ
- **THEN** `tieBreakDecided` is `null`

#### Scenario: A genuine draw states nothing

- **WHEN** two restaurants tie on composite score AND on every one of the four tie-break
  criteria
- **THEN** `tieBreakDecided` is `null` (the same match reports `winnerPlayerId: null` too)

### Requirement: A match that never reached scoring reports every narrative field honestly empty

When a match ends before the scoring system ever runs (for example, a disconnect-triggered end
during `market_reveal` or `setup`), `MatchCompleteMessage` SHALL still report `decidingSegment:
null`, `turningPoints: []`, and `tieBreakDecided: null` rather than omitting the fields or
fabricating a value.

#### Scenario: Disconnect before scoring

- **WHEN** a match ends via a reason other than normal completion, before the scoring system's
  `results`-transition handler has ever run
- **THEN** `decidingSegment` is `null`, `turningPoints` is `[]`, and `tieBreakDecided` is `null`
  on the `match_complete` message both clients receive
