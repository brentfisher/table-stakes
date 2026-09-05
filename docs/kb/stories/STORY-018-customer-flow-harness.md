---
id: STORY-018
title: Customer flow harness
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/018-customer-flow-harness
worktree_path: /Users/brent/table-stakes-worktrees/story-018-customer-flow-harness
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/20
is_architectural: false
approach_summary: "A new harnesses/src/customer-flow-harness.ts implementing the SceneHarness contract from harness-shell (the same one restaurant-layout-harness already uses), registered in the harnesses array. Reuses RestaurantScene's existing entity/view components (customer bodies, patience rings, route-line rendering already built for STORY-004/STORY-016) driven entirely by a local mocked-state object -- no WebSocket, no room, no React game shell. A small local control panel (spawn-by-segment, party size, forced decision outcome, patience slider, queue-size slider, route-line/state-label toggles) mutates that mock state directly and re-renders the scene, satisfying the 'no full rebuild-and-relaunch' AC since it's just JS state changes re-driving the same mounted scene. Every §8 customer state (including all five exit states) gets a dedicated control to force it into view. dispose() must tear down all Three.js scene objects and any listeners the harness itself added, verified by mounting/switching harnesses twice with no leaked objects. Touches only harnesses/src/ -- no server or shared/ changes, no new wire contract."
created: 2026-08-28
updated: 2026-09-04
---

# Customer flow harness

PRD §15.2 specifies a standalone harness for visualizing customers entering, choosing a restaurant,
queuing, seating, eating, paying, and leaving — with controls to tune pathing and crowd density and
to validate that customer states are *understandable*.

This is one of the three harnesses §20 puts in MVP scope, and §22 makes "at least three visual
harnesses exist and run independently from a live multiplayer match" a technical acceptance
criterion. The restaurant layout harness ships in STORY-001; this and STORY-019 complete the
required three.

Critically, it must run on **mocked state** with no backend — that is only possible because
`conventions.md` Notable Pattern 4 keeps rules and views separate.

## Acceptance Criteria

- [ ] `harnesses/src/customer-flow-harness.ts` implements the `SceneHarness` contract and is
      registered in the `harnesses` array.
- [ ] It launches and is fully usable with the **server not running** — no backend, no room, no
      auth, no React game shell.
- [ ] It reuses the same scene/entity/view components as the game (`conventions.md` Notable
      Pattern 4), driven by mocked state rather than a live simulation.
- [ ] Controls implement §15.2: spawn a customer of a chosen segment, change party size, force the
      decision outcome (player restaurant / rival / abandon), adjust patience, simulate queue size,
      and toggle route lines and state labels.
- [ ] Every §8 customer state — including all five exit states — can be entered on demand and is
      labelled on screen.
- [ ] Route lines show the party's intended path, making pathing problems visible.
- [ ] Changing a scene configuration value is reflected without a full rebuild-and-relaunch cycle
      (§15 "launch a harness, alter a scene configuration, and immediately inspect the result").
- [ ] `dispose()` tears down cleanly — switching harnesses twice leaks no scene objects or
      listeners.

## Notes

- **Depends on STORY-001** (harness shell and `SceneHarness` contract) and **STORY-004** (the state
  machine and view components it visualizes).
- **MVP-required**: §20 names restaurant layout, customer flow, and kitchen bottleneck as the three
  in-scope harnesses, and §22 makes three harnesses a pass/fail technical criterion. Do not treat
  this as droppable polish — unlike STORY-020 and STORY-021, which are Milestone 3.
- `conventions.md` "Testing": harnesses are the PRD's substitute for a visual test framework, and
  this repo has no test framework at all.
- `conventions.md` **Notable Pattern 4** is the enabling constraint — if the view layer reads
  simulation internals, this harness cannot exist.
- PRD §15 "Goal" and §15.2; §8 for the state list.
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Not architectural — a new harness over existing contracts.
