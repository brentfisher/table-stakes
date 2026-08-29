# Tasks — Milestone 0

- [x] Create the PRD §13 repository layout and `.gitignore`
- [x] Root coordinating `package.json` with no workspaces
- [x] `shared/constants/tuning.js` + `.d.ts` with the single pinned `THREE_VERSION`
- [x] `shared/game-data/restaurant-layout.json` from PRD §14
- [x] `shared/schemas/messages.js` + `.d.ts` declaring the MVP protocol vocabulary
- [x] Express server: `/health`, `/api/version`, `/api/markets`, `/api/rooms*`, `/api/dev/match`
- [x] `ws` server with connection manager and type-dispatching message router
- [x] Seeded RNG, match, match manager, in-memory store
- [x] 20 Hz simulation loop broadcasting at 10 Hz, with server-side position clamping
- [x] Client: pinned import map, React shell, `GameClient`, `NetworkClient`,
      `InputController`, `SceneManager`, `CameraController`, `EntityViewRegistry`,
      `StateInterpolator`, `RestaurantScene`
- [x] Harness shell implementing `SceneHarness`, plus the restaurant layout harness
- [x] `scripts/check-threejs-pin.mjs` enforcing the Three.js rules
- [x] `scripts/smoke-milestone0.mjs` covering replication, authority, determinism, reject-path
- [x] README documenting layout, running, checks, and the Three.js rule
- [x] Fill `openspec/config.yaml` `context:` with the PRD's binding technical constraints
