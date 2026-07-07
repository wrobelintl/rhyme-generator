// test-rhymes.mjs — plain-Node validation of the generated rhyme data (no deps).
// Mirrors the browser lookup (format: w/g/a2/s/n/f/h/x) and asserts rhyme
// quality, homograph/homophone behavior, licensing metadata, and payload budgets.
// Run:  node tools/test-rhymes.mjs
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const raw = readFileSync('data/rhymes.min.json');
const D = JSON.parse(raw);

// --- build lookup structures exactly as the browser does ---
const index = new Map();
D.w.forEach((word, i) => index.set(word, i));
const groups = [], nearGroups = [];
const addNear = (gid, i) => {
  const ng = D.n[gid];
  if (ng < 0) return;
  const arr = nearGroups[ng] ||= [];
  if (arr[arr.length - 1] !== i) arr.push(i);
};
D.g.forEach((gid, i) => { (groups[gid] ||= []).push(i); addNear(gid, i); });
for (const [k, extra] of Object.entries(D.a2)) {
  for (const gid of extra) { (groups[gid] ||= []).push(+k); addNear(gid, +k); }
}
groups.forEach(a => a && a.sort((x, y) => x - y));
nearGroups.forEach(a => a && a.sort((x, y) => x - y));
const hidden = new Set((D.x || []).map(Number));

function lookup(word) {
  const i = index.get(word);
  if (i === undefined) return { known: false, senses: [], homophones: [], all: [] };
  const gids = [D.g[i], ...(D.a2[i] || [])];
  const hid = D.h[i];
  const isHomo = j => hid !== undefined && D.h[j] === hid;
  const homophones = (groups[D.g[i]] || []).filter(j => j !== i && isHomo(j) && !hidden.has(j)).map(j => D.w[j]);
  const senses = gids.map(gid => {
    const members = groups[gid] || [];
    const inGroup = new Set(members);
    const perfect = members.filter(j => j !== i && !hidden.has(j) && !isHomo(j)).map(j => D.w[j]);
    let near = [];
    const ng = D.n[gid];
    if (ng >= 0) near = (nearGroups[ng] || []).filter(j => j !== i && !inGroup.has(j) && !hidden.has(j) && !isHomo(j)).map(j => D.w[j]);
    return { perfect, near, family: +D.f[gid] };
  });
  const all = senses.flatMap(s => s.perfect.concat(s.near));
  return { known: true, senses, homophones, all };
}

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };
const has = (arr, xs) => xs.every(x => arr.includes(x));
const some = (arr, xs) => xs.some(x => arr.includes(x));
const none = (arr, xs) => xs.every(x => !arr.includes(x));

// --- payload budgets ---
const gz = gzipSync(raw).length;
ok(raw.length < 350_000, `raw payload under 350 KB (actual ${raw.length} B)`);
ok(gz < 100_000, `gzipped payload under 100 KB ceiling (actual ${gz} B)`);
ok(D.w.length > 8_000, `coverage substantial (${D.w.length} words, ${D._m.perfectKeys} perfect keys)`);

// --- licensing / source metadata ---
const blob = JSON.stringify(D);
ok(!/first20hours|google-10000|10000-english/i.test(blob), 'data contains NO reference to the removed frequency source');
ok(/gwordlist/.test(D._m.frequencySource) && /CC BY 3\.0/.test(D._m.frequencySource), 'frequency source declared as gwordlist / CC BY 3.0');
ok(/Carnegie Mellon/.test(D._m.attribution) && /books\.google\.com\/ngrams/.test(D._m.attribution), 'attribution names CMU and Google Books Ngram');
ok(existsSync('data/NOTICE.md') && /Carnegie Mellon University/.test(readFileSync('data/NOTICE.md', 'utf8')), 'data/NOTICE.md exists and carries the CMU notice');
ok(!/first20hours/.test(readFileSync('tools/build-rhyme-data.mjs', 'utf8')), 'builder contains no removed-source reference');

