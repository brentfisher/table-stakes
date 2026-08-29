# platform-foundation

## ADDED Requirements

### Requirement: Three.js loads from a pinned CDN import map

Three.js SHALL be loaded in the browser through an import map pinned to an exact version, and
SHALL NOT be bundled into any application build or declared as a runtime npm dependency.

#### Scenario: Import maps agree with the single pinned version
- **WHEN** `scripts/check-threejs-pin.mjs` runs
- **THEN** `client/index.html` and `harnesses/index.html` both map `three` and `three/addons/`
  to `THREE_VERSION` from `shared/constants/tuning.js`, on the same CDN

#### Scenario: Three.js is absent from every package manifest
- **WHEN** the check inspects each `package.json`
- **THEN** no manifest declares `three` as a dependency, and any `@types/three` entry is a
  devDependency pinned to exactly `THREE_VERSION`

#### Scenario: The built client contains no Three.js bundle
- **WHEN** the client is built and the check inspects the emitted JavaScript
- **THEN** no emitted file contains the Three.js runtime, and `three` remains a bare specifier

### Requirement: The server is authoritative over player position

The server SHALL integrate movement from client intent and SHALL clamp positions to the
restaurant bounds. Clients SHALL NOT send positions.

#### Scenario: An out-of-bounds intent is clamped
- **WHEN** a client sends `player_input` with a movement vector far outside the legal range
- **THEN** the broadcast `match_snapshot` position remains within `RESTAURANT_BOUNDS`

### Requirement: Two clients in one room see each other move

Two clients connected to the same room SHALL each receive the other's owner position and
facing in every broadcast snapshot.

#### Scenario: Movement replicates between clients
- **WHEN** two clients join the same room and one sends movement intent
- **THEN** the other client's `match_snapshot` shows that owner's position and facing changing

### Requirement: Match configuration is reproducible from a seed

Match configuration SHALL be derived entirely from the match seed, so that reproducing a seed
reproduces the configuration.

#### Scenario: The same seed produces the same configuration
- **WHEN** two matches are created with the same seed
- **THEN** their generated configuration is identical

### Requirement: Declared but unimplemented message types are rejected

The message router SHALL answer a declared-but-unimplemented client message type with an
explicit error, and SHALL NOT silently ignore it.

#### Scenario: A not-yet-implemented type receives an explicit error
- **WHEN** a client sends a declared client message type that this milestone does not implement
- **THEN** the server responds with `{ "type": "error", "error": "not_implemented" }` rather
  than ignoring the message

### Requirement: A dev harness runs without a backend

The harness application SHALL implement the `SceneHarness` contract and SHALL be fully usable
with no server running, no match, and no authentication.

#### Scenario: The restaurant layout harness launches standalone
- **WHEN** the harness dev server is started with no game server running
- **THEN** the restaurant layout harness mounts, renders the layout, and exposes its controls
