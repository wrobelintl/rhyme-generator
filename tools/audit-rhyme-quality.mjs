// audit-rhyme-quality.mjs — local rhyme-quality harness for FindMyRhyme.
//
// Audits the COMMITTED artifacts (data/rhymes.min.json + index.html + notice
// files + ads.txt) against golden cases (tools/rhyme-quality-cases.json),
// structural invariants, static safety checks, payload budgets, and
// license/attribution requirements. Plain Node, no dependencies, no network.
//
// Usage:
//   node tools/audit-rhyme-quality.mjs             # report; exit 1 on any HARD failure
//   node tools/audit-rhyme-quality.mjs --backlog   # also (re)write docs/RHYME_QUALITY_BACKLOG.md
//
// Design rules (anti-quality-theater):
//   * HARD checks are binary and gate the exit code. They are never averaged
//     into a score. The headline is HARD BLOCKERS: PASS/FAIL, not a number.
//   * ADVISORY checks report and feed the backlog; they never affect exit code.
//   * Every advisory finding names concrete words/groups — no vibes.
//   * No user data is read or collected, ever (the privacy policy promises
//     searches never leave the browser; quality work must respect that).
//
// Env: AUDIT_ALLOW_LARGE=1 downgrades the >100 KB gzip failure to a warning.
// Reserved for a deliberate, owner-approved coverage expansion — never set it
// in normal validation.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const WRITE_BACKLOG = process.argv.includes('--backlog');

const raw = readFileSync('data/rhymes.min.json');
const D = JSON.parse(raw);
const CASES = JSON.parse(readFileSync('tools/rhyme-quality-cases.json', 'utf8'));
const html = readFileSync('index.html', 'utf8');

// Assonance-tier display stoplist — MUST stay in sync with SONIC_STOP in
// index.html (pure grammatical auxiliaries; never shown as vowel mates).
const SONIC_STOP = new Set(['was', 'has', 'had', 'does', 'did', 'been', 'are', 'were',
  'will', 'would', 'could', 'should', 'shall', 'can', 'than', 'such', 'into', 'onto',
  'them', 'thus']);

// ---------- result collection ----------
const hard = [], advisory = [], dims = new Map();
function check(dim, isHard, okFlag, msg) {
  (isHard ? hard : advisory).push({ ok: okFlag, msg, dim });
  const d = dims.get(dim) || { pass: 0, total: 0, hard: isHard };
  d.total++; if (okFlag) d.pass++;
  dims.set(dim, d);
  console.log(`${okFlag ? 'PASS' : isHard ? 'FAIL' : 'WARN'} [${dim}] ${msg}`);
}

// ---------- 1. structural invariants (hard) ----------
{
  const dim = 'structure';
  const groupCount = D.n.length;
  check(dim, true, D.w.length === D.g.length && D.w.length === D.s.length,
    `parallel arrays consistent (w=${D.w.length} g=${D.g.length} s=${D.s.length})`);
  check(dim, true, D.f.length === groupCount, `family digits cover every group (f=${D.f.length} n=${groupCount})`);
  check(dim, true, D.g.every(gid => gid >= 0 && gid < groupCount), 'every primary group id in range');
  check(dim, true, Object.entries(D.a2).every(([k, arr]) =>
    +k < D.w.length && arr.every(gid => gid >= 0 && gid < groupCount && gid !== D.g[+k])),
    'alternate-pronunciation ids valid and distinct from primary');
  check(dim, true, Object.keys(D.h).every(k => +k < D.w.length), 'homophone indices in range');
  check(dim, true, (D.x || []).every(i => i >= 0 && i < D.w.length), 'suppressed indices in range');
  check(dim, true, new Set(D.w).size === D.w.length, 'no duplicate words');
  check(dim, true, D.w.every(w => /^[a-z]+$/.test(w)), 'every word is plain lowercase a-z (no markup/junk possible)');
  check(dim, true, Array.isArray(D.v) && D.v.length === groupCount,
    `assonance ids cover every group (v=${(D.v || []).length} n=${groupCount})`);
  check(dim, true, (D.v || []).every(a => a >= 0 && a < D._m.assonanceKeys),
    `every assonance id in range (${D._m.assonanceKeys} classes declared)`);
}

