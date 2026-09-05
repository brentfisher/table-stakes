---
id: STORY-012
title: Upgrades and the physical purchase terminal
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/012-upgrades-and-terminal
worktree_path: /Users/brent/table-stakes-worktrees/story-012-upgrades-and-terminal
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/14
is_architectural: false
approach_summary: "upgrade-system.js is a new per-restaurant facade (owned upgrades, a derived cashAvailable, match.upgradeEffects republished every tick) mirroring order-system.js's/event-system.js's own facade pattern. Wires 5 of 11 catalogue upgrades into existing tuning hooks in order/customer/inventory/action-validator; the other 6 are declared but rejected effect_not_implemented on purchase (Decision 7's discipline applied to effect keys). action-validator.js#handlePurchaseUpgrade is the new authority chokepoint for purchase_upgrade, mirroring handleInteract."
created: 2026-08-28
updated: 2026-08-31
---

# Upgrades and the physical purchase terminal

PRD §10's upgrade philosophy has one non-negotiable mechanic: upgrades are bought by physically
moving the owner to an in-world terminal. **Spending cash must cost time and attention.** Stepping
away from the kitchen to buy a faster oven may be correct long-term and still cost three dishes
their freshness window — that trade is the point.

This story implements the catalogue, the terminal interaction, server-side purchase validation,
and the effects actually taking hold. §10 also constrains the design: three tiers maximum per
category, no exponential chains, visible physical change where possible, and a preference for
upgrades that alter decisions or spatial flow over ones that only raise a scalar.

## Acceptance Criteria

- [x] Five to eight upgrades from §10 are implemented, including Serving Tray I/II (carry 2 then
      3 plates), Faster Grill I (grill cook time −15%), Better Seating (seated patience +15%), and
      Pantry Shelves (restock travel −25%).
- [x] Costs and effects come from `shared/game-data/upgrades.json`; no effect magnitude is
      hardcoded in a system.
- [x] Purchase requires the owner to be within interaction range of the upgrade terminal in the
      §14 layout — a purchase message sent from across the restaurant is rejected.
- [x] `action-validator.js` validates every purchase: sufficient cash, upgrade exists, tier
      prerequisite met, and **not already owned**. A duplicate purchase is impossible (§21
      Milestone 4: "no duplicate-purchase bugs").
- [x] Cash is debited server-side; the client never adjusts its own balance.
- [x] Each upgrade's effect is applied through the tuning hook its owning system exposed — carry
      capacity (STORY-008), grill `durationMs` (STORY-005), seated patience decay (STORY-004),
      restock duration (STORY-006).
- [x] No category exceeds three tiers, and no chain is exponential in cost or effect.
- [x] At least three upgrades produce a **visible** change in the 3D scene (a second plate carried,
      a changed grill mesh/material, added pantry shelving).
- [x] The HUD shows an upgrade-availability indicator when the player can afford something useful
      (§18) without forcing a trip to check.
- [x] Under §24's hypothesis, a healthy restaurant can afford a meaningful upgrade roughly every
      60–120 seconds; the observed interval is reported in the dev log. **Caveat below.**
- [x] The starting upgrade chosen at setup (`startingUpgradeId`) applies at service start.

## Implementation notes (post-hoc)

- **§24 affordability dev log — mechanism works, the number it reports is not yet meaningful.**
  `upgrade-system.js` logs a rising-edge event every time cash newly covers a wired, unowned,
  prerequisite-satisfied upgrade, plus the mean interval between events. The rising-edge logic
  itself is tested and correct (`check-upgrades.mjs` section 12, falsified). But nothing
  currently SPENDS cash autonomously — there is no bot (STORY-017, still pending) and this dev
  log only fires from an unattended simulated match, never a human playing — so cash only ever
  crosses upward once and then keeps climbing forever; the log will show exactly one event with
  `meanIntervalMs=n/a` in every unattended run. The 60-120s hypothesis needs a spending agent
  (a human, or STORY-017's bot) to produce a real second, third, nth event to average an
  interval from. The plumbing is ready for that story to just start showing real numbers.
- STORY-008 measured only `cook_1` staffed at `prep` by default; `faster_grill_1`'s effect is
  real and tested (a 6000ms grill step becomes 5100ms), but whether that translates to more
  parties served in practice depends on how STORY-007's cook/server actually route around it —
  not measured here, out of this story's scope.
- The 6 unwired catalogue upgrades (`prep_counter_1`, `server_radio_1`, `additional_table_1`,
  `street_signage_1`, `maintenance_plan_1`, `complimentary_snacks_1`) are rejected
  `effect_not_implemented` on purchase — legal catalogue data, no live system reads them yet.
- Could not capture a live screenshot of the terminal overlay or the 3D visual changes — same
  browser-automation `requestAnimationFrame`-throttling limitation documented on STORY-008's
  entry. PR #14 carries a Mermaid sequence diagram instead.
- PR #14 merged into `master`.

## Notes

- **Depends on STORY-002** (`upgrades.json`) and **STORY-008** (terminal interaction and the
  validator path). Its effects land on hooks owned by 004, 005, 006, and 008 — if any has not
  landed, implement that upgrade against the tuning constant and note it as inert.
- `conventions.md` **Notable Pattern 1**: upgrade purchase validation is explicitly in the
  server's ownership list, and `key-files.md` names `action-validator.js` as the chokepoint.
- `conventions.md` data-driven content: upgrade effects are data.
- PRD §10 in full (philosophy, categories, tier rules, the worked cost table), §18 (HUD upgrade
  indicator), §24 (affordability cadence), §21 Milestone 3.
- The upgrade **preview** harness is STORY-021.
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Not architectural beyond extending the validator — but it touches four other systems' tuning
  hooks, so land it after they exist rather than adding the hooks itself.
