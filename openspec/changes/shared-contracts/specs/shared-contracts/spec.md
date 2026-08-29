# shared-contracts

## ADDED Requirements

### Requirement: All balance content is data, never code

Dishes, markets, customer segments, events and upgrades SHALL be defined in JSON under
`shared/game-data/` and SHALL NOT be hardcoded in any system. PRD §16.

#### Scenario: A system needs a balance value
- **WHEN** a simulation system needs a dish duration, a market weight, an event multiplier or
  an upgrade cost
- **THEN** it reads it from the loaded catalogue, and no such literal appears in system code

#### Scenario: The PRD's worked examples survive verbatim
- **WHEN** `scripts/check-catalogue.mjs` inspects `smash_burger`, `downtown_lunch` and
  `baseball_game_ends`
- **THEN** each matches its PRD §16 example field for field and value for value

### Requirement: An inconsistent catalogue fails loudly at startup

The loader SHALL reject a catalogue whose cross-references do not resolve, and SHALL report
every problem it found rather than only the first.

#### Scenario: A cross-reference does not resolve
- **WHEN** a dish names an ingredient absent from the single ingredient list, or a station the
  §14 layout does not have, or a market's `segmentWeights` names an unknown segment, or a
  market's `eventPool` names an unknown event
- **THEN** `loadCatalogue()` throws `CatalogueError` naming the file, the entry and the
  offending id, and no match may start

#### Scenario: Segment weights are a probability distribution
- **WHEN** a market's `segmentWeights` values do not sum to 1.0 within
  `SEGMENT_WEIGHT_TOLERANCE`
- **THEN** the loader reports the actual sum and the tolerance, and fails

#### Scenario: The shipped catalogue is consistent
- **WHEN** `node scripts/check-catalogue.mjs` runs against the committed game data
- **THEN** it reports zero integrity errors

### Requirement: Ids and duration fields follow one naming convention

Every id in every game-data file SHALL be `snake_case` and unique within its file, and every
duration SHALL be expressed in milliseconds in a field with an `Ms` suffix.

#### Scenario: A non-conforming id or duration is committed
- **WHEN** the catalogue check runs
- **THEN** a camelCase id, a duplicate id, or a missing or non-positive `durationMs` fails it

#### Scenario: `patienceSeconds` is the one exception
- **WHEN** a customer segment declares its patience
- **THEN** it does so as `patienceSeconds`, the deliberate seconds-named exception, and the
  loader validates it as such

### Requirement: The wire protocol is declared in full and validated by shape

`shared/schemas/messages.js` SHALL declare every MVP message type of PRD §12 using the §12
field names, and `shared/schemas/validation.js` SHALL provide a shape validator for each
client-to-server type, consumable from plain JavaScript.

#### Scenario: A PRD §12 example message arrives
- **WHEN** any of the four §12 client-to-server example messages is validated
- **THEN** it is accepted unchanged

#### Scenario: A malformed payload arrives
- **WHEN** a message of a declared type has a missing, mistyped or out-of-range field
- **THEN** validation returns `{ok: false, error: 'invalid_payload'}` with a reason, and never
  throws

#### Scenario: A client sends a position
- **WHEN** a `player_input` message carries a `position` field
- **THEN** it is rejected rather than having the field ignored, because PRD §12 gives the
  server sole authority over position

### Requirement: A declared-but-unimplemented message type is rejected, not ignored

`IMPLEMENTED_CLIENT_MESSAGE_TYPES` SHALL list only the types the server's message router has a
handler for, and SHALL grow only alongside that handler.

#### Scenario: A type with no handler arrives
- **WHEN** a client sends `interact`, `purchase_upgrade` or `setup_submit` before its handler
  story has landed
- **THEN** the server answers `{type: 'error', error: 'not_implemented'}` and the message has
  no effect

### Requirement: Shared modules are importable by the plain-JavaScript server

Every module under `shared/` that the server imports SHALL be authored as `.js` with a sibling
`.d.ts`. The server SHALL NOT be required to compile TypeScript. Milestone 0 Decision 4.

#### Scenario: The server imports a schema
- **WHEN** `server/src/**` imports from `shared/schemas/` or `shared/game-data/`
- **THEN** it imports a `.js` file and runs it directly under Node with no build step

#### Scenario: The client type-checks against the same modules
- **WHEN** `npm run build:client` runs `tsc --noEmit` with `../shared` in its `include`
- **THEN** every `.d.ts` in `shared/` type-checks
