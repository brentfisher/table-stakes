---
id: STORY-008
title: Owner avatar contextual interaction system
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/008-owner-interaction-system
worktree_path: /Users/brent/table-stakes-worktrees/story-008-owner-interaction
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/13
is_architectural: true
approach_summary: "action-validator.js is the one authority chokepoint for every §8 action, re-deriving range/existence/state from match.kitchen/floor/pantry; InteractionController.ts resolves an optimistic client-side prompt from a fixed priority list and never applies an effect. Carry is a real two-touch pickup/deliver since the owner is a controllable body; order.claimedBy arbitrates the one readyOrders() pool the AI server also reads."
created: 2026-08-28
updated: 2026-08-31
---

# Owner avatar contextual interaction system

Design pillar 4.1 is "active ownership, not passive clicking": every meaningful action maps to an
in-world operational decision, and there is no click-to-earn loop. STORY-001 gave the owner a body
that moves. This story gives it hands.

The owner gains the §8 action set — pick up ingredients, restock a station, prepare a dish faster
than a worker, plate, carry a plate to a table, clear tables, seat a waiting party, refill items,
repair a stuck station, handle a dissatisfied customer, and buy an upgrade at the terminal — all
driven by a **contextual** prompt that appears when the owner is near a valid target
(`E — Cook Smash Burger`, `E — Deliver Order #12`, `E — Restock Lettuce`).

Every action is an `interact` intent validated server-side. The client never resolves an action;
it renders the prompt and sends the intent.

## Acceptance Criteria

- [x] Controls match §8: WASD move, mouse look/aim, `E` contextual interact, `F` secondary action,
      `Shift` limited sprint, `Tab` tactical overview. `Esc` opens settings **only** in the
      single-player harness — there is no pause in multiplayer.
- [x] `client/src/game/InteractionController.ts` resolves the highest-value valid target within
      range and surfaces one prompt string in the `E — <verb> <object>` form of §8.
- [x] Pressing `E` sends an `interact` message carrying `targetId` and `action` per the §12
      example; the client applies no economy or state effect locally.
- [x] `server/src/game/validators/action-validator.js` rejects an interact whose owner is out of
      range, whose target does not exist, or whose action is invalid for that target's current
      state — and the rejection is observable in the dev log.
- [x] The owner can perform each of these end to end: cook/prep at a station, plate a finished
      dish, carry a dish to a table, restock a station bin from the pantry, seat a waiting party,
      clear a dirty table, and recover a dissatisfied customer.
- [x] Carry capacity is a server-side property defaulting to one plate, read from `tuning.ts` so
      the Serving Tray upgrade (STORY-012) can raise it to 2 then 3.
- [x] The owner's carried inventory is in `match_snapshot.players` and rendered in the HUD.
- [x] Sprint is rate-limited by stamina or cooldown from `tuning.ts`, enforced server-side.
- [x] **There is no action that produces money without an operational cause** — no click-to-earn
      affordance exists anywhere in the diff.
- [x] Movement remains server-clamped as established in STORY-001; client-side prediction, if
      added, reconciles to the server position.

## Implementation notes (post-hoc)

- `repair` is declared, shape-checked, and always rejected (`no_failure_state`) per this story's
  own note — no discrete station-broken state exists until STORY-011's power-fluctuation event
  lands.
- STORY-007 measured the cook clearing 98.6% of the kitchen rail at every tuning setting swept —
  with the default single-cook roster, the owner's `cook`/`plate` actions are reachable mainly at
  the one station not staffed, while `deliver`/`seat`/`clear_table`/`handle_complaint` are the
  front-of-house actions actually reachable in normal play.
- `npm run check` is green on a fresh clone (`check:owner`, 44 checks, wired into the chain).
  Falsified 5 ways (range check, arbitration claim filter, busy cooldown, complaint one-shot
  limit, carry capacity) — each break caught, clean restore confirmed after each.
- Could not capture a live browser screenshot of the `E —` prompt: the browser automation tab runs
  backgrounded, and Chrome throttles `requestAnimationFrame` to zero there, which is what the
  prompt's per-frame resolution depends on. PR #13 carries a Mermaid sequence diagram instead.
- **PR #13 is open but not merged** — `gh pr merge` was blocked by the Claude Code auto-mode
  permission classifier, same as STORY-007's PR #12. Needs a manual merge.

## Notes

- **Depends on STORY-005** (things to cook and plate) and **STORY-006** (bins to restock).
  Station repair targets exist only once STORY-011's power-fluctuation event lands — implement the
  repair action against the station's failure state and let it be unreachable until then.
- `conventions.md` **Notable Pattern 1** (server authority) is the whole point of this story:
  `action-validator.js` is named in `key-files.md` as the chokepoint enforcing it, and every new
  player action must pass through it.
- `conventions.md` **Notable Pattern 3**: the interaction prompt is React UI; target resolution is
  Three.js-side. Do not reconcile prompt state through React on every frame.
- PRD §4.1 (design pillar), §8 "Player avatar"/"Controls"/"Interactions", §12 (the `interact`
  message shape), §22 acceptance criteria ("The owner can cook, restock, deliver, clear tables,
  and purchase upgrades").
- The upgrade purchase *interaction* is defined here; the upgrade catalogue and its effects are
  STORY-012.
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Architectural: adds a public message-handling path and the action-validation contract.
