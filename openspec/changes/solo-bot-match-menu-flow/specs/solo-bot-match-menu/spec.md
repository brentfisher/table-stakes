# solo-bot-match-menu

## Purpose

Lets a player start a real, server-authoritative match against a bot opponent from the main
menu, configuring market scenario and bot profile first, without touching the dev-only
`/dev/match` endpoint or its raw JSON contract.

## ADDED Requirements

### Requirement: The main menu's "Play vs Bot" action opens a working configuration screen

The main menu SHALL offer a "Play vs Bot" action that opens a configuration screen, rather than
a disabled/"coming soon" placeholder. The screen SHALL offer a market scenario choice and a bot
profile choice, and, only when the client was built/is running in development mode, a fixed
seed input.

#### Scenario: Play vs Bot is a real action

- **WHEN** a player opens the main menu
- **THEN** "Play vs Bot" is an enabled action that opens a configuration screen when activated,
  not a disabled button

#### Scenario: The seed input is absent outside development mode

- **WHEN** a production-built client opens the "Play vs Bot" configuration screen
- **THEN** no fixed-seed input is rendered on the screen

#### Scenario: The seed input is present in a development build

- **WHEN** a development-mode client opens the "Play vs Bot" configuration screen
- **THEN** a fixed-seed input is rendered, and leaving it blank still starts a match with a
  randomly generated seed

### Requirement: A player-facing endpoint seats one human and one bot on the authoritative match lifecycle

`POST /api/rooms` with `{mode: "solo_bot", botDifficulty, marketId?, seed?}` SHALL create a
two-seat room, attach a bot to one seat before the response is sent, and respond with the room's
status plus `bot: true` and the normalized `botDifficulty` actually applied. This path SHALL use
the same underlying room-creation and bot-attachment mechanism the pre-existing `POST
/dev/match` `{bot: true}` path uses — not a second, independent attachment mechanism — and SHALL
NOT alter `POST /dev/match`'s own existing behavior or response shape.

#### Scenario: Starting a solo bot match

- **WHEN** a client calls `POST /api/rooms` with `{mode: "solo_bot", botDifficulty: "balanced"}`
- **THEN** the response has `requiredPlayers: 2`, `bot: true`, `botDifficulty: "balanced"`, and
  `connectedCount: 1` (the bot already seated), before any human has joined

#### Scenario: The pre-existing dev endpoint is unaffected

- **WHEN** a client calls `POST /api/dev/match` with `{bot: true, difficulty: "hard"}`, exactly
  as before this change
- **THEN** the response shape and the room's behavior are identical to before this change

#### Scenario: An invalid bot profile falls back to the default

- **WHEN** a client calls `POST /api/rooms` with `{mode: "solo_bot", botDifficulty:
  "not-a-real-profile"}`
- **THEN** the room is created with the default bot difficulty rather than the request being
  rejected

### Requirement: Bot profile options are drawn from one shared difficulty source, never a parallel enum

The bot profile choices offered by the configuration screen (Balanced, Fast Service, Premium,
and, in development mode only, Practice) SHALL each correspond to a value the server's bot
difficulty normalization function accepts. No client-side or server-side list of legal bot
profiles SHALL exist independently of that shared source of truth.

#### Scenario: Every offered profile is a legal server difficulty

- **WHEN** the configuration screen's bot profile list is compared against the server's list of
  normalizable bot difficulties
- **THEN** every profile id offered by the screen is a member of the server's list

#### Scenario: Practice is development-only

- **WHEN** a production-built client renders the bot profile list
- **THEN** the Practice profile does not appear among the offered choices

### Requirement: An explicit market scenario overrides the seed-derived draw

Room creation SHALL accept an optional market scenario id. When present and valid, the created
match SHALL use that market instead of the one its seed would otherwise draw. When absent,
invalid, or unrecognized, the match SHALL use the seed-derived market exactly as before this
change, without error.

#### Scenario: A valid override is honored

- **WHEN** a room is created with an explicit, valid market scenario id, together with a seed
  that would otherwise draw a different market
- **THEN** the created match's market is the explicitly chosen one

#### Scenario: An invalid override is silently ignored

- **WHEN** a room is created with a market scenario id that does not exist in the catalogue
- **THEN** the created match's market is the one the seed would have drawn, and room creation
  does not fail

#### Scenario: The override does not disturb other seed-derived values

- **WHEN** two rooms are created with the same seed, one with a valid market override and one
  without
- **THEN** every other seed-derived value on the two matches (for example, the spawn jitter) is
  identical between them

### Requirement: Bot identity is disclosed on the wire only for a solo-bot room

The live match snapshot SHALL include which seat, if any, is bot-controlled and that bot's
profile, but only for a room created through the solo-bot menu path. A room created through the
pre-existing dev/bot endpoint SHALL NOT carry this information on the wire, preserving that
endpoint's existing "the human client cannot tell from the protocol that the opponent is a bot"
property.

#### Scenario: A solo-bot room's snapshot names its bot

- **WHEN** a human client is connected to a room created via the solo-bot menu path
- **THEN** the live match snapshot it receives identifies the bot's seat and its profile

#### Scenario: A dev/bot room's snapshot stays silent about the bot

- **WHEN** a human client is connected to a room created via the pre-existing dev/bot endpoint
- **THEN** the live match snapshot it receives carries no field naming which seat, if any, is a
  bot

#### Scenario: Bot identity is public, not per-viewer

- **WHEN** a solo-bot room's snapshot is built for two different viewers
- **THEN** the bot-identity information in both snapshots is identical

### Requirement: The bot opponent is represented through the existing rival surfaces only

A bot opponent's restaurant SHALL be shown through the same rival-summary and tactical-overview
surfaces an opponent restaurant is always shown through — no separate rendering or scoring path
SHALL exist for a bot-controlled restaurant.

#### Scenario: The bot's restaurant appears where a rival's always would

- **WHEN** a player is in a service-phase solo-bot match
- **THEN** the bot's restaurant summary appears in the same scoreboard/tactical-overview
  location and with the same fields a human rival's restaurant would show

### Requirement: The results screen names the bot opponent by profile

When a match's opponent is a bot, the results screen SHALL identify that opponent by its bot
profile rather than by a generic label that gives no indication the opponent is a bot.

#### Scenario: A finished solo-bot match names its opponent

- **WHEN** a solo-bot match reaches its results screen
- **THEN** the opponent's results column is labeled with the bot's profile, not a generic
  unlabeled "opponent" designation

### Requirement: Abandoning a solo-bot match ends it the same way an abandoned human match ends

A human player disconnecting from a solo-bot match and not reconnecting within the standard
reconnect grace period SHALL end the match with the same disconnect reason a human-vs-human
match's abandonment already produces, through the same mechanism, with no bot-specific
exception.

#### Scenario: A dropped human ends the match after grace

- **WHEN** the human player in a solo-bot match disconnects during an active phase and does not
  reconnect before the reconnect grace period elapses
- **THEN** the match ends with the same disconnect reason an abandoned human-vs-human match ends
  with, and the bot's own seat is unaffected by the human's disconnection up to that point
