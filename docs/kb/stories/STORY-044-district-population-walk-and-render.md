---
id: STORY-044
title: Animate the district's full customer population walking to their chosen restaurant, or neither
status: pr-opened
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: story/044-district-population-walk-and-render
worktree_path: /Users/brent/table-stakes-story-044
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/63
is_architectural: true
approach_summary: >
  Two real gaps, confirmed by direct inspection, matching the story's own two-part framing.
  MOVEMENT: `customer-system.js` sets `party.position` by direct assignment at exactly five call
  sites — `spawnParty` (~line 541, the party's birth position, correctly instant, leave as-is),
  `collectPayment` (~line 388, jump to `state.entryPosition` on LEAVING), `sendToRestaurant`
  (~line 955, jump to queue position on a restaurant decision), `tryToSeat` (~line 1068, jump to
  table position), and one more exit jump in the `~1220`/`~1386` region (re-verify exact line at
  implementation time — story's own note says these drift). Add a `party.destinationPosition`
  field set at each of those decision points INSTEAD of `party.position` directly, and integrate
  `party.position` toward it every tick inside `advanceParty` (~line 1263, called from the
  registered `customerSystem.update(match, dtMs)`, ~line 1551) using a generalized version of
  `worker-system.js`'s existing `stepToward(worker, target, dtMs)` (~line 740) — that function
  only reads `.position`, so promote/export it (same justified-promotion move as STORY-043's
  `compareTickets`) rather than reimplementing the integration math a second time. A new
  `CUSTOMER_MOVE_SPEED` tunable in `shared/constants/tuning.js` (no existing customer speed
  constant — `WORKER_MOVE_SPEED`/`OWNER_MOVE_SPEED` are the only precedents), with its own
  arrival epsilon mirroring `WORKER_ARRIVAL_EPSILON`. Movement is purely cosmetic and must not
  gate any state-timer transition (`msInState` thresholds stay authoritative, exactly like a
  worker's task assignment is instant while only the walk animation takes time) — decisions
  (queue occupancy, table assignment, money) remain immediate at the moment they're decided, only
  the rendered position catches up over subsequent ticks. RENDERING: `GameClient.ts`'s
  `handleFrame` (~line 827) filters `customers` to `c.restaurantId === restaurantId` BEFORE
  reconciling through `EntityViewRegistry` — confirmed this is why "they just show up": a party
  in `ENTER_DISTRICT`/`EVALUATE_RESTAURANTS` (restaurantId not yet assigned) or `CHOOSE_RIVAL`
  (assigned to the OTHER restaurant) never reaches `upsertCustomer` at all today. Loosen this
  filter to also include district-transit states regardless of `restaurantId` (own decision:
  render them relative to the VIEWER's own restaurant's local space using the shared district
  `entryPosition`/queue landmark both restaurants' layouts already share, not the rival's
  internal table coordinates — table id collision is exactly why the existing filter exists, per
  that code's own comment, so this must add a state-based OR, not remove the restaurantId
  equality check outright). `RestaurantScene.ts#upsertCustomer`/`CustomerRenderState` needs no
  new fields — same real character model, just fed a wider set of customers with real per-tick
  positions instead of a narrower, jump-cut set. `is_architectural: true`: this changes
  customer-system.js's internal position-mutation contract (a cross-cutting behavior change to
  the core district simulation, not just a new snapshot field) and the client's reconciliation
  filter contract — worth an OpenSpec decision trail given how central this system is, even
  though no new wire field is added.
created: 2026-09-10
updated: 2026-09-11
---

# Animate the district's full customer population walking to their chosen restaurant, or neither

Reported: "it seems like [customers] just show up at yours" — the shared district's full customer
population (`shared-district-choice` openspec change, `customer-system.js`) isn't visually
legible. Investigation for this story found TWO gaps, not one:

1. **Rendering**: `match.customers` (`customer-system.js:1558`) already publishes EVERY party in
   EVERY state — `ENTER_DISTRICT`, `EVALUATE_RESTAURANTS`, `CHOOSE_RIVAL`, `LEAVE_DISTRICT`
   included, not just parties already queued/seated at a restaurant (`toPublicCustomerSnapshot`
   has no state filter). The client (`RestaurantScene.ts#upsertCustomer`) likely only renders
   customers once they're meaningfully at a restaurant. This part IS a pure rendering gap.
2. **Movement is NOT currently a real walk**: `party.position` is set directly at specific state
   transitions (`customer-system.js` lines ~382, ~949, ~1062, ~1216, ~1380 as of this writing) —
   there is no per-tick incremental movement for a party crossing the district, unlike the owner/
   worker `stepToward()` model (`worker-system.js`). A party's position JUMPS between states
   rather than walking there. This is why it "just shows up" — that report is accurate, and this
   is a real simulation gap, not only a rendering one.

This story covers both: real per-tick district movement, and rendering every party (including
those who choose neither restaurant) with real character models.

## Acceptance Criteria

- [x] Parties in `ENTER_DISTRICT`/`EVALUATE_RESTAURANTS`/en route to a chosen restaurant or to
  `LEAVE_DISTRICT` move incrementally toward their destination each tick (a `stepToward`-style
  integration against a real move speed), rather than jumping to a new position the instant their
  state changes. Reuse the existing pattern (`worker-system.js#stepToward`) rather than inventing
  a second movement model.
- [x] A party that chooses this restaurant walks visibly toward it; one that chooses the rival's
  walks toward that one; a party in `CHOOSE_RIVAL`/`LEAVE_DISTRICT` (chose neither, or chose the
  rival) is rendered with a real character model — the same `CustomerRenderState`/`upsertCustomer`
  machinery already used for queued/seated customers, not a new proxy type — walking to its actual
  exit, not simply despawning at the decision instant.
- [x] `RestaurantScene.ts#upsertCustomer`/`GameClient.ts`'s `customers` registry reconciliation
  (`EntityViewRegistry`) is extended to spawn/despawn/position district-only customers using their
  real snapshot `position`, the same seam `readyDishes`/`workers` already use.
- [x] `npm run check` — including whatever `check-customers.mjs`/`check-district`-equivalent
  coverage exists — still passes; a check proving district-population movement is real (position
  changes across consecutive ticks pre-decision, not just at decision instants) is added.

## Implementation notes

**OpenSpec.** `is_architectural: true` — `openspec/changes/district-population-movement/` carries
`proposal.md`, `design.md` (Decisions 73-78, continuing the repo's numbering from
`coop-kitchen-queue-board`'s Decision 72, with a Mermaid diagram of the real new components: the
`stepToward` promotion, the `computeDestination` dispatcher, `state.exitPosition`, the
`shouldRenderCustomerForViewer` predicate, and the widened `GameClient.ts` filter), `tasks.md`,
and a delta spec at `specs/district-population-movement/spec.md`. `openspec validate
district-population-movement --strict` passes.

**AC1/movement — the five jump sites, re-verified.** Grepping fresh (not trusting the
approach_summary's line numbers, as its own note warned) found exactly five `party.position =
{...}` assignments after the object-literal birth position in `spawnParty`:
`collectPayment`(`floor` facade), `sendToRestaurant`, `tryToSeat`, `exitParty`, and a
`PAYING`-state inline duplicate of `collectPayment`'s own three lines (the approach_summary had
rounded these last two together as "one more exit jump in the ~1220/~1386 region" — they are two
distinct call sites doing the same thing on two different code paths, both needed the identical
edit). All five now set nothing — position is untouched by every §17 decision point.
`worker-system.js#stepToward` is promoted to a real export (`export function stepToward(entity,
target, dtMs, speed = WORKER_MOVE_SPEED, arrivalEpsilon = WORKER_ARRIVAL_EPSILON)`), the same
justified-promotion move Decision 67/STORY-043 made for `compareTickets`; `_internal.stepToward`
still points at the same reference, and `check-workers.mjs` (59/59, including its determinism
check) confirms nothing about worker travel changed.

**AC1 — the design changed mid-implementation, and why (design.md Decision 74).** The
approach_summary's own plan — set `party.destinationPosition` once at each of the five decision
points, mirroring exactly where `party.position` used to be written — was tried first and
rejected for two real bugs, not a style preference: (1) `queueDisplayPosition`'s existing queue
formation already reshuffles live as parties ahead get seated; a destination set once at
`sendToRestaurant` would freeze a queued party at a slot that stops existing the moment the line
moves. (2) The sharper case: a party that spawns, evaluates, and leaves via `LEAVE_DISTRICT`
never moves before that decision — under "set once", its only destination write (back to
`state.entryPosition`, the pre-existing convention) would exactly equal its own current position.
Zero delta. That is indistinguishable from the instant-despawn bug this story exists to fix, and
it is the specific case a purely "did it get a destinationPosition field" implementation would
have missed while still checking the literal instruction's box. The actual fix:
`computeDestination(match, state, party)` is called unconditionally at the end of `advanceParty`,
recomputing the destination fresh from `party.state` EVERY tick (not just at the decision) —
the five decision-point functions no longer touch position at all, and a new district-wide
`state.exitPosition` landmark (derived from `entryPosition`/`queuePosition` and a new
`CUSTOMER_EXIT_OFFSET` tunable, continuing outward along the line the party arrived on) makes
every exit ("chose neither", `ABANDON_QUEUE`, `CANCEL_ORDER`, `LEAVE_ANGRY`, and the ordinary
paid-and-`LEAVING` path) a real, non-zero walk. `scripts/check-district-population.mjs` section 3
asserts the LEAVE_DISTRICT case directly.

**AC1 — pileup, also fixed.** Widening the client filter (AC2 below) means several
still-deciding parties can now be visible at once near the district entrance; recomputing the
destination every tick also let `queueDisplayPosition`'s existing "four across, one row back"
grid formation generalize into `spreadAcrossCandidates(candidates, party, anchor)`, reused for
the entrance-loiter cluster and the exit cluster too (not three bespoke formulas) — see
design.md Decision 75. `queueDisplayPosition` itself is unchanged externally (still called with
`(state, party)`, same output), confirmed by `check-district-choice.mjs`/
`check-customer-lifecycle.mjs` both passing unmodified.

**AC1 — `CUSTOMER_MOVE_SPEED` (design.md Decision 76).** Not derived from `WORKER_MOVE_SPEED`
(that constant is tuned against `OWNER_TASK_SPEED_ADVANTAGE`, a balance dial with nothing to do
with a customer). Picked instead against this layout's own worst case: the farthest table sits
~13.45 units from `spawn.customerEntry`, and a party leaving it must clear that distance inside
`CUSTOMER_LEAVING_MS + CUSTOMER_EXIT_LINGER_MS` (3.5s) or `cleanupExitedParties` removes it
mid-stride. `4.0` units/second clears it in ~3.36s — real but not huge margin — and reads as
roughly the same brisk-but-unhurried pace as `WORKER_MOVE_SPEED` (3.36)/`OWNER_MOVE_SPEED` (4.2).
`check-district-population.mjs`'s final section asserts this arithmetic against the real layout
file rather than leaving it as an unchecked comment. `CUSTOMER_ARRIVAL_EPSILON` mirrors
`WORKER_ARRIVAL_EPSILON` (0.35) at the same magnitude.

**AC2/AC3 — the render filter, and the `CHOOSE_RIVAL` discovery.** `GameClient.ts`'s customer
filter is widened from `c.restaurantId === restaurantId` to
`shouldRenderCustomerForViewer(c, restaurantId)` — a new dual-imported predicate
(`shared/game-logic/district-population.js` + `.d.ts`, the same plain-JS-plus-`.d.ts` shape
`hud-alerts.js`/`hud-cash-feedback.js` already establish, imported identically by `GameClient.ts`
and the new check script so the two can never quietly diverge): `customer.restaurantId ===
viewerRestaurantId || !isFloorBoundState(customer.state)`. `isFloorBoundState` (new, alongside
the existing `isExitState` in `shared/schemas/game-state.js`) names exactly the states that read
a restaurant-SPECIFIC queue slot or table (`APPROACH_OR_QUEUE`/`SEATED`/`ORDERING`/
`WAITING_FOR_FOOD`/`EATING`/`PAYING`); everything else — including `LEAVING`/`REVIEW` and all
five exit states, not only `LEAVE_DISTRICT` — now walks through genuinely shared district space
and renders for either viewer. This is a strictly-added OR: the original `restaurantId` equality
check is never removed, so a party actually queued/seated at the rival stays excluded exactly as
before (both restaurants share one `restaurant-layout.json`'s literal table/queue coordinates —
the original filter's own documented reason).

One discrepancy from the story's own text, discovered while implementing: `CHOOSE_RIVAL` is
never a real `party.state` — `customer-system.js#buildRestaurantView`'s own pre-existing comment
says so directly ("no party is ever in state CHOOSE_RIVAL... it is counted here, against the
restaurant that lost it"), confirmed by grepping every assignment to `party.state` in the file. A
party that "chooses the rival" simply gets `restaurantId = <rival>` and proceeds through the
ordinary `APPROACH_OR_QUEUE` funnel at that restaurant — indistinguishable, state-machine-wise,
from choosing the viewer's own restaurant. `isFloorBoundState` still keeps `CHOOSE_RIVAL` out of
its floor-bound list (so it would fall through as "shared" if a future story ever made it real),
and `check-district-population.mjs` documents this directly rather than silently working around
it. AC2's "one that chooses the rival's walks toward that one" is satisfied symmetrically: from
the RIVAL's OWN viewer, that exact party already renders walking to ITS queue via the ordinary
(now-widened) path — not by rendering a second, remapped copy of the rival's population on this
viewer's own screen.

**AC2 — a real alternative considered and rejected (design.md Decision 77).**
`RestaurantScene.ts#upsertOwner` already solves the identical table/queue-coordinate-collision
problem for the rival OWNER avatar, remapping its local coordinates onto `buildCompetitor`'s
decorative shell footprint (`rivalWorldPosition`). Extending that same remap to
`CustomerRenderState` (a new `remapToRivalFloor` field, mirroring `OwnerRenderState`'s) would let
a rival-bound party render arriving, queueing, and sitting at the rival's own shell — a more
literal reading of AC2's rival clause. Seriously considered, then rejected: it is a bigger surface
than a two-viewer district needs (see the symmetric-viewers reasoning above), and per the story's
own instruction to "confirm [`CustomerRenderState`] needs no NEW fields" before adding any — which
this design honors. If a later story (STORY-045's Peek extension, or STORY-046) wants the rival's
full individually-walking population rendered on the OTHER viewer's own screen,
`upsertOwner`'s existing precedent is exactly where to reach for it; deliberately not built here.

**AC3 — `RestaurantScene.ts` needs no changes.** Confirmed by reading `upsertCustomer` and
`CustomerRenderState` directly: `CustomerRenderState` carries no `state` field at all (only
`customerId`/`position`/`partySize`/`orderLabel`/`patienceRemaining`/`unhappy`/`segmentId`), and
`upsertCustomer` already handles any position/state combination generically (missing `orderLabel`
degrades to no speech bubble, `patienceRemaining` reads 1.0 for a pre-decision party since
patience only decays in `PATIENCE_DECAYING_STATES`). No edit was made to this file.

**New check script: `scripts/check-district-population.mjs`.** 23 checks, direct `_internal`
calls against a real two-restaurant `Match` (same house pattern as `check-district-choice.mjs`):
per-tick position deltas (never a single-tick snap) for the queue approach and the seating walk;
the LEAVE_DISTRICT zero-delta case from Decision 74, proven directly; two simultaneously-loitering
parties getting different destinations (the pileup fix); `shouldRenderCustomerForViewer` across
eight synthetic state/restaurantId/viewer combinations; the same predicate applied to a REAL
match's own `match.customers` wire shape (not only synthetic objects); and the
`CUSTOMER_MOVE_SPEED`-vs-worst-case-exit-distance arithmetic measured against the real layout
file. One test-setup subtlety worth recording: without a registered `workerSystem`,
`advanceParty`'s own pre-existing automatic-seating fallback (`if (!match.brigade?.ownsSeating
(...)) tryToSeat(...)`) fires on the very first tick a party is forced into `APPROACH_OR_QUEUE` —
the queue-walk section pre-occupies every table so the party stays genuinely queued for the
observation window, the same forcing discipline `check-customer-lifecycle.mjs` already uses
elsewhere. Wired into `package.json` as `check:district-population`, in the `npm run check` chain
(after `check:district`).

**Falsified per house rule (both probes, both outcomes recorded).** (1) Movement: commented out
the `stepToward(...)` call at the end of `advanceParty` (replaced with `void stepToward;`).
Re-ran the check: 7 of 23 FAILED exactly as expected — every movement-delta/arrival assertion
(queue walk, table walk, LEAVE_DISTRICT walk) — while every `shouldRenderCustomerForViewer`
assertion still passed (16/23 passed). Restored the exact original two-line block. (2) Rendering:
reverted `shouldRenderCustomerForViewer` to the pre-story `customer.restaurantId ===
viewerRestaurantId` equality only. Re-ran the check: 5 of 23 FAILED exactly as expected — the four
"still visible to either viewer" synthetic cases and the real-match "p2 would render the
still-deciding party" case — while every movement assertion and the rival-exclusion cases still
passed (18/23 passed). Restored the exact original one-line return. Re-ran after both restores:
23/23 passed, and `grep -rn "FALSIFICATION"` across the repo confirmed no probe text was left
behind.

**Verification.** `npm run install:all` (fresh worktree, no `node_modules`). `npm run build:client`
type-checks and builds clean with no new fields on any existing type. Full `npm run check` — every
`check-*.mjs` script (60 total, including the two new sections above), both builds, and the smoke
suites — passes green: `974` total `ok` lines, zero `FAIL` lines, exit code `0`, run twice end to
end. `check-district-choice.mjs` (45/45), `check-customer-lifecycle.mjs` (24/24), and
`check-workers.mjs` (59/59, including its own determinism check) were run individually first to
confirm the destination/position split and the `stepToward` promotion changed no OTHER system's
observable behavior, before the full chain.

**Honest visual-verification limitation** (same as prior stories in this system): this
environment's browser automation cannot run the WebGL render loop
(`document.visibilityState` reports `hidden` in the automated Chrome tab, blocking
`requestAnimationFrame`), so the actual on-screen walk — the entrance loiter, the queue approach,
the seating cross, the exit — was never screenshotted or visually confirmed live. Verification
here is type-checking, the real-`Match` check script (direct position-delta assertions across
consecutive ticks), and the falsify/restore cycle above — not a live render.

## Notes

- Independent of Part A (co-op mode) — no dependency either direction.
- Cites: `openspec/changes/shared-district-choice/proposal.md` — this story PRESERVES the choice
  model itself (softmax over scored candidates, STORY-010) entirely; it only adds real movement
  and rendering for states the model already produces. Do not touch the decision math.
- Cites: `server/src/game/systems/customer-system.js` line numbers above are AS OF THIS WRITING
  (2026-09-10) — re-verify against current `git blame`/line numbers at implementation time, they
  will drift.
- STORY-045 (Peek extension) and STORY-046 (crowd density tuning) both depend on this story
  landing first — they read the population this story makes visible.
