# Shared contracts — game data and wire schemas

## Why

`shared/` is the contract layer between two applications written in two languages. PRD §16
requires that all balancing content live in JSON rather than inside systems, and PRD §12
defines a JSON WebSocket protocol both sides must agree on letter for letter.

STORY-001 shipped only what Milestone 0's movement-and-snapshot path needed. Everything after
it consumes `shared/`: fifteen of the remaining stories read the catalogue, and
`shared/schemas/messages.*` is the single file every story that adds a message type must edit.
Opening a dozen branches against an empty contract layer reproduces, one level down, exactly
the conflict problem STORY-001 existed to prevent. So the vocabulary is declared in full now —
including message types no system sends yet — and the catalogue is populated with the PRD's own
worked examples so later stories have real content to run against.

This corresponds to STORY-002 in the slicing pass.

## What changes

- **Five game-data files** under `shared/game-data/`, the set PRD §13 names: the eight §7 MVP
  dishes, the three §6 MVP markets, the five §6 customer segments, all ten §9 MVP events, and
  eleven §10 upgrades. The three PRD §16 worked examples (`smash_burger`, `downtown_lunch`,
  `baseball_game_ends`) are reproduced field for field and value for value, because later
  stories' acceptance criteria cite those field names.
- **A single ingredient list**, declared in `dishes.json` alongside the dishes that reference
  it. PRD §13's layout names no ingredients file, and a sixth file would be a sixth thing to
  keep in sync.
- **`shared/schemas/messages.*` widened** from the Milestone 0 subset to the full MVP protocol:
  every §12 message shape, plus the match phases, event states, interact actions, dish
  categories and stations that validators compare against.
- **`shared/schemas/game-state.*`** — the snapshot entity shapes (`restaurants`, `customers`,
  `orders`, `players`) and the §8 customer state machine including all five exit states.
- **`shared/schemas/validation.*`** — one shape validator per client-to-server message type,
  consumable from the plain-JavaScript server.
- **`shared/game-data/loader.*`** — reads the catalogue and refuses to return a half-valid one.
- **`scripts/check-catalogue.mjs`** — the runnable acceptance check, wired to `npm run check`.

## Non-goals

No systems. Nothing here spawns a customer, cooks a dish, fires an event or charges for an
upgrade — this change ships the data and its shape, not the code that consumes them.

Consequently **`IMPLEMENTED_CLIENT_MESSAGE_TYPES` is not widened.** It means "types the router
has a handler for", and this change adds no handlers. `interact`, `purchase_upgrade` and
`setup_submit` keep being answered with `not_implemented` (Milestone 0 Decision 7); the story
that implements each handler adds its type to that list in the same commit.

The balance numbers are a starting point, not a balanced game. PRD §7 states dish speed only
qualitatively (Fast / Medium / Slow), so the `durationMs` values are invented to preserve that
relative ordering and are expected to move once the §15 harnesses can exercise them.

Arts & Nightlife and Neighborhood Weekend are deliberately absent — PRD §6 defers both until
the core loop is stable.
