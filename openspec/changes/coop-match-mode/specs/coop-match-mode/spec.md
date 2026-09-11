# coop-match-mode

## ADDED Requirements

### Requirement: Creating a co-op room reuses the private-invite token/joinUrl flow

`POST /api/rooms` with `{mode: "coop", hostDisplayName}` SHALL create a room whose `Match`
requires two players and has `sharedRestaurant: true`, and SHALL respond with the SAME
`inviteToken`/`joinUrl`/`status: "waiting_for_opponent"`/`hostDisplayName` shape
`mode: "private_human"` already produces.

#### Scenario: A host creates a co-op invite

- **WHEN** a client calls `POST /api/rooms` with `{mode: "coop", hostDisplayName: "Jamie"}`
- **THEN** the response includes a `roomId`, a non-guessable `inviteToken`, a `joinUrl` ending
  in `/join/<inviteToken>`, `status: "waiting_for_opponent"`, `hostDisplayName: "Jamie"`, and
  `mode: "coop"`

#### Scenario: A co-op room's lobby drop is held through the same grace window a private-invite room's is

- **WHEN** a seated co-op player disconnects during `lobby`
- **THEN** their seat is HELD (not released) until `RECONNECT_GRACE_MS` elapses, identically to
  a `mode: "private_human"` room

### Requirement: A co-op match seats two players into one restaurant, not two

`match.restaurantIdFor(playerId)` SHALL return the same restaurant id for both players seated in
a `sharedRestaurant: true` match — the id of whichever player was seated first. Every
restaurant-keyed structure derived from that match (`match.restaurants[]`,
`match_complete.results`, `match_snapshot.frontDoor`/`serviceStation`) SHALL therefore carry
exactly one entry for that restaurant, never one real entry plus a second, unpopulated one keyed
by the other seat's own player id.

#### Scenario: Both seats resolve to the same restaurant id

- **WHEN** a host and a guest both join a `sharedRestaurant: true` `Match`
- **THEN** `match.restaurantIdFor(hostId) === match.restaurantIdFor(guestId)`, and that value is
  the host's own player id (the first one seated)

#### Scenario: The district shows one restaurant once the match reaches service

- **WHEN** a co-op match's both seats ready up and the match reaches the `service` phase
- **THEN** `match.restaurants` has exactly one entry, whose `restaurantId` is the shared
  restaurant id

#### Scenario: A real action from either seat lands on the shared restaurant

- **WHEN** the host purchases one upgrade and the guest purchases a different upgrade, both
  routed through the real `handlePurchaseUpgrade` authority
- **THEN** both purchases appear in `match.upgrades.ownedUpgrades(<shared restaurant id>)`, and
  the guest's own (never-looked-up) private bucket owns neither

### Requirement: A co-op match has no bot opponent and no rival restaurant

A `mode: "coop"` room SHALL NOT seat a bot, and `matchManager.buildSnapshot` SHALL NOT attach a
`bots` array to it (that marker stays `solo_bot`-only). The shared district's choice model runs
UNCHANGED — softmax over every candidate restaurant plus "leave" — over a pool that only ever
contains the one shared restaurant, so `CHOOSE_RIVAL` SHALL never be recorded for a co-op match.

#### Scenario: The district never records a lost-to-rival decision

- **WHEN** a co-op match runs real service-phase ticks with real customer arrivals
- **THEN** `match._customerSimState.counts.CHOOSE_RIVAL` remains `0` for the entire match

### Requirement: The client identifies its own restaurant from `you.restaurantId`, not `playerId`

`match_snapshot.you.restaurantId` and each entry of `match_snapshot.players[].restaurantId`
SHALL carry the viewer's (or that player's) resolved restaurant id — identical to `playerId` for
every non-shared-restaurant match, and the shared restaurant id for either co-op seat. A client
SHALL use this field, not `playerId`, wherever it looks up or filters by restaurant identity
(`restaurants[]`, `frontDoor`, `serviceStation`, `customers[]`/`orders[]` filtering, and the
decision to render another player on this floor vs. a decorative rival one).

#### Scenario: A co-op guest's HUD finds its own restaurant

- **WHEN** the guest seat of a co-op match receives a `match_snapshot`
- **THEN** `status.restaurants.find(r => r.restaurantId === status.restaurantId)` resolves to
  the one shared restaurant, even though `status.restaurantId !== status.playerId`

#### Scenario: A co-op partner renders on the same floor, not the decorative rival one

- **WHEN** the client reconciles another player's avatar whose `restaurantId` equals this
  viewer's own `restaurantId`
- **THEN** that avatar is rendered at its real position on this restaurant's floor
  (`remapToRivalFloor: false`), not remapped onto the decorative rival floor
