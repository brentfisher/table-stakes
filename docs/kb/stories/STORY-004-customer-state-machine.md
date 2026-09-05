---
id: STORY-004
title: Customer party state machine and spawning
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/004-customer-state-machine
worktree_path: /Users/brent/table-stakes-worktrees/story-004-customer-state-machine
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/5
is_architectural: true
approach_summary: >
  Implemented the §8 customer state machine and §17 acquisition flow for a single restaurant as
  a registered system (customer-system.js), with EVALUATE_RESTAURANTS left as an explicit seam
  for STORY-010's two-restaurant choice model. Hidden per-party profile (budget, patienceSeconds,
  jittered ±15%; the four choice weights; preferred/disliked tags) is kept off the wire via an
  explicit field-allowlist snapshot projection. One narrow, disclosed exception to "never edit
  match.js": toSnapshot()'s `customers` field now reads `this.customers ?? []` since there was no
  other integration point for a system's snapshot data. Verified by scripts/check-customer-lifecycle.mjs
  (23/23), wired into npm run check.
created: 2026-08-28
updated: 2026-08-29
---

# Customer party state machine and spawning

PRD §8 defines the state model every customer party moves through, and §17 defines how a party
generates an order and evaluates its visit. This story implements that lifecycle server-side for
a **single** restaurant — the shared-district competition between two restaurants is STORY-010,
which plugs into the `EVALUATE_RESTAURANTS` state this story creates.

The deliverable is parties spawning from a market's `baseFootTrafficPerMinute`, walking the full
path from district entry to review, and carrying a hidden preference profile drawn from their
segment. Satisfaction accrues from the §8 factor list. The customer is the thing the whole game
measures, so getting the state machine and the satisfaction inputs right here is what makes
STORY-010's choice model and STORY-013's scoring meaningful.

## Acceptance Criteria

- [ ] `server/src/game/systems/customer-system.js` implements the §8 state machine:
      `ENTER_DISTRICT → EVALUATE_RESTAURANTS → APPROACH_OR_QUEUE → SEATED → ORDERING →
      WAITING_FOR_FOOD → EATING → PAYING → LEAVING → REVIEW/REPUTATION_IMPACT`, using the enum
      from `shared/schemas/game-state.ts`.
- [ ] All five exit states are reachable and reached under the right conditions:
      `CHOOSE_RIVAL`, `LEAVE_DISTRICT`, `ABANDON_QUEUE`, `CANCEL_ORDER`, `LEAVE_ANGRY`.
- [ ] Each party is assigned a segment (weighted by the active market's `segmentWeights`) and a
      hidden preference profile with the §6 fields, seeded from the match seed so the same seed
      produces the same arrival sequence.
- [ ] Party size is drawn per segment; `partySize` affects table requirements.
- [ ] Arrival rate derives from the market's `baseFootTrafficPerMinute` and is multiplied by the
      active event's `footTrafficMultiplier` when STORY-011 is present (read the multiplier from
      match state; default 1.0 when no event system is loaded).
- [ ] Patience declines over time from `patienceSeconds`, and a party abandons the queue or
      leaves angry when it is exhausted.
- [ ] Satisfaction is computed from the §8 factor list — wait to be seated, wait to order, wait
      for food, dish quality, dish-to-preference match, price fairness, order accuracy, table
      cleanliness, event relevance, recovery actions, and total visit duration against the
      party's own patience profile.
- [ ] Customer entities appear in `match_snapshot.customers` with the fields
      `shared/schemas/game-state.ts` declares, including current state and a normalized patience
      value the client can render.
- [ ] **The hidden profile is never serialized to the client** — the snapshot carries observable
      state (position, party size, state, patience band) but not `budget`, the weights, or the
      preferred/disliked tags.
- [ ] Running one full match against a fixed seed produces roughly the §24 balance hypothesis of
      40–90 parties per restaurant, and the figure is reported in the dev log.

## Notes

- **Depends on STORY-002** (segment data and state enum) and **STORY-003** (match clock and seed).
- `conventions.md` **Notable Pattern 1**: satisfaction, patience, and spawning are server-owned;
  the client renders them and computes none of them.
- `conventions.md` **Notable Pattern 9** (qualitative guidance, not simulation math) is why the
  hidden profile must not cross the wire — PRD §6 states the player sees broad market signals,
  not exact individual math.
- `conventions.md` "Testing": seeded and reproducible. The arrival sequence is part of what a
  seed must reproduce.
- `module-map.md`: this file is `server/src/game/systems/customer-system.js`; one file per system.
- PRD §8 is the state machine and satisfaction factors, §6 is the segment table and the profile
  example, §17 is the order-generation sequence.
- Deliberately excludes the two-restaurant choice model (STORY-010) — implement
  `EVALUATE_RESTAURANTS` against a single restaurant with a seam STORY-010 can extend.
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Architectural: introduces a new system module and a public snapshot entity shape.