// --- horse: exact quality + false-rhyme exclusion ---
const horse = lookup('horse');
ok(has(horse.senses[0].perfect, ['course', 'force', 'source']), 'horse perfect includes course/force/source');
ok(none(horse.all, ['base', 'case', 'chase', 'erase']), 'horse never returns base/case/chase/erase');
console.log('   horse perfect:', horse.senses[0].perfect.slice(0, 10).join(', '));

// --- time: exact + tight near tier ---
const time = lookup('time');
ok(has(time.senses[0].perfect, ['rhyme', 'climb', 'prime']), 'time perfect includes rhyme/climb/prime');
ok(some(time.senses[0].near, ['line', 'mine', 'shine', 'nine', 'fine']), 'time near includes line/mine/shine (same-class slants)');
ok(none(time.senses[0].near, ['like', 'site', 'life', 'price', 'ride']), 'time near excludes like/site/life/price/ride');
console.log('   time near:', time.senses[0].near.slice(0, 10).join(', '));

// --- love / day / night / orange ---
const love = lookup('love');
ok(has(love.senses[0].perfect, ['dove', 'glove', 'above']), 'love perfect includes dove/glove/above');
const day = lookup('day');
ok(some(day.senses[0].perfect, ['way', 'say', 'play', 'stay', 'away']), 'day perfect includes way/say/play/stay/away');
ok(day.senses.every(se => se.near.length === 0), 'day has NO near tier (open syllable)');
const night = lookup('night');
ok(some(night.senses[0].perfect, ['light', 'right', 'write', 'sight', 'bright']), 'night perfect includes light/right/write/sight/bright');
const orange = lookup('orange');
ok(orange.senses.every(se => se.perfect.length === 0), 'orange has no fake exact rhymes');

// --- stress {1,2} anchor regression (late secondary stress compound) ---
const pg = lookup('playground');
ok(some(pg.all, ['ground', 'sound', 'found', 'around']), 'playground rhymes with ground/sound/found (stress-2 anchor)');

// --- homographs: multiple pronunciations unioned ---
const live = lookup('live');
ok(live.senses.length >= 2, `live has ${live.senses.length} pronunciation senses`);
ok(some(live.all, ['give', 'forgive']) && some(live.all, ['five', 'drive', 'alive']), 'live reaches BOTH give-group and five-group');
const read = lookup('read');
ok(some(read.all, ['red', 'bed', 'head', 'said']) && some(read.all, ['need', 'feed', 'speed', 'indeed']), 'read reaches BOTH red-group and need-group');
const wind = lookup('wind');
ok(some(wind.all, ['find', 'kind', 'mind', 'behind']), 'wind reaches the find/kind group');
ok(wind.senses.length >= 2, `wind has ${wind.senses.length} senses (noun/verb)`);
const lead = lookup('lead');
ok(some(lead.all, ['red', 'bed', 'head', 'said']) && some(lead.all, ['need', 'feed', 'speed', 'indeed']), 'lead reaches BOTH red-group and need-group');

// --- homophones: split, not listed as rhymes ---
const sea = lookup('sea');
ok(sea.homophones.includes('see'), 'sea lists see as a HOMOPHONE');
ok(none(sea.all, ['see']), 'see is NOT offered as a rhyme of sea');
const see = lookup('see');
ok(see.homophones.includes('sea') && none(see.all, ['sea']), 'see <-> sea symmetric');

// --- rhyme families ---
ok(+D.f[D.g[index.get('day')]] === 1, 'day group family = 1 (masculine)');
ok(+D.f[D.g[index.get('money')]] === 2, 'money group family = 2 (feminine)');
ok(+D.f[D.g[index.get('family')]] === 3, 'family group family = 3 (dactylic)');

// --- unknown word ---
ok(lookup('blorfing').known === false, 'unknown word -> honest not-found state');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
