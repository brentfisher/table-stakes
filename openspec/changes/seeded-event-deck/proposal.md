# Seeded event deck and event system

## Why

PRD §9 asks for events every 30–60 seconds during service, and then immediately constrains how
they may be chosen: "the event system should use a seeded event deck rather than fully
unconstrained randomness … each match receives the same event timeline for both players. Events
may affect players asymmetrically only because their menus, prices, upgrades, and current
restaurant states differ."

That second sentence is the reason this story exists at all. Without it, a match is decided by
whose district happened to get the ball game — a coin flip dressed as a contest. With it, an
event is a shared question both players answer at the same moment with different menus, and the
answer is the game. It is also what makes replay, balance testing and the §7 setup forecast
possible: none of them can exist over free randomness.

STORY-002 shipped the ten §9 events with their §16 effects, and STORY-003 shipped the seeded
match, the phase clock and the system-registration seam. Nothing read any of it. This change is
the reader.

This corresponds to STORY-011 in the slicing pass.

## What changes

- **`server/src/game/systems/event-system.js`**, registered in the pre-assigned slot in
  `systems/index.js`. It builds the timeline from `match.createRngStream('events')` and the
  active market's `eventPool`, runs the §9 announcement flow, and publishes the resolved
  effects onto match state every tick.
- **A service-relative timeline, anchored at the `service` transition.** Offsets are fixed at
  build time; the absolute clock coordinate is not knowable earlier because setup ends on
  readiness (Decision 20).
- **The §9 announcement flow**: a teaser `warningMs` ahead where the data says one is
  appropriate, an `event_announce` carrying the §12 envelope with the countdown in
  `startsInMs`, activation, effect, and an `ended` entry that lingers briefly.
- **Two new public snapshot fields**: `events[]` (the §12 `{eventId, state, startsInMs}`
  entries, which `match.js` previously hardcoded to `[]`) and `eventForecast[]` (PRD §7's
  "initial event forecast, if any", which names what can happen and never when).
- **`match.eventEffects`**, the seam STORY-004, -005, -008, -010, -013 and -015 read. Every
  key present with a neutral value at all times, derived from `events.json` rather than
  declared in code.
- **Event constants in `shared/constants/tuning.js`** — cadence bounds, the tail margin, the
  high-impact threshold and cap, the teaser-lead bounds, and PRD §24's demand band.
- **`scripts/check-events.mjs`** (33 checks) wired into `npm run check`.

## Non-goals

**No consumer of the effects.** Nothing arrives, orders, breaks or scores differently yet.
This change publishes `match.eventEffects`; STORY-004's arrival rate, STORY-010's choice model,
STORY-005/007's restock, STORY-008's station repair and STORY-013's reputation reward are the
readers, and each lands with its own story.

**No HUD event banner.** The client renders nothing new. The banner PRD §9 sketches
("BASEBALL GAME ENDS IN 20 SECONDS") is STORY-015, and it has everything it needs in the
snapshot and in `event_announce`.

**No event-visualization harness.** STORY-020.

**No `power_fluctuation` repair interaction.** This change publishes
`stationSpeedMultipliers` onto match state; the station-failure and repair loop that reads it
is STORY-008.

**No new content.** `events.json` is unchanged — all ten §9 events were authored by STORY-002
and every one of them fires.
