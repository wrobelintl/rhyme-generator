# Rhyme data sources & licenses

Two generated files ship from this directory, both produced by
`tools/build-rhyme-data.mjs` from the SAME two sources documented below.
They are **derived data** (pronunciation-based rhyme keys + frequency ranks),
not copies of the source dictionaries:

- `data/rhymes.min.json` — the core dictionary (~9.5k common words), loaded on
  every page view. Regenerate with `node tools/build-rhyme-data.mjs`.
- `data/deep/rhymes-deep.min.json` — the optional Deep Search extension
  (~10.5k rarer words, frequency ranks ~9.5k–20k), lazy-loaded only when a
  user clicks "Search deeper dictionary". Regenerate with
  `node tools/build-rhyme-data.mjs --deep` (reads the committed core file and
  extends its id spaces; see `docs/DEEP_SEARCH_ARCHITECTURE.md`). **No new or
  additional data source is involved** — the extension is a deeper cut of the
  same CMUdict + Ngram-ranks derivation, with the same attribution embedded in
  its `_m` metadata.

Full license texts and required notices live in **[`data/NOTICE.md`](NOTICE.md)** —
keep that file alongside BOTH generated JSON files (it lives in this directory,
which satisfies the obligation for the `deep/` subdirectory as well).

## Pronunciations — CMU Pronouncing Dictionary (CMUdict)
- Source: https://github.com/cmusphinx/cmudict (`cmudict.dict`)
- License: **BSD-2-Clause** — commercial use permitted; the license deems the
  dictionary contents *source code*, so derived data must retain the full
  copyright notice, conditions, and disclaimer. The **complete verbatim license
  text is reproduced in `data/NOTICE.md`** (a short excerpt is not sufficient).
- Copyright: (C) 1993-2015 Carnegie Mellon University. All rights reserved.
- All pronunciations (including alternates like `live(2)`) are used to build
  rhyme groups; homographs contribute to multiple groups.

## Word-frequency ranks — Google Books Ngram Viewer datasets (via gwordlist)
- Upstream: **Google Books Ngram Viewer datasets**, https://books.google.com/ngrams —
  the official datasets page states: "This compilation is licensed under a
  Creative Commons Attribution 3.0 Unported License." (**CC BY 3.0** —
  attribution-only; commercial use permitted.)
- Obtained via: `frequency-alpha-alldicts.txt` from **hackerb9/gwordlist**
  (https://github.com/hackerb9/gwordlist), whose README explicitly releases the
  data under CC BY 3.0. **Only the data file is used** — the repository's
  scripts are GPL >= 3 and none of their code is used or included here.
- Attribution (also embedded in the JSON's `_m.attribution` field): "Contains
  frequency data derived from the Google Books Ngram Viewer datasets
  (https://books.google.com/ngrams), CC BY 3.0, via gwordlist
  (https://github.com/hackerb9/gwordlist)."
- The derived rank information in `rhymes.min.json` is available under CC BY 3.0.

## Previously used source — removed
- Earlier iterations used `first20hours/google-10000-english` for word filtering
  and ranking, and this file previously (and incorrectly) described it as MIT.
  Its own LICENSE.md limits the data to educational/personal/research use and
  advises licensing from the LDC for commercial purposes. It was **removed
  entirely** in the license-safe refinement and replaced by the CC BY 3.0
  Google Books Ngram ranks above. No trace of that list remains in the
  generated data.

## Content filtering applied at build time
- Abbreviation stop-list, 2-letter real-word allowlist, and grammatical glue
  words suppressed from being offered (still resolvable as queries).
- A small profanity/slur exclusion list keeps the offered vocabulary
  family-safe (the previous source's "no swears" variant is no longer used).
- The Deep Search band applies two additional curations: 3-letter words are
  allowlisted (`DEEP_SHORT_KEEP` — the deep band's short tokens are mostly
  initialisms/name fragments) and an extra offensive-in-common-use exclusion
  (`DEEP_OFFENSIVE`) removes slur-adjacent words surfacing in that band.

## Notes
- Neither source dataset is vendored into the repo; both are fetched at build
  time and only the derived JSON files are committed.
- The core dataset is intentionally limited to common words (~9.5k + seed
  words) to keep the payload small and results free of obscure/proper-noun
  junk. The Deep Search extension deliberately stops at frequency rank ~20k —
  beyond that the corpus tail turns to junk/non-words (measured before the
  cutoff was chosen).
