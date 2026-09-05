---
id: STORY-002
title: Shared game data and wire schemas
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/002-shared-game-data-and-schemas
worktree_path: /Users/brent/table-stakes-worktrees/story-002-shared-game-data-and-schemas
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/2
is_architectural: true
approach_summary: "Populate shared/ in full: five game-data JSON files from the PRD §16 worked examples, the wire schemas widened from the messages.js STORY-001 shipped, and a loader that fails loudly on an inconsistent catalogue. Follows the .js + .d.ts pattern (design Decision 4) so the plain-JS server can import them. Branched from the STORY-001 scaffold, not master, since PR #1 has not merged."
created: 2026-08-28
updated: 2026-08-28
---

# Shared game data and wire schemas

PRD §16 requires that all balancing content be JSON or plain data modules rather than hardcoded
in systems, and PRD §12 defines a JSON WebSocket protocol that both applications must agree on.
This story creates `shared/` in full: the five game-data files, the three schema modules, and the
loader/validation used by both sides. It is the contract layer.

This story is the **second serialization point** in the slice. `shared/schemas/messages.ts` is the
file every later story that adds a message type must edit, and `shared/game-data/*.json` is where
every later balance value lands. If a dozen branches are opened against it simultaneously, the
merge conflicts are the same failure this slice's STORY-001 exists to prevent, one layer down. It
should land alone, immediately after STORY-001, before any real fan-out begins.

Scope is the data and its shape, not the systems that consume it. Populate the catalogue with the
PRD's own worked examples so later stories have real content to run against, and define message
types for the whole MVP protocol even where no system sends them yet — a schema with an unused
member is cheap; a schema that has to be reopened by six branches is not.

## Acceptance Criteria

**Game data**

- [ ] `shared/game-data/dishes.json` contains the eight to ten MVP dishes of PRD §7 (Smash
      Burger, Caesar Salad, Pasta Primavera, Chicken Sandwich, Steak Frites, Nachos, Espresso,
      Cheesecake), each with `id`, `name`, `category`, `tags`, `ingredients`, `baseCost`,
      `suggestedPrice`, `stationSteps[]` (`station` + `durationMs`), `baseSatisfaction`, and
      `marketAffinity` — matching the `smash_burger` example in §16 field for field.
- [ ] `shared/game-data/markets.json` contains the three MVP markets (`downtown_lunch`,
      `uptown_pre_theater`, `stadium_district`) with `segmentWeights`, `priceSensitivity`,
      `baseFootTrafficPerMinute`, `preferredTags`, and `eventPool` — matching the
      `downtown_lunch` example in §16.
- [ ] `shared/game-data/customer-segments.json` contains the five §6 segments (`office_worker`,
      `affluent_couple`, `event_fan`, `tourist`, `neighborhood_regular`) with the profile fields
      of the §6 example: `budget`, `patienceSeconds`, `preferredTags`, `dislikedTags`,
      `partySize`, and the four weights (`serviceSpeedWeight`, `priceWeight`, `menuFitWeight`,
      `reputationWeight`).
- [ ] `shared/game-data/events.json` contains at least five §9 MVP events with `warningMs`,
      `durationMs`, and an `effects` object using the §16 `baseball_game_ends` field vocabulary
      (`footTrafficMultiplier`, `segmentWeightOverrides`, `dishTagDemandMultipliers`,
      `partySizeMultiplier`).
- [ ] `shared/game-data/upgrades.json` contains at least five §10 upgrades with `id`, `category`,
      `cost`, `tier`, and a machine-readable `effects` object.
- [ ] Every `id` in every file is `snake_case`, and every duration field is milliseconds with a
      `Ms` suffix.
- [ ] Every `ingredients` key used by a dish is declared in a single ingredient list, and every
      `stationSteps[].station` value refers to a station the §14 layout actually has (`prep`,
      `grill`, `oven`, `plating`).

**Schemas**

