---
id: STORY-041
title: Player-driven timed cooking, with a "waiting to cook" indicator
status: pr-opened
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: story/041-coop-timed-cooking-and-waiting-indicator
worktree_path: /Users/brent/table-stakes-story-041
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/59
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

## Implementation notes

**AC1 — does a player-started ticket already take real time?** Yes, verified, no fix needed.
`resolveCookOrPlate` (`server/src/game/validators/action-validator.js`) calls
`match.kitchen.startTicket(restaurantId, oldest.ticketId)`, which is the exact same function
`worker-system.js`'s `tend_station` task calls. `startTicket` runs `claimIngredients` +
`startStep` (`server/src/game/systems/order-system.js`), and `startStep` sets
`ticket.remainingMs = step.durationMs * stationSpeedMultiplier(...)` straight from
`dishes.json`'s `stationSteps` — there is no separate "owner" branch anywhere in this path.
`advanceActiveTickets`, which runs every tick for every station regardless of who started the
ticket, is what actually burns that time down and calls `finishStep` once it reaches zero. New
coverage in `scripts/check-owner-actions.mjs` (section "2b") proves this rather than just
asserting it: after a player `cook`, `ticket.remainingMs` equals the dish's real
`stationSteps[0].durationMs`; one tick short of that duration the ticket is still on its first
step; only once the full duration has elapsed does it complete.

**AC2 — does the owner's cook/plate action already have worker-rate felt weight?** Also yes,
verified, no fix needed. `handleInteract` already sets `player.pendingAction = { action,
readyAtMs: match.elapsedMs + OWNER_TASK_DURATIONS_MS[action] }` for every action, cook/plate
included, and `shared/constants/tuning.js` already defines `OWNER_TASK_DURATIONS_MS.cook` and
`.plate` as `Math.round(WORKER_TASK_DURATIONS_MS.tend_station / OWNER_TASK_SPEED_ADVANTAGE)` —
exactly the "a rate, not an assertion" cooldown model the validator's own file header
describes, already applied to cook/plate specifically (not just generically). New coverage:
a check that `OWNER_TASK_DURATIONS_MS.cook === OWNER_TASK_DURATIONS_MS.plate ===
Math.round(WORKER_TASK_DURATIONS_MS.tend_station / OWNER_TASK_SPEED_ADVANTAGE)` (500ms in the
current tuning), on top of the pre-existing generic "busy" cooldown check.

**AC3/AC4 — the new "waiting to cook" indicator (the actual new work this story adds).**
`client/src/scenes/RestaurantScene.ts`'s `buildStationIndicators` now builds a third glyph per
station (`'…'`, fixed `STATE_COLORS.attention` yellow, top-center anchor
`STATION_WAITING_ANCHOR`), alongside the existing queue-box stack and shortage icon from
STORY-016 — a distinct shape, anchor and color from both, matching the AC's "distinct from
existing station-queue/ready-state visuals" requirement. `updateStationIndicators` sets its
visibility to `queueDepth > 0`, where `queueDepth` is the same `orders[]`-derived count
(ticket `state === 'queued'`, not ingredient-blocked) the existing queue boxes already use —
which is exactly what `kitchen.queuedTicketsAt(restaurantId, station)` reports server-side, so
no new server-side state was added, per the AC.

One design decision worth documenting explicitly, since it's easy to read the AC narrower than
it is: the glyph is driven by queue PRESENCE alone. It is deliberately **not** gated on the
station being otherwise idle (i.e., not `&& station has nothing active`) — an earlier draft did
gate it that way, reasoning "the missing middle state between idle and actively cooking" meant
a station-level tri-state. On reflection (and per review) the AC's own bullet is a per-TICKET
claim — "a ticket is queued at this station but not yet started" — true of every entry
`queuedTicketsAt` returns, whether or not the station also has something else `in_progress`
right now. A station cooking one ticket with three more stacked behind it still has three
genuinely unstarted tickets nobody has acted on, which is exactly the backed-up case that
matters most once co-op mode's missing automated cook (STORY-040) means nothing ever clears
that queue on its own. Gating on station-idle would have hidden the indicator in precisely that
scenario.

**Honest visual-verification limitation.** This environment's browser automation cannot run
the WebGL render loop — `document.visibilityState` reports `hidden` in the automated Chrome
tab, which blocks `requestAnimationFrame`, so the new glyph could not be screenshotted or
visually confirmed live. Verification here is: `npm run build:client` and `npm run
build:harnesses` both type-check and build clean with the new field on `stationIndicators`'
Map type and the new sprite/anchor code; the underlying data path (`queuedTicketsAt`
transitioning from non-empty to empty across a real `cook` interact) is proven server-side in
`scripts/check-owner-actions.mjs`. No claim of live visual confirmation is made.

**Full `npm run check`** (all `check-*.mjs` scripts, `build:client`, `build:harnesses`, and the
smoke suites) passes green in the worktree, including the new/modified assertions above.

# Player-driven timed cooking, with a "waiting to cook" indicator

With no automated cook in co-op mode (STORY-040), a player's own `cook`/`plate` interact
(`action-validator.js#resolveCookOrPlate`) becomes the ONLY way a ticket gets started — it already
calls the exact `kitchen.startTicket()` a worker's `tend_station` task uses, so the cook-time clock
itself (`stationSteps`, `order-system.js`) already exists and already runs for a player-started
ticket today. What's missing is that it doesn't currently FEEL like a real, timed action from the
owner's own hands, and there's no visual cue for a ticket that's queued at a station but nobody
has started yet.

## Acceptance Criteria

- [x] Confirm (via `resolveCookOrPlate`/`kitchen.startTicket()`) that a player-started ticket
  already takes its real `stationSteps` duration rather than resolving instantly — if it already
  does, this AC is a verification, not new work; if some path resolves instantly for the owner
  today, fix it so a player-started ticket behaves identically to a worker-started one, timing-wise.
- [x] While a ticket is actively cooking at a station the owner started, give it the same felt
  weight a worker's `tend_station` task gets (a cooldown on that station/action from the owner's
  own perspective, consistent with `OWNER_TASK_DURATIONS_MS`'s existing "the owner performs the
  same actions faster than a worker, as a rate, not an assertion" design — see
  `action-validator.js`'s own file header).
- [x] Add a small in-world visual indicator, distinct from existing station-queue/ready-state
  visuals (`state-color-bands.js`/`STATE_COLORS`, STORY-016's station indicators), for "a ticket
  is queued at this station but not yet started" — the missing middle state between idle and
  actively cooking.
- [x] The indicator is driven from the same `kitchen.queuedTicketsAt(restaurantId, station)` data
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
