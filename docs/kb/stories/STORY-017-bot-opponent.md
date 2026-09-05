---
id: STORY-017
title: Bot opponent for solo and development play
status: merged
prd_source: /Users/brent/table-stakes/PRD_ Rival Restaurant — Competitive Service Manage.pdf
branch: story/017-bot-opponent
worktree_path: /Users/brent/table-stakes-worktrees/story-017-bot-opponent
base_branch: master
pr_url: https://github.com/brentfisher/table-stakes/pull/19
is_architectural: false
approach_summary: "A new bot-controller module (server/src/game/bot/) acts as a real WebSocket client: it opens a connection like any player, builds a setup_submit weighted toward the active market's preferredTags, and sends it through the normal message router into setup-validator.js unmodified. During service it runs a tick loop issuing interact intents through the same router/validator path, reusing STORY-007's worker priority rules for floor behaviour rather than a second AI. All randomness draws from match.createRngStream('bot') so behaviour is seeded and reproducible. POST /api/dev/match gets a mode flag to spin up one bot-controlled participant instead of a second human socket. Two difficulty levels differ by decision-loop tick rate / thresholds only, not by a different code path. Touches: server/src/http/ (dev/match endpoint), a new server/src/game/bot/ module, and reads (not modifies) shared/game-data market tags and server/src/game/systems/worker-ai.js priority logic."
created: 2026-08-28
updated: 2026-09-04
---

# Bot opponent for solo and development play

PRD §12 lists a bot opponent fallback for solo play and development as part of the initial release,
and §20 puts it in MVP scope. Its real value is upstream of players: it makes every other story
testable without coordinating two humans, and §25 says the prototype "should be tested repeatedly
with two people as early as possible" — a bot is what makes the other 95% of iterations possible.

The bot occupies the rival restaurant slot: it submits a legal setup, then runs its restaurant
during service with plausible-but-beatable behaviour. It must go through the same server-side
validation as a human, not a privileged path.

## Acceptance Criteria

- [ ] A match can be created with one human and one bot via `POST /api/dev/match`, and the human
      client cannot tell from the protocol that the opponent is a bot.
- [ ] The bot submits a `setup_submit` that passes `setup-validator.js` unmodified — it uses the
      same validation path as a human, with **no** bypass or privileged branch.
- [ ] The bot picks a menu and prices with some relation to the active market (e.g. weighted toward
      the market's `preferredTags`) rather than a fixed hardcoded menu.
- [ ] During service the bot issues `interact` intents through the normal message router and
      validator — it does not mutate match state directly.
- [ ] Bot behaviour is seeded from the match seed so a bot match is reproducible.
- [ ] At least two difficulty levels exist, and the easier one is beatable by a competent first-time
      player while the harder one punishes idleness.
- [ ] The bot's restaurant produces a rival summary in the HUD indistinguishable in shape from a
      human rival's.
- [ ] Running a full bot-vs-bot match to completion produces a valid `match_complete` payload —
      this is the fastest available balance-testing harness for STORY-013.

## Notes

- **Depends on STORY-009** (setup validation to submit against) and **STORY-010** (a shared district
  for the bot to compete in). Benefits from **STORY-007** — the bot's floor behaviour can reuse the
  worker priority rules rather than inventing a second AI.
- `conventions.md` **Notable Pattern 1**: the bot is a *client* from the server's point of view.
  Giving it a privileged path would put game logic outside the validator and silently weaken the
  server-authority guarantee everywhere.
- PRD §12 "Mode" (bot opponent fallback), §20 (in MVP scope), §25 (prototype testing).
- Matchmaking, MMR, and ranking are §20 out-of-scope — this is a practice/dev opponent only.
- **OpenSpec:** no prior decisions exist to preserve, revise or supersede — `openspec/changes/` and `openspec/specs/` are present and empty, and `openspec/changes/archive/` does not exist. Not architectural — a new client-shaped participant over existing contracts.
