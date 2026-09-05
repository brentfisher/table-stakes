---
id: STORY-016
title: 3D visual state language and readability pass
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/016-visual-state-language
worktree_path: /Users/brent/table-stakes-worktrees/story-016-visual-state-language
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/18
is_architectural: false
approach_summary: >-
  Pure Three.js view layer over already-published match_snapshot fields — no server changes, no
  new wire fields, no cross-module contract touched. Touches client/src/scenes/RestaurantScene.ts
  (the scene graph) and client/src/game/EntityViewRegistry.ts (currently a 36-line skeleton) to add
  per-entity view components driven by CustomerSnapshot.patienceRemaining/state (patience rings +
  impatience posture), TableSnapshot state (order/meal/payment/cleanup badges), StationSnapshot
  queue depth + RestaurantSnapshot.shortages (visually distinct queue-vs-shortage icons),
  workers[].task/needsHelp (role + job icons, STORY-007's needsHelp signal STORY-015 already
  surfaces server-side), OrderSnapshot ready state (pass indicator), and events[] (top-centre
  banner). One correction to the story's own Notes: it cites "conventions.md Notable Pattern 4"
  for "rules emit state, views render state" — the current conventions.md numbering has that
  principle at Pattern 11 ("React owns UI, Three.js owns the scene... rules emit state while views
  render it"); Pattern 4 is now "Named RNG sub-streams" (conventions.md was evidently renumbered
  since this story was sliced). Define the six §14 state colours once as named constants (likely
  a new small shared/client constants module) and consume them everywhere rather than letting any
  indicator invent its own palette.
created: 2026-08-28
updated: 2026-09-04
---

# 3D visual state language and readability pass

Design pillar 4.4 requires the 3D world to communicate operational state at a glance, and §14
specifies the vocabulary: a fixed colour semantics (green healthy, yellow attention soon, orange
active bottleneck, red critical, blue customer/event opportunity, purple premium/high-value) plus
a set of specific indicators — customer patience rings, order tickets above tables, station queue
indicators, ingredient shortage icons, worker role icons, and a food-ready icon at the pass.

By the time this story runs, the simulation exists but reads as coloured boxes. This story makes
the scene legible: a player should be able to identify their worst bottleneck without opening a
panel. It is the story that satisfies §22 Quality's "important bottlenecks are visible in the 3D
scene".

## Acceptance Criteria

- [x] The six §14 state colours are defined once as named constants and used consistently; no
      indicator invents its own palette.
- [x] Customers render a patience ring beneath them that tracks the server's patience value and
      crosses the colour bands as it depletes.
- [x] Tables show their state (order taken, meal delivered, paying, dirty) via a visible badge or
      ticket, per §4.4 "Tables show order, meal, payment, and cleanup states".
- [x] Stations show queue depth and a distinct **ingredient shortage** icon that is visually
      different from a long queue — the two bottlenecks must not look alike (§8 requires distinct
      signals for each).
- [x] Workers show a role icon and a current-job indicator, including the "needs help" state from
      STORY-007.
