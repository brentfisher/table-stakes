---
type: Key Files
title: Key Files — table-stakes
description: Entry points and load-bearing files a story-implementing agent will most likely need to read or touch, plus the two hazards that have already cost real work.
generated: { by: kb-generate/claude-sonnet-5, at: 2026-09-13T20:30:00Z }
sources:
  - id: crawl
    resource: git@github.com:brentfisher/table-stakes.git
    title: "table-stakes @ 05aa5f5eb44ccbf452581766d20bfe080a11e8f8"
---

# Key Files — table-stakes

| Path | Why it matters |
|---|---|
| `server/src/game/simulation-loop.js` | The `registerSystem` seam. Read its block header before adding gameplay — it is what keeps `match.js` free of game logic. |
| `server/src/game/systems/index.js` | The ordered registration list — 15 systems in three tiers (core simulation, operations/management, meta). Order is a contract; a new system states why it sits where it does. |
| `server/src/game/match.js` | Phase clock and the **per-viewer** snapshot (717 lines, still zero gameplay). `you` is the private slice — the reason an opponent's menu cannot leak. Adding a public array here is almost never necessary; it already serializes `<field> ?? []`. |
| `shared/constants/tuning.js` | Every tunable number and `THREE_VERSION`, ~1,300 lines in named blocks by story. Any inline constant in a system is a defect. |
| `shared/schemas/messages.js` | The wire vocabulary plus `IMPLEMENTED_CLIENT_MESSAGE_TYPES` — add a type there **only** when a handler exists, or it silently no-ops. |
| `shared/schemas/setup-rules.js` | Shared by client and server: price bands, producibility, the six §7 labels. Guidance returns label strings with no numeric field. |
| `shared/game-data/loader.js` | Strict catalogue validation at boot across 13 JSON tables. Adding data means keeping it internally consistent. |
| `server/src/game/systems/customer-system.js` | The largest module (1,824 lines): arrivals, the district softmax choice, the §8 lifecycle, satisfaction. `resolveEvaluateRestaurants` is the choice model. |
| `server/src/game/systems/order-system.js` | The kitchen (1,284 lines). Exposes the `match.kitchen` facade (`placeOrder`/`pollDelivery`/`queueDepth`/…) that other systems use instead of reaching in. `toPublicOrderSnapshot` is the **only** function allowed to shape `match.orders`. |
| `server/src/game/systems/worker-system.js` | The cook/server AI (1,041 lines) implementing PRD §17's priority rules — near-completion protection, ticket-urgency buckets, patience tie-breaks, the pantry-trip decision. |
| `server/src/game/bot/bot-socket.js` | Drives the bot opponent through a real WebSocket connection — no special-cased bot path anywhere else in the server. |
| `server/src/game/scoring/score-formula.js` + `narrative.js` | The scoring math and its human-readable explanation, shared by the results screen and the recap flow. |
| `client/src/scenes/RestaurantScene.ts` | The scene graph (~2,800 lines), now compositing the adapted Copper & Thyme GLB. See `copper-and-thyme-integration.md`. |
| `client/src/game/GameClient.ts` | The client-side hub (~1,380 lines): snapshot handling, derived UI state, the status callback React and the audio layer both subscribe to. |
| `scripts/check-*.mjs` | The actual test suite — 34 checks + 5 smokes. A new system's check **must register the other systems it interacts with** — see below. |
| `scripts/check-threejs-pin.mjs` | Enforces the one pass/fail technical criterion in PRD §22. |
| `scripts/measure-district-crowd-density.mjs` | Measures real district-choice numbers from a live seeded `Match` rather than deriving them — the "measure, don't assert" testing rule made concrete. |
| `client/index.html`, `harnesses/index.html` | Carry the pinned import map. Both must match `THREE_VERSION`. |
| `PRD_ Rival Restaurant — Competitive Service Manage.pdf` | Source of truth. **No `pdftotext`/`pypdf`/`pymupdf` on this machine** — extract with a Swift PDFKit script via `/usr/bin/swift`. Filename contains an em dash; quote it. |

## Two hazards that have already cost real work

**1. Per-system checks hide broken seams.** `event-system.js` published `match.eventEffects`
while `customer-system.js` read `match.activeEventEffects`. Events moved demand by 0% for
three merges. Every suite passed, because each check registered only its own story's systems.
**A check must register every system it integrates with.**

**2. A check that cannot fail reads as coverage.** Three checks on this project passed against
deliberately broken code — one asserted through the producer's raw field instead of the
consumer's read path; another covered a fix that could be deleted with all 44 assertions still
green. **Falsify a new check by breaking the code it covers before trusting it.**
