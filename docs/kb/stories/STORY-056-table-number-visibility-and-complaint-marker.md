---
id: STORY-056
title: Table numbers only when delivering; a real complaint marker
status: in-progress
prd_source: null
branch: story/056-table-number-visibility-and-complaint-marker
worktree_path: /Users/brent/table-stakes-worktrees/story-056-table-number-visibility-and-complaint-marker
base_branch: master
pr_url: null
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
updated: 2026-09-12
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

- [ ] The permanent per-table number label built by `buildWayfinding` is removed (station/pass/
  other wayfinding labels are unaffected — this is scoped to `entity.type === 'table'` only).
- [ ] A table's number is still visible via the existing carry-target marker while a player is
  actively carrying an order bound for it (verify this still works after the wayfinding change —
  it's a separate code path but confirm no shared state was accidentally touched).
- [ ] An unresolved complaint (`party.unhappy === true`) now renders a clearly distinct, highly
  visible marker above the table/customers — not just a re-tinted version of an existing badge
  glyph. It should be visible at a glance from the normal play camera distance, not require the
  player to be standing next to the table.
- [ ] The complaint marker clears the instant `party.unhappy` goes false (complaint handled, or the
  party leaves) — no stale marker left behind.
- [ ] The complaint marker and the existing 4-state table badge (order_taken/meal_delivered/
  paying/dirty) can coexist without either obscuring or being confused for the other.
- [ ] `npm run check` (including `build:client`) stays green.

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
