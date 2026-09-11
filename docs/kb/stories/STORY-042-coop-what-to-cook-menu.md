---
id: STORY-042
title: Station "what to cook" menu, suggested from pending orders
status: merged
prd_source: /Users/brent/table-stakes/docs/PRD-co-op-mode-and-district-crowds.md
branch: story/042-coop-what-to-cook-menu
worktree_path: /Users/brent/table-stakes-story-042
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/61
is_architectural: false
approach_summary: >
  Follow the `UpgradeTerminal` proximity-panel precedent exactly: add
  `InteractionController#nearStation(position): string | null` (station name, using the existing
  `STATIONS`/`ENTITY_BY_ID` lookups already in that file) alongside the existing
  `nearUpgradeTerminal`, expose it on `GameClientStatus` as `nearStation: string | null`
  (`GameClient.ts` patches it the same way `nearUpgradeTerminal` is patched in the snapshot
  handler), and render a new `StationMenu` panel in `GameView.tsx` gated on
  `status?.nearStation && status.sharedRestaurant` (co-op only per AC4). The panel reads
  `kitchen.queuedTicketsAt`-equivalent data already published on the snapshot (check
  `KitchenCommandBoard`'s own status fields first to avoid re-deriving what's already on the
  wire) to list cookable items at that station, sorting/highlighting ones with pending demand.
  Selecting an item calls the SAME existing `cook`/`plate` client action for that station
  targetId — no new action type, no per-item selection server-side (`resolveCookOrPlate` already
  auto-picks oldest-first, which is exactly what "needed most" should select). Files: new
  `client/src/ui/StationMenu.tsx`, edits to `InteractionController.ts`, `GameClient.ts`,
  `GameView.tsx`. No server or shared/ changes expected — purely a client affordance over an
  existing action, per the AC's own constraint.
created: 2026-09-10
updated: 2026-09-11
---

## Implementation notes

**AC1 — proximity-triggered menu, following `UpgradeTerminal`'s exact pattern.** Added
`InteractionController#nearStation(position): string | null`
(`client/src/game/InteractionController.ts`), a plain second proximity read alongside
`nearUpgradeTerminal` — it loops `STATIONS` and reuses the private `inRange` helper against each
`station_<name>` entity, returning the first (and, given `OWNER_INTERACT_RANGE` is `2.2` and the
four station entities sit `>=4` apart on the x axis, only possible) match. It is deliberately
**not** added to `resolve()`'s candidate list — `stationCandidate` still owns the single-tap
`E — Cook X`/`E — Plate X` prompt untouched, so this is a second, independent read of the same
range check, not a change to the existing one (this is what makes AC4 provable from the diff
rather than asserted). `GameClientStatus.nearStation: string | null` mirrors
`nearUpgradeTerminal`'s per-frame/patch-on-change discipline in `GameClient.ts`'s `handleFrame`.
`GameView.tsx` renders `<StationMenu>` under `status?.nearStation && status.sharedRestaurant &&
(matchPhase === 'service' || matchPhase === 'final_rush')` — phase-gated like the read-only
boards below it (`FrontDoorBoard`/`ServiceStationBoard`/`PantryBoard`/`KitchenCommandBoard`), not
like `UpgradeTerminal` (which has none), because `cook`/`plate` itself is
`service`/`final_rush`-only (`action-validator.js`'s `INTERACT_PHASES`) and a menu whose one
action is guaranteed `wrong_phase` outside those phases would be actively misleading.

**AC2 — needed items sorted first and highlighted, using the same data
`kitchen.queuedTicketsAt` reports server-side.** `StationMenu.tsx`'s `buildStationMenuItems`
derives per-dish demand straight from `status.orders` (`orders[].station === X && .state ===
'queued'`), which is the identical public array `OrderSnapshot`'s own doc comment says station
queue depth is derived from — no new field, no new server exposure. Items with `queuedCount > 0`
render with an `×N` badge and a `has-demand` class (highlighted), sort before every item with
none (dimmed, `no-demand`), and their buttons are enabled; zero-demand rows are disabled rather
than wired to a button `resolveCookOrPlate` would just reject `nothing_queued`.

Ranking mirrors `worker-system.js#compareTickets`'s two rules as closely as the PUBLIC snapshot
allows, and is honest in the code and here about where it falls short:
- Rule 3 (patience risk) has a direct public analog — `CustomerSnapshot.patienceRemaining`,
  joined ticket → order → customer (`patienceRisk` there is `1 - patienceRemaining`). A ticket
  whose customer can't be found in this snapshot (already exited, or `customers[]` momentarily
  lagging `orders[]`) is treated as MAXIMUM risk (`0`), not average/perfect patience — an
  unaccounted-for ticket must never silently sort to the bottom.
- Rule 2 (queue-age bucket) has **no public analog** and is NOT attempted. `queueAgeMs` lives
  inside `order-system.js`'s private ticket state and is never published on `OrderSnapshot`
  (`readyAgeMs` IS published, but only once a ticket leaves `queued`). Reconstructing it from
  `orders[]`'s array position was considered and rejected: `order-system.js`'s own header
  documents queue DEPTH as array-derived (a `.filter().length`), never array ORDER as FIFO —
  that would have been an inferred invariant dressed up as a sort key. A dish with a queued
  ticket always outranks a dish with none, which alone satisfies AC2's "sorted first, highlighted,
  or both"; ties among demanded dishes break on patience, then on queued count, then
  alphabetically.

