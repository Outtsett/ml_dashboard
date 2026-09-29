**Recommendation:** GDELT GKG is the only free source that covers the whole 2015–2025 span with 15-minute first-seen timestamps. It must be filtered while streaming, because the raw archive is about 200 GB a year. Add FNSPID and the multisource intraday subsets for 2010–2014 and headline text, and FOMC, BLS and ALFRED for the calendar. Sizes below are measured unless marked otherwise.

## Findings

**1. GDELT 2.0 bulk files**
- The master list is https://data.gdeltproject.org/gdeltv2/masterfilelist.txt (128 MB, updated every 15 minutes). Use https; a plain-http fetch returned nothing. The first entry is 2015-02-18, so there is no v2 data before that.
- Zipped sizes below are summed from the master list. File counts are per type; a full year is 35,040 slots, so 2025 has gaps.

| Year | Files per type | GKG (GB) | Events (GB) | Mentions (GB) |
|---|---|---|---|---|
| 2015 (from 02-18) | 30,140 | 273.2 | 3.96 | 7.26 |
| 2020 | 32,551 | 216.0 | 3.08 | 5.16 |
| 2024 | 35,134 | 204.1 | 2.96 | 4.36 |
| 2025 | 33,359 | 173.2 | 2.62 | 3.80 |

- 2016 was the largest year at 403 GB of GKG.
- **Timestamp:** the file stamp (`YYYYMMDDHHMMSS`, every 15 minutes) is when GDELT crawled the article, i.e. first-seen time. The GKG 2.1 codebook calls its DATE field the publication date at 15-minute resolution. Use the file stamp as the known-time. The repo's existing GDELT DOC code already treats `seendate` as first-seen and sets `published_ts` to null (`E:\source\repos\datalake\scripts\backfill_news.py:99`).
- **Fields:** V2Tone gives tone (about -100 to +100). V2Themes and V2EnhancedThemes give themes, and V2Organizations gives organisations.
- **Page titles:** yes. Since September 2019 GKG carries `<PAGE_TITLE>` inside V2EXTRASXML. My fetch of the codebook PDF said it does not; the GDELT blog post "GKG 2.0 Now Includes Page Titles" says it does, and I took the blog. Titles are missing before that date, so 2015–2019 headlines have to come from elsewhere.
- **Access and cost:** bulk files are free with no key. Terms are open, with attribution requested.
- **DOC 2.0 API throttling** (from the module docstring at `E:\source\repos\datalake\src\lake\gdelt.py:1-23`):
  - 250 records per query, with no cursor.
  - Five back-to-back requests earned a connection block, so the client paces at 5 s.
  - The index starts 2017-01-01.
  - It returns only the title, never body text.
