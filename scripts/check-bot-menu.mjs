#!/usr/bin/env node
// "Play vs Bot" menu-flow check — STORY-025's acceptance criteria, in process.
//
// STORY-017's own bot decision-making, RNG-reproducibility and balance properties are already
// owned by `scripts/check-bot.mjs` and are NOT re-tested here (this story does not touch
// `bot-controller.js`'s decision logic). This script owns everything STORY-025 itself ADDS:
//
//   1. The three new player-facing profiles (`balanced`/`fast_service`/`premium`) are REAL,
//      distinct `BOT_DIFFICULTIES` members with their own tuning — not three display names for
//      one underlying value (see `shared/constants/tuning.js`'s own STORY-025 comment on why
//      that distinction matters), while `easy`/`hard`/`BOT_DEFAULT_DIFFICULTY` stay
//      byte-identical to what STORY-017 shipped.
//   2. `matchManager.createRoom({marketId})` — the "market scenario" picker's server hook —
//      honors a real catalogue id and falls back cleanly for an unknown one, without disturbing
//      the seeded RNG draw order any existing match relies on.
//   3. `matchManager.buildSnapshot()` merges a room's bot roster into the wire snapshot ONLY for
//      a `mode: 'solo_bot'` room — this is the one that would silently break STORY-017 AC1 (a
//      bare `POST /dev/match` bot room must never carry a bot marker over the wire — see
//      `smoke-bot.mjs`'s own comment) if it were not gated, so that gate is asserted directly
//      here, not just implied by the wrapper's own doc comment.
//   4. The abandonment lifecycle: a human disconnecting from a `solo_bot` match past grace ends
//      it with `player_disconnected`, exactly like an abandoned human-vs-human match — driven
//      with synthetic `dtMs` stepping (`check-match-lifecycle.mjs`'s own technique) so this does
//      not cost 30 real seconds.
//
// WHAT THIS SCRIPT DOES NOT COVER: the actual `POST /api/rooms {mode:'solo_bot'}` HTTP+WS wire
// contract, and a human joining as the SECOND seat over a real socket — that is
// `scripts/smoke-bot-menu.mjs`, in the style of `smoke-bot.mjs`/`smoke-invite-lobby.mjs`.
//
// Run: node scripts/check-bot-menu.mjs

import * as matchManager from '../server/src/game/match-manager.js';
import { attachBot, normalizeBotDifficulty } from '../server/src/game/bot/bot-controller.js';
import { stepRoom } from '../server/src/game/simulation-loop.js';
import { catalogue } from '../server/src/game/catalogue.js';
import {
  BOT_DIFFICULTIES,
  BOT_DEFAULT_DIFFICULTY,
  BOT_DECISION_INTERVAL_MS,
  BOT_MISTAKE_PROBABILITY,
  BOT_SPRINT_ENABLED,
  RECONNECT_GRACE_MS,
} from '../shared/constants/tuning.js';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const realLog = console.log;
function quiet(fn) {
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = realLog;
  }
}

const TICK_MS = 50;

console.log('Play vs Bot menu-flow check\n');

// --- 1. normalizeBotDifficulty: the one gate, unchanged for STORY-017's two, widened for the
//        three STORY-025 profiles, and still a safe fallback for garbage ------------------------
{
  check(
    'STORY-017\'s two difficulties still normalize to themselves',
    normalizeBotDifficulty('easy') === 'easy' && normalizeBotDifficulty('hard') === 'hard',
  );
  check(
    'the three STORY-025 profiles normalize to themselves (no parallel enum rejecting them)',
    normalizeBotDifficulty('balanced') === 'balanced' &&
      normalizeBotDifficulty('fast_service') === 'fast_service' &&
      normalizeBotDifficulty('premium') === 'premium',
  );
  check(
    'an unknown difficulty string still falls back to BOT_DEFAULT_DIFFICULTY',
    normalizeBotDifficulty('nonsense') === BOT_DEFAULT_DIFFICULTY &&
      normalizeBotDifficulty(undefined) === BOT_DEFAULT_DIFFICULTY,
  );
  check(
    'BOT_DIFFICULTIES has exactly the five expected members, in append order',
    JSON.stringify(BOT_DIFFICULTIES) === JSON.stringify(['easy', 'hard', 'balanced', 'fast_service', 'premium']),
    JSON.stringify(BOT_DIFFICULTIES),
  );
}

