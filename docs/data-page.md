# The Data page (`/databases`)

What the dashboard's stores hold, browsable. Every count on the page is read from the server when the page loads.

## URL

| Parameter | Values | Meaning |
|---|---|---|
| `tab` | `lake` (default), `sqlite`, `postgres`, `query`, `engine` | Which store is open. An unknown value opens the lake. |
| `dataset` | a view name, an object id or a bare dataset name | Lake tab: the object whose rows or columns are shown. Alone, it implies `tab=lake`. |
| `view` | `rows` (default), `columns` | Lake tab: the rows grid, or one panel per column. |
| `feature` | a feature id from `packages/config/features.json` | Lake tab: the feature's definition card. |
| `table` | a SQLite table name | SQLite tab: the table whose rows are shown. |

`apps/web/src/data/tabs.ts` is the only reader and writer of these.

## Tabs and what each reads

| Tab | Component | Routes |
|---|---|---|
| Lake | `stores/Navigator.tsx` (`LakeNavigator`), `stores/StoreBrowser.tsx`, `stores/ColumnProfiles.tsx` | `GET /api/stores/objects-by-kind`, `/api/stores/inventory`, `/api/stores/object/:name`, `/api/stores/objects/lake/:name`, `/api/stores/rows/lake/:name`, `/api/stores/profile/lake/:name` |
| SQLite | `SqliteNavigator`, `StoreBrowser` | `GET /api/stores/overview`, `/api/stores/objects/sqlite/:name`, `/api/stores/rows/sqlite/:name` |
| PostgreSQL | `stores/PostgresPanel.tsx`, `stores/PgAdminFrame.tsx` | `GET /api/stores/postgres`, `/api/pgadmin/status`, `POST /api/pgadmin/restart` |
| SQL | `QueryConsole.tsx`, `VirtualDataTable.tsx` | `POST /api/databases/query` (read statements only, at most 1,000 rows) |
| Engine | `stores/StorePanels.tsx` | `GET /api/stores/duckdb`, `/api/stores/iceberg?table=bars` |

All requests are hooks in `stores/hooks.ts`; each passes the abort signal and throws on a non-OK answer.

## Rules the page keeps

- A number is written by `packages/shared/src/stores/format.ts` (whole counts, percentages, at most one decimal, never scientific notation); the stored value is the cell's hover text.
- A service state is a glyph, a word and an Okabe-Ito colour together (`stores/status.ts`).
- The rows grid shows the statement the server ran as its caption.
- The Iceberg `bars` table (882 million rows) can be sorted only once a filter narrows it (`requireFilterToSort`).
- A whole number in a column named like a time (`_at`, `_time`, `timestamp`, `_date`) that falls in the epoch range reads as a UTC date and time.

## Row counts

`GET /api/stores/inventory` answers every lake object's row count at once (`getLakeStats` in `apps/api/infrastructure/database/lake/introspection.ts`). A view is counted with `SELECT count(*)`, eight views at a time; an Iceberg table reports the catalog's `total-records` for its newest snapshot and is never counted row by row; a count that fails is `null` with its error, never 0. The answer is held for ten minutes, concurrent callers share one count, `?refresh=1` counts again, and the server counts once at startup. Measured 2026-10-10: 440 objects in 2.4 seconds, 0 failures, 3 milliseconds from memory. `GET /api/stores/objects/lake/:name` reads its row total from the same inventory.

`GET /api/stores/overview` gives the SQLite file's size on disk (`sqlite.sizeBytes`: the database file plus its write-ahead log).

## Limits the server enforces

`GET /api/stores/rows/lake/:name` (constants in `apps/api/data/stores.router.ts`):

- A sort runs only when the rows it would read are known and at most 50,000,000 (`SORT_ROW_LIMIT`): the object's counted rows with no filter, the counted matches with one. A filter that matches everything is therefore refused like no filter, and an object whose count is unknown is refused, not waved through. The answer is 400 with the number in the sentence. The page disables the sort button for the unfiltered case.
- Every lake statement the route runs is stopped after 15 seconds (`BROWSE_TIMEOUT_MILLISECONDS`).
- `GET /api/stores/inventory?refresh=1` recounts at most once a minute; other requests get the held answer.

## Iceberg snapshot ids

`fetchIcebergTable` parses the catalog answer with `parseIcebergBody` (`lake/connection.ts`), which reads `snapshot-id`, `parent-snapshot-id` and `current-snapshot-id` as strings: a 64-bit id above 2^53 is rounded when read as a JSON number (7470822850192638789 was served as 7470822850192639000). The Engine tab shows the id digit for digit and states the newest commit's age in whole days with that snapshot's row and file totals.

## PostgreSQL facts

`GET /api/stores/postgres` (`apps/api/infrastructure/database/postgresInventory.ts`) reads, for the `quant` and `market` databases, the server version, extensions, database size, public tables with the planner estimate of rows (`n_live_tup`, labelled an estimate), views, and TimescaleDB hypertables with chunk count, size, time range and `approximate_row_count`. Each statement stops after 3 seconds; the answer is held 30 seconds; an unreachable database is listed as unreachable with the driver message. Measured 2026-10-10: PostgreSQL 17.11 with timescaledb 2.30.0; `market` takes 132.2 gigabytes, its `market_bars` hypertable holds about 785,766,203 rows (estimate) in 198 chunks from 2010-05-31 to 2026-09-04; `quant` takes 23 megabytes.
