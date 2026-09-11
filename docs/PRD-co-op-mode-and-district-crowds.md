# PRD — Co-op Mode & District Crowds

Two independent feature requests from live playtesting, captured together as one slicing pass.
They touch different systems (match mode/staffing/kitchen vs. the shared district/customer
rendering) and can be sliced and shipped independently of each other.

## Part A — Co-op Mode

Today every match is one owner vs. another (human or bot), each running their own restaurant.
This adds a mode where two players run **one shared restaurant together**, with no automated
staff and no AI opponent — the two players ARE the staff.

### A1. A co-op match mode, and a way to invite someone into it

- A new entry on the main menu, alongside "Play vs Bot" and the existing human-invite flow,
  to start a co-op match and invite a second player into it (same invite-link mechanism the
  existing private human-vs-human mode already uses — see `mode: 'private_human'` in
  `server/src/http/routes.js` and `POST /api/rooms` — a co-op mode is a new `mode` value
  alongside it, not a rebuild of the invite plumbing).
- A co-op match has exactly **one** restaurant, shared by both players. There is no rival
  restaurant, no bot opponent, and no `customersLostToRival`/competitive scoring axis — the
  win condition becomes a cooperative target (e.g. a revenue/reputation goal, or simply "how
  well did we do", TBD by whoever picks this story up in detail).

### A2. No automated staff — the players ARE the roster

- In co-op mode, `restaurant-layout.json`'s `staff.roster` (cook/server/host) is not seated —
  `worker-system.js` does not run for this restaurant, the same way it already no-ops for any
  restaurant with an empty/absent roster (`match.brigade?.owns*()`'s existing defensive checks).
  Seating parties, taking orders, delivering food, clearing tables, and cooking are entirely up
  to the two players to split between themselves.
- Any upgrade whose effect only matters with automated staff (the Serving Tray capacity upgrades
  are fine — they help a player carry more; anything that specifically augments a *worker's*
  throughput, e.g. a future cook-speed-for-staff upgrade) is unpurchasable in co-op mode — locked
  in the upgrade terminal UI with a reason ("no staff to upgrade"), not simply hidden. Existing
  MVP upgrades should be reviewed case by case for which are staff-only vs. player-usable — most
  (Faster Grill, Pantry Shelves, Better Seating) still make sense for a player-operated kitchen;
  only genuinely staff-specific ones need locking.

### A3. Cooking becomes a real, timed, player-driven action

- Currently a station's cook time (`stationSteps`) only really shows up as a visible clock when a
  *worker* is tending it (`tend_station`'s task chip/duration). When the OWNER starts a ticket
  directly (the existing `cook`/`plate` interact, `action-validator.js`'s `resolveCookOrPlate`,
  which already calls the same `kitchen.startTicket()` a worker uses), give it the same felt
  weight: a short, real cook duration before the dish is ready, not instant.
- Add a small in-world visual indicator on a station with a ticket **queued but not yet started**
  — distinct from "currently cooking" and from "ready at the pass" (both of which already have
  their own visual language — see `state-color-bands.js`/`STATE_COLORS` and STORY-016's station
  indicators). This is the missing middle state: "something is waiting here for a pair of hands."

### A4. A "what to cook" menu, suggested from the actual orders

- Interacting with a station in co-op mode surfaces a menu of what can be cooked there, the same
  way the upgrade terminal already surfaces a menu on interact (`UpgradeTerminal` component
  pattern). Items needed by currently pending/queued orders are visually called out (e.g.
  highlighted or sorted first) — a player should be able to tell "the table waiting on a burger
  needs a patty started at the grill" without cross-referencing a separate board.

### A5. A kitchen order queue board — what you SHOULD be cooking, and where

- A physical board in the kitchen (a new entity, in the spirit of `kitchen_command_board`'s
  existing "walk up, read state, act" pattern) that lists outstanding tickets in priority order
  across every station — the same ranking `worker-system.js#compareTickets` already uses for the
  AI cook (queue-age bucket, then patience risk), surfaced for HUMAN cooks instead of consumed by
  an AI. Each entry shows the real 3D dish model (`FoodModels.ts`'s existing per-dish GLB props,
  already used for ready-dish/carried-dish proxies — reuse, don't re-author), not just a text
  label, so a player can recognize what to grab/start at a glance.

## Part B — District Crowds

Reported: "it seems like [customers] just show up at yours" — the shared district's customer
population (STORY-010's shared choice model) isn't visually legible. A player can't tell whether
their restaurant is under-attracting customers relative to the rival, or relative to the total
market, without reading a HUD number.

### B1. Show the real population walking the district, not just each restaurant's own queue

- Render the full simulated pool of potential customers — not only the parties that already
  chose a restaurant and are standing in its queue — as they move through the shared space
  between the two restaurants. Each customer already has a real spawn/decision/walk lifecycle in
  `customer-system.js`; this is a rendering gap (only queued/seated parties get a visible model
  today), not a new simulation to build.

### B2. Visibly walk toward whichever restaurant they chose — or neither

- A customer who chooses this player's restaurant walks toward it; one who chooses the rival's
  walks toward that one; a customer who chooses **neither** (the market has real non-conversion —
  see `manager-ledger.js`'s `demand_conversion` constraint, already tracking "N of M evaluated
  parties chose elsewhere; N left the district") should be visibly the majority in a healthy
  market read — a crowd that just walks past both storefronts and off through the district,
  represented with the same real character models as any other customer, not an abstraction.

### B3. A "peek" the player can use to read the whole district at a glance

- Extend the existing Peek camera (bound to `Q`, `InputController.ts`/`CameraController.ts`,
  currently re-aimed at the rival's floor) to also read as "how is the district doing" —
  letting a player judge, from watching the crowd's real behavior, whether their own restaurant
  is under-attracting customers and ought to prompt a strategy change (price, menu, signage,
  upgrades) rather than only inferring it from a lagging score number.

### B4. Show real numbers, not a token few

- The crowd should include enough non-converting/passing-through customers that the district
  reads as a real marketplace, not two restaurants and a token queue — tune the visible
  population against `district-choice-model.js`'s actual per-tick spawn/decision rate so the
  visual count is honest about the real conversion rate, not just "more sprites for atmosphere."

## Notes for slicing

- Part A and Part B do not depend on each other and should be sliced (and can be kicked off) as
  independent story groups.
- Part A's A3/A4/A5 depend on A1/A2 existing first (there's no point building a co-op-only kitchen
  UI before co-op mode itself exists) — sequence those stories accordingly.
- Part B is purely additive to the existing customer/district simulation and rendering layer; it
  should not require changing `customer-system.js`'s actual decision logic, only what gets
  rendered and how the player can view it.
