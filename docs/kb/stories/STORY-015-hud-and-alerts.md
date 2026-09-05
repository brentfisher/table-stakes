---
id: STORY-015
title: Service-phase HUD and alert prioritization
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/015-hud-and-alerts
worktree_path: /Users/brent/table-stakes-worktrees/story-015-hud-and-alerts
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/17
is_architectural: false
approach_summary: >-
  Nearly every §18 field already exists on the wire: RestaurantSnapshot carries cash/revenue
  (STORY-013), purchasedUpgradeIds (STORY-012), workers[].needsHelp (STORY-007, whose own comment
  says "STORY-015 ranks it as an alert"), and an activeBottlenecks?: BottleneckKind[] field
  reserved but never populated by any system. This story adds a small new read-only aggregation
  step (mirroring scoring-system.js's pattern: registered late, owns no state, only reads shortages/
  workers/customer-patience already published by other systems) to populate activeBottlenecks
  server-side, then builds the React HUD (client/src/ui/, alongside HudPanel) to rank and cap
  alerts client-side per the §18 order. "Score comparison" has no live composite-score field
  (scoring only runs once at match end) — render it from existing comparable fields (revenue,
  guestsServed, reputation, averageSatisfaction) side by side rather than inventing a live score,
  consistent with Notable Pattern 9/10 (qualitative, not simulation math). No wire schema field is
  newly added (activeBottlenecks is already declared); no cross-module contract changes.
created: 2026-08-28
updated: 2026-09-03
---

# Service-phase HUD and alert prioritization

PRD §18 requires immediate operational awareness without overwhelming the screen, and pairs it
with an explicit **alert priority order** — because §23 names "player workload becomes exhausting"
as a real risk and alarm fatigue is how a management game becomes noise.

This story builds the service HUD: the player's own operational state, a compact rival summary,
the active and upcoming event, and a critical-alert channel that is deliberately rate-limited and
ranked rather than firing everything at once.

## Acceptance Criteria

- [ ] The HUD shows every §18 required element: match timer, score comparison, revenue and
      available cash, customer count / queue warning, average satisfaction, current active event,
      upcoming event warning, critical alerts, owner carry inventory, the selected contextual
      interaction, and an upgrade-availability indicator.
- [ ] A compact rival summary shows rival score, rival customer count, and rival satisfaction
      trend — and **nothing** the PRD does not list (no rival menu, no rival prices).
- [ ] Alerts are ranked in the §18 order: customer abandonment imminent → food ready but
      undelivered → ingredient shortage blocking an active order → equipment problem → event
      countdown → upgrade available → general operational suggestions.
- [ ] The number of simultaneously displayed critical alerts is capped, with lower-priority alerts
      suppressed rather than queued into a scroll — verify the cap holds during a heavy rush.
