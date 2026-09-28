# Live data hub

The dashboard's live prices and news come from one Python process, the **live
hub** (`live/`, `python -m live --port 17192`), supervised by the dashboard as a
sidecar and proxied at `/api/live/*`. It streams, scores and **lands** — every
payload it fetches reaches `E:\lake` write-once, per the one-source-of-truth
rule. Config: `src/config/live.json`. Plan of record:
`docs/plans/2026-09-28-live-data-finbert-claude.md`.

## Sources

| Source | What | Latency | Landed as |
|---|---|---|---|
| OANDA v20 pricing stream (practice account) | 18 forex pairs, bid/ask ticks → 1-minute mid bars; M1 candle backfill of the last `barHistoryDays` (14) on start | real time (~4 msg/s per pair) | `raw/vendor=oanda/dataset=pricing-stream`, `candles-m1-mid`; bars → `derived/live_bars` |
| Yahoo chart API (`<root>=F`, `DX-Y.NYB`) | ES NQ YM RTY MES MNQ MYM M2K GC SI HG ZT ZF ZN ZB DXY, 1-minute bars | **delayed ~9 min** (measured 545 s) | `raw/vendor=yahoo/dataset=chart-1m`; bars → `derived/live_bars` |
| Quantower DomFlow tape (`E:\qtcapture`) | AMP/CQG futures trades → 1-minute bars | real time, **only while AMP Quantower runs DomFlow with its Tape root set** | the tape itself is promoted by `datalake/scripts/build_from_tape.py`; bars → `derived/live_bars` |
| RSS: InvestingLive, FXStreet, Investing.com, Yahoo Finance, Federal Reserve, ECB, BLS | headlines | 1–5 min polls, conditional GET | `raw/vendor=rss`; rows → `curated/news_articles` |
| Alpha Vantage NEWS_SENTIMENT (free key, `ALPHA_VANTAGE_API_KEY`) | 8-way rotation (4 topics, 4 FOREX tickers) | one call every ~58 min: **25 calls/day**, ledger in `spool/alphavantage.json`; a refusal pauses it to the next UTC day | `raw/vendor=alphavantage`; rows → `curated/news_articles` (Alpha Vantage's own sentiment kept in raw only) |
| GDELT DOC 2.0 | 68 rules from `lake.news` (macro, index, constituent, currency, commodity, rates): a sweep every 15 min over the last 60 min, then a history backfill walking back to `backfillFrom` (2024-01-01) in 7-day windows | crawl time in 15-min buckets (known at bucket + 15 min) | `raw/vendor=gdelt`; sweep rows → today's spool; backfill → `curated/news_articles` + `curated/news_coverage` every 30 days of history |

**CME/CBOT live is delayed.** The OANDA account holds only currency instruments
(68, no CFDs), so real-time futures exist only while Quantower records; Yahoo
fills in ~9 minutes behind. A real-time CME feed would be a paid subscription
(Databento), declined 2026-09-28.

**GDELT throttles by address.** One pacer (`lake.gdelt.PACER`, 6 s) governs every
request the hub makes, and the hub is the machine's only GDELT client. A refused
window is neither coverage nor done: the sweep or backfill unit is retried after
a cool-off that doubles with each refusal in a row (10 min → 4 h cap,
`cooloffMaxSeconds`) and resets on an answered request. At 6 s a request, a
sweep costs ~6.8 min of every 15 and each backfilled week ~68+ requests, so the
2024-01 → today backfill needs roughly 30 hours of unrefused requests.

## Scoring and routing

Every headline goes through `NewsPipeline.headline` (`live/news.py`): identity
(`lake.news.article_id(url)`), routing (`lake.news.route_headline` or, for a
GDELT hit, the roots of the rule that found it), one row per (article, root) with
`tier`, `relevance`, `direction` (+1 base currency, −1 quote currency), then
FinBERT (`ProsusAI/finbert`, fp16 on the RTX 5060 Ti, batches of up to 128 within
a second; `live/scoring.py`). A batch that fails is re-scored one headline at a
time; a headline failing alone is retried after 30 s × attempt, three times,
then counted in `/status` → `scoring.dropped` / `droppedIds`. When nothing in a pass scores, a known-good probe
headline is tried: if it fails too the GPU is at fault and every headline waits (backoff to
10 min) without spending an attempt.

**Known time.** `seen_ts` is first sight, never the outlet's `pubDate`
(`published_ts`, diagnosis only). A GDELT row is known at its bucket + 15 min. The
pipeline keeps each article's first-known time: a later RSS or Alpha Vantage
copy is stamped with the earlier of that and its own poll time — never with
GDELT's raw bucket stamp, which would read as known 15 minutes early.

## Landing (`live/landing.py`)

- **raw** — every payload appended to a local file per (vendor, dataset); every
  `rawFlushSeconds` (900) gzip + `lake.writer.land_raw` → `raw/vendor=<v>/dataset=<d>/schema=jsonl-gz/received=<date>/` with a sha256 sidecar.
- **today** — article, score and coverage rows rewritten every `spoolFlushSeconds`
  (300) to `data/live/spool/curated/<dataset>/day=<date>.parquet`. `lake.sentiment`
  reads these beside the lake (`src/ml/shared/sentiment.py` adds the directory),
  so a model trained this afternoon sees this morning's news.
- **finished days** — the first flush after UTC midnight writes yesterday's news
  rows into the curated contracts in one write each; a day whose write failed is
  retried at every later flush.
- **bars** — one row per (symbol, minute); a better-ranked source
  (`Hub.RANK`: quantower 3 > oanda 2 > yahoo 1) replaces a worse one, never the
  reverse, in memory and in the lake. A bar **date** lands once, 30 minutes after
  it ends (`barLandGraceMinutes`), and never before the hub has run 15 minutes and every
  startup backfill (OANDA 14 days, Yahoo 7 days) has reported done (ceiling 1 h), into `derived/live_bars/recipe=live_<vendor>_<yyyymmdd>`
  (view `derived_live_bars`), file name fixed by (vendor, date); dates landed are
  recorded in `data/live/spool/live_bars_landed.json`. This is what keeps the
  14-day OANDA backfill, re-delivered on every start, from landing twice — the
  lake writer deduplicates only within one write.

A landing step that raises is logged and retried at the next tick; it never
stops the loop. A worker task that ends makes the hub flush and exit(1), so the
supervisor restarts it. `data/live/spool/hub.lock` admits one hub per spool (a
second exits 3): two would each spend the Alpha Vantage budget and walk the
GDELT cursor.

## Endpoints (through `/api/live`)

`/health`, `/status` (sources with health, budgets and cool-offs; landing
counters; scoring), `/quotes`, `/bars?symbol=&since=`, `/news`, `/sentiment`,
`/stream?kinds=quote,bar,news` (server-sent events). The browser opens **one**
hub stream per tab (`src/client/src/live/stream.ts`): Chrome allows six HTTP/1.1
connections per origin, and six streams froze the renderer.

## Supervision (`src/server/sidecar/`)

`src/config/sidecars.json` pins each sidecar's port. The supervisor adopts a
process already answering `/health` as that sidecar before spawning, writes
stdio to `logs/sidecar-<slug>.log`, restarts after two missed probes with
backoff, and on a restart kills only a port owner that answers as the sidecar or
is the pid it recorded. The proxy is mounted before the body parsers, exempt from
compression and the 30 s timeout, and forwards only requests addressed to a
loopback host name.

## Where to see it

`/live` (quote board with source and delay badges, news tape with FinBERT
scores, per-instrument sentiment, source health), the Market chart's live tail,
`notebooks/finbert_sentiment.py` (ml-dashboard group).
