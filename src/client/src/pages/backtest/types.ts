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

export interface BacktestRunResult {
  run: any;
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
