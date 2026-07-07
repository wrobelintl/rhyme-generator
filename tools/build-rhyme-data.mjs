// build-rhyme-data.mjs — FindMyRhyme static rhyme-data builder (spike)
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
// Output: data/rhymes.min.json  (a single same-origin static file the browser loads).
// Run:    node tools/build-rhyme-data.mjs
//
// Rhyme-key algorithm:
//   perfectKey = phones from the LAST primary-stressed vowel (fallback: last vowel)
//                through the end, stress digits stripped.  HH AO1 R S -> "AO R S".
//   nearKey    = that stressed vowel + number of coda phones.  AO R S -> "AO|2".
//   syllables  = count of vowel phones (ARPABET vowels carry a stress digit).

import { writeFileSync, mkdirSync } from 'node:fs';

const CMUDICT_URL = 'https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict';
const COMMON_URL  = 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa-no-swears.txt';

// A small seed of the owner's example words so the prototype demonstrably covers
// them even if they fall outside the top-10k frequency list. All must be real
// CMUdict entries to be included; this only widens eligibility, never invents words.
const SEED = ['horse','course','force','source','remorse','divorce','endorse','coarse','hoarse',
  'time','rhyme','climb','prime','crime','lime','dime','chime','grime','slime',
  'line','shine','mine','fine','nine','vine','dine','pine','spine','wine','shrine','twine',
  'love','dove','glove','above','shove','day','way','say','play','stay','away','gray','clay',
  'night','light','bright','sight','write','right','might','flight','fight','tight','delight',
  'heart','start','part','apart','smart','fire','desire','wire','tire','hire','inspire',
  'song','long','strong','along','moon','soon','spoon','tune'];

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
function perfectKey(phones) {
  const idx = anchorIndex(phones);
  if (idx < 0) return null;
  return phones.slice(idx).map(p => p.replace(/\d$/, '')).join(' ');
}
function nearKey(phones) {
  const idx = anchorIndex(phones);
  if (idx < 0) return null;
  const tail = phones.slice(idx).map(p => p.replace(/\d$/, ''));
  // near rhyme = share the stressed vowel + all but the final phoneme, so only the
  // last consonant may differ (horse/north, time/line). Open syllables key on the
  // vowel alone. This keeps polysyllables from grouping on a bare vowel+length.
  return (tail.length <= 1 ? tail : tail.slice(0, -1)).join(' ');
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
    let word = parts[0].toLowerCase().replace(/\(\d+\)$/, ''); // drop variant marker word(2)
    if (!/^[a-z]+$/.test(word)) continue;                      // plain alphabetic words only
    if (!map.has(word)) map.set(word, parts.slice(1));         // keep first (primary) pronunciation
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

  // Drop single letters and common web-corpus abbreviations that are technically
  // in CMUdict but useless as rhymes (they polluted results, e.g. day -> uk/usa/k).
  const STOP = new Set(['uk','usa','aug','dvd','url','faq','html','http','www','tv','pc',
    'id','ok','re','vs','etc','inc','ltd','pm','am','ip','pdf','ceo','usb','gps','dc','la',
    'ny','ap','eg','ie','ei','jan','feb','mar','apr','jun','jul','sep','oct','nov','dec']);
  // Grammatical glue words: still resolvable as a query, but never OFFERED as a
  // rhyme (they are technically rhymes but read as junk, e.g. love -> of/thereof).
  const FUNCTION = new Set(['the','of','thereof','to','and','a','an','in','is','it','for',
    'as','at','on','or','if','that','but','from','with','this','us','what']);
  const eligible = new Set([...common, ...SEED]);

  const words = {}, perfect = {}, near = {};
  for (const w of eligible) {
    if (w.length < 2 || STOP.has(w)) continue;
    const phones = cmu.get(w);
    if (!phones) continue;
    const pk = perfectKey(phones);
    if (!pk) continue;
    const nk = nearKey(phones);
    words[w] = [pk, syllables(phones), nk];
    if (FUNCTION.has(w)) continue;   // resolvable as a query, but not offered as a rhyme
    (perfect[pk] ||= []).push(w);
    (near[nk] ||= []).push(w);
  }

  const byRank = (a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9);
  for (const k in perfect) { perfect[k].sort(byRank); if (perfect[k].length > 60) perfect[k].length = 60; }
  for (const k in near)    { near[k].sort(byRank);    if (near[k].length > 40) near[k].length = 40; }

  const out = {
    _meta: {
      generatedBy: 'tools/build-rhyme-data.mjs',
      pronunciationSource: 'CMU Pronouncing Dictionary (cmusphinx/cmudict), BSD-2-Clause',
      commonWordSource: 'first20hours/google-10000-english (usa, no swears), MIT',
      method: 'phonetic rhyme keys (last stressed vowel -> end); restricted to common words',
      words: Object.keys(words).length,
      perfectKeys: Object.keys(perfect).length,
      nearKeys: Object.keys(near).length,
    },
    words, perfect, near,
  };

  mkdirSync('data', { recursive: true });
  const json = JSON.stringify(out);
  writeFileSync('data/rhymes.min.json', json);
  console.error(`wrote data/rhymes.min.json  words=${out._meta.words} perfectKeys=${out._meta.perfectKeys} bytes=${json.length}`);
}

main().catch(e => { console.error('BUILD FAILED:', e.message); process.exit(1); });
