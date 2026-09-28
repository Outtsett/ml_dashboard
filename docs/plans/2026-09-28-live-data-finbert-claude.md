# Live data, mandatory FinBERT features, Claude Code in the dashboard — plan (2026-09-28)

## Goal

1. **Claude Code inside the dashboard** — a panel on every page holding a real multi-turn Claude Code session in this repo, with the dashboard's context (route, symbol, timeframe, Model Cycle run), live tool calls, approve/deny from the browser, sessions that survive reloads and server restarts.
2. **Live data streamed into the dashboard** for every instrument in the lake — 18 forex pairs, the CME / CBOT / COMEX futures roots, the dollar index — plus news from free sources and the Alpha Vantage free key, every byte landed write-once in the lake.
3. **FinBERT in every model** — sentiment features computed from FinBERT-scored headlines are a mandatory input to every trainer the dashboard runs (Model Cycle, codegen templates, the hand-written packages), whatever feature categories a runner pins.

## Decisions (Tyler, 2026-09-28)

- Real-time CME: free sources now (no Databento subscription). Alpha Vantage: free tier, 25 requests / day, budgeted.

## Facts the design rests on (measured 2026-09-28)

| | |
|---|---|
| OANDA account | practice, **68 instruments, all CURRENCY** — no CFDs, no metals. Pricing stream ~4 msg/s, heartbeat 5 s. |
| Live CME / CBOT / COMEX | Yahoo chart API (`/v8/finance/chart/<T>=F?interval=1m`) — real futures front contract, ~10 min delayed, no key. Quantower AMP/CQG is real-time but only while Tyler runs `C:\AMP Quantower` with DomFlow writing a tape. |
| Bar clocks | Every trainer reads `ohlcv_1m` (and its timeframe siblings) from the 2026-09-09 snapshot: **futures stamped in Pacific wall clock as UTC** (empty hour 14 all year), forex true UTC. Iceberg `market.bars`: true UTC for both. |
| Existing news pipeline (datalake) | GDELT DOC 2.0 `artlist` → `curated/news_articles` (one row per article × root, routed by the query that found it) → `lake.finbert.FinBert` (ProsusAI/finbert, id2label asserted, fp16 on CUDA) → `curated/news_sentiment` → `derived/news_features/recipe=finbert_v1`. Only one calibration week landed (2025-12-15..21, 1,638 scored articles). Causal rule: article `seen_ts` strictly before the bar OPEN. |
| Claude Agent SDK 0.2.138 | Authenticates through the logged-in CLI (no `ANTHROPIC_API_KEY`); multi-turn via an `AsyncIterable<SDKUserMessage>` prompt; `canUseTool(toolName, input, {signal, suggestions, toolUseID, …})`; `session_id` on every message; `resume` restores a session. Read-only commands such as `echo` are auto-allowed and never reach `canUseTool`. |

## Architecture

Two **sidecars** — long-lived processes the dashboard supervises but does not host, because `tsx --watch` restarts the server on every server-file save:

| Sidecar | Process | Port | Proxied at |
|---|---|---|---|
| live | `.venv\Scripts\python.exe -m live` (aiohttp) | 17192 | `/api/live/*` |
| claude | `node --import tsx src/server/claude/host.ts` | 17191 | `/api/claude/*` |

`src/server/sidecar/` — config (`src/config/sidecars.json`), supervisor (adopt a healthy process on the pinned port before spawning; stdio to `logs/sidecar-<slug>.log`, never a pipe; watchdog restart with backoff), proxy (mounted before the body parsers, exempt from compression and the 30 s timeout), router (`/api/sidecars`).

### Live hub (`live/`, Python)

