---
id: STORY-056
title: Table numbers only when delivering; a real complaint marker
status: pr-opened
prd_source: null
branch: story/056-table-number-visibility-and-complaint-marker
worktree_path: /Users/brent/table-stakes-worktrees/story-056-table-number-visibility-and-complaint-marker
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/79
is_architectural: false
approach_summary: >
  Two grouped reports, both client-only changes to `client/src/scenes/RestaurantScene.ts`'s
  per-table visual signals, no server/schema change needed for either.
  PART 1 — table numbers. `buildWayfinding()` (line ~883-917) unconditionally labels EVERY table
  entity with its `formatTableChip` text ("T04" etc.) permanently, for the life of the scene —
  this is the always-on placard the report wants gone. A SEPARATE mechanism already exists and
  already does exactly "show the table number only when delivering food":
  `buildCarryTargetMarker`/`updateCarryTargets` (line ~1761-1837) shows a ring + arrow + the same
  `formatTableChip` text above a table only while `GameClient.ts` (line ~813,
  `updateCarryTargets(selfCarryTableIds)`) reports the player is actively carrying an order bound
  for it. Fix: stop `buildWayfinding` from building/attaching a label for `entity.type === 'table'`
  (leave station/pass/other labels untouched — only the per-table number is in scope), relying on
  the carry-target marker for the "when delivering" case, which already covers it. Before removing
  it, grep for any OTHER place that assumes a table's number is always visible in the 3D scene
  (e.g. an alert or HUD panel that tells the player "table 4 needs attention" and expects them to
  visually locate it by a permanent number) — a quick check found none (`hud-alerts.js` carries
  `tableId` as structured data, never rendered as literal "Table N" text), but re-verify directly
  rather than trusting this summary.
  PART 2 — complaint marker. `tableBadgeFor` (line ~2073-2095) derives a table's on-floor badge
  from `party.state` alone (SEATED/ORDERING/WAITING_FOR_FOOD/EATING/PAYING) and NEVER reads
  `party.unhappy` — the exact "this table has an unresolved complaint" signal (`unhappy: boolean`,
  already published per `CustomerSnapshot`, `shared/schemas/game-state.d.ts` line ~342, computed
  server-side as `party.everUnhappy && !party.complaintHandled`, `customer-system.js` line ~1637).
  So there is currently NO visual signal for this at all — confirmed, not assumed: `TableBadgeKind`
  only has 4 members (`order_taken`/`meal_delivered`/`paying`/`dirty`). Fix: add a genuinely
  distinct, highly visible marker — the report explicitly asks for "the entire table have a red
  marker... very visible above the customers", stronger than the existing small glyph-sprite
  badges (`createGlyphSprite`, 0.45 scale) other states use. Follow the file's own established
  device for "this needs urgent attention" (the oldest-ready-ticket pulse/scale boost in
  `upsertReadyDish`, or the carry-target's own ring+arrow combo) rather than inventing a new visual
  vocabulary — e.g. a larger red ring/glow beneath or around the table plus a bigger glyph/label
  above the customers' heads, distinct from and layered with (not replacing) the existing 4-state
  badge, since a table can be simultaneously e.g. `order_taken` AND have an unresolved complaint.
  Use `STATE_COLORS.bottleneck` (the existing red/urgent tone `dirty` already uses) for consistency
  with the file's established color vocabulary rather than picking a new red. Priority ordering:
  decide whether the complaint marker should visually coexist with or override the existing 4-state
  badge glyph when both are true for the same table — coexist is probably right (they communicate
  different facts — "what stage of service" vs. "is there an unresolved complaint" — same
  reasoning `upsertReadyDish`'s STORY-053 staged label uses a distinct color family specifically so
  it never reads as a variant of an existing state).
created: 2026-09-12
updated: 2026-09-13
---

# Table numbers only when delivering; a real complaint marker

Two grouped reports touching the same file and the same category of fix (per-table visual
signals in `RestaurantScene.ts`):

1. **"instead of listing the table numbers, only show them when you are delivering food"** — the
   permanent per-table number placard should go away; the existing carry-target marker (shown only
   while actively carrying an order to that table) already does what's being asked for.
2. **"handle complaint - I can't tell they're angry, make the entire table have a red marker and
   it be very visible above the customers"** — there is currently no visual signal at all for an
   unresolved complaint (`party.unhappy`), confirmed by reading `tableBadgeFor`'s switch statement.

## Acceptance Criteria

- [x] The permanent per-table number label built by `buildWayfinding` is removed (station/pass/
  other wayfinding labels are unaffected — this is scoped to `entity.type === 'table'` only).
- [x] A table's number is still visible via the existing carry-target marker while a player is
  actively carrying an order bound for it (verify this still works after the wayfinding change —
  it's a separate code path but confirm no shared state was accidentally touched).
- [x] An unresolved complaint (`party.unhappy === true`) now renders a clearly distinct, highly
  visible marker above the table/customers — not just a re-tinted version of an existing badge
  glyph. It should be visible at a glance from the normal play camera distance, not require the
  player to be standing next to the table.
- [x] The complaint marker clears the instant `party.unhappy` goes false (complaint handled, or the
  party leaves) — no stale marker left behind.
- [x] The complaint marker and the existing 4-state table badge (order_taken/meal_delivered/
  paying/dirty) can coexist without either obscuring or being confused for the other.
- [x] `npm run check` (including `build:client`) stays green.

## Notes

- Not part of any PRD slice (`prd_source: null`) — standalone gameplay-clarity reports.
- Cites: `client/src/scenes/RestaurantScene.ts` — `buildWayfinding` (permanent table labels to
  remove), `buildCarryTargetMarker`/`updateCarryTargets` (existing "show while delivering"
  mechanism, already correct, do not duplicate), `tableBadgeFor`/`updateTableBadges`/
  `TableBadgeKind`/`TABLE_BADGE_COLORS` (badge system to extend for the complaint marker),
  `STATE_COLORS.bottleneck` (existing red/urgent color to reuse).
- Cites: `shared/schemas/game-state.d.ts` `CustomerSnapshot.unhappy` and `server/src/game/systems/
  customer-system.js` (`everUnhappy`/`complaintHandled`/`unhappy` derivation) — the data is already
  on the wire; this is a client-rendering-only story, no schema change needed.
- `client/src/game/InteractionController.ts` already surfaces `handle_complaint` as an available
  owner interaction near an unhappy party's table (STORY-008) — that interaction and its gating are
  unrelated to this story and must not change; this story only adds the missing visual signal for
  a state the interaction system already knows about.

## Implementation notes

**Part 1 — table numbers removed.** `buildWayfinding()` in `client/src/scenes/RestaurantScene.ts`
now does `if (entity.type === 'table') continue;` as the very first check in its per-entity loop,
before the label lookup that used to call `formatTableChip`. Station/pass/command-post labels are
untouched — same loop, same lookup table, just no longer reachable for tables. Confirmed by direct
grep (not just the story's own summary) that nothing else in the codebase reaches into the scene by
`label_${tableId}`, and that `hud-alerts.js`/`ArcadeToast.tsx` carry `tableId` only as structured
data or literal HUD toast text ("TABLE 4"), never as an assumption that a permanent in-world
placard exists to look up.

**Part 2 — complaint marker.** Added `buildComplaintMarker`/`updateComplaintMarkers`/
`updateComplaintMarkerAnimations` to `RestaurantScene.ts`, following the exact "hide, never
destroy" lifecycle `updateCarryTargets` already established (`complaintMarkers: Map<string,
THREE.Group>`). The marker is two parts, both keyed off `STATE_COLORS.critical` (0xe0402f) — a
deliberate DEVIATION from this story's own approach_summary, which said to reuse
`STATE_COLORS.bottleneck` "the existing red/urgent tone `dirty` already uses." That description is
factually wrong: `.bottleneck` (0xe0812f) is orange per its own doc comment in `state-colors.ts`
("Orange — active bottleneck"); `.critical` (0xe0402f, "Red — critical") is this file's one actual
red. The report's literal ask was "make the entire table have a RED marker," so I used `.critical`
instead. This is also the semantically correct choice, not just the visually correct one:
`patienceColorBand`'s `critical` band (the patience ring's reddest state) and `party.everUnhappy`
flip at the exact same threshold, `UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD` (`upsertCustomer` and
`customer-system.js` respectively) — so a diner's patience ring turning this same red is the direct
visual precursor to this marker appearing, a continuity `.bottleneck` would have severed for no
reason beyond the approach_summary's mistaken cross-reference. Caught via `advisor()` review before
committing, confirmed against `state-colors.ts`'s actual hex values, and re-verified visually (see
below) before finalizing.
- A floor ring bigger than the carry-target ring (`COMPLAINT_RING_INNER/OUTER` 1.2/1.45 vs the
  carry target's 0.95/1.15) and fully opaque at rest (not just pulse-dependent) so it reads as
  literally circling "the entire table," per the report's own wording.
- An oversized "!" glyph (`COMPLAINT_GLYPH_SCALE` 1.0, more than double the 0.45-scale badge
  glyphs) at `COMPLAINT_GLYPH_Y = 3.0` — deliberately far enough above the existing 4-state badge
  (spans 1.475-1.925) and the carry-target chip (spans 1.71-2.39) that all three can be visible on
  the same table at once with no overlap. This reuses the file's own established
  `STATION_WAITING_ANCHOR`-style "stack it higher, don't invent a horizontal offset vocabulary"
  device (see that constant's comment) rather than introducing x/z-offset anchoring, which this
  file doesn't otherwise use for table sprites.

Both pieces get a per-frame pulse (`updateComplaintMarkerAnimations`, wired into
`GameClient.ts#handleFrame` next to the other per-frame animations) but are already fully legible
at rest — same "screenshot still shows it" discipline `upsertReadyDish`'s `isOldest` boost uses —
so the marker doesn't depend on `requestAnimationFrame` running to be visible.

Coexistence: the complaint marker and the 4-state badge are rendered independently
(`updateComplaintMarkers` runs right alongside `updateTableBadges` in `updateFloorState`, reading
the same already-filtered `customers[]`) and never share a sprite, name, or texture — verified in
the browser, not just by code inspection (see below).

**Verification — real rendering, not just code-path reasoning.** This environment's browser
automation (`claude-in-chrome`) rendered actual frames with `requestAnimationFrame` firing (the
harness dev server's rAF-driven pulses and the live bot match's `Tab`/camera HUD both animated
normally) — the known "`document.visibilityState === 'hidden'` blocks rAF" limitation noted in this
story's instructions was NOT encountered here, so this is genuine visual verification, not a
fallback to code reasoning alone:
- `?harness=restaurant-layout` (constructs a real `RestaurantScene` from the production layout):
  confirmed zero table number placards on any table, while all six station/pass/command-post
  labels (WASH, PICKUP, EXPO RAIL, RUSH THE PASS, SERVICE, UPGRADES, WELCOME, PLATING) were
  unaffected.
- `?harness=asset-showcase`, Dish Models category: added a new `table_unhappy` variant
  ("On table — unresolved complaint (meal delivered + unhappy)") that renders `EATING` state
  (so the `meal_delivered` badge is showing) plus `unhappy: true`, specifically to exercise the
  coexistence AC. Screenshotted (twice — once before the color fix showing orange, once after
  showing genuine red): the green "F" badge at table height and the big red ring + "!" glyph are
  both visible, neither obscuring the other. Switching the dropdown to any non-unhappy variant
  instantly cleared the ring/glyph, leaving only that variant's own badge — confirms the "clears
  the instant `unhappy` goes false" AC. This harness never calls `updateCarryTargets`, so it only
  demonstrates complaint-marker + 4-state-badge coexistence, not complaint-marker + carry-target
  coexistence.
- `?harness=kitchen-bottleneck` (drives `updateCarryTargets` directly, same call `GameClient.ts`
  makes for the self player's own carrying): spawned a ready dish, used the harness's own "Pickup:
  claim ready dish(es)" fixture to put the owner in a carrying state, and confirmed the blue "T03"
  chip + pulsing ring rendered correctly above the destination table — proving the wayfinding
  removal did not touch this separate code path (different sprite name, different anchor, table
  entity meshes themselves untouched by `buildWayfinding`'s change). This harness's own
  `syncScene` passes `tables: []` to `updateFloorState`, so it never drives the complaint marker —
  it only demonstrates the carry-target path is intact.
- **No harness exercises the complaint marker and the carry-target marker on the same table at the
  same time** — that specific three-way coexistence (4-state badge + carry-target chip + complaint
  marker, all visible on one table) is verified by the sprite-span arithmetic in the
  `COMPLAINT_GLYPH_Y` constant's comment (badge spans 1.475-1.925, carry chip spans 1.71-2.39,
  complaint glyph at scale 1.0/y=3.0 spans 2.5-3.5 — no overlap with either), not by a screenshot.
  The margin is large enough (2.5 vs. the carry chip's 2.39 top edge) that this is a low-risk gap,
  but it is a gap, not a claim I saw all three at once.
- Drove a real match through the browser (main menu → "Play vs Bot" → played through
  setup/menu/pricing → reached the Service phase live) — a real UI flow, not the
  `POST /api/dev/match {bot:true}` endpoint directly. This additionally confirmed tables in the
  actual production HUD render only their state-derived badge (a yellow "O" for order_taken), no
  permanent number anywhere, consistent with the harness finding. The match ended (0:47 elapsed of
  a short smoke timeline) before any party's patience crossed the unhappy threshold, so this did
  NOT live-verify the complaint marker itself — that AC rests on the asset-showcase harness
  evidence above, not on anything seen in the live match.

**Falsification.** Reverted `buildWayfinding`'s `if (entity.type === 'table') continue;` (restored
the old `formatTableChip` ternary) and confirmed the T01-T06 placards reappeared in
`?harness=restaurant-layout`; restored the fix and confirmed they disappeared again. Separately,
disabled the `if (!unhappyTableIds.has(tableId)) marker.visible = false;` line in
`updateComplaintMarkers` and confirmed the complaint ring incorrectly persisted in
`?harness=asset-showcase` after switching away from the unhappy variant; restored the fix and
confirmed the marker cleared correctly again. Both edits were made, verified to break the behavior,
then reverted before committing — `git diff` was clean of the temporary changes at commit time.

**Judgment calls.**
- Used `STATE_COLORS.critical` instead of the `.bottleneck` this story's own approach_summary named
  — see the color paragraph above for why the summary's premise ("bottleneck is the existing red
  tone") doesn't hold up against `state-colors.ts`'s actual hex values, and why `.critical` is both
  the literal and semantically correct choice.
- Chose a pure-vertical anchor (y=3.0) for the complaint glyph over a horizontal offset, matching
  this file's own `STATION_WAITING_ANCHOR` precedent, rather than inventing a new x/z-offset
  vocabulary for table sprites — see the `COMPLAINT_GLYPH_Y` constant's comment for the exact span
  arithmetic that motivated this.
- Made the complaint ring bigger than (rather than the same size as) the carry-target ring, so
  the rare case of an inbound delivery to an already-unhappy table renders as two concentric,
  differently-colored rings (distinguishable by radius and color) instead of one ring occluding
  the other.
- Added a `table_unhappy` entry to `asset-showcase-harness.ts`'s `DISH_VARIANT_DEFS`, matching the
  existing convention that every table-badge state gets a showcase entry — this also became the
  primary tool for visually verifying the coexistence and instant-clear ACs above.
- `npm run check`'s `check:bot-menu-smoke` step failed once on a re-run during this story's testing
  (a timing-sensitive assertion about socket-disconnect state, unrelated to any client-only file
  this story touches) and passed cleanly on immediate re-run and on the final full `npm run check`
  — flagged here as a pre-existing flake, not a regression introduced by this change.
