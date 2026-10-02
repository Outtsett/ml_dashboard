"""The dashboard's live data hub — one long-lived process (a sidecar, port 17192).

What it runs (packages/config/live.json):

- **oanda**: the v20 pricing stream for the 18 forex pairs the lake holds, true
  real time; ticks become 1-minute mid bars. On start it backfills M1 candles
  over ``barHistoryDays`` so the chart's live tail reaches back to the lake.
- **yahoo**: 1-minute bars for every futures root (CME, CBOT, COMEX) and the
  dollar index from Yahoo's chart API — the actual front contract, ~10 minutes
  delayed. Every bar says so.
- **tape**: Quantower DomFlow tapes under the capture root, tailed while
  Quantower is recording — real-time CME prints when Tyler runs AMP Quantower.
- **news**: RSS/Atom feeds, Alpha Vantage NEWS_SENTIMENT under its 25-a-day
  budget, and a GDELT sweep of every lake.news query every 15 minutes, with the
  spare GDELT capacity walking the history backwards. Every headline is routed
  (lake.news), scored by FinBERT on the GPU (lake.finbert) and served within
  seconds of first sight.

Every byte fetched lands in the lake: raw payloads write-once under
``raw/vendor=<v>/`` every ``rawFlushSeconds``; today's articles, scores and
coverage spans in a local spool that ``lake.sentiment`` reads, written to the
curated contracts once per finished day; live bars to ``derived/live_bars``.

It is a sidecar because the dashboard server restarts on every source edit
(tsx --watch) and a socket held there would drop each time.
"""
