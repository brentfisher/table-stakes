# Proposal — Real per-tick district movement and full-population rendering

## Why

A player reported "it seems like [customers] just show up at yours." Investigation
(STORY-044) found two real gaps behind that report, not one: `customer-system.js` sets
`party.position` by direct jump-assignment at each of §17's decision points — there is no
per-tick integration, so no party actually walks, even one that ends up rendered — and
`GameClient.ts` filters `match.customers` to `c.restaurantId === restaurantId` before ever
reconciling through `EntityViewRegistry`, so a party still deciding (`restaurantId` not yet
assigned) or one that chose the rival never renders at all. STORY-045 (Peek extension) and
STORY-046 (crowd density tuning) both depend on the population this change makes visible.

## What Changes

- `customer-system.js`: every direct `party.position = {...}` jump (five call sites —
  `spawnParty`'s birth position stays instant; `collectPayment`, `sendToRestaurant`,
  `tryToSeat`, `exitParty`, and the `PAYING`-state inline duplicate of `collectPayment`) is
  replaced by a `party.destinationPosition` field, recomputed fresh every tick from
  `party.state` by a new `computeDestination` dispatcher, and integrated into
  `party.position` every tick by `worker-system.js`'s promoted `stepToward`. The state
  machine's own timers (`msInState` thresholds) are untouched — movement is a cosmetic layer
  on top, exactly like a worker's task assignment is instant while only its walk takes time.
- `computeDestination` also fixes two visual pileup/zero-delta bugs found while implementing
  the above (not just "set once at the decision"): parties still deciding are spread around
  the district entrance instead of stacking on one point, and every "done with the floor"
  party (LEAVING, or any of the five exit states) walks to a new, genuinely distinct
  `state.exitPosition` landmark rather than back onto its own current position.
- `worker-system.js#stepToward` is promoted from a private, worker-only helper to a real
  top-level export (the same justified-promotion move Decision 67/STORY-043 made for
  `compareTickets`), generalized to accept `speed`/`arrivalEpsilon` parameters (defaulting to
  the existing worker constants, so every existing call site is unchanged) and renamed
  `worker` -> `entity` to match its second caller.
- `shared/constants/tuning.js`: three new tunables — `CUSTOMER_MOVE_SPEED`,
  `CUSTOMER_ARRIVAL_EPSILON`, `CUSTOMER_EXIT_OFFSET` — the first-ever named customer
  movement speed (`WORKER_MOVE_SPEED`/`OWNER_MOVE_SPEED` were the only precedents).
- `shared/schemas/game-state.js`/`.d.ts`: new `CUSTOMER_FLOOR_BOUND_STATES`/
  `isFloorBoundState`, alongside the existing `CUSTOMER_EXIT_STATES`/`isExitState` — the
  states that occupy restaurant-SPECIFIC floor space (a queue slot or a table) as opposed to
  genuinely shared district space.
- New `shared/game-logic/district-population.js` (+ `.d.ts`): `shouldRenderCustomerForViewer`,
  the one predicate deciding whether a customer snapshot belongs on a given viewer's floor —
  dual-imported by `GameClient.ts` and the new check script (Decision 4's plain-JS-plus-`.d.ts`
  shape, the same reasoning `hud-alerts.js`/`hud-cash-feedback.js` already establish).
- `client/src/game/GameClient.ts`: the `customers` filter feeding `EntityViewRegistry`'s
  `'customers'` reconcile is widened from a bare `restaurantId` equality check to
  `shouldRenderCustomerForViewer` — an OR added, not a removal (a party actually
  queued/seated at the rival stays excluded, exactly as before, since both restaurants share
  one `restaurant-layout.json`'s table/queue coordinates). **BREAKING**: none — purely
  additive to what renders; no wire shape changes.
- New `scripts/check-district-population.mjs`: proves position changes across consecutive
  ticks toward a real destination (not jump-then-static) for the queue approach, the seating
  walk, and the exit walk; proves the render predicate's inclusion/exclusion on both synthetic
  snapshots and a real match's own `match.customers` wire shape; proves the tuning comment's
  worst-case-exit-distance arithmetic against the real layout file.

## Capabilities

- **New Capabilities**: `district-population-movement` — real per-tick district movement
  (destination/position split, `stepToward` integration) and the widened, viewer-scoped
  rendering of the full shared-district customer population, described above.
- **Modified Capabilities**: none. `customer-acquisition`'s (`shared-district-choice`)
  requirements — the softmax choice model itself — are untouched; this change only adds
  movement and rendering for states that model already produces.

## Impact

- `server/src/game/systems/customer-system.js` — destination/position split,
  `computeDestination`, `spreadAcrossCandidates`, `state.exitPosition`.
- `server/src/game/systems/worker-system.js` — `stepToward` promoted to a real export.
- `shared/constants/tuning.js` — three new tunables.
- `shared/schemas/game-state.js`, `shared/schemas/game-state.d.ts` — new state classification.
- `shared/game-logic/district-population.js` (new), `.d.ts` (new) — the render predicate.
- `client/src/game/GameClient.ts` — widened `customers` filter.
- `scripts/check-district-population.mjs` (new), `package.json` — new check wired into
  `npm run check`.
- No new runtime dependency, no wire-shape change, no database (none exists), no change to
  any other capability's requirements.
