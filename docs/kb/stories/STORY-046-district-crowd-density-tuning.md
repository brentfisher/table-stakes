---
id: STORY-046
title: Tune visible non-conversion crowd volume against the real district decision rate
status: merged
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: story/046-district-crowd-density-tuning
worktree_path: /Users/brent/table-stakes-story-046
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/65
is_architectural: false
approach_summary: >
  A measure-then-tune balance pass, per `docs/kb/conventions.md`'s own testing rule 3 ("measure,
  don't assert" — a figure that misses target is reported as a finding, not tuned away). HARD
  BOUNDARY, must not be crossed: `customer-system.js#tickArrivals`'s Poisson arrival rate
  (`market.baseFootTrafficPerMinute`, from `shared/game-data/markets.json`) and the choice model
  itself (`scoreRestaurant`/`softmaxPick`) are OFF LIMITS — this story tunes how long an
  ALREADY-DECIDED party is visible/how it paces, never how many parties arrive or what they
  decide. The five in-bounds knobs, all in `shared/constants/tuning.js` already:
  `CUSTOMER_ENTER_DISTRICT_MS` (400) + `CUSTOMER_EVALUATE_RESTAURANTS_MS` (600) = 1000ms total
  visible "deciding" time before every party resolves; `CUSTOMER_EXIT_LINGER_MS` (2000ms, how
  long a party stays in the snapshot after reaching a terminal state); `CUSTOMER_MOVE_SPEED`
  (4.0, STORY-044) and `CUSTOMER_EXIT_OFFSET` (4, STORY-044) which together determine how long a
  non-converting party's exit walk is actually visible on screen. Work: (1) measure, from a real
  `Match` run (the `check-district-choice.mjs`/`check-district-population.mjs` direct-state-
  injection technique, or a fresh script if neither fits), the real non-conversion rate
  (`CHOOSE_RIVAL` + `LEAVE_DISTRICT` as a fraction of total district arrivals,
  `match.districtDecisions`/`customer-system.js#districtSummary`) and how long a non-converting
  party is actually currently visible end-to-end (loiter + exit-walk duration) at today's
  constants; (2) if the crowd reads as sparse RELATIVE TO that measured rate (not relative to a
  vibe), tune the pacing knobs above so visible duration honestly reflects the measured
  conversion math — e.g. a longer loiter or slower/longer exit walk for non-converting parties
  specifically, if that's achievable without touching arrival rate or decision probabilities;
  (3) if the measurement instead shows the district's total foot traffic itself is the bottleneck
  (this repo's own known, cited gap: `docs/kb/conventions.md`'s "Open Balance Gaps" — "a real 1v1
  serves 16-36 parties per restaurant against PRD §24's 40-90... foot traffic was not scaled"),
  STATE THAT FINDING EXPLICITLY in the story file as a balance recommendation for the user to
  decide on, and do NOT unilaterally raise `baseFootTrafficPerMinute` to compensate — per the
  story's own AC2, this is a decision to flag back, not make. `is_architectural: false` — tuning
  constants plus a measurement check, no new module/API/data model.
created: 2026-09-10
updated: 2026-09-11
---

# Tune visible non-conversion crowd volume against the real district decision rate

Requested: "show many more people deciding to go to neither restaurant to show the crowds just
walking by." With STORY-044 rendering every real party (including `CHOOSE_RIVAL`/`LEAVE_DISTRICT`
ones) and STORY-045 letting a player Peek at it, this story is the tuning pass making sure the
VISIBLE crowd honestly represents the real conversion rate — not simply "more sprites for
atmosphere," and not so sparse that the district reads as two restaurants and a token queue.

## Acceptance Criteria

- [x] Measure the real current non-conversion rate (parties that end in `CHOOSE_RIVAL` +
  `LEAVE_DISTRICT`, as a fraction of all district arrivals) from a real match run — this is
  already computable from `customer-system.js#districtSummary`/`match.districtDecisions`, no new
  telemetry needed, just a read.
  the pacing/duration a party spends visible in-district before exiting (from STORY-044) against
  that measured rate — the crowd should look as busy as the real conversion math says it is, not
  an arbitrary multiplier applied on top.