// ---------- 2. lookup mirror (same derivation as the browser client) ----------
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
for (const [k, extra] of Object.entries(D.a2)) for (const gid of extra) { (groups[gid] ||= []).push(+k); addNear(gid, +k); addAsn(gid, +k); }
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
  return { known: true, senses, homophones, all: senses.flatMap(s => s.perfect.concat(s.near)), sonic: senses.flatMap(s => s.sonic) };
}

// ---------- 3. golden cases ----------
for (const c of CASES.goldens) {
  const dim = 'goldens';
  const r = lookup(c.word);
  const perfect0 = r.senses[0]?.perfect || [];
  if (c.mustInclude) check(dim, !!c.hard, c.mustInclude.every(x => perfect0.includes(x)),
    `${c.word}: perfect includes ${c.mustInclude.join('/')}`);
  if (c.mustIncludeAny) check(dim, !!c.hard, c.mustIncludeAny.some(x => perfect0.includes(x)),
    `${c.word}: perfect includes one of ${c.mustIncludeAny.join('/')}`);
  if (c.mustExclude) check(dim, !!c.hard, c.mustExclude.every(x => !r.all.includes(x)),
    `${c.word}: never returns ${c.mustExclude.join('/')}`);
  if (c.nearMustNotInclude) check(dim, !!c.hard, c.nearMustNotInclude.every(x => !r.senses.some(s => s.near.includes(x))),
    `${c.word}: near tier excludes ${c.nearMustNotInclude.join('/')}`);
  if (c.expectNoNear) check(dim, !!c.hard, r.senses.every(s => s.near.length === 0),
    `${c.word}: no near tier (open syllable)`);
  if (c.expectNoPerfect) check(dim, !!c.hard, r.senses.every(s => s.perfect.length === 0),
    `${c.word}: no fake exact rhymes`);
}

// ---------- 4. homographs ----------
for (const c of CASES.homographs) {
  const dim = 'homographs';
  const r = lookup(c.word);
  if (c.minSenses) check(dim, !!c.hard, r.senses.length >= c.minSenses,
    `${c.word}: has >=${c.minSenses} pronunciation senses (${r.senses.length})`);
  for (const grp of c.sensesMustReach || []) check(dim, !!c.hard, grp.some(x => r.all.includes(x)),
    `${c.word}: reaches ${grp.slice(0, 3).join('/')} group`);
}

// ---------- 5. homophones ----------
for (const c of CASES.homophones) {
  const dim = 'homophones';
  const r = lookup(c.word);
  for (const x of c.homophoneIncludes || []) check(dim, !!c.hard, r.homophones.includes(x),
    `${c.word}: lists ${x} as homophone`);
  for (const x of c.neverOfferedAsRhyme || []) check(dim, !!c.hard, !r.all.includes(x),
    `${c.word}: ${x} not offered as a rhyme`);
}

// ---------- 5b. sounds-like / assonance tier ----------
for (const c of CASES.soundsLike || []) {
  const dim = 'sounds-like';
  const r = lookup(c.word);
  if (c.minSonic) check(dim, !!c.hard, r.sonic.length >= c.minSonic,
    `${c.word}: offers >=${c.minSonic} assonance words (${r.sonic.length})`);
  if (c.sonicIncludesAny) check(dim, !!c.hard, c.sonicIncludesAny.some(x => r.sonic.includes(x)),
    `${c.word}: assonance includes one of ${c.sonicIncludesAny.join('/')}`);
  if (c.sonicExcludes) check(dim, !!c.hard, c.sonicExcludes.every(x => !r.sonic.includes(x)),
    `${c.word}: assonance never lists ${c.sonicExcludes.join('/')}`);
  // Separation is a product rule, not a per-case option: the assonance list
  // may never overlap the rhyme tiers, the homophones, or the query itself.
  const rhymeSet = new Set(r.all.concat(r.homophones, [c.word]));
  check(dim, true, r.sonic.every(x => !rhymeSet.has(x)),
    `${c.word}: assonance stays fully separate from rhyme/homophone tiers`);
  check(dim, true, new Set(r.sonic).size === r.sonic.length,
    `${c.word}: assonance list has no duplicates`);
}

// ---------- 6. rhyme families ----------
for (const c of CASES.families) {
  const dim = 'families';
  const i = index.get(c.word);
  check(dim, !!c.hard, i !== undefined && +D.f[D.g[i]] === c.family,
    `${c.word}: family digit = ${c.family}`);
}

