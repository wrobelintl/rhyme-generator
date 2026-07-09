// build-rhyme-data.mjs — FindMyRhyme static rhyme-data builder (license-safe)
//
// Generates PRONUNCIATION-based rhyme data (not spelling-based) so the live,
// client-side tool can return real rhymes without any runtime API/backend.
//
// Sources (fetched at build time, NOT shipped whole; see data/SOURCES.md and
// data/NOTICE.md for full license and attribution notices):
//   * Pronunciations: CMU Pronouncing Dictionary (cmusphinx/cmudict),
//       BSD-2-Clause. (C) 1993-2015 Carnegie Mellon University.
//       https://github.com/cmusphinx/cmudict — full notice in data/NOTICE.md.
//   * Word frequency ranks: Google Books Ngram Viewer datasets (CC BY 3.0,
//       https://books.google.com/ngrams) via hackerb9/gwordlist's
//       frequency-alpha-alldicts.txt, whose README explicitly releases the data
//       under Creative Commons Attribution 3.0. DATA FILE ONLY is used — the
//       gwordlist shell scripts are GPL>=3 and none of their code is used here.
//
// Output: data/rhymes.min.json — compact, lookup-ready. Format:
//   w:  word strings in FREQUENCY ORDER (rank == index); each word stored once.
//   g:  per-word PRIMARY perfect rhyme-group id (from the word's first CMUdict
//       pronunciation). Words sharing a group id rhyme exactly.
//   a2: sparse { wordIndex: [extra group ids] } from ALTERNATE pronunciations
//       (homographs: live/read/wind/lead each belong to two rhyme groups).
//   s:  per-word syllable count as one digit ('9' = 9+), primary pronunciation.
//   n:  per perfect-group NEAR-group id, or -1 for open syllables (no near tier).
//   f:  per perfect-group rhyme-family digit = vowels in the rhyme tail capped
//       at 3 (1 = masculine, 2 = feminine, 3 = dactylic).
//   h:  sparse { wordIndex: homophone-group id } for words whose full primary
//       pronunciation is identical to another word's (sea/see). The UI lists
//       these separately — homophones are not rhymes.
//   x:  word indices that resolve as queries but are never OFFERED as rhymes.
//   v:  per perfect-group ASSONANCE-class id (similar vowel sound). Class key =
//       the tail's vowel sequence: anchor vowel kept exact, later (unstressed)
//       vowels collapsed to schwa '@' when reduced (AH0/IH0/ER0 — heard as
//       schwa) but kept when full-quality (the "happY" IY0 etc.), so
//       orange(AO @) ~ storage/foreign, people(IY @) ~ fever/legal, but
//       easy(IY IY) stays separate. Perfect groups are subsets of their
//       assonance class by construction. The UI shows these clearly labeled
//       as assonance — NEVER as rhymes.
//
// Rhyme-key algorithm:
//   rhyme tail = phones from the LAST vowel carrying stress 1 OR 2 (primary or
//   secondary — the same rule as pronouncing.py's "rhyming part"; fallback:
//   last vowel of any stress) through the end, stress digits stripped.
//   HH AO1 R S -> "AO R S"; P L EY1 G R AW2 N D -> "AW N D" (playground rhymes
//   with sound/ground — anchoring on secondary stress fixes late-stress
//   compounds). No spelling fallback anywhere.
// Near-rhyme key: tail minus its final phoneme, plus the MANNER CLASS of that
//   final phoneme (nasal/stop/fricative/affricate/liquid/glide): time(AY M) ~
//   line(AY N), never like(AY K). Open-syllable tails get no near tier.
//
// Run:  node tools/build-rhyme-data.mjs           (core file, as always)
//       node tools/build-rhyme-data.mjs --deep    (Deep Search extension file)
//
// --deep builds data/deep/rhymes-deep.min.json, the OPTIONAL lazy-loaded
// Deep Search extension (see docs/DEEP_SEARCH_ARCHITECTURE.md). It does NOT
// touch data/rhymes.min.json: the committed core file is read as the source
// of truth for group-id spaces, and the extension references those committed
// ids directly. The build ABORTS if the fetched sources no longer reproduce
// the committed core mappings (upstream drift), so a stale extension can
// never be generated against a mismatched core. Extension format:
//   coreWords/coreGroups: id-space offsets this file extends (guards mismatch).
//   w:  deep words in frequency order; global word index = coreWords + i.
//   g:  primary perfect-group id per deep word — ids < coreGroups join the
//       committed core groups; ids >= coreGroups are new groups.
//   a2: sparse { deepIndex: [extra group ids] } (alternate pronunciations).
//   s:  syllable digit per deep word.
//   n:  near-group id per NEW group (index = gid - coreGroups), -1 = none.
//       Ids <= max core near id join existing core near groups.
//   f:  family digit per NEW group.
//   v:  assonance-class id per NEW group (existing class ids join core).
//   h:  sparse { deepIndex: homophone-group id } — ids reuse core homophone
//       groups where the pronunciation matches one.
//   hc: sparse { coreWordIndex: homophone-group id } for CORE words that gain
//       their first homophone via a deep word (core h stays untouched).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const CMUDICT_URL = 'https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict';
const FREQ_URL = 'https://raw.githubusercontent.com/hackerb9/gwordlist/master/frequency-alpha-alldicts.txt';

