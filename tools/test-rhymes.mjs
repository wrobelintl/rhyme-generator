// test-rhymes.mjs — plain-Node validation of the generated rhyme data (no deps).
// Mirrors the browser lookup (format: w/g/a2/s/n/f/h/x/v) and asserts rhyme
// quality, homograph/homophone behavior, the assonance (similar-vowel-sound)
// tier, licensing metadata, and payload budgets.
// Run:  node tools/test-rhymes.mjs
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const raw = readFileSync('data/rhymes.min.json');
const D = JSON.parse(raw);

// Assonance-tier display stoplist — MUST stay in sync with SONIC_STOP in
// index.html (pure grammatical auxiliaries; never shown as vowel mates).
const SONIC_STOP = new Set(['was', 'has', 'had', 'does', 'did', 'been', 'are', 'were',
  'will', 'would', 'could', 'should', 'shall', 'can', 'than', 'such', 'into', 'onto',
  'them', 'thus']);

// --- build lookup structures exactly as the browser does ---
const index = new Map();
D.w.forEach((word, i) => index.set(word, i));
const groups = [], nearGroups = [], asnGroups = [];
const addNear = (gid, i) => {
  const ng = D.n[gid];
  if (ng < 0) return;
  const arr = nearGroups[ng] ||= [];
  if (arr[arr.length - 1] !== i) arr.push(i);
};
const addAsn = (gid, i) => { if (D.v) (asnGroups[D.v[gid]] ||= []).push(i); };
D.g.forEach((gid, i) => { (groups[gid] ||= []).push(i); addNear(gid, i); addAsn(gid, i); });
for (const [k, extra] of Object.entries(D.a2)) {
  for (const gid of extra) { (groups[gid] ||= []).push(+k); addNear(gid, +k); addAsn(gid, +k); }
}
groups.forEach(a => a && a.sort((x, y) => x - y));
nearGroups.forEach(a => a && a.sort((x, y) => x - y));
asnGroups.forEach((a, k) => { if (a) asnGroups[k] = Array.from(new Set(a)).sort((x, y) => x - y); });
const hidden = new Set((D.x || []).map(Number));