- [x] If the real non-conversion rate is measured to be too low to read as "many more people
  walking by" even when rendered honestly (i.e. the market itself isn't generating enough
  foot traffic to look like a crowd), say so explicitly rather than inflating the VISIBLE count
  past what the simulation actually decided — this story tunes rendering/pacing knobs, it does
  not fake numbers the district-choice model didn't produce. If the underlying spawn rate itself
  needs to go up to satisfy the request, that's a balance decision to flag back to the user, not
  to make unilaterally.
- [x] `npm run check` stays green; if a new tuning constant is added (e.g. district crowd
  visibility pacing), it lives in `shared/constants/tuning.js` alongside its siblings, with a
  comment stating what it was measured against.

## Implementation notes

**Measurement script: `scripts/measure-district-crowd-density.mjs` (new, reporting-only).**
Registers `setupSystem`/`customerSystem`/`orderSystem`/`eventSystem` (the same four
`check-district-choice.mjs` registers) and runs real, unforced `Match`es — `phasePreset: 'full'`
(the real PRD §24-length window, not `prototype`'s compressed one), 5 seeds x each of the three
`markets.json` markets (`marketId` override, no seed-lottery guessing), stepped end to end through
`service` + `final_rush` with `match.isServicePhase` as the stop condition. It never calls
`_internal.spawnParty`/`_internal.resolveEvaluateRestaurants` to force a branch (the
`check-district-*.mjs` house pattern for a *different* purpose — proving a mechanism in isolation)
— every number here comes from the district's own real Poisson arrivals and its own real softmax
draws. This is a **reporting** script in the `check-bot.mjs` "measure, don't assert" tradition
(conventions.md Testing rule 3): no `process.exit(1)`, wired into the chain as `npm run
check:crowd-density` (`package.json`, after `check:district-population`). It prints, per market
and aggregated:

- total district arrivals (`match.districtDecisions.length`);
- **the district-wide "walked by neither" rate** — `chosenRestaurantId === null` in
  `districtDecisions`, the same field `check-district-choice.mjs`'s own section 1 ("ONE shared
  pool") already treats as the authoritative "left before choosing" signal;
- **AC1's own literal metric** — per-restaurant `districtSummary.counts.CHOOSE_RIVAL +
  counts.LEAVE_DISTRICT`, as a fraction of that restaurant's own funnel total. This is
  DIFFERENT from (and larger than) the district-wide figure above: `CHOOSE_RIVAL` is never a
  real `party.state` (customer-system.js's own comment on `buildRestaurantView` says so
  directly) — from restaurant A's perspective, a party that chose restaurant B *is*
  `CHOOSE_RIVAL`, and that party is a real conversion for the district, just not for A. Reported
  both ways because AC1 names the funnel definition literally, but the district-wide figure is
  the one that actually answers "how many people are visibly walking past both restaurants,"
  which is what the original request and AC2 are both about;
- the "walked by neither" cohort's real visible duration — spawn to the actual observed tick
  `state.parties` drops the id (watched live, tick by tick, the same `check-district-population
  .mjs`-style direct observation, not `exitAtMs + CUSTOMER_EXIT_LINGER_MS` computed after the
  fact) — mean/median/min/max, with any party still present when the observation window ends
  marked `truncated` and excluded rather than silently counted as a short duration;
- a PRD §24 cross-check: mean `guestsServed` per restaurant across all 30 restaurant-runs, from
  `match.districtSummary` collected in the SAME pass (no second simulation run).

**Measured results (against the shipped constants, this run's exact console output):**

```
downtown_lunch    (baseFootTrafficPerMinute=14): 396 arrivals, 43 walked-by-neither (10.9%),
                    47 any-non-conversion (11.9%). AC1 literal "did not choose me": 55.4%.
uptown_pre_theater (baseFootTrafficPerMinute=9):  345 arrivals, 53 walked-by-neither (15.4%),
                    57 any-non-conversion (16.5%). AC1 literal "did not choose me": 57.7%.
stadium_district  (baseFootTrafficPerMinute=18): 733 arrivals, 360 walked-by-neither (49.1%),
                    375 any-non-conversion (51.2%). AC1 literal "did not choose me": 74.6%.
Aggregate: 1474 arrivals, 456 walked-by-neither (30.9%), 479 any-non-conversion (32.5%).
"walked by neither" visible duration — flat, zero variance across all 449 non-truncated parties
measured, every market: mean=median=min=max=5000ms.
Mean guestsServed per restaurant across 30 restaurant-runs: 29.6 (PRD §24 target: 40-90).
```

**The structural discovery that made the duration measurement trivial (and explains why the
original approach_summary's "distance varies, so measure it" premise was wrong).**
`cleanupExitedParties` removes a party at `exitAtMs + CUSTOMER_EXIT_LINGER_MS` — a fixed clock
started the instant the party enters its terminal state, not a check of whether it has actually
arrived at `state.exitPosition`. The exit walk therefore happens *during* the linger window, not
after it, and for the pure "walked by neither" cohort (no queue/table time — `computeDestination`
sends it straight from the entry-loiter cluster to the exit cluster) the walk (~4-6 world units at
`CUSTOMER_MOVE_SPEED`=4.0, ~1-1.5s) always completes with room to spare inside the (now 4000ms)
linger. Result: visible duration for this cohort is a DETERMINISTIC sum of constants
(`CUSTOMER_ENTER_DISTRICT_MS + CUSTOMER_EVALUATE_RESTAURANTS_MS + CUSTOMER_EXIT_LINGER_MS`), not a
distance-dependent, run-varying number — confirmed by measuring exactly 5000.0ms, zero variance,
across all 449 non-truncated parties in the run above. This is also why `CUSTOMER_MOVE_SPEED`
cannot buy this cohort any additional visible time (see below).

**The tuning decision, and the regression it caught (this is the story's most transferable
finding).** The first attempt doubled all three of `CUSTOMER_ENTER_DISTRICT_MS` (400->800),
`CUSTOMER_EVALUATE_RESTAURANTS_MS` (600->1200), and `CUSTOMER_EXIT_LINGER_MS` (2000->4000) — a
clean, symmetric "spend twice as long visible" policy. `npm run check:orders` then FAILED its own
PRD §24 balance section: seed `bal-4`/`stadium_district` dropped from a measured 44 parties served
(master) to 39, tipping it under the 40-party band with `spawned=114` (well past that check's
`ARRIVAL_LIMITED_SPAWN_CEILING=60`), which that check correctly flags as "misdiagnosed" rather
than "the district was just quiet." Root cause, confirmed empirically rather than only reasoned
about: every party's decide phase (`ENTER_DISTRICT`/`EVALUATE_RESTAURANTS`) runs strictly BEFORE
it can ever reach a queue or table, so lengthening it delays every single party's entry into the
kitchen/seating pipeline by the same fixed amount — a real throughput cost in a market whose
kitchen was already running hot (stadium_district's stations were measured at ~70-75% busy in that
run). Reverting ONLY `CUSTOMER_ENTER_DISTRICT_MS`/`CUSTOMER_EVALUATE_RESTAURANTS_MS` to their
original values, while keeping `CUSTOMER_EXIT_LINGER_MS` doubled, reproduced `check:orders`'s
`bal-1`..`bal-9` PRD §24 balance rows **byte-for-byte identical** to master's own pre-STORY-046
output — proving `CUSTOMER_EXIT_LINGER_MS` has zero measurable effect on kitchen utilisation,
station queue depth, or parties served for every seed that check exercises. The mechanism: every
exit path frees its table (`freeTable`) BEFORE the party ever enters a lingering state — the
ordinary `PAYING -> LEAVING` transition and every one of the five exit states in `exitParty` — so
this constant only ever extends how long an already-vacated table's former occupant is still
rendered walking away, never how long the table itself is held.

**Final tuning shipped: `CUSTOMER_EXIT_LINGER_MS` only, 2000ms -> 4000ms.**
`CUSTOMER_ENTER_DISTRICT_MS`/`CUSTOMER_EVALUATE_RESTAURANTS_MS` are left at their original values
(400/600) on purpose, with a comment in `tuning.js` recording the tried-and-reverted experiment so
a future change doesn't re-attempt it blind. `CUSTOMER_MOVE_SPEED`/`CUSTOMER_EXIT_OFFSET` (the
other two knobs the story's own approach_summary named as in-bounds) were considered and also left
unchanged: per the structural discovery above, the walk-by cohort's exit walk already completes
well inside the linger window regardless of speed, so slowing it down would only trade
standing-still time for walking time (no net visible-duration gain) while cutting into the
farthest-table exit-walk margin `CUSTOMER_MOVE_SPEED`'s own STORY-044 comment tracks
(`CUSTOMER_LEAVING_MS + CUSTOMER_EXIT_LINGER_MS` budget vs. the ~13.45-unit farthest table: now
5500ms budget against a ~3362ms walk, ~2138ms margin — up from the original's uncomfortably thin
~138ms, as a side benefit of the larger linger). Net result: the "walked by neither" cohort's real
measured visible duration moved from a flat, measured 3000ms (400+600+2000) to a flat, measured
5000ms (400+600+4000) — a genuine 67% increase, achieved with zero measurable effect on kitchen
throughput, table availability, arrival volume, or the choice model.

**Falsified per house rule, TWICE — the second cycle is the one that matches what shipped.**
Cycle 1 (against the since-reverted all-three-doubled attempt): reverted all three constants to
original, ran `check-district-population.mjs`, confirmed the new section 8 check failed
(24/25, `visibleMs=3050`), restored, confirmed 25/25 again. Cycle 2 (against the SHIPPED
constants, the one that matters): reverted ONLY `CUSTOMER_EXIT_LINGER_MS` to 2000ms (leaving
`CUSTOMER_ENTER_DISTRICT_MS`/`CUSTOMER_EVALUATE_RESTAURANTS_MS` at their shipped, unchanged
values), ran `check-district-population.mjs` — FAIL, 24/25, `measured visibleMs=3050
(CUSTOMER_ENTER_DISTRICT_MS=400 CUSTOMER_EVALUATE_RESTAURANTS_MS=600
CUSTOMER_EXIT_LINGER_MS=2000)` — restored, confirmed 25/25 again with `measured visibleMs=5050`.
`grep -rn "FALSIFICATION"` across the repo confirmed no probe text was left behind after either
cycle.

**New regression guard: `check-district-population.mjs` section 8.** Forces
`resolveEvaluateRestaurants`'s own pre-existing "empty district" branch (`scored.length === 0` ->
deterministic `LEAVE_DISTRICT`) by clearing `state.restaurants` on the test's own in-memory match
state — the same "shape district state to force a branch deterministically" house discipline
`check-district-choice.mjs#tallyChoices` and this file's own section 1 (occupying every table to
force real queueing) already use, not a probability draw. Spawns one party, advances it via
`_internal.advanceParty` tick by tick (the same `recordWalk` pattern the rest of this file uses)
until it resolves to `LEAVE_DISTRICT`, then continues until the real observed linger elapses,
and asserts the measured spawn-to-"would be removed" span is at least 4200ms — comfortably above
the pre-STORY-046 total (3000ms) and comfortably below the shipped total (5000ms), so a partial
revert of the tuned constant fails loudly. Both check scripts (`check-district-population.mjs`,
`measure-district-crowd-density.mjs`) confirm the same real numbers by two independent methods
(one forces the empty-district branch deterministically for a fast, isolated unit check; the
other lets a real seeded match's own choice draws produce the cohort across a realistic run) —
neither depends on the other's plumbing.

**AC2, answered plainly: pacing alone does NOT make the crowd read as "many more people" — the
real gap is arrival volume, not visible duration.** Using the measured "walked-by-neither" arrival
rate per market (arrivals/1800s of service+final_rush, 5 seeds) and Little's Law (L = λ·W, average
concurrent population = arrival rate x visible dwell time), the AVERAGE number of "walking by"
parties visible in the district at any single instant:

| market              | walk-by rate (per 1800s) | L before (W=3000ms) | L after (W=5000ms, shipped) |
|---------------------|--------------------------|----------------------|------------------------------|
| downtown_lunch      | 43                       | 0.072                | 0.119                        |
| uptown_pre_theater  | 53                       | 0.088                | 0.147                        |
| stadium_district    | 360                      | 0.600                | 1.000                        |
| aggregate           | 456 (of 1474 arrivals)   | 0.253                | 0.422                        |

The tuning genuinely worked — every market's average concurrent walk-by population increased by
the full 67% the constant change intended, measured, not asserted — but the honest post-tuning
number is still under one visible walking-by party on average at any given instant for two of the
three markets (`downtown_lunch`, `uptown_pre_theater`), and only reaches ~1 for the busiest
(`stadium_district`). Doubling `CUSTOMER_EXIT_LINGER_MS` again (to 8000ms) would only buy another
factor of ~1.6-2x on these same small numbers — still well short of a crowd for the two quieter
markets — and every further increase narrows the margin against `CUSTOMER_EXIT_LINGER_MS` (below)
crossing into a NEW throughput risk of its own for whichever market spawns fastest. This confirms,
with real numbers rather than a vibe, `docs/kb/conventions.md`'s own already-documented "Open
Balance Gaps" entry: "a real 1v1 serves 16-36 parties per restaurant against PRD §24's 40-90...
foot traffic was not scaled" — this run's own mean `guestsServed` of 29.6 per restaurant sits
squarely inside that already-known 16-36 band, below the PRD's 40-90 target. **Recommendation for
the user, not made unilaterally here:** if "many more people walking by" needs to be unambiguous
at a glance rather than statistically real-but-occasional, the underlying lever is
`market.baseFootTrafficPerMinute` in `shared/game-data/markets.json`, which this story does not
touch — `git diff master...HEAD -- shared/game-data/markets.json` is empty, confirmed before
committing.

