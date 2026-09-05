---
id: STORY-014
title: Results screen with explanation layer
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/014-results-screen
worktree_path: /Users/brent/table-stakes-worktrees/story-014-results-screen
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/16
is_architectural: true
approach_summary: >-
  MatchResult carries none of what the narrative layer needs (no decision-reason aggregation, no
  score-differential history for turning points, no explicit tie-break statement), so this story
  widens MatchCompleteMessage/MatchResult (messages.js + .d.ts, Decision 7 "widen, never rename")
  with server-computed narrative/turning-point/tie-break fields, likely via a small new module fed
  by customer-system.js's decisionReason and a periodic score snapshot scoring-system.js doesn't
  currently keep. Client side adds client/src/scenes/ResultsScene.ts plus a React results panel
  under client/src/ui/ that renders match_complete verbatim, matching HudPanel/SetupScreen's
  existing pattern. Touches shared/schemas/messages.{js,d.ts}, server/src/game/systems/
  (customer-system.js, scoring-system.js, possibly a new results/narrative module), and new
  client-side scene/UI files.
created: 2026-08-28
updated: 2026-09-03
---

# Results screen with explanation layer

PRD §11 makes a strong claim about this screen: it "turns each match into a learning loop rather
than a black-box simulation", and §21 Milestone 4 sets the bar as "most players understand why
they lost." That is the deliverable — not a stat dump, but an explanation.

The PRD's own example shows the target register: *"You won the lunch rush by serving 18 more
office-worker parties. Your Caesar Salad had the fastest average fulfillment time, while your
rival lost 11 customers to queue abandonment after the transit-delay event."* Producing sentences
like that is possible only because STORY-010 recorded a decision reason for every customer.

## Acceptance Criteria

- [ ] `client/src/scenes/ResultsScene.ts` plus a React results panel render on `match_complete`.
- [ ] Every §11 field is displayed: winner and final score, revenue, expenses, net profit,
      customers served, customers lost to rival, average satisfaction, average wait time,
      best-selling dishes, highest-margin dishes, event performance, upgrades purchased, and
      customer-segment breakdown.
- [ ] A **narrative insight** section generates plain-language sentences from the recorded decision
      reasons and per-segment counts — at minimum: the segment that decided the match, the
      player's best-performing dish by fulfillment time, and the rival's largest single loss cause
      tied to the event that caused it.
- [ ] Key turning points are identified (largest score-differential swings, tied to the event or
      phase in which they occurred).
- [ ] The score breakdown shows each §11 component's contribution and the penalties applied, so a
      player can see *which* term lost them the match.
- [ ] Tie-break resolution, when it decides the match, is stated explicitly rather than silently.
- [ ] The screen fits the §5 results window (30–60 seconds, 20s in the prototype preset) and
      offers a rematch path back to the lobby.
- [ ] Nothing on this screen is recomputed client-side — every number comes from the
      `match_complete` payload.

## Implementation notes (post-hoc)

- **The narrative/turning-point mechanism, concretely.** The story's own approach note guessed
  at "a periodic score snapshot scoring-system.js doesn't currently keep" — that guess was
  wrong, and better data was already sitting unused. Orientation found `customer-system.js`
  already retains a full per-party §17 decision log (`match.districtDecisions` — `{atMs,
  chosenRestaurantId, reason, ...}` per party, published live every tick and never cleared,
  explicitly commented "STORY-014 reads these two at `results`") and a per-restaurant
  `lostByReason`/`segmentCounts` roll-up (`districtSummary`). **No per-tick sampler was added.**
  Turning points are reconstructed RETROACTIVELY, once, at `results`, by walking that decision
  log and measuring how the cumulative party-acquisition margin between the two restaurants
  swung across windows bounded by event start/end times — the exact same "honestly-available
  proxy, not the real score, sampled after the fact" the story's approach note flagged as
  acceptable. `scoring-system.js`'s "owns no simulation state of its own" header claim is still
  true.
- **New pure module**: `server/src/game/scoring/narrative.js`, mirroring
  `score-formula.js`'s existing discipline (no `match` knowledge, plain-object/array
  parameters, independently unit-tested). Holds `pickDecidingSegment`, `pickBestDish`,
  `pickLargestLossCause`, `computeTurningPoints`, plus the `toEventWindows`/`eventAt` helpers
  both `pickLargestLossCause` and `computeTurningPoints` share for correlating a timestamp
  against the event timeline (same `anchorMs`-relative conversion
  `scoring-system.js#countCriticFailures` already used).
- **One genuine data gap, one new accumulation.** Everything above was already recorded. The
  one number that was not: per-dish fulfillment time. `order-system.js`'s `dishSales` map
  gained `fulfillmentMsSum`/`fulfillmentSamples`, accumulated in `deliverOrder` from
  `ticket.readyAtMs - order.placedAtMs`, averaged into a new `dishFulfillment` array (the FULL
  list, not the top-5 `bestSellingDishes` slice — the fastest dish need not be a best-seller).
