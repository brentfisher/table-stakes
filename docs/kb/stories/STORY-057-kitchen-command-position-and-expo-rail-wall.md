---
id: STORY-057
title: Move the kitchen command board off the pass; expo rail becomes a back-wall display
status: pr-opened
prd_source: null
branch: story/057-kitchen-command-position-and-expo-rail-wall
worktree_path: /Users/brent/table-stakes-worktrees/story-057-kitchen-command-position-and-expo-rail-wall
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/81
is_architectural: false
approach_summary: >
  Two grouped reports, both about kitchen/back-of-house 3D layout and rendering. Neither needs a
  new server field — both work from data already published.
  PART 1 — kitchen command board position. Confirmed by reading `shared/game-data/
  restaurant-layout.json`: `kitchen_command_board` sits at `[2.5, 0, 2]`, THE SAME z-depth as
  `service_pass` at `[0, 0, 2]` (the "pass" zone spans z 1-3 per the layout's own `zones[]`; the
  "kitchen" zone proper is z 3-12). `RestaurantScene.ts`'s `readyDishSlotPosition` (line ~283-288)
  spans ready-dish proxies across local x ±`READY_DISH_SLOT_X_RANGE` (6.5) relative to
  `service_pass`'s own origin — i.e. world x -6.5..6.5 at that same z=2 — which fully covers
  `kitchen_command_board`'s x=2.5. This is a real, quantified overlap: the "RUSH THE PASS" command
  post (and its `kitchen-focus-options` panel, `KitchenCommandBoard.tsx`) sits dead center in the
  same physical row ready food appears in, confirmed not assumed. Fix: move `kitchen_command_board`
  deeper into the kitchen zone (increase z well past 3, e.g. to sit alongside `station_prep`/
  `station_grill`/etc. at z=5, or between the pass and those stations) — pick a concrete new
  position, verify it doesn't newly collide with any station or the `kitchen_order_queue_board`
  (currently at `[-3, 0, 10.8]`), and that its `interactionRadius: 1.6` doesn't overlap another
  interactable's trigger radius (same distance-check discipline STORY-053 used for
  `.upgrade-terminal`). Only reposition this ONE entity — `service_pass`, the stations, and
  `kitchen_order_queue_board` are not part of this report and should not move.
  PART 2 — expo rail. CORRECTION to this story's own original premise, found by reading the
  CURRENT codebase (STORY-043, already merged before this story was written — the original
  approach_summary missed it): the expo rail is NOT click-gated-only. `kitchen_order_queue_board`
  already carries a live, ALWAYS-VISIBLE 3D display — `upsertQueueBoardDish`/`queueBoardDishes`
  (`RestaurantScene.ts` ~line 1717-1764), driven by `GameClient.ts`'s unconditional (no proximity/
  E-press gate) `registry.reconcile('queueBoardDishes', kitchenQueueBoard.map(...))` (~line
  959-968) every snapshot. It renders real 3D dish-proxy models (`buildDishProxy`, the SAME
  low-poly models used at the pass/in carried hands) in a 5-column×2-row grid
  (`QUEUE_BOARD_COLUMNS`/`QUEUE_BOARD_ROW_Y`, ~line 340-358) mounted directly on the board's own
  3.4×1.8×0.22 box (`buildEntity`'s `kitchen_order_queue_board` case, ~line 1167-1168), ranked by
  priority, moving toward the front as rank changes. What actually IS click-gated (E-press,
  `GameView.tsx`'s `nearKitchenOrderQueueBoard && showKitchenOrderQueueBoard`) is ONLY the
  SUPPLEMENTARY text-detail DOM panel (`KitchenQueueBoard.tsx`) showing station/remaining-seconds/
  blocked-ingredient text the 3D proxies can't convey. So the report ("shows the items when you
  click it... I would rather the entire back wall have 2d pictures... largely") is best read as:
  the EXISTING always-visible 3D display is too small/hard to read at a glance (a 3.4-unit-wide
  board, real-scale 3D dish models, at the far end of the kitchen) — not that nothing is visible
  without clicking. The fix is to ENLARGE/replace this existing display, not build a new one from
  nothing: swap the compact 3D dish-proxy grid for large, flat 2D dish pictures on a much bigger
  mounted surface at/around the same landmark (deep in the kitchen zone, near
  `kitchen_order_queue_board`'s current z≈10.8, close to the z=12 kitchen-zone boundary) — note
  there is no literal wall geometry anywhere in this scene (it's an open floor-plan cutaway, no
  `buildWalls`-style mesh exists), so "the entire back wall" means enlarging/replacing this board's
  own mesh into a large flat panel, not attaching to pre-existing wall geometry. Keep using
  `status.kitchenQueueBoard` (`you.kitchenQueueBoard` on the wire, already sorted by priority,
  `order-system.js#queuedTicketsAcrossStations`) — no new field needed, same data
  `upsertQueueBoardDish` and `KitchenQueueBoard.tsx` already both read. Build large, flat 2D dish
  images (canvas-textured planes/sprites, reusing or extending `client/src/scenes/icon-sprites.ts`'s
  rasterize-once-cache-forever discipline) rather than continuing with 3D proxy models — the
  report explicitly asks for 2D pictures, a deliberate simplification for at-a-glance readability
  from across the kitchen, consistent with this file's own "bumped 1.6x... hard to read from the
  normal play camera" precedent for wayfinding labels. Decide explicitly whether to keep the
  existing 3D dish-proxy grid AND add the new large 2D wall (redundant, probably not warranted) or
  replace the 3D grid with the new 2D wall entirely (likely the right call — same data, one visual
  treatment, avoids two competing representations of the same list). Either way, the existing
  click-gated `KitchenQueueBoard.tsx` text-detail panel can stay as a supplementary detail view
  (station/seconds-remaining/blocked-ingredient text a picture can't show) unless it now visually
  conflicts with the enlarged wall — rasterize once per distinct dish, cache, tint per instance,
  the same discipline `icon-sprites.ts` already documents, rather than inventing a new texture
  pipeline; check `shared/game-data/dishes.json` and `client/src/scenes/FoodModels.ts`/
  `food-preview-renderer.ts` for any existing per-dish 2D artwork/icon before drawing new ones
  from scratch.
created: 2026-09-12
updated: 2026-09-13
---

# Move the kitchen command board off the pass; expo rail becomes a back-wall display

Two grouped reports, both about the kitchen's physical/visual layout:

1. **"the 'rush the pass' and restaurant options are in the middle and sometimes collide with
   food, put the option back deeper in the kitchen"** — the kitchen command board sits at the same
   depth as the service pass, in the middle of the row where ready food appears.
2. **"the expo rail shows the items when you click it. I would rather the entire back wall have
   2d pictures of the dishes we need to make largely"** — CORRECTED after re-reading the current
   codebase (see `approach_summary`): the queue board already has a live, always-visible 3D
   dish-model display (STORY-043) — it's not click-gated. Only a supplementary text-detail panel
   is click-gated. The real gap is that the existing always-visible display is small (a compact
   3.4-unit board with small 3D models) and hard to read at a glance — the fix is to enlarge/
   replace it with a much bigger, 2D-picture-based display, not to build visibility from scratch.

## Acceptance Criteria

- [x] `kitchen_command_board`'s world position no longer overlaps the ready-dish slot span at the
  service pass (world x -6.5..6.5 at z=2) — moved meaningfully deeper into the kitchen zone (z > 3).
- [x] The move is verified against every other kitchen entity's position/`interactionRadius` (not
  just eyeballed) to confirm no new collision was introduced.
- [x] The kitchen shows large, always-visible 2D pictures of the dishes currently needed (driven by
  `status.kitchenQueueBoard`, the same data both `upsertQueueBoardDish` and `KitchenQueueBoard.tsx`
  already read) — replacing or substantially enlarging the existing small 3D dish-proxy grid on
  `kitchen_order_queue_board`, visible at a glance from across the kitchen without walking up.
- [x] A decision is made and documented on whether the existing 3D dish-proxy grid is replaced
  entirely by the new 2D display or kept alongside it (replacing is the default expectation —
  justify explicitly if keeping both).
- [x] The 2D display updates live as the queue changes (a dish is completed and leaves the queue,
  a new ticket is queued, priority order shifts) — no stale entries.
- [x] A decision is made and documented about whether the existing click-to-open `KitchenQueueBoard`
  text-detail DOM panel is kept alongside the new large display or removed, with reasoning either
  way.
- [x] `npm run check` (including `build:client`) stays green.

## Notes

- Not part of any PRD slice (`prd_source: null`) — standalone gameplay-clarity reports.
- Cites: `shared/game-data/restaurant-layout.json` (`kitchen_command_board`/`service_pass`/station
  positions), `client/src/scenes/RestaurantScene.ts` (`READY_DISH_SLOT_X_RANGE`,
  `readyDishSlotPosition`, `buildWayfinding`'s "EXPO RAIL" label comment), `client/src/ui/
  KitchenQueueBoard.tsx` (today's click-to-reveal TEXT-DETAIL panel and its own comment
  distinguishing it from `KitchenCommandBoard`), `client/src/app/GameView.tsx` (the
  `nearKitchenOrderQueueBoard && showKitchenOrderQueueBoard` toggle-on-E gate — scoped to the
  text-detail panel only, not the 3D display), `client/src/scenes/icon-sprites.ts` (existing
  canvas-texture sprite/caching discipline to reuse for the new 2D pictures).
- Cites (correction source): `RestaurantScene.ts`'s `upsertQueueBoardDish`/`queueBoardDishes`
  (STORY-043) and `GameClient.ts`'s unconditional `registry.reconcile('queueBoardDishes', ...)` —
  the ALREADY-EXISTING always-visible 3D dish-model display this story's Part 2 enlarges/replaces,
  not builds from nothing. Re-verify this is still current before starting; it was confirmed
  present on 2026-09-13, one merge after this story was originally drafted.
- `KitchenCommandBoard.tsx`'s own focus-selection mechanic (Rush the Pass / Protect the Special /
  etc.) is unrelated to this story and must not change — only the 3D world POSITION of the board
  moves, not its behavior or UI panel contents.

## Implementation notes

**Part 1 — `kitchen_command_board` reposition.**

Moved `shared/game-data/restaurant-layout.json`'s `kitchen_command_board` from `[2.5, 0, 2]` to
`[4, 0, 3.5]`. Only this one entity's `position` changed — `service_pass`, all four stations, and
`kitchen_order_queue_board` are byte-identical to before.

Numbers, checked not eyeballed (also written as a heavy comment right above the
`case 'kitchen_command_board':` in `RestaurantScene.ts#buildEntity`):

- *Old bug, confirmed*: old position `[2.5, 0, 2]` sat at the exact same z as `service_pass`
  (`[0, 0, 2]`), and `readyDishSlotPosition`'s `READY_DISH_SLOT_X_RANGE` (6.5) spans ready-dish
  proxies across world x -6.5..6.5 at that same z — fully covering x=2.5.
- *Physical footprint, new position*: `service_pass`'s box (`this.box(16, 0.9, 0.8, ...)`) spans
  z 1.6-2.4; `kitchen_command_board`'s own 0.22-deep box at z=3.5 spans z 3.39-3.61 — a 0.99 gap,
  independent of x. Each station's box (`this.box(2.4, 1.0, 1.4, ...)`) at z=5 spans z 4.3-5.7 — a
  0.69 gap from the board's 3.61 max. No physical overlap with anything.
- *Trigger-radius footprint, new position*: found (by grepping `\.interactionRadius\b` across the
  whole client+server) that `kitchen_command_board`'s own declared `interactionRadius: 1.6` is
  DEAD — nothing reads it except `upgrade_terminal`'s two call sites. The real "near" trigger for
  both the client (`InteractionController.ts#inRange`) and the server
  (`action-validator.js#requireRange`) is the fixed `OWNER_INTERACT_RANGE` (2.2), for every
  command post and station alike. That matters because `GameClient.ts#onInteract`'s
  `if (nearKitchenCommandBoard) {...; return;}` sits ABOVE the fallback that resolves a station's
  own `E — Cook X` prompt — if the board's trigger circle had reached a station's own anchor
  point, standing at that station to cook would have opened the command board instead. Checked:
  at x=2.5 (the original x, matching `station_oven`'s x=2), no z between 3 and 5 clears 2.2 from
  the oven (`z < 2.857` needed, which is below the z=3 floor) — so x had to move too, not just z.
  Chose x=4 (the oven/plating midpoint): distance from `[4, 3.5]` to `station_oven [2,0,5]` and
  `station_plating [6,0,5]` is `sqrt(2²+1.5²) = 2.5` each; to `service_pass [0,0,2]` it's
  `sqrt(4²+1.5²) = 4.27`; everything else (`station_prep`, `station_grill`, `pantry`,
  `dishwashing`, `kitchen_order_queue_board`) is `>=5.85` away. Every one exceeds 2.2 — no other
  interactable's own anchor point falls inside the board's trigger circle. (The stricter
  "combined-radii" ceiling of 4.4 that STORY-053 used for `.upgrade-terminal` is NOT clear at 2.5
  vs. the two nearest stations — but that stricter bar is already broken elsewhere in this shipped
  layout by design: adjacent stations sit exactly 4 apart against their own 2.2+2.2 ceiling, and
  `kitchen_order_queue_board`-to-`pantry` is ~3.5 apart against the same ceiling. The bar this
  layout actually relies on everywhere is "no two anchor points overlap the other's circle", which
  the new position clears with real margin.)

**Verified in the browser** (`npm run dev:harnesses`, `?harness=restaurant-layout`): screenshotted
before and after. Before: "RUSH THE PASS" sat directly on/behind the service-pass counter, in the
same row as "PICKUP". After: it renders tucked between "OVEN" and "PLATING", clearly deeper into
the kitchen, with the pass counter's own tan strip clearly in front of/below it. Also verified in
`?harness=kitchen-bottleneck` with "Ready food: spawn mixed batch" (5 ready dishes spread across
the full 16-unit pass, T02-T06): the repositioned board renders well clear of every plate, up near
the stations, with zero visual overlap.

**Part 2 — expo rail becomes a large 2D display.**

Re-verified the story's own correction before starting: `RestaurantScene.ts#upsertQueueBoardDish`
is still called unconditionally from `GameClient.ts`'s `registry.reconcile('queueBoardDishes', ...)`
every snapshot (no proximity/E-press gate) — the always-visible 3D display is real. `GameView.tsx`'s
`nearKitchenOrderQueueBoard && showKitchenOrderQueueBoard` gate is confirmed to scope only
`KitchenQueueBoard.tsx`'s text-detail panel. Both re-confirmed by reading the current code, not
just trusting the story file.

Built for each catalogue dish a big flat 2D "picture card": a cream rounded-rect background, a
big colored circle (`DISH_PICTURE_ACCENTS`, one accent hue per dish, loosely matched to each
dish's real ingredient palette) with a 1-2 letter white monogram, and the full dish name below —
"a colored shape + a short label/glyph", not an illustration pipeline. Checked first for existing
2D dish artwork to reuse: `dishes.json` has no icon/image field; `FoodModels.ts` and
`food-preview-renderer.ts` are both 3D-model-only (GLB loading and a WebGL turntable blitted into
a DOM canvas, respectively) — no reusable flat picture exists anywhere, so these were drawn fresh.
Built with `client/src/scenes/icon-sprites.ts`'s existing "rasterize once per distinct key
(`dishId`), cache the `CanvasTexture` forever, build a new cheap `Sprite`/`SpriteMaterial` per
instance" discipline (`dishPictureTexture`/`createDishPictureSprite`) — no new texture pipeline.

Enlarged `kitchen_order_queue_board`'s own mesh from `3.4 x 1.8 x 0.22` to `9 x 4.4 x 0.3`
(`buildEntity`'s case) — the entity's own world `position` (`[-3, 0, 10.8]`, unmoved by Part 1's
reasoning either) is untouched, so no interactionRadius/trigger math changes. Checked room: at
x=-3 with a 9-wide panel it spans world x -7.5..1.5 (1.5-unit margin inside the layout's own
minX=-9); at z=10.8 with a 0.3-deep panel it spans z 10.65-10.95, a 1.05 gap from both
`pantry`/`dishwashing`'s boxes (z 8.4-9.6) and the kitchen zone's own z=12 boundary.

**REPLACED the 3D dish-proxy grid, did not keep both.** `upsertQueueBoardDish` now builds a
`createDishPictureSprite` per ticket instead of `buildDishProxy`. Keeping both would show the
identical list twice in two representations on the same board — the story's own notes call this
"probably not warranted", and the report explicitly asked for 2D pictures, not 2D pictures in
addition to the existing 3D models.

Grid layout numbers: `QUEUE_BOARD_COLUMNS` stayed 5 (10 slots, 2 rows). `QUEUE_BOARD_SLOT_X_RANGE`
scaled from the old board's 1.5 (an 0.88 fill ratio of its 1.7 half-width) to 4.0 (0.88 of the new
4.5 half-width). `QUEUE_BOARD_ROW_Y` needed TWO passes, both driven by real measurement, not
assumption:

- *Pass 1 (wrong, caught in review before merging)*: assumed a bare `this.box(...)` mesh spans
  `-height/2..+height/2` in world space (`BoxGeometry` is center-pivoted; `buildEntities` sets
  `mesh.position` to the entity's layout position verbatim, y always 0 in the layout) — confirmed
  with a throwaway `new THREE.Box3().setFromObject(mesh)` console probe against the real running
  scene (`minY=-2.2, maxY=2.2` for the 4.4-tall board, exactly as predicted), then picked row
  centers `[1.05, -0.95]` to fit inside THAT span. The measurement was real; the conclusion was
  wrong — a board straddling the floor by design is itself a bug, not something to fit cards
  around. Row 2's span (-1.8 to -0.1) was entirely BELOW y=0, i.e. under the floor. It only ever
  appeared to work because `createDishPictureSprite` used `depthTest: false` at the time, which
  painted the (actually invisible-underground) bottom row over the floor tiles regardless — a real
  screenshot with that setting showed exactly this: the bottom row rendered on the WHITE FLOOR near
  the stove, not on the dark panel.
- *Pass 2 (current, fixed)*: `buildEntity`'s `kitchen_order_queue_board` case now wraps the panel
  mesh in a `THREE.Group` — `buildEntities`' position-clobber lands on the GROUP (to the entity's
  real x/0/z), while the CHILD panel mesh keeps its own `position.y = height/2` (nothing overwrites
  a child's position) — so the panel genuinely spans world y **0..4.4**, sitting on the floor like
  an actual wall panel should. Row centers recomputed against this real span: `[3.25, 1.25]` —
  row 1 spans 2.4-4.1 (0.3 clear of the 4.4 top edge), row 2 spans 0.4-2.1 (0.4 clear of the y=0
  FLOOR — the number that matters, replacing the old, wrong "-2.2 bottom edge" reasoning). Re-
  screenshotted and confirmed both rows now render ON the dark panel.

**A second, related bug from the same pass-1 mistake: `QUEUE_BOARD_SLOT_Z`'s sign.** The old 3D
`buildDishProxy` proxies sat at local z=+0.55 and were clearly visible (solid 3D models have real
thickness, so part of a model can still poke past the panel's face toward the camera even with the
"wrong" sign). This story's flat, zero-thickness sprite cards at the equivalent +0.4 rendered
NOTHING once `createDishPictureSprite` used normal depth testing — confirmed by temporarily
re-enabling `depthTest: false`, which painted the (existing, correctly-positioned-in-x/y) cards
back on screen: they were there, just fully occluded BEHIND the panel from the camera's side.
Flipped the sign to `-0.4` (confirmed in the browser: cards now render in front of the panel,
correctly occluded by nearer geometry) — that is the actual "toward camera" direction for this
board's local frame.

**Found and fixed a knock-on visual bug from enlarging the board**: `buildWayfinding`'s "EXPO
RAIL" text label and "E" command-post badge use one shared fixed y-offset pair (0.19/1.75) for
every command post — fine for boards that didn't grow, but this board's real top edge is now 4.4
(was 0.9) while those offsets stayed put. Confirmed in the browser (`?harness=kitchen-bottleneck`,
"Spawn rush (8 tickets)"): the "E" badge rendered stamped on top of a picture card before this fix
existed. Fixed by giving `kitchen_order_queue_board` alone a lifted pair (`QUEUE_BOARD_LABEL_Y`
4.95, `QUEUE_BOARD_BADGE_Y` 6.0, both clear of the panel's real 4.4 top edge) — re-screenshotted
and confirmed both float cleanly above the whole picture grid, with no visible roofline clipping.

**Reconsidered and reversed `depthTest` on the cards.** Originally shipped with `depthTest: false`
(matching `createGlyphSprite`/`createLabelSprite`'s "always readable" convention for small badges).
That convention is wrong for ~10 much bigger cards with real standoff: it painted a mispositioned
row over the floor and pantry shelving instead of surfacing the pass-1 bug above, and would keep
painting every card over anything between it and the camera (a worker walking past the board) even
once correctly positioned. Switched to normal depth testing (the material's default) — a card is
still drawn in front of its own panel (which sits behind it at a smaller local z) while nearer
geometry correctly occludes a card.

**Live updates**: `status.kitchenQueueBoard` is the same data source as before (no new server
field) — `upsertQueueBoardDish`/`removeQueueBoardDish` are called from the exact same
`EntityViewRegistry.reconcile('queueBoardDishes', ...)` seam STORY-043 built, unchanged. This story
added `queueBoardDishRenderStates`/diff wiring to `harnesses/src/kitchen-bottleneck-harness.ts`
(previously this display had ZERO harness coverage — STORY-043 shipped without one), reusing that
harness's EXISTING queued-ticket buttons (no new button needed). Directly observed in the browser:
spawned 2 tickets (2 cards), used "Cook enabled" off + "Spawn single ticket" to add a 3rd in a
controlled state, watched the count go 2 -> 3 immediately (a real, screenshotted ADD); spawned a
rush of 8 more and watched the full 5x2 grid populate with distinct, legible, correctly-positioned
cards (SB/CS/N/PP monograms, correct names, both rows on the panel, no floor/pantry bleed). The
REMOVE side (a ticket leaving `queued` when dispatched) was NOT directly screenshotted successfully
— this harness's simulation clock only advances inside its `requestAnimationFrame` loop
(`advanceSim`/`syncScene` are both called only from `loop()`, `kitchen-bottleneck-harness.ts`), and
repeated real-time `wait()`s in this browser session showed the cook's own busy countdown frozen at
its initial value across many seconds of wall-clock waiting, consistent with this environment's
documented "`visibilityState: hidden` kills rAF" limitation — clicks visibly forced a frame (new
tickets appeared instantly) but passive waiting for simulated time to pass did not visibly advance
anything. So AC5's "a dish is completed and leaves the queue" leg rests on CODE-PATH REASONING, not
a screenshot: `queueBoardDishRenderStates` filters `t.state === 'queued'` fresh every `syncScene()`
call, and the present/remove diff against `lastQueueBoardDishIds` is structurally identical to
`readyDishRenderStates`/`lastReadyDishIds`'s own diff, which this same codebase already relies on
for tickets leaving the READY list on pickup/delivery — same mechanism, same guarantee, not a
parallel one invented for this story.

**Judgment call — kept the click-to-open `KitchenQueueBoard.tsx` text-detail panel.** It's a fixed
`position: fixed` DOM overlay (bottom-center, `.kitchen-queue-board` in `app.css`), entirely
independent of the 3D scene and its camera — enlarging the 3D board doesn't touch it, and it still
carries real information (station, remaining seconds, blocked ingredient) no picture card shows.
No visual conflict was found or introduced.

**Falsification.** For Part 1's server-side check (`scripts/check-kitchen-command.mjs`), the
`fixture()` helper's mock player position was hardcoded to `{x: 2.5, z: 2}` — the board's OLD
exact position, to test "a focus change at the physical pass board succeeds". After moving the
board this became stale data that only still passed by a 0.08-unit margin (distance 2.121 vs. the
2.2 range). Updated it to the board's real new position (`{x: 4, z: 3.5}`), then falsified: set it
to a genuinely far point (`{x: 20, z: 20}`) and confirmed `AssertionError [ERR_ASSERTION]: false
!== true` on "a focus change at the physical pass board succeeds" (uncaught, script exits 1);
restored the real fixture and confirmed 13/13 pass again. For Part 2, THREE separate real bugs
were each found by an actual observed break, not by only reasoning about one: (1) the floor-
straddling panel/underground bottom row, caught by a first-draft screenshot showing cards on the
floor tiles instead of the panel; (2) the wrong-signed `QUEUE_BOARD_SLOT_Z`, caught because fixing
(1) and switching to normal depth testing together made every card vanish, then isolated to the z
sign specifically by temporarily toggling `depthTest` back to `false` (cards reappeared, proving
they existed and were merely occluded) before flipping the sign and confirming with `depthTest`
left at its normal (non-`false`) value; (3) the label/badge stamped on a card, caught by a
screenshot before `QUEUE_BOARD_LABEL_Y`/`QUEUE_BOARD_BADGE_Y` existed. Each was fixed, rebuilt, and
re-screenshotted to confirm the specific fix before moving on — this file's own git history reflects
an initial commit that shipped bugs (1) and (2) undetected until a second, more skeptical
verification pass caught them; that pass and its fixes are folded into the code and this note
rather than left as a visible "oops" commit, but the sequence is disclosed here in full since it is
directly relevant to how much to trust the remaining unverified leg (the REMOVE side of live
updates, discussed above).

**Verification summary**: `npm run check` (including `build:client` and `build:harnesses`) is
fully green — every check script passed, script counts unchanged except `check-kitchen-command.mjs`
which stayed at 13/13 with its fixture corrected. Both parts were confirmed by real rendering in
`claude-in-chrome` against the dev harness server (screenshots taken before/after each fix), with
one explicitly named exception (the REMOVE side of Part 2's live-update AC, above) that rests on
code-path equivalence with an already-proven mechanism rather than a direct screenshot, due to this
environment's rAF limitation.

**Handoff note (parent session, not the implementing agent).** The implementing agent's session
hit an API rate limit immediately after finishing the notes above, before it could `git commit` the
uncommitted Part 2 fixes (floor-straddle/Z-sign/label-badge, all three documented above) or update
this file's frontmatter. The parent session reviewed the uncommitted diff against these notes
(fully consistent — the notes already described the final, corrected state, not the buggy first
commit), committed it as-is (`065e74d`), then independently re-ran `npm run check` fresh in the
worktree (green, exit 0) and reviewed the diff before opening the PR. No additional code changes
were made by the parent session.