**AC3 — selecting an item is the existing `cook`/`plate` interact, no new action type.** Added
`GameClient#cookOrPlateAt(station)`, which sends `{targetId: 'station_<x>', action: 'cook' |
'plate'}` — byte-identical to what `onInteract`'s existing send site already sends for a resolved
`stationCandidate` prompt, same target, same action, no dish or ticket id anywhere in the payload.
Every enabled row in `StationMenu` calls this with the SAME `station`, regardless of which dish's
row was clicked — `resolveCookOrPlate` (`action-validator.js`) has no per-item selection and
always starts the oldest queued ticket at that station, which is exactly what makes this correct
rather than a gap: the menu's own ranking agrees with the server's selection whenever there's a
single most-urgent item, and when it doesn't (two different dishes both queued, clicking the
lower one) the server still starts a genuinely-needed ticket at that station, just not
necessarily the exact row clicked. This is stated on-screen (`station-menu-note`: "Starts the
oldest order waiting at this station"), not just in code comments, since AC2's "a player should
be able to tell" is about what's visible, not what a reviewer can infer from source.

**AC4 — co-op only, non-co-op unaffected.** `nearStation` is computed unconditionally (every
mode), but `StationMenu` only renders under the added `status.sharedRestaurant` gate in
`GameView.tsx`. Verified by construction rather than a new check script: `resolve()` (the
`E —` prompt's own resolver) and `InputController#onInteract`'s early-return ladder are
UNCHANGED in this diff — `git diff` on `InteractionController.ts` shows a pure addition after
`nearUpgradeTerminal`, and `GameClient.ts`'s `onInteract` handler has no new branch — so a
non-co-op match's existing single-tap prompt is provably byte-identical to before this story, not
just believed to be.

**Design decision: this story's new logic stays client-side, not in `shared/game-logic/`.**
`hud-alerts.js`/`presentation-event-reducer.js` live under `shared/` because they have TWO real
runtime consumers that share no build step (the Vite client and a plain-Node `check-*.mjs`
script) — see `hud-alerts.js`'s own header. `buildStationMenuItems` has exactly one real
consumer, `StationMenu.tsx` itself; writing a `check-*.mjs` for it would exist only to justify
the `shared/` placement, which is circular. This surface's actual precedent is the sibling one
already in the repo: `check-upgrades.mjs`'s own header states `UpgradeTerminal.tsx`'s rendering
and `InteractionController.ts#nearUpgradeTerminal` are "client TypeScript with no server-side
equivalent to call — `npm run build:client`'s `tsc --noEmit` is what proves that half
type-checks." `nearStation`/`StationMenu` is the direct analog of that exact sentence, so no new
`check-*.mjs` was added and none of `package.json`'s `check:*` scripts changed.

**Verification.** `npm run build:client` and `npm run build:harnesses` both type-check and build
clean with the new `GameClientStatus.nearStation` field, `InteractionController#nearStation`,
`GameClient#cookOrPlateAt`, and `StationMenu.tsx`. Full `npm run check` (every `check-*.mjs`,
both builds, and the smoke suites) passes green in the worktree, unmodified — this story adds no
new script to that list, for the reason above. **Honest visual-verification limitation** (same as
STORY-041): this environment's browser automation cannot run the WebGL render loop —
`document.visibilityState` reports `hidden` in the automated Chrome tab, which blocks
`requestAnimationFrame` — so the panel's actual on-screen appearance (layout, the highlighted vs.
dimmed rows, the disabled-button state) was never screenshotted or visually confirmed live. No
claim of live visual confirmation is made; verification here is type-checking plus the
by-construction diff argument for AC4 above.

# Station "what to cook" menu, suggested from pending orders

With no cook automatically picking the highest-priority ticket (STORY-040), a co-op player
standing at a station needs to know what's actually needed rather than guessing. This adds a
proximity-triggered menu at a station — the same interaction pattern the upgrade terminal already
uses (`GameView.tsx`'s `status?.nearUpgradeTerminal` → `<UpgradeTerminal>`) — listing what can be
cooked there, with items needed by currently pending orders called out.

## Acceptance Criteria

- [x] Standing near a station in a co-op match surfaces a menu of that station's cookable
  tickets/items, following the same `status?.nearX` → conditional-panel pattern `UpgradeTerminal`
  already establishes (a new `nearStation`-style status field, not a rebuilt interaction system).
- [x] Items needed by currently queued tickets at that station (`kitchen.queuedTicketsAt`) are
  visually distinguished from items with no pending demand — sorted first, highlighted, or both;
  a player should be able to tell "the burger table needs a patty" without cross-referencing
  STORY-043's board.
- [x] Selecting an item from the menu is equivalent to the existing `cook`/`plate` interact for
  that station/ticket — no new server-authoritative action type; this is a client affordance over
  the existing `action-validator.js#resolveCookOrPlate` path.
- [x] The menu only appears in co-op mode (or, if useful generally, is at minimum verified not to
  regress the existing single-tap `cook`/`plate` interact prompt for non-co-op matches).

## Notes

- Depends on STORY-040 (co-op mode, no automated cook) and benefits from STORY-041 (timed cooking
  feedback) landing first, though it could technically ship in either order — implementer's call,
  documented if diverged from.
- Cites: `client/src/app/GameView.tsx`'s `nearUpgradeTerminal`/`<UpgradeTerminal>` pattern as the
  direct precedent to follow for a proximity-triggered menu panel.
- Cites: `server/src/game/systems/worker-system.js#compareTickets` — the "what's most needed"
  ranking this story surfaces to a human is the SAME ranking the AI cook already uses (queue-age
  bucket, then patience risk); this story EXTENDS that ranking to a human-facing UI rather than
  inventing a second priority scheme.