**Verification.** `npm run install:all` (fresh worktree). `npm run check` — every `check-*.mjs`
(now 34, including `check:crowd-density`), both builds (`build:client` `tsc --noEmit && vite
build`, `build:harnesses` likewise), and all four smoke suites — passes green, exit code 0, run
in full after every edit above (not just the changed sections). `check:orders` was re-run
individually both against the reverted-all-three attempt (to produce the FAIL evidence above) and
against the final shipped constants (50/50, `bal-1`..`bal-9` identical to master) to isolate
exactly which constant caused the regression.

**Files touched.** `shared/constants/tuning.js` (`CUSTOMER_EXIT_LINGER_MS` value + comment;
`CUSTOMER_ENTER_DISTRICT_MS`/`CUSTOMER_EVALUATE_RESTAURANTS_MS` comment only, values unchanged);
`scripts/measure-district-crowd-density.mjs` (new); `scripts/check-district-population.mjs`
(new section 8 + two new tuning-constant imports); `package.json` (`check:crowd-density` script +
chain wiring). `server/src/game/systems/customer-system.js` and
`shared/game-data/markets.json` are untouched — confirmed by `git diff master...HEAD --
shared/game-data/markets.json` (empty) and by re-reading every diffed hunk before commit.

## Notes

- Depends on STORY-044 (needs the real population rendering to exist before tuning its density
  can mean anything).
- Cites: manifest.json's own "OPEN BALANCE GAP" note — "a real 1v1 serves 16-36 parties per
  restaurant against PRD §24's 40-90, because the shared district halves throughput and foot
  traffic was not scaled" — this is directly relevant context: the district may already be
  under-populated relative to the PRD's own target, which would make "not enough visible
  non-converting crowd" a symptom of that known gap, not a rendering bug alone. Surface this
  connection explicitly if the measurement in AC1 confirms it.
- This story PRESERVES `shared-district-choice`'s decision math entirely (see STORY-044's own
  notes) — it only tunes what fraction of the ALREADY-DECIDED population is visible/how it paces,
  never what the model decides.
