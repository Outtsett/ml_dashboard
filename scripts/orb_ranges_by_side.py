"""Compute indicator P25-P75 ranges for successful breakouts, split by LONG vs SHORT."""
import pandas as pd
import numpy as np
import os

df = pd.read_csv(os.path.dirname(os.path.abspath(__file__)) + '/orb_analysis_results.csv')
sdf = df[df['success'] == True]

indicators = [
    ('ATRr_14', 'ATR'), ('ADX_14', 'ADX'), ('rsi', 'RSI'), ('roc', 'ROC'),
    ('mom', 'Momentum'), ('MACD_12_26_9', 'MACD'), ('MACDh_12_26_9', 'MACD Hist'),
    ('MACDs_12_26_9', 'MACD Signal'), ('cci', 'CCI'), ('willr', 'Williams %R'),
    ('bb_width', 'BB Width'), ('bb_pct_b', 'BB %B'), ('vol_ratio', 'Vol Ratio'),
    ('natr', 'NATR'), ('mfi', 'MFI'),
    ('STOCHk_14_3_3', 'Stoch %K'), ('STOCHd_14_3_3', 'Stoch %D'),
    ('DMP_14', 'DM+'), ('DMN_14', 'DM-'),
    ('AROONOSC_25', 'Aroon Osc'),
    ('range_width', 'Range Width'), ('range_pct', 'Range %'),
]

indicators = [(c, n) for c, n in indicators if c in df.columns]

print(f"SUCCESS breakouts: {len(sdf)} total, LONG={len(sdf[sdf['side']=='LONG'])}, SHORT={len(sdf[sdf['side']=='SHORT'])}")
print()

print(f"{'Indicator':<16} | {'LONG P25':>10} {'LONG P75':>10} {'LONG Med':>10} | {'SHORT P25':>10} {'SHORT P75':>10} {'SHORT Med':>10} | {'COMBINED P25':>12} {'COMBINED P75':>12}")
print("-" * 130)

for col, name in indicators:
    long_s = sdf[sdf['side'] == 'LONG'][col].dropna()
    short_s = sdf[sdf['side'] == 'SHORT'][col].dropna()
    all_s = sdf[col].dropna()

    if len(long_s) < 5 or len(short_s) < 5:
        continue

    print(f"{name:<16} | {long_s.quantile(0.25):>10.3f} {long_s.quantile(0.75):>10.3f} {long_s.median():>10.3f} | "
          f"{short_s.quantile(0.25):>10.3f} {short_s.quantile(0.75):>10.3f} {short_s.median():>10.3f} | "
          f"{all_s.quantile(0.25):>12.3f} {all_s.quantile(0.75):>12.3f}")
