// test-rhymes.mjs — plain-Node validation of the generated rhyme data (no deps).
// Mirrors the browser lookup (compact format: w/g/s/n/x) and asserts rhyme
// quality, near-rhyme tightness, and payload-size budgets.
// Run:  node tools/test-rhymes.mjs
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const raw = readFileSync('data/rhymes.min.json');
const D = JSON.parse(raw);

// --- build lookup structures exactly as the browser does ---
const index = new Map();
D.w.forEach((word, i) => index.set(word, i));
const groups = [], nearGroups = [];
D.g.forEach((gid, i) => {
  (groups[gid] ||= []).push(i);
  const ng = D.n[gid];
  if (ng >= 0) (nearGroups[ng] ||= []).push(i);
});
const hidden = new Set(D.x || []);

function lookup(word) {
  const i = index.get(word);
  if (i === undefined) return { known: false, perfect: [], near: [] };
  const gid = D.g[i];
  const members = groups[gid];
  const perfect = members.filter(j => j !== i && !hidden.has(j)).map(j => D.w[j]);
  let near = [];
  const ng = D.n[gid];
  if (ng >= 0) {
    const inPerfect = new Set(members);
    near = (nearGroups[ng] || []).filter(j => !inPerfect.has(j) && !hidden.has(j)).map(j => D.w[j]);
  }
  return { known: true, perfect, near };
}

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };
const has = (arr, xs) => xs.every(x => arr.includes(x));
const some = (arr, xs) => xs.some(x => arr.includes(x));
const none = (arr, xs) => xs.every(x => !arr.includes(x));

// --- payload budgets ---
const gz = gzipSync(raw).length;
ok(raw.length < 350_000, `raw payload under 350 KB (actual ${raw.length} B)`);
ok(gz < 100_000, `gzipped payload under 100 KB target (actual ${gz} B)`);
ok(D.w.length > 5_000, `word coverage still substantial (${D.w.length} words, ${D._m.perfectKeys} perfect keys)`);

// --- horse: exact quality + false-rhyme exclusion ---
const horse = lookup('horse');
ok(has(horse.perfect, ['course', 'force', 'source']), 'horse perfect includes course/force/source');
ok(none(horse.perfect.concat(horse.near), ['base', 'case', 'chase', 'erase']), 'horse never returns base/case/chase/erase');
console.log('   horse perfect:', horse.perfect.join(', '));
console.log('   horse near:', horse.near.slice(0, 10).join(', '));

// --- time: exact quality + tightened near tier (nasal codas only) ---
const time = lookup('time');
ok(has(time.perfect, ['rhyme', 'climb', 'prime']), 'time perfect includes rhyme/climb/prime');
ok(some(time.near, ['line', 'mine', 'shine', 'nine', 'fine']), 'time near includes line/mine/shine (same-class slant rhymes)');
ok(none(time.near, ['like', 'site', 'life', 'price', 'ride']), 'time near excludes like/site/life/price/ride (different final-consonant class)');
console.log('   time perfect:', time.perfect.join(', '));
console.log('   time near:', time.near.slice(0, 12).join(', '));

// --- love ---
const love = lookup('love');
ok(has(love.perfect, ['dove', 'glove', 'above']), 'love perfect includes dove/glove/above');
ok(none(love.perfect, ['of', 'thereof']), 'love does not offer glue words of/thereof');
console.log('   love perfect:', love.perfect.join(', '));

// --- day: exact quality + NO open-vowel near dump ---
const day = lookup('day');
ok(some(day.perfect, ['way', 'say', 'play', 'stay', 'away']), 'day perfect includes way/say/play/stay/away');
ok(day.near.length === 0, `day has NO near tier (open syllable; was a weak-vowel dump before) [${day.near.length}]`);
console.log('   day perfect:', day.perfect.slice(0, 14).join(', '), '...');

// --- night ---
const night = lookup('night');
ok(some(night.perfect, ['light', 'right', 'write', 'sight', 'bright']), 'night perfect includes light/right/write/sight/bright');
console.log('   night perfect:', night.perfect.slice(0, 14).join(', '), '...');

// --- orange: honest, no fake exact rhymes ---
const orange = lookup('orange');
ok(orange.perfect.length === 0, 'orange has no fake exact rhymes');
console.log('   orange perfect:', JSON.stringify(orange.perfect), '| near:', orange.near.slice(0, 6).join(', ') || '(none)');

// --- unknown word: honest not-found ---
const unknown = lookup('blorfing');
ok(unknown.known === false && unknown.perfect.length === 0, 'unknown word -> honest not-found state');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