- [ ] The HUD remains readable during a full rush at the target resolution (§22 Quality: "UI
      remains readable during a full restaurant rush").
- [ ] `Tab` opens the tactical overview panel described in §8.
- [ ] All HUD values are read from `match_snapshot`; none are computed client-side.
- [ ] The HUD is React and updates at panel cadence, **not** per animation frame, and does not
      re-render the Three.js scene graph (`conventions.md` Notable Pattern 3).
- [ ] Floating cash/tip feedback appears only for major moments, not every transaction (§14).

## Implementation notes (post-hoc)

- **`BottleneckKind` values populated, and the exact §18 priority mapping.** New
  `server/src/game/systems/hud-bottleneck-system.js` (registered strictly between `upgrades` and
  `scoring` — `systems/index.js`'s header explains why) populates `activeBottlenecks` with 6 of
  the 8 declared kinds, each traced to a real already-published signal, never a new one:
  - `unhappy_customer` → §18 priority 1 "Customer abandonment imminent". Reuses
    `CustomerSnapshot.unhappy` verbatim (the existing `UNHAPPY_CUSTOMER_PATIENCE_THRESHOLD`
    line) rather than inventing a stricter "imminent" fraction with no empirical basis.
  - `server_overload` → priority 2 "Food ready but undelivered". A ready ticket whose
    `readyAgeMs` exceeds `ORDER_FRESHNESS_GRACE_MS` — reused directly from `order-system.js`'s
    own quality-decay grace window rather than a second, possibly-disagreeing threshold.
  - `ingredient_shortage` → priority 3. `shortages[]` entries with `blockedTickets > 0`.
  - **`equipment_failure` → priority 4 is NEVER emitted.** No station is ever marked `broken`
    anywhere in this codebase (`action-validator.js`'s own comment: `repair` is a legal
    `INTERACT_ACTIONS` member that is always rejected `no_failure_state`). Emitting this kind
    with no real source would be indistinguishable from a bug; the honest position is the same
    one `scoring-system.js#countCriticFailures` takes returning 0 when a critic event never
    fired. The priority slot stays reserved (`ALERT_CATEGORIES[3] === 'equipment_problem'`) so a
    later story that adds a real failure state only has to teach one function what "broken"
    means, never touch the ranking.
  - `kitchen_backlog`, `long_entry_queue`, `dirty_table` → priority 7 "General operational
    suggestions" (new UI-noise thresholds, not balance numbers: `HUD_KITCHEN_BACKLOG_QUEUED
    _TICKETS_THRESHOLD`, `HUD_LONG_ENTRY_QUEUE_THRESHOLD`).
  - Priorities 5 ("Event countdown") and 6 ("Upgrade available") are NOT restaurant bottlenecks
    and are deliberately not `BottleneckKind`s: they come straight off `events[]`
    (`state === 'warning'` within `HUD_EVENT_COUNTDOWN_ALERT_MS`, PRD §7's own 10-20s teaser
    window) and off `canAffordUpgrade` (the existing STORY-012 client-side affordability read,
    reused rather than duplicated server-side).
  - `cash_opportunity` (the 8th declared kind) is also never emitted — it is §14's purple
    "premium/high-value opportunity" visual cue, owned by STORY-016, not an §18 alert category.
  - The ranking itself lives in `shared/game-logic/hud-alerts.js` (`buildCriticalAlerts` +
    `capCriticalAlerts`), a plain-JS + `.d.ts` module (Decision 4's shape) imported by BOTH
    `GameClient.ts` and `scripts/check-hud.mjs`, so the ranking the HUD shows and the ranking the
    check chain verifies cannot drift apart. The client NEVER decides whether a bottleneck
    category is active — only the server's `activeBottlenecks` flag gates a category firing at
    all; the client's only job is picking out WHICH specific entity (customer/ticket/shortage)
    earns the alert text, from the same raw arrays the server used. Verified directly: an
    unhappy customer with no server-side `unhappy_customer` flag produces zero alerts even
    though the raw data would otherwise qualify.
  - The cap (`HUD_CRITICAL_ALERTS_MAX = 4`) is measured against a constructed heavy-rush
    scenario (6 abandonment-risk customers + 6 stale ready orders + a shortage + an event + an
    affordable upgrade + 3 suggestions = 18 candidate alerts), asserted to display exactly 4,
    always the highest-priority ones, with the least-patience customers surviving the cap first.
- **Avoiding per-tick React re-renders.** `GameClient.ts` computes `criticalAlerts` (ranked AND
  capped) exactly once per `match_snapshot` message (~10 Hz), inside `handleMessage`, and stores
  the finished array on `GameClientStatus`. `HudPanel`/`TacticalOverviewPanel` only ever `.map()`
  over what they were handed — no sorting, filtering, or threshold comparison happens in the
  render path, and nothing here touches `handleFrame` (the per-`requestAnimationFrame` path,
  reserved for camera/interpolation). Neither new panel reaches into `SceneManager`/the Three.js
  scene graph at all; they are pure React over `GameClientStatus`, the same architectural
  boundary `ResultsPanel.tsx`/`SetupScreen.tsx` already established.
- **"Score comparison" scoping.** No live composite score exists mid-match (`scoring-system.js`
  computes it once, at the `results` transition) — confirmed by grep, not assumed. `HudPanel`'s
  new Scoreboard renders PRD §18's "current score comparison" AND the compact rival summary's
  "rival score" from the same real, side-by-side fields instead: customers now (live occupancy +
  queue), guests served (cumulative), and average satisfaction. **Reputation is shown for the
  owner's own column only** and dashed for the rival in the compact scoreboard — not because it
  is private (it is genuinely public on `restaurants[]`) but because §18's compact-rival-summary
  bullet does not name it, and the AC's own "and nothing the PRD does not list" reads as a
  content restriction on THAT panel specifically. The Tab-toggled tactical overview panel (§8,
  a different AC bullet with no such restriction) DOES show rival reputation, since it is
  genuinely public data — same field, two different panels, each honoring the PRD bullet that
  actually governs it.
- **"Rival satisfaction trend" is shipped as a level, not a series.** No historical satisfaction
  series exists anywhere on the wire; synthesizing one from client-held snapshot history would
  both reintroduce client-side state this story's own AC forbids ("none are computed
  client-side") and edge into fabricating a number nothing server-side actually tracks. The
  scoreboard shows the rival's current `averageSatisfaction` — a real, live, already-published
  level — under that literal PRD label, and this note records the scoping decision explicitly
  rather than leaving it inferable only from a code comment.
- **`you.revenue` is a genuine wire-schema widening — the frontmatter's `approach_summary` above
  is wrong about this.** `RestaurantSnapshot.revenue` (declared in `game-state.d.ts`, tagged
  "STORY-013") is NEVER populated by any system — `customer-system.js#toPublicRestaurantSnapshot`
  explicitly excludes it ("neither are cash, inventory, the ledger... a later story owns"), and
  the AC needs the viewer's OWN live revenue to render "Revenue and available cash" and to detect
  a "major moment" for the floating cash feedback. Added `revenue: number | null` to `you`
  (`SnapshotViewer` in `messages.d.ts`, populated in `match.js#toSnapshot` from
  `this.kitchen?.revenueFor(viewer.playerId)`) — the exact same private, per-viewer treatment
  `cash` already has, for the identical reason (`restaurants[]` is the one array both players
  receive IDENTICALLY; a rival's revenue is no more public than their cash on hand). Confirmed
  `check-district-choice.mjs`'s privacy scan (`PRIVATE_KEYS` including `"revenue"`) only greps
  the `restaurants[]` JSON, never `you`, so this does not trip it. `is_architectural: false`
  still holds — one private field mirroring an existing sibling field is not an architectural
  change; it does not touch a cross-module contract. Falsified directly (broke the `match.js`
  line, confirmed `check-hud.mjs` catches it, restored).
- **`HUD_CASH_FEEDBACK_MIN_DELTA` was measured, not guessed — and the first value I wrote (15)
  was wrong.** An organic six-seed, two-menu probe match (real customer arrivals through a full
  `service` phase, no forced fixtures) averaged **$52.27 revenue per settled party** (range
  $31-$83 across twelve restaurant-runs; `order.revenue` is a whole party's order, not one
  dish). $15 would have fired on nearly every party — the opposite of §14's "not every
  transaction." Raised to $100, clearly above the measured ceiling. The decision itself
  (including the null-revenue first-sample guard, so `service` starting does not read as one
  giant payment) is `shared/game-logic/hud-cash-feedback.js#cashFeedbackFor`, a pure function
  with the same dual-import shape as `hud-alerts.js`, exercised directly by `check-hud.mjs` (4
  assertions: first-sample guard, sub-threshold, at-threshold, no-change) and falsified.
  Verified live in a real two-player browser session that the timer/patch wiring around it
  (`GameClient.ts`) does not leak a `setTimeout` across rapid snapshots.
- **`Tab` and `SetupScreen`.** `InputController` already declared `onToggleOverview` before this
  story (dead code) and already called `preventDefault()` unconditionally — which would have
  swallowed Tab inside `SetupScreen.tsx`'s form controls the moment this story gave the key a
  handler. Added `setTacticalOverviewEnabled(enabled)`, flipped by `GameClient` on every
  `service`/`final_rush` phase transition; Tab is now inert (and does not `preventDefault`)
  everywhere else, including `setup`.
- **Verified live**, not just via `npm run check` (this repo has no React test framework —
  `tsc --noEmit` is the established bar per `ResultsPanel.tsx`'s own header, and per-transaction
  cash feedback plus Tab's toggle live entirely in `GameClient.ts`/React with zero check-script
  coverage of the DOM itself). Ran a real two-tab browser session against a live dev server
  (`npm start`) through `lobby -> market_reveal -> setup (auto-fill) -> service`: HUD, scoreboard
  (including the live "Customers now" tick as a real district arrival happened), the
  server-authoritative "You can afford Serving Tray I" alert, and the Tab-toggled tactical
  overview all rendered correctly with live two-restaurant data; zero console errors, including
  after a mid-service page reload (reconnect path). Screenshot saved to
  `/tmp/story-015-hud-screenshot.jpg` (ephemeral path — regenerate via the same room-based
  two-tab recipe if it's gone by PR time).
- `npm run check` is green end-to-end, including the new `check:hud` (39 assertions) registered
  in its chain — every one of `check-hud.mjs`'s own new assertions was individually falsified:
  break the code, confirm the specific check fails, `git checkout` restore.

## Notes

- **Depends on STORY-003** (phase and timer in the snapshot) and **STORY-004** (customer counts and
  satisfaction). Rival summary needs **STORY-010**; the event row needs **STORY-011**; the upgrade
  indicator needs **STORY-012**. Build each element against the snapshot field and let it read
  empty until its owning story lands — do not block on all of them.
- `conventions.md` **Notable Pattern 3** is the main correctness risk here: a HUD wired to
  per-tick React state is the documented way this codebase's rendering degrades.
- `conventions.md` **Notable Pattern 9**: show qualitative state, not simulation math.
- PRD §18 "HUD" and "Alert prioritization"; §14 for cash-feedback restraint; §22 Quality;
  §23 (workload risk, mitigated by prioritizing alerts).
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Not architectural — presentation over existing snapshot fields.
