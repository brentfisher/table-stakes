# table-stakes

**Rival Restaurant** — a real-time, head-to-head restaurant-management game. Two players run
adjacent restaurants competing for one shared pool of customers: a strategic setup phase
(menu, prices, inventory, staffing) followed by a real-time service phase where each player
embodies the owner on the restaurant floor.

Full specification: `PRD_ Rival Restaurant — Competitive Service Manage.pdf`.

> **Status: Milestone 0 (technical spike).** Two owner avatars move around a readable 3D
> restaurant with server-authoritative positions, and one dev harness runs standalone. There
> are no customers, orders, workers, menus, money, events or scoring yet — each has its own
> story. See "What is not built yet" below.

## Layout

This is a conventional multi-folder repository, **not** a monorepo framework. Each application
is independently understandable and runnable; the root scripts only coordinate.

| Path | What it is |
|---|---|
| `shared/` | Game data (JSON), wire schemas, and tuning constants used by both sides. |
| `server/` | Authoritative Express + `ws` game server. **Plain JavaScript.** |
| `client/` | Browser client: React UI + Three.js scene. **TypeScript.** |
| `harnesses/` | Standalone 3D dev scenes. No backend, no match, no auth. **TypeScript.** |
| `assets/` | Models, textures, audio, and mandatory license metadata. |
| `scripts/` | Repo checks. |

## Running it

```bash
npm run install:all      # install server, client and harness dependencies

npm run dev:server       # http://localhost:3000  — API + WebSocket at /ws
npm run dev:client       # http://localhost:5173  — proxies /api and /ws to the server
npm run dev:harnesses    # http://localhost:5174  — needs NO server running
```

Open the client in two browser windows to see two owners in one room. To share a specific
room, pass `?room=room_0001`.

For a production-shaped run, build the client into the server's static directory and serve
everything from one origin:

```bash
npm run build:client
npm start                # http://localhost:3000 serves the built client
```

## Running the backend on another machine (Docker)

The server serves the API, the WebSocket endpoint and the built client from **one origin**, so
once it is reachable on your network the browser resolves the WebSocket back to the same host
with no client configuration.

```bash
docker compose up -d --build          # build and start
docker compose logs -f server         # follow logs
docker compose down                   # stop
```

Then open `http://<that-host>:3000` from any machine on the LAN. Two browser windows pointed at
the same host land in the same district; add `?room=room_0001` to join a specific room.

If port 3000 is taken on that machine:

```bash
HOST_PORT=8080 docker compose up -d --build
```

Notes:

- The image is multi-stage: the first stage builds the browser client, the runtime stage
  installs **production dependencies only** (`express`, `ws`) and runs as the unprivileged
  `node` user. Three.js is not installed in either stage — the browser fetches it from the
  pinned CDN, so **clients need outbound internet access to that CDN** even when the server is
  on your LAN.
- A `HEALTHCHECK` polls `/health`; `docker compose ps` shows the container as healthy once the
  server is up.
- Match state is in-memory for MVP, so there is no volume and a restart drops open rooms by
  design. That changes when a story introduces real persistence.

## Checks

There is no test framework yet (the PRD does not name one). Verification is by runnable
scripts and by the dev harnesses.

```bash
npm run check:three        # Three.js pin/bundle rules — see below
npm run check:milestone0   # end-to-end: needs the server running
npm run check              # pin check + both builds
```

## The Three.js rule

PRD §13 and §22 make this a pass/fail requirement, and it is the constraint most easily
broken by accident:

- Three.js is loaded **from a pinned CDN via an import map**, never bundled and never an npm
  dependency. `client/index.html` and `harnesses/index.html` map both `three` and
  `three/addons/` to the same pinned version on the same CDN.
- The version is written in exactly one place: `THREE_VERSION` in
  `shared/constants/tuning.js`. Change it there, update both import maps, then run
  `npm run check:three`.
- `@types/three` *is* a devDependency, pinned to the exact same version. It is types only,
  erased at compile time, and never reaches the bundle — the check enforces both the absence
  of a `three` runtime dependency and the exact version match.
- Vite marks `three` external, so the built bundle keeps `from"three"` as a bare specifier
  for the browser's import map to resolve.

## HTTP endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Service health. |
| `/api/version` | GET | Build/client compatibility, including the pinned Three.js version. |
| `/api/markets` | GET | Market definitions (501 until STORY-002). |
| `/api/rooms` | POST | Create a room. Optional `{ "seed": "...", "phasePreset": "prototype" \| "full" }`. |
| `/api/rooms` | GET | List room statuses. |
| `/api/rooms/:roomId` | GET | Room status. |
| `/api/dev/match` | POST | Development/local match creation. |

The game session itself runs over WebSockets at `/ws`, not REST polling.

## Architecture notes

- **The server is authoritative.** The browser never computes money, customer choice, scores,
  inventory, upgrades, or action outcomes. Clients send *intent* (`player_input`, `interact`);
  the server integrates, clamps and broadcasts. `npm run check:milestone0` proves this for
  movement: an out-of-bounds intent cannot produce an out-of-bounds position.
- **Simulate at 20 Hz, broadcast at 10 Hz**, and interpolate on the client. Both rates live in
  `shared/constants/tuning.js`.
- **React owns UI; Three.js owns the scene.** React mounts the scene container once and
  re-renders only on the low-frequency status callback — it never reconciles scene objects per
  frame.
- **Rules emit state; views render state.** This is what lets `harnesses/` mount the real
  `RestaurantScene` with mocked state and no backend.
- **Matches are seeded and reproducible.** The seed drives match configuration; the same seed
  produces the same setup. This is the primary debugging affordance until there are tests.

## What is not built yet

Milestone 0 covers scaffolding and replicated movement only. Unimplemented client message
types are explicitly rejected with `not_implemented` rather than silently ignored.

Still to come, each as its own story: shared game data and full wire schemas; the match phase
clock; customers; orders and the kitchen; inventory; worker AI; owner interactions; the setup
phase; the shared-district choice model; events; upgrades; scoring; the results screen; the
HUD; the visual state language; a bot opponent; four more harnesses; and telemetry.

## Repository conventions

- Base branch is `master`.
- The server stays plain JavaScript; the client, harnesses and shared schemas are TypeScript.
- All balance content is JSON or plain data under `shared/game-data/` — never hardcoded in a
  system.
- Data ids and WebSocket message types are `snake_case`; durations are milliseconds with a
  `Ms` suffix.
- Every reused external asset needs license metadata in `assets/licenses/`.
