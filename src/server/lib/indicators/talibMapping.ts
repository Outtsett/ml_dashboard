/**
 * TA-Lib Column Name Mapping
 *
 * Maps QuestDB `talib_features` column names (lowercase) to
 * frontend display names with parameters, and vice versa.
 * Also provides category and render-type metadata for each indicator.
 */

// ============================================================================
// TYPES
// ============================================================================

export type TalibCategory =
  | 'overlap'
  | 'momentum'
  | 'volatility'
  | 'volume'
  | 'trend'
  | 'candle'
  | 'statistics';

export type RenderType = 'overlay' | 'subchart' | 'marker';

// ============================================================================
// CANDLE PATTERN NAMES (61 patterns)
// ============================================================================

const CANDLE_SUFFIXES = [
  '2crows', '3blackcrows', '3inside', '3linestrike', '3outside',
  '3starsinsouth', '3whitesoldiers', 'abandonedbaby', 'advanceblock',
  'belthold', 'breakaway', 'closingmarubozu', 'concealbabyswall',
  'counterattack', 'darkcloudcover', 'doji', 'dojistar', 'dragonflydoji',
  'engulfing', 'eveningdojistar', 'eveningstar', 'gapsidesidewhite',
  'gravestonedoji', 'hammer', 'hangingman', 'harami', 'haramicross',
  'highwave', 'hikkake', 'hikkakemod', 'homingpigeon', 'identical3crows',
  'inneck', 'invertedhammer', 'kicking', 'kickingbylength', 'ladderbottom',
  'longleggeddoji', 'longline', 'marubozu', 'matchinglow', 'mathold',
  'morningdojistar', 'morningstar', 'onneck', 'piercing', 'rickshawman',
  'risefall3methods', 'separatinglines', 'shootingstar', 'shortline',
  'spinningtop', 'stalledpattern', 'sticksandwich', 'takuri', 'tasukigap',
  'thrusting', 'tristar', 'unique3river', 'upsidegap2crows',
  'xsidegap3methods',
] as const;

// ============================================================================
// COLUMN MAP: QuestDB column → display name
// ============================================================================

function buildColumnMap(): Record<string, string> {
  const map: Record<string, string> = {
    // ── Overlap (overlay on price chart) ──
    ht_dcperiod:           'HT_DCPERIOD',
    ht_dcphase:            'HT_DCPHASE',
    ht_phasor_inphase:     'HT_PHASOR_INPHASE',
    ht_phasor_quadrature:  'HT_PHASOR_QUADRATURE',
    ht_sine_sine:          'HT_SINE_SINE',
    ht_sine_leadsine:      'HT_SINE_LEADSINE',
    ht_trendline:          'HT_TRENDLINE',
    sma:                   'SMA_30',
    ema:                   'EMA_30',
    wma:                   'WMA_30',
    dema:                  'DEMA_30',
    tema:                  'TEMA_30',
    kama:                  'KAMA_10',
    ma:                    'MA_30',
    t3:                    'T3_5',
    trima:                 'TRIMA_30',
    sar:                   'PSAR',
    sarext:                'PSAREXT',
    midpoint:              'MIDPOINT_14',
    midprice:              'MIDPRICE_14',
    mama_mama:             'MAMA',
    mama_fama:             'FAMA',
    tsf:                   'TSF_20',
    linearreg:             'LINREG_20',
    bbands_upperband:      'BBU_5_2_0',
    bbands_middleband:     'BBM_5_2_0',
    bbands_lowerband:      'BBL_5_2_0',

    // ── Trend (subchart) ──
    adx:                   'ADX_14',
    adxr:                  'ADXR_14',
    aroon_aroondown:       'AROON_DOWN_25',
    aroon_aroonup:         'AROON_UP_25',
    aroonosc:              'AROONOSC_25',
    dx:                    'DX_14',
    ht_trendmode:          'HT_TRENDMODE',
    plus_di:               'PLUS_DI_14',
    minus_di:              'MINUS_DI_14',
    plus_dm:               'PLUS_DM_14',
    minus_dm:              'MINUS_DM_14',

    // ── Momentum (subchart) ──
    rsi:                   'RSI_14',
    macd_macd:             'MACD_12_26_9',
    macd_macdsignal:       'MACDs_12_26_9',
    macd_macdhist:         'MACDh_12_26_9',
    macdext_macd:          'MACDEXT_12_26_9',
    macdext_macdsignal:    'MACDEXTs_12_26_9',
    macdext_macdhist:      'MACDEXTh_12_26_9',
    macdfix_macd:          'MACDFIX_9',
    macdfix_macdsignal:    'MACDFIXs_9',
    macdfix_macdhist:      'MACDFIXh_9',
    stoch_slowk:           'STOCHk_14_3_3',
    stoch_slowd:           'STOCHd_14_3_3',
    stochf_fastk:          'STOCHFk_5_3',
    stochf_fastd:          'STOCHFd_5_3',
    stochrsi_fastk:        'STOCHRSIk_14_14_3_3',
    stochrsi_fastd:        'STOCHRSId_14_14_3_3',
    cmo:                   'CMO_14',
    mfi:                   'MFI_14',
    apo:                   'APO_12_26',
    ppo:                   'PPO_12_26',
    mom:                   'MOM_10',
    roc:                   'ROC_10',
    rocp:                  'ROCP_10',
    rocr:                  'ROCR_10',
    rocr100:               'ROCR100_10',
    cci:                   'CCI_20',
    willr:                 'WILLR_14',
    trix:                  'TRIX_15',
    ultosc:                'ULTOSC_7_14_28',
    bop:                   'BOP',

    // ── Volatility (subchart) ──
    atr:                   'ATR_14',
    natr:                  'NATR_14',
    trange:                'TRANGE',

    // ── Volume (subchart) ──
    ad:                    'AD',
    adosc:                 'ADOSC_3_10',
    obv:                   'OBV',

    // ── Statistics (subchart) ──
    beta:                  'BETA_5',
    correl:                'CORREL_20',
    stddev:                'STDEV_20',
    var:                   'VAR_20',
    linearreg_slope:       'LINREG_SLOPE_20',
    linearreg_angle:       'LINREG_ANGLE_20',
    linearreg_intercept:   'LINREG_INTERCEPT_20',
    avgprice:              'AVGPRICE',
    medprice:              'MEDPRICE',
    typprice:              'TYPPRICE',
    wclprice:              'WCLPRICE',
  };

  // ── Candle Patterns (marker) — 61 patterns ──
  for (const suffix of CANDLE_SUFFIXES) {
    map[`cdl${suffix}`] = `CDL_${suffix.toUpperCase()}`;
  }

  return map;
}

