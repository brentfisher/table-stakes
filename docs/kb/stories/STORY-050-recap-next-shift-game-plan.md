---
id: STORY-050
title: Next shift — coaching game plan
status: pending
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: null
approach_summary: null
created: 2026-09-11
updated: 2026-09-11
---

# Next shift — coaching game plan

A "Next shift" category (STORY-047's navigation shell) letting a player browse the match's
recorded management takeaways, inspect the evidence behind one, add useful ones to a personal
"game plan," and download that plan as text. This is a client-only, session-local feature — no
server mutation, no new match-affecting state — the player is curating notes for themselves.

Reference: `docs/table-stakes-recap-menu.zip` → `table-stakes-menu-suite/story-screenshots/`
`03-next-shift-coaching.png`, `04-staffing-evidence.png`; `RECAP-PREVIEW.md`'s "Next shift"
bullet. See `docs/PRD-recap-screen-redesign.md` for the full slice and its constraints —
especially: this story must NOT send anything to the server, and must NOT use the prototype's own
demo copy as literal text.

## Acceptance Criteria

- [ ] Every recorded takeaway (`result.managerLedger.insights[]`, real entries only — this array
  can be empty, in which case the section shows the same honest "no additional recommendation"
  state `ResultsPanel.tsx` already has) is browsable as a topic row, with one shown prominently
  (its `observation`/`recommendation` text, per the existing rendering in `ResultsPanel.tsx`'s
  "What to change next match" section) and the rest as a selectable list. Arrow controls cycle
  the prominent one; disabled at either end when there's only one (or the arrows are hidden
  entirely with exactly one) — per `03-next-shift-coaching.png`'s own cue.
- [ ] Selecting/deselecting a takeaway adds/removes it from a "game plan" list, with a visible
  saved/checked state on both the prominent card and its row in the topic list.
- [ ] An "evidence" dialog, opened from a takeaway, shows the REAL supporting data behind that
  specific `insight.category` — e.g. for a labor-driven insight, `managerLedger.labor`'s own
  `laborExpenses`/`hireFees`/`wagesPaid`/`taskCompletions` fields (the exact numbers
  `04-staffing-evidence.png` shows, sourced live, not the mockup's own hardcoded $38/$18/$20
  figures — those are that fixture's specific match, not a template to hardcode). If an insight's
  category has no obviously matching structured evidence elsewhere on `MatchResult`, show the
  insight's own `observation` text as the evidence rather than fabricating a number that isn't on
  the wire.
- [ ] The game plan can be exported/downloaded as a plain text file containing only the
  player's own selected takeaways' real text — no network request, no server round-trip (matches
  the prototype's own "no data is sent to a game server" framing, and this codebase's actual
  browser sandbox has no download-link capability in some automated contexts, so verify this
  works via a real manual browser check, not just a build pass).
- [ ] The game plan selection and any UI state (which takeaway is prominent) persists for the
  page session only (no new persistent storage, no server field) — refreshing/leaving the results
  screen may reset it, matching the prototype's own stated behavior.
- [ ] `npm run check` (including `build:client`) stays green.

## Notes

- Depends on STORY-047 (the category-navigation shell).
- Cites: `client/src/ui/ResultsPanel.tsx`'s existing "What to change next match" section
  (`selfResult.managerLedger.insights`) as the exact, already-correct data source — this story
  restructures its presentation into a browsable, selectable, exportable form; it does not change
  what an insight IS or how it's computed (`manager-ledger-system.js` is untouched).
- The prototype's own evidence-dialog copy ("Redirect your dining-room crew first...") is that
  fixture's own specific recommendation text for its own specific match — the real integration
  shows whatever `insight.recommendation` the LIVE match actually produced, which will usually
  read differently. Don't hardcode the mockup's example sentence anywhere.
