# Co-op match mode and invite entry point

## Why

Every match today is competitive: two owners (human or bot), each running their OWN restaurant,
drawing from one shared district (`shared-district-choice`'s model). PRD-co-op-mode-and-
district-crowds asks for a **co-op** mode instead — two players run **one shared restaurant**
together. This is the foundation story for the whole co-op slice (STORY-040 through STORY-043
build on it) and lands first: no-staff kitchen rework, timed-cooking UI and the kitchen queue
board are explicitly later stories. This story's job is narrower — a co-op match exists, has
exactly one restaurant, and two players can get into it together, without crashing or rendering
garbage anywhere the rest of the codebase still assumes two restaurants.

`http/routes.js` already has a working precedent for a distinct match mode with its own invite
flow: `mode: "private_human"` (`private-invite-lobby`) and `mode: "solo_bot"`
(`solo-bot-match-menu-flow`). Co-op is a new `mode` value on the SAME invite-token/`joinUrl`
plumbing `private_human` already built — not a second invite system.

This corresponds to STORY-039 in the slicing pass.

## What Changes

- **`POST /api/rooms` widened**: `{mode: "coop", hostDisplayName}` reuses `private_human`'s
  EXACT invite-token/expiry/`joinUrl` generation (`inviteHost()`/`firstLanIPv4()`), plus
  `requiredPlayers: 2` explicit like `solo_bot`'s.
- **`Match#restaurantIdFor(playerId)`**, a new resolver method — the ONE seam every
  restaurant-keyed system in this codebase (customers, scoring, action-validator, the snapshot
  builder, manager-ledger, telemetry) now reads instead of assuming `restaurantId === playerId`.
  Identity for every pre-existing mode (`sharedRestaurant: false`); for a co-op match
  (`sharedRestaurant: true`) it returns the FIRST-seated player's own id for EITHER seat, so both
  players fold onto one restaurant bucket without either side needing to know who "hosts" it.
- **The district-choice model is UNCHANGED**, not bypassed: `customer-system.js`'s own header
  already documents a one-restaurant district as "the degenerate case of the same code" — no
  rival to compare against, so `decisionReason` stays honestly `null` and `CHOOSE_RIVAL` never
  fires. This change only collapses WHICH restaurant ids feed that existing math, not the math
  itself (see design.md Decision 59 for the alternative considered and rejected).
- **Every place that used to build "one restaurant per player"** (customer-system.js's district,
  `match.js#toSnapshot`'s `frontDoor`/`serviceStation`/`players[]`, scoring-system.js,
  manager-ledger-system.js, telemetry-system.js) now de-duplicates through the resolver so a
  co-op match's `match.restaurants[]`/`match_complete.results` carry exactly one entry, not a
  real one plus a phantom all-zero second row.
- **`match_snapshot.you.restaurantId` and `players[].restaurantId`**, new wire fields — a co-op
  guest's own `playerId` is never a key into `restaurants[]`/`frontDoor`/`serviceStation`, so the
  client needs an explicit "which restaurant is mine" fact instead of assuming `restaurantId ===
  playerId`. Every client read site that filtered/looked up by `status.playerId` for a
  restaurant-domain purpose (HUD, tactical overview, front door/service/kitchen-command boards,
  results screen, the rival-floor remap in `RestaurantScene.ts`) now reads this instead.
- **Client**: a new "Invite Co-op Partner" entry on `MainMenu`, reusing the exact
  `LobbyScreen`/`InvitePanel`/`/join/:token` flow `private_human` already has — `InvitePanel`
  reads the room's `mode` to say "co-op partner" instead of "opponent".

## Non-Goals

Co-op scoring/win-condition (a cooperative target vs. the existing competitive composite score)
is explicitly out of scope — a co-op match ships with the existing scoring computed for the one
shared restaurant, and the results screen simply omits the rival comparison column/narrative
when there is no second restaurant to compare against (open question for whoever picks up
STORY-040+). The no-staff kitchen rework, timed-cooking UI, and kitchen queue board are later
stories (STORY-040-043) and are not touched here — a co-op match's kitchen/inventory/worker
internals still allocate one bucket per player (an orphan for the non-host seat that nothing
ever looks up again, since every action now routes through the shared restaurant id instead);
unifying THAT internal model is explicitly the next story's job, not this one's.

## Capabilities

### New Capabilities

- `coop-match-mode`: the `mode: "coop"` room-creation path, `Match#restaurantIdFor`'s
  single-restaurant collapse, and the client entry point/invite-share UX for it.

### Modified Capabilities

(none — this change extends `private-invite-lobby`'s invite mechanism and preserves
`shared-district-choice`'s choice model verbatim; neither is being changed, only reused/fed
different restaurant ids)

## Impact

- `server/src/game/match.js` (`sharedRestaurant` constructor option, `restaurantIdFor`,
  `toSnapshot` widened with `you.restaurantId`/`players[].restaurantId`, de-duplicated
  `frontDoor`/`serviceStation`/`matchCompleteMessage` fallback)
- `server/src/game/match-manager.js` (`createRoom` widened: `isInviteFlow` predicate covers
  `coop` alongside `private_human`, `sharedRestaurant: true` threaded through)
- `server/src/http/routes.js` (`POST /api/rooms` accepts `mode: "coop"`)
- `server/src/game/validators/action-validator.js` (`restaurantId` resolved through
  `restaurantIdFor`, feature-detected for the fixture-based check scripts that hand-build a
  fake `match` object)
- `server/src/game/systems/customer-system.js`, `scoring-system.js`,
  `manager-ledger-system.js`, `telemetry-system.js` (restaurant-id enumeration de-duplicated
  through the resolver)
- `shared/schemas/game-state.d.ts`, `shared/schemas/messages.d.ts` (`PlayerSnapshot
  .restaurantId`, `SnapshotViewer.restaurantId`)
- `client/src/game/GameClient.ts` (`GameClientStatus.restaurantId`, every restaurant-domain
  read site switched off `status.playerId`), `StateInterpolator.ts` (`PlayerState
  .restaurantId`, threaded through interpolation)
- `client/src/ui/HudPanel.tsx`, `TacticalOverviewPanel.tsx`, `FrontDoorBoard.tsx`,
  `KitchenCommandBoard.tsx`, `ServiceStationBoard.tsx`, `ResultsPanel.tsx` (same switch)
- `client/src/ui/MainMenu.tsx`, `InvitePanel.tsx`, `app/App.tsx`, `app/invite-lobby-types.ts`
  (co-op invite entry point and mode-aware invite copy)
- `scripts/check-coop-mode.mjs` (new, wired into `npm run check`)