// Cap on frequency-ranked vocabulary (SEED words are added on top if missing).
const TARGET_WORDS = 9500;

// Seed words guaranteeing coverage of the owner's test cases and the homograph/
// homophone demonstrations, regardless of frequency cutoff. All must exist in
// CMUdict to be included; this widens eligibility, never invents words.
const SEED = ['horse','course','force','source','remorse','divorce','endorse','coarse','hoarse',
  'time','rhyme','climb','prime','crime','lime','dime','chime','grime','slime',
  'line','shine','mine','fine','nine','vine','dine','pine','spine','wine','shrine','twine',
  'love','dove','glove','above','shove','day','way','say','play','stay','away','gray','clay',
  'night','light','bright','sight','write','right','might','flight','fight','tight','delight',
  'heart','start','part','apart','smart','fire','desire','wire','tire','hire','inspire',
  'song','long','strong','along','moon','soon','spoon','tune','playground','ground','sound',
  'found','around','sea','see','red','bed','head','said','instead','need','feed','speed',
  'indeed','kind','find','mind','behind','lead','read','wind','live','give','five','drive','alive'];

// Grammatical glue words: resolvable as a query, never OFFERED as a rhyme.
const FUNCTION = new Set(['the','of','thereof','to','and','a','an','in','is','it','for',
  'as','at','on','or','if','that','but','from','with','this','us','what']);

// Web/print abbreviations that pollute rhyme lists.
const STOP = new Set(['usa','aug','dvd','url','faq','html','http','www','etc','inc',
  'ltd','pdf','ceo','usb','gps','jan','feb','mar','apr','jun','jul','sep','oct','nov','dec']);

// 2-letter tokens that are real words (corpus is full of state codes/units).
const TWO_LETTER_REAL = new Set(['of','to','in','is','on','by','it','or','be','at','as',
  'an','we','us','if','my','do','no','he','up','so','me','go','oh','hi','ha','lo','ah',
  'um','ye','yo','aw','eh','uh']);

// Family-safe exclusion: strong profanity/slurs are excluded from the dataset
// entirely (the previous frequency source shipped a pre-filtered variant; the
// Ngram data does not). Queries for these return the not-in-dictionary state.
const PROFANITY = new Set(['fuck','fucking','fucker','fucked','shit','shitty','bullshit',
  'cunt','bitch','bitches','asshole','assholes','dick','dicks','cock','cocks','pussy',
  'nigger','niggers','faggot','faggots','wanker','whore','whores','slut','sluts','tits']);

