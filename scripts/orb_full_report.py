"""
ORB Full Report -- Every breakout day documented with all indicator values.
Per year: min/max indicator ranges at breakout.
Correlation: how each indicator value relates to breakout magnitude.
"""

import pandas as pd
import numpy as np
import os
import json

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
df = pd.read_csv(SCRIPT_DIR + '/orb_analysis_results.csv')
df['year'] = pd.to_datetime(df['date']).dt.year

# Key indicators Tyler asked about
KEY_INDICATORS = [
    'ATRr_14', 'ADX_14', 'rsi', 'roc', 'mom',
    'MACD_12_26_9', 'MACDh_12_26_9', 'MACDs_12_26_9',
    'cci', 'willr',
    'BBU_20_2.0_2.0', 'BBM_20_2.0_2.0', 'BBL_20_2.0_2.0',
    'bb_width', 'bb_pct_b',
    'STOCHk_14_3_3', 'STOCHd_14_3_3',
    'mfi', 'natr', 'obv',
    'AROONU_25', 'AROOND_25', 'AROONOSC_25',
    'DMP_14', 'DMN_14',
    'vol_ratio', 'clv',
    'range_width', 'range_pct'
]

# Filter to columns that actually exist in our data
KEY_INDICATORS = [c for c in KEY_INDICATORS if c in df.columns]

# Breakout magnitude columns
MAGNITUDE_COLS = ['mfe', 'mae', 'mfe_30', 'mae_30', 'end_excursion', 'mfe_range_ratio', 'mfe_mae_ratio']

OUT_PATH = os.path.join(SCRIPT_DIR, 'orb_full_report.txt')
JSON_PATH_OUT = os.path.join(SCRIPT_DIR, 'orb_yearly_ranges.json')
JSON_PATH = os.path.join(SCRIPT_DIR, 'orb_yearly_ranges.json')

