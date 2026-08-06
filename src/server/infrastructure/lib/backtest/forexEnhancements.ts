/**
 * Forex-specific enhancements for backtesting.
 * Session filtering, variable spreads, pip-based position sizing, swap costs.
 */

// ============================================================
// SESSION DEFINITIONS
// ============================================================

export interface ForexSession {
  name: string;
  startHourUTC: number;
  endHourUTC: number;
}

export const SESSIONS: Record<string, ForexSession> = {
  sydney:  { name: 'Sydney',   startHourUTC: 21, endHourUTC: 6 },
  tokyo:   { name: 'Tokyo',    startHourUTC: 0,  endHourUTC: 8 },
  london:  { name: 'London',   startHourUTC: 8,  endHourUTC: 16 },
  newYork: { name: 'New York', startHourUTC: 13, endHourUTC: 21 },
};

/** Check if a timestamp falls within any of the given sessions. */
export function isInSession(timestampMs: number, sessionKeys: string[]): boolean {
  const hour = new Date(timestampMs).getUTCHours();
  for (const key of sessionKeys) {
    const session = SESSIONS[key];
    if (!session) continue;
    if (isHourInRange(hour, session.startHourUTC, session.endHourUTC)) return true;
  }
  return false;
}

/** Return all session keys currently active at the given timestamp. */
export function getActiveSessions(timestampMs: number): string[] {
  const hour = new Date(timestampMs).getUTCHours();
  const active: string[] = [];
  for (const [key, session] of Object.entries(SESSIONS)) {
    if (isHourInRange(hour, session.startHourUTC, session.endHourUTC)) {
      active.push(key);
    }
  }
  return active;
}

/** Check if the London + New York overlap is active (13:00–16:00 UTC). */
export function isSessionOverlap(timestampMs: number): boolean {
  const hour = new Date(timestampMs).getUTCHours();
  // London: 8–16, New York: 13–21 → overlap is 13–16 UTC
  return hour >= 13 && hour < 16;
}

function isHourInRange(hour: number, start: number, end: number): boolean {
  if (start < end) {
    // Same-day range (e.g., London 8–16)
    return hour >= start && hour < end;
  }
  // Wraps midnight (e.g., Sydney 21–6)
  return hour >= start || hour < end;
}

// ============================================================
// VARIABLE SPREAD MODEL
// ============================================================

export interface SpreadModel {
  basePips: number;
  sessionMultipliers: Record<string, number>;
  overlapMultiplier: number;
}

export const DEFAULT_SPREAD_MODELS: Record<string, SpreadModel> = {
  'EUR/USD': { basePips: 1.0, sessionMultipliers: { london: 0.8, newYork: 0.9, tokyo: 1.5, sydney: 2.0 }, overlapMultiplier: 0.7 },
  'GBP/USD': { basePips: 1.5, sessionMultipliers: { london: 0.7, newYork: 0.9, tokyo: 1.8, sydney: 2.5 }, overlapMultiplier: 0.6 },
  'USD/JPY': { basePips: 0.9, sessionMultipliers: { london: 0.9, newYork: 1.0, tokyo: 0.7, sydney: 1.3 }, overlapMultiplier: 0.8 },
  'USD/CHF': { basePips: 1.5, sessionMultipliers: { london: 0.8, newYork: 0.9, tokyo: 1.6, sydney: 2.2 }, overlapMultiplier: 0.7 },
  'AUD/USD': { basePips: 1.2, sessionMultipliers: { london: 0.9, newYork: 1.0, tokyo: 0.8, sydney: 0.7 }, overlapMultiplier: 0.8 },
  'NZD/USD': { basePips: 1.8, sessionMultipliers: { london: 0.9, newYork: 1.0, tokyo: 0.9, sydney: 0.7 }, overlapMultiplier: 0.8 },
  'USD/CAD': { basePips: 1.5, sessionMultipliers: { london: 0.9, newYork: 0.7, tokyo: 1.5, sydney: 2.0 }, overlapMultiplier: 0.6 },
  'EUR/GBP': { basePips: 1.5, sessionMultipliers: { london: 0.7, newYork: 1.0, tokyo: 1.8, sydney: 2.3 }, overlapMultiplier: 0.7 },
  'EUR/JPY': { basePips: 1.7, sessionMultipliers: { london: 0.8, newYork: 0.9, tokyo: 0.7, sydney: 1.5 }, overlapMultiplier: 0.7 },
  'GBP/JPY': { basePips: 2.5, sessionMultipliers: { london: 0.7, newYork: 0.9, tokyo: 0.8, sydney: 1.8 }, overlapMultiplier: 0.6 },
  'EUR/AUD': { basePips: 2.0, sessionMultipliers: { london: 0.8, newYork: 1.0, tokyo: 1.2, sydney: 0.8 }, overlapMultiplier: 0.7 },
  'EUR/CHF': { basePips: 1.8, sessionMultipliers: { london: 0.7, newYork: 0.9, tokyo: 1.5, sydney: 2.0 }, overlapMultiplier: 0.7 },
  'AUD/JPY': { basePips: 1.8, sessionMultipliers: { london: 0.9, newYork: 1.0, tokyo: 0.7, sydney: 0.7 }, overlapMultiplier: 0.8 },
};

/**
 * Get the variable spread for a symbol at a given time (in pips).
 * Spreads are tightest during session overlaps, widest during low-liquidity hours.
 */
