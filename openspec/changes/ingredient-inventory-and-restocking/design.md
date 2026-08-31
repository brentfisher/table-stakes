# Design — Ingredient inventory, station bins and restocking

Numbering continues `shared-district-choice/design.md`, which ended at Decision 33.

## Decision 34 — Stock lives at two levels, because §8's bottleneck is a distance problem

A restaurant has a PANTRY (one bag of units, seeded from the §7 allocation) and a BIN per station
per ingredient. Production eats the bin; a restock walks units from the pantry to the bin.

A single flat stock would satisfy "track inventory" and would make PRD §8's row meaningless: its
player intervention is *retrieval*, and retrieval only exists if the stock the kitchen cooks from
is somewhere other than the stock the restaurant owns. It is also what §10's whole "Restocking"
upgrade category is priced against — "Pantry Shelves $150, restock travel time -25%" is a
purchase with nothing to buy unless the walk has a duration.

Bins are per STATION rather than one per restaurant because §10's other upgrades are per station
(`stationConcurrentCapacity: { prep: 2 }`) and because it makes the shortage *locatable*: the
signal a player acts on is "the prep counter is out of lettuce", not "the restaurant is".

## Decision 35 — Ingredients are consumed when the first station step is dispatched

Not at order time, and not spread across the dish's steps.

Not at order time because PRD §8's consequence of a shortage is a *canceled* order, which is only
meaningful if the order could be placed before the stock ran out — and because an order sitting
in a queue has not been cooked and has not spent anything.

Not spread across steps because `dishes.json` gives a dish one `ingredients` map and a separate
`stationSteps` list, with no per-step ingredient data. Splitting a burger's beef across
prep/grill/plating is not something the content can express, so any split would be a balance
decision dressed up as a schema. The first step is where raw goods enter the line — prep for
seven of the eight MVP dishes, plating for cheesecake — so that step's station owns the bin.

## Decision 36 — Where the stock is decides whether a shortage blocks or removes the dish

One rule produces both §8 outcomes:

- **bin empty, pantry (or a trip in flight) still has stock** -> the ticket is BLOCKED. It keeps
  its place in the station queue, is skipped over so it cannot idle the station's other hands,
  and a landing restock un-blocks it. The dish stays on the menu, because this is a delay.
- **bin and pantry both empty** -> the dish is UNAVAILABLE. `match.dishAvailability` says so, new
  orders stop selecting it, and `order-system.js`'s existing sweep voids its queued tickets —
  which cancels the order when it voids all of them and sends the party to `CANCEL_ORDER`.

The alternative, "an empty bin means the dish is unavailable", collapses the two and makes the
restock pointless: a three-second walk would already have cancelled the orders it was going to
save. The alternative in the other direction, "tickets always wait", never produces §8's
"menu items unavailable, canceled orders" at all.

Blocked tickets stay IN the station queue on purpose. `check-orders.mjs` asserts that a station's
queue depth equals the count derived from the snapshot; moving blocked tickets to a side list
would break that identity and would hide them from the HUD.

## Decision 37 — The §9 event is one match-level draw, held on a rising edge, over what is cooked

`ingredient_shortage` carries `affectedIngredientCount: 1` and
`ingredientRestockDurationMultiplier: 2.0`. Which ingredient is drawn once, from
`match.createRngStream('inventory')`, on the rising edge of the count, and held until it returns
to zero.

- **Match-level, not per restaurant**, because §9's fairness contract is that the timeline is a
  property of the match and asymmetry may come only from the restaurants' own state. Both
  restaurants are short of the same thing; how much that hurts depends on their menus.
- **Drawn from the union of both locked menus' ingredients**, not from all eighteen in the
  catalogue, because §9's first design rule is that an event must create an actionable decision
  and an event that hits an ingredient nobody cooks is a notification.
- **Rising edge, not the active-event signature**, because keying on the set of active event ids
  re-rolls which ingredient is scarce whenever an unrelated overlapping event ends.

The multiplier applies only to the affected ingredient, which is the whole content of the event
and is also what makes it checkable: "a restock took time" passes when the effect key is
misspelled and reads as the neutral 1.0, while "the affected ingredient took exactly twice as
long as an unaffected one, same units" does not.

