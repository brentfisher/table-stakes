---
id: STORY-022
title: Reconnect handling and match telemetry logging
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

# Reconnect handling and match telemetry logging

§20 puts basic telemetry and logging in MVP scope, §13 lists reconnect grace among server
responsibilities, and §21 Milestone 4 asks for a match telemetry dashboard or log export plus
"no common desync, duplicate-purchase, or invalid-action bugs". §20 also carves out the one form
of replay that *is* in scope: server event logs and debug traces.

STORY-003 guarantees the server does not drop a match when a socket closes. This story finishes the
job on the client side and adds the observability that makes balance work possible — because §24 is
a list of hypotheses to *test*, and testing them needs exported numbers.

## Acceptance Criteria

- [ ] A disconnected player's client detects the drop, shows a reconnecting state, and rejoins the
      running match within the grace window established by STORY-003, restoring full state from the
      next snapshot.
- [ ] Exceeding the grace window ends the match cleanly with a stated reason rather than hanging.
- [ ] Every match writes a structured server-side event log including: seed, selected market, event
      timeline with actual firing times, every customer decision with its §17 reason, every order's
      lifecycle timings, every validated and every **rejected** action, and every upgrade purchase.
- [ ] Rejected actions are logged with the reason — this is the trace that catches invalid-action
      and duplicate-purchase bugs (§21 Milestone 4).
- [ ] A match log can be exported from the running server (an endpoint or a written file) in a form
      that can be diffed between two runs of the same seed.
- [ ] Replaying the same seed with the same inputs produces a matching event timeline in the log —
      the working definition of "no desync" available at MVP.
- [ ] A summary report per match surfaces the §24 balance figures directly: parties served per
      restaurant, player interventions, share of routine work done by staff, upgrade cadence, and
      final score gap over time.
- [ ] Logging is off the hot path — it must not perturb the 10–20 Hz simulation tick.
- [ ] No personally identifying data is logged; there are no user accounts in MVP (§20).

## Notes

- **Depends on STORY-003** (reconnect grace on the server, match seed). The balance summary is most
  useful once **STORY-013** exists, but the raw logging does not depend on it.
- `conventions.md` "Testing": seeded reproducibility is the repo's primary debugging affordance and
  there is no test framework — this story is what turns that property into something observable.
- `conventions.md` **Notable Pattern 8**: decision reasons are already recorded by STORY-010; this
  story persists and exports them.
- PRD §20 (basic telemetry in scope; replays out of scope *except* server event logs and debug
  traces — do not build a replay viewer), §13 "Server responsibilities", §21 Milestone 4, §24.
- Database-backed history and user accounts are explicitly §20 out-of-scope — keep logs in memory
  and/or on disk, no schema.
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Not architectural.
