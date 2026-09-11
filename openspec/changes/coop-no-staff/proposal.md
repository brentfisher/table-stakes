# No automated staff in co-op mode; lock staff-only upgrades

## Why

STORY-039 (`coop-match-mode`, merged) gave two players ONE shared restaurant
(`Match#sharedRestaurant`/`restaurantIdFor`), but explicitly left every internal gameplay system
— including `worker-system.js` — untouched (that change's own Decision 60). Today a co-op
restaurant still gets the full mandatory `cook_1`/`server_1`/`host_1` roster
`restaurant-layout.json` requires of every match, which is wrong for co-op on its own terms: PRD-
co-op-mode-and-district-crowds's premise is that the two PLAYERS are the entire staff — they
personally seat parties, take orders, run plates, clear tables, and cook. A co-op restaurant with
automated workers isn't co-op with helpers, it's co-op with nothing left for the players to do.

This corresponds to STORY-040 in the slicing pass.

## Why This Is Not A Rewrite

`worker-system.js`'s own header ("WHAT THE WORKERS TOOK OVER, AND WHAT STAYED ABSTRACTED")
already documents that every system it decorates — `order-system.js`'s delivery hand-off,
`customer-system.js`'s seating/greet/payment/table-soiling, `inventory-system.js`'s restock
trigger — asks `match.brigade?.owns*()` before falling back to the exact abstraction the match
ran on before `worker-system.js` (STORY-007) existed. A restaurant with zero rostered workers
already takes that fallback branch correctly today (it is how a match with `workerSystem` not
registered at all still behaves, and several check scripts rely on exactly that). This change's
entire job is making a co-op restaurant's roster GENUINELY empty and making the setup flow that
feeds it stop treating "every roster worker needs a post" as a universal rule — not building a
new fallback mechanism.

## What Changes

- **`server/src/game/systems/worker-system.js#buildStaff`**: gated on `match.sharedRestaurant`
  — `workers: []` for a co-op restaurant instead of one entry per `restaurant-layout.json`
  `staff.roster` member. Every `match.brigade.owns*()` question this file answers already
  reduces to `false` for an empty `workers[]` array; nothing else in this file changes.
- **`shared/game-logic/ready-up-menu.js#buildReadyUpPayload`**: new `sharedRestaurant` param
  (default `false`). When `true`, `staffAssignments` is `{}` instead of one post per roster
  worker.
- **`server/src/game/validators/setup-validator.js`**: `validateSetupSubmission` reads a new
  `sharedRestaurant` option and skips the "every roster worker needs a post" legality check
  (`worker_unassigned`) entirely for a co-op submission, storing `staffAssignments: {}`
  regardless of what the client sent (defense in depth — `buildStaff` above ignores this object
  entirely for a co-op restaurant either way). `acceptSetupSubmission` derives the option from
  `match.sharedRestaurant` directly, so `message-router.js` needs no change. `defaultSubmission`
  (the idle-player fallback `setup-system.js` uses at the setup -> service boundary) takes the
  same option, threaded from `match.sharedRestaurant`.
- **Wire/client**: `match_snapshot` gets a new public `sharedRestaurant` field
  (`Match#sharedRestaurant`, identical for both co-op seats — see design.md Decision 64 for why
  it is not under `you`). `SetupScreen.tsx` passes it into `buildReadyUpPayload`.
- **`client/src/ui/UpgradeTerminal.tsx`**: locks the one audited staff-only upgrade
  (`maitre_d_radio_1` — `serverSeatingDurationMultiplier`, read exclusively by the automated
  SERVER's seat-party task duration in `worker-system.js`) with a stated reason ("No staff to
  upgrade") when `sharedRestaurant` is true, instead of a plain disabled/hidden button. Every
  other wired upgrade was checked against its own read site and found to help the player
  directly regardless of staffing (see design.md Decision 65 for the full audit).

## Non-Goals

- Rewriting `worker-system.js`'s per-restaurant bucket construction, or any of the systems
  `coop-match-mode`'s Decision 60 already left untouched, to be genuinely N-player-shared. A
  co-op restaurant simply always takes the `workers: []` branch those systems already handle.
- A kitchen queue board, timed-cooking UI, or any UI affordance beyond the upgrade terminal's
  lock — those are later stories in the PRD's co-op slice (STORY-041+).
- Un-wiring or removing any of the upgrades not audited as staff-only; every one of them stays
  exactly as purchasable in co-op as in any other mode.

## Capabilities

### New Capabilities

- `coop-no-staff`: a co-op restaurant's roster is empty end to end (builder, validator, live
  worker system), every `owns*()` fallback is exercised for it, and the one staff-only upgrade is
  locked with a stated reason.

### Modified Capabilities

(none — this change extends `coop-match-mode`'s `sharedRestaurant`/`restaurantIdFor` seam and
`worker-system.js`'s own pre-existing no-brigade fallback design; neither is being revised)

## Impact

- `server/src/game/systems/worker-system.js` (`buildStaff` gated on `match.sharedRestaurant`)
- `shared/game-logic/ready-up-menu.js`, `ready-up-menu.d.ts` (`sharedRestaurant` param)
- `server/src/game/validators/setup-validator.js` (`validateSetupSubmission`,
  `acceptSetupSubmission`, `defaultSubmission` all co-op-aware)
- `server/src/game/systems/setup-system.js` (`defaultSubmission` call threads
  `match.sharedRestaurant`)
- `server/src/game/match.js` (`toSnapshot` publishes top-level `sharedRestaurant`)
- `shared/schemas/messages.d.ts` (`MatchSnapshotMessage.sharedRestaurant`)
- `client/src/game/GameClient.ts` (`GameClientStatus.sharedRestaurant`,
  `STAFF_ONLY_UPGRADE_IDS`)
- `client/src/ui/SetupScreen.tsx` (`sharedRestaurant` threaded into `buildReadyUpPayload`)
- `client/src/ui/UpgradeTerminal.tsx`, `client/src/app/GameView.tsx` (staff-only lock, stated
  reason)
- `scripts/check-coop-no-staff.mjs` (new, wired into `npm run check`)
