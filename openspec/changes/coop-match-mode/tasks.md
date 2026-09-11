## 1. The resolver seam

- [x] 1.1 `server/src/game/match.js`: `sharedRestaurant` constructor option (default `false`,
      byte-identical to before for every existing caller); `restaurantIdFor(playerId)` —
      identity unless `sharedRestaurant`, in which case the first-seated player's own id for
      either seat
- [x] 1.2 `server/src/game/validators/action-validator.js`: both `restaurantId = playerId`
      sites (`handleInteract`, `handlePurchaseUpgrade`) route through
      `match.restaurantIdFor(playerId)`, feature-detected (`typeof === 'function'`) so the
      hand-built fixture `match` objects several check scripts already use
      (`check-service-station.mjs`, `check-pantry-board.mjs`, ...) keep their pre-existing
      `restaurantId === playerId` behavior unchanged

## 2. Server room creation and invite reuse

- [x] 2.1 `server/src/game/match-manager.js`: `createRoom`'s `isInviteFlow` predicate covers
      `mode === 'coop'` alongside `'private_human'` (token, expiry, `hostDisplayName`,
      `holdLobbySeatsDuringGrace` — all four, not a partial subset); `sharedRestaurant: true`
      threaded onto the `Match` for `mode === 'coop'` only
- [x] 2.2 `server/src/http/routes.js`: `POST /api/rooms` accepts `mode: 'coop'`,
      `requiredPlayers: 2` explicit (matching `solo_bot`'s own explicitness), `hostDisplayName`
      forwarded; `joinUrl`/`inviteToken` response shape already generic, no changes needed there

## 3. De-duplicating every restaurant-id enumeration

- [x] 3.1 `server/src/game/systems/customer-system.js`: `ensureState` and `update`'s
      seat-filled-late backfill both de-duplicate through `restaurantIdFor` before inserting
      into the district's `state.restaurants` Map
- [x] 3.2 `server/src/game/systems/scoring-system.js`: `restaurantIds` de-duplicated —
      otherwise a co-op match would score a real restaurant plus a phantom all-zero second row
      for the never-populated guest-keyed bucket
- [x] 3.3 `server/src/game/systems/manager-ledger-system.js`: both the `ensure()` construction
      and the per-tick backfill loop de-duplicated (feature-detected `restaurantIdFor` for
      `check-manager-ledger.mjs`'s own fixture `match`)
- [x] 3.4 `server/src/game/systems/telemetry-system.js`: the revenue-sample loop de-duplicated
      — a co-op match's telemetry log gets one real revenue sample, not a real one plus a
      permanent-$0 phantom
- [x] 3.5 `server/src/game/match.js#toSnapshot`: `frontDoor`/`serviceStation` built from
      de-duplicated restaurant ids (not raw `players.keys()`), so a co-op guest's client can
      actually find its own front-door/service-station state; `matchCompleteMessage`'s
      no-scoring-ran fallback de-duplicated the same way
- [x] 3.6 Explicitly left untouched, and documented as such (design.md Decision 60):
      `order-system.js`, `inventory-system.js`, `worker-system.js`, `upgrade-system.js`,
      `front-door-system.js`, `service-station-system.js`, `kitchen-command-system.js`'s own
      internal per-player bucket construction — the anchored resolver (Decision 59) makes their
      existing host-keyed bucket the real one and the guest-keyed bucket a harmless orphan

## 4. Wire contract — the client's own "which restaurant is mine"

- [x] 4.1 `shared/schemas/game-state.d.ts`: `PlayerSnapshot.restaurantId`
- [x] 4.2 `shared/schemas/messages.d.ts`: `SnapshotViewer.restaurantId`
- [x] 4.3 `server/src/game/match.js#toSnapshot`: `you.restaurantId` and `players[].restaurantId`
      populated via `restaurantIdFor`

## 5. Client — reading the new field instead of assuming `restaurantId === playerId`

- [x] 5.1 `client/src/game/StateInterpolator.ts`: `PlayerState.restaurantId`, carried through
      `push`/`sample` (previously dropped on the interpolated branch)
- [x] 5.2 `client/src/game/GameClient.ts`: `GameClientStatus.restaurantId`; every
      restaurant-domain read site (`selfRestaurantId` for presentation events / floor state /
      critical alerts, `InteractionController.setSnapshot`, the customers/orders/restaurants
      filters, `serviceStation`/`frontDoor` lookups, `remapToRivalFloor`) switched from
      `status.playerId` to the resolved `restaurantId`; player-IDENTITY sites (`isSelf`, the
      camera's own-avatar lookup) deliberately left reading `playerId` — a co-op partner is a
      different PLAYER on the SAME restaurant, not a different restaurant
- [x] 5.3 `client/src/ui/HudPanel.tsx`, `TacticalOverviewPanel.tsx`, `FrontDoorBoard.tsx`,
      `KitchenCommandBoard.tsx`, `ServiceStationBoard.tsx`: same switch
- [x] 5.4 `client/src/ui/ResultsPanel.tsx`: `selfId` reads `status.restaurantId`; `rivalId`'s
      fallback to `restaurantIds[0]` removed (it previously resolved to `selfId` itself when
      only one restaurant existed — a real, pre-existing bug for a solo `/dev/match`, now
      reachable by real players via co-op); the rival stat column and every narrative line that
      depends on a rival's result render conditionally on `hasRival`

## 6. Client — the co-op entry point

- [x] 6.1 `client/src/ui/MainMenu.tsx`: "Invite Co-op Partner" button, `createInviteRoom`
      shared with "Invite Opponent" (parameterized by `mode`, not duplicated)
- [x] 6.2 `client/src/app/invite-lobby-types.ts`: `CreatedRoom.mode`/`CachedInvite.mode`
- [x] 6.3 `client/src/app/App.tsx`: threads `mode` into the `InviteInfo` handed to `GameView`
- [x] 6.4 `client/src/ui/InvitePanel.tsx`: `InviteInfo.mode`; "co-op partner" copy when
      `mode === 'coop'`, unchanged "opponent" copy otherwise
- [x] 6.5 `LobbyScreen.tsx`/`JoinInvitePage.tsx`/`App.tsx`'s `'lobby'`/`'join'` routes: no
      changes needed — already mode-agnostic ("Host"/"Guest" slots, "Waiting for opponent…")

## 7. Verification

- [x] 7.1 `scripts/check-coop-mode.mjs` (new, real `Match`/room objects, no client, in the
      style of `check-invite-lobby.mjs`/`check-upgrades.mjs`): `mode: 'coop'` invite minting and
      gating identical to `private_human`; `restaurantIdFor` collapse for a co-op match and
      identity for a competitive one; `match.restaurants.length === 1` once a real coop match
      reaches `service` and after live ticking; `CHOOSE_RIVAL` never fires; a REAL purchase from
      EACH seat lands on the one shared restaurant's owned-upgrades list; `buildSnapshot` never
      attaches a `bots` array to a coop room; a plain competitive match still gets two
      restaurants (regression guard)
- [x] 7.2 Wired into `npm run check` (`check:coop-mode`)
- [x] 7.3 `scripts/check-setup-phase.mjs`'s `PUBLIC_PLAYER_FIELDS` allowlist updated for the new
      `restaurantId` field (an intentional, reviewed addition, not a silent leak)
- [x] 7.4 Full `npm run check` green, including `build:client`/`build:harnesses` (`tsc --noEmit`
      across every client read site this change touches)

## 8. OpenSpec

- [x] 8.1 `proposal.md`, `design.md` (with Mermaid sequence diagram of the actual mode/resolver/
      district flow), `tasks.md` (this file)
