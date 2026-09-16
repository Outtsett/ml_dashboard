/**
 * TA-Lib's candlestick pattern vocabulary, as the lake stores it.
 *
 * These are the 61 functions in TA-Lib 0.7.1's `Pattern Recognition` group, the
 * set `talib_candle_patterns` in the lake was computed from. They are NOT the 60
 * hand-written detectors in `candles/registry.ts`: those are TypeScript
 * approximations recomputed in the browser from the bars on screen, these are the
 * C library's own output, read back from storage. The two share names and
 * disagree on bars, which is exactly why they are listed separately in the UI.
 *
 * `candleCount` is how many bars the C shape test reads, taken from
 * `datalake/scripts/talib_candlestick_rules.json` and verified against
 * `src/ta_func/ta_CDL*.c`. Only 13 of the 61 read a single bar. Hammer,
 * hanging man, inverted hammer and shooting star are two-bar rules in TA-Lib even
 * though traders name them one-candle patterns — each compares the bar against its
 * predecessor's low, high or body.
 *
 * Generated from the rules document; edit that and regenerate rather than editing
 * names here by hand.
 */

export interface TalibPatternEntry {
  /** Bare lowercase name, exactly as the `pattern` column stores it. */
  name: string;
  /** The C function that produced it, e.g. `CDLENGULFING`. */
  talibFunction: string;
  displayName: string;
  /** Bars the shape test reads: 1 means an individual, single-candle pattern. */
  candleCount: number;
  patternType: string;
}