export const TALIB_COLUMN_MAP: Readonly<Record<string, string>> = buildColumnMap();

// ============================================================================
// DISPLAY MAP: display name → QuestDB column (reverse of COLUMN_MAP)
// ============================================================================

export const TALIB_DISPLAY_MAP: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(TALIB_COLUMN_MAP).map(([col, display]) => [display, col])
  );

// ============================================================================
// CATEGORY MAP: display name → category
// ============================================================================

function buildCategoryMap(): Record<string, TalibCategory> {
  const overlapCols = new Set([
    'ht_dcperiod', 'ht_dcphase', 'ht_phasor_inphase', 'ht_phasor_quadrature',
    'ht_sine_sine', 'ht_sine_leadsine', 'ht_trendline',
    'sma', 'ema', 'wma', 'dema', 'tema', 'kama', 'ma', 't3', 'trima',
    'sar', 'sarext', 'midpoint', 'midprice', 'mama_mama', 'mama_fama',
    'tsf', 'linearreg',
    'bbands_upperband', 'bbands_middleband', 'bbands_lowerband',
  ]);

  const trendCols = new Set([
    'adx', 'adxr', 'aroon_aroondown', 'aroon_aroonup', 'aroonosc',
    'dx', 'ht_trendmode', 'plus_di', 'minus_di', 'plus_dm', 'minus_dm',
  ]);

  const momentumCols = new Set([
    'rsi', 'macd_macd', 'macd_macdsignal', 'macd_macdhist',
    'macdext_macd', 'macdext_macdsignal', 'macdext_macdhist',
    'macdfix_macd', 'macdfix_macdsignal', 'macdfix_macdhist',
    'stoch_slowk', 'stoch_slowd', 'stochf_fastk', 'stochf_fastd',
    'stochrsi_fastk', 'stochrsi_fastd',
    'cmo', 'mfi', 'apo', 'ppo', 'mom', 'roc', 'rocp', 'rocr', 'rocr100',
    'cci', 'willr', 'trix', 'ultosc', 'bop',
  ]);

  const volatilityCols = new Set(['atr', 'natr', 'trange']);

  const volumeCols = new Set(['ad', 'adosc', 'obv']);

  const statsCols = new Set([
    'beta', 'correl', 'stddev', 'var',
    'linearreg_slope', 'linearreg_angle', 'linearreg_intercept',
    'avgprice', 'medprice', 'typprice', 'wclprice',
  ]);

  const map: Record<string, TalibCategory> = {};

  for (const [col, display] of Object.entries(TALIB_COLUMN_MAP)) {
    if (overlapCols.has(col))          map[display] = 'overlap';
    else if (trendCols.has(col))       map[display] = 'trend';
    else if (momentumCols.has(col))    map[display] = 'momentum';
    else if (volatilityCols.has(col))  map[display] = 'volatility';
    else if (volumeCols.has(col))      map[display] = 'volume';
    else if (statsCols.has(col))       map[display] = 'statistics';
    else if (col.startsWith('cdl'))    map[display] = 'candle';
    else throw new Error(`Unmapped category for column: ${col}`);
  }

  return map;
}

export const TALIB_CATEGORIES: Readonly<Record<string, TalibCategory>> = buildCategoryMap();

// ============================================================================
// RENDER TYPE MAP: display name → render type
// ============================================================================

function buildRenderTypeMap(): Record<string, RenderType> {
  const map: Record<string, RenderType> = {};

  for (const [display, category] of Object.entries(TALIB_CATEGORIES)) {
    if (category === 'overlap')   map[display] = 'overlay';
    else if (category === 'candle') map[display] = 'marker';
    else                          map[display] = 'subchart';
  }

  return map;
}

export const TALIB_RENDER_TYPE: Readonly<Record<string, RenderType>> = buildRenderTypeMap();

// ============================================================================
// LOOKUP HELPERS
// ============================================================================

/** Convert a QuestDB talib column name to its frontend display name. */
export function talibToDisplay(col: string): string {
  const display = TALIB_COLUMN_MAP[col];
  if (!display) {
    throw new Error(`Unknown talib column: ${col}`);
  }
  return display;
}

/** Convert a frontend display name to its QuestDB talib column name. */
export function displayToTalib(display: string): string {
  const col = TALIB_DISPLAY_MAP[display];
  if (!col) {
    throw new Error(`Unknown display name: ${display}`);
  }
  return col;
}