DISCLOSED LIMITATION: the card's other half, `ingredientCostMultiplier: 1.5` ("or costs more"),
has no consumer. A restock moves stock a player already bought; nothing purchases ingredients
mid-service, and no story owns in-match cash yet. Inventing a cash path to give the key a home
would be worse than saying it is unwired.

## Decision 38 — The published availability map was necessary and not sufficient

`order-system.js` pre-built this story's seam and documented it as the whole integration: publish
`match.dishAvailability` and both outcomes follow. That is true for the two things it covers, and
it cannot cover the acceptance criterion "consumes the dish's ingredients at the correct step,
not at order time" — the map is read in `orderableEntries` (order time) and in
`voidUnavailableTickets` (a sweep), and neither is a station step. Nothing in that file could
observe a step being dispatched.

So the map is published AND `dispatchQueues` gained a twenty-line `claimIngredients()` hook that
reads an optional `match.pantry` facade with exactly the defensiveness the same file already
applies to `match.dishAvailability` and `match.eventEffects`. With no inventory system
registered, every claim succeeds and the kitchen behaves precisely as it did before — which is
what `check-orders.mjs`, which registers no inventory system, still measures.

The alternative was to have the inventory system infer consumption by diffing `match.orders`
between ticks. It over-draws by up to `concurrency - 1` servings per station per tick, it cannot
refuse a start, and it makes the kitchen's own dispatch depend on a system that runs after it.

## Decision 39 — The shortage is public; the priced menu and the stock levels are not

`RestaurantSnapshot` declares `menu` and `inventory` as this story's fields. They stay declared
and stay unpublished, and `shortages` — a station, an ingredient, a blocked-ticket count and two
flags — ships instead.

`restaurants[]` is the one array both players receive identically.
`check-district-choice.mjs` asserts that a rival's dish ids and the key names `menu`/`inventory`
never appear in it, on the PRD §18 / Decision 16 grounds that a menu and its prices are private
setup state. That assertion is the newer and more specific evidence, so it wins over the
declaration. What ships is what §8 already calls an in-world signal — an ingredient is short at a
station — and it names no dish, no price and no reserve. The full picture is read server-side
through `match.pantry`, which is where STORY-015's HUD will read it for its own viewer.

## Decision 40 — `INVENTORY_AUTO_RESTOCK` is an abstracted stand-in, and says so

The restock JOB is this story's; deciding WHEN to walk is STORY-007's (the worker) and
STORY-008's (the owner). Between this change and those, something has to decide, or the kitchen
stops permanently after one bin's worth of service — so a flag in `tuning.js` refills any bin at
or under the threshold, one trip at a time.

This is the same admission `ORDER_PASS_HANDOFF_MS` makes about the plate runner, made in the same
place and with the same expiry. Those stories replace the trigger; the job, its duration, the
concurrency limit and the shortage state are unaffected.

CONSEQUENCE, MEASURED: with a stand-in that has perfect knowledge and never has to walk anywhere
else, a well-stocked restaurant spends 0–0.3% of a full service with production blocked. Shortage
as a *timing* pressure is therefore mostly latent until a body has to get there. Shortage as an
*exhaustion* pressure is real today, and is what the §7 allocation decides — see the PR.

## Decision 41 — An idle player gets a stocked pantry, not an empty one

`defaultSubmission()` allocated `startingInventory: {}`. That was correct while nothing read the
allocation and is a restaurant that cannot cook one ticket now that something does, which would
punish an idle player far past the "a working restaurant, not a good one" bar that function sets
for itself. It now derives an allocation from its own menu through
`defaultInventoryAllocation()` in `setup-rules.js` — pure and browser-safe, so STORY-009's UI can
offer the same thing as a one-click stock-up rather than reimplementing it — trimmed to a share
of the starting cash so it is affordable by construction. Every validator rule is untouched.

## Decision 42 — The inventory system registers last

`customer-system.js` reassigns `match.restaurants` wholesale during its update, so a system that
decorates that array with the shortage signal must run after it. Running last costs one tick
(50ms) of staleness on `match.dishAvailability`, which the kitchen reads defensively, and costs
nothing at the start of service: `onPhaseChange` fires for every system before any `update`, so
the pantry facade and the first availability map exist before the first ticket is dispatched.
