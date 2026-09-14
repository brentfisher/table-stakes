---
type: Conventions
title: Conventions — table-stakes
description: Code style, testing, file organization, naming, and notable patterns actually observed in the table-stakes codebase, cited against OpenSpec decisions where numbered.
generated: { by: kb-generate/claude-sonnet-5, at: 2026-09-13T20:30:00Z }
sources:
  - id: crawl
    resource: git@github.com:brentfisher/table-stakes.git
    title: "table-stakes @ 05aa5f5eb44ccbf452581766d20bfe080a11e8f8"
---

# Conventions — table-stakes

These are now **observed in the code**, not just mandated by the PRD. Where a rule has a
number, it is an OpenSpec decision across the 14 change directories in
`openspec/changes/*/design.md` (now 78 numbered decisions) — cite it by heading.

## Code Style

- **Server is plain JavaScript. Client, harnesses and type declarations are TypeScript.**
  Anything the server imports from `shared/` is `.js` with a sibling `.d.ts` (Decision 4) —
  the server must never be made to compile TS. This overrides PRD §13's file listing, which
  names `.ts` for `tuning` and `messages`.
- ESM throughout; the root `package.json` sets `"type": "module"` so bare `shared/*.js` resolves.
- Plain CSS (`client/src/styles/app.css` is now ~2,600 lines). No UI library.
- JSON over the WebSocket, for debuggability.
- Comments carry *reasoning*, often at length, and frequently cite a PRD section or a decision
  number. Match that density — it is the house style and reviewers rely on it. This has only
  intensified as the codebase has grown: system headers and tuning-constant docstrings now
  routinely explain *why a number is what it is*, not just what it does.

## Testing

**There is no test framework and the PRD names none.** The suite is `npm run check`: 34
`check-*.mjs` scripts plus 5 `smoke-*.mjs` and a standalone `measure-district-crowd-density.mjs`,
chained in `package.json`'s `check` script. Most run **in process**, constructing a `Match` and
stepping it with synthetic `dtMs`, so a full service phase takes milliseconds. Only the smokes
use real sockets.

Three rules, each learned from a real defect:

1. **Register every system your work integrates with.** Per-system checks hid a broken seam for
   three merges (see key-files.md).
2. **Falsify a new check before trusting it** — break the code it covers, confirm it fails,
   restore. Three checks here have passed against broken code.
3. **Measure, don't assert.** Balance claims carry a measured number. Where a figure misses its
   PRD §24 target, it is reported as a finding rather than tuned away — `measure-district-
   crowd-density.mjs` (STORY-046) is the clearest example: it measures real numbers from a
   real seeded `Match` and reports them even though they miss target (see Open Balance Gaps).

`scripts/lib/server-process.mjs` spawns a server on a high port and kills it **by PID** —
never `pkill` with a pattern, which matches unrelated processes on this machine.

## File / Module Organization

- Four independently runnable apps plus `shared/`, `scripts/`, `assets/`. **No monorepo
  framework**, no workspaces. No Next.js, no game engine.
- One file per simulation system under `server/src/game/systems/`, registered in `index.js`
  (now 15 systems, in three loose tiers — core simulation, operations/management, meta —
  see `architecture.md`).
- All balance content is JSON under `shared/game-data/` (13 tables); all tunables in
  `shared/constants/tuning.js`, appended in a named block per story. **Never inline a constant.**

## Naming

Server files kebab-case; client class modules PascalCase; harnesses `*-harness.ts`. Data ids
and message `type` values `snake_case`. Durations are milliseconds with a `Ms` suffix —
`patienceSeconds` is the deliberate exception.

## Notable Patterns

1. **Server authority is absolute** (Decision 2). The client sends *intent*; the server
   integrates, clamps, validates and broadcasts. Money, choice, scores, stock and outcomes are
   never computed in the browser.
2. **Gameplay lives in registered systems, not `match.js`** (Decision 15). Adding one is a new
   file plus a line in `systems/index.js`. Registration order is a contract.
3. **The snapshot is per-viewer.** Public state at the top level, the viewer's own under `you`.
   That seam is how an opponent's menu and prices stay off the wire (§18, Decision 16).
4. **Named RNG sub-streams** via `match.createRngStream(name)` (Decision 18) — so one system's
   draws cannot shift another's sequence. Determinism is the primary debugging affordance.
5. **Systems talk through published facades, not internals** — `match.kitchen`,
   `match.dishAvailability`, `match.eventEffects`, `match.pantry`, read defensively so a system
   works whether or not its counterpart is registered.
6. **Declared-but-unimplemented message types are rejected**, never silently ignored
   (Decision 7). Only add to `IMPLEMENTED_CLIENT_MESSAGE_TYPES` alongside a real handler.
7. **Three.js is CDN-only, pinned, never bundled** (Decision 1). `@types/three` is allowed as a
   devDependency at exactly `THREE_VERSION`. Enforced by `check-threejs-pin.mjs`.
8. **Customer choice is a softmax including "walk away", never argmax** — §23's snowballing
   risk. Reputation compounds but is capped.
9. **Every customer decision records a §17 reason.** The results screen and recap flow are both
   built on it; `decisionReason` stays `null` where no real comparison happened rather than
   being fabricated.
10. **Players see qualitative guidance, never simulation math** — the six §7 labels only.
11. **React owns UI, Three.js owns the scene**, and rules emit state while views render it —
    which is what lets harnesses mount the real scene with mocked state.
12. **The bot is a real client, not a shortcut.** `server/src/game/bot/bot-socket.js` drives an
    actual WebSocket connection through the same message protocol and server authority as a
    human — solo/dev play reuses every system unmodified rather than special-casing a bot path.
13. **A tunable's docstring may pin it to an earlier constant on purpose**, so that toggling an
    unrelated flag isolates one variable. Example: `WORKER_RESTOCK_THRESHOLD_UNITS` is
    deliberately set equal to `INVENTORY_RESTOCK_THRESHOLD_UNITS` so that flipping
    `INVENTORY_AUTO_RESTOCK` changes *who* walks to the pantry, never *when*.

## Git / Repo Hygiene

Base branch is `master`. One story per branch `story/NNN-slug`, cut from a freshly pulled
master, merged by merge commit. `openspec/` and `.claude/` are committed. The PRD PDF is
committed so worktrees inherit the spec.

## Open Balance Gaps (unresolved, deliberately)

- **A real 1v1 still falls short of PRD §24's 40–90 parties served per restaurant.** STORY-046
  measured it directly (mean 29.6 guestsServed/restaurant across 30 runs) and explicitly
  declined to raise `market.baseFootTrafficPerMinute` to compensate, deferring that call to a
  dedicated balance story — see `docs/kb/stories/STORY-046-district-crowd-density-tuning.md`.
  Still open as of this crawl.
- **`INVENTORY_AUTO_RESTOCK = true`** remains the abstracted-restocker default even though
  STORY-007 (worker AI) shipped a real cook who can walk to the pantry. The flag is now a
  deliberate A/B lever (see Notable Pattern 13) rather than a to-be-deleted stopgap — but
  whether it should default `false` in the shipped game has still never been decided.
- **`orders[]` still publishes a rival's ticket `dishId` and `price`** during service
  (`toPublicOrderSnapshot` in `order-system.js`). §18 only forbids this during setup, so it may
  be intentional — but it has never been decided, and it hasn't changed since the last crawl.
