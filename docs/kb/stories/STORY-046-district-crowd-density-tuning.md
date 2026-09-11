---
id: STORY-046
title: Tune visible non-conversion crowd volume against the real district decision rate
status: pending
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: null
approach_summary: null
created: 2026-09-10
updated: 2026-09-10
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