with open(OUT_PATH, 'w', encoding='utf-8') as f:
    def w(line=''):
        f.write(line + '\n')
        print(line)

    w("=" * 140)
    w("ORB INDICATOR ANALYSIS -- EVERY BREAKOUT DAY WITH INDICATOR VALUES")
    w(f"MNQ 2020-2024 | {len(df)} total breakouts | 5-min bars | 15-min opening range (9:30-9:45 ET)")
    w("=" * 140)

    yearly_ranges = {}

    for year in sorted(df['year'].unique()):
        yr = df[df['year'] == year].copy()
        yr = yr.sort_values('date')

        w(f"\n{'#'*140}")
        w(f"# YEAR {year} -- {len(yr)} BREAKOUTS")
        w(f"{'#'*140}")

        # ---------------------------------------------------------------
        # Part 1: Every breakout day with indicator values
        # ---------------------------------------------------------------
        w(f"\n--- ALL BREAKOUT DAYS {year} ---")
        w(f"{'Date':<12} {'Side':<6} {'RangeH':>8} {'RangeL':>8} {'RngWid':>7} {'BOPrice':>9} {'BOTime':>22} | "
          f"{'MFE':>6} {'MAE':>6} {'EndExc':>7} {'MFE/R':>6} | "
          f"{'ATR':>6} {'ADX':>6} {'RSI':>6} {'ROC':>7} {'MOM':>7} {'CCI':>7} {'WillR':>7} {'MACDh':>7} "
          f"{'BBwid':>6} {'BB%B':>6} {'VolR':>6} {'CLV':>6} {'MFI':>6} {'NATR':>6} "
          f"{'StochK':>7} {'StochD':>7} {'AroonO':>7} {'DMP':>6} {'DMN':>6}")
        w("-" * 240)

        for _, row in yr.iterrows():
            atr = row.get('ATRr_14', np.nan)
            adx = row.get('ADX_14', np.nan)
            rsi = row.get('rsi', np.nan)
            roc = row.get('roc', np.nan)
            mom = row.get('mom', np.nan)
            cci = row.get('cci', np.nan)
            willr = row.get('willr', np.nan)
            macdh = row.get('MACDh_12_26_9', np.nan)
            bbw = row.get('bb_width', np.nan)
            bbpb = row.get('bb_pct_b', np.nan)
            volr = row.get('vol_ratio', np.nan)
            clv = row.get('clv', np.nan)
            mfi = row.get('mfi', np.nan)
            natr = row.get('natr', np.nan)
            stochk = row.get('STOCHk_14_3_3', np.nan)
            stochd = row.get('STOCHd_14_3_3', np.nan)
            aroono = row.get('AROONOSC_25', np.nan)
            dmp = row.get('DMP_14', np.nan)
            dmn = row.get('DMN_14', np.nan)

            def fmt(v, w=6, d=1):
                return f"{v:>{w}.{d}f}" if pd.notna(v) else f"{'N/A':>{w}}"

            bo_time = str(row['breakout_time_et']).split(' ')[-1][:8] if pd.notna(row.get('breakout_time_et')) else ''

            w(f"{row['date']:<12} {row['side']:<6} {row['range_high']:>8.2f} {row['range_low']:>8.2f} "
              f"{row['range_width']:>7.2f} {row['breakout_price']:>9.2f} {bo_time:>22} | "
              f"{row['mfe']:>6.1f} {row['mae']:>6.1f} {row['end_excursion']:>+7.1f} {row['mfe_range_ratio']:>6.2f} | "
              f"{fmt(atr)} {fmt(adx)} {fmt(rsi)} {fmt(roc,7,2)} {fmt(mom,7,1)} {fmt(cci,7,1)} {fmt(willr,7,1)} {fmt(macdh,7,2)} "
              f"{fmt(bbw)} {fmt(bbpb)} {fmt(volr)} {fmt(clv)} {fmt(mfi)} {fmt(natr)} "
              f"{fmt(stochk,7,1)} {fmt(stochd,7,1)} {fmt(aroono,7,0)} {fmt(dmp)} {fmt(dmn)}")

        # ---------------------------------------------------------------
        # Part 2: Min/Max indicator ranges for this year
        # ---------------------------------------------------------------
        w(f"\n--- {year} INDICATOR RANGES AT BREAKOUT (Min / Max across all {len(yr)} breakout days) ---")
        w(f"{'Indicator':<28} | {'Min':>12} | {'Max':>12} | {'Mean':>12} | {'Median':>12} | {'Std':>12}")
        w("-" * 100)

        year_ranges = {}
        for col in KEY_INDICATORS:
            vals = yr[col].dropna()
            if len(vals) == 0:
                continue
            mn, mx, mean, med, std = vals.min(), vals.max(), vals.mean(), vals.median(), vals.std()
            w(f"{col:<28} | {mn:>12.4f} | {mx:>12.4f} | {mean:>12.4f} | {med:>12.4f} | {std:>12.4f}")
            year_ranges[col] = {
                'min': round(float(mn), 4), 'max': round(float(mx), 4),
                'mean': round(float(mean), 4), 'median': round(float(med), 4),
                'std': round(float(std), 4), 'count': int(len(vals))
            }

        # Breakout magnitude stats
        w(f"\n--- {year} BREAKOUT MAGNITUDE ---")
        w(f"{'Metric':<28} | {'Min':>12} | {'Max':>12} | {'Mean':>12} | {'Median':>12}")
        w("-" * 85)
        for col in MAGNITUDE_COLS:
            vals = yr[col].dropna()
            if len(vals) == 0:
                continue
            w(f"{col:<28} | {vals.min():>12.2f} | {vals.max():>12.2f} | {vals.mean():>12.2f} | {vals.median():>12.2f}")
            year_ranges[f"magnitude_{col}"] = {
                'min': round(float(vals.min()), 4), 'max': round(float(vals.max()), 4),
                'mean': round(float(vals.mean()), 4), 'median': round(float(vals.median()), 4)
            }

        yearly_ranges[str(year)] = year_ranges

    # ===================================================================
    # OVERALL MIN/MAX ACROSS ALL YEARS
    # ===================================================================
    w(f"\n{'#'*140}")
    w(f"# OVERALL INDICATOR RANGES -- ALL BREAKOUT DAYS 2020-2024 ({len(df)} breakouts)")
    w(f"{'#'*140}")

    w(f"\n{'Indicator':<28} | {'Min':>12} | {'Max':>12} | {'Mean':>12} | {'Median':>12} | {'Std':>12} | {'Count':>6}")
    w("-" * 105)

    overall_ranges = {}
    for col in KEY_INDICATORS:
        vals = df[col].dropna()
        if len(vals) == 0:
            continue
        mn, mx, mean, med, std = vals.min(), vals.max(), vals.mean(), vals.median(), vals.std()
        w(f"{col:<28} | {mn:>12.4f} | {mx:>12.4f} | {mean:>12.4f} | {med:>12.4f} | {std:>12.4f} | {len(vals):>6}")
        overall_ranges[col] = {
            'min': round(float(mn), 4), 'max': round(float(mx), 4),
            'mean': round(float(mean), 4), 'median': round(float(med), 4),
            'std': round(float(std), 4), 'count': int(len(vals))
        }

    w(f"\n--- OVERALL BREAKOUT MAGNITUDE ---")
    w(f"{'Metric':<28} | {'Min':>12} | {'Max':>12} | {'Mean':>12} | {'Median':>12}")
    w("-" * 85)
    for col in MAGNITUDE_COLS:
        vals = df[col].dropna()
        w(f"{col:<28} | {vals.min():>12.2f} | {vals.max():>12.2f} | {vals.mean():>12.2f} | {vals.median():>12.2f}")

    # ===================================================================
    # RELATIVE BREAKOUT VALUE -- How far price typically moves
    # ===================================================================
    w(f"\n{'#'*140}")
    w(f"# RELATIVE BREAKOUT VALUE -- How far price moves after breakout")
    w(f"{'#'*140}")

    w(f"\nBreakout distance in points (MFE = max favorable excursion in 60 min):")
    w(f"{'Year':>6} | {'Side':<6} | {'Avg MFE':>8} | {'Med MFE':>8} | {'Min MFE':>8} | {'Max MFE':>8} | {'Avg End Exc':>11} | {'Avg Range':>9} | {'MFE/Range':>9} | {'Trades':>6}")
    w("-" * 105)

    for year in sorted(df['year'].unique()):
        for side in ['LONG', 'SHORT']:
            sd = df[(df['year'] == year) & (df['side'] == side)]
            if len(sd) == 0:
                continue
            w(f"{year:>6} | {side:<6} | {sd['mfe'].mean():>8.1f} | {sd['mfe'].median():>8.1f} | "
              f"{sd['mfe'].min():>8.1f} | {sd['mfe'].max():>8.1f} | {sd['end_excursion'].mean():>+11.1f} | "
              f"{sd['range_width'].mean():>9.1f} | {sd['mfe_range_ratio'].mean():>9.2f} | {len(sd):>6}")
        # Year total
        yd = df[df['year'] == year]
        w(f"{year:>6} | {'ALL':<6} | {yd['mfe'].mean():>8.1f} | {yd['mfe'].median():>8.1f} | "
          f"{yd['mfe'].min():>8.1f} | {yd['mfe'].max():>8.1f} | {yd['end_excursion'].mean():>+11.1f} | "
          f"{yd['range_width'].mean():>9.1f} | {yd['mfe_range_ratio'].mean():>9.2f} | {len(yd):>6}")
        w("")

    # ===================================================================
    # CORRELATION: Indicator value vs breakout distance
    # ===================================================================
    w(f"\n{'#'*140}")
    w(f"# CORRELATION: Each indicator value vs. breakout magnitude (MFE)")
    w(f"# Pearson r: +1 = more of indicator = bigger breakout, -1 = inverse")
    w(f"{'#'*140}")

    w(f"\n{'Indicator':<28} | {'r vs MFE':>10} | {'r vs EndExc':>12} | {'r vs MFE/R':>10} | {'Interpretation':<50}")
    w("-" * 125)

    correlations = {}
    for col in KEY_INDICATORS:
        vals = df[[col, 'mfe', 'end_excursion', 'mfe_range_ratio']].dropna()
        if len(vals) < 20:
            continue
        r_mfe = vals[col].corr(vals['mfe'])
        r_end = vals[col].corr(vals['end_excursion'])
        r_mfer = vals[col].corr(vals['mfe_range_ratio'])

        # Interpretation
        if abs(r_mfe) < 0.1:
            interp = "No relationship"
        elif r_mfe > 0.3:
            interp = f"STRONG: Higher {col} = bigger breakout"
        elif r_mfe > 0.1:
            interp = f"Moderate: Higher {col} = slightly bigger breakout"
        elif r_mfe < -0.3:
            interp = f"STRONG: Lower {col} = bigger breakout"
        elif r_mfe < -0.1:
            interp = f"Moderate: Lower {col} = slightly bigger breakout"
        else:
            interp = "Weak/no relationship"

        w(f"{col:<28} | {r_mfe:>+10.4f} | {r_end:>+12.4f} | {r_mfer:>+10.4f} | {interp}")
        correlations[col] = {
            'r_mfe': round(float(r_mfe), 4),
            'r_end_excursion': round(float(r_end), 4),
            'r_mfe_range_ratio': round(float(r_mfer), 4),
        }

    # Sort by absolute correlation
    w(f"\n--- TOP CORRELATED INDICATORS (sorted by |r| vs MFE) ---")
    sorted_corr = sorted(correlations.items(), key=lambda x: abs(x[1]['r_mfe']), reverse=True)
    for col, vals in sorted_corr[:15]:
        r = vals['r_mfe']
        direction = "higher = bigger BO" if r > 0 else "lower = bigger BO"
        w(f"  {col:<28} r={r:>+.4f}  ({direction})")

    # ===================================================================
    # BUCKETED ANALYSIS: Group indicator values into buckets, show avg MFE per bucket
    # ===================================================================
    w(f"\n{'#'*140}")
    w(f"# BUCKETED ANALYSIS: Indicator value buckets -> average breakout distance")
    w(f"{'#'*140}")

    bucket_indicators = ['ATRr_14', 'ADX_14', 'rsi', 'cci', 'willr', 'bb_width', 'vol_ratio',
                         'natr', 'mfi', 'range_width', 'mom', 'STOCHk_14_3_3', 'AROONOSC_25', 'DMP_14', 'DMN_14']

    for col in bucket_indicators:
        if col not in df.columns:
            continue
        vals = df[[col, 'mfe', 'mae', 'end_excursion', 'mfe_range_ratio']].dropna()
        if len(vals) < 20:
            continue

        # Create 5 equal-sized buckets (quintiles)
        try:
            vals['bucket'] = pd.qcut(vals[col], 5, duplicates='drop')
        except ValueError:
            continue

        w(f"\n  {col}:")
        w(f"  {'Bucket Range':<35} | {'Count':>5} | {'Avg MFE':>8} | {'Avg MAE':>8} | {'Avg EndExc':>10} | {'Avg MFE/R':>9}")
        w(f"  {'-'*90}")

        for bucket in sorted(vals['bucket'].unique()):
            b = vals[vals['bucket'] == bucket]
            w(f"  {str(bucket):<35} | {len(b):>5} | {b['mfe'].mean():>8.1f} | {b['mae'].mean():>8.1f} | "
              f"{b['end_excursion'].mean():>+10.1f} | {b['mfe_range_ratio'].mean():>9.2f}")

    w(f"\n{'='*140}")
    w(f"END OF REPORT")
    w(f"Full report saved to: {OUT_PATH}")

# Save JSON
output_json = {
    'yearly_ranges': yearly_ranges,
    'overall_ranges': overall_ranges,
    'correlations': correlations,
}
with open(JSON_PATH, 'w') as f:
    json.dump(output_json, f, indent=2, default=str)

print(f"\nJSON: {JSON_PATH}")
print(f"TXT:  {OUT_PATH}")
