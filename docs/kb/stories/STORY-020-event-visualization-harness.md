---
id: STORY-020
title: Event visualization harness
status: pending
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: null
approach_summary: null
created: 2026-08-28
updated: 2026-08-28
---

# Event visualization harness

PRD §15.4 specifies a harness for testing event announcements and the environmental changes that
accompany them — triggering each event, previewing its warning/active/ending states, simulating
foot-traffic changes, toggling district props, lighting, crowd density and weather, and inspecting
the event UI at multiple resolutions.

§9 requires that events be understandable and that they create an actionable decision rather than
just moving a number. This harness is how that gets checked: reading an event banner cold, out of
match context, is the closest available proxy for how a player meets it mid-rush.

## Acceptance Criteria

- [ ] `harnesses/src/event-visualization-harness.ts` implements the `SceneHarness` contract and is
      registered in the `harnesses` array.
- [ ] It launches and is fully usable with the **server not running**.
- [ ] Every event in `shared/game-data/events.json` can be triggered by name from the harness.
- [ ] The warning, active, and ending states of an event can each be previewed on demand and held
      indefinitely for inspection.
- [ ] Foot-traffic changes, district props, lighting, crowd density, and weather are individually
      togglable per §15.4.
- [ ] The event UI (banner, countdown, description) can be inspected at several viewport sizes
      without relaunching.
- [ ] Adding a new event to `events.json` makes it appear in the harness with no harness code
      change — confirming the data-driven requirement of §16 actually holds.
- [ ] `dispose()` tears down cleanly.

## Notes

- **Depends on STORY-001** (harness shell) and **STORY-011** (the event system and its states).
- **Milestone 3, not MVP-required.** §20 names only the layout, customer-flow, and kitchen-bottleneck
  harnesses as in-scope, and §22 requires "at least three" — those three (STORY-001, 018, 019)
  satisfy it. §21 lists this harness under Milestone 3. It is genuinely droppable if scope tightens;
  say so at the `/kickoff` approval gate rather than treating it as mandatory.
- `conventions.md` data-driven content: the "new event appears with no harness change" criterion is
  a direct test of that convention.
- `conventions.md` **Notable Pattern 4** enables mocked-state operation.
- PRD §15.4; §9 (event design rules and the announcement flow this previews).
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Not architectural.
