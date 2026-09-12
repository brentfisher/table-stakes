---
id: STORY-053
title: Kitchen staging — don't show an incomplete order's early dishes as neglected
status: pending
prd_source: null
branch: null
worktree_path: null
base_branch: null
pr_url: null
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

- [ ] The all-or-nothing order-delivery RULE is unchanged — no change to `allTicketsOffTheLine`,
  `deliverOrder`, scoring, or freshness penalty timing. This story is presentation-only.
- [ ] A ticket that finishes cooking while at least one sibling ticket (same `orderId`) is still
  `queued`/`in_progress` is rendered in a visually DISTINCT "staged" state — not the same
  "READY"/"GOING COLD" treatment a genuinely deliverable (whole-order-ready) dish gets. Group by
  `orderId` client-side (already-published data, per the investigation above) rather than adding
  a new snapshot field, unless the implementer finds a concrete reason client-side grouping is
  insufficient (state that reason explicitly if so — don't add server surface by default).
- [ ] The staged state communicates WHY it's waiting — at minimum how many sibling dishes are
  still outstanding for that order (e.g. "Waiting on 2 more" or similar), not just a different
  color with no explanation.
- [ ] The staleness/"GOING COLD" pressure either does not apply to a staged-incomplete dish, or is
  reframed so it doesn't read as player negligence — implementer's call on the exact visual
  treatment (a distinct staging tray/position vs. the same pass slot with a different badge/color
  — the user proposed both "bigger counter to hold several tables' worth" and "put it on a larger
  tray with an incomplete indicator"; physical space is NOT the bottleneck per this story's own
  research, so the size-increase framing is optional, not required, if the grouping/legibility fix
  alone resolves the complaint).
- [ ] The instant the LAST sibling ticket for an order finishes, the whole group transitions
  together to the normal deliverable "ready" visual state — no dish is ever silently left behind
  in the staged treatment after its order is actually complete.
- [ ] The delivery-rejection toast (`ArcadeToast.tsx`'s `not_ready` detail) is improved to name
  what's actually missing (e.g. dish/count still cooking) if that's cheaply derivable from the
  same client-side grouping — nice-to-have, not a hard blocker if it turns out to need new server
  data the rest of this story didn't already require.
- [ ] Separately: `.upgrade-terminal`'s CSS panel (`client/src/styles/app.css`) moves further left
  from its current `right: 12px` anchor. Verify (don't assume) this doesn't create a real overlap
  with `.station-menu` (STORY-042, left-anchored specifically because `.upgrade-terminal` "owns
  the right side" per that file's own comment) — check the actual world distance between
  `upgrade_terminal`'s position and the nearest station in `restaurant-layout.json` against
  `OWNER_INTERACT_RANGE`/each entity's own `interactionRadius` to confirm both panels genuinely
  can't be triggered open simultaneously before assuming no conflict.
- [ ] `npm run check` (including `build:client`) stays green; add a check if the client-side
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
