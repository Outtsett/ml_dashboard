/**
 * Strategy Layer — the "risk manager" on top of signals.
 *
 * Think of it as: The signal generator says "BUY here." The strategy layer says
 * "OK, but HOW MUCH? Given our account size, recent drawdown, and volatility,
 * we'll risk 1% of capital, which at current ATR means 2 contracts."
 *
 * Components:
 * 1. Position Sizing — how many contracts/lots based on risk budget
 * 2. Risk Rules — max positions, max drawdown, daily loss limits
 * 3. Composable Filters — stack conditions that must ALL pass before a trade
 *
 * Position Sizing Methods:
 * - Fixed: always trade N contracts
 * - Risk Percent: risk X% of capital per trade (using ATR/stop distance)
 * - Kelly: optimal size based on historical win rate & avg win/loss
 * - Volatility Scaled: reduce size when market is volatile
 */

import type { TradeSignal } from './signalGenerator';

// ============================================================
// TYPES
// ============================================================

export type SizingMethod = 'fixed' | 'risk_percent' | 'kelly' | 'volatility_scaled';

export interface StrategyConfig {
  /** Position sizing method */
  sizingMethod: SizingMethod;
  /** Fixed contracts/lots (for 'fixed' method) */
  fixedSize: number;
  /** Risk per trade as % of capital (for 'risk_percent' method) */
  riskPercentPerTrade: number;
  /** Max total risk exposure (% of capital) */
  maxTotalRiskPercent: number;
  /** Max open positions */
  maxPositions: number;
  /** Max daily loss (% of capital) — stops trading for the "day" */
  maxDailyLossPercent: number;
  /** Max drawdown from peak (% of capital) — kills all trading */
  maxDrawdownPercent: number;
  /** Min signal strength to trade (0-1) */
  minSignalStrength: number;
  /** Trading session hours (UTC). null = trade anytime */
  tradingHours?: { start: number; end: number } | null;
  /** Custom filters: additional conditions that must pass */
  customFilters: StrategyFilter[];
  /** Kelly historical window (bars) for computing win rate */
  kellyWindow: number;
  /** Kelly fraction — multiply Kelly % by this (default 0.5 = half Kelly, safer) */
  kellyFraction: number;
  /** Volatility scaling — target volatility as ATR multiple */
  targetVolatility: number;
  /** Min position size (contracts/lots) */
  minPositionSize: number;
  /** Max position size (contracts/lots) */
  maxPositionSize: number;
}

export interface StrategyFilter {
  name: string;
  description: string;
  /** Filter function key — maps to a built-in check */
  type: 'min_confidence' | 'regime' | 'time_of_day' | 'volatility_band' | 'trend_alignment' | 'custom';
  params: Record<string, any>;
  enabled: boolean;
}

export interface PositionSizeResult {
  size: number;          // contracts/lots to trade
  riskAmount: number;    // $ risk for this trade
  riskPercent: number;   // % of capital risked
  method: SizingMethod;
  reason: string;
  reduced: boolean;      // was size reduced by a rule?
  reductionReason?: string;
}

export interface StrategyDecision {
  signal: TradeSignal;
  approved: boolean;
  positionSize: PositionSizeResult;
  rejectionReasons: string[];
  riskMetrics: {
    currentDrawdown: number;
    dailyPnL: number;
    openPositions: number;
    totalExposure: number;
  };
}

export interface StrategyState {
  capital: number;
  peakCapital: number;
  dailyStartCapital: number;
  currentDay: string;   // YYYY-MM-DD
  openPositionCount: number;
  totalExposure: number;
  tradeHistory: Array<{
    pnl: number;
    timestamp: number;
    size: number;
    direction: string;
  }>;
  isKilled: boolean;    // max drawdown hit — no more trading
  dailyLocked: boolean; // daily loss hit — paused until next day
}

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  sizingMethod: 'risk_percent',
  fixedSize: 1,
  riskPercentPerTrade: 1.0,
  maxTotalRiskPercent: 5.0,
  maxPositions: 3,
  maxDailyLossPercent: 3.0,
  maxDrawdownPercent: 10.0,
  minSignalStrength: 0.3,
  tradingHours: null,
  customFilters: [],
  kellyWindow: 100,
  kellyFraction: 0.5,
  targetVolatility: 1.0,
  minPositionSize: 1,
  maxPositionSize: 10,
};

