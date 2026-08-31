# Tasks — Shared district customer acquisition and restaurant choice

- [x] `resolveEvaluateRestaurants` replaced: every restaurant scored from public observables,
      combined with the party's own four §6 weights, resolved by a softmax that includes leaving
      the district (Decisions 27, 28)
- [x] Per-restaurant floors on the district state — own tables, own queue, own reputation —
      leaving spawning, patience, seating, satisfaction and the public customer projection
      untouched
- [x] Projected wait from the live queue, free tables that fit the party, and
      `match.kitchen.queueDepth()` (Decision 32)
- [x] Capacity gate: a restaurant whose projected wait exceeds the party's own patience budget is
      not a candidate, and reports `restaurant_full`
- [x] Reputation as a capped moving average of served parties' satisfaction, with a walkout knock
      (Decision 31)
- [x] A §17 decision reason per choice, from weighted contribution margins, null below the
      epsilon (Decision 30); `match.districtDecisions` and `match.districtSummary` survive to
      `results`
- [x] `match_snapshot.restaurants[]` published with the public observables only (Decision 33)
- [x] `shared/constants/tuning.js` — the DISTRICT block; the rival placeholder and queue-pressure
      constants retired
- [x] `scripts/check-district-choice.mjs`, wired in as `npm run check:district`, registering
      `setup`/`customers`/`orders`/`events` together
- [x] `scripts/check-customer-lifecycle.mjs` updated for the district model (Decision 29)
