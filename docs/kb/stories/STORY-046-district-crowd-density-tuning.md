---
id: STORY-046
title: Tune visible non-conversion crowd volume against the real district decision rate
status: in-progress
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: story/046-district-crowd-density-tuning
worktree_path: /Users/brent/table-stakes-story-046
base_branch: master
pr_url: null
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

- [ ] Measure the real current non-conversion rate (parties that end in `CHOOSE_RIVAL` +
  `LEAVE_DISTRICT`, as a fraction of all district arrivals) from a real match run — this is
  already computable from `customer-system.js#districtSummary`/`match.districtDecisions`, no new
  telemetry needed, just a read.
  the pacing/duration a party spends visible in-district before exiting (from STORY-044) against
  that measured rate — the crowd should look as busy as the real conversion math says it is, not
  an arbitrary multiplier applied on top.
- [ ] If the real non-conversion rate is measured to be too low to read as "many more people
  walking by" even when rendered honestly (i.e. the market itself isn't generating enough
  foot traffic to look like a crowd), say so explicitly rather than inflating the VISIBLE count
  past what the simulation actually decided — this story tunes rendering/pacing knobs, it does
  not fake numbers the district-choice model didn't produce. If the underlying spawn rate itself
  needs to go up to satisfy the request, that's a balance decision to flag back to the user, not
  to make unilaterally.
- [ ] `npm run check` stays green; if a new tuning constant is added (e.g. district crowd
  visibility pacing), it lives in `shared/constants/tuning.js` alongside its siblings, with a
  comment stating what it was measured against.

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
