-- Volume-based rollover detection and Panama-method continuous contract stitching
-- Requires: ohlcv_1s hypertable populated, daily_contract_volume materialized view refreshed
-- Run with: psql -U postgres -d ml_dashboard -f scripts/setup_rollover_stitching.sql

-- ============================================================
-- 1. Volume-based rollover detection
-- ============================================================
-- For each base symbol and each day, find which contract has the highest volume.
-- A rollover occurs when the volume leader changes from one contract to another.

CREATE OR REPLACE VIEW volume_leader AS
SELECT DISTINCT ON (base_symbol, day)
    day,
    base_symbol,
    symbol AS leader_contract,
    total_volume
FROM daily_contract_volume
WHERE total_volume > 0
ORDER BY base_symbol, day, total_volume DESC;

-- Detect rollover points: where the leader changes
CREATE OR REPLACE VIEW rollover_events AS
WITH leaders AS (
    SELECT
        day,
        base_symbol,
        leader_contract,
        total_volume,
        LAG(leader_contract) OVER (PARTITION BY base_symbol ORDER BY day) AS prev_leader
    FROM volume_leader
)
SELECT
    day AS rollover_date,
    base_symbol,
    prev_leader AS from_contract,
    leader_contract AS to_contract,
    total_volume
FROM leaders
WHERE prev_leader IS NOT NULL
  AND leader_contract != prev_leader;

-- ============================================================
-- 2. Price adjustments at rollover points (Panama method)
-- ============================================================
-- At each rollover, compute the price difference between the old and new contract
-- at the close of the rollover day. This difference is the adjustment factor.

CREATE OR REPLACE VIEW rollover_adjustments AS
SELECT
    r.rollover_date,
    r.base_symbol,
    r.from_contract,
    r.to_contract,
    old_bar.day_close AS from_close,
    new_bar.day_close AS to_close,
    (new_bar.day_close - old_bar.day_close) AS price_gap
FROM rollover_events r
LEFT JOIN daily_contract_volume old_bar
    ON old_bar.day = r.rollover_date
    AND old_bar.symbol = r.from_contract
LEFT JOIN daily_contract_volume new_bar
    ON new_bar.day = r.rollover_date
    AND new_bar.symbol = r.to_contract
WHERE old_bar.day_close IS NOT NULL
  AND new_bar.day_close IS NOT NULL;

-- Cumulative adjustment: sum all price gaps from the most recent rollover backward
-- This gives us the total adjustment needed at any point in history.
CREATE OR REPLACE VIEW cumulative_adjustments AS
SELECT
    rollover_date,
    base_symbol,
    from_contract,
    to_contract,
    price_gap,
    -- Sum of all future gaps (back-adjustment):
    -- The most recent contract needs 0 adjustment.
    -- Each older contract needs the sum of all gaps after its rollover.
    SUM(price_gap) OVER (
        PARTITION BY base_symbol
        ORDER BY rollover_date DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS cumulative_adjustment
FROM rollover_adjustments
ORDER BY base_symbol, rollover_date DESC;

-- ============================================================
-- 3. Contract schedule: which contract is active on each day
-- ============================================================
CREATE OR REPLACE VIEW active_contract_schedule AS
WITH rollovers AS (
    SELECT
        rollover_date,
        base_symbol,
        to_contract,
        LEAD(rollover_date) OVER (PARTITION BY base_symbol ORDER BY rollover_date) AS next_rollover
    FROM rollover_events
)
SELECT
    base_symbol,
    to_contract AS active_contract,
    rollover_date AS start_date,
    COALESCE(next_rollover - INTERVAL '1 day', '2099-12-31'::date) AS end_date
FROM rollovers;

-- ============================================================
-- 4. Continuous contract view (Panama back-adjusted)
-- ============================================================
-- This is the main view that produces stitched continuous data.
-- It joins ohlcv_1s bars with the active contract schedule and
-- applies cumulative Panama adjustments.

CREATE OR REPLACE VIEW continuous_contract AS
WITH schedule AS (
    SELECT
        base_symbol,
        active_contract,
        start_date,
        end_date
    FROM active_contract_schedule
),
adjustments AS (
    SELECT
        base_symbol,
        from_contract,
        to_contract,
        rollover_date,
        COALESCE(cumulative_adjustment, 0) AS adj
    FROM cumulative_adjustments
)
SELECT
    o.ts,
    s.base_symbol AS symbol,
    o.symbol AS raw_contract,
    o.open  + COALESCE(a.adj, 0) AS open,
    o.high  + COALESCE(a.adj, 0) AS high,
    o.low   + COALESCE(a.adj, 0) AS low,
    o.close + COALESCE(a.adj, 0) AS close,
    o.volume
FROM ohlcv_1s o
JOIN schedule s
    ON o.base_symbol = s.base_symbol
    AND o.symbol = s.active_contract
    AND o.ts::date >= s.start_date
    AND o.ts::date <= s.end_date
LEFT JOIN adjustments a
    ON a.base_symbol = s.base_symbol
    AND a.to_contract = s.active_contract
    AND a.rollover_date = s.start_date;

-- ============================================================
-- 5. Materialized table for fast continuous contract queries
-- ============================================================
-- After ingestion, run:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY continuous_ohlcv_1s;
-- to populate this pre-computed table.

CREATE MATERIALIZED VIEW IF NOT EXISTS continuous_ohlcv_1s AS
SELECT * FROM continuous_contract
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS continuous_ohlcv_1s_unique_idx
    ON continuous_ohlcv_1s (symbol, ts);
CREATE INDEX IF NOT EXISTS continuous_ohlcv_1s_ts_idx
    ON continuous_ohlcv_1s (ts DESC);

-- ============================================================
-- 6. Helper function: get rollover history for a symbol
-- ============================================================
CREATE OR REPLACE FUNCTION get_rollover_history(p_base_symbol TEXT)
RETURNS TABLE (
    rollover_date DATE,
    from_contract TEXT,
    to_contract TEXT,
    price_gap DOUBLE PRECISION,
    cumulative_adj DOUBLE PRECISION
) AS $$
    SELECT
        rollover_date,
        from_contract,
        to_contract,
        price_gap,
        COALESCE(cumulative_adjustment, 0) AS cumulative_adj
    FROM cumulative_adjustments
    WHERE base_symbol = p_base_symbol
    ORDER BY rollover_date DESC;
$$ LANGUAGE SQL STABLE;

-- ============================================================
-- 7. Helper function: get continuous contract data for charting
-- ============================================================
CREATE OR REPLACE FUNCTION get_continuous_ohlcv(
    p_symbol TEXT,
    p_start TIMESTAMPTZ DEFAULT NULL,
    p_end TIMESTAMPTZ DEFAULT NULL,
    p_limit INTEGER DEFAULT 10000
)
RETURNS TABLE (
    ts TIMESTAMPTZ,
    symbol TEXT,
    raw_contract TEXT,
    open DOUBLE PRECISION,
    high DOUBLE PRECISION,
    low DOUBLE PRECISION,
    close DOUBLE PRECISION,
    volume BIGINT
) AS $$
    SELECT ts, symbol, raw_contract, open, high, low, close, volume
    FROM continuous_ohlcv_1s
    WHERE symbol = p_symbol
      AND (p_start IS NULL OR ts >= p_start)
      AND (p_end IS NULL OR ts <= p_end)
    ORDER BY ts DESC
    LIMIT p_limit;
$$ LANGUAGE SQL STABLE;