export const TALIB_PATTERN_CATALOG: TalibPatternEntry[] = [
  { name: 'belthold', talibFunction: 'CDLBELTHOLD', displayName: 'Belt Hold', candleCount: 1, patternType: 'reversal' },
  { name: 'closingmarubozu', talibFunction: 'CDLCLOSINGMARUBOZU', displayName: 'Closing Marubozu', candleCount: 1, patternType: 'continuation' },
  { name: 'doji', talibFunction: 'CDLDOJI', displayName: 'Doji', candleCount: 1, patternType: 'indecision' },
  { name: 'dragonflydoji', talibFunction: 'CDLDRAGONFLYDOJI', displayName: 'Dragonfly Doji', candleCount: 1, patternType: 'indecision' },
  { name: 'gravestonedoji', talibFunction: 'CDLGRAVESTONEDOJI', displayName: 'Gravestone Doji', candleCount: 1, patternType: 'indecision' },
  { name: 'highwave', talibFunction: 'CDLHIGHWAVE', displayName: 'High Wave', candleCount: 1, patternType: 'indecision' },
  { name: 'longleggeddoji', talibFunction: 'CDLLONGLEGGEDDOJI', displayName: 'Long-Legged Doji', candleCount: 1, patternType: 'indecision' },
  { name: 'longline', talibFunction: 'CDLLONGLINE', displayName: 'Long Line', candleCount: 1, patternType: 'colour_line' },
  { name: 'marubozu', talibFunction: 'CDLMARUBOZU', displayName: 'Marubozu', candleCount: 1, patternType: 'colour_line' },
  { name: 'rickshawman', talibFunction: 'CDLRICKSHAWMAN', displayName: 'Rickshaw Man', candleCount: 1, patternType: 'indecision' },
  { name: 'shortline', talibFunction: 'CDLSHORTLINE', displayName: 'Short Line', candleCount: 1, patternType: 'colour_line' },
  { name: 'spinningtop', talibFunction: 'CDLSPINNINGTOP', displayName: 'Spinning Top', candleCount: 1, patternType: 'indecision' },
  { name: 'takuri', talibFunction: 'CDLTAKURI', displayName: 'Takuri', candleCount: 1, patternType: 'reversal' },
  { name: 'counterattack', talibFunction: 'CDLCOUNTERATTACK', displayName: 'Counterattack', candleCount: 2, patternType: 'reversal' },
  { name: 'darkcloudcover', talibFunction: 'CDLDARKCLOUDCOVER', displayName: 'Dark Cloud Cover', candleCount: 2, patternType: 'reversal' },
  { name: 'dojistar', talibFunction: 'CDLDOJISTAR', displayName: 'Doji Star', candleCount: 2, patternType: 'reversal' },
  { name: 'engulfing', talibFunction: 'CDLENGULFING', displayName: 'Engulfing', candleCount: 2, patternType: 'reversal' },
  { name: 'hammer', talibFunction: 'CDLHAMMER', displayName: 'Hammer', candleCount: 2, patternType: 'reversal' },
  { name: 'hangingman', talibFunction: 'CDLHANGINGMAN', displayName: 'Hanging Man', candleCount: 2, patternType: 'reversal' },
  { name: 'harami', talibFunction: 'CDLHARAMI', displayName: 'Harami', candleCount: 2, patternType: 'reversal' },
  { name: 'haramicross', talibFunction: 'CDLHARAMICROSS', displayName: 'Harami Cross', candleCount: 2, patternType: 'reversal' },
  { name: 'homingpigeon', talibFunction: 'CDLHOMINGPIGEON', displayName: 'Homing Pigeon', candleCount: 2, patternType: 'reversal' },
  { name: 'inneck', talibFunction: 'CDLINNECK', displayName: 'In-Neck', candleCount: 2, patternType: 'continuation' },
  { name: 'invertedhammer', talibFunction: 'CDLINVERTEDHAMMER', displayName: 'Inverted Hammer', candleCount: 2, patternType: 'reversal' },
  { name: 'kicking', talibFunction: 'CDLKICKING', displayName: 'Kicking', candleCount: 2, patternType: 'reversal' },
  { name: 'kickingbylength', talibFunction: 'CDLKICKINGBYLENGTH', displayName: 'Kicking by Length', candleCount: 2, patternType: 'reversal' },
  { name: 'matchinglow', talibFunction: 'CDLMATCHINGLOW', displayName: 'Matching Low', candleCount: 2, patternType: 'reversal' },
  { name: 'onneck', talibFunction: 'CDLONNECK', displayName: 'On-Neck', candleCount: 2, patternType: 'continuation' },
  { name: 'piercing', talibFunction: 'CDLPIERCING', displayName: 'Piercing Line', candleCount: 2, patternType: 'reversal' },
  { name: 'separatinglines', talibFunction: 'CDLSEPARATINGLINES', displayName: 'Separating Lines', candleCount: 2, patternType: 'continuation' },
  { name: 'shootingstar', talibFunction: 'CDLSHOOTINGSTAR', displayName: 'Shooting Star', candleCount: 2, patternType: 'reversal' },
  { name: 'thrusting', talibFunction: 'CDLTHRUSTING', displayName: 'Thrusting', candleCount: 2, patternType: 'continuation' },
  { name: '2crows', talibFunction: 'CDL2CROWS', displayName: 'Two Crows', candleCount: 3, patternType: 'reversal' },
  { name: '3inside', talibFunction: 'CDL3INSIDE', displayName: 'Three Inside Up/Down', candleCount: 3, patternType: 'reversal' },
  { name: '3outside', talibFunction: 'CDL3OUTSIDE', displayName: 'Three Outside Up/Down', candleCount: 3, patternType: 'reversal' },
  { name: '3starsinsouth', talibFunction: 'CDL3STARSINSOUTH', displayName: 'Three Stars in the South', candleCount: 3, patternType: 'reversal' },
  { name: '3whitesoldiers', talibFunction: 'CDL3WHITESOLDIERS', displayName: 'Three White Soldiers', candleCount: 3, patternType: 'reversal' },
  { name: 'abandonedbaby', talibFunction: 'CDLABANDONEDBABY', displayName: 'Abandoned Baby', candleCount: 3, patternType: 'reversal' },
  { name: 'advanceblock', talibFunction: 'CDLADVANCEBLOCK', displayName: 'Advance Block', candleCount: 3, patternType: 'reversal' },
  { name: 'eveningdojistar', talibFunction: 'CDLEVENINGDOJISTAR', displayName: 'Evening Doji Star', candleCount: 3, patternType: 'reversal' },
  { name: 'eveningstar', talibFunction: 'CDLEVENINGSTAR', displayName: 'Evening Star', candleCount: 3, patternType: 'reversal' },
  { name: 'gapsidesidewhite', talibFunction: 'CDLGAPSIDESIDEWHITE', displayName: 'Up/Down-Gap Side-by-Side White Lines', candleCount: 3, patternType: 'continuation' },
  { name: 'hikkake', talibFunction: 'CDLHIKKAKE', displayName: 'Hikkake', candleCount: 3, patternType: 'reversal' },
  { name: 'identical3crows', talibFunction: 'CDLIDENTICAL3CROWS', displayName: 'Identical Three Crows', candleCount: 3, patternType: 'reversal' },
  { name: 'morningdojistar', talibFunction: 'CDLMORNINGDOJISTAR', displayName: 'Morning Doji Star', candleCount: 3, patternType: 'reversal' },
  { name: 'morningstar', talibFunction: 'CDLMORNINGSTAR', displayName: 'Morning Star', candleCount: 3, patternType: 'reversal' },
  { name: 'stalledpattern', talibFunction: 'CDLSTALLEDPATTERN', displayName: 'Stalled Pattern', candleCount: 3, patternType: 'reversal' },
  { name: 'sticksandwich', talibFunction: 'CDLSTICKSANDWICH', displayName: 'Stick Sandwich', candleCount: 3, patternType: 'reversal' },
  { name: 'tasukigap', talibFunction: 'CDLTASUKIGAP', displayName: 'Tasuki Gap', candleCount: 3, patternType: 'continuation' },
  { name: 'tristar', talibFunction: 'CDLTRISTAR', displayName: 'Tristar', candleCount: 3, patternType: 'reversal' },
  { name: 'unique3river', talibFunction: 'CDLUNIQUE3RIVER', displayName: 'Unique Three River', candleCount: 3, patternType: 'reversal' },
  { name: 'upsidegap2crows', talibFunction: 'CDLUPSIDEGAP2CROWS', displayName: 'Upside Gap Two Crows', candleCount: 3, patternType: 'reversal' },
  { name: 'xsidegap3methods', talibFunction: 'CDLXSIDEGAP3METHODS', displayName: 'Up/Down-Side Gap Three Methods', candleCount: 3, patternType: 'continuation' },
  { name: '3blackcrows', talibFunction: 'CDL3BLACKCROWS', displayName: 'Three Black Crows', candleCount: 4, patternType: 'reversal' },
  { name: '3linestrike', talibFunction: 'CDL3LINESTRIKE', displayName: 'Three-Line Strike', candleCount: 4, patternType: 'continuation' },
  { name: 'concealbabyswall', talibFunction: 'CDLCONCEALBABYSWALL', displayName: 'Concealing Baby Swallow', candleCount: 4, patternType: 'reversal' },
  { name: 'hikkakemod', talibFunction: 'CDLHIKKAKEMOD', displayName: 'Modified Hikkake', candleCount: 4, patternType: 'reversal' },
  { name: 'breakaway', talibFunction: 'CDLBREAKAWAY', displayName: 'Breakaway', candleCount: 5, patternType: 'reversal' },
  { name: 'ladderbottom', talibFunction: 'CDLLADDERBOTTOM', displayName: 'Ladder Bottom', candleCount: 5, patternType: 'reversal' },
  { name: 'mathold', talibFunction: 'CDLMATHOLD', displayName: 'Mat Hold', candleCount: 5, patternType: 'continuation' },
  { name: 'risefall3methods', talibFunction: 'CDLRISEFALL3METHODS', displayName: 'Rising/Falling Three Methods', candleCount: 5, patternType: 'continuation' },
];

/**
 * The 13 individual patterns — one candle, no lookback, no prior-bar
 * comparison. They carry 71.7% of all pattern firings on MNQ 2021-2025.
 */
export const TALIB_SINGLE_CANDLE_PATTERNS: string[] = [
  'belthold',
  'closingmarubozu',
  'doji',
  'dragonflydoji',
  'gravestonedoji',
  'highwave',
  'longleggeddoji',
  'longline',
  'marubozu',
  'rickshawman',
  'shortline',
  'spinningtop',
  'takuri',
];

const BY_NAME = new Map(TALIB_PATTERN_CATALOG.map(p => [p.name, p]));

export function talibPattern(name: string): TalibPatternEntry | undefined {
  return BY_NAME.get(name);
}

/** Display name for a bare pattern name, falling back to the name itself. */
export function talibPatternDisplayName(name: string): string {
  return BY_NAME.get(name)?.displayName ?? name;
}
