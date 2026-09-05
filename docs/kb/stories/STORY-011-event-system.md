---
id: STORY-011
title: Seeded event deck and event system
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/011-event-system
worktree_path: /Users/brent/table-stakes-worktrees/story-011-event-system
base_branch: story/011-event-system
pr_url: https://github.com/brentfisher/table-stakes/pull/4
is_architectural: true
approach_summary: 'Service-relative seeded deck anchored at the service transition; §9 flow as one event_announce plus snapshot warning/active/ended; effects published every tick on match.eventEffects with data-derived neutral defaults; high-impact cap enforced while dealing. Measured demand shift +35.0%.'
created: 2026-08-28
updated: 2026-08-29
---

# Seeded event deck and event system

PRD §9 requires events every 30–60 seconds during service, drawn from a **seeded deck** rather than
free randomness — so both players receive an identical event timeline and asymmetry comes only
from their menus, prices, upgrades, and restaurant state. That fairness property is what makes the
match a contest rather than a coin flip, and it is what makes replay and balance testing possible.

This story builds the deck, the announcement flow (teaser → announcement with countdown →
activation → effect → end), and the effect application that actually moves demand. §24 sets the
magnitude: a strong event-dish affinity should move demand 15–40%, not 2–5% — players must
*notice*.

## Acceptance Criteria

- [ ] `server/src/game/systems/event-system.js` builds the match's event timeline from the match
      seed and the active market's `eventPool`; the same seed yields the same timeline.
- [ ] Both players receive the identical timeline; no per-player randomization exists.
- [ ] Events fire every 30–60 seconds during the service phase.
- [ ] The §9 announcement flow is implemented: a teaser/forecast 10–20s ahead where appropriate,
      then an `event_announce` message matching the §12 envelope (`eventId`, `title`,
      `description`, `startsInMs`, `durationMs`), then activation, then end/transition. Warning
      state also appears in `match_snapshot.events` with `state` and `startsInMs`.
- [ ] At least five §9 MVP events are implemented, applying their `effects` from `events.json`:
      `footTrafficMultiplier`, `segmentWeightOverrides`, `dishTagDemandMultipliers`, and
      `partySizeMultiplier`.
- [ ] Effects are read from data — no event's behaviour is hardcoded in the system.
- [ ] **No more than two high-impact events overlap** at any time (§9 design rule), enforced by the
      deck builder, not left to chance.
- [ ] Descriptions are plain language and state what the player should consider, per the §9 example
      banner.
- [ ] A strong event-dish affinity moves demand for matching dishes by 15–40%, measurable across
      two seeded runs with and without the event (§24).
- [ ] Every event creates an actionable decision rather than only changing a number, and no
      implemented event is a pure unavoidable negative (§9 design rules).
- [ ] The setup-phase event forecast (§7) is populated from the timeline without revealing exact
      firing times.

## Notes

- **Depends on STORY-002** (`events.json`, `event_announce` schema) and **STORY-003** (match seed
  and service clock). Its `footTrafficMultiplier` feeds **STORY-004**'s arrival rate and its
  affinity multipliers feed **STORY-010**'s choice model — both were built with a default-1.0 seam
  for exactly this.
- `conventions.md` **Notable Pattern 6**: seeded deck, identical timeline for both players,
  asymmetry only from player state. This is the fairness contract.
- `conventions.md` "Testing": reproducibility is the primary debugging affordance, and the event
  timeline is the main thing a seed must reproduce.
- `conventions.md` data-driven content: effect values live in `events.json`.
- PRD §9 in full; §16 for the `baseball_game_ends` effect vocabulary; §24 for the magnitude target;
  §7 for the setup forecast.
- The `power_fluctuation` event is what makes STORY-008's station-repair interaction reachable.
- The event **visualization** harness is STORY-020, and the HUD banner is STORY-015.
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Architectural: new system module, new outbound message type, and a fairness-critical
  determinism contract.
