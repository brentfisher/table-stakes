---
id: STORY-010
title: Shared district customer acquisition and restaurant choice
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/010-shared-district-choice
worktree_path: /Users/brent/table-stakes-worktrees/story-010-district-choice
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/8
follow_up_pr_url: https://github.com/brentfisher/table-stakes/pull/9
is_architectural: true
approach_summary: One district pool; both restaurants scored from public observables and combined with the party's own §6 weights; softmax choice including LEAVE_DISTRICT; per-restaurant floors, queues and capped reputation; §17 decision reasons recorded on match state.
created: 2026-08-28
updated: 2026-08-30
---

# Shared district customer acquisition and restaurant choice

This is the story that makes the game competitive. PRD §4.2 and §6 specify one customer population
drawn on by both restaurants: a party entering the district evaluates both and chooses
**probabilistically**, weighing price, menu fit, projected wait, reputation, capacity, and event
affinity.

The stated design rule (§6 "Important design rule") is the constraint that matters most: the
competitor must matter, but the player must still have agency. A player must not lose simply
because the opponent had a better starting menu — customers keep reacting to live queue length,
actual service speed, visible reputation, capacity, prices, event changes, and dish availability
throughout the match. §23 names early snowballing as a top risk, mitigated by keeping the choice
probabilistic and capping runaway advantage.

Every choice records a **decision reason** (§17). That list is not analytics garnish — STORY-014's
results screen is built on it, and without it the match is a black box.

## Acceptance Criteria

- [x] Parties spawn into a single shared district pool, not per-restaurant, and both restaurants
      draw from it (§4.2, §22 "Both restaurants draw customers from one shared district pool").
- [x] `EVALUATE_RESTAURANTS` scores both restaurants from **public, observable** properties: menu
      fit against the party's preferred/disliked tags, prices, projected wait derived from real
      queue length and station backlog, visible reputation, remaining capacity, and event
      affinity — combined using the party's own `serviceSpeedWeight`, `priceWeight`,
      `menuFitWeight`, and `reputationWeight`.
- [x] The choice is **probabilistic**, not argmax: a restaurant with a modestly better score wins
      a proportionally higher share, not all, of comparable parties. Demonstrate with a seeded
      run where a small score edge yields a split, not a sweep.
- [x] A party can choose neither restaurant and `LEAVE_DISTRICT`.
- [x] A full restaurant, or one whose queue exceeds the party's tolerance, loses that party to the
      rival — capacity and live queue length measurably change outcomes mid-match.
- [x] Every decision records one of the §17 reasons: `better_price`, `better_menu_fit`,
      `shorter_projected_wait`, `higher_reputation`, `event_affinity`, `restaurant_full`,
      `customer_abandoned_queue`. Reasons are stored on match state for post-match use.
- [x] Reputation compounds across a match but is **capped** so a match does not become unwinnable
      early (§4.2 "not so strongly that the match becomes unwinnable").
- [x] A seeded scenario in which one player has a clearly weaker menu but faster service shows
      that player winning parties on `shorter_projected_wait` — the "recover through execution"
      requirement of §22 Quality and §21 Milestone 2.
- [x] Different menu and pricing choices visibly produce different customer distributions across
      two seeded runs (§21 Milestone 2 success criterion).
- [x] No client receives the rival's hidden state — only the public properties the model itself
      uses.

## Notes

- **Depends on STORY-004** (parties, profiles, and the `EVALUATE_RESTAURANTS` seam) and
  **STORY-009** (menus and prices to compare). This is the story STORY-004 was deliberately
  scoped to leave room for.
- `conventions.md` **Notable Pattern 7**: customer choice is probabilistic — a small early
  advantage must not snowball. This is a correctness criterion, not a tuning preference.
- `conventions.md` **Notable Pattern 8**: record a decision reason for every choice. STORY-014
  depends entirely on this data existing.
- `conventions.md` **Notable Pattern 1**: the server owns customer restaurant selection.
- PRD §4.2 (competition through a shared market), §6 (choice model and the agency rule), §17
  (decision reason list), §21 Milestone 2, §23 (snowballing risk), §24 (a badly priced menu should
  reduce conversion but never empty the restaurant).
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Architectural: changes the customer spawning model from per-restaurant to district-shared
  and adds a public decision-reason record.
