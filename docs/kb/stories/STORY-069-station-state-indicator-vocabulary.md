---
type: Story
id: STORY-069
title: Complete the station-state indicator vocabulary in the world
description: Extend the station indicators past today's queue-depth boxes, shortage glyph and waiting glyph to also show active cooking, ready-at-station and temporarily-unavailable, each distinct by geometry and anchor rather than colour alone.
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

# Complete the station-state indicator vocabulary in the world

PRD Story 4 (pp. 7-8) names six station states the scene must present — Idle, Waiting/queued,
Cooking, Ready, Blocked by ingredient shortage, and Temporarily unavailable — and the visual
language table on pp. 11-12 pins each to a treatment. `RestaurantScene.ts#buildStationIndicators`
today builds three of them: `queueBoxes` (queue depth, colour-banded by
`stationQueueColorBand`), `shortageIcon` (fixed critical red, deliberately never recoloured by
the band), and `waitingIcon` (STORY-041's "queued here but not started"). There is no in-world
signal that a station is actively cooking, that its output is ready, or that it is unavailable —
so from across the kitchen a station with three tickets queued and nothing cooking looks the same
as one with three queued and a dish under way.

This story completes the set from state the snapshot already publishes. `updateStationIndicators`
already receives `orders: OrderSnapshot[]` and derives queue depth from
`state === 'queued' && blockedByIngredientId === null` per station; the same array carries the
in-progress and ready states, which is where the two new signals come from. "Temporarily
unavailable" needs a decision rather than a lookup: `action-validator.js` currently answers
`repair` with `no_failure_state` ("no station is currently broken"), so no station in this game
can be unavailable yet. Either wire it to a real published condition or state in the code and the
PR that the state is deliberately deferred with nothing to drive it — what this story must not do
is invent a client-side notion of unavailability.

The discipline this story is held to is STORY-016's and the PRD's shared one: the signals must be
distinguishable by **shape, position and anchor**, not by colour alone, and a new indicator must
not blur a distinction the existing ones deliberately draw. `updateStationIndicators`'s own
comments spell two of those out — the shortage glyph is fixed-severity so it can never be
confused with a queue band, and the waiting glyph is driven by queue presence alone so a
backed-up station that is also cooking still shows it. A cooking indicator sits alongside that
waiting glyph, it does not replace it.

## Acceptance Criteria

**New indicators**

- [ ] `RestaurantScene.ts#buildStationIndicators` builds an active-cooking indicator and a
      ready-at-station indicator per station, each with its own mesh/sprite and its own anchor
      offset, stored alongside `queueBoxes`/`shortageIcon`/`waitingIcon` in `stationIndicators`.
- [ ] Both new indicators are driven in `updateStationIndicators` from the already-published
      `orders: OrderSnapshot[]` (and `shortages`) — no new server field, no new snapshot shape.
- [ ] The cooking indicator reads as duration rather than presence: it animates, fills, or
      otherwise changes over the ticket's remaining production time, so a player can tell a dish
      that just started from one about to land (PRD p. 11: "Timer or animated cooking state").
- [ ] The cooking indicator is suppressed or frozen under `Settings.reducedMotion` without
      losing the state itself — the station must still read as cooking with motion off.
- [ ] `waitingIcon` (STORY-041) keeps its current semantics exactly: queue presence alone, not
      narrowed to "and nothing is cooking". A station that is both cooking and backed up shows
      both. Verify by reading that method's own comment before changing anything near it.

**Visual-language discipline**

- [ ] Every new colour comes from `STATE_COLORS` / `colorForBand`; no new hex literal enters
      `RestaurantScene.ts`.
- [ ] Each of the five live states is distinguishable from every other by geometry and anchor
      position with colour removed — demonstrate this with a greyscale screenshot, per PRD Story 6
      AC ("shape, position, and colour — not colour alone") and STORY-016.
- [ ] "Temporarily unavailable" is either wired to a real authoritative condition, or explicitly
      deferred in a comment naming `action-validator.js`'s `repair`/`no_failure_state` as the
      reason nothing can drive it yet. A client-invented unavailable state is a fail.

**Verification**

- [ ] `harnesses/src/kitchen-bottleneck-harness.ts` gains (or extends) a fixture that mounts all
      five live states side by side at once — the PRD's "mock visual-state fixture" on p. 15.
- [ ] Indicators stay legible and non-overlapping at `DEFAULT_CAMERA`, and at STORY-067's kitchen
      framing if it has landed. Screenshot each.
- [ ] `npm run check` passes; client and harness builds pass.

## Notes

- **PRD sections:** Story 4's requirements list of station states, pp. 7-8, and the "Visual
  language / Required indicators" table, pp. 11-12. The PRD's own instruction there is that new
  indicators "build on that vocabulary rather than introduce arbitrary colors or ambiguous
  symbols."
- **Companion art:** `docs/Kitchen indicator concept sheet`'s footer legend fixes the four state
  colours (Healthy/Good, Attention, Bottleneck, Critical) — the same four `colorForBand` already
  maps. Nothing in this story needs a fifth.
- **STORY-041 is merged in master** (commit `5345fcd`, PR #59) even though
  `STORY-041-coop-timed-cooking-and-waiting-indicator.md` still reads `status: pr-opened`. The
  `waitingIcon` this story builds beside is present and verified in master; do not treat it as
  pending, and do not "fix" that stale status field — it is out of scope here.
- **This story extends STORY-016's visual state language** rather than revising it: the six-colour
  vocabulary and the "shortage differs from queue by geometry, colour range and anchor" rule are
  preserved verbatim, and two more shapes are added inside them.
- **`key-files.md` hazard 2:** "A check that cannot fail reads as coverage." If this story adds a
  check, falsify it first. If it verifies only by screenshot and harness (legitimate here —
  `conventions.md`: "no test framework exists ... verify by runnable scripts, by the dev
  harnesses, or by diff review"), say which in the PR body.
- **`conventions.md` Notable Pattern 11** — the indicators render published state; they must not
  derive a station's status from anything the server did not say.
- **No dependency on another story in this PRD.** STORY-072/074 later add prep and held-food
  indicators to the same station anchors; leave room for them, but do not build them here.
