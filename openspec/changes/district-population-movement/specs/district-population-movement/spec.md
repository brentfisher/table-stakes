# district-population-movement

## Purpose

Makes the shared district's full customer population — every party spawned into it, not only
those already tied to one viewer's own restaurant — move incrementally toward its real
destination every tick, and renders that whole population for whichever viewer can legitimately
see it, so a match's customer traffic reads as people walking through a real street rather than
entities jumping between fixed points.

## ADDED Requirements

### Requirement: A party's rendered position is integrated per tick, never jump-assigned

Whenever a party's intended destination changes — approaching a chosen restaurant's queue,
being seated at a table, or walking out after any exit — the server SHALL move that party's
published `position` toward the destination incrementally, at a fixed rate, across multiple
ticks, rather than assigning the destination as the position on the tick the decision is made.
This SHALL hold for every party, including one that never chooses a restaurant at all.

#### Scenario: Approaching a chosen restaurant

- **WHEN** a party's district evaluation resolves and it is assigned to a restaurant's queue
- **THEN** its published position differs from the previous tick's position by a bounded, non-zero
  amount on the very next tick, and continues moving on each subsequent tick until it reaches the
  queue

#### Scenario: Being seated

- **WHEN** a queued party is seated at a table
- **THEN** its published position does not jump to the table's position on the seating tick; it
  reaches the table's position only after walking there across multiple ticks

#### Scenario: Leaving without ever choosing a restaurant

- **WHEN** a party finishes evaluating the district and leaves without choosing any restaurant
- **THEN** its published position visibly changes on the very next tick and continues to change
  across subsequent ticks, even though this party has never moved before that decision

### Requirement: Movement never gates a state-machine transition

The customer state machine's own timers SHALL remain the sole authority for every state
transition. Whether a party's rendered position has reached its destination SHALL have no effect
on when that party's state changes, how it is seated, how money is booked, or any other decision
outcome.

#### Scenario: A state transition fires before the walk completes

- **WHEN** a party's time-based transition threshold is reached while its rendered position is
  still short of its current destination
- **THEN** the state transition happens on schedule, and the party continues walking toward its
  (possibly now-different) destination on subsequent ticks

### Requirement: A party in genuinely shared district space renders for any viewer

A party that has not yet been assigned to a restaurant, or that has already left one behind, SHALL
be included in what is rendered for every viewer of the match, regardless of which restaurant (if
any) it is or was associated with. A party currently occupying a specific restaurant's queue slot
or table SHALL be rendered only for that restaurant's own viewer.

#### Scenario: A party still deciding is visible to both viewers

- **WHEN** a party has not yet been assigned to any restaurant
- **THEN** both viewers in the match render that party at its real, shared-district position

#### Scenario: A party that left without choosing is visible to both viewers

- **WHEN** a party leaves the district without ever choosing a restaurant
- **THEN** both viewers render it walking to its exit, not despawning at the decision instant

#### Scenario: A party queued or seated at the rival is excluded from the other viewer

- **WHEN** a party is queued or seated at restaurant A
- **THEN** restaurant B's own viewer does not render that party at all, exactly as before this
  capability existed

#### Scenario: A party walking out after being served is visible to both viewers

- **WHEN** a party has paid and is walking out, or has exited a restaurant's floor for any reason
- **THEN** both viewers render it walking to its exit, since it is no longer occupying that
  restaurant's specific floor space
