---
id: STORY-013
title: Scoring, penalties, tie-breakers, and match completion
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/013-scoring-and-win-condition
worktree_path: /Users/brent/table-stakes-worktrees/story-013-scoring-and-win-condition
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/15
is_architectural: true
approach_summary: "score-formula.js is a pure, dependency-free module (composite score, penalty sum, 4-rung tie-break, winner) built and verified independently. scoring-system.js is the wiring, registered last of every gameplay system, reading match.districtSummary/orderSummary/upgradeSummary (each already-established 'outlives its own teardown' summaries) plus player.setup into match.finalResults, which match.js#matchCompleteMessage() now reads instead of the STORY-003 empty-object placeholder."
created: 2026-08-28
updated: 2026-08-31
---

# Scoring, penalties, tie-breakers, and match completion

PRD §11 is explicit that the winner is decided by a **composite** Restaurant Score, not raw
revenue: a pure revenue score encourages degenerate pricing and ignores the service-management
fantasy the whole game is built on. This story implements that score, its penalties, and its
tie-breakers, and fills in the `match_complete` results payload STORY-003 left empty.

MVP weighting is given: net revenue 40%, customers served 20%, average satisfaction 25%,
reputation 10%, event objectives 5%.

## Acceptance Criteria

- [x] `server/src/game/systems/scoring-system.js` computes
      `Restaurant Score = Revenue + Guests Served + Satisfaction + Reputation Bonus + Event
      Objective Bonus − Penalties` with the §11 MVP weights, read from `tuning.ts`.
- [x] **Net** revenue is used (revenue minus ingredient and upgrade expenses), not gross.
- [x] Penalties are applied for the §11 list: customer abandonment, canceled orders, severe
      dissatisfaction, unserved food waste, and failing a critic event.
- [x] Tie-breakers resolve in the §11 order: higher average satisfaction → more customers served →
      higher net revenue → fewer abandoned parties.
- [x] Event objective bonuses are earned from the active event timeline (5% of score weight).
- [x] `match_complete` carries a populated per-player results object with everything §11
      "End-of-match results" lists: final score, revenue, expenses, net profit, customers served,
      customers lost to rival, average satisfaction, average wait time, best-selling dishes,
      highest-margin dishes, event performance, upgrades purchased, and customer-segment
      breakdown.
- [x] Scores are computed **only** on the server and are never derived client-side.
- [x] A seeded match where one player maximizes revenue through extreme pricing while tanking
      satisfaction does **not** automatically win — verify with a scratch run.
- [ ] Across a set of seeded runs, the score gap between comparably-played restaurants remains
      recoverable until the final 20–30% of the match (§24). **Not measured — see notes below.**

## Implementation notes (post-hoc)

- **§24's recoverability hypothesis was not empirically measured.** This requires a set of
  seeded FULL-LENGTH matches with real, ongoing scoring pressure (a genuine lead one side could
  plausibly claw back from) — meaningful only once real gameplay agents (a bot, per STORY-017,
  still pending) actually play out a match rather than sitting idle. `check-scoring.mjs` verifies
  the formula and wiring are correct at every layer (including the literal "extreme pricing
  doesn't auto-win" AC, forced deterministically), which is the prerequisite for this measurement
  ever being meaningful, but does not itself run the sweep. Same shape of gap as STORY-012's §24
  affordability-cadence log: mechanism built and tested, real number needs a real match.
- Event Objective Bonus and the critic-event penalty are both structural interpretations, not
  literal PRD mechanics — see the PR body for the exact definitions and why (nothing in this
  codebase yet spawns `food_critic_spotted`'s own special party; building that here would be
  scope creep into whichever story owns party spawning).
- Could not capture a screenshot (this story has no UI surface — the results SCREEN is
  STORY-014's). PR #15 carries a Mermaid diagram of the scoring pipeline instead.
- PR #15 merged into `master`.

## Notes

- **Depends on STORY-004** (satisfaction and reputation), **STORY-005** (revenue, order quality,
  waste), **STORY-010** (customers lost to rival, decision reasons), and **STORY-011** (event
  objective bonus — this is the 5% component and is easy to miss).
- `conventions.md` **Notable Pattern 1**: match scoring and results are in the server's ownership
  list.
- `conventions.md` data-driven content: weights and penalty magnitudes belong in `tuning.ts`.
- PRD §11 in full; §22 ("The winner is determined by a composite score, not raw money alone");
  §24 for the recoverability hypothesis.
- The results **screen** is STORY-014; this story produces the data it renders.
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Architectural: defines the win condition and finalizes a public message payload.
