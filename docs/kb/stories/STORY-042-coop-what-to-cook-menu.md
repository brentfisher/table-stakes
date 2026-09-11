---
id: STORY-042
title: Station "what to cook" menu, suggested from pending orders
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

# Station "what to cook" menu, suggested from pending orders

With no cook automatically picking the highest-priority ticket (STORY-040), a co-op player
standing at a station needs to know what's actually needed rather than guessing. This adds a
proximity-triggered menu at a station — the same interaction pattern the upgrade terminal already
uses (`GameView.tsx`'s `status?.nearUpgradeTerminal` → `<UpgradeTerminal>`) — listing what can be
cooked there, with items needed by currently pending orders called out.

## Acceptance Criteria

- [ ] Standing near a station in a co-op match surfaces a menu of that station's cookable
  tickets/items, following the same `status?.nearX` → conditional-panel pattern `UpgradeTerminal`
  already establishes (a new `nearStation`-style status field, not a rebuilt interaction system).
- [ ] Items needed by currently queued tickets at that station (`kitchen.queuedTicketsAt`) are
  visually distinguished from items with no pending demand — sorted first, highlighted, or both;
  a player should be able to tell "the burger table needs a patty" without cross-referencing
  STORY-043's board.
- [ ] Selecting an item from the menu is equivalent to the existing `cook`/`plate` interact for
  that station/ticket — no new server-authoritative action type; this is a client affordance over
  the existing `action-validator.js#resolveCookOrPlate` path.
- [ ] The menu only appears in co-op mode (or, if useful generally, is at minimum verified not to
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
