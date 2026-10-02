export interface BrokerConfig {
  id: number;
  name: string;
  broker: string;
  asset_type: string;
  commission_type: string;
  commission_per_side: number;
  typical_spread_pips: number;
  default_margin: number;
}

// Strategy types (mirror shared/strategyTypes.ts for client use)
export type StrategyType = 'ml_prediction' | 'momentum' | 'indicator' | 'hybrid';
export type SignalSource = 'model' | 'momentum' | 'indicator' | 'hybrid';
export type IndicatorStrategyPreset = 'sma_crossover' | 'ema_crossover' | 'rsi_reversal' | 'macd_signal' | 'bollinger_breakout' | 'triple_ma';

export interface StrategyDefinition {
  id?: number;
  name: string;
  type: StrategyType;
  description?: string;
  modelId?: number;
  useLastTrained?: boolean;
  indicatorPreset?: IndicatorStrategyPreset;
  indicatorParams?: Record<string, number>;
  sessionFilter?: { sessions: string[]; requireOverlap?: boolean; };
  minConfidence?: number;
  confirmationBars?: number;
  positionSizingMode?: 'fixed' | 'risk_pct' | 'kelly';
  riskPerTradePct?: number;
}

// Walk-forward types
export interface WalkForwardConfig {
  trainMonths: number;
  testMonths: number;
  stepMonths?: number;
}

export interface WalkForwardWindowResult {
  window: { index: number; trainStart: string; trainEnd: string; testStart: string; testEnd: string; };
  metrics: BacktestMetrics;
  tradeCount: number;
  equityCurve: { timestamp: number; equity: number }[];
}

export interface WalkForwardResult {
  groupId: string;
  windowResults: WalkForwardWindowResult[];
  aggregateMetrics: BacktestMetrics;
  oosMetrics: BacktestMetrics;
  consistency: number;
  degradation: number;
}

// Monte Carlo types
export interface MonteCarloConfig {
  numSimulations: number;
  confidenceLevels: number[];
}

export interface MonteCarloResult {
  numSimulations: number;
  terminalEquity: { mean: number; median: number; stdDev: number; percentiles: Record<string, number>; distribution: number[]; };
  maxDrawdown: { mean: number; median: number; percentiles: Record<string, number>; distribution: number[]; };
  sharpeRatio: { mean: number; median: number; percentiles: Record<string, number>; };
  winRate: { mean: number; percentiles: Record<string, number>; };
  profitProbability: number;
  ruinProbability: number;
}

// Benchmark types
export interface BenchmarkResult {
  buyAndHold: { totalReturn: number; totalReturnPct: number; maxDrawdown: number; maxDrawdownPct: number; sharpeRatio: number; equityCurve: { timestamp: number; equity: number }[]; };
  comparison: { alpha: number; beta: number; informationRatio: number; trackingError: number; upCaptureRatio: number; downCaptureRatio: number; };
  rollingMetrics: { timestamp: number; strategySharpe: number; benchmarkSharpe: number; rollingAlpha: number; }[];
}

export const INDICATOR_DEFAULTS: Record<IndicatorStrategyPreset, Record<string, number>> = {
  sma_crossover: { fastPeriod: 10, slowPeriod: 20 },
  ema_crossover: { fastPeriod: 12, slowPeriod: 26 },
  rsi_reversal: { period: 14, oversold: 30, overbought: 70 },
  macd_signal: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
  bollinger_breakout: { period: 20, stdDev: 2 },
  triple_ma: { fastPeriod: 5, mediumPeriod: 20, slowPeriod: 50 },
};

export interface BacktestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  totalReturn: number;
  totalReturnPct: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  avgHoldingTimeBars: number;
  avgHoldingTimeMs: number;
  expectancy: number;
  totalCommissions: number;
  totalSlippage: number;
  totalSpreadCost: number;
  calmarRatio: number;
}

/**
 * Raw backtest_runs row as read by the client (GET /api/backtest/runs,
 * POST /api/backtest/run). The client reads snake_case metric fields here;
 * the server's Drizzle rows are actually camelCase (a pre-existing mismatch,
 * out of scope to fix here) — this type reflects how the value is used.
 */
export interface BacktestRunRow {
  id: number;
  name: string;
  symbol: string;
  status: string;
  total_trades?: number;
  win_rate?: number;
  profit_factor?: number;
  sharpe_ratio?: number;
  sortino_ratio?: number;
  max_drawdown?: number;
  total_return?: number;
  total_return_pct?: number;
  avg_win?: number;
  avg_loss?: number;
  largest_win?: number;
  largest_loss?: number;
  avg_holding_time_ms?: number;
  expectancy?: number;
  total_commissions?: number;
  total_slippage?: number;
  equity_curve?: string | { timestamp: number; equity: number }[];
  broker_label?: string;
  broker_name?: string;
}

export interface ChartMarker {
  timestamp: number;
  type: 'entry' | 'exit';
  side: string;
  price: number;
  label: string;
  pnl?: number;
}

export interface BacktestRunResult {
  run: BacktestRunRow;
  metrics: BacktestMetrics;
  tradeCount: number;
  equityCurvePoints: number;
  dataSummary: {
    totalBars: number;
    trainBars: number;
    testBars: number;
    signalCount: number;
  };
}