// --- 2. STORY-017's own two profiles are byte-identical to what it shipped ------------------
{
  check(
    'easy/hard tuning is untouched by this story',
    BOT_DECISION_INTERVAL_MS.easy === 900 &&
      BOT_DECISION_INTERVAL_MS.hard === 220 &&
      BOT_MISTAKE_PROBABILITY.easy === 0.35 &&
      BOT_MISTAKE_PROBABILITY.hard === 0.05 &&
      BOT_SPRINT_ENABLED.easy === false &&
      BOT_SPRINT_ENABLED.hard === true &&
      BOT_DEFAULT_DIFFICULTY === 'easy',
  );
}

// --- 3. the three new profiles are REAL, distinct tuning — not `hard` wearing three labels --
{
  const profiles = ['balanced', 'fast_service', 'premium'];
  const intervalValues = new Set(profiles.map((p) => BOT_DECISION_INTERVAL_MS[p]));
  const mistakeValues = new Set(profiles.map((p) => BOT_MISTAKE_PROBABILITY[p]));
  check(
    'balanced/fast_service/premium each have their OWN BOT_DECISION_INTERVAL_MS value',
    intervalValues.size === 3,
    JSON.stringify(profiles.map((p) => BOT_DECISION_INTERVAL_MS[p])),
  );
  check(
    'balanced/fast_service/premium each have their OWN BOT_MISTAKE_PROBABILITY value',
    mistakeValues.size === 3,
    JSON.stringify(profiles.map((p) => BOT_MISTAKE_PROBABILITY[p])),
  );
  check(
    'none of the three profiles is simply `hard` under a different name (at least one knob differs each)',
    profiles.every(
      (p) => BOT_DECISION_INTERVAL_MS[p] !== BOT_DECISION_INTERVAL_MS.hard || BOT_MISTAKE_PROBABILITY[p] !== BOT_MISTAKE_PROBABILITY.hard,
    ),
  );
}

// --- 4. matchManager.createRoom({marketId}) — the "market scenario" picker's server hook -----
{
  const seed = 'bot-menu-market-1';
  const natural = quiet(() => matchManager.createRoom({ seed }));
  const otherMarket = catalogue.markets.find((m) => m.id !== natural.match.config.marketId);
  check('the harness has at least two catalogue markets to distinguish', Boolean(otherMarket));

  const overridden = quiet(() => matchManager.createRoom({ seed, marketId: otherMarket.id }));
  check(
    'an explicit valid marketId is honored instead of the seed-drawn market',
    overridden.match.config.marketId === otherMarket.id,
    `natural=${natural.match.config.marketId} override=${overridden.match.config.marketId}`,
  );
  check(
    'the RNG draw order is unchanged by the override — spawnJitter matches the undecorated call',
    overridden.match.config.spawnJitter === natural.match.config.spawnJitter,
    `natural=${natural.match.config.spawnJitter} overridden=${overridden.match.config.spawnJitter}`,
  );

  const bogus = quiet(() => matchManager.createRoom({ seed, marketId: 'not-a-real-market-id' }));
  check(
    'an unknown marketId falls back to the seed-drawn market rather than throwing',
    bogus.match.config.marketId === natural.match.config.marketId,
    bogus.match.config.marketId,
  );
}

