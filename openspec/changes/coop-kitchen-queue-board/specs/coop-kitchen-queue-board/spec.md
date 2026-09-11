# coop-kitchen-queue-board

## ADDED Requirements

### Requirement: A restaurant-wide ranked ticket list is computed with the same comparator the AI cook uses

`match.kitchen.queuedTicketsAcrossStations(restaurantId)` SHALL return every queued ticket across
every station this layout has, in the exact order `worker-system.js`'s `compareTickets` (PRD §17
rule 2: queue-age bucket, oldest first; rule 3: among equal buckets, highest patience risk first;
tie-break: `ticketId`) would order them, with no additional filtering (a ticket blocked on an
ingredient, or at a station with no free hands, still appears) and no additional priority logic.

#### Scenario: Ranking matches `compareTickets` across stations

- **WHEN** a restaurant has queued tickets at more than one station with different `queueAgeMs`
  and `patienceRisk`
- **THEN** `queuedTicketsAcrossStations(restaurantId)` returns them in the same relative order
  `[...tickets].sort(compareTickets)` would, regardless of which station each belongs to

#### Scenario: A blocked ticket still appears

- **WHEN** a queued ticket has a non-null `blockedByIngredientId`
- **THEN** it still appears in `queuedTicketsAcrossStations`'s result, at its rank-order position,
  carrying that `blockedByIngredientId`

### Requirement: The queue board is published on the snapshot, scoped to the viewer's own restaurant

`match_snapshot.you.kitchenQueueBoard` SHALL be the ranked result of
`queuedTicketsAcrossStations` for the VIEWER's own restaurant only, defaulting to `[]` before
`match.kitchen` exists. It SHALL NEVER include another restaurant's tickets.

#### Scenario: A viewer never sees the rival's queue

- **WHEN** two restaurants both have queued tickets and a snapshot is built for a viewer of
  restaurant A
- **THEN** `you.kitchenQueueBoard` contains only restaurant A's ticket ids — none of restaurant
  B's ticket ids appear anywhere in the array

#### Scenario: The board is present in both co-op and staffed matches

- **WHEN** a snapshot is built for a viewer in a staffed (non-`sharedRestaurant`) match with
  queued tickets
- **THEN** `you.kitchenQueueBoard` is populated identically to how it would be for the same
  ticket state in a co-op match

### Requirement: The board updates live as tickets are queued, started, and completed

`you.kitchenQueueBoard` SHALL reflect `match.kitchen`'s queue state at snapshot cadence: a newly
queued ticket appears, ranked; a ticket that starts (leaves the station queue) disappears; no
stale entry persists past its ticket's own queued lifetime.

#### Scenario: A ticket leaves the board the instant it starts

- **WHEN** a queued ticket transitions to in-progress (`match.kitchen.startTicket`)
- **THEN** the next snapshot's `you.kitchenQueueBoard` no longer contains that ticket's id
