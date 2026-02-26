/**
 * Trade simulator — entry/exit mechanics, stops, P&L, cost model.
 */

import type { BrokerConfig } from '@shared/schema';
import { computeMetrics } from './metricsCalculator';

// ============================================================
// TYPES
// ============================================================

/** OHLCV bar as returned from DuckDB queries (field named `ts` to match SQL alias). */
export interface OHLCVBar {
  ts: number;       // epoch ms (matches DuckDB column alias)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Signal {
  timestamp: number;     // epoch ms — must align with an OHLCV bar
  prediction: number;    // 0=down(short), 1=neutral, 2=up(long)
  confidence: number;    // 0-1
  probabilities?: number[];
}

export interface InstrumentSpec {
  symbol: string;
  assetType: 'futures' | 'forex';
  tickSize: number;
  tickValue: number;
  pointValue: number;
  contractSize: number;
  pipSize?: number;       // forex only
  marginRequirement?: number;
}

export interface BacktestConfig {
  initialCapital: number;
  positionSize: number;       // contracts/lots
  maxPositions: number;
  stopLossTicks?: number;
  takeProfitTicks?: number;
  trailingStopTicks?: number;
  maxDrawdownPct?: number;    // circuit breaker: stop trading if drawdown exceeds
  minConfidence?: number;     // minimum signal confidence to enter (default 0.5)
  cooldownBars?: number;      // min bars between trades (default 1)
}

export interface TradeRecord {
  symbol: string;
  side: 'long' | 'short';
  entryTimestamp: number;
  exitTimestamp: number | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  pnl: number | null;
  netPnl: number | null;
  commission: number;
  slippage: number;
  spreadCost: number;
  entrySignal: number;
  exitReason: string | null;
  barsHeld: number | null;
  maxFavorableExcursion: number | null;
  maxAdverseExcursion: number | null;
  runningPnl: number;
}

