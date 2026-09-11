---
id: STORY-040
title: No automated staff in co-op mode; lock staff-only upgrades
status: pr-opened
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: story/040-coop-no-automated-staff
worktree_path: /Users/brent/table-stakes-story-040
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/60
is_architectural: true
approach_summary: >
  A co-op restaurant (STORY-039's `sharedRestaurant: true`, resolved via `match.restaurantIdFor`)
  gets an EMPTY `staffAssignments`/roster instead of the mandatory cook/server/host roster every
  other mode requires. `worker-system.js#buildStaff` produces zero workers for it (already
  correctly no-ops downstream via the existing `match.brigade?.owns*()` defensive checks — no
  changes needed there). The real work is upstream: `ready-up-menu.js#buildReadyUpPayload`
  building an empty `staffAssignments` for co-op instead of `rosterOf(layout).map(...)`, and
  `setup-validator.js`'s `worker_unassigned` check not firing when there's nothing to assign.
  Then an audit of `upgrades.json`/`upgrade-system.js#KNOWN_EFFECT_KEYS` for any staff-only
  effects, locked in `UpgradeTerminal` for co-op with a stated reason.
created: 2026-09-10
updated: 2026-09-11
---

# No automated staff in co-op mode; lock staff-only upgrades

In every existing mode, `worker-system.js` runs a cook/server/host roster
(`restaurant-layout.json`'s `staff.roster`) that automates 60-75% of routine work (PRD §24). In
co-op mode (STORY-039), there is no roster at all — the two players ARE the staff, and must
personally seat parties, take orders, deliver food, clear tables, and cook.

`worker-system.js` and every system that asks `match.brigade?.owns*()` before falling back to an
abstraction (see that file's own header, "WHAT THE WORKERS TOOK OVER, AND WHAT STAYED
ABSTRACTED") already no-ops correctly for a restaurant with no roster — this story's job is
making sure a co-op restaurant genuinely has none, and that the setup flow (three-stage ready-up
menu, `shared/game-logic/ready-up-menu.js`) doesn't try to assign staff posts that don't exist.

## Acceptance Criteria

- [x] A co-op restaurant's `staffAssignments`/roster is empty — `worker-system.js#buildStaff`
  produces zero workers for it, and `match.brigade.owns*()` returns `false` for every duty
  (seating, order-taking, delivery, table-clearing, restocking) for that restaurant.
- [x] The ready-up flow (`ready-up-menu.js#buildReadyUpPayload`, `SetupScreen.tsx`) does not
  present or require staff assignment for a co-op match — it currently builds `staffAssignments`
  generically via `rosterOf(layout).map(...)`, which needs a co-op-aware branch (empty roster in,
  empty assignments out) rather than crashing or silently assigning phantom posts.
- [x] `setup-validator.js`'s `worker_unassigned` rejection does not fire for a co-op submission
  with no roster to assign.
- [x] Every §17-abstracted fallback each `owns*()`-gated system uses when unbrigaded (customer
  seating auto-resolves, order pass hand-off teleports, table clearing/payment collection
  auto-resolve, restocking auto-dispatches) is exercised and confirmed correct for a co-op
  restaurant — i.e. co-op without a human doing a given job should behave exactly like an
  unstaffed restaurant already does today, not silently freeze.
- [x] Upgrades whose effect ONLY matters with automated staff (audit `upgrade-system.js`'s
  `KNOWN_EFFECT_KEYS` and `upgrades.json` for any staff-throughput-specific entries — as of this
  writing the shipped MVP set is mostly player-usable: Serving Tray raises the PLAYER's own carry
  capacity, Faster Grill/Pantry Shelves/Better Seating help regardless of who's cooking/seating)
  are locked in the upgrade terminal UI (`UpgradeTerminal` component) with a stated reason ("no
  staff to upgrade"), not simply hidden — the player should understand why, not wonder if it's a
  bug.

## Notes

- Depends on STORY-039 (co-op mode must exist first).
- Cites: `server/src/game/systems/worker-system.js` header comment, "WHAT THE WORKERS TOOK OVER,
  AND WHAT STAYED ABSTRACTED" — this story PRESERVES that fallback design entirely; a co-op
  restaurant is simply always in the "no brigade" branch every one of those systems already has.
- Cites: `shared/game-data/restaurant-layout.json` `staff._comment` — the roster is currently
  MANDATORY for every match (`setup-validator.js` rejects a submission missing any roster
  worker's post). This story is the first case where "no roster" is a legal, intentional state,
  which needs an explicit mode check rather than an accidental bypass.
- The actual AUDIT of which upgrades are staff-only (last AC) should be done against the real
  current `upgrades.json` at implementation time, not assumed from this story's own guess above.

## Implementation notes

**Roster/fallback implementation.** `worker-system.js#buildStaff(match, player)` now returns
`workers: []` when `match.sharedRestaurant` is true (module-level `ROSTER` — read once from
`restaurant-layout.json` — is untouched; the gate is on the match, not the layout, since
`sharedRestaurant` is set match-wide and never mixed with a rostered restaurant in one match).
`shared/game-logic/ready-up-menu.js#buildReadyUpPayload` and every layer of
`server/src/game/validators/setup-validator.js` (`validateSetupSubmission`,
`acceptSetupSubmission`, `defaultSubmission`) gained a `sharedRestaurant` option (default
`false`, so every pre-existing mode is byte-identical): empty roster in, empty
`staffAssignments` out, and the `worker_unassigned` rejection is skipped entirely for a co-op
submission rather than loosened. `match_snapshot` gained a public, non-`you`-scoped
`sharedRestaurant` field so the client (`SetupScreen.tsx`, `UpgradeTerminal.tsx`) can read it.
Full reasoning and a Mermaid sequence diagram: `openspec/changes/coop-no-staff/design.md`
(Decisions 63-66).

**Upgrade audit — what got locked and why.** All ten `upgrade-system.js#KNOWN_EFFECT_KEYS`-wired
upgrades were traced to their actual read site (the other six `upgrades.json` entries —
`prep_counter_1`, `server_radio_1`, `additional_table_1`, `maintenance_plan_1`,
`complimentary_snacks_1` — are already `effect_not_implemented` for every mode, not a co-op
question, and already excluded from `UpgradeTerminal` by its own `WIRED_UPGRADE_IDS` filter).
Exactly one is staff-only: **`maitre_d_radio_1`** (`serverSeatingDurationMultiplier`) is read in
exactly one place — `worker-system.js`'s automated server/host `seat_party` task duration —
never by the owner's own manual "Seat Party" interact. In co-op that task never runs, so the
multiplier applies to nothing: a legal purchase that would spend real cash for zero effect.
Locked in `UpgradeTerminal.tsx` via a new `STAFF_ONLY_UPGRADE_IDS` list (`GameClient.ts`),
rendering a disabled "No staff to upgrade" button (with an explanatory `title`) instead of a Buy
button, when `status.sharedRestaurant` is true. The purchase stays legal server-side — this is a
UI-communication fix, not a new match-legality rule (design.md Decision 65 spells out why that's
the right line). Confirmed `maitre_d_radio_1`'s only OTHER appearance, `GameClient.ts`'s
`FRONT_DOOR_UPGRADE_IDS`, is read only by `HudPanel.tsx`/`TacticalOverviewPanel.tsx` to badge
already-owned upgrades — never a second purchase affordance — so the terminal's lock is not
bypassable. Every other wired upgrade (Serving Tray I/II, Faster Grill, Better Seating, Pantry
Shelves, Host Stand Toolkit, Street Chalkboard, Queue Pager, Guest Recovery Kit, Window Display)
was confirmed to help the player directly regardless of staffing — station speed/concurrency are
equipment properties, patience/queue/recovery/front-door multipliers are customer- or
player-triggered, and `pantry_shelves_1`'s restock-travel discount applies to the OWNER's own
manual restock too (`inventory-system.js#restockDurationMs`'s own comment: "the call STORY-007's
worker and STORY-008's owner both make") — so none of them are locked. `server_radio_1`
(`serverTargetingQuality`) is equally staff-only by description but has no live effect yet;
noted in both `design.md` and a comment beside `STAFF_ONLY_UPGRADE_IDS` so whoever wires it adds
it to that list in the same change.

**`owns*()` fallback verification — exercised, not just inspected.** Every fallback was proven
against a real, running co-op `Match` in `scripts/check-coop-no-staff.mjs` (new, wired into
`npm run check` as `check:coop-no-staff`), using the same `plantParty`/`plantReadyOrder`
direct-state-injection technique `check-workers.mjs` uses to force a scenario deterministically:

- **Zero workers / all `owns*()` false**: `match._workerSimState.restaurants.get(sharedId)
  .workers.length === 0`; `ownsSeating`/`ownsDelivery`/`ownsOrderTaking`/`ownsPayment`/
  `ownsTableClearing`/`ownsRestocking`/`ownsStation` all return `false`.
- **Auto seating**: a planted queued party reaches `SEATED` with a real `tableId`
  (observed: `tableId=table_4`) with nobody rostered to seat it.
- **Auto greet/order-taking**: a planted seated party reaches `ORDERING` on its own once
  `CUSTOMER_SEATED_GREET_MS` elapses.
- **Order-pass hand-off**: a planted ready order reaches `state=delivered` after
  `ORDER_PASS_HANDOFF_MS` with no server to carry it.
- **Auto payment collection**: a planted paying party reaches `LEAVING` on its own once
  `CUSTOMER_PAYING_MS` elapses.
- **Table clearing auto-resolves (not "the player clears it")**: the vacated table's
  `dirty` stays `false` and `occupiedBy` returns to `null` immediately — see design.md
  Decision 66: a co-op table is never soiled in the first place (`freeTable` only sets `dirty`
  when `ownsTableClearing` is true), so "Clear Table" is a verb with nothing to act on in co-op.
  This matches the AC's own "behave exactly like an unstaffed restaurant" bar; it is the one
  place this story's "personally... clear tables" framing and the shipped behavior diverge, and
  it's called out explicitly rather than left for a future reader to notice.
- **Auto-dispatched restocking**: forcing a bin to 0 with pantry stock available produces a
  real restock job (observed: `jobs=[{"ingredientId":"beef","station":"prep"}]`) with nobody to
  walk it.
- **Full production lifecycle**: a separate co-op match registered with
  `systems/index.js#registerAllSystems()` (not the script's own hand-picked subset) runs
  `service -> results` with no throw and a sane one-entry scoring result for the shared
  restaurant. This specifically covers `workerSystem.onPhaseChange`'s own teardown/balance-log
  loop formatting an empty `workers[]` — `workers: []` coexisting with a REGISTERED
  `workerSystem` is a state combination that did not exist before this story (the prior
  "unstaffed" case was the system never being registered at all, so its `onPhaseChange` never
  ran).
- **Regressions**: a non-coop restaurant still gets its full 3-worker roster and every
  `owns*()` true; `validateSetupSubmission`/`defaultSubmission` without `sharedRestaurant` still
  require and fill every roster post.

`npm run check` is fully green (20/20 in the new script; every other `check:*` unaffected),
including `build:client`/`build:harnesses`.
