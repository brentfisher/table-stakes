---
id: STORY-019
title: Kitchen bottleneck harness
status: pr-opened
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/019-kitchen-bottleneck-harness
worktree_path: /Users/brent/table-stakes-worktrees/story-019-kitchen-bottleneck-harness
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/21
is_architectural: false
approach_summary: "A new harnesses/src/kitchen-bottleneck-harness.ts implementing the SceneHarness contract, registered third in the harnesses array alongside restaurant-layout-harness and customer-flow-harness (STORY-018's own pattern is the direct template: local mocked-state object, no WebSocket/room, control panel mutating that state and re-rendering the shared RestaurantScene view components). Reuses the kitchen/station/worker/pantry rendering already built for STORY-016 (station queue-vs-shortage indicators, worker role/task icons) rather than forking it. Adds a measurement layer -- timestamp task start/completion in the mock state and display elapsed ms on screen, comparable across configuration changes, which is this story's distinguishing control per PRD §15.3. Controls: queue preset orders, disable a worker, empty an ingredient bin, slow a station, trigger/resolve an equipment failure (reusing STORY-008's repair interaction shape outside a match), toggle production speed, spawn ready dishes at the pass, and drive an ownable avatar through cook/plate/carry/restock interventions to compare owner-vs-worker completion time. Touches only harnesses/src/ -- no server or shared/ changes, no new wire contract."
created: 2026-08-28
updated: 2026-09-04
---

# Kitchen bottleneck harness

PRD §15.3 specifies a harness for testing station queues, ingredient shortages, finished-food
pickup, worker behaviours, and owner interventions — the cluster of systems that produce the
game's core moment-to-moment decision. It is the third of the three MVP-required harnesses.

Its distinguishing control is measurement: §15.3 asks for task-completion timing, which makes this
the tool for tuning STORY-005's station durations and STORY-007's worker speeds against §24's
balance hypotheses without running full matches.

## Acceptance Criteria

- [ ] `harnesses/src/kitchen-bottleneck-harness.ts` implements the `SceneHarness` contract and is
      registered in the `harnesses` array.
- [ ] It launches and is fully usable with the **server not running**.
- [ ] Controls implement §15.3: queue preset orders, disable a worker, empty an ingredient bin,
      slow a station, trigger an equipment failure, toggle production speed, spawn ready dishes at
      the service pass, and measure task completion time.
- [ ] Measured task-completion times are displayed on screen and are comparable across
      configuration changes.
- [ ] An ingredient shortage and a long station queue are visually distinguishable in the harness,
      confirming STORY-016's requirement holds.
- [ ] The owner can be spawned and driven through interventions (cook, plate, carry, restock) to
      compare owner-vs-worker completion time — the §17 "owner outperforms but does not replace"
      differential is directly observable.
- [ ] Equipment failure and repair can be triggered and resolved, exercising STORY-008's repair
      interaction outside a match.
- [ ] `dispose()` tears down cleanly.

## Notes

- **Depends on STORY-001** (harness shell), **STORY-005** (stations and tickets), **STORY-006**
  (bins and shortages), and **STORY-007** (worker behaviours to disable and observe).
- **MVP-required** — the third of §20's three in-scope harnesses and part of §22's technical
  acceptance criteria. Also a named §21 Milestone 1 deliverable.
- `conventions.md` "Testing": with no test framework in the repo, this harness plus timing readout
  is the primary way STORY-005 and STORY-007 acceptance criteria get verified numerically.
- `conventions.md` **Notable Pattern 4** is what makes mocked-state operation possible.
- PRD §15.3; §17 for the owner/worker differential; §24 for the tuning targets.
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Not architectural.