// --- 5. matchManager.buildSnapshot gates `bots` on mode: 'solo_bot' — STORY-017 AC1's own ----
//        "never reaches a WebSocket message" guarantee for a bare dev/bot room ----------------
{
  const devRoom = quiet(() => matchManager.createRoom({ seed: 'bot-menu-dev', requiredPlayers: 2 }));
  const devBot = attachBot(devRoom, { difficulty: 'hard' });
  const devSnapshot = matchManager.buildSnapshot(devRoom, devBot.playerId);
  check(
    'a bare dev/bot room (mode "dev") snapshot carries NO `bots` key at all — unchanged from before this story',
    !('bots' in devSnapshot),
    JSON.stringify(Object.keys(devSnapshot)),
  );

  const soloRoom = quiet(() =>
    matchManager.createRoom({ seed: 'bot-menu-solo', mode: 'solo_bot', requiredPlayers: 2 }),
  );
  const soloBot = attachBot(soloRoom, { difficulty: 'premium' });
  const soloSnapshot = matchManager.buildSnapshot(soloRoom, soloBot.playerId);
  check(
    'a solo_bot room snapshot DOES carry `bots`, naming the real seat and profile',
    Array.isArray(soloSnapshot.bots) &&
      soloSnapshot.bots.length === 1 &&
      soloSnapshot.bots[0].playerId === soloBot.playerId &&
      soloSnapshot.bots[0].difficulty === 'premium',
    JSON.stringify(soloSnapshot.bots),
  );

  const soloViewerA = matchManager.buildSnapshot(soloRoom, soloBot.playerId);
  const soloViewerB = matchManager.buildSnapshot(soloRoom, 'someone_else');
  check(
    '`bots` is public and identical for every viewer, same as every other top-level snapshot field',
    JSON.stringify(soloViewerA.bots) === JSON.stringify(soloViewerB.bots),
  );
}

// --- 6. abandonment lifecycle — a human dropping a solo_bot match past grace ends it exactly
//        the way an abandoned human-vs-human match already does (synthetic-stepped, no 30s wait)
{
  const room = quiet(() =>
    matchManager.createRoom({ seed: 'bot-menu-abandon', phasePreset: 'prototype', mode: 'solo_bot', requiredPlayers: 2 }),
  );
  const humanJoin = room.match.join({ fallbackPlayerId: 'human_probe' });
  room.match.setReady('human_probe', true);
  const bot = attachBot(room, { difficulty: 'balanced' });

  quiet(() => {
    for (let i = 0; i < 40 && room.match.phase === 'lobby'; i += 1) stepRoom(room, TICK_MS);
  });
  check(
    'the bot readies itself and the match leaves lobby, same as it would for POST /dev/match',
    humanJoin.ok && room.match.phase !== 'lobby' && !room.match.ended,
    `phase=${room.match.phase} botPlayerId=${bot.playerId}`,
  );

  // The human's socket drops. This is the EXACT call `connection-manager.js#unregister` makes
  // on a real close — nothing bot-specific about it, which is the whole point being asserted.
  room.match.removePlayer('human_probe');
  check(
    'the human is marked disconnected; the bot\'s own seat is untouched',
    room.match.players.get('human_probe')?.connected === false &&
      room.match.players.get(bot.playerId)?.connected === true,
  );

  const graceSteps = Math.ceil((RECONNECT_GRACE_MS + 2_000) / TICK_MS);
  quiet(() => {
    for (let i = 0; i < graceSteps && !room.match.ended; i += 1) stepRoom(room, TICK_MS);
  });
  check(
    'past the reconnect grace window, the match ends with player_disconnected — same reason an abandoned human match ends with',
    room.match.ended && room.match.endReason === 'player_disconnected' && room.match.endedPlayerId === 'human_probe',
    `ended=${room.match.ended} reason=${room.match.endReason} disconnectedPlayerId=${room.match.endedPlayerId}`,
  );

  const finalSnapshot = matchManager.buildSnapshot(room, 'human_probe');
  check(
    'the final snapshot still names the bot opponent for a results screen built from it',
    Array.isArray(finalSnapshot.bots) && finalSnapshot.bots[0]?.playerId === bot.playerId,
    JSON.stringify(finalSnapshot.bots),
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length === 0 ? 0 : 1);