- **Adapters**: `oanda` (pricing stream for the 18 lake pairs; M1 candle backfill of the gap since the lake's last bar), `yahoo` (1-minute polling of every futures root + DXY, delayed), `tape` (Quantower DomFlow tape tail when a capture root exists), `rss` (InvestingLive, FXStreet, Investing.com, Federal Reserve, ECB, BLS, Yahoo Finance), `alphavantage` (NEWS_SENTIMENT under a persisted 25/day budget), `gdelt` (live sweep of the lake.news queries every 15 min, then backfill walking backwards with the leftover capacity — the hub is the only GDELT client, so one pacer governs every request).
- **Scoring**: new headlines batched through `lake.finbert.FinBert` on the GPU.
- **Routing**: `lake.news.route_headline()` maps any headline to (root, tier, relevance, direction) with the same phrase table the GDELT queries use; forex rows carry `direction` (+1 base currency, −1 quote currency).
- **Landing**: raw payloads write-once under `raw/vendor=<v>/…` (`lake.writer.land_raw`, Object Lock), articles and scores through `lake.writer.write` into the existing contracts, live bars into `derived/live_bars/recipe=<vendor>_<date>`, polling coverage into `curated/news_coverage` — all with manifest lines.
- **Serving**: `/health`, `/status`, `/quotes`, `/bars`, `/news`, `/sentiment`, `/stream` (SSE).

### FinBERT features (mandatory)

`src/ml/shared/sentiment.py` builds, for any bar grid, from the scored articles routed to that instrument:

| column | meaning |
|---|---|
| `finbert_sentiment_decayed_short` | Σ relevance·direction·score·2^(−age/half-life), half-life max(120 min, 4 bars) |
| `finbert_sentiment_decayed_long` | same, half-life max(1440 min, 32 bars) |
| `finbert_news_intensity_decayed` | Σ relevance·2^(−age/short half-life) — how much news, not its sign |
| `finbert_sentiment_mean_window` | mean direction·score over the long window (0 when the window is empty) |
| `finbert_article_count_window_log` | log(1 + articles in the long window) |
| `finbert_minutes_since_article_log` | log(1 + minutes since the last routed article), capped at 7 days |
| `finbert_macro_sentiment_decayed_short` | the short sum over macro-tier articles only |
| `finbert_news_coverage_flag` | 1 when the bar open lies inside a span some news source was actually collecting, else 0 |

- **Causal**: only articles with `seen_ts` strictly before the bar's open, in true UTC — futures bars from the snapshot are re-localised from America/Los_Angeles first (DST-aware).
- **Encoding**: the lake keeps NULL for "no article"; the model matrix carries 0 plus the two indicator columns (coverage, count), so a bar with no news is never mistaken for neutral news and never removed from training by the history filter.
- **Mandatory**: `compute_features` appends the family whatever `categories` says and raises if a caller omits `symbol` / `timestamp`; the Model Cycle appends it after the z-score (the family is bounded and sparse — a 250-bar z-score of it is mostly zero), exempt from the constant-column drop. A pytest parametrised over every runnable Cycle model, every trainer package and the codegen template fails if any path trains without it.

### Claude panel

- **Host** (`src/server/claude/host.ts`): one Agent SDK `query()` per session with a streaming prompt queue; `canUseTool` parks a permission request until the browser answers; events to an in-memory ring + `data/claude/<session>.jsonl`; `resume` after a host restart; in-process MCP tools (`dashboard_context`, `open_dashboard_page`, `live_quotes`, `news_sentiment`) plus the repo's `mcp_server` over stdio (fixed: it never spoke stdio). The child environment drops the parent Claude Code session variables.
- **Client** (`src/client/src/claude/`): a panel on every page (top-bar button, Ctrl+Shift+K), message stream with tool cards and permission cards, session list, permission-mode and model pickers, the page context sent with each message; `open_dashboard_page` navigates the dashboard.

### GUI

`/live` (quote board with source + delay badges, news tape with FinBERT scores, per-instrument sentiment, source health and budgets), the Market chart's live tail through the existing `market.bar` stream (`live` mode of `/api/market/replay/start` now reads the hub), the News page on the hub, `notebooks/finbert_sentiment.py` (ml-dashboard group).

## Done means

- `/api/sidecars` shows both sidecars ready; the hub streams EURUSD ticks and delayed ES bars; raw objects and manifest lines exist for each vendor.
- Headlines from ≥ 5 feeds scored by FinBERT on the GPU within a minute of first sight; GDELT backfill running.
- `pytest tests/test_finbert_mandatory.py tests/test_sentiment_features.py` green; a Model Cycle run lists the `finbert_*` columns among its features.
- A Claude panel conversation in the browser: context attached, a tool call approved from the browser, a session resumed after a host restart.
- Adversarial review closes before the report.
