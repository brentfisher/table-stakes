#!/usr/bin/env node
// STORY-055 "Fix results-screen outcome mismatch" — pure logic check, in process.
//
// Same precedent `check-recap-highlights.mjs` set: `RecapScorecard.tsx`'s own rendering has no
// in-process test surface ("this repo has no React/Three.js test framework"), so what's checked
// here is the one pure thing this story added — `turningPointFavoredWinner`
// (`shared/game-logic/turning-point-outcome.js`), the function that decides whether a "Key
// turning points" bullet needs its "the match still ended the other way" caveat.
//
// THE BUG THIS CLOSES (reproduced, not guessed — see the story's own KB "Implementation notes"
// for the full forced-score repro): `computeTurningPoints` (`server/src/game/scoring/
// narrative.js`) ranks points by swing MAGNITUDE, so the single biggest swing in the match — and
// therefore the first, most prominent "Key turning points" bullet — can belong to the restaurant
// that went on to LOSE. Before this story, that bullet read "You pulled ahead by N parties" with
// nothing distinguishing it from the match's real, opposite outcome stated one screen away. (The
// FIRST fix attempt kept "led by"/"pulled ahead" wording, which is ALSO wrong on its own terms —
// `swing` is a windowed delta, not a standing lead, so it never asserted a "lead" honestly in
// the first place; see `turning-point-outcome.js`'s own "IMPORTANT CORRECTION" for that history.)
//
// Run: node scripts/check-recap-turning-points.mjs

import { turningPointFavoredWinner } from '../shared/game-logic/turning-point-outcome.js';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('Recap "Key turning points" outcome-agreement check (STORY-055)\n');

// =================================================================================================
// 1. The reproduced bug's exact shape — self gained ground in this window, but self lost the
//    match overall. This is the case that must render the "match still ended the other way"
//    caveat, since the window's swing direction disagrees with who actually won.
// =================================================================================================
console.log('1. self gained ground in this window, but self lost the match');
check(
  'leaderIsSelf=true, outcome=loss -> did NOT favor the winner (the exact repro: "you gained ground here" under a loss heading)',
  turningPointFavoredWinner(true, 'loss') === false,
);

// =================================================================================================
// 2. The rival gained ground in this window, and the rival went on to win — the window's swing
//    direction and the final outcome agree, so no caveat is needed.
// =================================================================================================
console.log('\n2. rival gained ground in this window, and the rival won');
check(
  'leaderIsSelf=false, outcome=loss -> DID favor the winner (rival gained ground here, rival also won the match)',
  turningPointFavoredWinner(false, 'loss') === true,
);

// =================================================================================================
// 3. The mirror image of 1/2 for a WIN, both directions.
// =================================================================================================
console.log('\n3. a win, both directions');
check('leaderIsSelf=true, outcome=win -> DID favor the winner', turningPointFavoredWinner(true, 'win') === true);
check(
  'leaderIsSelf=false, outcome=win -> did NOT favor the winner (rival gained ground here, but self won overall)',
  turningPointFavoredWinner(false, 'win') === false,
);

// =================================================================================================
// 4. A draw — nobody's windowed swing "favored the winner", honestly, since there was no winner.
// =================================================================================================
console.log('\n4. a draw');
check(
  'leaderIsSelf=true, outcome=draw -> did NOT favor the winner (a draw has no winner to agree with)',
  turningPointFavoredWinner(true, 'draw') === false,
);
check(
  'leaderIsSelf=false, outcome=draw -> did NOT favor the winner, same reasoning',
  turningPointFavoredWinner(false, 'draw') === false,
);

// =================================================================================================
console.log('');
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.log(`${failed.length}/${results.length} checks FAILED`);
  process.exit(1);
}
console.log(`All ${results.length} checks passed.`);
