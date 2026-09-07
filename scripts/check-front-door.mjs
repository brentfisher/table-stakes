#!/usr/bin/env node
import specialsData from '../shared/game-data/front-door-specials.json' with { type: 'json' };

const required = ['id', 'name', 'durationMs', 'cooldownMs', 'cost', 'eligibility', 'benefit', 'downside', 'effects'];
const failures = specialsData.specials.filter((special) => required.some((key) => !(key in special)) || special.durationMs <= 0 || special.cooldownMs <= 0 || special.cost < 0);
console.log('Front-door policy harness');
for (const special of specialsData.specials) console.log(`  ${failures.includes(special) ? 'FAIL' : 'ok  '} ${special.name} — ${special.eligibility}`);
if (failures.length) process.exitCode = 1;
else console.log(`\n${specialsData.specials.length}/${specialsData.specials.length} policy fixtures ready.`);
