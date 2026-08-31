# inventory

## ADDED Requirements

### Requirement: A restaurant's stock comes from its own setup allocation

The server SHALL seed each restaurant's ingredient stock from the `startingInventory` of that
player's accepted setup submission, and from nothing else. At the setup -> service lock it SHALL
move up to the per-station bin capacity of each menu ingredient into the bin of the station that
consumes it, leaving the remainder in the pantry. No unit SHALL be created or destroyed by that
move.

#### Scenario: Seeded from the accepted submission

- **WHEN** a player's submission allocates N units of an ingredient
- **THEN** the restaurant's bins plus its pantry hold exactly N units of it when service begins

#### Scenario: An ingredient that was never bought

- **WHEN** a menu dish needs an ingredient the allocation omitted
- **THEN** that bin opens empty and the dish is unavailable, rather than being stocked by default

#### Scenario: A player who never submitted

- **WHEN** the server supplies a default submission for an idle player
- **THEN** the allocation is derived from that default menu, costs no more than the starting
  cash, and is non-empty

### Requirement: Ticket production consumes ingredients at the station step

The server SHALL deduct a dish's `ingredients` quantities from the bin of the station running the
dish's first `stationSteps` entry, at the moment that step is dispatched. Placing an order SHALL
consume nothing. Later steps of the same ticket SHALL consume nothing further.

#### Scenario: Ordering is not cooking

- **WHEN** an order is placed and the ticket is still queued
- **THEN** no bin level has changed

#### Scenario: The first step charges once

- **WHEN** the ticket's first station step is dispatched
- **THEN** exactly that dish's ingredient quantities leave that station's bin, and walking the
  remaining steps changes no bin level

#### Scenario: Bins are per station

- **WHEN** a dish plates directly from the plating station
- **THEN** its ingredients are held in the plating bin, are absent from the prep bin, and
  emptying every prep ingredient does not stop it being produced

### Requirement: An empty bin blocks its tickets and raises a shortage

While a station bin cannot supply a full serving, the server SHALL refuse to start the tickets
that need it, SHALL leave those tickets in that station's queue, and SHALL dispatch other tickets
past them. It SHALL publish the shortage in `match_snapshot` as its own state — naming the
station and the ingredient — and SHALL name the blocking ingredient on the ticket. Station queue
depth SHALL be unaffected by blocking.

#### Scenario: A shortage is not a long queue

- **WHEN** a station has a deep queue and full bins
- **THEN** no shortage is reported and no ticket names a blocking ingredient

#### Scenario: A shortage is reported as itself

- **WHEN** a station bin runs dry with tickets waiting on it
- **THEN** the restaurant reports a shortage for that station and ingredient, those tickets stay
  queued and name that ingredient, and the station's queue depth still equals the count derived
  from the snapshot

#### Scenario: One empty bin does not idle the station

- **WHEN** a blocked ticket is at the head of a station's queue and a runnable ticket is behind it
- **THEN** the runnable ticket starts

### Requirement: Restocking moves stock from pantry to bin and takes time

A restock SHALL move units from the restaurant's pantry into a station bin over a duration
composed of a travel time and a per-unit handling time, both from `tuning.js`. The units SHALL
leave the pantry when the trip starts and SHALL reach the bin only when it ends. A restock from
an empty pantry SHALL be refused. The travel component SHALL be scalable by a restocking upgrade.

#### Scenario: Not instantaneous

- **WHEN** a restock of U units is requested
- **THEN** its duration is the configured travel time plus U times the configured per-unit time,
  and the bin level is unchanged until that duration has elapsed

#### Scenario: The upgrade hook

- **WHEN** a restock-travel-time multiplier is present
- **THEN** it scales the travel component only, and the handling component is unchanged

#### Scenario: Nothing to move

- **WHEN** a restock is requested for an ingredient the pantry has none of
- **THEN** it is refused and no stock is created

### Requirement: A dish the restaurant can no longer make leaves the menu

When a restaurant has no units of a required ingredient in the bin, the pantry, or a trip in
flight, the server SHALL mark that dish unavailable. New orders SHALL NOT select an unavailable
dish, and its queued tickets SHALL be voided; an order all of whose tickets are voided SHALL be
cancelled and its party SHALL reach `CANCEL_ORDER`. A dish whose bin is empty while the pantry
still holds stock SHALL remain available.

#### Scenario: Recoverable, not terminal

- **WHEN** a bin is empty and the pantry still holds that ingredient
- **THEN** the dish remains available, and a completed restock resumes normal production

#### Scenario: Out for the match

- **WHEN** the last unit of a required ingredient is gone from bin, pantry and transit
- **THEN** the dish is marked unavailable, no new order selects it, and the shortage reports it
  as exhausted rather than merely short

#### Scenario: A party whose food can no longer be made

- **WHEN** a party is waiting on an order whose tickets are all queued and every menu dish becomes
  unavailable
- **THEN** the tickets are voided, the order is cancelled and the party reaches `CANCEL_ORDER`

### Requirement: The `ingredient_shortage` event runs through the same model

The PRD §9 `ingredient_shortage` event SHALL be expressed by drawing `affectedIngredientCount`
ingredients from the union of the restaurants' locked menus and multiplying only those
ingredients' restock durations by `ingredientRestockDurationMultiplier`. The draw SHALL happen
once, when the shortage begins, SHALL be identical for both restaurants, and SHALL be released
when the event ends. No event id SHALL appear in the inventory system's source.

#### Scenario: Only the affected ingredient is slower

- **WHEN** the event is active
- **THEN** a restock of the affected ingredient takes exactly the multiplier times as long as a
  restock of an unaffected ingredient of the same size

#### Scenario: Both players see the same shortage

- **WHEN** the event is active in a 1v1 match
- **THEN** both restaurants report the same affected ingredient

#### Scenario: Held for the event's lifetime

- **WHEN** an unrelated event starts or ends while the shortage is running
- **THEN** the affected ingredient does not change; when the shortage ends, restock durations
  return to normal
