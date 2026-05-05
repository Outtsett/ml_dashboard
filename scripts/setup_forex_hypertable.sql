-- Forex 1-minute OHLCV hypertable
-- Run with: psql -U postgres -d ml_dashboard -f scripts/setup_forex_hypertable.sql

CREATE TABLE IF NOT EXISTS forex_1m (
    ts TIMESTAMPTZ NOT NULL,
    symbol TEXT NOT NULL,          -- e.g., 'EURUSD', 'USDJPY'
    open DOUBLE PRECISION NOT NULL,
    high DOUBLE PRECISION NOT NULL,
    low DOUBLE PRECISION NOT NULL,
    close DOUBLE PRECISION NOT NULL,
    volume BIGINT NOT NULL,
    pip_size DOUBLE PRECISION NOT NULL  -- 0.0001 for most, 0.01 for JPY pairs
);

SELECT create_hypertable('forex_1m', by_range('ts'), if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS forex_1m_symbol_ts_idx ON forex_1m (symbol, ts DESC);

-- Enable compression
ALTER TABLE forex_1m SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'symbol',
    timescaledb.compress_orderby = 'ts DESC'
);

SELECT add_compression_policy('forex_1m', INTERVAL '90 days', if_not_exists => TRUE);

-- Instrument metadata for forex pairs (pip sizes, point values, etc.)
INSERT INTO instruments (symbol, name, asset_type, exchange, tick_size, tick_value, point_value, contract_size, currency, decimal_places)
VALUES
    ('EURUSD', 'Euro / US Dollar',       'forex', 'OTC', 0.00001, 0.10, 100000, 100000, 'USD', 5),
    ('GBPUSD', 'British Pound / US Dollar','forex','OTC', 0.00001, 0.10, 100000, 100000, 'USD', 5),
    ('USDJPY', 'US Dollar / Japanese Yen','forex', 'OTC', 0.001,   0.01, 1000,   100000, 'JPY', 3),
    ('USDCAD', 'US Dollar / Canadian Dollar','forex','OTC',0.00001,0.10, 100000, 100000, 'CAD', 5),
    ('USDCHF', 'US Dollar / Swiss Franc', 'forex', 'OTC', 0.00001, 0.10, 100000, 100000, 'CHF', 5),
    ('AUDUSD', 'Australian Dollar / US Dollar','forex','OTC',0.00001,0.10,100000,100000,'USD', 5),
    ('NZDUSD', 'New Zealand Dollar / US Dollar','forex','OTC',0.00001,0.10,100000,100000,'USD', 5),
    ('EURGBP', 'Euro / British Pound',    'forex', 'OTC', 0.00001, 0.10, 100000, 100000, 'GBP', 5),
    ('EURJPY', 'Euro / Japanese Yen',     'forex', 'OTC', 0.001,   0.01, 1000,   100000, 'JPY', 3),
    ('EURCHF', 'Euro / Swiss Franc',      'forex', 'OTC', 0.00001, 0.10, 100000, 100000, 'CHF', 5),
    ('GBPAUD', 'British Pound / Aus Dollar','forex','OTC', 0.00001, 0.10, 100000, 100000, 'AUD', 5),
    ('GBPJPY', 'British Pound / Japanese Yen','forex','OTC',0.001,  0.01, 1000,   100000, 'JPY', 3),
    ('GBPCHF', 'British Pound / Swiss Franc','forex','OTC',0.00001, 0.10, 100000, 100000, 'CHF', 5),
    ('AUDJPY', 'Australian Dollar / Japanese Yen','forex','OTC',0.001,0.01,1000,  100000, 'JPY', 3),
    ('CADJPY', 'Canadian Dollar / Japanese Yen','forex','OTC',0.001, 0.01, 1000,  100000, 'JPY', 3)
ON CONFLICT (symbol) DO UPDATE SET
    tick_size = EXCLUDED.tick_size,
    tick_value = EXCLUDED.tick_value,
    point_value = EXCLUDED.point_value,
    decimal_places = EXCLUDED.decimal_places;
