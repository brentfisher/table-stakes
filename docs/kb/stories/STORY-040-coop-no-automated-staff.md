---
id: STORY-040
title: No automated staff in co-op mode; lock staff-only upgrades
status: in-progress
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: story/040-coop-no-automated-staff
worktree_path: /Users/brent/table-stakes-story-040
base_branch: master
pr_url: null
is_architectural: true
approach_summary: >
  A co-op restaurant (STORY-039's `sharedRestaurant: true`, resolved via `match.restaurantIdFor`)
  gets an EMPTY `staffAssignments`/roster instead of the mandatory cook/server/host roster every
  other mode requires. `worker-system.js#buildStaff` produces zero workers for it (already
  correctly no-ops downstream via the existing `match.brigade?.owns*()` defensive checks — no
  changes needed there). The real work is upstream: `ready-up-menu.js#buildReadyUpPayload`
  building an empty `staffAssignments` for co-op instead of `rosterOf(layout).map(...)`, and
  `setup-validator.js`'s `worker_unassigned` check not firing when there's nothing to assign.
  Then an audit of `upgrades.json`/`upgrade-system.js#KNOWN_EFFECT_KEYS` for any staff-only
  effects, locked in `UpgradeTerminal` for co-op with a stated reason.
created: 2026-09-10
updated: 2026-09-11
---

# No automated staff in co-op mode; lock staff-only upgrades

In every existing mode, `worker-system.js` runs a cook/server/host roster
(`restaurant-layout.json`'s `staff.roster`) that automates 60-75% of routine work (PRD §24). In
co-op mode (STORY-039), there is no roster at all — the two players ARE the staff, and must
personally seat parties, take orders, deliver food, clear tables, and cook.

`worker-system.js` and every system that asks `match.brigade?.owns*()` before falling back to an
abstraction (see that file's own header, "WHAT THE WORKERS TOOK OVER, AND WHAT STAYED
ABSTRACTED") already no-ops correctly for a restaurant with no roster — this story's job is
making sure a co-op restaurant genuinely has none, and that the setup flow (three-stage ready-up
menu, `shared/game-logic/ready-up-menu.js`) doesn't try to assign staff posts that don't exist.

## Acceptance Criteria

- [ ] A co-op restaurant's `staffAssignments`/roster is empty — `worker-system.js#buildStaff`
  produces zero workers for it, and `match.brigade.owns*()` returns `false` for every duty
  (seating, order-taking, delivery, table-clearing, restocking) for that restaurant.
- [ ] The ready-up flow (`ready-up-menu.js#buildReadyUpPayload`, `SetupScreen.tsx`) does not
  present or require staff assignment for a co-op match — it currently builds `staffAssignments`
  generically via `rosterOf(layout).map(...)`, which needs a co-op-aware branch (empty roster in,
  empty assignments out) rather than crashing or silently assigning phantom posts.
- [ ] `setup-validator.js`'s `worker_unassigned` rejection does not fire for a co-op submission
  with no roster to assign.
- [ ] Every §17-abstracted fallback each `owns*()`-gated system uses when unbrigaded (customer
  seating auto-resolves, order pass hand-off teleports, table clearing/payment collection
  auto-resolve, restocking auto-dispatches) is exercised and confirmed correct for a co-op
  restaurant — i.e. co-op without a human doing a given job should behave exactly like an
  unstaffed restaurant already does today, not silently freeze.
- [ ] Upgrades whose effect ONLY matters with automated staff (audit `upgrade-system.js`'s
  `KNOWN_EFFECT_KEYS` and `upgrades.json` for any staff-throughput-specific entries — as of this
  writing the shipped MVP set is mostly player-usable: Serving Tray raises the PLAYER's own carry
  capacity, Faster Grill/Pantry Shelves/Better Seating help regardless of who's cooking/seating)
  are locked in the upgrade terminal UI (`UpgradeTerminal` component) with a stated reason ("no
  staff to upgrade"), not simply hidden — the player should understand why, not wonder if it's a
  bug.

## Notes

- Depends on STORY-039 (co-op mode must exist first).
- Cites: `server/src/game/systems/worker-system.js` header comment, "WHAT THE WORKERS TOOK OVER,
  AND WHAT STAYED ABSTRACTED" — this story PRESERVES that fallback design entirely; a co-op
  restaurant is simply always in the "no brigade" branch every one of those systems already has.
- Cites: `shared/game-data/restaurant-layout.json` `staff._comment` — the roster is currently
  MANDATORY for every match (`setup-validator.js` rejects a submission missing any roster
  worker's post). This story is the first case where "no roster" is a legal, intentional state,
  which needs an explicit mode check rather than an accidental bypass.
- The actual AUDIT of which upgrades are staff-only (last AC) should be done against the real
  current `upgrades.json` at implementation time, not assumed from this story's own guess above.
