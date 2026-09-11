---
id: STORY-041
title: Player-driven timed cooking, with a "waiting to cook" indicator
status: in-progress
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: story/041-coop-timed-cooking-and-waiting-indicator
worktree_path: /Users/brent/table-stakes-story-041
base_branch: master
pr_url: null
is_architectural: false
approach_summary: >
  Verify `action-validator.js#resolveCookOrPlate` already runs a player-started ticket through
  the real `kitchen.startTicket()`/`stationSteps` clock (it should, per that file's own "the
  owner performs the same actions faster than a worker, as a rate" design) rather than resolving
  instantly, and fix if not. Give it the same `OWNER_TASK_DURATIONS_MS`-style cooldown feel a
  worker's `tend_station` gets. Add a small new in-world visual indicator in
  `RestaurantScene.ts` (extending `buildStationIndicators`) for "queued at this station, not yet
  started" — driven from `kitchen.queuedTicketsAt`, no new server state. This story is
  implementable and testable against current master (co-op mode already exists via STORY-039)
  without waiting on STORY-040 — it just matters most once STORY-040 lands.
created: 2026-09-10
updated: 2026-09-11
---

# Player-driven timed cooking, with a "waiting to cook" indicator

With no automated cook in co-op mode (STORY-040), a player's own `cook`/`plate` interact
(`action-validator.js#resolveCookOrPlate`) becomes the ONLY way a ticket gets started — it already
calls the exact `kitchen.startTicket()` a worker's `tend_station` task uses, so the cook-time clock
itself (`stationSteps`, `order-system.js`) already exists and already runs for a player-started
ticket today. What's missing is that it doesn't currently FEEL like a real, timed action from the
owner's own hands, and there's no visual cue for a ticket that's queued at a station but nobody
has started yet.

## Acceptance Criteria

- [ ] Confirm (via `resolveCookOrPlate`/`kitchen.startTicket()`) that a player-started ticket
  already takes its real `stationSteps` duration rather than resolving instantly — if it already
  does, this AC is a verification, not new work; if some path resolves instantly for the owner
  today, fix it so a player-started ticket behaves identically to a worker-started one, timing-wise.
- [ ] While a ticket is actively cooking at a station the owner started, give it the same felt
  weight a worker's `tend_station` task gets (a cooldown on that station/action from the owner's
  own perspective, consistent with `OWNER_TASK_DURATIONS_MS`'s existing "the owner performs the
  same actions faster than a worker, as a rate, not an assertion" design — see
  `action-validator.js`'s own file header).
- [ ] Add a small in-world visual indicator, distinct from existing station-queue/ready-state
  visuals (`state-color-bands.js`/`STATE_COLORS`, STORY-016's station indicators), for "a ticket
  is queued at this station but not yet started" — the missing middle state between idle and
  actively cooking.
- [ ] The indicator is driven from the same `kitchen.queuedTicketsAt(restaurantId, station)` data
  `worker-system.js#selectCookTask` already reads for its own rule 2 — no new server-side state.

## Notes

- Depends on STORY-040 (co-op mode with no automated cook needs to exist for this to matter — a
  regular match's stations already get worker-driven visual coverage).
- Cites: `server/src/game/validators/action-validator.js` file header — "NO TASK-COMPLETION
  SYSTEM... a valid interact resolves its facade call IMMEDIATELY... `OWNER_TASK_DURATIONS_MS`...
  is spent afterward as a cooldown." This story PRESERVES that model; it does not add a second,
  worker-style task-completion system for the owner.
- Cites: `client/src/scenes/RestaurantScene.ts`'s existing per-station indicator machinery
  (`buildStationIndicators`) as the pattern to extend, not replace.
