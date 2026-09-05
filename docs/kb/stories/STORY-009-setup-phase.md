---
id: STORY-009
title: "Setup phase: menu, pricing, staffing, and validation"
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/009-setup-phase
worktree_path: /Users/brent/table-stakes-worktrees/story-009-setup-phase
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/6
is_architectural: true
approach_summary: "Shared setup contract (shared/schemas/setup-rules.js) imported by both sides; server authority in server/src/game/validators/setup-validator.js with 20 machine-readable rejection reasons; setup-system.js locks menus and fills defaults at the setup -> service transition; PRD §18 four-region React screen showing only the six §7 qualitative labels; submission carried in the per-viewer `you` slice so the opponent never receives it."
created: 2026-08-28
updated: 2026-08-29
---

# Setup phase: menu, pricing, staffing, and validation

PRD §7 is the strategic half of the game: the player converts market knowledge into a menu, prices,
starting inventory, staff assignments, and an opening upgrade. §18 specifies the screen. This story
builds both the setup UI and the server-side `setup_validator.js` that decides whether a
submission is legal.

The design brief is that setup should feel meaningful but must not become a slow spreadsheet game,
and §7 "Pricing" is emphatic that the UI shows **qualitative** guidance — "Excellent value",
"Premium", "Likely too expensive for this market" — never the underlying utility math.

MVP constraints from §7: three main dishes, up to two add-ons, prices within a bounded range, and
no menu changes after setup.

## Acceptance Criteria

- [ ] The setup screen follows the §18 layout: market briefing and customer forecast at left, menu
      slots and dish options centre, prices/margins/resources at right, staff assignments and
      upgrade/perk selection at bottom, countdown and opponent-ready status on top.
- [ ] The player selects exactly 3 main dishes and up to 2 add-ons (drink, dessert, or side).
- [ ] Each selected item takes a price within a bounded range derived from its `suggestedPrice`.
- [ ] Price feedback is **qualitative only** — the six §7 labels ("Excellent value",
      "Competitive", "Premium", "Likely too expensive for this market", "Low margin", "Strong
      margin, demand risk"). No utility number, weight, or conversion probability is displayed.
- [ ] The market briefing shows what §7 lists: market name and description, daypart, nearby
      anchors, segment forecast, broad spending and patience indicators, event forecast if any,
      starting cash, layout, worker roster, dish catalogue, inventory, and available upgrades.
- [ ] The player allocates starting inventory and assigns workers to stations; the submission
      matches the `setup_submit` shape in §12 (`menu[]`, `addons[]`, `startingUpgradeId`,
      `staffAssignments`).
- [ ] `server/src/game/validators/setup-validator.js` rejects: wrong dish counts, out-of-range
      prices, a dish no station in the layout can produce, inventory exceeding starting cash, an
      unaffordable starting upgrade, and unknown ids. A rejected submission returns a reason and
      does not mutate match state.
- [ ] **A dish that is not physically producible by a station in the restaurant cannot be put on
      the menu** (§7 "Menu constraints").
- [ ] The opponent's menu and prices are not present anywhere in the client's received data during
      setup — verifiable by inspecting the snapshot payload (§18).
- [ ] Submitting marks the player ready; service begins when both are ready or the timer expires.
- [ ] The menu is immutable once service starts — no message can change it mid-match.

## Notes

- **Depends on STORY-002** (dish/market/upgrade catalogues, `setup_submit` schema) and
  **STORY-003** (phase clock and ready gate). **STORY-006** owns the inventory model this screen
  allocates against; if 006 has not landed, allocate against a stub and leave the validator rule.
- `conventions.md` **Notable Pattern 9** — qualitative guidance, never simulation math — is the
  criterion most likely to be broken here by "helpfully" showing a projected conversion rate.
- `conventions.md` **Notable Pattern 1**: menu and price validity are server-owned. The client may
  disable an illegal option for UX, but the server must independently reject it.
- `conventions.md` "Code Style": no large UI system; plain CSS or CSS modules.
- PRD §7 in full; §18 "Setup UI"; §12 for the `setup_submit` envelope.
- Policies/perks: §7 says for MVP either omit them or include only two. Ship **two at most**
  (suggest House Special and Friendly Staff) or none — do not build all five.
- Mid-match specials are explicitly deferred in §7 and out of scope in §20.
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Architectural: establishes the setup contract and a new validator.
