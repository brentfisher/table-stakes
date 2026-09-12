## Purpose

Fills the dark, empty gap between a match entering the `results` phase and `match_complete`
actually arriving — previously 20-30 seconds of nothing on screen even though the server has
already computed the final result — with a progressively-building teaser drawn from the
viewer's own already-computed result, and shortens that wait now that dead time is no longer
needed to withhold the outcome.

## ADDED Requirements

### Requirement: The viewer's own result is published as soon as it exists, never the rival's

`Match#toSnapshot`'s `you` block SHALL carry `resultsPreview`, the calling viewer's own
`MatchResult` slice of `match.finalResults.results`, available on the snapshot from the moment
scoring populates `match.finalResults` (the `results`-phase transition), and `null` before that
and for a match that never reaches scoring. `resultsPreview` SHALL NEVER equal, contain, or be
derived from the other restaurant's own result, and SHALL NEVER carry `winnerPlayerId`,
`decidingSegment`, `turningPoints`, or `tieBreakDecided` — none of `match.finalResults`'s
match-wide fields.

#### Scenario: Null before scoring has run

- **WHEN** a viewer requests a snapshot before the match has entered `results`
- **THEN** `you.resultsPreview` is `null`

#### Scenario: Populated the instant scoring runs, from this viewer's own restaurant only

- **WHEN** `scoring-system.js#onPhaseChange` has populated `match.finalResults` for a match with
  two distinct restaurants
- **THEN** each viewer's own `you.resultsPreview` equals `match.finalResults.results` keyed by
  THAT viewer's own restaurant id, and differs from the other viewer's own `resultsPreview`
  whenever the two restaurants' results differ

#### Scenario: Never the rival's, never a match-wide field

- **WHEN** `you.resultsPreview` is non-null
- **THEN** it contains none of `winnerPlayerId`, `decidingSegment`, `turningPoints`,
  `tieBreakDecided`, and its values match only the calling viewer's own restaurant, never the
  other restaurant's

#### Scenario: Disconnect-triggered end never populates it

- **WHEN** a match ends via a reason other than normal completion, before scoring's
  `results`-transition handler has ever run
- **THEN** `you.resultsPreview` is `null` on every snapshot for that match, and `match_complete`
  arrives immediately regardless

#### Scenario: Never published at the snapshot's top level

- **WHEN** a `match_snapshot` is built for any viewer
- **THEN** `resultsPreview` appears only under `you`, never as a top-level key of the snapshot

### Requirement: A progressive teaser renders the viewer's own result before any outcome is declared

While `matchPhase === 'results'`, `matchComplete` has not yet arrived, and `resultsPreview` is
non-null, the client SHALL render a teaser showing a building sequence of facts drawn from the
viewer's own `resultsPreview`, with no win/loss/draw heading or other outcome-revealing content
anywhere in it. This teaser and the full recap (rendered once `matchComplete` arrives) SHALL
never both be mounted at the same time.

#### Scenario: Teaser shows before the full recap, from the viewer's own data only

- **WHEN** `matchPhase` is `'results'`, `matchComplete` is not yet present, and `resultsPreview`
  is non-null
- **THEN** the teaser is mounted and shows facts sourced from `resultsPreview`, with no
  win/loss/draw heading present anywhere in it

#### Scenario: The teaser and the full recap are mutually exclusive

- **WHEN** `matchComplete` becomes truthy
- **THEN** the teaser is no longer mounted, and the full recap is

### Requirement: The final score tallies up as part of the tease, gated by the shared motion convention

The teaser SHALL animate the viewer's own final score counting up to its real value once every
preceding fact in the sequence has appeared, using the same shared motion convention every other
recap animation in this codebase uses. When that convention reports motion disabled, the score
SHALL show its final value immediately, with no count-up animation. This tally SHALL exist only
in the teaser — no other recap component gains a count-up animation as part of this change.

#### Scenario: The score counts up when motion is enabled

- **WHEN** the teaser's score section becomes visible and the shared motion convention reports
  motion enabled
- **THEN** the displayed score animates from a starting value toward the real final score before
  settling on it

#### Scenario: The score shows its final value immediately when motion is disabled

- **WHEN** the shared motion convention reports motion disabled
- **THEN** the teaser's score section shows the real final score immediately, with no
  intermediate animated values ever rendered

#### Scenario: The full recap's own score card never gains a tally

- **WHEN** the full recap (`ResultsPanel` and its category sections) renders its own score
  comparison
- **THEN** that score value never animates from zero — it is the real final score at every render

### Requirement: The results-phase wait is measurably shorter than before

The configured duration of the `results` phase for the game-facing presets (`prototype` and
`full`) SHALL be shorter than their pre-change values (20s and 30s respectively), long enough
for the teaser's own fact-and-tally sequence to complete and remain readable for a few seconds
before `match_complete` arrives, and no longer. The script-only `smoke` preset's `results`
duration SHALL remain unchanged. Shortening this duration SHALL NOT reduce how long the full
recap stays on screen once `match_complete` has arrived.

#### Scenario: The prototype and full presets are shorter than before

- **WHEN** the `prototype` or `full` phase-duration preset's `results` value is read
- **THEN** it is shorter than its pre-change value (20s for `prototype`, 30s for `full`)

#### Scenario: The smoke preset is untouched

- **WHEN** the `smoke` phase-duration preset's `results` value is read
- **THEN** it equals its pre-change value (1.2s)

#### Scenario: Reading the full recap is not time-boxed by this duration

- **WHEN** `match_complete` has arrived and the full recap is mounted
- **THEN** nothing tears it down on a timer tied to the `results`-phase duration; it stays
  mounted for as long as `matchComplete` stays truthy
