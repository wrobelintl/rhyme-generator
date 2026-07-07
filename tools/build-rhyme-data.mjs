// build-rhyme-data.mjs — FindMyRhyme static rhyme-data builder (refined)
//
// Generates PRONUNCIATION-based rhyme data (not spelling-based) so the live,
// client-side tool can return real rhymes without any runtime API/backend.
//
// Sources (fetched at build time, NOT shipped whole):
//   * Pronunciations: CMU Pronouncing Dictionary (cmusphinx/cmudict), BSD-2-Clause.
//       https://github.com/cmusphinx/cmudict  — see data/SOURCES.md for the notice.
//   * Common-word filter/ranking: first20hours/google-10000-english (MIT),
//       used only to keep the dataset small, common, and junk-free.
//
// Output: data/rhymes.min.json — compact, lookup-ready. Format:
//   w: word strings in FREQUENCY ORDER (rank == index); each word stored once.
//   g: per-word PERFECT rhyme-group id. Words sharing g[i] rhyme exactly.
//   s: per-word syllable count as one digit ('9' = 9 or more).
//   n: per perfect-group NEAR-group id, or -1 when the group's rhyme tail is the
//      bare stressed vowel (open syllable) — those get no near tier.
//   x: indices of words that resolve as queries but are never OFFERED as rhymes
//      (grammatical glue words like "of"/"the").
// The browser derives groupId -> [word...] maps in one pass at load; because w is
// frequency-ordered, every derived group is automatically frequency-sorted. The
// spike format stored each word string up to 3x (words + perfect + near maps);
// this format stores it exactly once, which is where the size win comes from.
//
// Rhyme-key algorithm (exact rhymes — unchanged from the spike):
//   perfect key = phones from the LAST primary-stressed vowel (fallback: last
//                 vowel) through the end, stress digits stripped.
//                 HH AO1 R S -> "AO R S".  No spelling fallback anywhere.
//
// Near-rhyme key (tightened in this refinement):
//   same phones from the stressed vowel through the second-to-last phoneme, plus
//   the MANNER CLASS of the final phoneme. Near rhymes may differ only in their
//   final consonant, and only within the same class (nasal / stop / fricative /
//   affricate / liquid / glide). So time (AY M) ~ line (AY N) — both nasal — but
//   time is NOT near like (AY K, stop) or life (AY F, fricative). Open-syllable
//   words (day -> EY) get no near tier at all, which removes the old weak
//   open-vowel dumps (day -> page/date/name).
//
// Run:  node tools/build-rhyme-data.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const CMUDICT_URL = 'https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict';
const COMMON_URL  = 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa-no-swears.txt';

// A small seed of the owner's example words so the engine demonstrably covers
// them even if they fall outside the top-10k frequency list. All must be real
// CMUdict entries to be included; this only widens eligibility, never invents words.
const SEED = ['horse','course','force','source','remorse','divorce','endorse','coarse','hoarse',
  'time','rhyme','climb','prime','crime','lime','dime','chime','grime','slime',
  'line','shine','mine','fine','nine','vine','dine','pine','spine','wine','shrine','twine',
  'love','dove','glove','above','shove','day','way','say','play','stay','away','gray','clay',
  'night','light','bright','sight','write','right','might','flight','fight','tight','delight',
  'heart','start','part','apart','smart','fire','desire','wire','tire','hire','inspire',
  'song','long','strong','along','moon','soon','spoon','tune'];

