# `prediction_log` schema reference

Stores every prediction emitted by a live model deployment, plus a 1-minute
rollup for sub-second dashboard refresh.

> **The time-series copy is gone.** Until 2026-09-10 this table was mirrored
> into a QuestDB hot path alongside SQLite. That store was emptied and retired;
> the SQLite `prediction_log` table (`src/shared/schema.ts`) is now the only
> one. The column shapes below still describe the intended record — read the
> type column as intent, not as live DDL. Re-homing the rollup onto the lake or
> SQLite is outstanding work.

SQLite table: `prediction_log` in `src/shared/schema.ts`
Writer: `src/server/deployments/predictionLog.ts` (W9.b)

Retired, do not run: `scripts/create-prediction-log-table.sql`,
`scripts/create-prediction-log-rollup.sql`,
`scripts/apply-prediction-log-table.py`.

## Table shape — `prediction_log`

| Column             | Type              | Nullable | Notes                                                                 |
| ------------------ | ----------------- | -------- | --------------------------------------------------------------------- |
| `ts`               | `TIMESTAMP`       | no       | Bar timestamp. **Designated timestamp.** Microsecond precision.       |
| `deployment_id`    | `LONG`            | no       | FK to SQLite `deployments.deployment_id`.                             |
| `prediction_str`   | `SYMBOL` cap=64   | yes      | Class label (e.g. `long` / `short` / `flat`). Mutually exclusive with `prediction_num` in practice but both may be set. |
| `prediction_num`   | `DOUBLE`          | yes      | Regression value or probability (0..1).                               |
| `confidence`       | `DOUBLE`          | no       | Calibrated confidence 0..1.                                           |
| `paper_pnl_delta`  | `DOUBLE`          | no       | Per-bar PnL change attributed to this prediction (cost-adjusted).     |
| `paper_pnl_total`  | `DOUBLE`          | no       | Running paper-PnL total since deployment started.                     |
| `model_version_id` | `LONG`            | no       | FK to SQLite `model_versions.version_id` — denormalized for fast joins on the time-series side. |
| `symbol`           | `SYMBOL` cap=64 + INDEX | no | e.g. `MNQ`, `EURUSD`. Indexed for fast WHERE filtering.            |
| `timeframe`        | `SYMBOL` cap=16 + INDEX | no | `1s`, `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`, `1w`.            |

Storage: `TIMESTAMP(ts) PARTITION BY DAY WAL DEDUP UPSERT KEYS(ts, deployment_id)`

- **Partition by DAY** — at ~86k 1-second bars/day per deployment, daily partitions stay in the 30-80M-row sweet spot as deployments scale.
- **WAL enabled** — required for both `DEDUP` and the downstream mat view.
- **DEDUP UPSERT KEYS(ts, deployment_id)** — retried writes (network blip, runner restart) replace rather than duplicate. One row per `(ts, deployment_id)`.

## Rollup mat view — `prediction_log_rollup_1m`

| Column                | Type        | Notes                                                |
| --------------------- | ----------- | ---------------------------------------------------- |
| `ts`                  | `TIMESTAMP` | 1-minute bucket boundary (calendar-aligned).         |
| `deployment_id`       | `LONG`      | Group key.                                           |
| `symbol`              | `SYMBOL`    | Group key.                                           |
| `timeframe`           | `SYMBOL`    | Group key.                                           |
| `predictions_emitted` | `LONG`      | `count()` per minute — liveness / activity heartbeat.|
| `paper_pnl_total`     | `DOUBLE`    | `last(paper_pnl_total)` in the minute — PnL curve sample. |
| `avg_confidence`      | `DOUBLE`    | `avg(confidence)` in the minute.                     |

Refresh: was `REFRESH IMMEDIATE` on the retired store. No equivalent rollup is live today.

## ILP line example

The Node writer (`src/server/deployments/predictionLog.ts`) sends one ILP line per prediction:

```
prediction_log,symbol=MNQ,timeframe=1m deployment_id=1i,prediction_num=0.73,confidence=0.85,paper_pnl_delta=12.50,paper_pnl_total=145.30,model_version_id=42i 1715472000000000000
```

Field grammar:

- **Tags** (SYMBOL columns, no quotes): `symbol=MNQ,timeframe=1m`
- **Fields**: integers carry `i` suffix (`deployment_id=1i`), floats are bare (`confidence=0.85`), strings are double-quoted (`prediction_str="long"`)
- **Timestamp**: trailing nanoseconds (UNIX epoch * 1e9)

A classifier emission with a string label looks like:

```
prediction_log,symbol=MNQ,timeframe=5m deployment_id=2i,prediction_str="long",confidence=0.62,paper_pnl_delta=0.0,paper_pnl_total=0.0,model_version_id=17i 1715472300000000000
```

Either `prediction_str` OR `prediction_num` may be omitted, but at least one of the two must be set.

## Common queries

### Latest 100 predictions for a deployment

```sql
SELECT ts, prediction_str, prediction_num, confidence,
       paper_pnl_delta, paper_pnl_total
FROM prediction_log
WHERE deployment_id = 1
ORDER BY ts DESC
LIMIT 100;
```

### Most recent prediction per deployment (uses LATEST ON for O(1))

```sql
SELECT *
FROM prediction_log
LATEST ON ts PARTITION BY deployment_id;
```

### Daily PnL curve for a deployment, last 7 days (uses mat view)

```sql
SELECT ts, paper_pnl_total
FROM prediction_log_rollup_1m
WHERE deployment_id = 1
  AND ts > dateadd('d', -7, now())
ORDER BY ts;
```

### Activity heatmap across all deployments, last 6 hours (uses mat view)

```sql
SELECT ts, deployment_id, predictions_emitted
FROM prediction_log_rollup_1m
WHERE ts > dateadd('h', -6, now())
ORDER BY ts;
```

### Accuracy by hour (joins classifier prediction back to realized outcome)

Requires the realized-outcome column on the bars table; pattern shown for reference:

```sql
SELECT
    date_trunc('hour', p.ts) AS hour,
    count_distinct(p.ts)     AS bars,
    avg(
        CASE WHEN p.prediction_str = b.realized_direction THEN 1.0 ELSE 0.0 END
    ) AS accuracy
FROM prediction_log p
ASOF JOIN bars b ON (p.symbol = b.symbol)
WHERE p.deployment_id = 1
  AND p.ts > dateadd('d', -1, now())
GROUP BY hour
ORDER BY hour;
```

## Retention policy

No retention/TTL configured yet. Tyler will set this once real-time deployments
start producing production traffic — until then, daily partitions can be
dropped manually (`ALTER TABLE prediction_log DROP PARTITION LIST '<date>'`)
if disk pressure shows up during development.

The rollup mat view does not need its own retention — it's recomputed
incrementally from the base table and can be dropped + re-created from
the SQL file at any time.

## Applying / re-applying

```bash
# From repo root, with conda `ml` env activated:
python scripts/apply-prediction-log-table.py            # apply (idempotent)
python scripts/apply-prediction-log-table.py --dry-run  # print SQL only
```

This applier targeted the retired store's PG-wire endpoint. Nothing listens
there; running it fails at connect. It is kept only as the record of the
intended DDL.
