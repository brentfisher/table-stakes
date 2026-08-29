# Design — Shared contracts

Decisions later work must preserve or explicitly supersede. Numbering continues from
`milestone-0-repo-scaffold/design.md`, whose Decisions 4 and 7 this change extends.

## Decision 9 — The catalogue is cross-referenced by id, and the loader proves it at startup

PRD §16 makes balance content data, which means a typo in a JSON file is a class of bug no
compiler catches and no reviewer reliably spots. Left alone, its symptom appears three systems
away from its cause: a party wants a dish that does not exist, or a market draws an event id
nothing defines.

`shared/game-data/loader.js` therefore refuses to return a half-valid catalogue. It checks the
four cross-references the data actually has — a dish ingredient key against the single
ingredient list, `stationSteps[].station` against the §14 layout's stations, a market's
`segmentWeights` keys against segment ids, a market's `eventPool` entries against event ids —
plus `marketAffinity` keys against market ids, id uniqueness and snake_case, and the `Ms`
duration fields. It collects **every** problem and throws one `CatalogueError` listing all of
them, because fixing a broken catalogue one error per run is miserable.

It also asserts each market's `segmentWeights` sum to 1.0 within `SEGMENT_WEIGHT_TOLERANCE`
(1e-6), an exported named constant. The tolerance is load-bearing, not ceremonial: the PRD's own
`downtown_lunch` example, 0.55 + 0.10 + 0.20 + 0.05 + 0.10, is not exactly 1 in IEEE-754, so an
exact comparison would reject the document's own data. 1e-6 is far tighter than the smallest
weight anyone would plausibly write.

A story that adds a new cross-reference between two catalogue files adds its check here.

## Decision 10 — The loader is Node-only; the browser imports the JSON directly

`loader.js` uses `readFileSync`, so it is server-side only. This is deliberate on both ends: the
server wants a hard failure at boot rather than a `undefined` three systems in, and the client
already gets the same files as typed imports through Vite with no loader needed. Importing
`loader.js` into browser code breaks the client build.

`readFileSync` rather than `import ... with {type: 'json'}` because import attributes are still
a moving target across Node versions and the server is plain JavaScript with no build step.

## Decision 11 — Validation checks shape; the server checks authority

`shared/schemas/validation.js` answers "is this message well-formed?" — is `sequence` a
non-negative integer, is `move.sprint` a boolean, does `addons` hold at most two entries. It
does **not** answer "is this legal?" — whether the upgrade exists, whether the player can afford
it, whether the target is in reach. Those are authority questions and belong to
`server/src/game/validators/action-validator.js` per Milestone 0 Decision 2.

Keeping the two apart is what lets the client import the same module to reject its own malformed
messages before sending them, without shipping any authority logic to the browser. It returns a
discriminated `{ok: true, message} | {ok: false, error, detail}` and never throws, and its error
codes are the ones `message-router.js` already emits — so wiring it into the router introduces
no new vocabulary.

One shape rule does encode an authority rule: a `player_input` carrying a `position` field is
rejected outright rather than having the field ignored. A client that sends a position is buggy
or cheating, and PRD §12 gives the server sole authority over position.

## Decision 12 — Event effects share the §16 vocabulary; extensions are named, not overloaded

PRD §16's `baseball_game_ends` example establishes four effect keys: `footTrafficMultiplier`,
`segmentWeightOverrides`, `dishTagDemandMultipliers`, `partySizeMultiplier`. All four appear on
**every** event, using neutral values (`1.0`, `{}`) where an event does not use them, so a
consumer reads them unconditionally with no per-event special case.

Four §9 events describe consequences that vocabulary cannot express — rain raising dine-in
patience, a critic party arriving, a slow restock, slowed equipment. Those carry additional
explicitly-named keys (`patienceMultiplier`, `specialPartySpawn`,
`ingredientRestockDurationMultiplier`, `stationSpeedMultipliers`, …) rather than overloading a
§16 key with a second meaning. Every multiplier is 1.0-relative: above 1 amplifies, below 1
dampens, including durations, where below 1 therefore means *faster*.

`segmentWeightOverrides` **replaces** the market's weight for a named segment while the event is
active; the remaining weight is redistributed proportionally across the segments not named. That
is why the overrides need not themselves sum to anything.

## Decision 13 — `REVIEW / REPUTATION_IMPACT` is modelled as one customer state

PRD §8 writes the terminal step of the customer state machine as `REVIEW / REPUTATION_IMPACT`,
which could be read as one state or two. It is modelled as one, `REVIEW`, because the review and
its reputation effect resolve together in a single step — there is no interval during which a
party is post-review but pre-impact, so a second state would have no observable duration and
nothing could ever be seen in it.