- [ ] `shared/schemas/messages.js` (+ `messages.d.ts`) declares typed client-to-server messages `player_input`,
      `interact`, `purchase_upgrade`, `setup_submit` and server-to-client messages
      `match_snapshot`, `event_announce`, `match_complete`, with the exact field names of the §12
      JSON examples (including `sequence`, `serverTime`, `matchPhase`, `timeRemainingMs`).
- [ ] `shared/schemas/game-state.d.ts` (with any runtime enums in `game-state.js`) declares the snapshot entity shapes (`restaurants`,
      `customers`, `orders`, `players`) and the customer state enum of §8, including the exit
      states `CHOOSE_RIVAL`, `LEAVE_DISTRICT`, `ABANDON_QUEUE`, `CANCEL_ORDER`, `LEAVE_ANGRY`.
- [ ] `shared/schemas/validation.js` (+ `.d.ts`) exports a validator per client-to-server message type that
      rejects unknown `type` values and malformed payloads, and is consumable from **plain
      JavaScript** on the server (the server is not TypeScript — ship a `.d.ts` alongside a `.js`
      build, or keep validation in `.js` with types declared separately; do not force the server
      to compile TypeScript).
- [ ] `shared/constants/tuning.js` holds the pinned Three.js version constant introduced by
      STORY-001 plus the §12 tick and broadcast rates and the §5 phase durations.

**Loading and integrity**

- [ ] A loader module reads the JSON at startup and fails loudly on a malformed or
      internally-inconsistent catalogue (unknown ingredient, unknown station, unknown segment id
      in a market's `segmentWeights`, unknown event id in a market's `eventPool`).
- [ ] Each market's `segmentWeights` values sum to 1.0 within a stated tolerance, and the loader
      asserts it.
- [ ] Running the loader against the shipped catalogue reports zero errors (demonstrable with a
      scratch script — the repo has no test framework).

## Notes

- **Depends on STORY-001** (repo layout and `shared/constants/tuning.ts` must exist).
  **Land this second, alone.** Fifteen of the remaining stories consume `shared/`, and this story
  owns `messages.ts` — the single file most likely to be edited by every parallel branch. Kicking
  off fan-out before this lands reproduces STORY-001's conflict problem at the schema layer.
- `conventions.md` **Notable Pattern** on data-driven content, and "File / Module Organization":
  balance content is JSON under `shared/game-data/`, never hardcoded in systems. A later story
  that inlines a dish or a market weight is violating this file.
- `conventions.md` "Naming": data ids and message `type` values are `snake_case`; durations carry
  a `Ms` suffix; `patienceSeconds` is the deliberate seconds-named exception.
- `conventions.md` "Code Style": the server is plain JavaScript. This is why the validation module
  needs a JS-consumable form — it is the one schema file both a TS client and a JS server import.
- `key-files.md` names `shared/schemas/messages.*` and `shared/constants/tuning.*` as files most
  stories will touch.
- **Follow the `.js` + `.d.ts` pattern STORY-001 established** — see
  `openspec/changes/milestone-0-repo-scaffold/design.md` **Decision 4**, which this story
  *extends* to the rest of `shared/`. Do not convert these to `.ts`: the server imports them
  and must not compile TypeScript. STORY-001 already shipped `messages.js` + `messages.d.ts`
  declaring the full MVP message vocabulary and an `IMPLEMENTED_CLIENT_MESSAGE_TYPES` list —
  this story widens that list rather than renaming anything (**Decision 7**).
- PRD §16 gives literal JSON examples for a market, a dish, and an event — follow their field
  names exactly rather than inventing equivalents, because later stories' criteria cite them.
- **OpenSpec:** no prior decisions exist (`changes/` and `specs/` present and empty,
  `changes/archive/` absent), so this story preserves, revises and supersedes nothing. It is
  architectural — the wire protocol and the data schema are public contracts — and should record
  an OpenSpec change describing the message envelope and the catalogue shape.
