---
id: STORY-053
title: Kitchen staging — don't show an incomplete order's early dishes as neglected
status: pr-opened
prd_source: null
branch: story/053-kitchen-staging-for-incomplete-orders
worktree_path: /Users/brent/table-stakes-worktrees/story-053-kitchen-staging
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/74
is_architectural: false
approach_summary: >
  Re-verified every citation in this story's own investigation against the CURRENT codebase
  (touched by many stories since this was written) — all still accurate: `order-system.js`'s
  `toPublicOrderSnapshot` (line ~1123) publishes `orderId`+`ticketId`+`state: ticket.state` (per-
  TICKET, confirmed) per entry in `orders[]`; `GameClient.ts`'s `selfReadyOrders`/`readyDishes`
  reconcile (line ~894-914) filters `orders[]` on `o.state === 'ready'` alone, with no sibling
  check; `RestaurantScene.ts#upsertReadyDish` (line ~1524) shows the READY/GOING COLD chip driven
  purely by `state.readyAgeMs > ORDER_FRESHNESS_GRACE_MS`; `MAX_READY_DISH_SLOTS = 8` still real.
  DESIGN: extract a new pure function into `shared/game-logic/` (new file, e.g.
  `kitchen-staging.js` + sibling `.d.ts`, matching this repo's established pattern for client-
  consumed-but-pure grouping logic — `recap-highlights.js`/`district-population.js` are the direct
  precedents, both small single-purpose modules with their own `check:*` script) rather than
  inlining the grouping in `GameClient.ts` — this makes the logic checkable by a real `check-*.mjs`
  script (pure data in, data out) instead of only reachable via `tsc --noEmit`/manual browser
  verification, which this codebase has no framework for on the client side. Input: the full
  per-restaurant `orders[]` array (every ticket, every state — NOT pre-filtered to `state ===
  'ready'`, since determining "how many siblings remain" needs to see the still-cooking ones too).
  Output: per `state === 'ready'` ticket, `{ ticketId, orderId, staged: boolean,
  waitingOnCount: number }` — `staged` true when the order has at least one sibling ticket whose
  `state` is `'queued'`/`'in_progress'` (mirror `order-system.js#allTicketsOffTheLine`'s own
  `t.state === 'ready' || t.state === 'cancelled'` predicate exactly, inverted, so this display
  logic's definition of "order complete" can never quietly drift from the server's real one —
  cite that function directly in a comment rather than re-deriving the rule independently).
  `waitingOnCount` is the count of such outstanding siblings.
  CLIENT WIRING: `GameClient.ts`'s existing `selfReadyOrders`/`readyDishes` reconcile block calls
  this new function against the FULL `orders` array for `restaurantId` (not the pre-filtered
  `selfReadyOrders`), and folds `staged`/`waitingOnCount` into each `readyDishes` entry —
  `ReadyDishRenderState` (`RestaurantScene.ts`) gains those two new fields. `upsertReadyDish` adds
  a third visual state alongside READY/GOING COLD: a "STAGED — waiting on N" label (own neutral
  color, distinct from the healthy-green/stale-orange freshness bands so it never reads as either)
  — while `staged` is true, force the ring to the healthy/neutral color and hide both READY and
  GOING COLD labels regardless of `readyAgeMs`, satisfying AC4's "staleness pressure does not
  apply while staged" without touching `readyAgeMs`'s computation or any server timing (AC1 is
  unconditional: no change to `allTicketsOffTheLine`/`deliverOrder`/scoring/freshness penalty
  timing anywhere). The instant the last sibling finishes, next snapshot's `staged` flips false and
  the SAME ticket entry (same `ticketId`, no despawn/respawn) transitions to the normal READY/
  GOING COLD treatment picking up wherever its real `readyAgeMs` actually is — AC5 falls out of
  this for free, no special transition code needed, because `staged` is just another field on the
  same per-snapshot upsert.
  TOAST (nice-to-have, AC6): `resolveDeliver`'s `not_ready` rejection (`action-validator.js` line
  245) carries no detail string server-side today and needs none added — the client already knows
  which order it's carrying (`self.carrying`, the same field `CarriedDishRenderState` already
  cross-references against `orders[]`, per that interface's own comment). In `GameClient.ts`'s
  delivery-rejection handler, before emitting the `delivery-rejected` presentation event, look up
  the carried order's own siblings via the SAME new `shared/game-logic` function and attach a
  count when it's genuinely the "still cooking" case; extend `PresentationEvent`'s
  `delivery-rejected` shape (`shared/game-logic/presentation-event-reducer.d.ts`) with an optional
  field, and `ArcadeToast.tsx`'s `DELIVERY_REJECTION_DETAIL['not_ready']` to interpolate it when
  present, falling back to today's generic "ORDER NOT READY YET" string otherwise (never invent a
  count when the true cause isn't sibling-tickets-still-cooking — `not_ready` can also fire from
  the defensive `!match.kitchen` guard, which has nothing to count).
  UPGRADE-TERMINAL CSS (separate, smaller ask): concretely verified, not assumed — `restaurant-
  layout.json` places `upgrade_terminal` at `[7,0,-7]` (`interactionRadius: 1.8`) and the nearest
  station (`station_plating`) at `[6,0,5]` with NO radius override, so it falls back to
  `OWNER_INTERACT_RANGE` (2.2, `shared/constants/tuning.js`) per `InteractionController#inRange`.
  Straight-line distance ≈12.04 world units against a combined trigger radius of at most 4.0 —
  nowhere close to simultaneous, confirming `.station-menu`'s own existing CSS comment ("far
  enough apart... should not happen") with real numbers rather than trusting the comment on faith.
  Re-verify this arithmetic directly rather than trusting this summary's restatement of it. Move
  `.upgrade-terminal` (`client/src/styles/app.css`, currently `right: 12px`) further left — pick a
  concrete new value and check it doesn't crowd any OTHER fixed screen-space UI chrome (not just
  `.station-menu`), since a pure world-distance check only rules out the one specific collision
  this story's Notes raised.
  CHECK: extend `scripts/check-orders.mjs` (it already has order/ticket state-machine fixtures to
  build on) with the new function's grouping/labeling behavior, falsified before trusting it, per
  house convention — a genuinely new, non-trivial derivation (which siblings count as
  "outstanding") warrants one, matching the AC's own instruction.
