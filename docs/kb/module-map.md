---
type: Module Map
title: Module Map — table-stakes
description: Top-level directory-by-directory responsibility map for the table-stakes repo, from shared game data down through server systems, client scenes/UI, harnesses, and scripts.
generated: { by: kb-generate/claude-sonnet-5, at: 2026-09-13T20:30:00Z }
sources:
  - id: crawl
    resource: git@github.com:brentfisher/table-stakes.git
    title: "table-stakes @ 05aa5f5eb44ccbf452581766d20bfe080a11e8f8"
---

# Module Map — table-stakes

| Path | Responsibility | Notes |
|---|---|---|
| `shared/game-data/` | All balance content as JSON: 13 tables — dishes, markets, customer-segments, events, upgrades, policies, restaurant-layout, arcade-food, front-door-specials, kitchen-command, pantry-restock, service-station. | `loader.js` validates the whole catalogue and **fails loudly at boot**. Strict: an ingredient declared but unused, or an event in no market's `eventPool`, is a hard error. |
| `shared/schemas/` | `messages`, `game-state`, `validation`, `setup-rules` — each `.js` + sibling `.d.ts`. | `setup-rules` is imported by both sides: price bands, producibility, and the six §7 qualitative labels. `messages.d.ts` is now ~29 KB — the wire vocabulary has grown with every management/recap story. |
| `shared/constants/tuning.js` | Every tunable number, ~1,300 lines in named blocks by story. | Single source of `THREE_VERSION`. Nothing may inline a constant. |
| `shared/build/three-cdn-external.ts` | Vite plugin keeping `three` external in dev **and** build. | Build tooling, excluded from both app `tsconfig`s. Both vite configs import it — it was once git-ignored and broke a clean clone. |
| `server/src/index.js` | Express + `ws` on one HTTP server; serves the built client. | |
| `server/src/http/` | `/health`, `/api/version`, `/api/markets`, `/api/rooms*`, `/api/dev/match`. | |
| `server/src/websocket/` | `socket-server`, `connection-manager`, `message-router`. | The router rejects a declared-but-unimplemented type with `not_implemented` — never silence. |
| `server/src/game/match.js` | Seed, phase clock, players, reconnect grace, **per-viewer snapshot**. 717 lines. | Contains no gameplay. `toSnapshot(viewer)` serializes `<field> ?? []`, so systems publish by attaching an array. |
| `server/src/game/simulation-loop.js` | `registerSystem()`, the 20 Hz tick and 10 Hz broadcast. | **The seam.** Read its block header before adding a system. |
| `server/src/game/systems/index.js` | The single ordered registration list — now 15 systems. | **Order is a documented contract**; each entry says why it sits where it does. |
| `server/src/game/systems/` | `movement`, `setup`, `customers`, `orders`, `events`, `inventory`, `kitchen-command`, `workers`, `upgrades`, `front-door`, `service-station`, `hud-bottlenecks`, `manager-ledger`, `scoring`, `telemetry`. | `customer-system.js` (1,824 lines), `order-system.js` (1,284) and `worker-system.js` (1,041) are the three big ones. |
| `server/src/game/bot/` | `bot-controller`, `bot-setup`, `bot-socket`. | The bot drives a **real WebSocket connection** like any client — no shortcut into `match.js`. |
| `server/src/game/scoring/` | `score-formula.js`, `narrative.js`. | Split so the results screen and recap flow both read the same human-readable explanation layer. |
| `server/src/game/catalogue.js` | Loads and validates `shared/game-data/` at boot. | |
| `server/src/game/validators/` | `setup-validator.js` (20 machine-readable rejection reasons), `action-validator.js` (owner `interact` legality). | Pure; only the corresponding `accept*`/mutation function touches the match. |
| `server/src/game/rng.js` | mulberry32 + `createRngStream(name)`. | **Named sub-streams per system** so one system's draws can't shift another's sequence. |
| `client/src/game/` | `GameClient`, `NetworkClient`, `InputController`, `InteractionController`, `SceneManager`, `CameraController`, `EntityViewRegistry`, `StateInterpolator`. | The imperative layer, kept out of React's reconciliation path. `GameClient.ts` is now ~1,380 lines — the client-side hub for status, snapshots and derived UI state. |
| `client/src/ui/`, `client/src/app/` | `App`, `GameView`, `MainMenu`, `LobbyScreen`, `JoinInvitePage`, `HudPanel`, `SetupScreen`, `TacticalOverviewPanel`, `KitchenCommandBoard`, `KitchenQueueBoard`, `PantryBoard`, `ServiceStationBoard`, `FrontDoorBoard`, `StationMenu`, `UpgradeTerminal`, `SettingsPanel`, `AudioPanel`, `ResultsPanel`. | Plain CSS. React re-renders on the low-frequency status callback, never per tick. |
| `client/src/ui/recap/` | 17 files: `RecapArrangeBoard` (the shell), `RecapNumbers`, `RecapScorecard`, `RecapMenuStars`, `RecapNextShift`, `RecapCelebration`, `RecapHighlights`, `RecapTeaser`, `RecapMascot`, `RecapArcadeStage`, plus `catalogue.ts`/`format.ts`/`recap-types.ts`. | The full post-match experience, built on the pre-reveal teaser and `match_complete` payload. |
| `client/src/scenes/` | `RestaurantScene.ts` (~2,800 lines, the scene graph), `CopperAndThyme.ts` (adapted GLB loader), `NeonSign.ts`, `FoodModels.ts`, `food-preview-renderer.ts`, `icon-sprites.ts`, `restaurant-rendering.ts`, `ResultsScene.ts`. | Built from `restaurant-layout.json`, composited with the Copper & Thyme asset. Contains no networking and no rules — that is what lets harnesses mount it with mocked state. |
| `client/src/audio/RestaurantAudio.ts` | Ambient/SFX layer driven off `GameClient`'s status stream. | New since the original slice; paired with `ui/AudioPanel.tsx`. |
| `harnesses/src/` | `harness-shell` (the `SceneHarness` contract) + **14 harnesses**: restaurant-layout, customer-flow, kitchen-bottleneck, event-visualization, upgrade-preview, asset-showcase, front-door-policy, service-station, pantry-board, kitchen-command, arcade-food, manager-ledger, ready-up-menu, neon-sign. | Every PRD §15 harness plus several added outside the original slice. Runs with no backend. |
| `scripts/` | 34 `check-*.mjs` + 5 `smoke-*.mjs` + `measure-district-crowd-density.mjs`, chained by `npm run check`. | **This is the test suite** — there is no framework. `lib/server-process.mjs` spawns and kills a server by PID. |
| `openspec/changes/` | 14 change directories carrying **78 numbered decisions**. | Cite them by heading. No `archive/` directory exists yet — nothing has been archived. |
| `assets/licenses/` | Mandatory metadata for any reused asset. | Now holds `copper-and-thyme.json` — see `docs/kb/copper-and-thyme-integration.md`. The arcade-food model set (`assets/arcade-food/models/*.glb`) has no license entry here yet. |