// ---------- 7. honesty: unknown words ----------
for (const w of CASES.unknowns.words) {
  check('honesty', !!CASES.unknowns.hard, lookup(w).known === false, `unknown "${w}" -> honest not-found`);
}

// ---------- 8. family safety ----------
for (const w of CASES.familySafety.mustBeAbsent) {
  check('family-safety', !!CASES.familySafety.hard, index.get(w) === undefined, `profanity "${w[0]}***" absent from dataset`);
}

// ---------- 9. static client safety checks (index.html; static, not executed) ----------
{
  const dim = 'client-static';
  const s = html.lastIndexOf('<script>');
  const e = html.indexOf('</script>', s);
  const script = s >= 0 && e > s ? html.slice(s + 8, e) : '';
  let parses = true;
  try { new Function(script); } catch { parses = false; }
  check(dim, true, script.length > 500 && parses, 'inline client script parses (no SyntaxError)');
  check(dim, true, script.includes('if (!word) return;'), 'empty input is a no-op (static check)');
  check(dim, true, (script.match(/\.textContent = word/g) || []).length >= 2,
    'query word rendered via textContent (escaping preserved, static check)');
  check(dim, true, !script.includes('${word}'), 'no raw ${word} interpolation in client script');
  const fetches = script.match(/fetch\('([^']+)'/g) || [];
  check(dim, true, fetches.length === 2 && fetches.some(f => f.includes('data/rhymes.min.json'))
    && fetches.some(f => f.includes('data/deep/rhymes-deep.min.json')),
    'runtime fetches are exactly the two same-origin static data files (core eager, deep lazy)');
  const ext = html.match(/<script[^>]*\bsrc=[^>]*>/g) || [];
  check(dim, true, ext.length === 1 && ext[0].includes('adsbygoogle.js') && ext[0].includes('ca-pub-6286935824893984'),
    'only external script is the unchanged AdSense loader');

  // ---- assonance tier honesty (labels + explainer + separation affordances) ----
  check(dim, true, script.includes('Similar vowel sound — assonance'),
    'assonance section carries the honest "Similar vowel sound" label (never "rhymes")');
  check(dim, true, script.includes('These are not exact rhymes — they share a similar vowel sound.'),
    'assonance explainer present verbatim');
  check(dim, true, script.includes('function revealSonic') && script.includes('Show words with a similar vowel sound'),
    'assonance reveal control wired for rhyme-rich words');
  check(dim, true, script.includes('SONIC_STOP'),
    'assonance glue-word stoplist present in client');
  check(dim, true, script.includes('Similar vowel sound (not exact rhymes):'),
    'copy-all labels assonance as not-exact-rhymes');

  // ---- guide-page deep links (/?w=word): parsed locally, strictly validated ----
  check(dim, true, script.includes('URLSearchParams') && script.includes('[a-z]{1,30}'),
    'deep-link ?w= param is regex-validated before use (local parse only)');

  // ---- UI workflow affordances (client-side upgrade; must not add data/API/telemetry) ----
  const chipCount = (html.match(/class="chip"/g) || []).length;
  const exWords = ['love', 'time', 'day', 'night', 'horse', 'orange'];
  check(dim, true, script.includes('function runExample') && chipCount >= 6
    && exWords.every(w => html.includes("runExample('" + w + "')")),
    'starter example chips wired (>=6, incl. love/time/day/night/horse/orange)');
  check(dim, true, script.includes('function copyAll') && script.includes('function copyText')
    && /navigator\.clipboard/.test(script) && /catch \(e\)/.test(script),
    'copy-all handler present, uses clipboard API, and is guarded (no throw)');
  check(dim, true, (script.match(/fetch\(/g) || []).length === 2,
    'copy/controls add no new fetch (clipboard is local; only the two static data fetches)');
  check(dim, true, script.includes('function setSort') && script.includes('function toggleNear')
    && script.includes('currentSort') && script.includes('includeNear'),
    'writer controls wired (sort: syllables/A-Z, include-near toggle)');
  check(dim, false, script.includes('Perfect rhymes') && script.includes('Near rhymes') && script.includes('Homophones'),
    'plain result section labels present (Perfect / Near / Homophones)');
  check(dim, false, /searches run in your browser/i.test(html) || /searches stay on your device/i.test(html),
    'in-browser privacy reassurance shown near the input');
}

// ---------- 9b. content pages + site link integrity ----------
{
  const dim = 'content-pages';
  const GUIDES = ['rhyme-guide.html', 'near-rhymes.html', 'rhyme-schemes.html', 'songwriting-rhymes.html',
    'poetry-rhymes.html', 'rap-rhymes.html', 'assonance.html', 'homophones.html'];
  const missing = GUIDES.filter(f => !existsSync(f));
  check(dim, true, missing.length === 0, `all 8 guide pages exist${missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''}`);
  const pages = GUIDES.filter(f => existsSync(f)).map(f => ({ f, t: readFileSync(f, 'utf8') }));

  for (const { f, t } of pages) {
    const scripts = t.match(/<script/g) || [];
    check(dim, true, scripts.length === 1 && t.includes('adsbygoogle.js') && t.includes('ca-pub-6286935824893984'),
      `${f}: only script is the AdSense loader`);
    check(dim, true, !t.includes('{{') && !t.includes('}}'), `${f}: no unreplaced template placeholders`);
    check(dim, true, t.includes('class="site-nav"') && t.includes('href="/#guides"'), `${f}: site navigation present`);
    check(dim, true, t.includes(`<link rel="canonical" href="https://findmyrhyme.com/${f}">`), `${f}: canonical self-reference`);
    check(dim, true, /<meta name="description" content="[^"]{40,}">/.test(t), `${f}: meta description present`);
    check(dim, true, t.includes('class="try-box"') && t.includes('/?w='), `${f}: try-box links back to the rhyme tool`);
    check(dim, true, t.includes('prefers-color-scheme: dark'), `${f}: dark-mode styles present`);
    check(dim, true, !/fetch\(|localStorage|sessionStorage|document\.cookie|<form|<iframe|<img/.test(t),
      `${f}: no runtime surface (fetch/storage/form/iframe/img)`);
    const words = t.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim().split(' ').length;
    check(dim, false, words >= 700 && words <= 1500, `${f}: body word count in range (${words})`);
  }

  // Unsupportable marketing claims are banned sitewide (narrow phrases to avoid false positives).
  const banned = ['best rhym', 'largest rhym', 'millions of', 'guaranteed', 'number one rhym', '#1 rhym', 'world-class'];
  for (const { f, t } of pages.concat([{ f: 'index.html', t: html }])) {
    const hits = banned.filter(b => t.toLowerCase().includes(b));
    check(dim, true, hits.length === 0, `${f}: no unsupportable marketing claims${hits.length ? ' (' + hits.join('; ') + ')' : ''}`);
  }

  // Internal link integrity: every same-origin href in every root page must resolve to a real file.
  const rootFiles = ['index.html', 'privacy.html', 'terms.html'].concat(GUIDES).filter(f => existsSync(f));
  const broken = [];
  for (const f of rootFiles) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/href="([^"]+)"/g)) {
      const h = m[1];
      if (/^https?:\/\//.test(h) || h.startsWith('mailto:')) continue;
      let p = h.split('#')[0].split('?')[0];
      if (p === '') continue; // pure fragment/query link stays on-page
      p = p === '/' ? 'index.html' : p.replace(/^\//, '');
      if (p && !existsSync(p)) broken.push(`${f} -> ${h}`);
    }
  }
  check(dim, true, broken.length === 0,
    `no broken internal links${broken.length ? ' (' + broken.slice(0, 5).join(' | ') + ')' : ''}`);

  // External anchor links limited to the existing allowlist (ad-loader script is checked elsewhere).
  const extBad = [];
  for (const f of rootFiles) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"/g)) {
      if (!/warrenbg\.com|adssettings\.google\.com/.test(m[1])) extBad.push(`${f} -> ${m[1]}`);
    }
  }
  check(dim, true, extBad.length === 0,
    `external anchor links limited to existing allowlist${extBad.length ? ' (' + extBad.slice(0, 5).join(' | ') + ')' : ''}`);

  // Homepage integration + sitemap coverage.
  check(dim, true, html.includes('id="guides"') && GUIDES.every(g => html.includes(`href="/${g}"`)),
    'homepage #guides section links all 8 guide pages');
  const sm = existsSync('sitemap.xml') ? readFileSync('sitemap.xml', 'utf8') : '';
  check(dim, true, GUIDES.every(g => sm.includes(`https://findmyrhyme.com/${g}`)), 'sitemap lists all 8 guide pages');
  const smMissing = [...sm.matchAll(/<loc>https:\/\/findmyrhyme\.com\/([^<]*)<\/loc>/g)]
    .map(m => m[1] === '' ? 'index.html' : m[1]).filter(p => !existsSync(p));
  check(dim, true, smMissing.length === 0,
    `every sitemap URL maps to an existing file${smMissing.length ? ' (missing: ' + smMissing.join(', ') + ')' : ''}`);
}

