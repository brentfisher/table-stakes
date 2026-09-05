---
id: STORY-007
title: "Worker AI: cook and server priority rules"
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/007-worker-ai
worktree_path: /Users/brent/table-stakes-worktrees/story-007-worker-ai
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/12
is_architectural: false
approach_summary: "One system module (worker-system.js) publishing a brigade facade; the plate-runner, greet, payment and auto-restock abstractions stand down per restaurant behind it. §24 tuned to 74.1% via a recorded WORKER_TASK_DURATIONS_MS sweep."
created: 2026-08-28
updated: 2026-08-31
---

# Worker AI: cook and server priority rules

PRD §17 gives explicit, ordered priority lists for the cook and the server, and §24 sets the
balance target: automated staff complete roughly 60–75% of routine work, leaving the player
responsible for the most time-sensitive 25–40%. This story implements those two workers.

The design constraint is stated plainly in §17: the owner-player should outperform workers in
speed and flexibility but must not make them irrelevant. A strong player amplifies automation
rather than replacing every job. Workers that are too good remove the game; workers that are too
bad make the player a janitor.

MVP staffing is one cook and one server per restaurant (§7). Prep workers and hosts are abstracted
— seating is automatic unless the owner intervenes.

## Acceptance Criteria

- [x] `server/src/game/systems/worker-system.js` implements the §17 cook priority in order:
      continue current task if near completion → highest-urgency ticket at assigned station →
      prefer the order with highest patience risk → low-priority prep/restock when idle → emit a
      visible "needs help" signal when blocked.
- [x] It implements the §17 server priority in order: deliver ready food → seat a waiting party if
      a table is free → take an order from a newly seated party → clear a dirty table → handle
      payment → idle near the service area.
- [x] Each worker's current job is exposed in `match_snapshot` so the client can render a role and
      task icon (§14 "Worker role icon").
- [x] The "needs help" signal is a distinct, renderable state, not merely an idle worker.
- [x] Workers move through the restaurant at a defined speed and their travel time counts against
      their task — a server across the room is genuinely slower to deliver.
- [x] The owner performs the same actions faster than a worker; the speed differential is a named
      constant in `tuning.ts`.
- [x] Over one seeded match with no player intervention, automated staff complete 60–75% of
      routine work, and the figure is reported in the dev log so it can be tuned against §24.
- [x] Worker station assignment from setup (`staffAssignments` in `setup_submit`) is honoured.

## Notes

- **Depends on STORY-005** (tickets to work) and **STORY-006** (restock as an idle-cook task).
- PRD §17 "Worker AI system" gives both priority lists verbatim — implement them in that order and
  do not substitute a scoring heuristic; §17 says the rules must be simple and *explainable*.
- `conventions.md`: MVP is one cook, one server, one owner-player, with host behaviour abstracted.
  Worker specialization and hiring are §20 out-of-scope.
- §24 balance hypotheses are the tuning targets; §23 names "player workload becomes exhausting" as
  a risk mitigated by capable baseline workers.
- The visible "needs help" signal feeds STORY-015's alert prioritization (rank 3–4) and
  STORY-016's visual language.
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Not architectural — new system module consuming existing contracts.