- [x] A food-ready indicator appears at the service pass.
- [x] Customer body language reflects impatience (§4.4 "Hungry/waiting customers visibly look
      impatient") — at minimum a posture or animation state change at the patience thresholds.
- [x] The rival restaurant is visible in some form — adjacent, through glass, or via the district
      overview panel — showing at least its activity level (§4.4).
- [x] An event banner renders top-centre with a district-level visual effect (§14).
- [x] Entities match the §14 MVP simplification table: low-poly stylized owner, colour-coded
      workers, segment-cued customers, clear per-station material distinction.
- [x] All indicators are driven by `match_snapshot` values, and the scene layer computes no game
      state of its own (`conventions.md` Notable Pattern 4).
- [x] Every indicator is legible from the default camera height without zooming.

## Notes

- **Depends on STORY-004** (patience and customer state) and **STORY-005** (station queues, food at
  the pass). Shortage icons need **STORY-006**; worker icons need **STORY-007**; the event banner
  needs **STORY-011**. Build against the snapshot fields; indicators for unlanded stories simply
  render nothing.
- `conventions.md` **Notable Pattern 4** (rules emit state, views render state) is what lets these
  same view components be reused by the harnesses in STORY-018–021 with mocked state. Breaking it
  here breaks every harness.
- `conventions.md` **Notable Pattern 3**: these are Three.js-side, per-frame concerns — not React.
- PRD §4.4 (readable 3D simulation), §14 ("Visual state language", "MVP entities"), §8 (the
  bottleneck table's "visible signal" column), §22 Quality.
- Art direction is §19: stylized low-poly diorama, district palettes. Placeholder or legally
  reusable models are acceptable at MVP (§20) — record every reused asset in `assets/licenses/`.
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Not architectural — view layer over existing state.

## Implementation notes (post-hoc)

Pure Three.js/React view layer, exactly as planned — zero server changes, zero new wire fields.
Confirmed no writer for `RestaurantSnapshot.stations[]` exists (`grep -rn "\.stations\b"` only
hits the server's internal Map, never the public snapshot field), so station queue depth is
derived from `orders[]` client-side, per `OrderSnapshot`'s own documented formula
(`orders.filter(o => o.station === X && o.state === 'queued' && o.blockedByIngredientId === null).length`),
never read off the always-empty declared field.

**Color-constant module.** `client/src/game/state-colors.ts` — the six §14 colors
(`STATE_COLORS.healthy/attention/bottleneck/critical/opportunity/premium`), plus
`WORKER_ROLE_COLORS` (a per-role identity tint, a second, independent channel from the six
severity colors) and `CUSTOMER_SEGMENT_COLORS` (same idea, per customer segment). Placed in
`client/src/game/` rather than `shared/` because `harnesses/tsconfig.json` already includes that
directory (`scene-primitives.ts` re-exports `RestaurantScene`/`CameraController` from the same
path), so harnesses reach it the same way, with no server-side reason to make it JS+`.d.ts`.

**Patience ring color bands.** Pure classification lives in
`shared/game-logic/state-color-bands.js` (`patienceColorBand`, `stationQueueColorBand`) —
plain-JS-plus-`.d.ts`, Decision 4's shape, because `scripts/check-visual-state.mjs` (a `.mjs`
check script) cannot import TypeScript. Thresholds live in `shared/constants/tuning.js`:
`PATIENCE_RING_ATTENTION_THRESHOLD` (0.7), `PATIENCE_RING_BOTTLENECK_THRESHOLD` (0.5), and the
red/critical cutoff REUSES `UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD` (0.35) directly rather than a
new constant — the ring's red band and the HUD's "customer abandonment imminent" alert
(STORY-015) now agree on when a party is critical by construction, not by two independently-tuned
numbers that could drift apart. `STATION_QUEUE_ATTENTION_THRESHOLD` (1) plus the already-existing
`HUD_KITCHEN_BACKLOG_QUEUED_TICKETS_THRESHOLD` (reused, not redefined) do the same job for the
station queue indicator.

**Shortage vs. queue distinctness (§8).** Two different shapes at two different anchors on the
station mesh: the queue indicator is a growing stack of up to 4 small boxes at front-left,
colored by band (green/yellow/orange, never red — a queue alone is never "critical"); the
shortage indicator is one fixed circular glyph sprite (`!`, always solid red/critical) at
back-right, visible only when `restaurant.shortages[]` has an entry for that station with
`blockedTickets > 0`. Different geometry, different color range, different screen position — the
AC's "must not look alike" applies to shape and anchor, not only hue.

**Worker role/task icons.** `RestaurantScene#upsertWorker` builds a role-colored capsule (identity
color, permanent for the match) plus a role-glyph sprite and ALL possible task glyphs
(`WORKER_TASK_GLYPHS`, one per `WorkerTaskKind`) plus one "needs help" glyph, all built once and
only toggled visible/invisible thereafter — no per-snapshot allocation. `needsHelp` gets the §14
orange "active bottleneck" language (not red, which this scene reserves for the
customer-abandonment-imminent band), matching `game-state.d.ts`'s own "THREE STATES, NOT TWO"
comment on the field.

**Rival visibility / activity level.** Reused `RestaurantScene#buildCompetitor`'s existing 6
"table" boxes and sign rather than adding new geometry: the boxes light up (emissive blue) in
proportion to the rival's occupied-seat fraction (`seatsTotal`/`seatsAvailable`, already public),
and the sign tints orange when `rival.queueLength > HUD_LONG_ENTRY_QUEUE_THRESHOLD` — the same
"a passerby would notice" line the HUD's own `long_entry_queue` bottleneck already uses.

**Event banner.** Split per Notable Pattern 11: `client/src/ui/EventBanner.tsx` is a small
presentational React overlay (top-centre pill) reading `status.events` verbatim, nothing
computed; `RestaurantScene#updateEventEffect` is the "district-level visual effect" half — a
whole-scene ambient-light color tint toward §14's blue "opportunity" while any event is active,
reverted the instant none are. Had to offset the pre-existing STORY-015 `.hud-scoreboard` panel
down (`top: 12px` → `58px`) — both it and the new banner wanted the same top-center strip, and
without the offset the scoreboard silently painted over the banner (found live, not in the
type-checker).

**Segment-cued customers.** Added after re-reading the AC list against what had actually shipped:
the §14 MVP entity table's "segment-cued customers" bullet was not yet satisfied by the patience
ring alone (that's a state signal, not an identity one). Added `CUSTOMER_SEGMENT_COLORS` (one tint
per `customer-segments.json` id) as a second, independent visual channel on the customer body,
parallel to how `WORKER_ROLE_COLORS` already works for workers — the ring still layers the
patience band on top, unchanged.

**What was verified live vs. via automated check.** `npm run check` (including the new
`check:visual-state`, falsified by deliberately breaking `patienceColorBand`'s critical branch,
confirming 2/14 checks failed, then restoring via `git checkout --` and re-confirming 14/14) plus
`build:client`/`build:harnesses` (both strict-mode `tsc --noEmit`) all pass. The rendering itself
has no in-process test surface, so it was verified live: `npm run dev:server` +
`npm run dev:client`, two browser tabs through lobby → market_reveal → setup → service /
final_rush, across four real matches, plus a fifth pass through the restaurant-layout harness for
the two fixtures below. Confirmed live and captured in screenshots: patience rings crossing all
four color bands including red/critical (paired with the HUD's own "party about to walk out"
alert firing at the same moment); table badges cycling through order_taken (yellow) →
meal_delivered (green) → paying (blue) live in a real match, plus dirty (orange) via the harness
fixture below; station queue boxes (yellow, one ticket, live) and the full shortage-vs-queue
comparison (harness); worker role glyph + task glyph rendering simultaneously and distinctly
(after the single-character glyph fix below); the food-ready icon recoloring green → orange past
`ORDER_FRESHNESS_GRACE_MS`; the event banner rendering top-centre without overlapping the
scoreboard (after the CSS fix above) alongside a visible ambient blue tint on the whole floor
while "Food Critic Spotted"/"Local Influencer Post" events were active; rival activity (lit blue
occupied-table boxes, tinted sign) with a genuinely busy rival (19-21 customers); and, in a
follow-up match with generous starting inventory, multiple simultaneously-visible customer body
colors (blue-gray office_worker, red event_fan, tan neighborhood_regular) confirming segment
cueing. **The shortage-vs-queue AC needed a different instrument than live two-restaurant play.** Two
attempts to force a real shortage during a live match (0 starting inventory, then 2-unit starting
inventory on a single dish) both resulted in the district choice model sending zero customers to
that restaurant for the whole match — it appears to heavily penalize any zero-stock ingredient
regardless of menu price/reputation, so a genuine shortage rarely coincides with an active queue
elsewhere on the same floor. More importantly, the AC is COMPARATIVE ("visually different from a
long queue," "must not look alike") — even a successful live shortage would only have produced
one screenshot, never the side-by-side the AC actually asserts. Added
`mockShortageVsQueueDemo` (`harnesses/src/shared/test-entities.ts`) and a "Shortage vs queue
demo" toggle in `harnesses/src/restaurant-layout-harness.ts` that calls
`RestaurantScene#updateFloorState` once with a hand-built fragment: 5 queued, unblocked tickets
at `prep` (a real backlog) beside 2 queued tickets at `grill` all blocked by a shortage entry,
plus one dirty table. Confirmed live in the harness: `prep` shows a 4-box orange stack (capped at
`MAX_VISIBLE_QUEUE_BOXES`); `grill` shows a single fixed red `!` glyph and zero boxes — different
shape, different anchor, different color range, exactly the AC's "must not look alike" checked
side by side in one frame; the dirty table shows an orange `X` badge, confirming the fourth
table-badge state (`order_taken`/`meal_delivered`/`paying` were already confirmed in a real match)
the same way. Reproducible with one click rather than a multi-minute match setup.
This fixture is not throwaway scaffolding — it is exactly what Notable Pattern 11 (rules emit
state, views render it) exists to enable, and the same `updateFloorState`/mock-fragment approach
is what STORY-018-021's harnesses will build on.

**A live legibility check caught a real gap.** Zooming into a screenshot of a worker's task icon
mid-review, a two-character glyph (`CL` for `clear_table`) read as ambiguous even magnified — the
default camera (height 24, distance 21, fov 46) renders a 0.4-unit sprite as roughly 13px on an
868px-tall viewport, about 6px per character for a two-letter code. Since "legible from the
default camera height without zooming" is this story's own AC, this was a real failure, not a
nice-to-have. Fixed by collapsing every `WorkerTaskKind` glyph to one character (`K`/`R`/`D`/`A`/
`T`/`X`/`$`, all mutually distinct) and bumping role/task glyph scale from 0.4 to 0.6.

Dev servers (service client+server, twice, plus the harness dev server) were started/stopped by
PID each time (never `pkill`), confirmed via `pgrep`/`lsof` before and after each session.
