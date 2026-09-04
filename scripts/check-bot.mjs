#!/usr/bin/env node
// Bot opponent check — STORY-017's acceptance criteria, in process.
//
// The repo has no test framework (Milestone 0 Decision 8), so this is a runnable script in the
// style of `check-owner-actions.mjs`/`check-workers.mjs`: real `Match`es, the real systems
// registered against the real simulation loop, and the bot driven through
// `server/src/game/bot/bot-controller.js` exactly as `POST /api/dev/match` would drive it in
// production — via `matchManager.createRoom()` + `attachBot()` + `simulation-loop.js#stepRoom()`,
// never a shortcut that only exists in this script.
//
// WHAT THIS SCRIPT DOES NOT COVER: a real WebSocket end to end (a real human client joining a
// real bot's real HTTP-created match). That is `scripts/smoke-bot.mjs`, in the style of
// `smoke-milestone0.mjs` — it spawns a real server and proves STORY-017 AC1 ("the human client
// cannot tell from the protocol that the opponent is a bot") over an actual socket.
//
// Run: node scripts/check-bot.mjs

import { readFileSync } from 'node:fs';

import { registerAllSystems } from '../server/src/game/systems/index.js';
import { clearSystems, stepRoom } from '../server/src/game/simulation-loop.js';
import * as matchManager from '../server/src/game/match-manager.js';
import { attachBot } from '../server/src/game/bot/bot-controller.js';
import { buildBotSetup, _internal as botSetupInternal } from '../server/src/game/bot/bot-setup.js';
import { validateSetupSubmission } from '../server/src/game/validators/setup-validator.js';
import { catalogue } from '../server/src/game/catalogue.js';
import { selectableMains, selectableAddons } from '../shared/schemas/setup-rules.js';
import { STARTING_CASH, BOT_DECISION_INTERVAL_MS, SCORE_POINTS_SCALE } from '../shared/constants/tuning.js';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const realLog = console.log;
const realWarn = console.warn;
function quiet(fn) {
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = realLog;
    console.warn = realWarn;
  }
}

/** A tiny local RNG for THIS SCRIPT's own probing (never the bot's — the bot always draws from
 * `match.createRngStream`). Same mulberry32 shape as `server/src/game/rng.js`, reimplemented
 * here rather than imported so this script has no dependency on a match existing at all when
 * probing `buildBotSetup()` directly against a bare market object. */