- **"Largest loss cause" is a scoped interpretation, documented in design.md Decision 45.** The
  PRD's own worked example ("lost 11 customers to queue abandonment") names a POST-COMMITMENT
  exit mechanic (patience running out in the queue) that the codebase does not currently attach
  a §17 reason or a retained timestamp to. Rather than fabricate one, `largestLossCause` answers
  the same AC bullet with the closest data that genuinely exists: the restaurant's largest
  `lostByReason` bucket (the §17 DISTRICT-CHOICE reason parties picked the rival for),
  event-tagged only when a real majority (not "any overlap") of that bucket's own decisions fall
  inside one event's window. A later story adding exit-state timestamp tracking can widen this
  field, never rename it.
- **Score/penalty breakdown was nearly free.** `computeCompositeScore` already returned a
  `components` object STORY-013's own `buildRestaurantResult` discarded down to `{ score }`.
  Kept, plus one new sibling pure function, `computePenaltyBreakdown` (per-term products,
  mirroring `computePenaltyPoints`'s arithmetic without changing that function's existing
  contract).
- **Tie-break, stated explicitly.** New sibling pure function `explainTieBreak` (also in
  `score-formula.js`) names which of the four §11 tie-break criteria actually decided a match
  whose composite scores tied exactly; `scoring-system.js` sets `tieBreakDecided` on
  `match.finalResults` only when that's genuinely the case (never on an ordinary decided match,
  never on a true draw). Verified end-to-end against a REAL genuine-draw match (asserts `null`)
  and, for the non-null path, against `explainTieBreak` driven by real `tieBreak` objects pulled
  out of `buildRestaurantResult` (the same "can't reconstruct a bit-exact score tie from
  differing inputs" floating-point limitation STORY-013's own tie-break tests already document
  and work around) — including a check that pins the RUNG ORDER, not just the eventual winner,
  after a falsify pass caught that the first version of that check didn't actually distinguish
  "checks satisfaction first" from "checks guestsServed first" in its one test scenario.
- **`scripts/check-scoring.mjs` extended, not replaced** (already in `npm run check`'s chain —
  no new npm script). Every new assertion was individually falsified (break the code, confirm
  the specific check fails, `git checkout` restore) before being trusted; `npm run check` is
  green at 565 assertions across the whole suite.
- **Client**: `ResultsScene.ts` is a deliberately static Three.js backdrop (fixed lights, two
  fixed podium meshes) with no props and no dimension derived from a score or count — the
  "nothing recomputed client-side" AC applies to the scene too, not just the React panel.
  `SceneManager` gained one swappable active-scene reference; `GameClient`'s `match_complete`
  handler now stores the whole payload verbatim on `status.matchComplete`, and the results panel
  mounts on that field being non-null (covers the disconnect-end path, which never visits the
  `results` phase) rather than on `matchPhase === 'results'` alone.
- **Rematch**: no `rematch` client message type exists or was added. The button navigates to
  `window.location.pathname` (drops the `?room=` query param), which re-joins room-less on
  reload — PRD §12 room-flow step 1, landing back in the lobby.
- Could not capture a screenshot in this pass (no running dev server in the harness); the
  OpenSpec design doc carries a Mermaid diagram of the actual data flow (customer-system.js /
  order-system.js / event-system.js -> narrative.js + score-formula.js -> scoring-system.js ->
  match.js -> GameClient.ts -> ResultsPanel.tsx / ResultsScene.ts) in place of a rendered image.

## Notes

- **Depends on STORY-013** (the results payload) and, for the narrative layer to say anything,
  **STORY-010**'s decision reasons.
- `conventions.md` **Notable Pattern 8** exists specifically to make this screen possible: the
  decision-reason list is what the explanation layer is generated from.
- `conventions.md` **Notable Pattern 3**: this is React UI, not a per-frame Three.js concern.
- PRD §11 "End-of-match results" including the worked narrative example; §20 (full results screen
  is in MVP scope); §21 Milestone 4 success criterion.
- **OpenSpec:** no prior decisions existed to preserve, revise or supersede at slicing time —
  `openspec/changes/` and `openspec/specs/` were present and empty, and `openspec/changes/
  archive/` did not exist. **This slicing-pass note turned out to be wrong**: the story is
  architectural after all (`is_architectural: true` in frontmatter reflects the corrected call).
  Building a real narrative/turning-point layer required widening the wire contract itself —
  `MatchResult` gained four fields, `MatchCompleteMessage` gained three more — not just adding
  presentation over an unchanged payload. See `openspec/changes/results-screen-narrative/` for
  the proposal/design/spec/tasks this correction produced, Decisions 43-46 in its design.md, and
  this file's own Implementation notes above for the concrete mechanism.
