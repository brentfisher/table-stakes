# coop-no-staff

## ADDED Requirements

### Requirement: A co-op restaurant's staffing roster is empty

`worker-system.js#buildStaff` SHALL produce zero `workers` for a restaurant whose match has
`sharedRestaurant: true`, regardless of what `staffAssignments` its setup submission carries.
`match.brigade.owns*()` SHALL therefore return `false` for every duty (station tending, seating,
order-taking, delivery, payment, table-clearing, restocking) on that restaurant.

#### Scenario: A live co-op restaurant has no workers

- **WHEN** a `sharedRestaurant: true` match reaches the `service` phase
- **THEN** the shared restaurant's `workers` array has length 0, and
  `match.brigade.ownsSeating`/`ownsDelivery`/`ownsOrderTaking`/`ownsPayment`/
  `ownsTableClearing`/`ownsRestocking`/`ownsStation` all return `false` for its restaurant id

#### Scenario: A non-coop restaurant is unaffected

- **WHEN** a plain (non-shared) match reaches `service` with a full staff submission
- **THEN** its restaurant still gets one worker per `restaurant-layout.json` `staff.roster`
  entry, and every `owns*()` question that role covers returns `true`

### Requirement: The setup pipeline treats an empty co-op roster as legal, not incomplete

`buildReadyUpPayload`, `validateSetupSubmission`, and `defaultSubmission` SHALL each accept a
`sharedRestaurant` flag (default `false`). When true, the built/validated/defaulted submission's
`staffAssignments` SHALL be `{}`, and `validateSetupSubmission` SHALL NOT reject the submission
with `worker_unassigned` for any roster member missing a post. When false (or omitted), behavior
is byte-identical to before this change — a full `staffAssignments` is required and
`worker_unassigned` still fires for an incomplete one.

#### Scenario: A co-op submission with no staff assignments is accepted

- **WHEN** `validateSetupSubmission` is called with `staffAssignments: {}` and
  `{sharedRestaurant: true}`
- **THEN** the result is `{ok: true}` with `submission.staffAssignments` equal to `{}`

#### Scenario: The same empty staffAssignments is still illegal outside co-op

- **WHEN** `validateSetupSubmission` is called with `staffAssignments: {}` and no
  `sharedRestaurant` option (or `false`)
- **THEN** the result is `{ok: false, reason: 'worker_unassigned'}`

#### Scenario: An idle co-op player still gets a legal, staff-less default restaurant

- **WHEN** `defaultSubmission({sharedRestaurant: true, ...})` is called for a player who never
  submitted
- **THEN** it returns a legal submission (passes its own internal `validateSetupSubmission`
  check) whose `staffAssignments` is `{}`

### Requirement: Every unstaffed-restaurant fallback is exercised correctly for co-op

For a co-op restaurant, each `match.brigade.owns*() === false` fallback SHALL run exactly as it
does for any other restaurant with no rostered workers: a queued party seats itself; a seated
party moves itself into ordering once the greet timer elapses; a ready plate auto-delivers to
its table after the order-pass hand-off window; a paying party moves itself to leaving once the
payment window elapses, and its vacated table returns to rotation without being marked dirty; an
understocked bin auto-dispatches a restock job.

#### Scenario: A co-op restaurant behaves like any unstaffed restaurant, end to end

- **WHEN** a real co-op `Match` in `service` is driven through each of: a queued party, a seated
  party, a ready order, a paying party, and an understocked pantry bin
- **THEN** each resolves via its no-brigade fallback (seated, ordering, delivered, leaving with
  a clean re-available table, and a new restock job respectively) with no worker ever assigned
  to any of it

### Requirement: The client can tell a match is co-op

`match_snapshot` SHALL carry a top-level, public `sharedRestaurant` boolean (identical for both
co-op seats), straight off `Match#sharedRestaurant`.

#### Scenario: Both co-op seats see the same flag

- **WHEN** either seat of a co-op match receives a `match_snapshot`
- **THEN** `message.sharedRestaurant === true` for both, and `false` for every pre-existing mode

### Requirement: A staff-only upgrade is locked in the terminal with a stated reason

An upgrade whose entire effect is read only by `worker-system.js`'s automated-staff task logic
SHALL render as disabled with an explanatory label ("No staff to upgrade") in `UpgradeTerminal`
when the viewer's restaurant is co-op, rather than being hidden or rendered as a normal
buyable/locked entry. The purchase SHALL remain legal server-side (no new `action-validator.js`
rejection) — this is a UI-communication fix, not a new match-legality rule.

#### Scenario: The terminal explains why a staff-only upgrade cannot help

- **WHEN** a co-op viewer opens the upgrade terminal
- **THEN** `maitre_d_radio_1`'s row shows a disabled button reading "No staff to upgrade"
  instead of a Buy button

#### Scenario: Every other upgrade stays normally purchasable in co-op

- **WHEN** a co-op viewer opens the upgrade terminal
- **THEN** every wired upgrade other than `maitre_d_radio_1` shows its normal
  owned/locked/buyable state, unaffected by `sharedRestaurant`
