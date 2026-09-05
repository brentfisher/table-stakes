---
id: STORY-021
title: Upgrade preview harness
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

# Upgrade preview harness

PRD §10 asks that upgrades produce clearly visible physical changes and prefer altering decisions
or spatial flow over bumping a scalar. §15.5 gives the harness that verifies it: toggle each
upgrade tier, compare before/after station visuals, preview capacity additions and performance
overlays, and test the upgrade terminal's interaction range.

Interaction range is worth calling out — STORY-012 makes purchases fail outside it, and range that
is too tight is indistinguishable from a broken purchase during a live rush. This harness is where
that gets tuned.

## Acceptance Criteria

- [ ] `harnesses/src/upgrade-preview-harness.ts` implements the `SceneHarness` contract and is
      registered in the `harnesses` array.
- [ ] It launches and is fully usable with the **server not running**.
- [ ] Every upgrade in `shared/game-data/upgrades.json` can be toggled on and off, at each tier.
- [ ] A before/after comparison of the affected station or prop is available side by side or via a
      toggle, per §15.5.
- [ ] Capacity-adding upgrades (e.g. Additional Table) preview the added seating in place.
- [ ] A performance overlay shows the numeric effect of the selected upgrade (e.g. grill duration
      before and after) so the visible change and the mechanical change can be checked together.
- [ ] The upgrade terminal's interaction range is rendered as a visible volume and is adjustable in
      the harness, so it can be tuned rather than guessed.
- [ ] Adding an upgrade to `upgrades.json` makes it appear in the harness with no harness code
      change.
- [ ] `dispose()` tears down cleanly.

## Notes

- **Depends on STORY-001** (harness shell) and **STORY-012** (the upgrade catalogue and its visible
  effects).
- **Milestone 3, not MVP-required** — same reasoning as STORY-020. §22's "at least three harnesses"
  is satisfied by STORY-001, 018, and 019; §21 puts this one in Milestone 3. Droppable under scope
  pressure; flag it as such at the `/kickoff` approval gate.
- `conventions.md` data-driven content is directly tested by the "new upgrade needs no harness
  change" criterion.
- PRD §15.5; §10 (three tiers max, visible physical change, no exponential chains).
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Not architectural.
