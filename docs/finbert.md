# FinBERT in every model

**Rule (Tyler, 2026-09-28):** FinBERT news sentiment is part of every trading
model the dashboard trains, whatever the family, experimental runs included.

The implementation is one module, `lake.sentiment` (datalake repo,
`src/lake/sentiment.py`), imported by every environment that trains: the
dashboard (`src/ml/shared/sentiment.py`, an adapter that shares the trainer's
DuckDB connection and adds the live hub's spool), `Trading/quant`
(`model/scripts/online_mtf_trader.py`), and the datalake itself. Read its module
docstring for the full rule; this page is the map.

## The nine columns

| column | meaning |
|---|---|
| `finbert_sentiment_decayed_short` | signed log(1 + \|S\|), S = Σ weight · score · 2^(−age / h_short) |
| `finbert_sentiment_decayed_long` | the same with h_long |
| `finbert_news_intensity_decayed` | log(1 + Σ \|weight\| · 2^(−age / h_short)) — how much news, not its sign |
| `finbert_news_burst_ratio` | log(1 + short news rate / long news rate) |
| `finbert_sentiment_mean_window` | mean weight · score over the window (0 when empty) |
| `finbert_article_count_window_log` | log(1 + articles in the window) |
| `finbert_minutes_since_article_log` | log(1 + minutes since the last article), capped at 7 days |
| `finbert_macro_sentiment_decayed_short` | the short sum over macro-tier routes only |
| `finbert_news_coverage_flag` | 1 when the bar opens inside a span some source was collecting, else 0 |

h_short = max(20 min, 4 bars), h_long = max(1440 min, 32 bars), window =
max(60 min, 8 bars). `score` = FinBERT p_positive − p_negative. `weight` =
relevance × direction per root; several routes to one root net to
max(+1 relevance) − max(−1 relevance).

## The causal rule

- An article counts for a bar only if it was **known strictly before the bar
  opened**, in true UTC. Futures bars from the 2026-09-09 snapshot are Pacific
  wall-clock stored as UTC and are re-localised first, taking the earlier
  instant at a DST edge.
- Known = `seen_ts` (first sight), + 15 min for GDELT (its crawl bucket).
- Only the routes known at an article's first-known time count; a copy of the
  same headline within 2 hours counts once, with the first copy's weights; the
  same title after 2 hours is a new story (fixed 2026-09-28, `FEATURE_VERSION`
  `finbert_features_v2`: a later copy had raised the earlier weight).
- Coverage spans are scoped per source (`source_reaches`): a GDELT rule's span
  covers only the roots that rule reaches.
- "No news" is 0 in the model matrix with the count, recency and coverage
  columns saying why; the lake keeps NULL.

## Where it is enforced

- `src/ml/shared/features.py compute_features` appends the family whatever
  `categories` says and raises without a symbol and timestamps
  (`feature_context(raw)` supplies them).
- The Model Cycle (`src/ml/cycle/features.py`) appends it after the z-score,
  exempt from the constant-column drop; `require_finbert` refuses to start
  without it. Its terminal prints
  `[features] FinBERT news sentiment: 9 columns (bars stamped …; coverage on X% of bars)`.
- `src/ml/shared/feature_cache.py` keys every cached matrix on the news data
  version (manifests + spool files + `FEATURE_VERSION`) and on `max_bars`, and
  recomputes a hit whose timestamps are not exactly the bars just loaded.
- `tests/test_finbert_mandatory.py` fails if any trainer, runner or the codegen
  template trains without the family.

## Coverage today — read before trusting a result

Measured 2026-09-28: the lake holds one week of GDELT history (2025-12-15 →
12-22, 2,811 MNQ articles) plus what the live hub has collected since
2026-09-28. An MNQ 5m Model Cycle run over 2025-08-01 → 12-30 had news on
**4.8% of bars**; on the other 95% every FinBERT column is 0 with the coverage
flag 0. The history grows as the hub's GDELT backfill runs (2024-01 → now,
~30 hours of unrefused requests; GDELT was refusing this address on
2026-09-28 — see `docs/live-data.md`). Until then, a model's FinBERT importance
over 2025 measures one week.

## Where to see it

`notebooks/finbert_sentiment.py` (ml-dashboard group, `/marimo`): articles,
scores by vendor, headlines per hour, the eight numbers, every column's
distribution, and the decay formula stepped term by term.