// ============================================================
// STRATEGY ENGINE
// ============================================================

export class StrategyEngine {
  private config: StrategyConfig;
  private state: StrategyState;

  constructor(
    config: Partial<StrategyConfig> = {},
    initialCapital: number = 100000,
  ) {
    this.config = { ...DEFAULT_STRATEGY_CONFIG, ...config };
    this.state = {
      capital: initialCapital,
      peakCapital: initialCapital,
      dailyStartCapital: initialCapital,
      currentDay: new Date().toISOString().split('T')[0]!,
      openPositionCount: 0,
      totalExposure: 0,
      tradeHistory: [],
      isKilled: false,
      dailyLocked: false,
    };
  }

  /** Update config on the fly */
  updateConfig(updates: Partial<StrategyConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /** Get current state (read-only snapshot) */
  getState(): Readonly<StrategyState> {
    return { ...this.state };
  }

  /** Reset state (e.g., for backtesting) */
  reset(initialCapital?: number): void {
    const capital = initialCapital || this.state.capital;
    this.state = {
      capital,
      peakCapital: capital,
      dailyStartCapital: capital,
      currentDay: new Date().toISOString().split('T')[0]!,
      openPositionCount: 0,
      totalExposure: 0,
      tradeHistory: [],
      isKilled: false,
      dailyLocked: false,
    };
  }

  /**
   * Main decision function — takes a signal, returns whether to trade and how much.
   *
   * @param signal The trade signal from the signal generator
   * @param currentATR Current ATR value (for position sizing)
   * @param tickValue Value per tick (for $ risk calculation)
   * @param stopDistanceTicks Distance to stop loss in ticks
   */
  decide(
    signal: TradeSignal,
    currentATR: number = 1,
    tickValue: number = 1,
    stopDistanceTicks: number = 20,
  ): StrategyDecision {
    const rejections: string[] = [];

    // Check day rollover
    const signalDay = new Date(signal.timestamp).toISOString().split('T')[0]!;
    if (signalDay !== this.state.currentDay) {
      this.state.currentDay = signalDay;
      this.state.dailyStartCapital = this.state.capital;
      this.state.dailyLocked = false;
    }

    // === Kill switch check ===
    if (this.state.isKilled) {
      rejections.push(`KILLED: Max drawdown ${this.config.maxDrawdownPercent}% exceeded`);
    }

    // === Daily lock check ===
    if (this.state.dailyLocked) {
      rejections.push(`DAILY LOCK: Daily loss limit ${this.config.maxDailyLossPercent}% hit`);
    }

    // === Drawdown check ===
    if (this.state.peakCapital > 0) {
      const currentDD = ((this.state.peakCapital - this.state.capital) / this.state.peakCapital) * 100;
      if (currentDD >= this.config.maxDrawdownPercent) {
        this.state.isKilled = true;
        rejections.push(`Max drawdown reached: ${currentDD.toFixed(1)}%`);
      }
    }

    // === Daily loss check ===
    const dailyPnL = this.state.capital - this.state.dailyStartCapital;
    const dailyLossPct = (Math.abs(Math.min(0, dailyPnL)) / this.state.dailyStartCapital) * 100;
    if (dailyLossPct >= this.config.maxDailyLossPercent) {
      this.state.dailyLocked = true;
      rejections.push(`Daily loss limit hit: ${dailyLossPct.toFixed(1)}%`);
    }

    // === Max positions check ===
    if (this.state.openPositionCount >= this.config.maxPositions) {
      rejections.push(`Max positions reached: ${this.state.openPositionCount}/${this.config.maxPositions}`);
    }

    // === Signal strength check ===
    if (signal.strength < this.config.minSignalStrength) {
      rejections.push(`Signal strength too low: ${(signal.strength * 100).toFixed(1)}% < ${(this.config.minSignalStrength * 100).toFixed(1)}%`);
    }

    // === Trading hours check ===
    if (this.config.tradingHours) {
      const hour = new Date(signal.timestamp).getUTCHours();
      const { start, end } = this.config.tradingHours;
      if (start <= end) {
        if (hour < start || hour >= end) {
          rejections.push(`Outside trading hours: ${hour}:00 UTC (allowed ${start}:00-${end}:00)`);
        }
      } else {
        // Wraps midnight
        if (hour < start && hour >= end) {
          rejections.push(`Outside trading hours: ${hour}:00 UTC`);
        }
      }
    }

    // === Custom filters ===
    for (const filter of this.config.customFilters) {
      if (!filter.enabled) continue;
      const pass = this.evaluateFilter(filter, signal);
      if (!pass) {
        rejections.push(`Filter "${filter.name}" failed`);
      }
    }

    // === No-signal passthrough ===
    if (signal.direction === 'no_signal' || signal.direction === 'flat') {
      // Flat signals pass through (they close positions, don't open new ones)
      const posSize = this.computePositionSize(0, 0, 0);
      return {
        signal,
        approved: signal.direction === 'flat',
        positionSize: { ...posSize, size: 0, reason: 'Flat/no signal (close only)' },
        rejectionReasons: signal.direction === 'no_signal' ? ['No actionable signal'] : [],
        riskMetrics: this.getCurrentRiskMetrics(dailyPnL),
      };
    }

    // === Position sizing ===
    const positionSize = this.computePositionSize(currentATR, tickValue, stopDistanceTicks);

    return {
      signal,
      approved: rejections.length === 0,
      positionSize,
      rejectionReasons: rejections,
      riskMetrics: this.getCurrentRiskMetrics(dailyPnL),
    };
  }

  /**
   * Record a completed trade (updates internal state for future decisions)
   */
  recordTrade(pnl: number, size: number, direction: string, timestamp: number): void {
    this.state.capital += pnl;
    if (this.state.capital > this.state.peakCapital) {
      this.state.peakCapital = this.state.capital;
    }

    this.state.tradeHistory.push({ pnl, timestamp, size, direction });
    if (this.state.tradeHistory.length > 1000) {
      this.state.tradeHistory = this.state.tradeHistory.slice(-500);
    }
  }

  /** Increment/decrement open position count */
  openPosition(): void { this.state.openPositionCount++; }
  closePosition(): void { this.state.openPositionCount = Math.max(0, this.state.openPositionCount - 1); }

  // ============================================================
  // POSITION SIZING
  // ============================================================

  private computePositionSize(
    currentATR: number,
    tickValue: number,
    stopDistanceTicks: number,
  ): PositionSizeResult {
    let size = this.config.fixedSize;
    let riskAmount = 0;
    let riskPercent = 0;
    let method = this.config.sizingMethod;
    let reason = '';
    let reduced = false;
    let reductionReason: string | undefined;

    switch (this.config.sizingMethod) {
      case 'fixed':
        size = this.config.fixedSize;
        riskAmount = stopDistanceTicks * tickValue * size;
        riskPercent = this.state.capital > 0 ? (riskAmount / this.state.capital) * 100 : 0;
        reason = `Fixed ${size} contracts`;
        break;

      case 'risk_percent': {
        // How much $ to risk
        const riskBudget = this.state.capital * (this.config.riskPercentPerTrade / 100);
        // Risk per contract = stop distance × tick value
        const riskPerContract = stopDistanceTicks * tickValue;
        if (riskPerContract > 0) {
          size = Math.floor(riskBudget / riskPerContract);
        } else {
          size = this.config.fixedSize;
        }
        riskAmount = size * riskPerContract;
        riskPercent = this.config.riskPercentPerTrade;
        reason = `Risk ${this.config.riskPercentPerTrade}% = $${riskBudget.toFixed(0)} / $${riskPerContract.toFixed(0)} per contract = ${size}`;
        break;
      }

      case 'kelly': {
        // Kelly Criterion: f* = (W * p - (1-p)) / W 
        // where W = avg_win / avg_loss, p = win_rate
        const recentTrades = this.state.tradeHistory.slice(-this.config.kellyWindow);
        if (recentTrades.length < 20) {
          // Not enough history — fall back to fixed
          size = this.config.fixedSize;
          reason = `Kelly: insufficient history (${recentTrades.length} trades, need 20), using fixed`;
        } else {
          const wins = recentTrades.filter(t => t.pnl > 0);
          const losses = recentTrades.filter(t => t.pnl <= 0);
          const winRate = wins.length / recentTrades.length;
          const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
          const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 1;
          const W = avgLoss > 0 ? avgWin / avgLoss : 1;

          let kellyPct = (W * winRate - (1 - winRate)) / W;
          kellyPct = Math.max(0, kellyPct) * this.config.kellyFraction;

          const riskBudget = this.state.capital * kellyPct;
          const riskPerContract = stopDistanceTicks * tickValue;
          if (riskPerContract > 0 && kellyPct > 0) {
            size = Math.floor(riskBudget / riskPerContract);
          } else {
            size = this.config.minPositionSize;
          }
          riskAmount = riskBudget;
          riskPercent = kellyPct * 100;
          reason = `Kelly ${this.config.kellyFraction}: WR=${(winRate * 100).toFixed(0)}%, W=${W.toFixed(2)}, f*=${(kellyPct * 100).toFixed(1)}%`;
        }
        break;
      }

      case 'volatility_scaled': {
        // Scale down when vol is high, up when vol is low
        // target_size = base_size × (target_vol / current_vol)
        const baseSize = this.config.fixedSize;
        const volRatio = currentATR > 0 ? this.config.targetVolatility / currentATR : 1;
        size = Math.round(baseSize * Math.min(2, Math.max(0.25, volRatio)));
        riskAmount = stopDistanceTicks * tickValue * size;
        riskPercent = this.state.capital > 0 ? (riskAmount / this.state.capital) * 100 : 0;
        reason = `Vol-scaled: base=${baseSize} × ratio=${volRatio.toFixed(2)} = ${size}`;
        break;
      }
    }

    // Apply bounds
    if (size < this.config.minPositionSize) {
      size = this.config.minPositionSize;
      reduced = true;
      reductionReason = `Below minimum (${this.config.minPositionSize})`;
    }
    if (size > this.config.maxPositionSize) {
      size = this.config.maxPositionSize;
      reduced = true;
      reductionReason = `Above maximum (${this.config.maxPositionSize})`;
    }

    // Check total risk exposure
    const totalRisk = riskPercent + (this.state.totalExposure / this.state.capital) * 100;
    if (totalRisk > this.config.maxTotalRiskPercent) {
      const maxAllowed = this.config.maxTotalRiskPercent - (this.state.totalExposure / this.state.capital) * 100;
      if (maxAllowed <= 0) {
        size = 0;
        reduced = true;
        reductionReason = `Total risk exposure limit reached (${this.config.maxTotalRiskPercent}%)`;
      } else {
        const riskPerContract = stopDistanceTicks * tickValue;
        const maxSize = riskPerContract > 0 ? Math.floor((this.state.capital * maxAllowed / 100) / riskPerContract) : 0;
        if (maxSize < size) {
          size = Math.max(0, maxSize);
          reduced = true;
          reductionReason = `Reduced to stay under ${this.config.maxTotalRiskPercent}% total risk`;
        }
      }
    }

    // Ensure size is at least 0
    size = Math.max(0, size);

    return {
      size,
      riskAmount: stopDistanceTicks * tickValue * size,
      riskPercent: this.state.capital > 0 ? (stopDistanceTicks * tickValue * size / this.state.capital) * 100 : 0,
      method,
      reason,
      reduced,
      reductionReason,
    };
  }

  // ============================================================
  // FILTER EVALUATION
  // ============================================================

  private evaluateFilter(filter: StrategyFilter, signal: TradeSignal): boolean {
    switch (filter.type) {
      case 'min_confidence':
        return signal.confidence >= (filter.params.minConfidence || 0.6);

      case 'regime': {
        const allowedRegimes = filter.params.allowedRegimes || ['trending_up', 'trending_down'];
        const currentRegime = signal.metadata?.regime || 'unknown';
        return allowedRegimes.includes(currentRegime);
      }

      case 'time_of_day': {
        const hour = new Date(signal.timestamp).getUTCHours();
        const startHour = filter.params.startHour || 9;
        const endHour = filter.params.endHour || 16;
        return hour >= startHour && hour < endHour;
      }

      case 'volatility_band': {
        const volRatio = signal.metadata?.volatilityRatio || 1;
        const minVol = filter.params.minVol || 0.5;
        const maxVol = filter.params.maxVol || 2.0;
        return volRatio >= minVol && volRatio <= maxVol;
      }

      case 'trend_alignment': {
        // Only trade in the direction of the trend
        const regime = signal.metadata?.regime || 'unknown';
        if (signal.direction === 'long' && regime === 'trending_down') return false;
        if (signal.direction === 'short' && regime === 'trending_up') return false;
        return true;
      }

      case 'custom':
        // Custom filters would be evaluated externally
        return true;

      default:
        return true;
    }
  }

  // ============================================================
  // RISK METRICS
  // ============================================================

  private getCurrentRiskMetrics(dailyPnL: number) {
    return {
      currentDrawdown: this.state.peakCapital > 0
        ? ((this.state.peakCapital - this.state.capital) / this.state.peakCapital) * 100
        : 0,
      dailyPnL,
      openPositions: this.state.openPositionCount,
      totalExposure: this.state.totalExposure,
    };
  }

  /**
   * Get a summary of strategy performance from trade history.
   */
  getPerformanceSummary(): {
    totalTrades: number;
    winRate: number;
    avgPnL: number;
    totalPnL: number;
    sharpeEstimate: number;
    currentCapital: number;
    maxDrawdownPct: number;
    isKilled: boolean;
    dailyLocked: boolean;
  } {
    const trades = this.state.tradeHistory;
    const totalTrades = trades.length;
    const wins = trades.filter(t => t.pnl > 0).length;
    const winRate = totalTrades > 0 ? wins / totalTrades : 0;
    const totalPnL = trades.reduce((s, t) => s + t.pnl, 0);
    const avgPnL = totalTrades > 0 ? totalPnL / totalTrades : 0;

    // Simple Sharpe estimate from trade returns
    const returns = trades.map(t => t.pnl / this.state.peakCapital);
    const meanRet = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
    const stdRet = returns.length > 1
      ? Math.sqrt(returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (returns.length - 1))
      : 0;
    const sharpeEstimate = stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(252) : 0;

    const maxDD = this.state.peakCapital > 0
      ? ((this.state.peakCapital - Math.min(this.state.capital, this.state.peakCapital)) / this.state.peakCapital) * 100
      : 0;

    return {
      totalTrades,
      winRate,
      avgPnL,
      totalPnL,
      sharpeEstimate,
      currentCapital: this.state.capital,
      maxDrawdownPct: maxDD,
      isKilled: this.state.isKilled,
      dailyLocked: this.state.dailyLocked,
    };
  }
}

// Default instance
export const strategyEngine = new StrategyEngine();
