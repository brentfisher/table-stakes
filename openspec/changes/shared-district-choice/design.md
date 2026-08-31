# Design — Shared district customer acquisition and restaurant choice

Numbering continues `seeded-event-deck/design.md`, which ended at Decision 26.

## Decision 27 — The choice is a softmax over utilities, and the temperature is the anti-snowball dial

Each restaurant scores in [0,1]; the party picks with `p_i ∝ exp(u_i / T)`.

An argmax gives the whole district to whoever is 0.01 ahead, forever, which is precisely the §23
snowball. A fixed "70/30 to the better one" would satisfy the letter of "probabilistic" while
ignoring how *much* better. A softmax is the one form where a small edge is worth a small share
and a large edge a large one, with a single legible dial — and that dial is checkable: at
`T = 0.12` a 10% price undercut is worth 0.022 of utility and wins 56% of comparable parties.

The alternative considered and rejected was a lottery weighted by raw utility (`p_i ∝ u_i`).
It cannot express indifference between two good restaurants without also making a bad one
nearly as likely, because the ratio of two scores near 1 is near 1 whatever the gap.

## Decision 28 — Leaving the district is an option inside the same draw

`DISTRICT_LEAVE_UTILITY` is the utility of the street, and LEAVE_DISTRICT competes in the same
softmax rather than being resolved by a separate coin flip beforehand.

PRD §24: "A badly priced menu should reduce customer conversion, but should not make the
restaurant completely empty." A conversion rate that falls smoothly as a restaurant gets worse
is that sentence, and an exponential is never zero, so "completely empty" is unreachable by
construction rather than by a floor somebody has to remember to add. It also replaced STORY-004's
separate queue-pressure coin flip: a party leaves because nothing on offer beat the street, which
is one rule instead of two.

## Decision 29 — CHOOSE_RIVAL is a per-restaurant funnel outcome, not a party state

PRD §8 lists "chooses rival restaurant" among the customer exit states, and STORY-004 implemented
it as one. It cannot stay one. `match_snapshot.customers[]` is a single array both players
receive identically, and "chose the rival" is viewer-relative — the party that walked past p1 is
walking *into* p2, in APPROACH_OR_QUEUE. A shared, single-valued state field cannot express it.

So the party's state stays district-level, and `CHOOSE_RIVAL` is counted against the funnel of
each restaurant that did not get the party, with the reason it lost by. That is also the shape
STORY-014 needs: "you lost 23 parties to your rival — 12 on price, 8 on wait". The state remains
declared in `CUSTOMER_STATES` and in the §8 exit list; nothing in the district state machine
sets it.

Consequence, disclosed: in a one-restaurant district (a `POST /api/dev/match` match, and most
check scripts) `CHOOSE_RIVAL` is now always 0 rather than the old ~8%. There is no rival. That is
the honest number.

## Decision 30 — A decision reason is only recorded when a component actually decided it

The reason is the component whose *weighted* contribution beat the best rival's by the most, and
it is `null` below `DISTRICT_REASON_EPSILON`. Weighted, because a party that does not care about
price was not won on price. Null, because in a symmetric 1v1 roughly half the picks are coin
flips, and labelling those `better_price` would fabricate the exact data STORY-014's results
screen is built on. A one-restaurant district records no comparative reason at all, for the same
reason STORY-004 left the placeholder's `decisionReason` null: there was no comparison.

## Decision 31 — Reputation is a capped moving average, and the cap is measured by its consequence

Reputation is an EMA of served parties' satisfaction, clamped into a band. §4.2 asks for two
things at once — that it compound, and that it not make the match unwinnable early — and only
the first is a property of the formula. The second is a property of the *choice*, so it is
checked as one: a restaurant that opens with fifteen perfect reviews against a rival's fifteen
walkouts wins 63/37, not 100/0.

The review weight is set from that measurement, not from taste. At 0.08 a flawless opening two
minutes crossed almost the whole band and pushed the rival under 30% of the district before the
match was a quarter old; at 0.03 the band takes most of a match to cross. Reputation is an asset
a player builds, not an opening they cannot be caught from.

## Decision 32 — Projected wait is read through the kitchen's own facade

`match.kitchen.queueDepth(restaurantId, station)` — the number `match_snapshot.orders` derives —
plus the restaurant's live queue and free tables. This story invents no second estimate of how
backed up a kitchen is, and reaches into no order-system internals. The seat half is a real table
turn (`DISTRICT_TABLE_TURN_MS`), derived from this file's own state durations rather than picked:
a party facing a full dining room is waiting for somebody to finish eating and pay.

That calibration is load-bearing, not cosmetic. With the seat wait understated, a swamped
restaurant kept admitting parties it could not serve and they cancelled at the table; with it
honest, they see the wait and go elsewhere, and every seed of the §24 balance run moved inside
the 40-90 band.

## Decision 33 — `match_snapshot.restaurants[]` carries the observables, and only those

The district view both players receive is what the model scores a restaurant on — reputation,
queue length, capacity, projected wait — plus three fields that are NOT model inputs and are
published anyway: `guestsServed`, `averageSatisfaction` and `abandonedParties`. They are the
§4.4 district overview's service record, §5's results phase compares them, and a player has no
other way to read their own. Naming the exception is the point: an allowlist justified as "only
what the model reads" that quietly carries three more fields is the kind of label that reads as
coverage. Menu, prices, cash
and inventory are the player's private setup submission (PRD §18, Decision 16) — read
server-side, never republished. The unowned `RestaurantSnapshot` fields are declared optional
with the story that fills each one in, rather than shipped as placeholder zeroes that read as
real data.
