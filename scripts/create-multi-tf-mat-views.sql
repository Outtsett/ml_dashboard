-- Multi-timeframe materialized views over `ohlcv`.
--
-- IMPORTANT: `ohlcv` is 1-SECOND granularity (not 1m). Sample MNQ rows show
--   2024-06-03T13:30:00, 13:30:01, 13:30:02, ... — every second has a bar.
-- Therefore `ohlcv_1m` is itself a mat view (true 1m bars from 1s base).
--
-- The existing populated `ohlcv_1h` table contains 57 crypto USD pairs only
-- (XPL-USD, AVAX-USD, ...) and is preserved per user direction. The
-- `ohlcv_1h_v` mat view below provides 1h bars for ALL symbols, including
-- futures (MNQ) and forex (EURUSD).
--
-- Aggregation rules:
--   first(open) / max(high) / min(low) / last(close) — standard OHLC
--   sum(volume, trades, vol_at_*, trades_at_*)        — additive microstructure
-- Group keys: timestamp + symbol + asset_class + root (keyed SAMPLE BY)
-- REFRESH IMMEDIATE: mat view auto-updates on every base insert.
-- ALIGN TO CALENDAR: bars align to wall-clock boundaries.

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_1m
WITH BASE ohlcv REFRESH IMMEDIATE AS (
    SELECT
        timestamp, symbol, asset_class, root,
        first(open)        AS open,
        max(high)          AS high,
        min(low)           AS low,
        last(close)        AS close,
        sum(volume)        AS volume,
        sum(trades)        AS trades,
        sum(vol_at_bid)    AS vol_at_bid,
        sum(vol_at_ask)    AS vol_at_ask,
        sum(trades_at_bid) AS trades_at_bid,
        sum(trades_at_ask) AS trades_at_ask
    FROM ohlcv
    SAMPLE BY 1m ALIGN TO CALENDAR
) PARTITION BY MONTH TTL 2 YEARS;

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_5m
WITH BASE ohlcv REFRESH IMMEDIATE AS (
    SELECT
        timestamp, symbol, asset_class, root,
        first(open)        AS open,
        max(high)          AS high,
        min(low)           AS low,
        last(close)        AS close,
        sum(volume)        AS volume,
        sum(trades)        AS trades,
        sum(vol_at_bid)    AS vol_at_bid,
        sum(vol_at_ask)    AS vol_at_ask,
        sum(trades_at_bid) AS trades_at_bid,
        sum(trades_at_ask) AS trades_at_ask
    FROM ohlcv
    SAMPLE BY 5m ALIGN TO CALENDAR
) PARTITION BY MONTH TTL 2 YEARS;

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_15m
WITH BASE ohlcv REFRESH IMMEDIATE AS (
    SELECT
        timestamp, symbol, asset_class, root,
        first(open)        AS open,
        max(high)          AS high,
        min(low)           AS low,
        last(close)        AS close,
        sum(volume)        AS volume,
        sum(trades)        AS trades,
        sum(vol_at_bid)    AS vol_at_bid,
        sum(vol_at_ask)    AS vol_at_ask,
        sum(trades_at_bid) AS trades_at_bid,
        sum(trades_at_ask) AS trades_at_ask
    FROM ohlcv
    SAMPLE BY 15m ALIGN TO CALENDAR
) PARTITION BY MONTH TTL 2 YEARS;

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_30m
WITH BASE ohlcv REFRESH IMMEDIATE AS (
    SELECT
        timestamp, symbol, asset_class, root,
        first(open)        AS open,
        max(high)          AS high,
        min(low)           AS low,
        last(close)        AS close,
        sum(volume)        AS volume,
        sum(trades)        AS trades,
        sum(vol_at_bid)    AS vol_at_bid,
        sum(vol_at_ask)    AS vol_at_ask,
        sum(trades_at_bid) AS trades_at_bid,
        sum(trades_at_ask) AS trades_at_ask
    FROM ohlcv
    SAMPLE BY 30m ALIGN TO CALENDAR
) PARTITION BY MONTH TTL 3 YEARS;

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_1h_v
WITH BASE ohlcv REFRESH IMMEDIATE AS (
    SELECT
        timestamp, symbol, asset_class, root,
        first(open)        AS open,
        max(high)          AS high,
        min(low)           AS low,
        last(close)        AS close,
        sum(volume)        AS volume,
        sum(trades)        AS trades,
        sum(vol_at_bid)    AS vol_at_bid,
        sum(vol_at_ask)    AS vol_at_ask,
        sum(trades_at_bid) AS trades_at_bid,
        sum(trades_at_ask) AS trades_at_ask
    FROM ohlcv
    SAMPLE BY 1h ALIGN TO CALENDAR
) PARTITION BY MONTH TTL 3 YEARS;

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_4h
WITH BASE ohlcv REFRESH IMMEDIATE AS (
    SELECT
        timestamp, symbol, asset_class, root,
        first(open)        AS open,
        max(high)          AS high,
        min(low)           AS low,
        last(close)        AS close,
        sum(volume)        AS volume,
        sum(trades)        AS trades,
        sum(vol_at_bid)    AS vol_at_bid,
        sum(vol_at_ask)    AS vol_at_ask,
        sum(trades_at_bid) AS trades_at_bid,
        sum(trades_at_ask) AS trades_at_ask
    FROM ohlcv
    SAMPLE BY 4h ALIGN TO CALENDAR
) PARTITION BY YEAR TTL 5 YEARS;

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_1d
WITH BASE ohlcv REFRESH IMMEDIATE AS (
    SELECT
        timestamp, symbol, asset_class, root,
        first(open)        AS open,
        max(high)          AS high,
        min(low)           AS low,
        last(close)        AS close,
        sum(volume)        AS volume,
        sum(trades)        AS trades,
        sum(vol_at_bid)    AS vol_at_bid,
        sum(vol_at_ask)    AS vol_at_ask,
        sum(trades_at_bid) AS trades_at_bid,
        sum(trades_at_ask) AS trades_at_ask
    FROM ohlcv
    SAMPLE BY 1d ALIGN TO CALENDAR
) PARTITION BY YEAR TTL 10 YEARS;

CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_1w
WITH BASE ohlcv REFRESH IMMEDIATE AS (
    SELECT
        timestamp, symbol, asset_class, root,
        first(open)        AS open,
        max(high)          AS high,
        min(low)           AS low,
        last(close)        AS close,
        sum(volume)        AS volume,
        sum(trades)        AS trades,
        sum(vol_at_bid)    AS vol_at_bid,
        sum(vol_at_ask)    AS vol_at_ask,
        sum(trades_at_bid) AS trades_at_bid,
        sum(trades_at_ask) AS trades_at_ask
    FROM ohlcv
    SAMPLE BY 1w ALIGN TO CALENDAR
) PARTITION BY YEAR TTL 10 YEARS;