// Manner classes for the final-consonant near-rhyme match.
const MANNER = {
  M: 'nas', N: 'nas', NG: 'nas',                                     // nasals
  P: 'stp', T: 'stp', K: 'stp', B: 'stp', D: 'stp', G: 'stp',        // stops
  F: 'fri', V: 'fri', TH: 'fri', DH: 'fri', S: 'fri', Z: 'fri',
  SH: 'fri', ZH: 'fri', HH: 'fri',                                   // fricatives
  CH: 'aff', JH: 'aff',                                              // affricates
  L: 'liq', R: 'liq',                                                // liquids
  W: 'gli', Y: 'gli',                                                // glides
};

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} -> HTTP ${r.status}`);
  return r.text();
}

const isVowel = p => /\d$/.test(p); // in cmudict.dict only vowels carry a stress digit

function anchorIndex(phones) {
  for (let i = phones.length - 1; i >= 0; i--) if (/1$/.test(phones[i])) return i; // primary stress
  for (let i = phones.length - 1; i >= 0; i--) if (isVowel(phones[i])) return i;    // fallback: last vowel
  return -1;
}
// tail = phones from the anchor to the end; raw keeps stress digits (for vowel
// detection on the final phone), stripped is what keys are built from.
function tailOf(phones) {
  const idx = anchorIndex(phones);
  if (idx < 0) return null;
  const raw = phones.slice(idx);
  return { raw, stripped: raw.map(p => p.replace(/\d$/, '')) };
}
const perfectKeyOf = tail => tail.stripped.join(' ');
function nearKeyOf(tail) {
  if (tail.stripped.length < 2) return null; // open syllable: no near tier
  const last = tail.stripped[tail.stripped.length - 1];
  const cls = isVowel(tail.raw[tail.raw.length - 1]) ? 'vow' : (MANNER[last] || 'oth');
  return tail.stripped.slice(0, -1).join(' ') + '|' + cls;
}
const syllables = phones => phones.filter(isVowel).length;

function parseCmudict(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith(';;;')) continue;
    const hash = line.indexOf('#');
    const core = hash >= 0 ? line.slice(0, hash) : line;
    const parts = core.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const word = parts[0].toLowerCase().replace(/\(\d+\)$/, ''); // drop variant marker word(2)
    if (!/^[a-z]+$/.test(word)) continue;                        // plain alphabetic words only
    if (!map.has(word)) map.set(word, parts.slice(1));           // keep first (primary) pronunciation
  }
  return map;
}

async function main() {
  console.error('fetching CMUdict + common-word list...');
  const [cmuText, commonText] = await Promise.all([fetchText(CMUDICT_URL), fetchText(COMMON_URL)]);
  const cmu = parseCmudict(cmuText);

  const common = commonText.split('\n').map(w => w.trim().toLowerCase()).filter(w => /^[a-z]+$/.test(w));
  const rank = new Map();
  common.forEach((w, i) => { if (!rank.has(w)) rank.set(w, i); });
  // seed words get a rank just past the common list so they are eligible but not top-ranked
  SEED.forEach((w, i) => { if (!rank.has(w)) rank.set(w, common.length + i); });

  // Drop common web-corpus abbreviations that are technically in CMUdict but
  // useless as rhymes (they polluted results, e.g. day -> uk/usa/k).
  const STOP = new Set(['usa','aug','dvd','url','faq','html','http','www','etc','inc',
    'ltd','pdf','ceo','usb','gps','jan','feb','mar','apr','jun','jul','sep','oct','nov','dec']);
  // The 10k web corpus is full of 2-letter junk (state codes, units: ca/md/hp/mg/
  // hz/lb...). Allowlist the 2-letter tokens that are real English words; drop
  // the rest. Single letters are always dropped.
  const TWO_LETTER_REAL = new Set(['of','to','in','is','on','by','it','or','be','at','as',
    'an','we','us','if','my','do','no','he','up','so','me','go','oh','hi','ha','lo','ah',
    'um','ye','yo','aw','eh','uh']);
  // Grammatical glue words: still resolvable as a query, but never OFFERED as a
  // rhyme (they are technically rhymes but read as junk, e.g. love -> of/thereof).
  const FUNCTION = new Set(['the','of','thereof','to','and','a','an','in','is','it','for',
    'as','at','on','or','if','that','but','from','with','this','us','what']);

  // Eligible words, frequency-sorted (rank == final array index).
  const eligible = [...new Set([...common, ...SEED])]
    .filter(w => (w.length >= 3 || TWO_LETTER_REAL.has(w)) && !STOP.has(w))
    .sort((a, b) => rank.get(a) - rank.get(b));

  const w = [], g = [], x = [];
  let s = '';
  const pkId = new Map();   // perfect key string -> group id
  const nkId = new Map();   // near key string -> near group id
  const nearOf = [];        // per perfect-group id -> near group id | -1

  for (const word of eligible) {
    const phones = cmu.get(word);
    if (!phones) continue;
    const tail = tailOf(phones);
    if (!tail) continue;

    const pk = perfectKeyOf(tail);
    let gid = pkId.get(pk);
    if (gid === undefined) {
      gid = pkId.size;
      pkId.set(pk, gid);
      const nk = nearKeyOf(tail);
      if (nk === null) { nearOf[gid] = -1; }
      else {
        let nid = nkId.get(nk);
        if (nid === undefined) { nid = nkId.size; nkId.set(nk, nid); }
        nearOf[gid] = nid;
      }
    }

    if (FUNCTION.has(word)) x.push(w.length);
    g.push(gid);
    s += String(Math.min(9, syllables(phones)));
    w.push(word);
  }

  const out = {
    _m: {
      generatedBy: 'tools/build-rhyme-data.mjs',
      pronunciationSource: 'CMU Pronouncing Dictionary (cmusphinx/cmudict), BSD-2-Clause',
      commonWordSource: 'first20hours/google-10000-english (usa, no swears), MIT',
      method: 'phonetic rhyme keys (last stressed vowel -> end); near = same tail, final consonant may differ within manner class; common words only',
      words: w.length,
      perfectKeys: pkId.size,
      nearKeys: nkId.size,
    },
    w, g, s, n: nearOf, x,
  };

  mkdirSync('data', { recursive: true });
  const json = JSON.stringify(out);
  writeFileSync('data/rhymes.min.json', json);
  const gz = gzipSync(Buffer.from(json)).length;
  console.error(`wrote data/rhymes.min.json  words=${w.length} perfectKeys=${pkId.size} nearKeys=${nkId.size} raw=${json.length}B gzip=${gz}B`);
}

main().catch(e => { console.error('BUILD FAILED:', e.message); process.exit(1); });
