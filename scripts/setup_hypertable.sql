-- TimescaleDB hypertable for raw 1-second OHLCV contract-level data
-- Run with: psql -U postgres -d ml_dashboard -f scripts/setup_hypertable.sql

CREATE TABLE IF NOT EXISTS ohlcv_1s (
    ts TIMESTAMPTZ NOT NULL,
    symbol TEXT NOT NULL,
    base_symbol TEXT NOT NULL,
    open DOUBLE PRECISION NOT NULL,
    high DOUBLE PRECISION NOT NULL,
    low DOUBLE PRECISION NOT NULL,
    close DOUBLE PRECISION NOT NULL,
    volume BIGINT NOT NULL
);

SELECT create_hypertable('ohlcv_1s', by_range('ts'), if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS ohlcv_1s_symbol_ts_idx ON ohlcv_1s (symbol, ts DESC);
CREATE INDEX IF NOT EXISTS ohlcv_1s_base_ts_idx ON ohlcv_1s (base_symbol, ts DESC);

-- Enable compression for older data
ALTER TABLE ohlcv_1s SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'symbol, base_symbol',
    timescaledb.compress_orderby = 'ts DESC'
);

-- Add compression policy: auto-compress chunks older than 90 days
SELECT add_compression_policy('ohlcv_1s', INTERVAL '90 days', if_not_exists => TRUE);

-- Daily volume summary (used for rollover detection)
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_contract_volume AS
SELECT
    time_bucket('1 day', ts) AS day,
    symbol,
    base_symbol,
    SUM(volume) AS total_volume,
    COUNT(*) AS bar_count,
    MIN(open) AS day_open,
    MAX(high) AS day_high,
    MIN(low) AS day_low,
    (array_agg(close ORDER BY ts DESC))[1] AS day_close
FROM ohlcv_1s
GROUP BY day, symbol, base_symbol;

CREATE UNIQUE INDEX IF NOT EXISTS daily_volume_unique_idx
    ON daily_contract_volume (day, symbol);
CREATE INDEX IF NOT EXISTS daily_volume_base_idx
    ON daily_contract_volume (base_symbol, day DESC);