// Manner classes for the final-consonant near-rhyme match.
const MANNER = {
  M: 'nas', N: 'nas', NG: 'nas',
  P: 'stp', T: 'stp', K: 'stp', B: 'stp', D: 'stp', G: 'stp',
  F: 'fri', V: 'fri', TH: 'fri', DH: 'fri', S: 'fri', Z: 'fri', SH: 'fri', ZH: 'fri', HH: 'fri',
  CH: 'aff', JH: 'aff',
  L: 'liq', R: 'liq',
  W: 'gli', Y: 'gli',
};

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} -> HTTP ${r.status}`);
  return r.text();
}

const isVowel = p => /\d$/.test(p); // in cmudict.dict only vowels carry a stress digit

// Anchor: last vowel with stress 1 OR 2 (pronouncing.py's rule); fallback: last vowel.
function anchorIndex(phones) {
  for (let i = phones.length - 1; i >= 0; i--) if (/[12]$/.test(phones[i])) return i;
  for (let i = phones.length - 1; i >= 0; i--) if (isVowel(phones[i])) return i;
  return -1;
}
function tailOf(phones) {
  const idx = anchorIndex(phones);
  if (idx < 0) return null;
  const raw = phones.slice(idx);
  return { raw, stripped: raw.map(p => p.replace(/\d$/, '')) };
}
const perfectKeyOf = tail => tail.stripped.join(' ');
function nearKeyOf(tail) {
  if (tail.stripped.length < 2) return null;
  const last = tail.stripped[tail.stripped.length - 1];
  const cls = isVowel(tail.raw[tail.raw.length - 1]) ? 'vow' : (MANNER[last] || 'oth');
  return tail.stripped.slice(0, -1).join(' ') + '|' + cls;
}
const syllables = phones => phones.filter(isVowel).length;
const tailVowels = tail => tail.raw.filter(isVowel).length;

// Assonance (similar-vowel-sound) key of a tail: the vowel sequence with the
// anchor vowel kept exact and later unstressed vowels collapsed to '@' when
// REDUCED (schwa-like). Everything after the anchor is stress-0 by construction
// (the anchor is the LAST stress-1/2 vowel), so only the reduced/full split
// matters there. Full-quality unstressed vowels (e.g. the final IY0 of "easy")
// keep their identity so "easy" does not claim assonance with "people".
const REDUCED = new Set(['AH0', 'IH0', 'ER0']);
function assonanceKeyOf(tail) {
  const vowels = tail.raw.filter(isVowel);
  return vowels
    .map((p, i) => (i > 0 && REDUCED.has(p)) ? '@' : p.replace(/\d$/, ''))
    .join(' ');
}

// Parse CMUdict keeping ALL pronunciations per word (word, word(2), word(3)...).
function parseCmudict(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith(';;;')) continue;
    const hash = line.indexOf('#');
    const core = hash >= 0 ? line.slice(0, hash) : line;
    const parts = core.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const word = parts[0].toLowerCase().replace(/\(\d+\)$/, '');
    if (!/^[a-z]+$/.test(word)) continue;
    const arr = map.get(word) || [];
    arr.push(parts.slice(1));
    map.set(word, arr);
  }
  return map;
}

// Parse gwordlist frequency-alpha-alldicts.txt: "#RANKING WORD COUNT PERCENT CUMULATIVE".
function parseFreq(text) {
  const ranked = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const cols = line.trim().split(/\s+/);
    if (cols.length < 2) continue;
    const word = cols[1].toLowerCase();
    if (/^[a-z]+$/.test(word)) ranked.push(word);
  }
  return ranked;
}

async function main() {
  console.error('fetching CMUdict + gwordlist frequency data...');
  const [cmuText, freqText] = await Promise.all([fetchText(CMUDICT_URL), fetchText(FREQ_URL)]);
  const cmu = parseCmudict(cmuText);
  const ranked = parseFreq(freqText);
  console.error(`parsed cmudict words=${cmu.size} freq-ranked words=${ranked.length}`);

  const rank = new Map();
  ranked.forEach((w, i) => { if (!rank.has(w)) rank.set(w, i); });
  SEED.forEach((w, i) => { if (!rank.has(w)) rank.set(w, ranked.length + i); });

  const okWord = w =>
    (w.length >= 3 || TWO_LETTER_REAL.has(w)) &&
    !STOP.has(w) && !PROFANITY.has(w) && cmu.has(w);

  // Top-ranked eligible words up to TARGET_WORDS, then union the SEED set.
  const chosen = [];
  for (const cand of ranked) {
    if (chosen.length >= TARGET_WORDS) break;
    if (okWord(cand)) chosen.push(cand);
  }
  const set = new Set(chosen);
  for (const cand of SEED) if (okWord(cand) && !set.has(cand)) { chosen.push(cand); set.add(cand); }
  chosen.sort((a, b) => rank.get(a) - rank.get(b));

  const w = [], g = [], x = [];
  const a2 = {}, h = {};
  let s = '';
  const pkId = new Map();      // perfect key string -> group id
  const nkId = new Map();      // near key string -> near group id
  const akId = new Map();      // assonance key string -> assonance class id
  const nearOf = [];           // per group id -> near group id | -1
  const asnOf = [];            // per group id -> assonance class id
  let fam = '';                // per group id -> family digit (1/2/3)
  const fullPron = new Map();  // full primary pronunciation -> [word index...]

  const gidForTail = tail => {
    const pk = perfectKeyOf(tail);
    let gid = pkId.get(pk);
    if (gid === undefined) {
      gid = pkId.size;
      pkId.set(pk, gid);
      const nk = nearKeyOf(tail);
      if (nk === null) nearOf[gid] = -1;
      else {
        let nid = nkId.get(nk);
        if (nid === undefined) { nid = nkId.size; nkId.set(nk, nid); }
        nearOf[gid] = nid;
      }
      const ak = assonanceKeyOf(tail);
      let aid = akId.get(ak);
      if (aid === undefined) { aid = akId.size; akId.set(ak, aid); }
      asnOf[gid] = aid;
      fam += String(Math.min(3, tailVowels(tail)));
    }
    return gid;
  };

  for (const word of chosen) {
    const prons = cmu.get(word);
    const tails = [];
    for (const phones of prons) {
      const t = tailOf(phones);
      if (t) tails.push(t);
    }
    if (!tails.length) continue;

    const idx = w.length;
    const gids = [];
    for (const t of tails) {
      const gid = gidForTail(t);
      if (!gids.includes(gid)) gids.push(gid);
    }
    g.push(gids[0]);
    if (gids.length > 1) a2[idx] = gids.slice(1);
    s += String(Math.min(9, syllables(prons[0])));
    if (FUNCTION.has(word)) x.push(idx);

    const fp = prons[0].join(' ');
    if (!fullPron.has(fp)) fullPron.set(fp, []);
    fullPron.get(fp).push(idx);

    w.push(word);
  }

  // Homophone groups: words sharing an identical full PRIMARY pronunciation.
  let hid = 0;
  for (const idxs of fullPron.values()) {
    if (idxs.length < 2) continue;
    for (const i of idxs) h[i] = hid;
    hid++;
  }

  const out = {
    _m: {
      generatedBy: 'tools/build-rhyme-data.mjs',
      pronunciationSource: 'CMU Pronouncing Dictionary (cmusphinx/cmudict), BSD-2-Clause — full notice in data/NOTICE.md',
      frequencySource: 'Google Books Ngram Viewer datasets (CC BY 3.0, https://books.google.com/ngrams) via hackerb9/gwordlist frequency-alpha-alldicts.txt (data released CC BY 3.0)',
      attribution: 'Rank data derived from the Google Books Ngram Viewer datasets, CC BY 3.0, https://books.google.com/ngrams (via gwordlist, https://github.com/hackerb9/gwordlist). Pronunciations (C) 1993-2015 Carnegie Mellon University, BSD-2-Clause; see data/NOTICE.md.',
      method: 'phonetic rhyme keys (last stress-1/2 vowel -> end); alternate pronunciations unioned; homophones split; near = same tail, final consonant may differ within manner class; assonance = tail vowel sequence, reduced unstressed vowels collapsed to schwa',
      words: w.length,
      perfectKeys: pkId.size,
      nearKeys: nkId.size,
      assonanceKeys: akId.size,
    },
    w, g, a2, s, n: nearOf, f: fam, h, x, v: asnOf,
  };

  mkdirSync('data', { recursive: true });
  const json = JSON.stringify(out);
  writeFileSync('data/rhymes.min.json', json);
  const gz = gzipSync(Buffer.from(json)).length;
  console.error(`wrote data/rhymes.min.json  words=${w.length} perfectKeys=${pkId.size} nearKeys=${nkId.size} assonanceKeys=${akId.size} altWords=${Object.keys(a2).length} homophoneWords=${Object.keys(h).length} raw=${json.length}B gzip=${gz}B`);
}

// ---------------------------------------------------------------------------
// Deep Search extension builder (--deep). Measured basis for the cutoff: the
// gwordlist band up to ~20k total words is predominantly real writer-useful
// vocabulary; past ~30k the corpus tail turns to junk/non-words. 20k is also
// what keeps the extension under the 100 KB gzip budget. Do not raise this
// without re-eyeballing band samples AND re-measuring gzip size.
const DEEP_TARGET_TOTAL = 20000;
const DEEP_FILE = 'data/deep/rhymes-deep.min.json';
const DEEP_GZ_BUDGET = 100 * 1024; // hard: preferred shard budget from the architecture note

// Deep-band curation (measured against the actual 9.5k-20k band): 3-letter
// tokens whose FIRST appearance is this deep in the frequency ranks are mostly
// initialisms and name fragments (cia, hud, nec, jon, mba...), so deep
// 3-letter words are allowlisted — every word below was eyeballed as a real
// dictionary word a writer might rhyme. 1-2 letter words still go through
// TWO_LETTER_REAL. 4+ letter words pass on frequency alone.
const DEEP_SHORT_KEEP = new Set(['sol','bot','hog','oft','nil','yen','spy','bro','lea','ace',
  'dew','hub','hop','rib','zip','din','aye','nod','ark','hue','elk','sap','axe','sow','cop',
  'ale','jam','owl','opt','wee','tub','tow','rub','vat','woe','ski','yon','rum','elm','pea',
  'fro','hum','wan','vet','ivy','gin','amp','aft','rig','tug','gem','roe','cue','spa','pal',
  'abs','bug','pus','hug','tee','vow','vie','icy','sip','zoo','hem','peg','err','nun','rug',
  'cad','wed','rip','rag','soy','ode','hew','sod','ply','urn','imp','ire','bog','dun','gym',
  'pod','oat','ail','ebb','rap','cot','ape','lax','sew','nap','zen','hoe','cur','mug','sly',
  'paw','jug','pew','eel','wig','flu','sag','oar','ohm','bra','coo','woo','elf','jig','ova',
  'ado','asp','sob','gag','duo','bum','bun','pun','cub','ewe','pep','lug','mic','tic','tot',
  'mod','wow']);

// Offensive-in-common-use terms that surface in the deep band (the shared
// PROFANITY set remains the family-safe baseline for both builds; these are
// the additional hits found by sweeping the actual band).
const DEEP_OFFENSIVE = new Set(['jap','japs','retard','retards','homo','homos','dyke','dykes',
  'tit','git','coon','coons','gook','gooks','negro','negroes','fag','fags','twat','wank']);

async function buildDeep() {
  const core = JSON.parse(readFileSync('data/rhymes.min.json', 'utf8'));
  console.error(`core: words=${core.w.length} groups=${core.n.length} (committed file is left untouched)`);

  console.error('fetching CMUdict + gwordlist frequency data...');
  const [cmuText, freqText] = await Promise.all([fetchText(CMUDICT_URL), fetchText(FREQ_URL)]);
  const cmu = parseCmudict(cmuText);
  const ranked = parseFreq(freqText);

  // --- reconstruct the committed id spaces from core + sources (drift guards) ---
  const pk2gid = new Map();   // perfect key -> committed group id
  const gid2tail = new Map(); // committed group id -> tail (for near/asn/family of shared keys)
  const fullPronCore = new Map(); // full primary pron -> [core word index...]
  let drift = 0;
  core.w.forEach((word, i) => {
    const prons = cmu.get(word);
    if (!prons) { drift++; return; }
    const gids = [core.g[i], ...(core.a2[i] || [])];
    const pks = [];
    for (const phones of prons) {
      const t = tailOf(phones);
      if (!t) continue;
      const k = perfectKeyOf(t);
      if (!pks.some(p => p.k === k)) pks.push({ k, t });
    }
    pks.forEach((p, j) => {
      if (j >= gids.length) return;
      const prev = pk2gid.get(p.k);
      if (prev === undefined) { pk2gid.set(p.k, gids[j]); gid2tail.set(gids[j], p.t); }
      else if (prev !== gids[j]) drift++;
    });
    const fp = prons[0].join(' ');
    (fullPronCore.get(fp) || fullPronCore.set(fp, []).get(fp)).push(i);
  });
  if (drift > 0 || pk2gid.size !== core.n.length) {
    throw new Error(`upstream sources no longer reproduce the committed core ` +
      `(drift=${drift}, reconstructed=${pk2gid.size}/${core.n.length}). ` +
      `Rebuild the core first, ship it, then rebuild --deep.`);
  }
  // near/assonance id spaces: recompute each committed group's keys, map to its
  // committed ids, and verify the mapping is consistent (same drift guard).
  const nk2nid = new Map(), ak2aid = new Map();
  let maxNid = -1, maxAid = -1, idDrift = 0;
  for (const [gid, tail] of gid2tail) {
    const nk = nearKeyOf(tail);
    const nid = core.n[gid];
    if (nid >= 0) {
      if (nk === null) idDrift++;
      else {
        const prev = nk2nid.get(nk);
        if (prev === undefined) nk2nid.set(nk, nid);
        else if (prev !== nid) idDrift++;
      }
      maxNid = Math.max(maxNid, nid);
    }
    const ak = assonanceKeyOf(tail);
    const aid = core.v[gid];
    const prevA = ak2aid.get(ak);
    if (prevA === undefined) ak2aid.set(ak, aid);
    else if (prevA !== aid) idDrift++;
    maxAid = Math.max(maxAid, aid);
  }
  if (idDrift > 0) throw new Error(`near/assonance id reconstruction drifted (${idDrift} conflicts) — rebuild core first.`);
  console.error(`id spaces reconstructed: ${pk2gid.size} groups, ${nk2nid.size} near keys, ${ak2aid.size} assonance classes, 0 conflicts`);

  // --- pick the deep band: next eligible ranked words after the core set ---
  const coreSet = new Set(core.w);
  const okWord = w =>
    (w.length >= 4 || TWO_LETTER_REAL.has(w) || DEEP_SHORT_KEEP.has(w)) &&
    !STOP.has(w) && !PROFANITY.has(w) && !DEEP_OFFENSIVE.has(w) &&
    cmu.has(w) && !coreSet.has(w);
  const deepWords = [];
  for (const cand of ranked) {
    if (core.w.length + deepWords.length >= DEEP_TARGET_TOTAL) break;
    if (okWord(cand)) { deepWords.push(cand); coreSet.add(cand); }
  }

  // --- build the extension in the committed id spaces ---
  const coreGroups = core.n.length;
  let nextGid = coreGroups, nextNid = maxNid + 1, nextAid = maxAid + 1;
  const newPk = new Map();
  const w = [], g = [], nNew = [], vNew = [];
  const a2 = {}, h = {}, hc = {};
  let s = '', fNew = '';
  const fullPron = new Map(); // full primary pron -> [deep relative index...]

  const gidForTailDeep = tail => {
    const pk = perfectKeyOf(tail);
    let gid = pk2gid.get(pk);
    if (gid !== undefined) return gid;
    gid = newPk.get(pk);
    if (gid !== undefined) return gid;
    gid = nextGid++;
    newPk.set(pk, gid);
    const nk = nearKeyOf(tail);
    if (nk === null) nNew.push(-1);
    else {
      let nid = nk2nid.get(nk);
      if (nid === undefined) { nid = nextNid++; nk2nid.set(nk, nid); }
      nNew.push(nid);
    }
    const ak = assonanceKeyOf(tail);
    let aid = ak2aid.get(ak);
    if (aid === undefined) { aid = nextAid++; ak2aid.set(ak, aid); }
    vNew.push(aid);
    fNew += String(Math.min(3, tailVowels(tail)));
    return gid;
  };

  for (const word of deepWords) {
    const prons = cmu.get(word);
    const tails = [];
    for (const phones of prons) {
      const t = tailOf(phones);
      if (t) tails.push(t);
    }
    if (!tails.length) continue;
    const rel = w.length;
    const gids = [];
    for (const t of tails) {
      const gid = gidForTailDeep(t);
      if (!gids.includes(gid)) gids.push(gid);
    }
    g.push(gids[0]);
    if (gids.length > 1) a2[rel] = gids.slice(1);
    s += String(Math.min(9, syllables(prons[0])));
    const fp = prons[0].join(' ');
    (fullPron.get(fp) || fullPron.set(fp, []).get(fp)).push(rel);
    w.push(word);
  }

  // --- homophones across the union: deep<->deep and deep<->core ---
  let maxHid = -1;
  for (const v of Object.values(core.h)) maxHid = Math.max(maxHid, v);
  let nextHid = maxHid + 1;
  for (const [fp, rels] of fullPron) {
    const coreIdxs = fullPronCore.get(fp) || [];
    if (rels.length + coreIdxs.length < 2) continue;
    // reuse the committed group id if any core member already carries one
    let hid;
    for (const ci of coreIdxs) if (core.h[ci] !== undefined) { hid = core.h[ci]; break; }
    if (hid === undefined) hid = nextHid++;
    for (const rel of rels) h[rel] = hid;
    for (const ci of coreIdxs) if (core.h[ci] === undefined) hc[ci] = hid;
  }

  const out = {
    _m: {
      generatedBy: 'tools/build-rhyme-data.mjs --deep',
      role: 'OPTIONAL lazy-loaded Deep Search extension of data/rhymes.min.json — never fetched until the user explicitly asks (docs/DEEP_SEARCH_ARCHITECTURE.md)',
      pronunciationSource: 'CMU Pronouncing Dictionary (cmusphinx/cmudict), BSD-2-Clause — full notice in data/NOTICE.md',
      frequencySource: 'Google Books Ngram Viewer datasets (CC BY 3.0, https://books.google.com/ngrams) via hackerb9/gwordlist frequency-alpha-alldicts.txt (data released CC BY 3.0)',
      attribution: 'Rank data derived from the Google Books Ngram Viewer datasets, CC BY 3.0, https://books.google.com/ngrams (via gwordlist, https://github.com/hackerb9/gwordlist). Pronunciations (C) 1993-2015 Carnegie Mellon University, BSD-2-Clause; see data/NOTICE.md.',
      words: w.length,
      newGroups: newPk.size,
    },
    coreWords: core.w.length,
    coreGroups,
    w, g, a2, s, n: nNew, f: fNew, v: vNew, h, hc,
  };

  mkdirSync('data/deep', { recursive: true });
  const json = JSON.stringify(out);
  const gz = gzipSync(Buffer.from(json)).length;
  if (gz > DEEP_GZ_BUDGET) {
    throw new Error(`deep extension is ${gz}B gzipped — over the ${DEEP_GZ_BUDGET}B budget. ` +
      `Lower DEEP_TARGET_TOTAL instead of shipping this.`);
  }
  writeFileSync(DEEP_FILE, json);
  console.error(`wrote ${DEEP_FILE}  deepWords=${w.length} newGroups=${newPk.size} ` +
    `newNearIds=${nextNid - maxNid - 1} newAsnClasses=${nextAid - maxAid - 1} ` +
    `deepHomophones=${Object.keys(h).length} coreHomophoneLinks=${Object.keys(hc).length} ` +
    `raw=${json.length}B gzip=${gz}B`);
}

const run = process.argv.includes('--deep') ? buildDeep : main;
run().catch(e => { console.error('BUILD FAILED:', e.message); process.exit(1); });