- **Landing:** landing all 2015–2025 raw is about 2.3 TB of zips (E: has about 300 GB free), so do not do that. Stream each 15-minute GKG zip, keep only rows matching finance/macro themes or a domain allowlist, and land the filtered parquet. Each file gets a sha256 sidecar and a source-file-name manifest under `E:\lake\raw\vendor=gdelt_gkg\`. That is a filtered landing rather than the byte-identical write-once copy the repo rule assumes, so the rule needs a documented exception.
- Events and mentions are cheap (about 8 GB a year together) and could be landed whole.

**2. FNSPID (Hugging Face `Zihan1004/FNSPID`)**
- **Coverage:** 1999–2023. It has 15.7M news records and 29.7M price records for 4,775 S&P 500 companies, 29.6 GB in total, in `Stock_news/` and `Stock_price/` folders.
- **Sources:** Nasdaq (scraped), Bloomberg, Reuters, Benzinga and Lenta.
- **Licence:** CC BY-NC-4.0, which is fine for personal research.
- **Timestamp:** the README and file listing I fetched do not give the schema or timestamp precision, so I could not confirm it. The multisource card marks `fnspid_news` as "mixed" precision.
- **Nasdaq index coverage:** there are no index-futures tags. It is per-company S&P 500 news, so NQ/MNQ relevance has to be inferred from mega-cap tickers.

**3. Best three other free datasets with minute-level timestamps**
All three are subsets of `Brianferrell787/financial-news-multisource` on Hugging Face. The whole corpus is 57.1M rows and 21.4 GB, ISO-8601 UTC dates, research-only licence, and 2010–2025 intraday coverage is uneven. From the dataset card, not measured:
- `yahoo_finance_felixdrinkall` (2017–2023, minute).
- `reddit_finance_sp500` (2008–2025, minute).
- `nyt_headlines_2010_2021` (minute).
- `benzinga_6000stocks` is the best financial-headline source with minute timestamps. The card lists its years only as "2000s–2010s"; the Kaggle version I recall runs 2009–2020, which I did not verify.
- I did not check whether the minute stamps are publication or scrape times. Test that with a sample before trusting any of them.

**4. Alpha Vantage NEWS_SENTIMENT**
- `time_from` and `time_to` take `YYYYMMDDTHHMM`, and `limit` goes up to 1000.
- Data is available from at least 2022-03-01. That earliest date comes from a secondary source, not the official docs.
- The 25 requests a day limit is not confirmed by anything I fetched; it comes from the task text. The official docs page returned truncated and the Alpha Intelligence section was cut off.
- A key is already set, `ALPHA_VANTAGE_API_KEY`. The live hub already lands Alpha Vantage rows (2,459 rows on 2026-09-28). At 25 requests of up to 1000 articles a day it is a slow top-up for 2022 onward, not a bulk source.

**5. Economic calendar**
- **Environment variable names present** (User scope): `OANDA_ENVIRONMENT`, `OANDA_API_KEY`, `OANDA_ACCOUNT_ID`, `ALPHA_VANTAGE_API_KEY`. There is no FRED, FINNHUB, POLYGON or GDELT variable.
- **FRED/ALFRED:** the `fred/release/dates` endpoint and ALFRED vintages are free but need a key. Registration is free and it is not set here, so the key is the one item Tyler would have to supply. ALFRED gives point-in-time values, which avoids revision look-ahead. FRED's own caveat is that release dates are published by the data sources and may differ from when data appears on FRED.
- **BLS:** CPI and Employment Situation release at 08:30 ET. The BLS schedule pages list dates by year, and I saw 2025 and 2026 pages, so that is a scrape.
- **FOMC:** federalreserve.gov has per-year historical pages (`/monetarypolicy/fomchistorical<YEAR>.htm`) and statement pages. I could not confirm statement times from the index. Statements go out at 14:00 ET, which is my recollection only; check it against statement pages.

**6. Already on disk**
- `E:\source\repos\datalake\scripts\backfill_news.py` is a resumable GDELT DOC API backfill with a checkpoint and a `--calibrate` mode. Its DOC API floor is 2017-01-01, it stores headline text only, and it writes `text_source = title`.
- Coverage in the lake, from `curated/news_articles` (queried via the dashboard):

| Vendor | Rows | From | To |
|---|---|---|---|
| gdelt | 43,613 | 2025-12-15 | 2026-09-28 |
| rss | 2,198 | 2026-09-28 | 2026-09-28 |
| alphavantage | 2,459 | 2026-09-28 | 2026-09-28 |

- There is one derived view, `derived_news_features`.
- There is no economic-calendar code or table in `datalake` (grep for fomc, release_dates and economic_calendar found only the GDELT and news modules).

## Recommended combination
1. **Text and tone, 2015-02 to now:** filtered GDELT GKG (V2Tone, themes, organisations, PAGE_TITLE from 2019-09), streamed and filtered. Where titles are missing, fall back to the DOC API from 2017-01.
2. **Headline text and 2010–2014 gap:** FNSPID plus the multisource minute-level subsets, after checking each subset's timestamp semantics and dropping any that are only scrape times.
3. **2022 onward top-up:** Alpha Vantage, since the key exists.
4. **Calendar:** FOMC statements from the Fed site, BLS CPI/NFP/PPI dates at 08:30 ET, and ALFRED for revisions once a free FRED key is registered.

**Landing plan:** all of it goes under `E:\lake\raw\vendor=<name>\` (`gdelt_gkg`, `fnspid`, `multisource`, `fomc`, `bls`, `alfred`), each file with a `.sha256` sidecar. The fetch script uses `land_raw.py`, then promotes to `curated/news_articles` (existing contract) and a new calendar table.

**Decisions for you:**
- Approve the filtered-GKG exception to write-once raw.
- Register the free FRED key.

**Other caveats:**
- GDELT rate-limits by IP. `E:\source\repos\ml_dashboard\CLAUDE.md` records the hub's GDELT backfill being refused with a cool-off escalating to 4 hours. The bulk files are on a different host (data.gdeltproject.org), and I did not test whether that host is throttled the same way.
- Expect 2010–2014 news to be thin: GDELT 2.0 starts in 2015 and FNSPID's minute coverage is partial.
- GDELT stamps are UTC. The lake's futures stamps are Pacific wall-clock stored as UTC (see `E:\source\repos\ml_dashboard\CLAUDE.md`, Open findings), so the join needs an explicit shift.

Sources:
- [GDELT masterfilelist](https://data.gdeltproject.org/gdeltv2/masterfilelist.txt)
- [GKG 2.1 codebook](https://data.gdeltproject.org/documentation/GDELT-Global_Knowledge_Graph_Codebook-V2.1.pdf)
- [GKG 2.0 page titles](https://blog.gdeltproject.org/gkg-2-0-now-includes-page-titles/)
- [FNSPID on Hugging Face](https://huggingface.co/datasets/Zihan1004/FNSPID)
- [FNSPID paper](https://arxiv.org/abs/2402.06698)
- [financial-news-multisource](https://huggingface.co/datasets/Brianferrell787/financial-news-multisource)
- [Alpha Vantage documentation](https://www.alphavantage.co/documentation/)
- [BLS release schedule](https://www.bls.gov/schedule/)
- [FRED release/dates API](https://fred.stlouisfed.org/docs/api/fred/release_dates.html)
- [ALFRED help](https://alfred.stlouisfed.org/help/downloaddata)
- [Fed FOMC historical](https://www.federalreserve.gov/monetarypolicy/fomc_historical_year.htm)