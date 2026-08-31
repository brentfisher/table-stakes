# Shared district customer acquisition and restaurant choice

## Why

Until this change the two restaurants in a match never competed. `customer-system.js` spawned
parties, and `resolveEvaluateRestaurants` sent every one of them to `firstRestaurantId(match)`
after a flat 8% coin flip that stood in for "a rival existed and won" — against a rival that did
not exist and could not be scored. Two players ran parallel solitaires and the game's entire
premise, PRD §4.2 "Both restaurants draw from the same customer population", was unimplemented.

PRD §6 specifies the missing piece: a party entering the shared district evaluates both
restaurants on public, observable properties, weights them with its own hidden profile, and then
chooses **probabilistically**. §23 names early snowballing as a top risk and mitigates it with
exactly that word — "keep customer choice probabilistic; add queue/reputation recovery; cap
runaway advantages" — and §6's "Important design rule" spells out the consequence: the
competitor must matter, but a player must not lose because the opponent had a better starting
menu.

This corresponds to STORY-010 in the slicing pass.

## What changes

- **One district pool.** Arrivals are unchanged — one Poisson process, one arrival log — but a
  party now belongs to the district until it chooses, and both restaurants draw from it.
- **A real choice model** in the function STORY-004 left as the seam: menu fit, price, projected
  wait, visible reputation, remaining capacity and event affinity, each scored from public
  state, combined with the party's own `menuFitWeight` / `priceWeight` / `serviceSpeedWeight` /
  `reputationWeight`, and resolved by a softmax over the candidates plus the option of leaving.
- **Per-restaurant floors.** Each restaurant has its own tables, its own queue and its own
  reputation; seating, patience, satisfaction and the public customer projection are untouched.
- **Reputation**, previously nowhere: a capped moving average of the satisfaction of the parties
  a restaurant actually served.
- **A decision record** for every choice (PRD §17 step 6), on `match.districtDecisions` and
  rolled up per restaurant into `match.districtSummary` at `results`, for STORY-014.
- **`match_snapshot.restaurants[]`**, published for the first time, carrying exactly the public
  observables the model itself scores.
