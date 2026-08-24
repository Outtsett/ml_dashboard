const { Client } = require('pg');

async function main() {
  const c = new Client('postgresql://postgres:postgres@localhost:5432/ml_dashboard');
  await c.connect();

  // Create broker_configs table
  await c.query(`CREATE TABLE IF NOT EXISTS broker_configs (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    broker TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    commission_type TEXT NOT NULL,
    commission_per_lot DOUBLE PRECISION DEFAULT 0,
    commission_per_side DOUBLE PRECISION DEFAULT 0,
    commission_per_round_turn DOUBLE PRECISION DEFAULT 0,
    spread_type TEXT NOT NULL DEFAULT 'variable',
    typical_spread_pips DOUBLE PRECISION DEFAULT 0,
    slippage_model TEXT NOT NULL DEFAULT 'fixed',
    slippage_ticks DOUBLE PRECISION DEFAULT 0,
    margin_type TEXT NOT NULL DEFAULT 'fixed',
    default_margin DOUBLE PRECISION,
    config TEXT,
    is_default INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);

  await c.query(`CREATE INDEX IF NOT EXISTS broker_configs_name_idx ON broker_configs(name)`);
  await c.query(`CREATE INDEX IF NOT EXISTS broker_configs_asset_type_idx ON broker_configs(asset_type)`);

  // Create backtest_runs table
  await c.query(`CREATE TABLE IF NOT EXISTS backtest_runs (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    model_id INTEGER REFERENCES ml_models(id) ON DELETE SET NULL,
    symbol TEXT NOT NULL,
    broker_config_id INTEGER REFERENCES broker_configs(id),
    timeframe TEXT NOT NULL DEFAULT '1m',
    train_start_timestamp BIGINT,
    train_end_timestamp BIGINT,
    test_start_timestamp BIGINT,
    test_end_timestamp BIGINT,
    split_ratio DOUBLE PRECISION DEFAULT 0.8,
    initial_capital DOUBLE PRECISION NOT NULL DEFAULT 10000,
    position_size DOUBLE PRECISION NOT NULL DEFAULT 1,
    max_positions INTEGER NOT NULL DEFAULT 1,
    stop_loss_ticks DOUBLE PRECISION,
    take_profit_ticks DOUBLE PRECISION,
    trailing_stop_ticks DOUBLE PRECISION,
    max_drawdown_pct DOUBLE PRECISION,
    status TEXT NOT NULL DEFAULT 'pending',
    total_trades INTEGER,
    win_rate DOUBLE PRECISION,
    profit_factor DOUBLE PRECISION,
    sharpe_ratio DOUBLE PRECISION,
    sortino_ratio DOUBLE PRECISION,
    max_drawdown DOUBLE PRECISION,
    total_return DOUBLE PRECISION,
    total_return_pct DOUBLE PRECISION,
    avg_win DOUBLE PRECISION,
    avg_loss DOUBLE PRECISION,
    largest_win DOUBLE PRECISION,
    largest_loss DOUBLE PRECISION,
    avg_holding_time_ms DOUBLE PRECISION,
    expectancy DOUBLE PRECISION,
    total_commissions DOUBLE PRECISION,
    total_slippage DOUBLE PRECISION,
    equity_curve TEXT,
    error_message TEXT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);

  await c.query(`CREATE INDEX IF NOT EXISTS backtest_runs_model_id_idx ON backtest_runs(model_id)`);
  await c.query(`CREATE INDEX IF NOT EXISTS backtest_runs_symbol_idx ON backtest_runs(symbol)`);
  await c.query(`CREATE INDEX IF NOT EXISTS backtest_runs_status_idx ON backtest_runs(status)`);

  // Create backtest_trades table
  await c.query(`CREATE TABLE IF NOT EXISTS backtest_trades (
    id SERIAL PRIMARY KEY,
    backtest_run_id INTEGER NOT NULL REFERENCES backtest_runs(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    entry_timestamp BIGINT NOT NULL,
    exit_timestamp BIGINT,
    entry_price DOUBLE PRECISION NOT NULL,
    exit_price DOUBLE PRECISION,
    quantity DOUBLE PRECISION NOT NULL DEFAULT 1,
    pnl DOUBLE PRECISION,
    net_pnl DOUBLE PRECISION,
    commission DOUBLE PRECISION DEFAULT 0,
    slippage DOUBLE PRECISION DEFAULT 0,
    spread_cost DOUBLE PRECISION DEFAULT 0,
    entry_signal DOUBLE PRECISION,
    exit_reason TEXT,
    bars_held INTEGER,
    max_favorable_excursion DOUBLE PRECISION,
    max_adverse_excursion DOUBLE PRECISION,
    running_pnl DOUBLE PRECISION
  )`);

  await c.query(`CREATE INDEX IF NOT EXISTS backtest_trades_run_id_idx ON backtest_trades(backtest_run_id)`);
  await c.query(`CREATE INDEX IF NOT EXISTS backtest_trades_entry_ts_idx ON backtest_trades(entry_timestamp)`);

  console.log('All 3 tables created successfully');
  await c.end();
}

main().catch(e => { console.error(e); process.exit(1); });