// ---------- 9c. Deep Search extension (lazy, optional, user-triggered) ----------
{
  const dim = 'deep-data';
  const DEEP_PATH = 'data/deep/rhymes-deep.min.json';
  check(dim, true, existsSync(DEEP_PATH), 'deep extension file exists');
  if (existsSync(DEEP_PATH)) {
    const deepRaw = readFileSync(DEEP_PATH);
    let DP = null;
    try { DP = JSON.parse(deepRaw); } catch (e) { /* fall through */ }
    check(dim, true, !!DP, 'deep extension parses as JSON');
    if (DP) {
      check(dim, true, DP.coreWords === D.w.length && DP.coreGroups === D.n.length,
        `deep extension matches this exact core build (${DP.coreWords}/${DP.coreGroups})`);
      const deepGz = gzipSync(deepRaw).length;
      check(dim, true, deepGz < 100_000, `deep gzip under 100 KB shard budget (${deepGz} B)`);
      check(dim, true, DP.w.length === DP.g.length && DP.w.length === DP.s.length
        && DP.n.length === DP._m.newGroups && DP.v.length === DP._m.newGroups && DP.f.length === DP._m.newGroups,
        'deep arrays structurally aligned (w/g/s per word, n/f/v per new group)');
      check(dim, true, DP.w.every(x => /^[a-z]+$/.test(x)), 'deep words all plain lowercase alphabetic');
      const coreSet = new Set(D.w);
      check(dim, true, DP.w.every(x => !coreSet.has(x)), 'deep words never duplicate core words');
      const vulgar = ['fuck', 'shit', 'cunt', 'bitch', 'nigger', 'faggot', 'whore', 'slut',
        'jap', 'retard', 'homo', 'dyke', 'git', 'tit', 'coon', 'gook', 'twat'];
      const vhits = vulgar.filter(x => DP.w.includes(x));
      check(dim, true, vhits.length === 0, `deep profanity/offensive sweep clean${vhits.length ? ' (' + vhits.join(',') + ')' : ''}`);
      check(dim, true, /carnegie mellon/i.test(DP._m.attribution || '') && /ngram/i.test(DP._m.attribution || ''),
        'deep attribution names CMU and Google Books Ngram');
    }
  }
  // UI wiring: lazy, same-origin, constant URL, clearly labeled, user-triggered.
  const s = html.indexOf('<script>');
  const e = html.lastIndexOf('</script>');
  const script = s >= 0 && e > s ? html.slice(s + 8, e) : '';
  const fetches = [...script.matchAll(/fetch\(\s*'([^']+)'/g)].map(m => m[1]);
  check(dim, true, fetches.length === 2
    && fetches.includes('data/rhymes.min.json') && fetches.includes('data/deep/rhymes-deep.min.json'),
    `script fetches exactly the two same-origin data files (${fetches.join(', ')})`);
  check(dim, true, script.includes('rhymes-deep') && script.indexOf('\'data/deep/rhymes-deep.min.json\'') > script.indexOf('function deepSearch'),
    'deep fetch lives inside the user-triggered deepSearch() only');
  check(dim, true, script.includes('Search deeper dictionary'), 'CTA copy present: "Search deeper dictionary"');
  check(dim, true, script.includes('This word is not in the quick dictionary'),
    'unknown-word copy present: "This word is not in the quick dictionary"');
  check(dim, true, script.includes('Want broader results?'), 'weak-result copy present: "Want broader results?"');
  check(dim, true, script.includes('Loading expanded dictionary…'), 'loading copy present');
  check(dim, true, script.includes('Deep Search</strong> — expanded dictionary. These results may include rarer words.'),
    'deep results banner carries the required labels');
  check(dim, true, script.includes('Could not load the expanded dictionary'), 'network-failure copy present');
  check(dim, true, script.includes('deepActive = false') && script.includes('function lookup('),
    'deep mode resets on every new search');
}

// ---------- 10. payload budgets ----------
const gz = gzipSync(raw).length;
{
  const dim = 'payload';
  const allowLarge = process.env.AUDIT_ALLOW_LARGE === '1';
  check(dim, !allowLarge, gz < 100_000, `gzipped payload under 100 KB (${gz} B)${allowLarge ? ' [override active]' : ''}`);
  check(dim, false, gz < 90_000, `gzipped payload under 90 KB soft budget (${gz} B)`);
  check(dim, false, raw.length < 250_000, `raw payload under 250 KB (${raw.length} B)`);
}

// ---------- 11. license / notice / operational checks ----------
{
  const dim = 'license-ops';
  check(dim, true, existsSync('data/NOTICE.md') && /Carnegie Mellon University/.test(readFileSync('data/NOTICE.md', 'utf8'))
    && /Creative Commons Attribution 3\.0/.test(readFileSync('data/NOTICE.md', 'utf8')),
    'data/NOTICE.md carries CMU notice + CC-BY 3.0 attribution');
  check(dim, true, existsSync('data/SOURCES.md') && /gwordlist/.test(readFileSync('data/SOURCES.md', 'utf8')),
    'data/SOURCES.md exists and names the frequency source');
  const blob = raw.toString();
  check(dim, true, !/first20hours|google-10000|10000-english/i.test(blob),
    'generated data has no removed-source reference');
  check(dim, true, !/first20hours|MIT/.test(readFileSync('tools/build-rhyme-data.mjs', 'utf8')),
    'builder has no removed-source reference or stray MIT claim');
  check(dim, true, /Carnegie Mellon/.test(D._m.attribution) && /books\.google\.com\/ngrams/.test(D._m.attribution),
    'JSON _m.attribution names CMU and Google Books Ngram');
  const ads = existsSync('ads.txt') ? readFileSync('ads.txt', 'utf8').trim() : '';
  check(dim, true, ads === 'google.com, pub-6286935824893984, DIRECT, f08c47fec0942fa0',
    'ads.txt exists with the exact single AdSense line');
}

// ---------- 12. dataset-wide sweep (advisory; feeds the backlog) ----------
const sweep = {};
{
  const dim = 'sweep';
  // Common words with zero offered perfect rhymes = coverage candidates.
  // The assonance tier "rescues" such a word when it gives >=3 suggestions.
  sweep.coverageCandidates = [];
  sweep.rescued = 0;
  for (let i = 0; i < Math.min(2000, D.w.length); i++) {
    if (hidden.has(i)) continue;
    const r = lookup(D.w[i]);
    if (r.senses.every(se => se.perfect.length === 0)) {
      sweep.coverageCandidates.push({ word: D.w[i], rank: i });
      if (r.sonic.length >= 3) sweep.rescued++;
    }
  }
  check(dim, false, sweep.coverageCandidates.length <= 120,
    `top-2000 words with zero offered perfect rhymes: ${sweep.coverageCandidates.length} (coverage candidates)`);
  check(dim, false, sweep.rescued >= sweep.coverageCandidates.length * 0.9,
    `assonance rescues ${sweep.rescued}/${sweep.coverageCandidates.length} zero-perfect words with >=3 suggestions`);

  // Largest near groups = places to eyeball for slant-rhyme junk.
  sweep.bigNear = nearGroups
    .map((arr, ng) => ({ ng, size: (arr || []).length, sample: (arr || []).slice(0, 6).map(j => D.w[j]) }))
    .filter(x => x.size > 0).sort((a, b) => b.size - a.size).slice(0, 5);
  check(dim, false, (sweep.bigNear[0]?.size || 0) <= 220,
    `largest near group size: ${sweep.bigNear[0]?.size || 0} (sample: ${sweep.bigNear[0]?.sample.join(', ') || '-'})`);

  // Homograph / homophone / suppression coverage numbers (informational).
  sweep.altWords = Object.keys(D.a2).length;
  sweep.homophoneWords = Object.keys(D.h).length;
  sweep.suppressed = (D.x || []).length;
  check(dim, false, sweep.altWords > 500, `homograph coverage: ${sweep.altWords} words carry alternate pronunciations`);
  check(dim, false, sweep.homophoneWords > 100, `homophone coverage: ${sweep.homophoneWords} words in homophone groups`);
}

// ---------- report ----------
const hardFail = hard.filter(c => !c.ok);
const advFail = advisory.filter(c => !c.ok);
console.log('\n================ RHYME QUALITY REPORT ================');
console.log(`words=${D.w.length} perfectKeys=${D._m.perfectKeys} payload=${raw.length}B raw / ${gz}B gz`);
console.log('\nPer-dimension results (pass/total):');
for (const [dim, d] of dims) console.log(`  ${dim.padEnd(14)} ${d.pass}/${d.total}${d.hard ? '' : '  (advisory)'}`);
console.log(`\nHARD BLOCKERS: ${hardFail.length === 0 ? 'PASS — all hard checks green, safe to ship' : `FAIL — ${hardFail.length} blocker(s)`}`);
hardFail.forEach(c => console.log(`  BLOCKER: [${c.dim}] ${c.msg}`));
console.log(`Advisory items open: ${advFail.length} (trend/backlog only — never a gate)`);
advFail.forEach(c => console.log(`  advisory: [${c.dim}] ${c.msg}`));

// ---------- backlog ----------
if (WRITE_BACKLOG) {
  const cc = sweep.coverageCandidates.slice(0, 15);
  const md = `# Rhyme Quality Backlog

Generated by \`node tools/audit-rhyme-quality.mjs --backlog\` — regenerate after
any data/engine change. Everything below is derived from the committed
\`data/rhymes.min.json\`; **no user search data exists or is ever collected**
(the privacy policy promises searches never leave the browser). Items marked
*speculative* are judgment calls for the owner, not measurements.

## Current status
- Hard blockers: **${hardFail.length === 0 ? 'NONE — all hard checks pass' : hardFail.length + ' FAILING'}**
- Advisory items open: ${advFail.length}
- Dataset: ${D.w.length} words, ${D._m.perfectKeys} perfect keys, ${D._m.assonanceKeys} assonance classes, ${sweep.altWords} homograph words, ${sweep.homophoneWords} homophone words, ${sweep.suppressed} suppressed glue words
- Payload: ${raw.length} B raw / ${gz} B gzipped (hard ceiling 100 KB, soft budget 90 KB)

## Hard blockers
${hardFail.length ? hardFail.map(c => `- [${c.dim}] ${c.msg}`).join('\n') : '- None.'}

## Candidate improvements (measured)
- **Coverage gaps:** ${sweep.coverageCandidates.length} of the top-2000 words have zero offered perfect rhymes. The assonance tier now rescues ${sweep.rescued} of them (${Math.round(100 * sweep.rescued / Math.max(1, sweep.coverageCandidates.length))}%) with >=3 clearly-labeled similar-vowel-sound suggestions. Highest-frequency examples: ${cc.map(c => `${c.word} (#${c.rank})`).join(', ')}. *Speculative: which of these users actually search.*
- **Largest near groups (eyeball for junk):**
${sweep.bigNear.map(b => `  - near-group #${b.ng}: ${b.size} words — sample: ${b.sample.join(', ')}`).join('\n')}
${advFail.length ? '- **Open advisory checks:**\n' + advFail.map(c => `  - [${c.dim}] ${c.msg}`).join('\n') : ''}

## Deferred ideas (speculative — owner decision required)
- Pin CMUdict/gwordlist to specific upstream commits in the builder so rebuilds are reproducible (currently fetches latest).
- Extract the lookup mirror (client / test-rhymes / this audit each carry a copy) into a shared \`tools/lib-rhyme-lookup.mjs\`; refactor client to match at next engine change.
- Content-hashed data filename + immutable caching (group ids renumber per build).
- Vocabulary expansion toward ~20k words (~110–130 KB gz estimated — would need the AUDIT_ALLOW_LARGE ceiling decision).
- Git pre-push hook running this audit (convention today: run it manually before any push).
- jsdom-based UI regression suite lives outside the repo (scratchpad) to keep the repo dependency-free; adopt into repo only if a devDependency is ever accepted.

## Never doing (by policy)
- No user-search logging or feedback telemetry (contradicts the live privacy promise).
- No AI-generated rhyme output, no runtime APIs, no scraping, no lyrics data.
`;
  writeFileSync('docs/RHYME_QUALITY_BACKLOG.md', md);
  console.log('\nwrote docs/RHYME_QUALITY_BACKLOG.md');
}

process.exit(hardFail.length ? 1 : 0);
