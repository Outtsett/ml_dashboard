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
| Lake | `stores/Navigator.tsx` (`LakeNavigator`), `stores/StoreBrowser.tsx`, `stores/ColumnProfiles.tsx` | `GET /api/stores/objects-by-kind`, `/api/stores/object/:name`, `/api/stores/objects/lake/:name`, `/api/stores/rows/lake/:name`, `/api/stores/profile/lake/:name` |
| SQLite | `SqliteNavigator`, `StoreBrowser` | `GET /api/stores/overview`, `/api/stores/objects/sqlite/:name`, `/api/stores/rows/sqlite/:name` |
| PostgreSQL | `stores/PgAdminFrame.tsx` | `GET /api/pgadmin/status`, `POST /api/pgadmin/restart` |
| SQL | `QueryConsole.tsx`, `VirtualDataTable.tsx` | `POST /api/databases/query` (read statements only, at most 1,000 rows) |
| Engine | `stores/StorePanels.tsx` | `GET /api/stores/duckdb`, `/api/stores/iceberg?table=bars` |

All requests are hooks in `stores/hooks.ts`; each passes the abort signal and throws on a non-OK answer.

## Rules the page keeps

- A number is written by `packages/shared/src/stores/format.ts` (whole counts, percentages, at most one decimal, never scientific notation); the stored value is the cell's hover text.
- A service state is a glyph, a word and an Okabe-Ito colour together (`stores/status.ts`).
- The rows grid shows the statement the server ran as its caption.
- The Iceberg `bars` table (882 million rows) can be sorted only once a filter narrows it (`requireFilterToSort`).
- A whole number in a column named like a time (`_at`, `_time`, `timestamp`, `_date`) that falls in the epoch range reads as a UTC date and time.
