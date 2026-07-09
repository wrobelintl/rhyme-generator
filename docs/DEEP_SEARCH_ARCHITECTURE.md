# Deep Search — architecture note

Status: **local prototype on branch `product/deep-search-architecture` — not shipped.**
Task: FMR-DEEP-SEARCH-ARCHITECTURE-001. Read alongside `tools/build-rhyme-data.mjs`
(`--deep` mode) and the `deep-data` dimension in `tools/audit-rhyme-quality.mjs`.

## What it is

An optional, user-triggered "Search deeper dictionary" flow. The default tool is
unchanged: the 9,516-word core dictionary loads eagerly and answers instantly.
When a word is missing from the core ("This word is not in the quick
dictionary.") or its results are thin ("Want broader results?"), the user can
click **Search deeper dictionary**. That click — and nothing else — fetches ONE
additional same-origin static file:

```
data/deep/rhymes-deep.min.json   (~220 KB raw / ~92 KB gzipped)
```

which extends the dictionary by **10,484 rarer words** (frequency ranks ~9.5k
to ~20k). Deep results render in separate, clearly-labeled sections under a
banner — **"Deep Search — expanded dictionary. These results may include rarer
words."** — and never mix into the default lists. Deep mode resets on every new
search; the downloaded data is kept for the page's life, so later deep searches
are instant.

## Chosen architecture: one extension file in the committed id spaces

The extension is built by `node tools/build-rhyme-data.mjs --deep`, which:

1. Reads the **committed** `data/rhymes.min.json` (never rewrites it).
2. Fetches the same two build-time sources as the core build (CMUdict,
   gwordlist frequency ranks).
3. **Reconstructs the committed id spaces** by recomputing each core word's
   rhyme keys and mapping them onto the committed group ids — and **aborts on
   any conflict** (verified: 4,705/4,705 groups, 4,205 near keys, 229 assonance
   classes reconstructed with 0 conflicts). A drifted upstream can never
   produce a mismatched extension.
4. Emits only the extension: deep words reference core group ids directly
   (`gid < coreGroups` joins an existing rhyme group; `gid >= coreGroups` is a
   new group with its own near/family/assonance entries). Homophone links
   across the core/deep boundary ship as a small `hc` map so sound-twins are
   never presented as rhymes.

The client (`buildMerged()` in index.html) merges by concatenation: deep word
indices start at `coreWords`, so "is this a deep word" is a single integer
comparison, member arrays stay frequency-ordered, and the ONE lookup code path
serves both modes (in core mode every index is below `coreWords`, so deep
splits are empty by construction — default behavior is not merely tested to be
unchanged, it is unchanged structurally). A `coreWords`/`coreGroups` stamp in
the extension is checked at load; a stale cached extension is rejected rather
than mis-joined.

## Rejected options

- **B. Alphabet shards — functionally wrong.** Rhymes of a word scatter across
  every first letter; an unknown-word search would need up to 26 fetches, and a
  partial failure silently drops results. Dead on arrival for phonetic data.
- **C. Rhyme-key/sound-key shards — a privacy leak at this site.** The shard
  URL would encode the sound of the user's query, so CDN request logs would
  receive query-derived information. This site's core promise is "searches
  never leave your browser"; a constant-URL single file transmits nothing about
  the query. Sharding also needs a word→shard index shipped up front (grows
  the initial payload) and hundreds of mostly-cold cache entries. Revisit only
  if vocabulary ever needs to grow past ~50k words — pair it with a bloom-filter
  index and a privacy review if that day comes.
- **D. Hybrid tier shards (perfect + assonance split)** — same total bytes as
  one file, plus two-fetch failure states. No benefit at this scale.

## Why the 20k cutoff (measured, not guessed)

Sampling the actual gwordlist bands: ranks 9.5k–20k are predominantly real
writer vocabulary (cheat, cherish, shadowy, mushroom, cynical, resilient, woe,
sparkle, hover, dreamed) with tolerable proper-noun noise; by 30k the band
turns name-heavy and obscure; ranks 30k–50k are corpus-tail junk (temerous,
respeak, cabok, klenge). 20k is also what fits the 100 KB gzip shard budget:
~92 KB gz measured. `DEEP_GZ_BUDGET` makes the builder fail rather than exceed
it. Band curation on top of the shared filters: 3-letter deep words are
allowlisted (`DEEP_SHORT_KEEP` — the band's 3-letter tokens are mostly
initialisms like cia/hud/nec) and an offensive-term exclusion
(`DEEP_OFFENSIVE`) removes the slur-adjacent hits found by sweeping the band
(jap, retard, homo, dyke, tit, git, ...).

## Payload

| file | raw | gzip | when loaded |
|---|---|---|---|
| data/rhymes.min.json (core) | 207,742 B | 84,458 B | page load (unchanged, byte-identical) |
| data/deep/rhymes-deep.min.json | ~220 KB | **~92 KB** | only on explicit user click |
| index.html growth (measured) | +13.2 KB raw | +3.3 KB gz | page load |

Initial-load change is the index.html growth only. The deep file is never
prefetched, preloaded, or speculatively loaded.

## User flow

1. Search "sparkle" → "This word is not in the quick dictionary." +
   **[Search deeper dictionary]**. (Weak-result words — fewer than 8 perfect
   rhymes — instead get "Want broader results?" + the same button. Strong
   results get no button: no clutter where deep adds nothing.)
2. Click → "Loading expanded dictionary…" → results under the Deep Search
   banner. Tiers stay separated: perfect / near / homophones / assonance each
   get their own labeled "Deep Search — more …" section; deep chips render in
   a dashed style. Caps: 24 deep perfect / 12 deep near / 12 deep assonance
   per sense, frequency-ordered (the caps are deliberately tighter than the
   default tiers' — rarer band, shorter list).
3. Words that exist in neither dictionary get an honest empty state ("not in
   the quick dictionary or the expanded dictionary"). A failed fetch shows
   "Could not load the expanded dictionary. Check your connection and try
   again." with a retry button; core results are unaffected.
4. A new search returns to core-only results. Chained taps: once the user has
   explicitly loaded the expanded dictionary, tapping a deep-only chip keeps
   resolving it (still under the banner) — the network fetch is only ever
   click-triggered, and that is the promise that matters.
5. Copy-all appends deep tiers under a "Deep Search - expanded dictionary (may
   include rarer words):" label, WYSIWYG with the visible sections.

## Privacy behavior

- The deep fetch is a **constant URL** — no query string, no fragment, nothing
  derived from the user's word. The CDN can only learn "someone opened the
  expanded dictionary," which it learns about the core dictionary today.
- Lookup remains 100% client-side; no API, no backend, no telemetry, no
  logging, no storage. The privacy policy's "searches never leave your
  browser" claim required **no changes** (verified: privacy.html untouched).

## Data sources & licenses

Identical to the core build: CMU Pronouncing Dictionary (BSD-2-Clause) and
Google Books Ngram frequency ranks via gwordlist (CC BY 3.0). The extension's
`_m` metadata carries the same attribution block as the core file, and
`data/NOTICE.md` sits alongside both generated files in `data/`. No new data
source was introduced. (Note for ship time: `data/SOURCES.md` describes only
`data/rhymes.min.json`; add one line mentioning the deep extension when this
ships — that file was out of this task's allowed edit list.)

## Test plan (implemented)

- `node tools/test-rhymes.mjs` — 69 checks (14 new): extension/core build-stamp
  match, gzip budget, structural alignment, alphabetic-only, zero core overlap,
  id-space bounds, attribution, offensive-term sweep, merged-lookup goldens
  ("cute" resolves and rhymes with boot/shoot-tier core words), homophone
  leak-proofing over 200 merged homophone groups, and a measured coverage
  assertion (deep gives ≥100 of the top-2000 zero-perfect words a real perfect
  rhyme; currently 136/437).
- `node tools/audit-rhyme-quality.mjs` — new hard `deep-data` dimension (18
  checks): file/stamp/budget/structure/content plus UI wiring (exactly two
  same-origin fetches; deep fetch only inside `deepSearch()`; all required
  labels and states present; deep mode resets per search).
- Browser QA (scratchpad CDP harness, kept out of the repo): 23/24 automated
  flows — default searches unchanged, no deep fetch before opt-in, single
  constant-URL fetch after, labeling, honest empties, per-search reset, chained
  taps, no CTA on strong words, blocked-network failure + retry, mobile/dark,
  no overflow. (The 1 "fail" was the harness's own allowlist missing Google's
  pre-existing ad-serving chain.)

## Ship readiness assessment

Prototype is functional and validated locally. Before shipping to production:

1. Owner review of the deep band quality in the UI (search a dozen real words).
2. Add the one-line deep-extension mention to `data/SOURCES.md`.
3. Regenerate `docs/RHYME_QUALITY_BACKLOG.md` is already done in this branch;
   keep it in the ship commit.
4. Decide whether the "weak result" threshold (<8 perfect) shows the button too
   often or not often enough — a taste call, cheap to tune.
5. Ship via the normal fast-forward flow, then verify live that the deep file
   returns 200, is fetched only on click (DevTools network tab), and Cloudflare
   serves it gzipped/brotli.

Known limitations (deliberate): proper nouns in the deep band are filtered only
by the short-word allowlist, not exhaustively (fischer/rotterdam-type words
remain — real words, honestly labeled as rarer); syllable filters apply to deep
chips but deep words aren't in the syllable toolbar's count badges; the deep
file has no content-hash filename (matches the core file's convention — the
build-stamp check protects against stale-cache mis-joins).
