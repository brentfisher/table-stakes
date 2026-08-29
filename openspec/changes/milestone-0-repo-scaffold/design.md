# Design — Milestone 0

These are the decisions later work must preserve or explicitly supersede. Each is stated so a
future change can cite it by heading.

## Decision 1 — Three.js is CDN-loaded through a pinned import map, never bundled

PRD §13 requires it and §22 makes it a pass/fail acceptance criterion.

`THREE_VERSION` in `shared/constants/tuning.js` is the single source of truth. Both
`client/index.html` and `harnesses/index.html` carry an import map pinning `three` **and**
`three/addons/` to that exact version on the same CDN (jsDelivr); mixing versions or CDNs
breaks addon compatibility. Vite marks `three` external, so the built bundle keeps `from"three"`
as a bare specifier for the browser to resolve.

**`@types/three` is an allowed devDependency, pinned to exactly `THREE_VERSION`.** Types are
erased at compile time and never reach the bundle, so this does not violate the "not bundled"
rule, but a version mismatch would mean the types describe a different library than the browser
loads. `scripts/check-threejs-pin.mjs` enforces both halves: no `three` runtime dependency
anywhere, and an exact `@types/three` version match.

Changing the pinned version means editing `tuning.js`, both import maps, and the `@types/three`
pin together, then running `npm run check:three`.

## Decision 2 — The server is authoritative; clients send intent only

PRD §12. The browser is never trusted to compute money, customer choice, scores, inventory,
upgrades or action outcomes. Clients send `player_input` and (later) `interact` as *intent*;
the server integrates, clamps, and broadcasts. Milestone 0's instance of this is position
clamping to `RESTAURANT_BOUNDS`, verified by `scripts/smoke-milestone0.mjs`: an intent of
`{x: 999, z: 999}` cannot produce an out-of-bounds broadcast position.

Every later story that adds a player action must route it through
`server/src/game/validators/action-validator.js` rather than mutating match state directly.

## Decision 3 — Simulate at 20 Hz, broadcast at 10 Hz, interpolate on the client

PRD §12 "Tick target" allows 10–20 Hz simulation and 10 Hz broadcast. Both rates are named
constants in `shared/constants/tuning.js`. `StateInterpolator` buffers snapshots and renders on
a ~110 ms playback delay — the standard trade of about one broadcast interval of latency for
smooth motion. Deliberately **not** rollback netcode; PRD §12 says not to over-engineer it.

Later systems register against `simulation-loop.js` rather than starting timers of their own.

## Decision 4 — The server is plain JavaScript; the client, harnesses and schemas are TypeScript

PRD §13 requires a vanilla Express JavaScript app. Shared modules the server imports are
therefore authored as `.js` with a sibling `.d.ts` (`tuning.js`/`tuning.d.ts`,
`messages.js`/`messages.d.ts`) so the server never has to compile TypeScript while the client
still gets types. STORY-002's `validation` module must follow the same pattern.

Note this supersedes the PRD §13 file listing, which names `shared/constants/tuning.ts` and
`shared/schemas/messages.ts`. The `.ts` extension there is incompatible with the same
document's requirement that the server be plain JavaScript; the `.js` + `.d.ts` pair satisfies
both halves and is the pattern the PRD itself implies for `validation.ts`.

## Decision 5 — Rules emit state; scene-view code renders state

PRD §15. `RestaurantScene` takes a layout and a render state and produces Three.js objects; it
contains no networking and no game rules. This is what lets `harnesses/` mount the real scene
with mocked state and no backend, and it is the constraint that makes all five PRD §15
harnesses possible. A view module that reads simulation internals breaks every harness.

Relatedly (PRD §13 "React responsibilities"): React mounts the scene container once and
re-renders only on the low-frequency status callback. It must never reconcile Three.js entities
as JSX state per simulation tick.

## Decision 6 — Matches are seeded and reproducible

PRD §9/§12/§22. `server/src/game/rng.js` provides a mulberry32 stream hashed from a string
seed; match configuration is drawn from it. The same seed produces the same configuration.
STORY-011's event deck must draw from this same seeded stream so both players receive an
identical event timeline. With no test framework in the repo, reproducibility is the primary
debugging affordance.

## Decision 7 — Unimplemented message types are rejected, not ignored

`shared/schemas/messages.js` declares the full MVP protocol now but exports
`IMPLEMENTED_CLIENT_MESSAGE_TYPES` separately. The router answers a declared-but-unimplemented
type with `{type: 'error', error: 'not_implemented'}`. Declaring the whole vocabulary up front
means STORY-002 widens validators rather than renaming anything; rejecting loudly means a
client bug never presents as silent inaction.

## Decision 8 — Verification is by runnable scripts and harnesses, not a test framework

The PRD names no test framework and none is installed. `scripts/check-threejs-pin.mjs` and
`scripts/smoke-milestone0.mjs` are the executable acceptance checks for this change, and the
PRD §15 harnesses are the visual ones. A later change may introduce a test framework; until
then, story acceptance criteria must be checkable by diff review, by running the app, or by a
scratch script.
