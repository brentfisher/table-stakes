# match-lifecycle

## ADDED Requirements

### Requirement: A match advances through the PRD §5 phases on a server-owned clock

A match SHALL progress `lobby -> market_reveal -> setup -> service -> final_rush -> results`,
and every `match_snapshot` SHALL report the current phase as `matchPhase` and the milliseconds
left in it as `timeRemainingMs`. The client SHALL NOT run a phase clock of its own.

#### Scenario: The clock runs down and resets

- **WHEN** a client reads `timeRemainingMs` across consecutive snapshots inside one phase
- **THEN** it never increases, and at the transition it resets to that phase's
  `PHASE_DURATIONS_MS` entry for the match's preset

#### Scenario: A phase with no deadline

- **WHEN** the match is in `lobby`, whose tuning duration is `null`
- **THEN** `timeRemainingMs` is `null`, and the phase ends only once every seat is filled and
  every seated player is ready

#### Scenario: Service flows into the final rush

- **WHEN** the service phase's deadline falls partway through a tick
- **THEN** the next snapshot already reports `final_rush` with a full clock, no snapshot reports
  `service` again, and `final_rush` begins at the deadline rather than at the moment the loop
  noticed it

#### Scenario: Both presets are selectable

- **WHEN** a room is created with `phasePreset` of `full` or `prototype`
- **THEN** each phase lasts exactly its `PHASE_DURATIONS_MS` duration for that preset, and no
  duration is written anywhere but `shared/constants/tuning.js`

### Requirement: Systems attach to the tick without editing match state

`server/src/game/simulation-loop.js` SHALL expose a registration seam that calls a system with
`(match, dtMs)` on every tick and lets it read the current phase. Adding a system SHALL require
a new file and a registration line, and SHALL NOT require editing `match.js` or the loop.

#### Scenario: A story adds a system

- **WHEN** a story adds `server/src/game/systems/<name>-system.js` and one `registerSystem` line
  in `server/src/game/systems/index.js`
- **THEN** the system is called on every tick with the match and the tick delta, in registration
  order, and no other file changes

#### Scenario: A system reads the current phase

- **WHEN** a system's `update` runs
- **THEN** `match.phase` is the phase for THIS tick, because the clock advances before any
  system runs; and a system declaring `phases` is not called outside them at all

#### Scenario: A misregistered system

- **WHEN** a system is registered with a duplicate id, a non-snake_case id, no `update`
  function, or an unknown phase name
- **THEN** registration throws at boot, before the HTTP listener opens

### Requirement: Both players receive identical public market data and no private data

The market SHALL be selected from the match seed at creation. From `market_reveal` onward both
clients SHALL receive identical public market data, and neither SHALL receive the other's menu,
prices or setup submission (PRD §18).

#### Scenario: The same seed selects the same market

- **WHEN** two matches are created with the same seed
- **THEN** both select the same market id from `shared/game-data/markets.json` and produce the
  same phase timeline

#### Scenario: The reveal is identical and incomplete on purpose

- **WHEN** both clients compare the `market` in their snapshots
- **THEN** the payloads are identical, and neither carries the market's `eventPool`, which would
  disclose the event timeline before service begins

#### Scenario: One player's private state

- **WHEN** a snapshot is built for a viewer
- **THEN** everything public is at the top level and the viewer's own state is under `you`,
  which is the only key that differs between the two players' snapshots

### Requirement: Service begins on readiness or on the setup timer

The service phase SHALL begin when every seated player is ready **or** when the setup phase's
deadline expires, whichever comes first (PRD §12 room flow step 7).

#### Scenario: Both players ready early

- **WHEN** every seated player sends `player_ready` during `setup`
- **THEN** `service` begins immediately, without waiting out the setup timer

#### Scenario: A player never readies

- **WHEN** the setup deadline is reached with a player not ready
- **THEN** `service` begins anyway

#### Scenario: A readiness signal outside its phases

- **WHEN** `player_ready` arrives in a phase that does not consult readiness
- **THEN** it is refused and the next snapshot's `you.ready` still reads false, so the client
  observes that nothing happened

### Requirement: A dropped player is held for a reconnect grace period

A player who disconnects mid-match SHALL be held rather than ending the match immediately.
Reconnecting inside `RECONNECT_GRACE_MS` SHALL restore that player to the running match;
exceeding it SHALL end the match cleanly with a stated reason (PRD §13).

#### Scenario: Reconnecting inside the window

- **WHEN** a client that dropped during `service` sends `join_room` carrying its previous
  `playerId` inside the grace window
- **THEN** it is restored to the same seat in the still-running match, and the snapshot shows it
  connected again

#### Scenario: The window expires

- **WHEN** a player has been disconnected for longer than `RECONNECT_GRACE_MS` during
  `market_reveal`, `setup`, `service` or `final_rush`
- **THEN** the match ends, lands on `results` with an empty clock, and emits `match_complete`
  with `reason: "player_disconnected"` naming the player who dropped

#### Scenario: A token cannot take an occupied seat

- **WHEN** a `join_room` carries the `playerId` of a player who is currently connected, or one
  whose grace window has expired
- **THEN** the seat is not reassigned and the join is refused with `match_full`

### Requirement: A completed match emits the PRD §12 `match_complete` envelope

#### Scenario: The results phase ends

- **WHEN** the `results` phase deadline is reached
- **THEN** exactly one `match_complete` is broadcast, carrying `winnerPlayerId: null` and a
  `results` object with one empty object per player, which STORY-013 fills in

### Requirement: The catalogue is loaded at boot and served over HTTP

#### Scenario: The catalogue is malformed

- **WHEN** the server starts against a `shared/game-data/` catalogue that fails `loadCatalogue`
- **THEN** startup aborts with every problem listed, before the HTTP listener opens

#### Scenario: A developer inspects the markets

- **WHEN** `GET /api/markets` is called
- **THEN** it returns the real market definitions from `markets.json` in their public
  projection, rather than the STORY-001 `501 not_implemented` placeholder
