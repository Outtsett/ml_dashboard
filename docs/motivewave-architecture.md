# MotiveWave Architecture Reference

Deep dive into how MotiveWave (v7.0.15, Java/JavaFX) handles chart rendering, caching, rollover stitching, and UI layout — documented for replication in the ML Dashboard.

---

## Table of Contents

1. [Rendering Pipeline](#1-rendering-pipeline)
2. [Caching Architecture](#2-caching-architecture)
3. [Rollover Stitching](#3-rollover-stitching)
4. [UI Layout System](#4-ui-layout-system)
5. [Chart Configuration Model](#5-chart-configuration-model)
6. [Performance Numbers](#6-performance-numbers)
7. [SDK Architecture](#7-sdk-architecture)
8. [ML Bridge Extensions](#8-ml-bridge-extensions)
9. [Takeaways for ML Dashboard](#9-takeaways-for-ml-dashboard)

---

## 1. Rendering Pipeline

### GPU-Accelerated JavaFX Prism + Direct3D

MotiveWave uses **JavaFX Prism** with hardware-accelerated Direct3D on Windows:

```
Pipeline init order: d3d → sw (software fallback)
Rasterizer:          Double Precision Marlin (antialiased vectors)
Dirty regions:       ON (only repaints changed areas)
Texture mask:        OFF (direct primitive rendering)
Power-of-2 textures: OFF (arbitrary dimensions)
HiDPI scaling:       ON
VSync:               ON
```

### JVM Configuration

| Setting | Value | Purpose |
|---------|-------|---------|
| `-Xmx32G` | 32 GB heap | Holds millions of bars across instruments in memory |
| `-Dprism.maxvram=2048M` | 2 GB VRAM | GPU texture budget for the Prism renderer |
| `-Dprism.forceUploadingPainter=true` | Upload-based | Sends textures to GPU rather than CPU rendering |
| Max texture | 4096×4096 | Clamped from GPU-supported 16384 |
| MSAA | 4× multisampling | Antialiasing for chart elements |

### VRAM Pool Behavior

The D3D VRAM pool grows dynamically during a session but **never shrinks**:

```
Session start:  ~290 MB
After loading:  ~321 MB
With charts:    ~377 MB
Heavy use:      ~450 MB
```

### Shader Creation (On-Demand)

```
LinearConvolveShadow_64   ← Shadow blur effects
LinearConvolve_28         ← General blur/smoothing
Blend_SRC_IN              ← Alpha compositing
```

### FXGraphics2D Bridge

Studies are written against the **Java2D `Graphics2D` API**. The `FXGraphics2D` bridge class translates all `Graphics2D` calls to JavaFX Canvas operations at runtime:

```
Study.draw(Graphics2D, DrawContext)
    └─ FXGraphics2D translates to → JavaFX Canvas → Prism D3D pipeline → GPU
```

This means chart rendering code is decoupled from the actual GPU backend.

### Rendering Thread

A dedicated `QuantumRenderer` thread manages the Direct3D pipeline and frame composition, separate from the JavaFX application thread.

---

## 2. Caching Architecture

### 5-Layer Cache Hierarchy

| Layer | Location | Granularity | Strategy |
|-------|----------|-------------|----------|
| **Historical bars** | `AppData/MotiveWave/historical_data/CQG/{CONTRACT}/` | Per-contract directories | Binary files, weekly 1-min chunks, single file for daily |
| **Roll dates** | `historical_data/roll_dates.json` (95 KB) | Per-symbol + roll method | Pre-computed diff + ratio adjustments cached together |
| **Backfill cursor** | `historical_limits.json` | Per-symbol/barsize/service | Tracks oldest fetched timestamp — only fetch what's missing |
| **Temp bar data** | `%TEMP%/bar_data*.data` | Per-download | Transient download buffers, not persisted |
| **VRAM textures** | GPU memory (2 GB budget) | Per dirty region | Dynamic pool growth, dirty-region tracking minimizes re-uploads |

### Historical Data File Naming

Files use epoch timestamps as names with bar size as extension:

```
historical_data/CQG/
  EPH26/
    1577836800000.bar_data1440    ← Daily bars (1440 min), one file covers entire contract
    1754784000000.bar_data1       ← 1-min bars, epoch = start of WEEK
    1755000000000.tick_data       ← Tick data, epoch = start of HOUR
  MNQZ25/
    ...same pattern...
```

### File Size Distribution (EPH26 example)

| Type | Files | Total Size | Coverage |
|------|-------|------------|----------|
| Daily bars | 1 | 18.8 KB | Single file, all daily bars since 2020 |
| 1-min bars | 45 | 2.3 MB | One per week |
| Tick data | 3,428 | 685.7 MB | One per hour |

### Binary Format

Bar data files are **binary** (not CSV/JSON):
- 4-byte magic number header
- Timestamp range boundaries (3 × 8-byte)
- Per-bar records: timestamp delta (variable encoding) + OHLCV as IEEE 754 floats (4 bytes each, big-endian)

### Progressive Data Resolution

MotiveWave uses a **waterfall loading strategy**:

1. Request bars at chart's timeframe from CQG API
2. Fill gaps from cached 1-minute bar files
3. If still insufficient, download tick data from S3 backfill bucket
4. Build higher-timeframe bars from 1-min bars or ticks

```
Chart needs 30-min bars
  └─ Check local bar_data30 cache
      └─ Miss → Build from bar_data1 (1-min) cache
          └─ Miss → Download tick_data.zip from S3
              └─ Build 1-min → 30-min bars
```

### Backfill Tracking

`historical_limits.json` tracks the oldest data point already fetched:

```json
[{"key": "MNQH26.CQG:1440:CQG", "ts": 1733698800000}]
```

Key format: `{SYMBOL}:{BAR_SIZE_MINUTES}:{SERVICE}`. Only data older than the tracked timestamp is fetched on next backfill request.

---

## 3. Rollover Stitching

### Core Architecture Decision

**MotiveWave stores data per individual contract — never pre-stitched.** Root symbol charts (e.g., "ES") are assembled **on demand at runtime** by stitching individual contract bar series using pre-computed roll dates.

### Roll Date Storage

`roll_dates.json` contains entries keyed by symbol + roll method:

```json
{
  "key": "EPZ25.CQG:BEFORE_DOW:4:false:THIRD:FRI",
  "data": {
    "rollDates": [
      {
        "date": 1757970000000,
        "diff": 56.75,
        "ratio": 1.008582,
        "contract": {
          "bs": "EP",
          "sym": "EPU25",
          "exp": 1758315600000,
          "exch": "CME",
          "t": "E-Mini S&P 500",
          "letter": "U",
          "mt": 0.25,
          "pv": 50
        }
      }
    ]
  }
}
```

### Key Fields

| Field | Type | Purpose |
|-------|------|---------|
| `date` | epoch ms | When to switch from this contract to the next |
| `diff` | float | Panama additive adjustment: `old_close - new_close` |
| `ratio` | float | Multiplicative adjustment: `old_close / new_close` |
| `contract.sym` | string | Symbol of the contract being rolled INTO |
| `contract.exp` | epoch ms | Contract expiration date |
| `contract.bs` | string | Base/root symbol (e.g., "EP" for E-Mini S&P) |

### Roll Method Types

| Method | Key Pattern | Example |
|--------|-------------|---------|
| Volume-based | `EMDZ25.CQG:VOLUME` | Roll when next contract's volume exceeds current |
| Calendar-based | `EPZ25.CQG:BEFORE_DOW:4:false:THIRD:FRI` | 4 days before 3rd Friday of expiry month |

Calendar key decoded: `BEFORE_DOW:{days}:{bizDays}:{week}:{dayOfWeek}`

### All Roll Methods (from SDK enums)

```
NONE, VOLUME, EXP_DATE, BEFORE_SOM, DOW_BEFORE_SOM,
DOM_BEFORE_SOM, BEFORE_BD_SOM, AFTER_SOM, BEFORE_DOW,
BEFORE_DOM, BEFORE_EOM, BEFORE_LAST_BD
```

### Back-Adjustment Methods

```
NONE        → No adjustment (price gaps at roll boundaries)
DIFFERENCE  → Additive Panama: price += diff
CUM_DIFF    → Cumulative additive difference
RATIO       → Multiplicative: price *= ratio
```

Both `diff` and `ratio` are **pre-computed and cached simultaneously** — the user can switch between adjustment methods instantly without re-fetching data.

### Runtime Assembly Sequence

From MotiveWave logs, the exact sequence when rendering a stitched root-symbol chart:

```
Step 1: User requests bars
  getBarsByCount(MNQH26, end=Jan-06, count=20, barSize=1440)

Step 2: Compute roll dates
  RollDates::getRollDates(MNQH26.CQG)
  → MNQH26 roll boundary: Dec 15, 2025 (prior contract: MNQZ25)

Step 3: Split time range into per-contract segments
  Segment 1: MNQZ25.CQG  [Dec 02 → Dec 15]  (previous contract)
  Segment 2: MNQH26.CQG  [Dec 15 → Jan 06]  (current contract)

Step 4: Fetch data per segment
  getData(MNQZ25, Dec-02, Dec-15, barSize=1440)  → check cache → API if needed
  getData(MNQH26, Dec-15, Jan-06, barSize=1440)  → check cache → API if needed

Step 5: Apply price adjustment (user's chosen method)
  DIFF mode:  price += cumulative_diff
  RATIO mode: price *= cumulative_ratio
  NONE:       no adjustment

Step 6: Return unified bar series to chart renderer
```

### Multi-Contract Deep Scrollback

When scrolling back further, MotiveWave chains across more contracts:

```
Request: 794 thirty-minute bars for MNQH26
  → Segment 1: MNQZ25.CQG  [Oct 03 → Dec 15]
  → Segment 2: MNQH26.CQG  [Dec 15 → Jan 08]

Scrolling back further:
  → Segment 0: MNQU25.CQG  [Sep 26 → Oct 03]  ← another contract added
  → Segment 1: MNQZ25.CQG  [Oct 03 → Dec 15]
  → Segment 2: MNQH26.CQG  [Dec 15 → present]
```

### Symbol References

| Context | Format | Example |
|---------|--------|---------|
| Default templates | `$ES$` (dollar-wrapped) | Placeholder resolved to front-month at startup |
| Active workspace | Individual contract | `MNQH26.CQG`, `EPH26.CQG` |
| Watchlists | Individual contract | `EPH26.CQG`, `CLEF26.CQG` |

The `$ES$` syntax exists only in default layout templates. Active workspaces always reference individual contracts — the rollover stitching happens transparently at the data layer.

---

## 4. UI Layout System

### Hierarchy: Console → Pages → Stations → Factories

```
Console (maximized, 2574×1406)
  └─ Pages (tabs at TOP)
      ├─ "Home"         [CHART]     ← recursive split panels
      ├─ "Order Flow"   [CHART]
      ├─ "Floating"     [FLOATING]  ← floating windows
      ├─ "Account"      [ACCOUNT]
      ├─ "Trade Report" [ACCOUNT]
      ├─ "Scan"         [SCAN]
      └─ "Optimize"     [OPTIMIZE]
```

### Page Types

`CHART`, `FLOATING`, `ACCOUNT`, `SCAN`, `OPTIMIZE`

### Split Panel Layout

Persisted in `windows.json` (24 KB) as a recursive tree with decimal divider ratios:

```json
{
  "type": "split",
  "dividers": "0.80558539205",
  "nodes": [
    { "tabs": [{ "factory": "chartFactory", "content": {...} }] },
    { "tabs": [{ "factory": "watchListFactory", "content": {...} }] }
  ]
}
```

### Station Factories

| Factory | Creates |
|---------|---------|
| `chartFactory` | Chart panels |
| `watchListFactory` | Watchlist tables |
| `accountPanelFactory` | Account summaries |
| `orderPanelFactory` | Order management |
| `positionsPanelFactory` | Position tracking |
| `tradeReportFactory` | Trade reports |
| `executionsPanelFactory` | Execution log |

### Chart Linking

Color-coded linking groups (`"link": "RED"`) — switching symbol in one chart propagates to all charts sharing the same link color.

---

## 5. Chart Configuration Model

### Per-Instrument Graph Hierarchy

```json
{
  "settings": [{ "barWidth": 18, "barSize": "L:D:1", "showOrders": true }],
  "untitled": {
    "MNQH26.CQG:1": {
      "graphs": [
        {
          "figures": [
            { "sid": "BOLLINGER_BANDS", "legendValues": true },
            { "sid": "DEPTH_OF_MARKET" },
            { "sid": "VWAP" },
            { "sid": "VOLUME_PROFILE", "ti": 10 }
          ]
        },
        { "figures": [{ "sid": "RSI" }], "h": 93 },
        { "figures": [{ "sid": "MACD" }], "h": 146 }
      ]
    }
  }
}
```

### Bar Size Encoding

`"L:D:1"` = Linear, Day, 1 — `"L:M:5"` = Linear, Minute, 5 — `"L:MS:100"` = Linear, Millisecond, 100

### Study IDs (observed in user config)

VOLUME, BOLLINGER_BANDS, VWAP, RSI, MACD, DEPTH_OF_MARKET, ORDER_HEATMAP, BID_TRADES, VOLUME_IMPRINT, HARMONIC, HURST_CYCLES, ELLIOTT_WAVE, EMA, SMA, PSAR, MOMENTUM, RSI_DIVERGENCE, VOLUME_PROFILE

### Template System

Reusable chart configurations in `templates.json`:

```json
{
  "name": "multimeframe analysis",
  "settings": { "chartTheme": "dark_green", "barType": "CANDLESTICK", "barTheme": "light_blue" },
  "graphs": [
    { "studies": ["DEPTH_OF_MARKET", "BOLLINGER_BANDS", "VWAP"] },
    { "studies": ["RSI"], "height": 120 },
    { "studies": ["MACD"], "height": 120 }
  ]
}
```

### Theme Architecture

CSS-based with `-theme-color-*` variables:

| Theme | Main Background | Chart Background |
|-------|----------------|-----------------|
| Black Mamba (default) | `rgb(23,27,38)` | `rgb(27,37,48)` |
| Dark | `rgb(25,25,25)` | `rgb(20,20,20)` |
| Light (White Snake) | `rgb(248,248,248)` | `rgb(230,230,230)` |

Base CSS: `ui_theme.css` (166 KB) + theme overrides (4–17 KB). Font: Inter.

---

## 6. Performance Numbers

| Operation | Time |
|-----------|------|
| Full application init | 2–3 seconds |
| Layout load | 350–400 ms |
| 2,117 instruments load | 34–43 ms |
| Historical bar request (CQG API) | 177–682 ms |
| 64K–92K ticks load | 1.4–1.9 seconds |
| S3 backfill per symbol | 566–815 ms |
| Auto-backup (45 KB zip) | 39–73 ms |
| UI refresh rate | 20 FPS (50 ms interval) |
| DOM snapshot rate | 50 ms |
| Memory at exit | ~1.57 GB process memory |

---

## 7. SDK Architecture

### Package Structure (`mwave_sdk.jar`, 330 KB)

```
com.motivewave.platform.sdk.common/       Core: DataSeries, Bar, Tick, Instrument, DrawContext
com.motivewave.platform.sdk.common/desc/   Setting descriptors (UI config builders)
com.motivewave.platform.sdk.common/menu/   Context menu API
com.motivewave.platform.sdk.draw/          Drawing: Figure, Line, Box, Marker, Polygon, Text
com.motivewave.platform.sdk.order_mgmt/    Orders: OrderContext, Order, Execution, Trade
com.motivewave.platform.sdk.profile/       Volume/TPO profiles: VolumeProfile, TPOProfile
com.motivewave.platform.sdk.study/         Study/Strategy: Study, Plot, RuntimeDescriptor
```

### DrawContext Interface (coordinate translation)

```java
Point2D translate(long time, double price)   // time+price → pixel
int translateTime(long time)                 // time → x pixel
int translateValue(double price)             // price → y pixel
long translate2Time(double x)                // x pixel → time
double translate2Value(double y)             // y pixel → price
Rectangle getBounds()                        // chart viewport bounds
int getBarWidth()                            // current bar width in pixels
```

### DataSeries (data access + built-in computations)

- Moving Averages: `sma()`, `ema()`, `dema()`, `tema()`, `wma()`, `smma()`, `kama()`, `vwma()`
- Statistics: `std()`, `highest()`, `lowest()`, `sum()`, `roc()`
- Indicators: `atr()`, `stochasticK()`, `mfm()`
- Swing Points: `calcSwingPoints(strength)`
- Bar access: indexed random access to OHLCV + bid/ask bars + computed values

### Study Lifecycle

```
initialize(Defaults)          → register settings, descriptors
onLoad(Defaults)              → post-load initialization
onNewDataSeries(DataContext)  → new data loaded
onBarUpdate(DataContext)      → intra-bar tick update
onBarClose(DataContext)       → bar completion
onTick(DataContext, Tick)     → raw tick processing
recalculate(DataContext)      → full recalculation
```

### Internal Libraries

| Library | Size | Purpose |
|---------|------|---------|
| `eclipse-collections` | 10.6 MB | Primitive collections (avoids boxing overhead) |
| `protobuf-javalite` | — | Rithmic protocol buffers |
| `gson` | — | JSON parsing |
| `okhttp` | — | WebSocket connections |
| `jna` | — | Native Windows API access |

---

## 8. ML Bridge Extensions

Located at `E:\source\MotiveWave\Extensions\mlbridge\`:

### DataStreamStudy

Streams live DOM + tick data to Python via TCP:

```
Settings:
  - Enable TCP Stream (boolean)
  - TCP Port (int)
  - Buffer Size (int)
  - Enable File Output (boolean)
  - Output Directory (string)
  - DOM Levels (int)

Implements: Study + DOMListener + TickOperation
  onTick(Tick)   → streams each tick
  update(DOM)    → streams DOM updates
```

### MLSignalStrategy

Receives ML signals and executes trades:

```
Signal types: BUY, SELL, FLAT, NONE
Signals:      ML_BUY, ML_SELL

Lifecycle:
  onActivate(OrderContext)         → start listening
  onSignal(OrderContext, signal)   → execute trade
  onDeactivate(OrderContext)       → stop
```

---

## 9. Takeaways for ML Dashboard

### What Makes MotiveWave Fast

| Technique | MotiveWave | ML Dashboard Today | Opportunity |
|-----------|-----------|-------------------|-------------|
| **Dirty-region rendering** | Only repaints changed chart areas | Lightweight Charts redraws on any data change | Lightweight Charts handles this internally — acceptable |
| **GPU-accelerated canvas** | D3D Prism pipeline, 2 GB VRAM | Browser Canvas2D (CPU) via Lightweight Charts | WebGL overlay for custom drawings (Three.js already available) |
| **Binary data format** | Custom binary bar files (4-byte floats) | JSON over HTTP from QuestDB | Switch chart API to binary (ArrayBuffer/Float64Array) |
| **Per-contract data storage** | Individual contract dirs, never pre-stitched | Individual contracts in QuestDB `ohlcv` table | Already aligned — just need runtime stitching |
| **Runtime rollover stitching** | Stitch at request time from roll dates | No stitching support yet | **Build this** — rollovers table already exists + stitching query |
| **Pre-computed adjustments** | Both diff + ratio stored per roll date | Nothing | **Build this** — compute both on ingestion |
| **Progressive data loading** | Daily → 1-min → tick waterfall | Single QuestDB query per request | Use materialized views as cache tiers |
| **20 FPS UI cap** | 50 ms update interval | React re-render on every state change | Throttle chart updates to requestAnimationFrame |
| **32 GB heap** | Entire dataset in memory | QuestDB handles memory-mapped I/O | Already good — QuestDB is memory-mapped |
| **Weekly bar file chunks** | Natural time partitioning | QuestDB DAY partitions | Already aligned |

### Rollover Stitching Implementation Plan

To replicate MotiveWave's rollover stitching in the ML Dashboard:

#### 1. Roll Dates Table (QuestDB or SQLite)

```sql
-- SQLite (metadata, rarely changes)
CREATE TABLE roll_dates (
  id INTEGER PRIMARY KEY,
  base_symbol TEXT NOT NULL,        -- 'ES', 'NQ', 'CL'
  roll_method TEXT NOT NULL,        -- 'volume', 'calendar'
  roll_date TEXT NOT NULL,          -- ISO timestamp of roll
  from_contract TEXT NOT NULL,      -- 'ESZ25'
  to_contract TEXT NOT NULL,        -- 'ESH26'
  diff REAL NOT NULL,               -- additive adjustment (Panama)
  ratio REAL NOT NULL,              -- multiplicative adjustment
  expiration TEXT NOT NULL          -- contract expiration date
);
```

#### 2. Runtime Stitching Query (QuestDB)

```sql
-- For an ES root-symbol chart with Panama adjustment:
-- 1. Get roll boundaries for ES
-- 2. Query each contract segment
-- 3. Apply cumulative diff adjustment

SELECT
  timestamp,
  symbol,
  open + :cumulative_diff AS open,
  high + :cumulative_diff AS high,
  low + :cumulative_diff AS low,
  close + :cumulative_diff AS close,
  volume
FROM ohlcv
WHERE symbol = :contract_symbol
  AND timestamp >= :segment_start
  AND timestamp < :segment_end
```

#### 3. Chart API Endpoint

```
GET /api/charts/stitched/:rootSymbol
  ?barSize=1d
  &adjustment=panama|ratio|none
  &rollMethod=volume|calendar
  &start=2024-01-01
  &end=2026-01-01
```

Server splits the time range into per-contract segments using roll_dates, queries each segment from QuestDB, applies the chosen adjustment, and returns a unified bar series.

#### 4. Binary Response Format

Instead of JSON, return chart data as an ArrayBuffer for zero-parse overhead:

```
Header:  [barCount: uint32] [fieldCount: uint8]
Records: [timestamp: float64, open: float64, high: float64, low: float64, close: float64, volume: float64] × barCount
```

Client reads directly into a Float64Array — no JSON parsing, no string allocation.

### Performance Quick Wins (No Architecture Change)

1. **Throttle chart updates** to 60 FPS max using `requestAnimationFrame` instead of re-rendering on every React state change
2. **Binary WebSocket** for live data instead of SSE text streams
3. **Cursor-based pagination** for historical scrollback (like MotiveWave's progressive loading)
4. **Instrument cache** — load all 25 instruments once at startup, hold in React context
5. **QuestDB materialized views** already replicate MotiveWave's tiered bar resolution (5m → 1h → 1d)