export interface BacktestResult {
  trades: TradeRecord[];
  metrics: BacktestMetrics;
  equityCurve: { timestamp: number; equity: number }[];
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

// ============================================================
// COST MODEL
// ============================================================

function computeTradeCosts(
  instrument: InstrumentSpec,
  broker: BrokerConfig,
  entryPrice: number,
  quantity: number
): { commission: number; slippage: number; spreadCost: number } {
  let commission = 0;
  let slippage = 0;
  let spreadCost = 0;

  const brokerOverrides = broker.config ? JSON.parse(broker.config) : {};
  const symbolCommissions = brokerOverrides.symbolCommissions || {};
  const symbolSpreads = brokerOverrides.symbolSpreads || {};

  // Commission
  switch (broker.commissionType) {
    case 'per_side':
      // Per side × 2 (entry + exit) × quantity
      const perSide = symbolCommissions[instrument.symbol] ?? broker.commissionPerSide ?? 0;
      commission = perSide * 2 * quantity;
      break;
    case 'per_round_turn':
      const perRT = broker.commissionPerRoundTurn ?? 0;
      commission = perRT * quantity;
      break;
    case 'per_lot':
      commission = (broker.commissionPerLot ?? 0) * quantity;
      break;
    case 'spread_only':
      // No explicit commission — cost is in the spread
      break;
  }

  // Spread cost (forex)
  if (instrument.assetType === 'forex') {
    const spreadPips = symbolSpreads[instrument.symbol] ?? broker.typicalSpreadPips ?? 0;
    const pipValue = instrument.pipSize ?? 0.0001;
    // Spread cost = spread_in_price × contractSize × quantity
    spreadCost = spreadPips * pipValue * instrument.contractSize * quantity;
  }

  // Slippage
  const slippageTicks = broker.slippageTicks ?? 0;
  if (instrument.assetType === 'futures') {
    slippage = slippageTicks * instrument.tickValue * quantity * 2; // entry + exit
  } else {
    // Forex: slippage in pips
    const pipValue = instrument.pipSize ?? 0.0001;
    slippage = slippageTicks * pipValue * instrument.contractSize * quantity * 2;
  }

  return { commission, slippage, spreadCost };
}

// ============================================================
// P&L CALCULATION
// ============================================================

function computePnL(
  instrument: InstrumentSpec,
  side: 'long' | 'short',
  entryPrice: number,
  exitPrice: number,
  quantity: number
): number {
  const priceDiff = side === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice;

  if (instrument.assetType === 'futures') {
    // Futures: P&L = price_diff × pointValue × quantity
    return priceDiff * instrument.pointValue * quantity;
  } else {
    // Forex: P&L = price_diff × contractSize × quantity
    return priceDiff * instrument.contractSize * quantity;
  }
}

// ============================================================
// BACKTEST ENGINE
// ============================================================

export function runBacktest(
  bars: OHLCVBar[],
  signals: Signal[],
  instrument: InstrumentSpec,
  broker: BrokerConfig,
  config: BacktestConfig
): BacktestResult {
  // Sort bars chronologically
  const sortedBars = [...bars].sort((a, b) => a.ts - b.ts);

  // Build signal lookup by timestamp
  const signalMap = new Map<number, Signal>();
  for (const sig of signals) {
    signalMap.set(sig.timestamp, sig);
  }

  const trades: TradeRecord[] = [];
  const equityCurve: { timestamp: number; equity: number }[] = [];
  let equity = config.initialCapital;
  let peakEquity = equity;
  let maxDrawdownAbs = 0;
  let openPosition: {
    side: 'long' | 'short';
    entryPrice: number;
    entryTimestamp: number;
    entrySignal: number;
    entryBarIndex: number;
    costs: { commission: number; slippage: number; spreadCost: number };
    mfe: number;   // max favorable excursion in ticks
    mae: number;   // max adverse excursion in ticks
    trailingStop?: number;
  } | null = null;

  let cooldownUntilBar = 0;
  const minConfidence = config.minConfidence ?? 0.5;
  const cooldownBars = config.cooldownBars ?? 1;
  let circuitBroken = false;

  for (let i = 0; i < sortedBars.length; i++) {
    const bar = sortedBars[i]!;
    const signal = signalMap.get(bar.ts);

    // Record equity curve point
    let unrealizedPnl = 0;
    if (openPosition) {
      unrealizedPnl = computePnL(
        instrument,
        openPosition.side,
        openPosition.entryPrice,
        bar.close,
        config.positionSize
      );
    }
    const currentEquity = equity + unrealizedPnl;
    equityCurve.push({ timestamp: bar.ts, equity: currentEquity });

    // Track drawdown
    if (currentEquity > peakEquity) peakEquity = currentEquity;
    const dd = peakEquity - currentEquity;
    if (dd > maxDrawdownAbs) maxDrawdownAbs = dd;

    // Circuit breaker
    if (config.maxDrawdownPct && !circuitBroken) {
      const ddPct = (dd / config.initialCapital) * 100;
      if (ddPct >= config.maxDrawdownPct) {
        circuitBroken = true;
        // Force close any open position
        if (openPosition) {
          closeTrade(i, bar.close, 'circuit_breaker');
        }
        continue;
      }
    }

    if (circuitBroken) continue;

    // If we have an open position, check exits first
    if (openPosition) {
      // Update MFE/MAE
      const tickSize = instrument.tickSize || 0.01;
      if (openPosition.side === 'long') {
        const favExcursion = (bar.high - openPosition.entryPrice) / tickSize;
        const advExcursion = (openPosition.entryPrice - bar.low) / tickSize;
        if (favExcursion > openPosition.mfe) openPosition.mfe = favExcursion;
        if (advExcursion > openPosition.mae) openPosition.mae = advExcursion;
      } else {
        const favExcursion = (openPosition.entryPrice - bar.low) / tickSize;
        const advExcursion = (bar.high - openPosition.entryPrice) / tickSize;
        if (favExcursion > openPosition.mfe) openPosition.mfe = favExcursion;
        if (advExcursion > openPosition.mae) openPosition.mae = advExcursion;
      }

      // Check stop loss
      if (config.stopLossTicks) {
        const slPrice = openPosition.side === 'long'
          ? openPosition.entryPrice - config.stopLossTicks * (instrument.tickSize || 0.01)
          : openPosition.entryPrice + config.stopLossTicks * (instrument.tickSize || 0.01);

        if ((openPosition.side === 'long' && bar.low <= slPrice) ||
            (openPosition.side === 'short' && bar.high >= slPrice)) {
          closeTrade(i, slPrice, 'stop_loss');
          continue;
        }
      }

      // Check take profit
      if (config.takeProfitTicks) {
        const tpPrice = openPosition.side === 'long'
          ? openPosition.entryPrice + config.takeProfitTicks * (instrument.tickSize || 0.01)
          : openPosition.entryPrice - config.takeProfitTicks * (instrument.tickSize || 0.01);

        if ((openPosition.side === 'long' && bar.high >= tpPrice) ||
            (openPosition.side === 'short' && bar.low <= tpPrice)) {
          closeTrade(i, tpPrice, 'take_profit');
          continue;
        }
      }

      // Trailing stop
      if (config.trailingStopTicks) {
        const tickSize = instrument.tickSize || 0.01;
        if (!openPosition.trailingStop) {
          openPosition.trailingStop = openPosition.side === 'long'
            ? openPosition.entryPrice - config.trailingStopTicks * tickSize
            : openPosition.entryPrice + config.trailingStopTicks * tickSize;
        }

        if (openPosition.side === 'long') {
          const newStop = bar.high - config.trailingStopTicks * tickSize;
          if (newStop > openPosition.trailingStop) openPosition.trailingStop = newStop;
          if (bar.low <= openPosition.trailingStop) {
            closeTrade(i, openPosition.trailingStop, 'trailing_stop');
            continue;
          }
        } else {
          const newStop = bar.low + config.trailingStopTicks * tickSize;
          if (newStop < openPosition.trailingStop) openPosition.trailingStop = newStop;
          if (bar.high >= openPosition.trailingStop) {
            closeTrade(i, openPosition.trailingStop, 'trailing_stop');
            continue;
          }
        }
      }

      // Signal-based exit: reverse signal or neutral with high confidence
      if (signal && signal.confidence >= minConfidence) {
        if (openPosition.side === 'long' && signal.prediction === 0) {
          closeTrade(i, bar.close, 'signal');
          continue;
        }
        if (openPosition.side === 'short' && signal.prediction === 2) {
          closeTrade(i, bar.close, 'signal');
          continue;
        }
      }
    }

    // Entry logic — only if no open position and not in cooldown
    if (!openPosition && i >= cooldownUntilBar && signal) {
      if (signal.confidence >= minConfidence && signal.prediction !== 1) {
        const side: 'long' | 'short' = signal.prediction === 2 ? 'long' : 'short';
        const costs = computeTradeCosts(instrument, broker, bar.close, config.positionSize);

        openPosition = {
          side,
          entryPrice: bar.close,
          entryTimestamp: bar.ts,
          entrySignal: signal.confidence,
          entryBarIndex: i,
          costs,
          mfe: 0,
          mae: 0,
        };
      }
    }
  }

  // Close any remaining open position at end of data
  if (openPosition && sortedBars.length > 0) {
    const lastBar = sortedBars[sortedBars.length - 1]!;
    closeTrade(sortedBars.length - 1, lastBar.close, 'end_of_data');
  }

  // Compute metrics
  const metrics = computeMetrics(trades, config.initialCapital, equityCurve);

  return { trades, metrics, equityCurve };

  // ---- Helper closures ----

  function closeTrade(barIndex: number, exitPrice: number, reason: string) {
    if (!openPosition) return;
    const bar = sortedBars[barIndex]!;
    const grossPnl = computePnL(
      instrument,
      openPosition.side,
      openPosition.entryPrice,
      exitPrice,
      config.positionSize
    );
    const totalCost = openPosition.costs.commission + openPosition.costs.slippage + openPosition.costs.spreadCost;
    const netPnl = grossPnl - totalCost;
    equity += netPnl;

    const barsHeld = barIndex - openPosition.entryBarIndex;

    trades.push({
      symbol: instrument.symbol,
      side: openPosition.side,
      entryTimestamp: openPosition.entryTimestamp,
      exitTimestamp: bar.ts,
      entryPrice: openPosition.entryPrice,
      exitPrice,
      quantity: config.positionSize,
      pnl: grossPnl,
      netPnl,
      commission: openPosition.costs.commission,
      slippage: openPosition.costs.slippage,
      spreadCost: openPosition.costs.spreadCost,
      entrySignal: openPosition.entrySignal,
      exitReason: reason,
      barsHeld,
      maxFavorableExcursion: openPosition.mfe,
      maxAdverseExcursion: openPosition.mae,
      runningPnl: equity - config.initialCapital,
    });

    cooldownUntilBar = barIndex + cooldownBars;
    openPosition = null;
  }
}
