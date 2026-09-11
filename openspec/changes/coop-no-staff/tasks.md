## 1. The roster: genuinely empty for a co-op restaurant

- [x] 1.1 `server/src/game/systems/worker-system.js`: `buildStaff(match, player)` — `workers:
      []` when `match.sharedRestaurant`, else unchanged `ROSTER.map(...)`; call site in
      `ensureState` passes `match`; header comment note added (no restructuring of the existing
      "WHAT THE WORKERS TOOK OVER" section)
- [x] 1.2 `shared/game-logic/ready-up-menu.js#buildReadyUpPayload`: new `sharedRestaurant`
      param (default `false`) — `staffAssignments: {}` when true; `ready-up-menu.d.ts` updated
      to match
- [x] 1.3 `server/src/game/validators/setup-validator.js`: `validateSetupSubmission` reads
      `options.sharedRestaurant`; skips both the per-entry legality loop and the "every roster
      worker needs a post" (`worker_unassigned`) completeness loop when true; stores
      `staffAssignments: {}` regardless of what the client sent (defense in depth)
- [x] 1.4 `setup-validator.js#acceptSetupSubmission`: derives `sharedRestaurant` from
      `match.sharedRestaurant` directly — no change needed in `message-router.js`
- [x] 1.5 `setup-validator.js#defaultSubmission`: same `sharedRestaurant` option, same empty-
      staffAssignments branch, for the idle-player fallback
- [x] 1.6 `server/src/game/systems/setup-system.js`: `onPhaseChange`'s `defaultSubmission()`
      call threads `{ sharedRestaurant: match.sharedRestaurant }`

## 2. Wire contract and client setup flow

- [x] 2.1 `server/src/game/match.js#toSnapshot`: new top-level (public, not `you`-scoped)
      `sharedRestaurant` field, straight off `Match#sharedRestaurant`
- [x] 2.2 `shared/schemas/messages.d.ts`: `MatchSnapshotMessage.sharedRestaurant`
- [x] 2.3 `client/src/game/GameClient.ts`: `GameClientStatus.sharedRestaurant` (default
      `false`), patched from `message.sharedRestaurant` on every `match_snapshot`
- [x] 2.4 `client/src/ui/SetupScreen.tsx`: `sharedRestaurant: status.sharedRestaurant` threaded
      into `buildReadyUpPayload`

## 3. The staff-only upgrade audit and lock

- [x] 3.1 Audited all ten `KNOWN_EFFECT_KEYS`-wired upgrades against their actual read site
      (design.md Decision 65's table); found exactly one staff-only entry, `maitre_d_radio_1`
      (`serverSeatingDurationMultiplier`, read only by `worker-system.js`'s automated
      seat-party task duration)
- [x] 3.2 `client/src/game/GameClient.ts`: `STAFF_ONLY_UPGRADE_IDS = ['maitre_d_radio_1']`
- [x] 3.3 `client/src/ui/UpgradeTerminal.tsx`: new `sharedRestaurant` prop; staff-only entries
      render a disabled "No staff to upgrade" button (with a `title` explaining why) instead of
      the normal Buy/Requires state, when `sharedRestaurant` is true
- [x] 3.4 `client/src/app/GameView.tsx`: `sharedRestaurant={status.sharedRestaurant}` passed to
      `UpgradeTerminal`
- [x] 3.5 No server-side change to `upgrade-system.js`/`action-validator.js` — the purchase
      stays legal (design.md Decision 65's "server-side purchase stays legal" note); this is a
      UI-communication fix, not a new legality rule

## 4. Verification

- [x] 4.1 `scripts/check-coop-no-staff.mjs` (new, real `Match`/systems, no client, in the style
      of `check-coop-mode.mjs`/`check-workers.mjs`): pure-builder coverage
      (`buildReadyUpPayload`/`validateSetupSubmission`/`defaultSubmission` co-op branches, plus
      non-coop regressions); a real co-op `Match` reaching `service` with `workers.length === 0`
      and every `brigade.owns*()` false; each fallback EXERCISED against that real match — auto
      seating, auto greet/order-taking, order-pass hand-off teleport, auto payment collection,
      table-clearing auto-resolve (no dirty flag), auto-dispatched restocking; a non-coop
      regression restaurant still fully staffed
- [x] 4.2 Wired into `npm run check` (`check:coop-no-staff`, in `package.json`'s `check` chain
      right after `check:coop-mode`)
- [x] 4.3 Full `npm run check` green, including `build:client`/`build:harnesses`

## 5. OpenSpec

- [x] 5.1 `proposal.md`, `design.md` (with Mermaid sequence diagram of the actual roster/
      fallback/upgrade-lock flow, citing `coop-match-mode`'s Decision 59/60), `tasks.md` (this
      file)