created: 2026-09-12
updated: 2026-09-12
---

# Kitchen staging — don't show an incomplete order's early dishes as neglected

Reported: "if the entire table's food isn't ready, you can't deliver it... I don't like seeing
the food queuing up that it's getting cold, but you can't deliver it yet." Confirmed by direct
investigation, not assumed:

- **The all-or-nothing delivery rule is real and intentional.** `order-system.js#allTicketsOffTheLine`
  gates `order.state → 'ready'` (and therefore pickup/delivery) until EVERY ticket in that order
  has finished — a deliberate "serve the table together" design, matching how a real restaurant
  doesn't send out half a table's food. **This story does not change that rule.**
- **The actual bug is presentation, and it's worse than just "no explanation."** A ticket that
  finishes cooking early is rendered at the service pass IMMEDIATELY (`GameClient.ts`'s
  `readyDishes` pool is built by filtering `orders[]` on each ticket's own `state === 'ready'`,
  per-ticket, not per-order) — `RestaurantScene.ts#upsertReadyDish` shows it with the same
  "READY"/"GOING COLD" chip (driven by `readyAgeMs`) a genuinely deliverable dish gets. So a dish
  that is blocked ONLY because its sibling dishes for the same order aren't done yet visually
  reads as "the player forgot to pick this up and it's spoiling" — actively misleading, not just
  uninformative. The delivery-rejection toast (`ArcadeToast.tsx`'s `DELIVERY_REJECTION_DETAIL
  ['not_ready']`) is a generic "ORDER NOT READY YET" with no count of what's still cooking.
- **No order-level completeness signal is published anywhere.** `OrderSnapshot` (`shared/schemas/
  game-state.d.ts`) carries per-TICKET `state`, never an order-level "how many siblings remain."
  However, every ticket already carries its own `orderId` — grouping client-side by `orderId` is
  possible TODAY with no new wire field (confirmed: the ticket-vs-order distinction is a real gap
  in what's SHOWN, not in what's already SENT).
- **Physical space is not the constraint.** `service_pass` is already an 8-slot counter
  (`MAX_READY_DISH_SLOTS = 8`, `RestaurantScene.ts`) with room to spare — the user's "bigger
  counter" framing is one possible fix, but the researched gap is legibility/grouping, not
  physical size. A visually distinct "staged, waiting on the rest of this order" treatment (the
  user's own "larger tray + incomplete indicator" alternative) is at least as strong a candidate
  and doesn't need new physical space.

Separately, in the same report: **move the upgrade-purchase terminal's on-screen panel further
left.** Investigated three candidates for "kitchen strategy upgrades" — the match is
`.upgrade-terminal` (`client/src/styles/app.css`), the panel listing Faster Grill/Pantry Shelves/
etc. (`shared/game-data/upgrades.json`), currently pinned `right: 12px`. (Ruled out: the Kitchen
Command Board's focus-strategy buttons are already horizontally centered, not right-anchored; the
3D `upgrade_terminal` prop's world position was already relocated once, PR #57, away from the
pickup sign — moving it again isn't what "further to the left" on a purchase panel suggests.)

## Acceptance Criteria

- [x] The all-or-nothing order-delivery RULE is unchanged — no change to `allTicketsOffTheLine`,
  `deliverOrder`, scoring, or freshness penalty timing. This story is presentation-only.
- [x] A ticket that finishes cooking while at least one sibling ticket (same `orderId`) is still
  `queued`/`in_progress` is rendered in a visually DISTINCT "staged" state — not the same
  "READY"/"GOING COLD" treatment a genuinely deliverable (whole-order-ready) dish gets. Group by
  `orderId` client-side (already-published data, per the investigation above) rather than adding
  a new snapshot field, unless the implementer finds a concrete reason client-side grouping is
  insufficient (state that reason explicitly if so — don't add server surface by default).
- [x] The staged state communicates WHY it's waiting — at minimum how many sibling dishes are
  still outstanding for that order (e.g. "Waiting on 2 more" or similar), not just a different
  color with no explanation.
- [x] The staleness/"GOING COLD" pressure either does not apply to a staged-incomplete dish, or is
  reframed so it doesn't read as player negligence — implementer's call on the exact visual
  treatment (a distinct staging tray/position vs. the same pass slot with a different badge/color
  — the user proposed both "bigger counter to hold several tables' worth" and "put it on a larger
  tray with an incomplete indicator"; physical space is NOT the bottleneck per this story's own
  research, so the size-increase framing is optional, not required, if the grouping/legibility fix
  alone resolves the complaint).
- [x] The instant the LAST sibling ticket for an order finishes, the whole group transitions
  together to the normal deliverable "ready" visual state — no dish is ever silently left behind
  in the staged treatment after its order is actually complete.
- [x] The delivery-rejection toast (`ArcadeToast.tsx`'s `not_ready` detail) is improved to name
  what's actually missing (e.g. dish/count still cooking) if that's cheaply derivable from the
  same client-side grouping — nice-to-have, not a hard blocker if it turns out to need new server
  data the rest of this story didn't already require.
- [x] Separately: `.upgrade-terminal`'s CSS panel (`client/src/styles/app.css`) moves further left
  from its current `right: 12px` anchor. Verify (don't assume) this doesn't create a real overlap
  with `.station-menu` (STORY-042, left-anchored specifically because `.upgrade-terminal` "owns
  the right side" per that file's own comment) — check the actual world distance between
  `upgrade_terminal`'s position and the nearest station in `restaurant-layout.json` against
  `OWNER_INTERACT_RANGE`/each entity's own `interactionRadius` to confirm both panels genuinely
  can't be triggered open simultaneously before assuming no conflict.
- [x] `npm run check` (including `build:client`) stays green; add a check if the client-side
  grouping logic is non-trivial enough to warrant one (an "orders with mixed ticket readiness are
  grouped and labeled correctly" assertion), following this repo's `check-*.mjs` conventions.

## Notes

- Not part of the recap-screen-redesign PRD slice (STORY-047-052) — a separate, unrelated
  gameplay/UX report. No `prd_source` PRD document exists for this one; `null` is correct.
- Cites: `server/src/game/systems/order-system.js#allTicketsOffTheLine`/`resolveReadyOrders`/
  `deliverOrder` — the rule this story explicitly preserves.
- Cites: `client/src/game/GameClient.ts`'s `readyDishes` pool construction and
  `client/src/scenes/RestaurantScene.ts#upsertReadyDish`/`READY`/`GOING COLD` chip — the exact
  code producing today's misleading "neglected" visual.
- Cites: `shared/schemas/game-state.d.ts`'s `OrderSnapshot` — confirms `orderId` is already
  published per ticket, which is what makes a client-only fix possible.
- Cites: `client/src/styles/app.css`'s `.upgrade-terminal` (`right: 12px`) and `.station-menu`
  (left-anchored, with an explicit comment about why) for the second, smaller ask.

## Implementation notes

**Shared logic.** `shared/game-logic/kitchen-staging.js` (+`.d.ts`) takes a restaurant's full
`orders[]` snapshot array and, for every ticket with `state === 'ready'`, reports `staged`/
`waitingOnCount` from its siblings — mirroring `order-system.js#allTicketsOffTheLine`'s own
`every(t.state === 'ready' || t.state === 'cancelled')` predicate, inverted, with a comment citing
that function directly. Wired into `GameClient.ts`'s `readyDishes` reconcile (against the full
restaurant-scoped `orders`, not the pre-filtered `selfReadyOrders`) and into
`RestaurantScene.ts#upsertReadyDish`'s new third label. `staged`/`waitingOnCount` were made
**required** fields on `ReadyDishRenderState`, not optional — this surfaced three other
construction sites (`InteractionController.ts` doesn't build the render state but does its own
independent order-completeness check; the two harnesses do) that needed updating for
`build:harnesses`/`build:client` to stay green. All are fixed; see below.

