/**
 * UI Display Helpers for Indicators.
 * Logic for building display-friendly column names for color/width lookup.
 */

export function buildDisplayColumn(indicatorId: string, outputKey: string, isMulti: boolean): string {
  if (!isMulti) {
    switch (indicatorId) {
      // Overlap
      case 'sma': return 'SMA_20';
      case 'ema': return 'EMA_20';
      case 'wma': return 'WMA_20';
      case 'dema': return 'DEMA_20';
      case 'tema': return 'TEMA_20';
      case 'trima': return 'TRIMA_30';
      case 't3': return 'T3_5';
      case 'kama': return 'KAMA_10';
      case 'midpoint': return 'MIDPOINT_14';
      case 'midprice': return 'MIDPRICE_14';
      case 'ht_trendline': return 'HT_TRENDLINE';
      case 'tsf': return 'TSF_20';
      case 'linearreg': return 'LINREG_20';
      case 'psar': return 'PSAR';
      case 'vwap': return 'VWAP';
      // Momentum
      case 'rsi': return 'RSI_14';
      case 'cci': return 'CCI_20';
      case 'willr': return 'WILLR_14';
      case 'momentum': return 'MOM_10';
      case 'roc': return 'ROC_10';
      case 'rocp': return 'ROCP_10';
      case 'rocr': return 'ROCR_10';
      case 'rocr100': return 'ROCR100_10';
      case 'cmo': return 'CMO_14';
      case 'apo': return 'APO_12_26';
      case 'ppo': return 'PPO_12_26';
      case 'trix': return 'TRIX_15';
      case 'ultosc': return 'ULTOSC_7_14_28';
      case 'bop': return 'BOP';
      // Trend
      case 'adxr': return 'ADXR_14';
      case 'dx': return 'DX_14';
      case 'plus_di': return 'PLUS_DI_14';
      case 'minus_di': return 'MINUS_DI_14';
      case 'plus_dm': return 'PLUS_DM_14';
      case 'minus_dm': return 'MINUS_DM_14';
      case 'aroonosc': return 'AROONOSC_25';
      case 'ht_trendmode': return 'HT_TRENDMODE';
      // Volatility
      case 'atr': return 'ATR_14';
      case 'natr': return 'NATR_14';
      case 'trange': return 'TRANGE';
      // Volume
      case 'obv': return 'OBV';
      case 'ad': return 'AD';
      case 'adosc': return 'ADOSC_3_10';
      case 'mfi': return 'MFI_14';
      // Statistics
      case 'stddev': return 'STDEV_20';
      case 'variance': return 'VAR_20';
      case 'beta': return 'BETA_5';
      case 'correl': return 'CORREL_20';
      case 'linreg_slope': return 'LINREG_SLOPE_20';
      case 'linreg_angle': return 'LINREG_ANGLE_20';
      case 'linreg_intercept': return 'LINREG_INTERCEPT_20';
      // Hilbert Transform
      case 'ht_dcperiod': return 'HT_DCPERIOD';
      case 'ht_dcphase': return 'HT_DCPHASE';
      // New overlay MAs
      case 'hma': return 'HMA_20';
      case 'alma': return 'ALMA_9';
      case 'fwma': return 'FWMA_20';
      case 'pwma': return 'PWMA_20';
      case 'sinwma': return 'SINWMA_14';
      case 'swma': return 'SWMA';
      case 'vidya': return 'VIDYA_14';
      case 'vwma': return 'VWMA_20';
      case 'hwma': return 'HWMA';
      case 'mcgd': return 'MCGD_14';
      case 'jma': return 'JMA_7';
      case 'zlma': return 'ZLMA_20';
      case 'rma_overlay': return 'RMA_14';
      case 'hilo': return 'HILO_13';
      case 'ssf': return 'SSF_20';
      case 'avgprice': return 'AVGPRICE';
      case 'medprice': return 'MEDPRICE';
      case 'typprice': return 'TYPPRICE';
      case 'wclprice': return 'WCLPRICE';
      // New momentum
      case 'ao': return 'AO_5_34';
      case 'bias': return 'BIAS_26';
      case 'cfo': return 'CFO_9';
      case 'cg': return 'CG_10';
      case 'coppock': return 'COPPOCK_10';
      case 'crsi': return 'CRSI_3';
      case 'er': return 'ER_10';
      case 'inertia': return 'INERTIA_20';
      case 'pgo': return 'PGO_14';
      case 'psl': return 'PSL_12';
      case 'rsx': return 'RSX_14';
      case 'stc': return 'STC_10';
      case 'wad': return 'WAD';
      // New trend
      case 'choppiness': return 'CHOP_14';
      case 'dpo': return 'DPO_20';
      case 'qstick': return 'QSTICK_14';
      case 'vhf': return 'VHF_28';
      case 'decay': return 'DECAY_5';
      case 'zigzag': return 'ZIGZAG';
      // New volatility
      case 'aberration': return 'ABERRATION_20';
      case 'massi': return 'MASSI_25';
      case 'ui': return 'UI_14';
      case 'pdist': return 'PDIST';
      case 'bbwidth': return 'BBW_20';
      case 'kcwidth': return 'KCW_20';
      case 'rvi_vol': return 'RVI_14';
      // New volume
      case 'cmf': return 'CMF_20';
      case 'efi': return 'EFI_13';
      case 'eom': return 'EOM_14';
      case 'nvi': return 'NVI';
      case 'pvi': return 'PVI';
      case 'pvr': return 'PVR';
      case 'pvt': return 'PVT';
      case 'vpci': return 'VPCI_5_25';
      case 'vpoc': return 'VPOC_20';
      case 'vpoc_dist': return 'VPOC_DIST_20';
      // New statistics
      case 'entropy': return 'ENTROPY_10';
      case 'kurtosis': return 'KURTOSIS_30';
      case 'mad': return 'MAD_30';
      case 'rolling_median': return 'MEDIAN_30';
      case 'quantile': return 'QUANTILE_30';
      case 'skew': return 'SKEW_30';
      case 'zscore': return 'ZSCORE_30';
      // New cycle
      case 'ebsw': return 'EBSW_40';
      case 'reflex': return 'REFLEX_20';
      // New performance
      case 'log_return': return 'LOGRET';
      case 'pct_return': return 'PCTRET';
      case 'cum_log_return': return 'CUMLOGRET';
      case 'cum_pct_return': return 'CUMPCTRET';
      default: return indicatorId.toUpperCase();
    }
  }

  // Multi-output indicators
  switch (indicatorId) {
    case 'macd':
      if (outputKey === 'macd') return 'MACD_12_26_9';
      if (outputKey === 'signal') return 'MACDs_12_26_9';
      if (outputKey === 'histogram') return 'MACDh_12_26_9';
      return 'MACD_12_26_9';
    case 'macdext':
      if (outputKey === 'macd') return 'MACDEXT_12_26_9';
      if (outputKey === 'signal') return 'MACDEXTs_12_26_9';
      if (outputKey === 'histogram') return 'MACDEXTh_12_26_9';
      return 'MACDEXT_12_26_9';
    case 'macdfix':
      if (outputKey === 'macd') return 'MACDFIX_9';
      if (outputKey === 'signal') return 'MACDFIXs_9';
      if (outputKey === 'histogram') return 'MACDFIXh_9';
      return 'MACDFIX_9';
    case 'stochastic':
      if (outputKey === 'k') return 'STOCHk_14_3_3';
      if (outputKey === 'd') return 'STOCHd_14_3_3';
      return 'STOCHk_14_3_3';
    case 'stochf':
      if (outputKey === 'k') return 'STOCHFk_5_3';
      if (outputKey === 'd') return 'STOCHFd_5_3';
      return 'STOCHFk_5_3';
    case 'stochrsi':
      if (outputKey === 'k') return 'STOCHRSIk_14_14_3_3';
      if (outputKey === 'd') return 'STOCHRSId_14_14_3_3';
      return 'STOCHRSIk_14_14_3_3';
    case 'bbands':
      if (outputKey === 'upper') return 'BBU_5_2.0';
      if (outputKey === 'middle') return 'BBM_5_2.0';
      if (outputKey === 'lower') return 'BBL_5_2.0';
      return 'BBM_5_2.0';
    case 'mama':
      if (outputKey === 'mama') return 'MAMA';
      if (outputKey === 'fama') return 'FAMA';
      return 'MAMA';
    case 'adx':
      if (outputKey === 'adx') return 'ADX_14';
      if (outputKey === 'plusDI') return 'PLUS_DI_14';
      if (outputKey === 'minusDI') return 'MINUS_DI_14';
      return 'ADX_14';
    case 'aroon':
      if (outputKey === 'up') return 'AROON_UP_25';
      if (outputKey === 'down') return 'AROON_DOWN_25';
      return 'AROON_UP_25';
    case 'ht_phasor':
      if (outputKey === 'inphase') return 'HT_PHASOR_INPHASE';
      if (outputKey === 'quadrature') return 'HT_PHASOR_QUADRATURE';
      return 'HT_PHASOR_INPHASE';
    case 'ht_sine':
      if (outputKey === 'sine') return 'HT_SINE_SINE';
      if (outputKey === 'leadsine') return 'HT_SINE_LEADSINE';
      return 'HT_SINE_SINE';
    case 'ichimoku':
      if (outputKey === 'tenkan') return 'TENKAN_9';
      if (outputKey === 'kijun') return 'KIJUN_26';
      if (outputKey === 'senkouA') return 'SENKOUA_26';
      if (outputKey === 'senkouB') return 'SENKOUB_52';
      if (outputKey === 'chikou') return 'CHIKOU_26';
      return 'TENKAN_9';
    case 'keltner':
      if (outputKey === 'upper') return 'KC_UPPER_20';
      if (outputKey === 'middle') return 'KC_MIDDLE_20';
      if (outputKey === 'lower') return 'KC_LOWER_20';
      return 'KC_MIDDLE_20';
    case 'donchian':
      if (outputKey === 'upper') return 'DC_UPPER_20';
      if (outputKey === 'middle') return 'DC_MIDDLE_20';
      if (outputKey === 'lower') return 'DC_LOWER_20';
      return 'DC_MIDDLE_20';
    case 'supertrend':
      if (outputKey === 'supertrend') return 'SUPERTREND_10';
      if (outputKey === 'direction') return 'SUPERTREND_DIR';
      return 'SUPERTREND_10';
    case 'accbands':
      if (outputKey === 'upper') return 'ACCB_UPPER';
      if (outputKey === 'middle') return 'ACCB_MIDDLE';
      if (outputKey === 'lower') return 'ACCB_LOWER';
      return 'ACCB_MIDDLE';
    case 'cksp':
      if (outputKey === 'stopLong') return 'CKSP_LONG';
      if (outputKey === 'stopShort') return 'CKSP_SHORT';
      return 'CKSP_LONG';
    case 'fisher':
      if (outputKey === 'fisher') return 'FISHER_9';
      if (outputKey === 'trigger') return 'FISHER_TRIGGER_9';
      return 'FISHER_9';
    case 'kst':
      if (outputKey === 'kst') return 'KST';
      if (outputKey === 'signal') return 'KST_SIGNAL';
      return 'KST';
    case 'qqe':
      if (outputKey === 'qqe') return 'QQE_14';
      if (outputKey === 'rsiSmooth') return 'QQE_RSI_14';
      if (outputKey === 'upper') return 'QQE_UPPER';
      if (outputKey === 'lower') return 'QQE_LOWER';
      return 'QQE_14';
    case 'rvgi':
      if (outputKey === 'rvgi') return 'RVGI_10';
      if (outputKey === 'signal') return 'RVGI_SIGNAL_10';
      return 'RVGI_10';
    case 'tsi':
      if (outputKey === 'tsi') return 'TSI_25_13';
      if (outputKey === 'signal') return 'TSI_SIGNAL';
      return 'TSI_25_13';
    case 'smi':
      if (outputKey === 'smi') return 'SMI_14';
      if (outputKey === 'signal') return 'SMI_SIGNAL';
      return 'SMI_14';
    case 'squeeze':
      if (outputKey === 'momentum') return 'SQZ_MOM';
      if (outputKey === 'squeeze') return 'SQZ_SQUEEZE';
      return 'SQZ_MOM';
    case 'squeeze_pro':
      if (outputKey === 'momentum') return 'SQZ_MOM';
      if (outputKey === 'squeeze') return 'SQZ_SQUEEZE';
      return 'SQZ_MOM';
    case 'kdj':
      if (outputKey === 'k') return 'KDJ_K_9';
      if (outputKey === 'd') return 'KDJ_D_9';
      if (outputKey === 'j') return 'KDJ_J_9';
      return 'KDJ_K_9';
    case 'vortex':
      if (outputKey === 'viPlus') return 'VI_PLUS_14';
      if (outputKey === 'viMinus') return 'VI_MINUS_14';
      return 'VI_PLUS_14';
    case 'kvo':
      if (outputKey === 'kvo') return 'KVO_34_55';
      if (outputKey === 'signal') return 'KVO_SIGNAL';
      return 'KVO_34_55';
    case 'hwc':
      if (outputKey === 'upper') return 'HWC_UPPER';
      if (outputKey === 'middle') return 'HWC_MIDDLE';
      if (outputKey === 'lower') return 'HWC_LOWER';
      return 'HWC_MIDDLE';
    default:
      return indicatorId.toUpperCase();
  }
}
