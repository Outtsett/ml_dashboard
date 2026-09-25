# Stock-index futures — contract specifications

**Source:** AMP Futures, *Contract Specifications*, https://www.ampfutures.com/trading-info/contract-specifications, read 2026-09-25 — the three stock-index sections (*E-nano Futures*, *Micro E-mini Futures*, *Stock Index*), 42 contracts.
**Cross-checked:** every CME / CBOT product (15 of the 42) against CME Group's own contract-specs page, read the same day; the CME fields below are those pages' wording.
**Data:** `src/config/contract_specifications.json`, built by `scripts/build_contract_specifications.py` (see *Rebuilding*). **Interactive view:** `notebooks/contract_specifications.py` (ML Dashboard → Notebooks → ML Dashboard group).

## What the four columns mean

Think of a contract as a fixed-size bet on an index number. The exchange fixes three things and the fourth follows:

| column | meaning | JSON field |
|---|---|---|
| **Tick** | the smallest step the price can move, in index points | `tick_size_index_points` |
| **Contract** (size / multiplier) | how much money one index point is worth for one contract, in the contract's currency — the "point value" the simulators multiply by | `contract_multiplier_per_index_point`, `currency` |
| **Tick value** | what one tick is worth for one contract = tick × multiplier | `tick_value_per_contract` |
| **Exchange** | the listing exchange; "CBOT/CME" on AMP's page means CBOT-listed, traded on CME Globex (CME's own YM, MYM and NDOW pages cite CBOT rulebooks) | `exchange`, `exchange_group` |
| **Months** | the contract months listed: H = March, M = June, U = September, Z = December (full code table in the JSON's `month_codes`) | `contract_months` |

Profit on a move is `Δp ÷ tick × tick value × contracts`: 10 points on MNQ is 40 ticks × $0.50 = $20 per contract; the same 10 points on ES is 40 ticks × $12.50 = $500.

## CME Group — the contracts the lake carries, and their siblings

✓ marks the eight roots in the Iceberg lake (`market.bars`, 886 contract symbols + 606 calendar spreads). Every row below was read on cmegroup.com and matches AMP on tick, multiplier, tick value and months.

| symbol | name | exchange | multiplier | tick (points) | tick value | months | lake |
|---|---|---|---|---|---|---|---|
| ES | E-mini S&P 500 | CME | $50 | 0.25 | $12.50 | H, M, U, Z | ✓ |
| NQ | E-mini Nasdaq-100 | CME | $20 | 0.25 | $5.00 | H, M, U, Z | ✓ |
| YM | E-mini Dow ($5) | CBOT | $5 | 1.00 | $5.00 | H, M, U, Z | ✓ |
| RTY | E-mini Russell 2000 | CME | $50 | 0.10 | $5.00 | H, M, U, Z | ✓ |
| EMD | E-mini S&P MidCap 400 | CME | $100 | 0.10 | $10.00 | H, M, U, Z | |
| MES | Micro E-mini S&P 500 | CME | $5 | 0.25 | $1.25 | H, M, U, Z | ✓ |
| MNQ | Micro E-mini Nasdaq-100 | CME | $2 | 0.25 | $0.50 | H, M, U, Z | ✓ |
| MYM | Micro E-mini Dow | CBOT | $0.50 | 1.00 | $0.50 | H, M, U, Z | ✓ |
| M2K | Micro E-mini Russell 2000 | CME | $5 | 0.10 | $0.50 | H, M, U, Z | ✓ |
| NES | E-nano S&P 500 | CME | $0.50 | 0.50 | $0.25 | H, M, U, Z | |
| NNQ | E-nano Nasdaq-100 | CME | $0.20 | 0.50 | $0.10 | H, M, U, Z | |
| NDOW | E-nano Dow | CBOT | $0.05 | 2.00 | $0.10 | H, M, U, Z | |
| N2K | E-nano Russell 2000 | CME | $0.50 | 0.20 | $0.10 | H, M, U, Z | |
| NKD | Nikkei 225 (USD) | CME | $5 | 5 | $25.00 | H, M, U, Z | |
| MNK | Micro Nikkei (USD) | CME | $0.50 | 5 | $2.50 | H, M, U, Z | |

The family scales by ten: E-mini → Micro E-mini → E-nano is $50 → $5 → $0.50 on the S&P 500. The E-nanos launched 2026-08-24 (CME's FAQ of that date); their tick is double the Micro's so a tick still settles to a whole cent.

### What CME Group's pages add

| symbol | listed contracts | calendar-spread tick | last trading day | rulebook |
|---|---|---|---|---|
| ES | quarterly, 21 consecutive quarters | 0.05 = $2.50 | 9:30 a.m. ET, 3rd Friday of the contract month | CME 358 |
| NQ | quarterly, 6 consecutive + 2 extra June + 4 extra December | 0.05 = $1.00 | 9:30 a.m. ET, 3rd Friday | CME 359 |
| YM | quarterly, 4 consecutive quarters | — | 9:30 a.m. ET, 3rd Friday | CBOT 27 |
| RTY | quarterly, 5 consecutive + 2 extra June + 4 extra December | 0.05 = $2.50 | 9:30 a.m. ET, 3rd Friday | CME 393 |
| EMD | quarterly, 5 consecutive quarters | 0.05 = $5.00 | 9:30 a.m. ET, 3rd Friday | CME 362 |
| MES | quarterly, 5 consecutive quarters | 0.05 = $0.25 | 9:30 a.m. ET, 3rd Friday | CME 353 |
| MNQ | quarterly, 5 consecutive quarters | 0.05 = $0.10 | 9:30 a.m. ET, 3rd Friday | CME 361 |
| MYM | quarterly, 4 consecutive quarters | 1.0 = $0.50 | 9:30 a.m. ET, 3rd Friday | CBOT 28 |
| M2K | quarterly, 5 consecutive quarters | 0.05 = $0.25 | 9:30 a.m. ET, 3rd Friday | CME 363 |
| NES / NNQ / N2K / NDOW | quarterly, 2 consecutive quarters | 0.10 / 0.05 / 0.10 / 1.0 | 9:30 a.m. ET, 3rd Friday | CME 343 / 344 / 345 / CBOT 31 |
| NKD | quarterly, 12 quarters + 3 extra December | — | 5:00 p.m. ET, Thursday before the **2nd** Friday | CME 352 |
| MNK | quarterly, 2 consecutive quarters | — | 5:00 p.m. ET, business day before the **2nd** Friday | CME 352C |

All fifteen are financially settled (the U.S. indices to the third-Friday Special Opening Quotation).

**Trading hours** (every U.S. index page): CME Globex Sunday 6:00 p.m. – Friday 5:00 p.m. ET (5:00 p.m. – 4:00 p.m. CT) with a daily maintenance period 5:00–6:00 p.m. ET (4:00–5:00 p.m. CT). The Nikkei pages say the same hours as a "60-minute break each day beginning at 4:00 p.m. CT". The lake stamps futures bars in Pacific wall-clock (`CLAUDE.md`, *Open findings*), so the halt is the empty stamped hour 14 — MNQ's 1-minute bars fill every hour of the day except that one — and the week opens at stamped 15:00 on Sunday.

**Roll date** (CME Group, *Equity Index Roll Dates*): *"Equity products roll date is the Monday prior to the third Friday of the expiration month"* (Nikkei 225 and TOPIX: the Monday prior to the second Friday). CME's 2025 table: expiry 3/21, 6/20, 9/19, 12/19 → roll 3/17, 6/16, 9/15, 12/15. Measured in the lake from daily per-contract volume (`ohlcv_1d`, the first day the next contract out-traded the expiring one), ES moved on exactly those four Mondays and MNQ on three of them (Tuesday 03-18 in March); the two MNQ rolls that `src/ml/cycle/rolls.py` back-adjusts (2025-09-15 +241.75, 2025-12-15 +256.75 points) are these. Across the eight roots the lake shows 285 such moves since 2016; MYM shows 46 rather than ~40 because its daily-volume leader flips back and forth around a roll. A "move" on 2026-03-02 (MNQH6 → MNQM26) is the March-2026 capture resuming under a different symbol style after the 2025-12-30 gap, not a roll.

## Other exchanges — AMP-only rows

Read from AMP's page only; no second source. Months "see exchange" are rows where AMP defers to the exchange's listing cycle (volatility products and Hong Kong list near-term monthlies) — the JSON carries `contract_months: null` with the note.

| symbol | name | exchange | currency | multiplier | tick (points) | tick value | months |
|---|---|---|---|---|---|---|---|
| FDXS | Micro-DAX | Eurex | EUR | 1 | 1 | 1.00 | H, M, U, Z |
| FSXE | Micro-EURO STOXX 50 | Eurex | EUR | 1 | 0.5 | 0.50 | H, M, U, Z |
| FDAX | DAX | Eurex | EUR | 25 | 1 | 25.00 | H, M, U, Z |
| FDXM | Mini-DAX | Eurex | EUR | 5 | 1 | 5.00 | H, M, U, Z |
| FESX | EURO STOXX 50 | Eurex | EUR | 10 | 1 | 10.00 | H, M, U, Z |
| FXXP | STOXX Europe 600 | Eurex | EUR | 50 | 0.1 | 5.00 | H, M, U, Z |
| FESB | EURO STOXX Banks | Eurex | EUR | 50 | 0.05 | 2.50 | H, M, U, Z |
| FVS | VSTOXX | Eurex | EUR | 100 | 0.05 | 5.00 | see exchange |
| VX | CBOE Volatility Index (VIX) | CFE | USD | 1,000 | 0.05 | 50.00 | see exchange |
| VXM | Mini VIX | CFE | USD | 100 | 0.05 | 5.00 | see exchange |
| Y | FTSE 250 Index | ICE Futures Europe | GBP | 2 | 0.5 | 1.00 | H, M, U, Z |
| Z | FTSE 100 Index | ICE Futures Europe | GBP | 10 | 0.5 | 5.00 | H, M, U, Z |
| MC225 | Nikkei 225 micro (Osaka) | OSE (JPX) | JPY | 10 | 5 | 50 | H, M, U, Z |
| MJNK | Nikkei 225 mini (Osaka) | OSE (JPX) | JPY | 100 | 5 | 500 | H, M, U, Z |
| JNK | Nikkei 225 (Osaka) | OSE (JPX) | JPY | 1,000 | 10 | 10,000 | H, M, U, Z |
| JTPX | TOPIX | OSE (JPX) | JPY | 10,000 | 0.5 | 5,000 | H, M, U, Z |
| JMT | Mini-TOPIX | OSE (JPX) | JPY | 1,000 | 0.25 | 250 | H, M, U, Z |
| J400 | JPX-Nikkei Index 400 | OSE (JPX) | JPY | 100 | 5 | 500 | H, M, U, Z |
| NK | SGX Nikkei 225 Index | SGX | JPY | 500 | 5 | 2,500 | all months (per AMP) |
| NS | SGX Mini Nikkei 225 Index | SGX | JPY | 100 | 1 | 100 | see exchange |
| NU | SGX USD Nikkei 225 Index | SGX | USD | 5 | 5 | 25.00 | H, M, U, Z |
| TW | FTSE Taiwan Stock Index | SGX | USD | 100 | 0.1 | 10.00 | H, M, U, Z |
| AP | ASX SPI200 Index | ASX | AUD | 25 | 1 | 25.00 | H, M, U, Z |
| HSI | Hang Seng Index | HKEX | HKD | 50 | 1 | 50 | see exchange |
| MHI | Mini-Hang Seng Index | HKEX | HKD | 10 | 1 | 10 | see exchange |
| HHI | Hang Seng China Enterprises Index | HKEX | HKD | 50 | 1 | 50 | see exchange |
| MCH | Mini-Hang Seng China Enterprises Index | HKEX | HKD | 10 | 1 | 10 | see exchange |

Two AMP typos are corrected in the builder (`AMP_CORRECTIONS`, each with its reason, kept in the JSON as `amp_corrections`): FTSE 250 (Y) prints its contract size with a euro sign against a sterling tick value (£2 × index), and ASX SPI 200 (AP) prints a bare dollar sign against an A$25 tick value (A$25 × index). The builder refuses any row whose tick × multiplier ≠ tick value, so a third typo cannot get in silently.

## Where these numbers are used in the repo

| reader | takes from the specification |
|---|---|
| `src/shared/instruments.ts` | the JSON → `futuresTickInfo` (chart) and `futuresInstrumentRows()` (seed); the one derivation point |
| `scripts/seed-instruments.ts` → SQLite `instruments` → `/api/instruments` | the 8 lake roots: tick size, tick value, point value (multiplier), exchange, currency, decimal places, months, trading hours. Re-run after a rebuild: `npx tsx scripts/seed-instruments.ts` |
| `src/client/src/market/components/chartConfig.ts` | re-exports `futuresTickInfo`: price-scale precision and the "Tick: 0.25 = $0.50" label on the Market chart |
| `src/config/cost_model.json` | MNQ tick size, tick value, point value beside the broker fees; `src/ml/cycle/simulate.py`, `src/ml/blocks/trading_env.py` and `src/ml/lens/adapters.py` read it, so every USD P&L rests on these rows. Only MNQ has a cost entry, so the Model Cycle refuses the other seven roots until fees are added for them |
| `notebooks/contract_specifications.py` | the interactive view: filterable table, tick-value chart, the formula with sliders, the roll calendar against the lake, the hours histogram |

Gates: `tests/shared/instruments.test.ts` (vitest) holds the chart table, the seed rows and `cost_model.json` to the JSON; `tests/test_contract_specifications.py` (pytest) rebuilds the JSON from the saved AMP page (`tests/fixtures/amp_contract_specifications_2026-09-25.html`) and requires it to equal the committed file, checks every row's arithmetic, and holds `cost_model.json` to it.

## Verification (2026-09-25)

1. AMP's page was downloaded and parsed by the builder (its tables are div grids, not `<table>`); 42 rows, all satisfying tick × multiplier = tick value after the two currency-sign corrections above.
2. A five-agent workflow (three researchers, two refuting verifiers) cross-checked the rows. cmegroup.com returns 403 to a scripted fetch, so the CME pages were read in a live Chrome tab: the 15 CME / CBOT products' spec pages, the *Equity Index Roll Dates* page (canvas, read from a screenshot) and the E-nano FAQ. Every tick, multiplier, tick value and month on those 15 rows equals AMP's. The verifiers found no blocker; their findings were the two AMP typos, the "see exchange" months (left null rather than defaulted to quarterly), and AMP's "CBOT/CME" label, resolved to the listing exchange CBOT for YM, MYM and NDOW as CME's own pages do.
3. The repo's four earlier copies of the eight lake roots (seed script, SQLite, cost model, chart table) agreed with AMP and CME on every number; they now derive from the JSON instead of repeating it. Found on the way: `scripts/seed-instruments.ts` still imported the pre-reorg paths `../server/db` and `../shared/schema` and could not run; fixed.

## Rebuilding

```powershell
uv run python scripts/build_contract_specifications.py            # fetch AMP's live page and rewrite the JSON
uv run python scripts/build_contract_specifications.py --check    # exit 1 if AMP's page would change the file
npx tsx scripts/seed-instruments.ts                               # push the lake roots into SQLite / the API
```

The CME fields are the `CME_GROUP_VERIFIED` block in the builder; a scripted fetch cannot refresh them (403), so re-read the pages in a browser and edit the block. After a rebuild, save the downloaded page over the test fixture and re-run `pytest tests/test_contract_specifications.py` so the fixture and the file stay one reproduction apart.
