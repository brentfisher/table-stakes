# Milestone 0 — repository scaffold and technical spike

## Why

The repository was greenfield: one commit, one file. Nothing in the PRD could be built until
the folder layout, two runnable applications, the wire transport, and the Three.js loading
strategy existed — and if that work had been done inside several parallel feature branches,
each would have invented its own `package.json`, server entry point and Vite config, producing
merge conflicts no reviewer could resolve.

This change establishes the shared ground everything else branches from. It corresponds to
PRD §21 Milestone 0 and to STORY-001 in the slicing pass.

## What changes

- The PRD §13 repository layout: `shared/`, `server/`, `client/`, `harnesses/`, `assets/`, plus
  `scripts/` for repo checks. Four independent `package.json` files with a coordinating root —
  deliberately **not** a monorepo framework.
- An authoritative Express + `ws` server that serves the built client, exposes `/health`,
  `/api/version`, `/api/markets` (501 for now), `/api/rooms*` and `/api/dev/match`, and runs a
  20 Hz simulation loop broadcasting snapshots at 10 Hz.
- A React + Three.js client where two owner avatars move with server-clamped, replicated
  positions and client-side interpolation.
- Three.js loaded from a **pinned CDN import map**, never bundled, enforced by
  `scripts/check-threejs-pin.mjs`.
- The harness shell implementing the PRD §15 `SceneHarness` contract, plus the restaurant
  layout harness, running with no backend.
- Deterministic seeded match configuration.

## Non-goals

No gameplay. No customers, orders, workers, inventory, menus, prices, money, events, upgrades
or scoring. Client message types beyond `join_room` and `player_input` are declared and
explicitly rejected with `not_implemented` rather than silently ignored.
