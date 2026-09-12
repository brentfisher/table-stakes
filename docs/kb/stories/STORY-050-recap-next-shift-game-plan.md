---
id: STORY-050
title: Next shift — coaching game plan
status: pending
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: null
worktree_path: null
base_branch: null
pr_url: null
is_architectural: false
approach_summary: >
  CORRECTION to this story's own Notes: `ResultsPanel.tsx`'s "What to change next match" section
  no longer exists there — STORY-047 already moved lead-insight rendering into
  `client/src/ui/recap/RecapHighlights.tsx` (`result.managerLedger.insights[0]`, with the exact
  "No tracked management decision produced enough evidence..." empty-state string this story must
  reuse verbatim). Build `client/src/ui/recap/RecapNextShift.tsx`, wired into `ResultsPanel.tsx`'s
  `category === 'next-shift'` branch (currently falls to `RecapPlaceholder`, alongside STORY-049's
  still-unmerged 'numbers' branch — no real conflict, just an ordinary two-branch merge later).
  Insights array comes from `result.managerLedger.insights` (`category: ManagerConstraintId |
  'specials' | 'labor'`); one item is "prominent" (session `useState` index, arrow-cycled,
  disabled/hidden at length<=1 per AC); a session-only `Set<number>` (index into the array) is the
  "game plan" selection, toggled per row/card. Evidence dialog follows `HowToPlay.tsx`'s existing
  modal convention (`role="dialog"`, `aria-modal`, Escape + backdrop-click close, already reused
  by STORY-049's now-branch-only `RecapScorecard.tsx`) and maps `insight.category` to REAL
  structured data already on `manager-ledger-system.js`'s output: the four `ManagerConstraintId`
  values (`demand_conversion`/`seating_service`/`production`/`inventory`/`prioritization`) look up
  their own entry in `managerLedger.constraints[]` by `.id`; `'specials'` maps to
  `managerLedger.specials[]`; `'labor'` maps to `managerLedger.labor` (`laborExpenses`/
  `hireFees`/`wagesPaid`/`taskCompletions`/`taskCompletionsByKind` — exactly what the AC names).
  Every category has real structured evidence today, so the "fall back to the insight's own
  observation text" branch in the AC is a defensive default, not the common path — don't skip
  implementing it anyway. Export/download is a NEW pattern for this codebase (no existing
  `Blob`/`createObjectURL`/`<a download>` precedent) — plain client-side text-file construction
  from only the selected insights' real `observation`/`recommendation` strings, no network call;
  flag in the PR that this needs a real manual browser check (this environment's automated
  browser sandbox is known not to reliably exercise `<a download>` triggers) rather than trusting
  `npm run check` alone for that one AC. No new shared/server module, no wire-schema change, no
  persistent storage — plain client-only React state consuming an already-published field
  verbatim, hence `is_architectural: false`.
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