**A real duplicate found and consolidated (deviation from the approach_summary, in its own
spirit).** While tracing every place "is this order really deliverable" gets computed, found
`InteractionController.ts#pickupCandidate` already had its OWN independent, hand-rolled version
of the identical grouping/predicate (with a comment describing the exact bug this story fixes —
STORY-030/031's own prior discovery that a single ready ticket with a still-cooking sibling must
not offer the pickup prompt). That was a THIRD expression of `allTicketsOffTheLine`'s rule
alongside the server original and this story's new module — exactly the kind of drift the
approach_summary's "cite the function directly rather than re-deriving the rule" reasoning exists
to prevent. Refactored `pickupCandidate` to consume `kitchenStaging` instead of its own loop.
Not asked for explicitly in the approach_summary's touch-point list, but directly serves its
stated goal, low-risk (verified behavioral equivalence: same "all-cancelled order contributes
nothing," same "per-group oldest vs. global max over the union," same "cancelled siblings don't
count" cases), and confirmed green by `build:client`.

**Harness call sites.** `harnesses/src/kitchen-bottleneck-harness.ts`'s ticket model gives every
`MockTicket.ticketId` its own `orderId` (an existing, pre-STORY-053 simplification — see
`OwnerMock.carryingTicketIds`'s own comment) — no sibling can ever exist there, so `staged: false,
waitingOnCount: 0` is a true reflection of that harness's own model, not a stub. Added a THIRD
Ready-dish-proxy showcase variant to `asset-showcase-harness.ts` (`pass_ready_staged`, plus a
matching option in the "Restaurant Models" tab's own `PASS_OPTIONS` dropdown) that runs a real
synthetic two-ticket order through the actual `kitchenStaging` function rather than a hand-typed
`staged: true` — this wasn't explicitly requested, but the harness's whole purpose is exhibiting
every production visual state, and this story adds one.

**The toast (AC6).** Traced every path that can produce `action-validator.js#resolveDeliver`'s
`not_ready` reason. `resolvePickup` only ever claims an order once `order.state === 'ready'`
(`order-system.js#readyOrders` filters on exactly that), and an order's ticket set never grows
after creation — so by the time a plate is in `player.carrying`, EVERY ticket on that order is
already `ready` or `cancelled`. `resolveDeliver`'s `not_ready` (its own `deliverOrder` returning
false because `order.state !== 'ready'`) can therefore never fire for the "siblings still
cooking" reason on today's code path — that case is already fully prevented one layer up, at
pickup, by the very check `InteractionController.ts#pickupCandidate` makes (see above). The two
ways `not_ready` CAN actually fire today: (1) the defensive `!match.kitchen` guard
(`action-validator.js` line ~102, unreachable in a real running match, same as the file's own
comment says), and (2) a genuine race — the carried order's party's patience expires and the
order is `cancelled` while the plate is already in the owner's hands, so `deliverOrder`'s
`order.state !== 'ready'` check now sees `'cancelled'`. In case (2), `kitchenStaging` correctly
reports `waitingOnCount: 0` for that order (its tickets are `cancelled`, not cooking) — so the
generic "ORDER NOT READY YET" string is the CORRECT output there, not a fallback standing in for
dead code. Wired exactly as specified: `GameClient.ts` tracks `lastInteractTargetId` (new, same
send-site pattern as `lastInteractAction`) plus the last snapshot's `orders`/`self.carrying`
(new private fields, needed because `interact_rejected` arrives as a separate message with no
local closure over the snapshot handler's variables), looks up the carried order via table-id
cross-reference, and only attaches `waitingOnCount` to the emitted `PresentationEvent` when
`kitchenStaging` reports a value greater than zero. Today that condition is never true — this is
wired correctly for whenever it becomes reachable (e.g. a future worker/brigade delivery path),
not exercised by any check script (there is no reachable path to force it with today's rules,
and inventing one would test a scenario the codebase cannot currently produce).

**`.upgrade-terminal` CSS.** Moved from `right: 12px` to `right: 330px`. Re-verified the
story's own world-distance arithmetic directly rather than trusting the restatement: distance
from `upgrade_terminal` `[7,0,-7]` to `station_plating` `[6,0,5]` is `sqrt(1² + 12²) ≈ 12.04`
units (matches); combined trigger radius is `1.8 + 2.2 = 4.0` (matches). Went further and checked
every OTHER layout entity's distance to `upgrade_terminal` — the closest is actually `host_stand`
at `≈4.47` units (not `station_plating`), whose own panel (`.front-door-board`) is ALSO
right-anchored (`right: 22px; bottom: 88px`). `4.47 > 4.0` (combined radius `1.8 +
OWNER_INTERACT_RANGE 2.2`), so still provably impossible to trigger both at once — but a much
tighter margin (0.47 units of slack) than the `station_plating` case the story's Notes cited
(which has ~8 units of slack). Documented this as the closest real candidate in the CSS comment.
`.pantry-board` shares `.front-door-board`'s exact offsets too, but pantry's world position
(`[-6,0,9]`) is `≈20.6` units away — not a real candidate.

The BINDING constraint turned out to be neither of those two proximity-triggered panels, but the
two ALWAYS-VISIBLE HUD pieces `HudPanel.tsx` renders (`.hud-scoreboard`, `.hud-alerts`) — both
share `.app`'s single `position: relative` containing block with `.upgrade-terminal`
(`GameView.tsx` mounts all three as direct siblings under `.app`, confirmed by reading the JSX
before trusting this arithmetic, rather than assuming the containing-block premise held), so
they can visually collide with the upgrade panel regardless of the owner's
in-world position, any time the terminal is open during a live match. `.hud-scoreboard`
(`right:12px, width:270px`) requires `right >= 282px`; `.hud-alerts` (`right:12px, width:300px`)
requires `right >= 312px` — both exact, viewport-width-independent thresholds since all three
boxes share one containing block. Chose `330px`: 18px past the binding 312px floor, deliberately
NOT much further, because both `.hud-scoreboard`'s own comment ("keep the cutaway kitchen's
center visible") and `.upgrade-terminal`'s own pre-existing comment ("stays small and to one
side rather than covering the scene") argue against retreating toward screen center.

**Falsification.** `scripts/check-orders.mjs` section 13: hand-built fixtures for
`staged`/`waitingOnCount` (including the cancelled-sibling-doesn't-count case), the
last-sibling-finishes transition, and an identity check running a real 12-party, multi-dish
match tick-by-tick, comparing `kitchenStaging(snapshot.orders)` against the real internal
`order.state` on every tick. Broke the logic by replacing the sibling filter with a hardcoded
empty array (`staged` always false) — 4 of the new assertions failed as expected, including the
identity check (29,652 mismatches against real server state). Restored; all 58 checks pass again.
`npm run check` (all 37 check/build/smoke scripts, including `build:client`/`build:harnesses`)
passed clean end to end after restoring.
