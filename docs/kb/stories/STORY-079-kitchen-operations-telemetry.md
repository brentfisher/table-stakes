---
type: Story
id: STORY-079
title: Kitchen operations telemetry for prep effectiveness and shortage pressure
description: Aggregate the PRD's kitchen metrics at lifecycle transitions rather than per tick, so speculative-prep effectiveness, shortage incidents and station utilisation can be tuned from measured numbers.
status: pending
# `status` here is flow's workflow vocabulary (pending/approved/in-progress/ready-for-pr/
# pr-opened/merged/...), not OKF's draft/stable/deprecated lifecycle — kept as-is because
# kickoff and open-prs read/write it directly across every repo using flow. Don't rename it.
prd_source: /Users/brent/table-stakes/docs/cooking-prd-interactive.pdf
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: null
approach_summary: null
created: 2026-09-23
updated: 2026-09-23
---

# Kitchen operations telemetry for prep effectiveness and shortage pressure

Rollout step 6 (p. 15) is the tuning pass: "use speculative-prep effectiveness, shortage incidents,
and kitchen utilization to tune hold windows, costs, and cook durations." The PRD's telemetry list
on p. 14 names fourteen metrics per match and per restaurant, from dishes started split by demand
versus prep, through speculative dishes later served versus wasted, queue-to-cook and
completion-to-service latencies, station utilisation by type, shortage incidents, quick-restock
activations and prevented blocks, to kitchen camera entries and menu selection rate.

This is deliberately a late story and deliberately its own. PRD Story 5's acceptance criteria say
outright that "the results and telemetry systems can eventually explain waste or prep
effectiveness, but no new results-screen work is required for the first implementation" — so the
prep stories ship without it, and this story collects what they made measurable. It is also the
story that makes STORY-073's hold windows and STORY-076's restock costs tunable from data rather
than from argument, which is why it belongs after all of them rather than woven through each.

The shape is already set by `server/src/game/systems/telemetry-system.js`. That system exists for
exactly one reason its header states — revenue is a live number with no history, so it samples on
an interval — and it writes through `Match#logEvent` onto `match.telemetry`, which
`telemetry-export.js` reports. The PRD's own instruction matches that file's existing discipline:
"Telemetry should be aggregated at meaningful lifecycle transitions, not written per simulation
tick." Most of these fourteen metrics are transition events (a dish started, a prep dish served, a
prep dish discarded, a restock confirmed), not samples, so the natural implementation is counters
incremented where those transitions already happen, not a second sampler.

Two of the fourteen are client-side by nature — kitchen camera entries and time in kitchen mode
(STORY-067), and queue-board interaction and station-menu selection rate (STORY-071). The server
cannot see either today. Whether to wire a client telemetry path for them or record them as
deliberately unmeasured is a scope decision this story must make explicitly rather than quietly
dropping four metrics off the list.

## Acceptance Criteria

**Coverage**

- [ ] Every metric on the PRD's p. 14 list is either implemented or explicitly recorded as not
      implemented with its reason — none is silently dropped.
- [ ] Counters are incremented at the lifecycle transition that causes them, not sampled per tick
      (PRD p. 14; `telemetry-system.js`'s existing sampling is for live values with no history and
      is not the pattern for a countable event).
- [ ] Metrics are recorded per match **and** per restaurant, and de-duplicated for co-op the way
      `telemetry-system.js` already handles it via `restaurantIdFor` — a co-op match's two players
      share one kitchen ledger and must not produce a phantom zero-valued second restaurant.

**Specific metrics**

- [ ] Speculative prep is measurable end to end: dishes started as prep, prep dishes later served,
      and prep dishes wasted/expired/discarded, all three, so effectiveness is a ratio and not a
      raw count.
- [ ] Shortage incidents, quick-restock activations and restock prevented-block counts are
      recorded, with "prevented block" defined precisely in a comment — it is the metric most
      likely to be defined into meaninglessness.
- [ ] Station utilisation is recorded by station type.
- [ ] The two client-side metric groups (kitchen camera entries/time, queue-board and station-menu
      interaction rate) are either wired through a client telemetry path or recorded as
      deliberately unmeasured with the reason. State which in the PR body.
- [ ] `telemetry-export.js` reports the new metrics alongside the existing ones.

**Constraints and verification**

- [ ] Recording adds no measurable cost to the 20 Hz tick — no per-tick writes, no per-tick
      allocation in a hot path.
- [ ] Determinism is preserved: telemetry reads state, never draws from an RNG stream, and a
      seeded match produces identical telemetry across runs. Assert it.
- [ ] A `scripts/check-*.mjs` runs a full seeded match with prep and shortage activity and asserts
      each counter moved for its own cause and that a co-op match reports one restaurant's figures
      once. Registers `order`, `inventory`, `customer`, `worker` and `telemetry`.
- [ ] The check is falsified before it is trusted. Say so in the PR body.
- [ ] Measured numbers from at least three full seeded matches are reported in the PR body —
      reported as findings even where they look wrong, per `conventions.md` Testing rule 3.
- [ ] `npm run check` passes.

## Notes

- **PRD sections:** "Telemetry", p. 14 (the fourteen metrics and the aggregation instruction);
  rollout step 6, p. 15.
- **Dependency: this story runs last.** STORY-072/073 make prep effectiveness and waste
  measurable; STORY-076 makes restock activations measurable; STORY-067/071 own the two
  client-side metric groups. It blocks none of them.
- **`key-files.md`:** `server/src/game/systems/telemetry-system.js` and
  `server/src/game/scoring/telemetry-export.js` are the existing seam. `Match#logEvent`'s own
  header explains why a plain object push is safe to call from a tick.
- **This story preserves Decision 18 / `conventions.md` Notable Pattern 4** — named RNG
  sub-streams and reproducibility. Telemetry must not perturb any sequence.
- **This story preserves `telemetry-system.js`'s registration-order note** — it registers last,
  depends on nothing and nothing depends on it. Keep that true.
- **`conventions.md` Testing rule 3, "Measure, don't assert"**, and the Open Balance Gaps section
  are where this story's numbers belong if they miss their intent. `measure-district-crowd-
  density.mjs` (STORY-046) is the model: it measured real numbers from a real seeded `Match` and
  reported them even though they missed target, rather than tuning to hit it.
- **PRD Story 5's explicit deferral** — "no new results-screen work is required for the first
  implementation" — is why this story exists separately and why it carries no results-screen or
  recap work unless a later story asks for it.
