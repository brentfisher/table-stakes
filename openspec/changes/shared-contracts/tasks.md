# Tasks — Shared contracts

- [x] `shared/game-data/dishes.json` — the eight PRD §7 MVP dishes plus the single ingredient
      list, with `smash_burger` matching the §16 example field for field
- [x] `shared/game-data/markets.json` — the three §6 MVP markets, with `downtown_lunch`
      matching the §16 example field for field
- [x] `shared/game-data/customer-segments.json` — the five §6 segments, with `office_worker`
      matching the §6 example customer profile value for value
- [x] `shared/game-data/events.json` — all ten §9 MVP events, with `baseball_game_ends`
      matching the §16 example and its effect keys present on every event
- [x] `shared/game-data/upgrades.json` — eleven §10 upgrades including the five the §10 table
      prices explicitly, each with a machine-readable `effects` object
- [x] Widen `shared/schemas/messages.js` + `.d.ts` to the full §12 protocol, renaming nothing
      and leaving `IMPLEMENTED_CLIENT_MESSAGE_TYPES` alone (Decision 7)
- [x] `shared/schemas/game-state.js` + `.d.ts` — snapshot entity shapes and the §8 customer
      state machine including all five exit states
- [x] `shared/schemas/validation.js` + `.d.ts` — one shape validator per client-to-server
      message type, consumable from the plain-JavaScript server (Decision 4)
- [x] `shared/game-data/loader.js` + `.d.ts` — cross-reference integrity and the
      `segmentWeights` sum assertion with a stated, exported tolerance
- [x] `scripts/check-catalogue.mjs` + `npm run check:data`, wired into `npm run check`
- [x] Restore `shared/build/three-cdn-external.ts`, which `.gitignore`'s bare `build/` pattern
      swallowed during STORY-001, and un-ignore `shared/build/`

## Verification

The repo has no test framework (Milestone 0 Decision 8). All of the following were run:

- [x] `node scripts/check-catalogue.mjs` — 37/37, covering the §16 examples surviving verbatim,
      each named integrity failure being caught, the tolerance boundary, the §8 exit states, the
      §12 message examples validating, malformed payloads being rejected, and Decision 7 holding
- [x] `node scripts/check-threejs-pin.mjs` — all checks pass, build output carries no Three.js
- [x] `npm run build:client` and `npm --prefix harnesses run build` — both run `tsc --noEmit`
      over `../shared`, so every new `.d.ts` is type-checked, not merely stripped
- [x] `node src/index.js` from `server/` boots; `node scripts/smoke-milestone0.mjs` — 9/9,
      including its assertion that `purchase_upgrade` still returns `not_implemented`
