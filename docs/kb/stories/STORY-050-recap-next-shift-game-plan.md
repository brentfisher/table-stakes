---
id: STORY-050
title: Next shift — coaching game plan
status: merged
prd_source: /Users/brent/table-stakes/docs/PRD-recap-screen-redesign.md
branch: story/050-recap-next-shift-game-plan
worktree_path: /Users/brent/table-stakes-worktrees/story-050-recap-next-shift
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/71
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

## Implementation notes

Built `client/src/ui/recap/RecapNextShift.tsx` and wired it into `ResultsPanel.tsx`'s
`category === 'next-shift'` branch. Confirmed every field name used (`managerLedger.constraints[]`
`.id`/`.observedMs`/`.limitingMs`/`.peakScore`/`.evidence`, `.specials[]`, `.labor`) directly
against the current `shared/schemas/messages.d.ts` before using it, per the approach_summary's own
instruction — all matched verbatim, no surprises there.

**Real bugs caught and fixed before the first commit** (all found by re-reading my own draft, not
by any check script):
- `ConstraintEvidence`/`LaborEvidence` both originally put a `<p>`/`<ul>` directly inside a `<dl>`
  — invalid HTML (`<dl>`'s content model only allows `dt`/`dd`, optionally `<div>`-wrapped). Fixed
  by moving the note/breakdown to a sibling under a `<>` fragment in both functions.
- The evidence dialog's outer component (`RecapNextShiftEvidence`) had a leftover broken
  `useState(() => { return null; })` stub from an earlier edit that did nothing — replaced with
  the real `useEffect` Escape-key handler, the same convention `HowToPlay.tsx`/`RecapScorecard.tsx`
  already use.
- A doc comment referenced a nonexistent `evidenceFor` helper (an earlier draft's name for what
  became inline category checks in `RecapNextShiftEvidence`) — reworded before committing.

**Caught in self-review after the first commit** (via an advisor pass — documented here since a
human reviewer should know these were real, not hypothetical, gaps):
- The first commit deleted `RecapPlaceholder.tsx` and its `ResultsPanel.tsx`/`recap-types.ts`/
  `app.css` references as "now-dead code" once all four `RecapCategory` members had explicit
  branches. Reverted in the second commit: this story's actual scope was create `RecapNextShift`,
  wire its branch, add its CSS — not restructure `ResultsPanel.tsx`'s fallback behavior. Keeping
  `RecapPlaceholder` as the trailing `else` is also the more honest default: if a future story adds
  a fifth category without also adding its own branch here, it should hit "coming soon," not
  silently render whatever branch is currently last (which is what my deletion would have caused).
- `prominentIndex`/`gamePlan` were originally local `useState` inside `RecapNextShift.tsx`. Since
  that component only mounts while `category === 'next-shift'` is active, switching to another
  recap tab and back was remounting it and silently wiping a curated game plan — neither
  "refreshing" nor "leaving the results screen," AC5's own two named reset triggers. Fixed by
  lifting both into `ResultsPanel.tsx` (which stays mounted for the whole results screen) and
  passing them down as props; `evidenceIndex` (which dialog is open) stayed local, since that's
  transient view state with nothing worth preserving across a tab switch.
  - Verified this lift can't produce a stale index: `GameClient.ts` sets `matchComplete` exactly
    once per client lifetime (`matchComplete: null` only appears at construction), and
    `GameView.tsx` only mounts `ResultsPanel` while `status?.matchComplete` is truthy — the
    "Rematch" button navigates to `/` rather than resetting `matchComplete` in place, which
    unmounts `ResultsPanel` (and the lifted state with it) entirely. There is no path where a
    second, different `MatchResult` reaches an already-mounted `ResultsPanel`, so
    `nextShiftProminentIndex` can never outlive the `insights` array it indexes into.
  - The evidence dialog was also only reachable from the prominent card, despite a comment on
    `evidenceIndex` already claiming it could be "opened from a LIST row." Added a per-row
    "Evidence" button to make that comment true rather than rewriting it to describe less.
  - Also fixed while in there: `URL.revokeObjectURL(url)` was called synchronously right after
    `link.click()`; deferred it one tick (`setTimeout(..., 0)`) since some browsers (Safari
    especially) start the actual file read asynchronously off the click, and an immediate revoke
    can race and silently kill the download. `.recap-next-shift--empty` was also missing its
    padding rule (compare `.recap-menu-stars--empty`) — added.

**Deliberate reading of an ambiguous AC**: AC1 says arrows are "disabled at either end when
there's only one (or ... hidden entirely with exactly one)." With exactly one insight there is
nothing to cycle to either direction, so I took the AC's own parenthetical and hide the arrows
entirely rather than rendering a permanently-disabled pair — the "disabled at either end" clause
reads as describing the >1-insight wraparound case in general, not a second required treatment for
the single-insight case specifically. With 2+ insights, cycling wraps around (modulo) rather than
clamping at the ends, since a "prominent" slot with nothing to browse in one direction isn't a
real state here — every insight is reachable from every other one by going far enough the same way.

**AC4 (export) verification gap — flag for the PR**: the download path (`Blob` +
`createObjectURL` + a throwaway `<a download>` click) was verified by code review and by
confirming `build:client`/`npm run check` pass with it in place, but the actual `<a download>`
trigger was NOT exercised in a real browser here — this environment's automated browser sandbox is
known not to reliably fire download links (see MEMORY.md's own note on `visibilityState: hidden`
killing rAF-driven checks; download triggers are a similar automation gap). This AC needs a real
manual browser check before merge, not just a green `npm run check`.

**Environment note**: this worktree had no `node_modules` anywhere (client/server/harnesses) —
symlinked each from `/Users/brent/table-stakes`'s own installed copies to run `build:client` and
the full `npm run check` suite, then removed all three symlinks before every commit. Git does not
match a symlink named `node_modules` against the plain `node_modules/` `.gitignore` pattern (that
pattern only matches real directories), so leaving them in place would have shown up as untracked
files rather than being silently ignored.

No new `check-*.mjs` script was added — per this story's own instructions, `build:client`'s
type-checking plus the manual verification above was judged sufficient for a client-only UI story
with no non-trivial grouping/derivation logic to falsify.
