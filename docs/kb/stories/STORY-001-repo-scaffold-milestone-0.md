---
id: STORY-001
title: Repo scaffold and Milestone 0 technical spike
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/001-repo-scaffold-milestone-0
worktree_path: null
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/1
is_architectural: true
approach_summary: "Built directly in the main repo on branch story/001-repo-scaffold-milestone-0 rather than a kickoff worktree, because this story IS the base every other branch forks from. Creates the PRD §13 layout, an Express+ws authoritative server with a 20Hz/10Hz loop and server-side position clamping, a React+Three.js client with CDN import map and snapshot interpolation, and the harness shell plus restaurant layout harness. Verified by scripts/check-threejs-pin.mjs and scripts/smoke-milestone0.mjs (9/9)."
created: 2026-08-28
updated: 2026-08-28
---

# Repo scaffold and Milestone 0 technical spike

The repository is empty — one commit, one file, `README.md`. Nothing in this PRD can be built
until the folder layout, the two runnable applications, the wire transport, and the Three.js
loading strategy exist. This story creates all of it, and it is the **only** story that may be
started before any other. Every remaining story branches from the commit this one lands.

Concretely this story builds PRD §13's repository layout (`shared/`, `server/`, `client/`,
`harnesses/`, `assets/`) and delivers PRD §21 Milestone 0 in full: an Express app that serves the
built client and a health endpoint, a `ws` WebSocket server, two browser clients joined to one
room, a basic Three.js restaurant scene loaded through a **pinned CDN import map**, two owner
avatars whose positions replicate through the server, the harness shell plus the restaurant
layout harness, and a deterministic seeded match configuration.

It deliberately does **not** carry gameplay. There are no customers, no orders, no workers, no
menu, no money, no events, no scoring. Avatars move around an empty readable restaurant and the
server is authoritative over their position bounds. Resist the urge to start the simulation here
— every system has its own story, and the value of this one is that twenty later branches all
agree on the same `package.json`, the same server entry point, the same import map, and the same
scene/view seam.

## Acceptance Criteria

**Repository layout**

- [ ] Top-level directories exist and match PRD §13: `shared/`, `server/`, `client/`,
      `harnesses/`, `assets/` (with `assets/models/`, `textures/`, `audio/`, `licenses/`).
- [ ] A root `package.json` holds only dev-coordination scripts; `server/package.json`,
      `client/package.json`, and `harnesses/package.json` are independent. No `workspaces` key,
      no Nx/Turborepo/Lerna config anywhere.
- [ ] A `.gitignore` exists covering at minimum `node_modules/`, client/harness build output,
      and `.claude/worktrees/`. (The repo currently has none.)
- [ ] `server/` runs on plain JavaScript — no `tsconfig.json`, no `.ts` files under `server/src/`.
- [ ] Shared modules the server imports are authored as `.js` with a sibling `.d.ts`, so the
      server never compiles TypeScript while the client still gets types.
- [ ] `client/` and `harnesses/` are TypeScript with their own `vite.config.ts`.

**Three.js loading — the hard constraint**

- [ ] `client/index.html` contains a `<script type="importmap">` mapping **both** `three` and
      `three/addons/` to the same pinned version on the same CDN (e.g.
      `https://cdn.jsdelivr.net/npm/three@<VERSION>/build/three.module.js` and
      `.../examples/jsm/`). No unversioned or "latest" URL.
- [ ] `harnesses/index.html` uses the same import map and the same pinned version.
- [ ] The pinned version string lives in exactly one place, `shared/constants/tuning.js` (with a
      sibling `tuning.d.ts` — see Notes), and the HTML import maps are verified against it by
      `scripts/check-threejs-pin.mjs`.
- [ ] No `package.json` declares `three` as a **runtime** dependency. `@types/three` is permitted
      as a devDependency **only** when pinned to exactly `THREE_VERSION` — types are erased at
      compile time and never reach the bundle, but a version mismatch would mean the types
      describe a different library than the browser loads. The pin check enforces both halves.
- [ ] After `npm run build` in `client/`, no emitted bundle contains the Three.js source
      (verifiable with `grep -rl "THREE.WebGLRenderer" client/dist/` returning nothing, or an
      equivalent check on the build output).
- [ ] `import * as THREE from "three"` resolves at runtime in the browser without a bundler alias.

**Server**

- [ ] `server/src/index.js` starts an Express app that serves `server/public/client-build/` as
      static files and attaches a `ws` server to the same HTTP server.
- [ ] `GET /health` returns 200 with a JSON body.
- [ ] `GET /api/version` returns a build/client compatibility identifier.
- [ ] `POST /api/rooms` creates a room and returns its id; `GET /api/rooms/:roomId` returns its
      status. Rooms live in `server/src/persistence/in-memory-store.js` — no database.
