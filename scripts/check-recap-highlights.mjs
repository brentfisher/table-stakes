#!/usr/bin/env node
// STORY-047 "Recap shell and opening highlights" — pure tie-detection check, in process.
//
// This is a pure-logic check ONLY, the same precedent `check-visual-state.mjs` set for
// `state-color-bands.js`: `RecapHighlights.tsx`'s own rendering has no in-process test surface
// ("this repo has no React/Three.js test framework"), so what's checked here is the one thing
// that IS pure and in-process-testable — `bestSellerSpotlight`'s grouping of an already-ranked
// `MatchResult.bestSellingDishes` list into a featured dish, its tie group, and the rest.
//
// Run: node scripts/check-recap-highlights.mjs

import { bestSellerSpotlight } from '../shared/game-logic/recap-highlights.js';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('Recap opening-highlights best-seller spotlight check (STORY-047)\n');

// =================================================================================================
// 1. No sales at all
// =================================================================================================
console.log('1. empty input');
check('an empty bestSellingDishes list returns null (no dish sales recorded, no spotlight to fake)', bestSellerSpotlight([]) === null);

// =================================================================================================
// 2. A single dish, no tie possible
// =================================================================================================
console.log('\n2. one dish sold');
{
  const spotlight = bestSellerSpotlight([{ dishId: 'espresso', count: 4, revenue: 12 }]);
  check('featured is that one dish', spotlight.featured.dishId === 'espresso');
  check('tiedWith is empty — nothing else sold to tie with', spotlight.tiedWith.length === 0);
  check('supporting is empty', spotlight.supporting.length === 0);
}

// =================================================================================================
// 3. The PRD's own worked example: a two-way tie for first, per RECAP-PREVIEW.md ("Caesar Salad
//    and Smash Burger both sold six ... labeled a co-best seller")
// =================================================================================================
console.log('\n3. two-way tie for first (illustrative counts, not the PDF fixture\'s own numbers)');
{
  const dishes = [
    { dishId: 'caesar_salad', count: 6, revenue: 65.7 },
    { dishId: 'smash_burger', count: 6, revenue: 84 },
    { dishId: 'espresso', count: 4, revenue: 16 },
  ];
  const spotlight = bestSellerSpotlight(dishes);
  check('featured is the FIRST-ranked entry, not re-sorted by name/revenue', spotlight.featured.dishId === 'caesar_salad');
  check('tiedWith holds exactly the other dish sharing the top count', spotlight.tiedWith.length === 1 && spotlight.tiedWith[0].dishId === 'smash_burger');
  check(
    'supporting holds every dish after the featured one, tied or not, in server order',
    spotlight.supporting.length === 2 &&
      spotlight.supporting[0].dishId === 'smash_burger' &&
      spotlight.supporting[1].dishId === 'espresso',
  );
}

// =================================================================================================
// 4. A three-way tie for first — the filter must not stop at index 1
// =================================================================================================
console.log('\n3b. three-way tie for first');
{
  const dishes = [
    { dishId: 'a', count: 5, revenue: 10 },
    { dishId: 'b', count: 5, revenue: 10 },
    { dishId: 'c', count: 5, revenue: 10 },
    { dishId: 'd', count: 2, revenue: 4 },
  ];
  const spotlight = bestSellerSpotlight(dishes);
  check(
    'tiedWith catches every OTHER dish at the top count, not just the adjacent one',
    spotlight.tiedWith.length === 2 &&
      spotlight.tiedWith.map((d) => d.dishId).sort().join(',') === 'b,c',
  );
  check('the dish below the tie is not swept in', !spotlight.tiedWith.some((d) => d.dishId === 'd'));
}

// =================================================================================================
// 5. An outright leader — no tie at all
// =================================================================================================
console.log('\n4. an outright best seller (no tie)');
{
  const dishes = [
    { dishId: 'smash_burger', count: 18, revenue: 252 },
    { dishId: 'caesar_salad', count: 11, revenue: 110 },
    { dishId: 'espresso', count: 8, revenue: 32 },
  ];
  const spotlight = bestSellerSpotlight(dishes);
  check('featured is the outright leader', spotlight.featured.dishId === 'smash_burger');
  check('tiedWith is empty — nobody else matched the top count', spotlight.tiedWith.length === 0);
  check('supporting still lists the rest', spotlight.supporting.length === 2);
}

// =================================================================================================
console.log('');
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.log(`${failed.length}/${results.length} checks FAILED`);
  process.exit(1);
}
console.log(`All ${results.length} checks passed.`);