export function getVariableSpread(symbol: string, timestampMs: number): number {
  const model = DEFAULT_SPREAD_MODELS[symbol];
  if (!model) return 1.5; // Fallback for unknown pairs

  // Check for London/NY overlap first — tightest spreads
  if (isSessionOverlap(timestampMs)) {
    return model.basePips * model.overlapMultiplier;
  }

  // Find active sessions and use the best (lowest) multiplier
  const activeSessions = getActiveSessions(timestampMs);
  if (activeSessions.length === 0) {
    // Off-hours — widest spread (2.5× base)
    return model.basePips * 2.5;
  }

  let bestMultiplier = Infinity;
  for (const sess of activeSessions) {
    const mult = model.sessionMultipliers[sess];
    if (mult !== undefined && mult < bestMultiplier) {
      bestMultiplier = mult;
    }
  }

  return model.basePips * (bestMultiplier === Infinity ? 1.0 : bestMultiplier);
}

// ============================================================
// PIP-BASED POSITION SIZING
// ============================================================

export interface PipSizingConfig {
  riskPerTradePct: number;   // e.g., 1.0 = 1% of equity
  accountCurrency: string;   // 'USD'
}

/** Standard pip values per standard lot (100,000 units). */
const PIP_VALUES: Record<string, number> = {
  'EUR/USD': 10.0,
  'GBP/USD': 10.0,
  'AUD/USD': 10.0,
  'NZD/USD': 10.0,
  'USD/JPY': 1000 / 100,    // ≈$10 for a 100k lot at ~100 JPY/USD
  'USD/CHF': 10.0,
  'USD/CAD': 10.0,
  'EUR/GBP': 10.0,
  'EUR/JPY': 10.0,
  'GBP/JPY': 10.0,
  'EUR/AUD': 10.0,
  'EUR/CHF': 10.0,
  'AUD/JPY': 10.0,
};

/**
 * Calculate pip value for a given symbol and lot size.
 * Returns the value of 1 pip in account currency (USD assumed).
 */
export function calculatePipValue(symbol: string, lotSize: number): number {
  const basePerLot = PIP_VALUES[symbol] ?? 10.0;
  return basePerLot * lotSize;
}

/**
 * Calculate position size (in standard lots) based on risk parameters.
 *
 * lotSize = (equity × riskPct/100) / (stopLossPips × pipValue_per_lot)
 */
export function calculatePositionSize(
  equity: number,
  riskPct: number,
  stopLossPips: number,
  symbol: string,
): number {
  if (stopLossPips <= 0 || equity <= 0 || riskPct <= 0) return 0;

  const pipValuePerLot = PIP_VALUES[symbol] ?? 10.0;
  const riskAmount = equity * (riskPct / 100);
  const lots = riskAmount / (stopLossPips * pipValuePerLot);

  // Round to nearest 0.01 (micro-lot precision)
  return Math.max(0.01, Math.round(lots * 100) / 100);
}

// ============================================================
// SWAP / ROLLOVER COSTS
// ============================================================

export interface SwapRates {
  longSwapPips: number;
  shortSwapPips: number;
  tripleDay: number;   // Day of week for triple swap (0=Sun, 1=Mon, ... 6=Sat)
}

export const SWAP_RATES: Record<string, SwapRates> = {
  'EUR/USD': { longSwapPips: -0.72, shortSwapPips: 0.18, tripleDay: 2 },
  'GBP/USD': { longSwapPips: -0.45, shortSwapPips: 0.12, tripleDay: 2 },
  'USD/JPY': { longSwapPips: 0.35, shortSwapPips: -0.85, tripleDay: 2 },
  'USD/CHF': { longSwapPips: 0.42, shortSwapPips: -0.90, tripleDay: 2 },
  'AUD/USD': { longSwapPips: -0.30, shortSwapPips: 0.05, tripleDay: 2 },
  'NZD/USD': { longSwapPips: -0.25, shortSwapPips: 0.03, tripleDay: 2 },
  'USD/CAD': { longSwapPips: -0.20, shortSwapPips: -0.15, tripleDay: 2 },
  'EUR/GBP': { longSwapPips: -0.50, shortSwapPips: 0.10, tripleDay: 2 },
  'EUR/JPY': { longSwapPips: 0.10, shortSwapPips: -0.60, tripleDay: 2 },
  'GBP/JPY': { longSwapPips: 0.55, shortSwapPips: -1.10, tripleDay: 2 },
  'EUR/AUD': { longSwapPips: -0.65, shortSwapPips: 0.15, tripleDay: 2 },
  'EUR/CHF': { longSwapPips: 0.20, shortSwapPips: -0.70, tripleDay: 2 },
  'AUD/JPY': { longSwapPips: 0.25, shortSwapPips: -0.65, tripleDay: 2 },
};

/**
 * Calculate total swap cost for holding a position.
 *
 * Swap is charged per overnight rollover. Wednesday (tripleDay) is 3× to account
 * for the weekend. Returns cost in account currency (positive = charge, negative = credit).
 */
export function calculateSwapCost(
  symbol: string,
  side: 'long' | 'short',
  lotSize: number,
  holdingDays: number,
  entryDayOfWeek: number,
): number {
  const rates = SWAP_RATES[symbol];
  if (!rates || holdingDays <= 0 || lotSize <= 0) return 0;

  const swapPips = side === 'long' ? rates.longSwapPips : rates.shortSwapPips;
  const pipValue = calculatePipValue(symbol, lotSize);

  let totalSwap = 0;
  for (let d = 0; d < holdingDays; d++) {
    const dayOfWeek = (entryDayOfWeek + d) % 7;
    // Triple swap day (usually Wednesday) covers weekend rollover
    const multiplier = dayOfWeek === rates.tripleDay ? 3 : 1;
    totalSwap += swapPips * pipValue * multiplier;
  }

  return totalSwap;
}
