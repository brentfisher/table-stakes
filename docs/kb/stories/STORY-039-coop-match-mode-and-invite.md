---
id: STORY-039
title: Co-op match mode and invite entry point
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

# Co-op match mode and invite entry point

Today every match is competitive: two owners (human or bot), each running their own restaurant,
drawing from one shared district (`server/src/game/systems/customer-system.js`'s district-choice
model). This story adds a **co-op** match mode where two players run **one shared restaurant**
together, with a menu entry and invite flow to start one.

This is the foundation story for the whole co-op slice (STORY-040 through STORY-043 build on it)
and should land first. It does NOT need to build the no-staff kitchen rework, the timed-cooking
UI, or the kitchen queue board — those are later stories. This story's job is: a co-op match
exists, has exactly one restaurant, and two players can get into it together.

`http/routes.js` already has a working precedent for a distinct match mode with its own invite
flow: `mode: 'private_human'` (`POST /api/rooms`, invite token generation, `joinUrl` building via
`inviteHost()`) and `mode: 'solo_bot'` (STORY-025's menu-flow room). A co-op mode is a new `mode`
value using the same invite-link plumbing — not a rebuilt invite system.

## Acceptance Criteria

- [ ] A new `mode` value (e.g. `'coop'`) is accepted by `POST /api/rooms`, alongside the existing
  `'private_human'`/`'solo_bot'`/dev modes, reusing the same invite-token/`joinUrl` generation
  `inviteHost()`/`firstLanIPv4()` already provide.
- [ ] A co-op room seats exactly two players into the SAME restaurant, not one restaurant per
  player. `match.restaurants`/`match_snapshot.restaurants[]` reflects one restaurant, not two.
- [ ] There is no bot opponent and no rival restaurant in a co-op match — the district-choice
  model (`customer-system.js`) either draws every party toward the single restaurant, or is
  bypassed in a way that still produces real, playable customer flow (implementer's call —
  document which, and why, in this story's own follow-up notes for STORY-040+).
- [ ] The client main menu (`client/src/app/` — wherever "Play vs Bot"/"Invite a friend" currently
  live) gets a new entry to start a co-op match and share its invite link, following the same UX
  pattern as the existing private-human invite flow.
- [ ] `scripts/check-invite-lobby.mjs`-style coverage (real `Match`es, no client) proves: a co-op
  room's invite token gates joining, both seats land in the same restaurant, and `npm run check`
  stays green.

## Notes

- Depends on nothing landing first; STORY-040/041/042/043 all depend on THIS story.
- Cites: `openspec/changes/private-invite-lobby/` — this story EXTENDS that decision (a new mode
  value on the same invite mechanism), it does not revise how invites/tokens work.
- Cites: `openspec/changes/shared-district-choice/proposal.md` — a co-op match's single-restaurant
  district behavior needs an explicit call (see AC3) on whether/how that model applies with only
  one restaurant in the pool; this story PRESERVES the choice model's math but must decide its
  co-op-mode boundary condition rather than silently leaving it undefined.
- Scoring/win-condition for co-op (a cooperative target vs. the existing competitive scoring in
  `scoring-system.js`) is explicitly OUT of this story's scope — note it as an open question for
  whoever picks this up, but don't block on solving it; a co-op match can ship with the existing
  scoring simply computed for the one restaurant.
