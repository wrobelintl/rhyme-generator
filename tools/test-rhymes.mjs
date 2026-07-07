// test-rhymes.mjs — plain-Node validation of the generated rhyme data (no deps).
// Mirrors the browser lookup (perfect + near) and asserts quality on key cases.
// Run:  node tools/test-rhymes.mjs
import { readFileSync } from 'node:fs';

const DATA = JSON.parse(readFileSync('data/rhymes.min.json', 'utf8'));

function lookup(word) {
  const e = DATA.words[word];
  if (!e) return { known: false, perfect: [], near: [] };
  const pset = new Set(DATA.perfect[e[0]] || []);
  const perfect = [...pset].filter(w => w !== word);
  const near = (DATA.near[e[2]] || []).filter(w => w !== word && !pset.has(w));
  return { known: true, perfect, near };
}

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };
const has = (arr, xs) => xs.every(x => arr.includes(x));
const some = (arr, xs) => xs.some(x => arr.includes(x));
const none = (arr, xs) => xs.every(x => !arr.includes(x));

// horse: perfect course/force/source; NEVER base/case/chase/erase (perfect OR near)
const horse = lookup('horse');
ok(has(horse.perfect, ['course', 'force', 'source']), 'horse perfect includes course/force/source');
ok(none(horse.perfect.concat(horse.near), ['base', 'case', 'chase', 'erase']), 'horse never returns base/case/chase/erase');
console.log('   horse perfect:', horse.perfect.join(', '));

// time: perfect rhyme/climb/prime; near reaches line/shine/mine/fine
const time = lookup('time');
ok(has(time.perfect, ['rhyme', 'climb', 'prime']), 'time perfect includes rhyme/climb/prime');
ok(some(time.near, ['line', 'shine', 'mine', 'fine']), 'time near includes line/shine/mine/fine');
console.log('   time perfect:', time.perfect.join(', '));
console.log('   time near:', time.near.slice(0, 12).join(', '), '...');

// love: dove/glove/above
const love = lookup('love');
ok(has(love.perfect, ['dove', 'glove', 'above']), 'love perfect includes dove/glove/above');
console.log('   love perfect:', love.perfect.join(', '));

// day: way/say/play/stay/away (subset)
const day = lookup('day');
ok(some(day.perfect, ['way', 'say', 'play', 'stay', 'away']), 'day perfect includes way/say/play/stay/away');
console.log('   day perfect:', day.perfect.slice(0, 14).join(', '), '...');

// night: light/bright/sight/right/write (subset)
const night = lookup('night');
ok(some(night.perfect, ['light', 'bright', 'sight', 'right', 'write']), 'night perfect includes light/bright/sight/right/write');
console.log('   night perfect:', night.perfect.slice(0, 14).join(', '), '...');

// orange: no invented exact rhymes
const orange = lookup('orange');
ok(orange.perfect.length === 0, 'orange has no (bad) perfect rhymes');
console.log('   orange perfect:', JSON.stringify(orange.perfect), 'near:', orange.near.slice(0, 6).join(', '));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
