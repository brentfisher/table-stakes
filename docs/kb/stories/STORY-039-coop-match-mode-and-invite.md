---
id: STORY-039
title: Co-op match mode and invite entry point
status: pr-opened
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: story/039-coop-match-mode-and-invite
worktree_path: /Users/brent/table-stakes-story-039
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/58
is_architectural: true
approach_summary: >
  Add a new `mode: 'coop'` value to `POST /api/rooms`, reusing the existing private-invite
  token/joinUrl plumbing in `server/src/http/routes.js` (`inviteHost()`, invite token
  generation) rather than building a second invite system. A co-op room seats two players into
  ONE shared restaurant (`match.restaurants` carries a single entry, not two) with no bot
  opponent and no rival. Likely touches `server/src/http/routes.js`, `server/src/game/
  match-manager.js`, wherever `match.js`/`customer-system.js` currently assume exactly two
  restaurants, and the client main menu for a new "Co-op" entry plus invite-link sharing UI
  matching the existing private-human flow. District-choice behavior with only one restaurant
  in the pool needs an explicit, documented call (see the story's own AC3), not a silent
  fallback. New coverage in the style of `scripts/check-invite-lobby.mjs`.
created: 2026-09-10
updated: 2026-09-11
---

# Co-op match mode and invite entry point

Today every match is competitive: two owners (human or bot), each running their own restaurant,
drawing from one shared district (`server/src/game/systems/customer-system.js`'s district-choice
model). This story adds a **co-op** match mode where two players run **one shared restaurant**
together, with a menu entry and invite flow to start one.

This is the foundation story for the whole co-op slice (STORY-040 through STORY-043 build on it)
and should land first. It does NOT need to build the no-staff kitchen rework, the timed-cooking
UI, or the kitchen queue board — those are later stories. This story's job is: a co-op match
exists, has exactly one restaurant, and two players can get into it together.

`http/routes.js` already has a working precedent for a distinct match mode with its own invite
flow: `mode: 'private_human'` (`POST /api/rooms`, invite token generation, `joinUrl` building via
`inviteHost()`) and `mode: 'solo_bot'` (STORY-025's menu-flow room). A co-op mode is a new `mode`
value using the same invite-link plumbing — not a rebuilt invite system.

## Acceptance Criteria

- [x] A new `mode` value (e.g. `'coop'`) is accepted by `POST /api/rooms`, alongside the existing
  `'private_human'`/`'solo_bot'`/dev modes, reusing the same invite-token/`joinUrl` generation
  `inviteHost()`/`firstLanIPv4()` already provide.
- [x] A co-op room seats exactly two players into the SAME restaurant, not one restaurant per
  player. `match.restaurants`/`match_snapshot.restaurants[]` reflects one restaurant, not two.
- [x] There is no bot opponent and no rival restaurant in a co-op match — the district-choice
  model (`customer-system.js`) either draws every party toward the single restaurant, or is
  bypassed in a way that still produces real, playable customer flow (implementer's call —
  document which, and why, in this story's own follow-up notes for STORY-040+).
- [x] The client main menu (`client/src/app/` — wherever "Play vs Bot"/"Invite a friend" currently
  live) gets a new entry to start a co-op match and share its invite link, following the same UX
  pattern as the existing private-human invite flow.
- [x] `scripts/check-invite-lobby.mjs`-style coverage (real `Match`es, no client) proves: a co-op
  room's invite token gates joining, both seats land in the same restaurant, and `npm run check`
  stays green.

## Notes

- Depends on nothing landing first; STORY-040/041/042/043 all depend on THIS story.
- Cites: `openspec/changes/private-invite-lobby/` — this story EXTENDS that decision (a new mode
  value on the same invite mechanism), it does not revise how invites/tokens work.
- Cites: `openspec/changes/shared-district-choice/proposal.md` — a co-op match's single-restaurant
  district behavior needs an explicit call (see AC3) on whether/how that model applies with only
  one restaurant in the pool; this story PRESERVES the choice model's math but must decide its
  co-op-mode boundary condition rather than silently leaving it undefined.
- Scoring/win-condition for co-op (a cooperative target vs. the existing competitive scoring in
  `scoring-system.js`) is explicitly OUT of this story's scope — note it as an open question for
  whoever picks this up, but don't block on solving it; a co-op match can ship with the existing
  scoring simply computed for the one restaurant.

## Implementation notes

**AC3's district-choice decision: the model is unchanged, not bypassed.** `customer-system.js`'s
own header already documents the answer: "A district with one restaurant ... is the degenerate
case of the same code: one candidate, no rival to compare against, so `decisionReason` stays null
and CHOOSE_RIVAL never fires." `resolveEvaluateRestaurants` already runs the same softmax over
every candidate restaurant plus "leave", whatever the candidate count — with one candidate,
`others.length === 0` so `reason` stays honestly `null`, and `DISTRICT_LEAVE_UTILITY` stays a live
alternative in the same draw, so a badly priced co-op menu still loses parties to the street
(PRD §24) rather than being force-fed customers. What this story actually changed is WHICH
restaurant ids feed that Map: `customer-system.js#ensureState`/`update` now insert
`match.restaurantIdFor(playerId)` (de-duplicated) instead of the raw `playerId`, so a co-op
match's district Map has exactly one entry. The math in `scoreRestaurant`/`softmaxPick`/
`resolveEvaluateRestaurants` itself is byte-for-byte unchanged. Verified by
`scripts/check-coop-mode.mjs`: a real coop match ticked through several hundred service-phase
steps never records a single `CHOOSE_RIVAL` decision, and still spawns/serves real parties.

**The central architectural decision: `Match#restaurantIdFor(playerId)`.** `restaurantId ===
playerId` turned out to be assumed far more widely than just the district — `order-system.js`,
`inventory-system.js`, `worker-system.js`, `upgrade-system.js`, `front-door-system.js`,
`service-station-system.js`, `kitchen-command-system.js` each build their OWN internal
per-restaurant state keyed by raw player id, and `action-validator.js`/`match.js#toSnapshot` both
resolved `restaurantId` directly from the acting/viewing player's own id. Rather than rewrite
every one of those systems to genuinely support two players sharing one restaurant's kitchen/
inventory/staffing (that rewrite IS "the no-staff kitchen rework" this story is explicitly not
supposed to do — STORY-040's job), I added one resolver method on `Match`:
`restaurantIdFor(playerId)` returns `playerId` unchanged for every pre-existing mode, and for a
`sharedRestaurant: true` (co-op) match returns the FIRST-seated player's own id for EITHER seat
(`this.players` is insertion-ordered, so this is free — no new bookkeeping).

This one seam has two different effects depending on how a site used player/restaurant identity:
- **Sites that ENUMERATE players to build one restaurant bucket per player** (the district,
  `scoring-system.js`, `manager-ledger-system.js`, `telemetry-system.js`, and `match.js
  #toSnapshot`'s `frontDoor`/`serviceStation`/`matchCompleteMessage` fallback) now de-duplicate
  through the resolver, so a co-op match gets exactly one entry instead of a real one plus a
  phantom all-zero second row keyed by the guest's own id.
- **Sites that RESOLVE a single acting player's own restaurant** (`action-validator.js`'s two
  `restaurantId = playerId` call sites) now call `match.restaurantIdFor(playerId)` instead. Since
  the resolver anchors BOTH co-op seats to the HOST's own id, and `order-system.js`/
  `inventory-system.js`/etc. already built a REAL bucket keyed by the host's own id (they
  enumerate `match.players.values()` unconditionally, co-op or not — I deliberately left them
  untouched), a co-op guest's real purchase/interact lands on that same real bucket. Their OWN
  per-player bucket (keyed by their own raw id) becomes an inert orphan nothing ever looks up
  again. `scripts/check-coop-mode.mjs` proves this concretely: the host buys one upgrade, the
  guest buys a DIFFERENT upgrade, and both show up in `match.upgrades.ownedUpgrades(<shared id>)`
  — while the guest's own private bucket owns neither.

**Documented consequence, not silently absorbed:** `customer-system.js#menuOf` reads a
restaurant's menu off `match.players.get(view.playerId)?.setup` — for a co-op restaurant this
means the FIRST-seated player's own setup submission becomes the shared restaurant's menu. The
second player's `setup_submit` is still accepted and stored (nothing rejects it), but nothing
customer-facing reads it. A real collaborative single-menu flow is explicitly out of this
foundation story's scope and is left for STORY-040+ to design.

**Client-side "which restaurant is mine".** The client assumed `restaurantId === playerId`
throughout — `GameClient.ts` alone had over a dozen call sites (filtering `customers[]`/
`orders[]`, looking up `restaurants[]`/`frontDoor`/`serviceStation`, deciding whether another
player renders on this floor or the decorative rival one). A co-op guest's own `playerId` is
never a key into any of those structures, so left alone the guest's own client would show a blank
HUD (or worse, render the shared restaurant back at them mislabeled "Rival"). Fixed by adding
`you.restaurantId` (this viewer's own resolved id) and `players[].restaurantId` (every player's
own resolved id) to `match_snapshot`, and switching every restaurant-domain read site — in
`GameClient.ts`, `HudPanel.tsx`, `TacticalOverviewPanel.tsx`, `FrontDoorBoard.tsx`,
`KitchenCommandBoard.tsx`, `ServiceStationBoard.tsx`, `ResultsPanel.tsx` — from `status.playerId`
to `status.restaurantId`. Player-IDENTITY sites (whose avatar is "mine" for movement/camera
purposes) deliberately kept reading `playerId` — a co-op partner is a different PLAYER sharing the
SAME restaurant, not a different restaurant. `RestaurantScene.ts`'s `remapToRivalFloor`/
`rivalWorldPosition` needed no changes themselves (already null-safe / driven entirely by the
`selfRestaurantId` the caller passes in) — only the GameClient.ts call site feeding it the right
value.

**`ResultsPanel.tsx` had a pre-existing latent bug this story made reachable.** `rivalId` used to
fall back to `restaurantIds[0]` when no distinct rival id was found — which, with only one
restaurant id in `complete.results`, resolves to `selfId` itself, rendering the player's own
result a second time mislabeled "Rival". This was already true for a solo `/dev/match`, just
never hit by a real player. Fixed by dropping that fallback (`rivalId` is honestly `null` when
there is no second restaurant) and gating the rival stat column / every narrative line that reads
`rivalResult` behind a `hasRival` check — a co-op match's results screen shows the player's own
score, breakdown, and manager's ledger, and simply omits the head-to-head comparison, rather than
showing something wrong. A real co-op-flavored results screen (with cooperative framing instead
of "Draw"/omitted comparison) is left for whoever designs co-op scoring.

**Client menu entry placement.** "Invite Co-op Partner" was added to `MainMenu.tsx`'s
`play-options` nav, alongside "Play Online" (disabled), "Invite Opponent", and "Play vs Bot" —
reusing the exact `createInviteRoom`/`cacheInvite`/`/lobby/:roomId` flow "Invite Opponent" already
has (parameterized by `mode` rather than duplicated). `InvitePanel.tsx` reads the room's `mode`
(threaded through `CreatedRoom`/`CachedInvite`/`InviteInfo`) to say "co-op partner" instead of
"opponent" in its share copy; `LobbyScreen.tsx`'s "Host"/"Guest" slots and "Waiting for opponent…"
text needed no changes — generic enough to read correctly for either flow.

**Kitchen/inventory/worker/upgrade/front-door/service-station internals are untouched by
design**, not by oversight — see the resolver explanation above. This is the concrete boundary
between what this foundation story does and what STORY-040 ("no-staff kitchen rework") needs to
do: today, a co-op guest's actions land on the shared restaurant correctly (real, playable), but
the underlying systems still model it as "one player's restaurant that a second player happens to
also act on" rather than a genuinely shared, jointly-staffed kitchen. That deeper rework is
explicitly deferred.

Full detail (goals/non-goals, all decisions with alternatives considered, and a Mermaid sequence
diagram of the mode/resolver/district data flow) is in
`openspec/changes/coop-match-mode/{proposal,design}.md` in the story's own worktree/branch.
