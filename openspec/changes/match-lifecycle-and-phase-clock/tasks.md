# Tasks — Match lifecycle and phase clock

- [x] `server/src/game/match.js` — the PRD §5 phase machine: `elapsedMs` accumulated from the
      tick, per-phase deadlines carried forward across transitions, `lobby` ending on a
      condition rather than a timer, and `matchPhase`/`timeRemainingMs` in the snapshot
- [x] `server/src/game/simulation-loop.js` — `registerSystem({id, phases?, update,
      onPhaseChange?})`, `stepMatch()` for in-process stepping, and a documented tick order
      (clock, then phase hooks, then systems, then outbox, then per-viewer snapshots)
- [x] `server/src/game/systems/movement-system.js` + `systems/index.js` — movement moved out of
      `match.js` into the seam's first real user, and the single registration list
- [x] `server/src/game/catalogue.js` — `loadCatalogue()` at boot so a malformed catalogue aborts
      startup, plus the `publicMarket()` projection that withholds `eventPool`
- [x] Seeded market selection replacing STORY-001's placeholder `marketIndex`, plus
      `match.createRngStream(name)` for systems (Decision 18)
- [x] Per-viewer snapshots — `Match#toSnapshot(viewerPlayerId)` and
      `connection-manager.broadcastPerViewer`, with the viewer's own state under `you`
- [x] Reconnect grace — hold on disconnect, `join_room.playerId` to reclaim a seat inside the
      window, `match_full` when it cannot be reclaimed, match end with a stated reason when the
      window expires
- [x] `player_ready` added to `messages.js` **and** `IMPLEMENTED_CLIENT_MESSAGE_TYPES` with its
      router handler in the same commit, plus its `validation.js` validator (Decision 7/19)
- [x] `GET /api/markets` returns real definitions; `POST /api/dev/match` seats one player so the
      whole lifecycle runs without a second human; `GET /api/phases` exposes the tuning table
- [x] `shared/constants/tuning.js` — `PHASE_PRESETS`, `PLAYERS_PER_MATCH`, and a script-only
      `smoke` preset; `.d.ts` siblings updated for every widened shape (Decision 4)
- [x] Client renders `matchPhase`/`timeRemainingMs` straight from the snapshot with no local
      clock, shows the revealed market, and has a ready control
- [x] `scripts/check-match-lifecycle.mjs` + `npm run check:lifecycle`
- [x] `scripts/smoke-phases.mjs` + `npm run check:phases`
- [x] `scripts/smoke-milestone0.mjs` updated for a match that no longer sits in `service`, with
      all nine assertions kept and three strengthened

## Verification

The repo has no test framework (Milestone 0 Decision 8). All of the following were run, and
`npm run check` runs all of them:

- [x] `node scripts/check-match-lifecycle.mjs` — 28/28, in-process: phase order, per-phase
      monotonicity, exact boundaries for both the `full` and `prototype` presets, ready-or-timer,
      the seeded market draw, per-viewer snapshots, the reconnect grace window in both
      directions, the `match_complete` envelope, and the registration seam
- [x] `node scripts/smoke-phases.mjs` — 12/12, over two real sockets: identical public market
      data, no private leakage, early service on readiness, every phase in order,
      `match_complete` at both clients, reconnect into a running match, `match_full`
- [x] `node scripts/smoke-milestone0.mjs` — 9/9, including the server-authority clamp and the
      `not_implemented` rejection of `purchase_upgrade`
- [x] `node scripts/check-threejs-pin.mjs` and `node scripts/check-catalogue.mjs` — unaffected
- [x] `npm run build:client` and `npm run build:harnesses` — both run `tsc --noEmit` over
      `../shared`, so every widened `.d.ts` is type-checked
- [x] From a fresh `git clone` of the branch into a temp directory: `npm run install:all` then
      the whole of `npm run check`