- [ ] `server/src/websocket/` contains `socket-server.js`, `connection-manager.js`, and
      `message-router.js`, and the router dispatches on the JSON message `type` field.

**Replicated movement**

- [ ] Two browser clients connected to the same room each see the other's owner avatar move.
- [ ] The server, not the client, clamps avatar position to the restaurant bounds: a client
      sending an out-of-bounds `player_input` does not end up out of bounds in the broadcast
      snapshot.
- [ ] The server broadcasts `match_snapshot` on a fixed interval (~10/sec) driven by a
      simulation loop ticking at 10–20/sec; the client interpolates between snapshots rather
      than snapping.

**Determinism**

- [ ] A match is created with an explicit seed, and the seed is recorded in the match state and
      visible in the dev logs.
- [ ] Creating two matches with the same seed produces the same generated configuration
      (demonstrable from logs or a scratch script).

**Harnesses**

- [ ] `harnesses/src/harness-shell.ts` implements the registry and the `SceneHarness` contract
      exactly as PRD §15 states: `{ id, title, description, mount(container), dispose() }`,
      exported through a `harnesses` array.
- [ ] `restaurant-layout-harness.ts` renders the §14 restaurant footprint (street/entry, host
      stand, six tables, service pass, prep/grill/oven/plating, pantry, dishwashing, upgrade
      terminal) with a debug grid toggle and adjustable camera height/angle/zoom.
- [ ] The harness app launches and is fully usable with the server **not running** — no backend,
      no room, no auth, no React game shell.

**Docs**

- [ ] `README.md` explains how to run server, client, and harnesses independently.

## Notes

- **This story blocks every other story in this slice.** That is deliberate and unavoidable on a
  greenfield repo: the slicing skill's independence rule explicitly allows a hard dependency when
  it cannot be avoided, and this is that case. Do **not** fan out other stories to parallel
  worktrees until this one has landed on `master` — `manifest.json` records why: ten worktrees
  branched from an empty base each invent their own `package.json`, server entry, and Vite
  config, and the merges are unresolvable.
- `conventions.md` **Notable Pattern 2** (Three.js CDN import map, never bundled) is the single
  constraint most likely to be silently broken, and PRD §22 makes it a pass/fail technical
  acceptance criterion — hence the explicit grep-able criteria above.
- `conventions.md` **Notable Pattern 1** (server authority) starts here: position clamping is the
  first and smallest instance of it.
- `conventions.md` **Notable Patterns 3 and 4** (React/Three.js separation; rules emit state,
  views render state) must be established by this story's module seam, because every later story
  inherits it. `key-files.md` names `client/src/game/SceneManager.ts` and
  `shared/schemas/game-state.ts` as the load-bearing files.
- `conventions.md` "Git / Repo Hygiene": base branch is `master`, not `main`. There is no
  `.gitignore` yet — this story adds it.
- `module-map.md` "Target (PRD §13)" is the authoritative path list; follow it exactly rather
  than inventing a layout, since later stories' Notes cite those paths.
- Success criteria are PRD §21 Milestone 0 verbatim; the layout is §13; the import map is §13
  "Three.js loading"; the harness contract is §15.
- **OpenSpec:** there are no prior decisions — `openspec/changes/` and `openspec/specs/` are both
  present and empty, and `openspec/changes/archive/` does not exist. This story therefore
  supersedes, revises and preserves nothing. It is architectural: it should record its own
  decisions (folder layout, pinned Three.js version, tick and broadcast rates, JSON-over-WS) as
  the repo's first OpenSpec change so later stories have something to cite.
- **Two criteria were corrected during implementation, both recorded as
  `openspec/changes/milestone-0-repo-scaffold/design.md` Decision 1 and Decision 4:**
  (1) `tuning.ts` and `messages.ts` are authored as `.js` + `.d.ts` instead. The PRD §13 file
  listing names `.ts`, but that contradicts the same document's requirement that the server be
  plain JavaScript — the pair satisfies both, and is the pattern the PRD itself implies for
  `validation.ts`. STORY-002 must follow it. (2) `@types/three` is permitted as an
  exactly-pinned devDependency; without it the client has no Three.js types at all, and types
  never reach the bundle. Neither weakens the "never bundled" rule, which the pin check still
  proves against the build output.
- `openspec/config.yaml` exists with an **empty, commented-out `context:` block**. This story
  should fill it in with the PRD's binding technical constraints (no Next.js, no monorepo
  framework, no game engine, server is plain JS, Three.js from pinned CDN) so every later
  OpenSpec artifact inherits them.