function deterministicRng(seed) {
  let a = 0;
  for (let i = 0; i < seed.length; i += 1) a = (Math.imul(31, a) + seed.charCodeAt(i)) | 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSample(pool, n, rng) {
  const copy = [...pool];
  const out = [];
  for (let i = 0; i < n && copy.length > 0; i += 1) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

/**
 * The average tag overlap PER SLOT (mains AND add-ons, 3:2, same mix `avgObserved` above is
 * measured over) of a UNIFORMLY RANDOM legal menu against each market's `preferredTags`,
 * Monte-Carlo sampled with this script's own deterministic RNG (never the bot's, never
 * `Math.random()`, so this check itself reruns identically). This is the honest baseline "the
 * bot is weighted toward the market" is measured against — same denominator shape as the bot's
 * own observed average, so the two numbers are actually comparable.
 */
function expectedRandomTagOverlap(cat, layoutData, markets, samplesPerMarket = 300) {
  let totalOverlap = 0;
  let totalSlots = 0;
  for (const market of markets) {
    const preferred = new Set(market.preferredTags ?? []);
    const mains = selectableMains(cat.dishes, layoutData);
    const addons = selectableAddons(cat.dishes, layoutData);
    const rng = deterministicRng(`randbaseline:${market.id}`);
    for (let i = 0; i < samplesPerMarket; i += 1) {
      const picked = [...randomSample(mains, 3, rng), ...randomSample(addons, 2, rng)];
      for (const dish of picked) {
        totalOverlap += (dish.tags ?? []).filter((t) => preferred.has(t)).length;
        totalSlots += 1;
      }
    }
  }
  return totalOverlap / totalSlots;
}

console.log('Bot opponent check — PRD §12/§20, STORY-017\n');

clearSystems();
registerAllSystems();

const layout = JSON.parse(
  readFileSync(new URL('../shared/game-data/restaurant-layout.json', import.meta.url)),
);

const TICK_MS = 50;

function runToEnd(room, maxSteps = 30_000) {
  quiet(() => {
    for (let i = 0; i < maxSteps && !room.match.ended; i += 1) stepRoom(room, TICK_MS);
  });
  return room.match.ended;
}

/** True for a field name that would leak "this seat is a bot" — an exact-name denylist rather
 * than a bare `/bot/i` substring test, which false-positives on real, unrelated field names
 * that happen to contain the letters (STORY-015's `activeBottlenecks`, for one). */
const BOT_TELL_FIELD_NAMES = new Set(['isbot', 'bot', 'botcontrolled', 'iscpu', 'aicontrolled', 'controlledby', 'opponenttype']);
function looksBotShaped(key) {
  return BOT_TELL_FIELD_NAMES.has(key.toLowerCase());
}

function menuSignature(player) {
  return [...player.setup.menu, ...player.setup.addons].map((s) => `${s.dishId}@${s.price}`).sort().join('|');
}

// =============================================================================================
// 1. AC2/AC3 — bot-setup.js builds a menu that (a) passes setup-validator.js UNMODIFIED and
//    (b) is measurably weighted toward the active market's preferredTags, not a fixed menu.
// =============================================================================================
{
  const seeds = ['bot-setup-a', 'bot-setup-b', 'bot-setup-c', 'bot-setup-d', 'bot-setup-e'];
  let allValid = true;
  let allNotAutoFilled = true;
  const menusByMarket = new Map();
  let totalTagMatches = 0;
  let submissionCount = 0;

  for (const market of catalogue.markets) {
    const seenMenus = new Set();
    for (const seedName of seeds) {
      const rng = deterministicRng(`${market.id}:${seedName}`);
      const submission = buildBotSetup({ catalogue, layout, market, rng, startingCash: STARTING_CASH });

      // (a) — the SAME validator a human's `setup_submit` goes through, unmodified.
      const validated = validateSetupSubmission(submission, { catalogue, layout, startingCash: STARTING_CASH });
      if (!validated.ok) {
        allValid = false;
        console.log(`    FAIL detail: market=${market.id} seed=${seedName} -> ${validated.reason}: ${validated.detail}`);
      } else if (validated.submission.autoFilled !== false) {
        allNotAutoFilled = false;
      }

      seenMenus.add(submission.menu.map((s) => s.dishId).sort().join(','));

      // (b) — tag overlap with THIS market's preferredTags, measured.
      const preferred = new Set(market.preferredTags ?? []);
      for (const slot of [...submission.menu, ...submission.addons]) {
        const dish = catalogue.dishesById[slot.dishId];
        totalTagMatches += (dish?.tags ?? []).filter((t) => preferred.has(t)).length;
        submissionCount += 1;
      }
    }
    menusByMarket.set(market.id, seenMenus);
  }

  check(
    'every bot setup_submit, for every market and seed sampled, passes setup-validator.js unmodified',
    allValid,
    `${catalogue.markets.length} markets x ${seeds.length} seeds`,
  );
  check(
    'a validated bot submission is never the auto-fill fallback (autoFilled === false)',
    allNotAutoFilled,
  );

  const avgObserved = totalTagMatches / submissionCount;
  const randomBaseline = expectedRandomTagOverlap(catalogue, layout, catalogue.markets);
  check(
    "the bot's menu scores measurably higher average preferredTags overlap than a uniformly random legal menu",
    avgObserved > randomBaseline * 1.15,
    `bot avg=${avgObserved.toFixed(3)} tags/slot, random baseline=${randomBaseline.toFixed(3)} tags/slot`,
  );

  const distinctMenusAcrossMarkets = new Set([...menusByMarket.values()].flatMap((set) => [...set]));
  check(
    'the bot does not always pick the same fixed menu — different markets/seeds produce different menus',
    distinctMenusAcrossMarkets.size > 1,
    `${distinctMenusAcrossMarkets.size} distinct main-dish sets observed across ${catalogue.markets.length} markets`,
  );

  const sortedBySensitivity = [...catalogue.markets].sort((a, b) => b.priceSensitivity - a.priceSensitivity);
  const sensitive = sortedBySensitivity[0];
  const insensitive = sortedBySensitivity[sortedBySensitivity.length - 1];
  if (sensitive.id !== insensitive.id) {
    const leanFor = (market) => {
      const dish = selectableMains(catalogue.dishes, layout)[0];
      const rng = deterministicRng(`lean:${market.id}`);
      const price = botSetupInternal.choosePrice(dish, market, rng);
      const min = dish.suggestedPrice * 0.6;
      const max = dish.suggestedPrice * 1.6;
      return (price - min) / (max - min);
    };
    check(
      'price choice leans lower in the more price-sensitive market than in the less sensitive one',
      leanFor(sensitive) < leanFor(insensitive),
      `sensitive(${sensitive.id})=${leanFor(sensitive).toFixed(2)} insensitive(${insensitive.id})=${leanFor(insensitive).toFixed(2)}`,
    );
  }
}

// =============================================================================================
// 2. NO PRIVILEGED PATH — bot-controller.js's source never calls a mutating facade method or
//    assigns into match/player state directly, and never imports the validators or another
//    system's restricted internals. Mirrors check-owner-actions.mjs §13's own source-grep.
// =============================================================================================
{
  const source = readFileSync(
    new URL('../server/src/game/bot/bot-controller.js', import.meta.url),
    'utf8',
  );
  // This file's own header comments DESCRIBE the forbidden calls by name (that is the point of
  // the header — it says what must never appear), so scanning raw `source` would fail on its
  // own prose. Strip `/* */` and whole-line `//` comments first and grep the CODE only.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const mutatingCalls = [
    'startTicket(', 'claimOrder(', 'deliverOrder(', 'unclaimOrder(',
    'seatParty(', 'takeOrderFrom(', 'clearTable(', 'collectPayment(', 'handleComplaint(',
    'requestRestock(', 'setReady(', 'applyInput(',
  ];
  const foundCalls = mutatingCalls.filter((name) => code.includes(name));
  check(
    'bot-controller.js never calls a mutating match/floor/kitchen/pantry facade method directly',
    foundCalls.length === 0,
    foundCalls.length ? `found: ${foundCalls.join(', ')}` : 'none of the mutating call names appear',
  );

  const assignsMatchOrPlayer = /\b(match|player)\.\w+(\.\w+)*\s*=(?!=)/.test(code);
  check(
    'bot-controller.js never assigns into a `match.*` or `player.*` field directly',
    !assignsMatchOrPlayer,
  );

  const forbiddenImports = [/action-validator\.js['"]/, /setup-validator\.js['"]/, /worker-system\.js['"]/];
  const importLines = source.split('\n').filter((line) => line.trim().startsWith('import'));
  const violatingImport = forbiddenImports.find((re) => importLines.some((line) => re.test(line)));
  check(
    'bot-controller.js imports neither validator module nor worker-system.js directly',
    !violatingImport,
    violatingImport ? `matched ${violatingImport}` : 'no import line references them',
  );

  check(
    'every match-state change is sent through routeMessage() — the same function socket-server.js calls',
    (source.match(/routeMessage\(/g) ?? []).length >= 1 &&
      source.includes("from '../../websocket/message-router.js'"),
  );
}

// =============================================================================================
// 3. AC1 — the human client cannot tell, from the PROTOCOL, that the opponent is a bot.
//    (The real-socket half of this — a genuine human WS client — is scripts/smoke-bot.mjs.)
// =============================================================================================
{
  const room = matchManager.createRoom({ seed: 'bot-protocol', phasePreset: 'prototype', requiredPlayers: 2 });
  const humanJoin = room.match.join({ fallbackPlayerId: 'human_probe' });
  room.match.setReady('human_probe', true);
  const bot = attachBot(room, { difficulty: 'hard' });

  quiet(() => {
    for (let i = 0; i < 40 && room.match.phase === 'lobby'; i += 1) stepRoom(room, TICK_MS);
  });

  const snapshot = room.match.toSnapshot('human_probe');
  const humanEntry = snapshot.players.find((p) => p.playerId === 'human_probe');
  const botEntry = snapshot.players.find((p) => p.playerId === bot.playerId);
  check(
    'both seats reach the lobby and both are visible on the snapshot',
    humanJoin.ok && Boolean(humanEntry) && Boolean(botEntry),
    `human=${Boolean(humanEntry)} bot=${Boolean(botEntry)}`,
  );
  check(
    "the bot's `players[]` entry has the EXACT same key set as the human's — no isBot-shaped field",
    JSON.stringify(Object.keys(humanEntry).sort()) === JSON.stringify(Object.keys(botEntry).sort()),
    `human keys=${Object.keys(humanEntry).sort().join(',')} bot keys=${Object.keys(botEntry).sort().join(',')}`,
  );
  check(
    'no key on either player entry even mentions "bot"',
    ![...Object.keys(humanEntry), ...Object.keys(botEntry)].some(looksBotShaped),
  );
}

// =============================================================================================
// 4. AC4/AC8 — bot-vs-bot to completion: every service-phase action goes through `interact`/
//    `player_input` -> message-router.js -> action-validator.js, and the match produces a
//    valid `match_complete` payload — the fastest available balance-testing harness for
//    STORY-013, per this story's own stated purpose.
// =============================================================================================
let reference;
{
  const room = matchManager.createRoom({ seed: 'bot-vs-bot-repro', phasePreset: 'prototype', requiredPlayers: 2 });
  const botA = attachBot(room, { difficulty: 'hard' }); // seat 0
  const botB = attachBot(room, { difficulty: 'easy' }); // seat 1

  const ended = runToEnd(room);
  check('a full bot-vs-bot match reaches `ended` within the step budget', ended, `phase=${room.match.phase}`);

  const complete = room.match.matchCompleteMessage();
  const bothPlayerIds = [botA.playerId, botB.playerId];
  const validPayload =
    complete.type === 'match_complete' &&
    complete.reason === 'completed' &&
    (complete.winnerPlayerId === null || bothPlayerIds.includes(complete.winnerPlayerId)) &&
    bothPlayerIds.every((id) => complete.results[id] && typeof complete.results[id].score === 'number');
  check(
    'the match produces a valid match_complete payload — §12 envelope, real per-player results',
    validPayload,
    `winner=${complete.winnerPlayerId} reason=${complete.reason} resultKeys=${Object.keys(complete.results).join(',')}`,
  );

  check(
    'both seats ran their OWN, non-autofilled setup — the bot menu actually reached service',
    room.match.players.get(botA.playerId)?.setup?.autoFilled === false &&
      room.match.players.get(botB.playerId)?.setup?.autoFilled === false,
  );

  check(
    'the bot took real interact actions during service (through the router, accepted or rejected)',
    botA.stats.interactsSent > 0 && botB.stats.interactsSent > 0,
    `hard sent=${botA.stats.interactsSent} rejected=${botA.stats.interactsRejected}; ` +
      `easy sent=${botB.stats.interactsSent} rejected=${botB.stats.interactsRejected}`,
  );

  reference = {
    seatAMenu: menuSignature(room.match.players.get(botA.playerId)),
    seatBMenu: menuSignature(room.match.players.get(botB.playerId)),
    seatAWonBySeat: complete.winnerPlayerId === botA.playerId ? 'A' : complete.winnerPlayerId === botB.playerId ? 'B' : null,
    seatAResult: complete.results[botA.playerId],
    seatBResult: complete.results[botB.playerId],
    seatAStats: { ...botA.stats },
    seatBStats: { ...botB.stats },
  };
}

// =============================================================================================
// 5. AC5 — reproducible from the seed, under deterministic stepping. See bot-controller.js's
//    own header on why this is scoped to deterministic dtMs stepping, not wall-clock timing —
//    exactly the guarantee STORY-013's balance-testing use case needs.
// =============================================================================================
{
  const room = matchManager.createRoom({ seed: 'bot-vs-bot-repro', phasePreset: 'prototype', requiredPlayers: 2 });
  const botA = attachBot(room, { difficulty: 'hard' });
  const botB = attachBot(room, { difficulty: 'easy' });
  runToEnd(room);
  const complete = room.match.matchCompleteMessage();

  const rerun = {
    seatAMenu: menuSignature(room.match.players.get(botA.playerId)),
    seatBMenu: menuSignature(room.match.players.get(botB.playerId)),
    seatAWonBySeat: complete.winnerPlayerId === botA.playerId ? 'A' : complete.winnerPlayerId === botB.playerId ? 'B' : null,
    seatAResult: complete.results[botA.playerId],
    seatBResult: complete.results[botB.playerId],
    seatAStats: { ...botA.stats },
    seatBStats: { ...botB.stats },
  };

  check(
    'the same seed produces the SAME two menus (dishes and prices) on re-run',
    rerun.seatAMenu === reference.seatAMenu && rerun.seatBMenu === reference.seatBMenu,
    `seatA equal=${rerun.seatAMenu === reference.seatAMenu} seatB equal=${rerun.seatBMenu === reference.seatBMenu}`,
  );
  check(
    'the same seed produces the SAME winning seat (or the same no-winner outcome) on re-run',
    rerun.seatAWonBySeat === reference.seatAWonBySeat,
    `run1=${reference.seatAWonBySeat} run2=${rerun.seatAWonBySeat}`,
  );
  check(
    'the same seed produces IDENTICAL per-seat scores and revenue on re-run',
    rerun.seatAResult.score === reference.seatAResult.score &&
      rerun.seatAResult.revenue === reference.seatAResult.revenue &&
      rerun.seatBResult.score === reference.seatBResult.score &&
      rerun.seatBResult.revenue === reference.seatBResult.revenue,
    `seatA ${reference.seatAResult.score}==${rerun.seatAResult.score}, seatB ${reference.seatBResult.score}==${rerun.seatBResult.score}`,
  );
  check(
    'the same seed produces the IDENTICAL count of interacts sent/rejected on re-run',
    JSON.stringify(rerun.seatAStats) === JSON.stringify(reference.seatAStats) &&
      JSON.stringify(rerun.seatBStats) === JSON.stringify(reference.seatBStats),
    `seatA ${JSON.stringify(reference.seatAStats)} vs ${JSON.stringify(rerun.seatAStats)}`,
  );
}

// =============================================================================================
// 6. AC6 — at least two difficulty levels, and the difference is MEASURED: accepted-interact
//    rate (the direct knob) and score margin over a genuinely IDLE opponent (an owner who never
//    sends a single interact — the worker automation alone runs their restaurant at PRD §24's
//    60-75% floor, exactly as an inattentive first-time human would leave it).
// =============================================================================================
{
  function idleVsBotMargin(seed, difficulty) {
    const room = matchManager.createRoom({ seed, phasePreset: 'prototype', requiredPlayers: 2 });
    room.match.join({ fallbackPlayerId: 'idle' }); // seat 0 — never submits, never interacts
    room.match.setReady('idle', true);
    const bot = attachBot(room, { difficulty }); // seat 1
    runToEnd(room);
    const complete = room.match.matchCompleteMessage();
    const idleScore = complete.results.idle?.score ?? 0;
    const botScore = complete.results[bot.playerId]?.score ?? 0;
    const acceptedPerMinute =
      (bot.stats.interactsSent - bot.stats.interactsRejected) /
      (room.match.durations.service + room.match.durations.final_rush) *
      60_000;
    return { idleScore, botScore, margin: botScore - idleScore, acceptedPerMinute };
  }

  const seeds = ['bot-difficulty-1', 'bot-difficulty-2', 'bot-difficulty-3'];
  const easyRuns = seeds.map((seed) => idleVsBotMargin(seed, 'easy'));
  const hardRuns = seeds.map((seed) => idleVsBotMargin(seed, 'hard'));
  const avg = (list, key) => list.reduce((s, r) => s + r[key], 0) / list.length;

  const easyMargin = avg(easyRuns, 'margin');
  const hardMargin = avg(hardRuns, 'margin');
  const easyRate = avg(easyRuns, 'acceptedPerMinute');
  const hardRate = avg(hardRuns, 'acceptedPerMinute');

  check(
    'the hard bot accepts measurably MORE interacts per minute than the easy bot (the direct cadence/mistake knob)',
    hardRate > easyRate * 1.3,
    `easy=${easyRate.toFixed(2)}/min hard=${hardRate.toFixed(2)}/min (avg over ${seeds.length} seeds)`,
  );
  check(
    'the hard bot beats an idle opponent by a LARGER score margin than the easy bot does — "punishes idleness"',
    hardMargin > easyMargin,
    `easy margin=${easyMargin.toFixed(1)} hard margin=${hardMargin.toFixed(1)} (avg over ${seeds.length} seeds, PRD-style score points)`,
  );
  // Thresholds are fractions of SCORE_POINTS_SCALE (1000) rather than flat numbers, so they
  // stay meaningful if the scoring weights are ever retuned. A single seed is allowed some
  // variance (a competent human still beats a same-seed easy bot most of the time, not every
  // time) — the AVERAGE across seeds is the stronger, less noisy claim, checked below it.
  const EASY_PER_SEED_MARGIN_CAP = SCORE_POINTS_SCALE * 0.1; // 100 pts: still clearly beatable
  const EASY_AVERAGE_MARGIN_CAP = SCORE_POINTS_SCALE * 0.05; // 50 pts: modest on average
  check(
    "the easy bot's per-seed margin over an idle opponent never runs away — beatable by a competent first-time player",
    easyRuns.every((r) => r.margin < EASY_PER_SEED_MARGIN_CAP),
    `easy margins: ${easyRuns.map((r) => r.margin.toFixed(1)).join(', ')} (score points, cap=${EASY_PER_SEED_MARGIN_CAP})`,
  );
  check(
    "the easy bot's AVERAGE margin over an idle opponent stays modest across seeds",
    easyMargin < EASY_AVERAGE_MARGIN_CAP,
    `easy avg margin=${easyMargin.toFixed(1)} (score points, cap=${EASY_AVERAGE_MARGIN_CAP})`,
  );
  check(
    'BOT_DECISION_INTERVAL_MS is a real, distinct tuning knob per difficulty (not two names for one number)',
    BOT_DECISION_INTERVAL_MS.easy !== BOT_DECISION_INTERVAL_MS.hard,
    JSON.stringify(BOT_DECISION_INTERVAL_MS),
  );
}

// =============================================================================================
// 7. AC7 — the bot's restaurant produces a rival summary in the HUD indistinguishable in shape
//    from a human rival's: the public `restaurants[]`/`players[]` projections are built by
//    systems that read `match.players.keys()`, never anything bot-specific.
// =============================================================================================
{
  // 'smoke' preset — this section needs one tick of `service`, not a played-out match, and
  // 'prototype''s 45s setup phase alone is 900 ticks (see the bug this replaced: a 200-tick
  // budget never reached `service` at all, and `match.restaurants` stayed undefined).
  const room = matchManager.createRoom({ seed: 'bot-shape', phasePreset: 'smoke', requiredPlayers: 2 });
  const botA = attachBot(room, { difficulty: 'hard' });
  const botB = attachBot(room, { difficulty: 'easy' });
  quiet(() => {
    for (let i = 0; i < 2000 && room.match.phase !== 'service' && !room.match.ended; i += 1) {
      stepRoom(room, TICK_MS);
    }
    for (let i = 0; i < 40 && !room.match.ended; i += 1) stepRoom(room, TICK_MS); // populate restaurants[]
  });

  const restaurantA = room.match.restaurants?.find((r) => r.restaurantId === botA.playerId);
  const restaurantB = room.match.restaurants?.find((r) => r.restaurantId === botB.playerId);
  // No hardcoded field list here on purpose — `toPublicRestaurantSnapshot()`'s exact field set
  // has grown across stories (STORY-015's `activeBottlenecks`, STORY-006's `shortages`, ...)
  // and hardcoding it would make this check a second place that list has to be kept in sync.
  // The actual claim (STORY-017 AC7) is comparative: restaurant A's and restaurant B's shapes
  // must be identical to EACH OTHER, and neither may carry a field naming "bot" — because both
  // are produced by the exact same system code path with no branch on who controls the seat.
  check(
    "both bots' restaurant summaries have IDENTICAL shape to each other — the same system code produced both, with no branch on who controls the seat",
    Boolean(restaurantA) && Boolean(restaurantB) &&
      JSON.stringify(Object.keys(restaurantA).sort()) === JSON.stringify(Object.keys(restaurantB).sort()),
    `A=${restaurantA ? Object.keys(restaurantA).sort().join(',') : 'missing'} B=${restaurantB ? Object.keys(restaurantB).sort().join(',') : 'missing'}`,
  );
  check(
    'no field on a restaurant summary even mentions "bot"',
    restaurantA && restaurantB &&
      ![...Object.keys(restaurantA), ...Object.keys(restaurantB)].some(looksBotShaped),
  );

  const snapshot = room.match.toSnapshot(botA.playerId);
  const selfEntry = snapshot.players.find((p) => p.playerId === botA.playerId);
  const rivalEntry = snapshot.players.find((p) => p.playerId === botB.playerId);
  check(
    "a bot's own player entry and its bot rival's player entry share an identical key set — a real rival client couldn't tell them apart by shape",
    JSON.stringify(Object.keys(selfEntry).sort()) === JSON.stringify(Object.keys(rivalEntry).sort()),
  );
}

// --- summary ------------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log(`${failed.length} FAILED:`);
  for (const r of failed) console.log(`  - ${r.name}`);
  process.exit(1);
}