function lookup(word) {
  const i = index.get(word);
  if (i === undefined) return { known: false, senses: [], homophones: [], all: [], sonic: [] };
  const gids = [D.g[i], ...(D.a2[i] || [])];
  const hid = D.h[i];
  const isHomo = j => hid !== undefined && D.h[j] === hid;
  const homophones = (groups[D.g[i]] || []).filter(j => j !== i && isHomo(j) && !hidden.has(j)).map(j => D.w[j]);
  const seenSonic = {};
  const senses = gids.map(gid => {
    const members = groups[gid] || [];
    const inGroup = new Set(members);
    const perfect = members.filter(j => j !== i && !hidden.has(j) && !isHomo(j)).map(j => D.w[j]);
    let near = [], inNear = null;
    const ng = D.n[gid];
    if (ng >= 0) {
      const nearIdx = nearGroups[ng] || [];
      inNear = new Set(nearIdx);
      near = nearIdx.filter(j => j !== i && !inGroup.has(j) && !hidden.has(j) && !isHomo(j)).map(j => D.w[j]);
    }
    let sonic = [];
    const vid = D.v ? D.v[gid] : undefined;
    if (vid !== undefined && !seenSonic[vid]) {
      seenSonic[vid] = true;
      sonic = (asnGroups[vid] || [])
        .filter(j => j !== i && !inGroup.has(j) && !(inNear && inNear.has(j)) && !hidden.has(j) && !isHomo(j) && !SONIC_STOP.has(D.w[j]))
        .map(j => D.w[j]);
    }
    return { perfect, near, family: +D.f[gid], sonic };
  });
  const all = senses.flatMap(s => s.perfect.concat(s.near));
  const sonic = senses.flatMap(s => s.sonic);
  return { known: true, senses, homophones, all, sonic };
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

// --- assonance tier (v): structure ---
ok(Array.isArray(D.v) && D.v.length === D.n.length, `v covers every perfect group (v=${(D.v || []).length} n=${D.n.length})`);
ok(D.v.every(a => a >= 0 && a < D._m.assonanceKeys), `every assonance id in range (${D._m.assonanceKeys} classes)`);

// --- assonance tier: quality + honesty on rhyme-poor words ---
const orangeS = lookup('orange');
ok(orangeS.sonic.length >= 3, `orange offers >=3 assonance words (${orangeS.sonic.length})`);
ok(some(orangeS.sonic, ['foreign', 'forward', 'morning', 'portion', 'office']), 'orange assonance includes foreign/forward/morning-type matches');
console.log('   orange assonance:', orangeS.sonic.slice(0, 8).join(', '));
const silverS = lookup('silver');
ok(silverS.senses.every(se => se.perfect.length === 0), 'silver has no fake exact rhymes');
ok(some(silverS.sonic, ['river', 'little', 'women', 'single', 'figure']), 'silver assonance includes river/little/women-type matches');
const worldS = lookup('world');
ok(some(worldS.sonic, ['first', 'work', 'word', 'earth', 'church']), 'world assonance includes first/work/word-type matches');
const musicS = lookup('music');
ok(some(musicS.sonic, ['human', 'future', 'student', 'useful', 'computer']), 'music assonance includes human/future/student-type matches');
const peopleS = lookup('people');
ok(some(peopleS.sonic, ['reason', 'legal', 'equal', 'region', 'meaning']), 'people assonance includes reason/legal/equal-type matches');

// --- assonance tier: separation from rhyme tiers (never blended) ---
for (const wd of ['orange', 'silver', 'world', 'music', 'people', 'time', 'day', 'love', 'night', 'sea']) {
  const r = lookup(wd);
  const rhymeSet = new Set(r.all.concat(r.homophones, [wd]));
  ok(r.sonic.every(x => !rhymeSet.has(x)), `${wd}: assonance list shares NOTHING with perfect/near/homophones`);
}

// --- assonance tier: glue-word stoplist + dedup ---
const monthS = lookup('month');
ok(none(monthS.sonic, ['was', 'has', 'been', 'such', 'them', 'into']), 'month assonance excludes was/has/been/such/them/into (stoplist)');
ok(some(monthS.sonic, ['one', 'come', 'done', 'become', 'among']), 'month assonance keeps real vowel mates (one/come/done)');
const silverDedup = new Set(silverS.sonic);
ok(silverDedup.size === silverS.sonic.length, 'assonance lists contain no duplicate words (homograph dedup)');
const dayS = lookup('day');
ok(some(dayS.sonic, ['made', 'state', 'name', 'place', 'take']), 'day assonance includes made/state/name (EY vowel mates)');

// --- Deep Search extension (data/deep/rhymes-deep.min.json) ---
// Mirrors the browser's buildMerged()/lookupAny() exactly the way the core
// mirror above mirrors lookup(). The extension is committed alongside the UI
// that consumes it, so these tests are unconditional.
{
  const deepRaw = readFileSync('data/deep/rhymes-deep.min.json');
  const DP = JSON.parse(deepRaw);
  ok(DP.coreWords === D.w.length && DP.coreGroups === D.n.length,
    'deep: extension matches this exact core build (coreWords/coreGroups)');
  ok(gzipSync(deepRaw).length < 100 * 1024, `deep: gzip under 100 KB (${gzipSync(deepRaw).length}B)`);
  ok(DP.w.length === DP.g.length && DP.w.length === DP.s.length,
    'deep: w/g/s arrays aligned');
  ok(DP.n.length === DP._m.newGroups && DP.v.length === DP._m.newGroups && DP.f.length === DP._m.newGroups,
    'deep: n/f/v cover exactly the new groups');
  ok(DP.w.every(x => /^[a-z]+$/.test(x)), 'deep: all words plain lowercase alphabetic');
  const coreSet = new Set(D.w);
  ok(DP.w.every(x => !coreSet.has(x)), 'deep: zero overlap with the core dictionary');
  const maxGid = DP.coreGroups + DP._m.newGroups;
  ok(DP.g.every(x => x >= 0 && x < maxGid), 'deep: every group id within the combined id space');
  ok(/carnegie mellon/i.test(DP._m.attribution) && /ngram/i.test(DP._m.attribution),
    'deep: attribution names CMU and Google Books Ngram');
  const vulgar = ['fuck', 'shit', 'cunt', 'bitch', 'nigger', 'faggot', 'whore', 'slut',
    'jap', 'retard', 'homo', 'dyke', 'git', 'tit', 'coon', 'gook', 'twat'];
  ok(vulgar.every(x => !DP.w.includes(x)), 'deep: profanity/offensive-term sweep clean');

  // merged structures, exactly as the client builds them
  const coreLen = D.w.length;
  const mIndex = new Map(index);
  const mGroups = groups.map(a => a && a.slice());
  const mNear = nearGroups.map(a => a && a.slice());
  const mAsn = asnGroups.map(a => a && a.slice());
  const nOf = gid => gid < D.n.length ? D.n[gid] : DP.n[gid - D.n.length];
  const vOf = gid => gid < D.v.length ? D.v[gid] : DP.v[gid - D.v.length];
  const addM = (gid, j) => {
    (mGroups[gid] ||= []).push(j);
    const ng = nOf(gid);
    if (ng >= 0) { const arr = mNear[ng] ||= []; if (arr[arr.length - 1] !== j) arr.push(j); }
    const vg = vOf(gid);
    if (vg !== undefined) (mAsn[vg] ||= []).push(j);
  };
  DP.w.forEach((word, k) => {
    const j = coreLen + k;
    mIndex.set(word, j);
    addM(DP.g[k], j);
    (DP.a2[k] || []).forEach(gid => addM(gid, j));
  });
  mAsn.forEach((a, k) => { if (a) mAsn[k] = Array.from(new Set(a)).sort((x, y) => x - y); });
  const wordAt = j => j < coreLen ? D.w[j] : DP.w[j - coreLen];
  const hidOf = j => j < coreLen ? (DP.hc[j] !== undefined ? DP.hc[j] : D.h[j]) : DP.h[j - coreLen];
  const gidsOf = j => j < coreLen
    ? [D.g[j], ...(D.a2[j] || [])]
    : [DP.g[j - coreLen], ...(DP.a2[j - coreLen] || [])];

  function lookupMerged(word) {
    const i = mIndex.get(word);
    if (i === undefined) return { known: false };
    const gids = gidsOf(i);
    const hid = hidOf(i);
    const isHomo = j => hid !== undefined && hidOf(j) === hid;
    const res = { known: true, perfect: [], deepPerfect: [], homophones: [], deepHomophones: [] };
    for (const j of (mGroups[gids[0]] || [])) {
      if (j !== i && isHomo(j) && !hidden.has(j)) (j < coreLen ? res.homophones : res.deepHomophones).push(wordAt(j));
    }
    for (const gid of gids) {
      for (const j of (mGroups[gid] || [])) {
        if (j === i || hidden.has(j) || isHomo(j)) continue;
        (j < coreLen ? res.perfect : res.deepPerfect).push(wordAt(j));
      }
    }
    return res;
  }

  // deep-only words resolve ONLY via the merged path (core stays core)
  ok(!index.has('cute') && lookupMerged('cute').known, 'deep: "cute" unknown to core, resolves merged');
  const cute = lookupMerged('cute');
  ok(some(cute.perfect, ['boot', 'shoot', 'fruit', 'suit', 'flute']),
    'deep: "cute" rhymes with common core words (boot/shoot/fruit tier)');
  // deep words join committed core groups: a rhyme-poor word gains labeled deep rhymes
  const sparkle = lookupMerged('sparkle');
  ok(sparkle.known && sparkle.perfect.length + sparkle.deepPerfect.length > 0,
    'deep: "sparkle" resolves with rhyme content');
  // homophone separation must survive the merge: no homophone in any perfect list
  let homoLeaks = 0, homoChecked = 0;
  for (const rel of Object.keys(DP.h).slice(0, 200)) {
    const word = DP.w[+rel];
    const r = lookupMerged(word);
    homoChecked++;
    const partners = new Set(r.homophones.concat(r.deepHomophones));
    if (r.perfect.some(x => partners.has(x)) || r.deepPerfect.some(x => partners.has(x))) homoLeaks++;
  }
  ok(homoChecked > 50 && homoLeaks === 0,
    `deep: homophones never leak into perfect lists (${homoChecked} checked)`);
  // measurable coverage win: top-2000 zero-perfect words gaining a deep rhyme
  let rescued = 0, zeroPerfect = 0;
  const deepGids = new Set(DP.g);
  for (const e of Object.values(DP.a2)) e.forEach(gid => deepGids.add(gid));
  for (let i = 0; i < Math.min(2000, D.w.length); i++) {
    if (hidden.has(i)) continue;
    const gids = [D.g[i], ...(D.a2[i] || [])];
    const hid = D.h[i];
    const isHomo = j => hid !== undefined && D.h[j] === hid;
    const any = gids.some(g => (groups[g] || []).some(j => j !== i && !hidden.has(j) && !isHomo(j)));
    if (any) continue;
    zeroPerfect++;
    if (gids.some(g => deepGids.has(g))) rescued++;
  }
  ok(rescued >= 100, `deep: rescues ${rescued}/${zeroPerfect} of top-2000 zero-perfect words with a real perfect rhyme`);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
