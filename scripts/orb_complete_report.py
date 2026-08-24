"""
ORB Complete Report.
- Every breakout day per year with all indicator values
- Min/Max indicator ranges per year
- Total trading days vs breakout days
- Breakout magnitude and how indicators relate to distance
"""

import os

import numpy as np
import pandas as pd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
df = pd.read_csv(SCRIPT_DIR + '/orb_analysis_results.csv')
df['year'] = pd.to_datetime(df['date']).dt.year

# RTH trading days per year from the analysis run (days with 9:00-16:00 ET 5-min bars)
# These are actual CME futures trading days, not NYSE calendar
trading_days_per_year = {2020: 292, 2021: 292, 2022: 292, 2023: 291, 2024: 293}

# Key indicators
KEY_IND = [
    ('ATRr_14', 'ATR (14)'),
    ('ADX_14', 'ADX (14)'),
    ('rsi', 'RSI (14)'),
    ('roc', 'ROC (10)'),
    ('mom', 'Momentum (10)'),
    ('MACD_12_26_9', 'MACD'),
    ('MACDh_12_26_9', 'MACD Histogram'),
    ('MACDs_12_26_9', 'MACD Signal'),
    ('cci', 'CCI (20)'),
    ('willr', 'Williams %R (14)'),
    ('bb_width', 'BB Width %'),
    ('bb_pct_b', 'BB %B'),
    ('STOCHk_14_3_3', 'Stoch %K'),
    ('STOCHd_14_3_3', 'Stoch %D'),
    ('mfi', 'MFI (14)'),
    ('natr', 'NATR (14)'),
    ('vol_ratio', 'Volume Ratio'),
    ('clv', 'CLV'),
    ('DMP_14', 'DM+'),
    ('DMN_14', 'DM-'),
    ('AROONU_25', 'Aroon Up'),
    ('AROOND_25', 'Aroon Down'),
    ('AROONOSC_25', 'Aroon Osc'),
    ('range_width', 'Range Width (pts)'),
    ('range_pct', 'Range Width (%)'),
]

KEY_IND = [(c, n) for c, n in KEY_IND if c in df.columns]

OUT = os.path.join(SCRIPT_DIR, 'orb_complete_report.txt')

with open(OUT, 'w', encoding='utf-8') as f:
    def w(line=''):
        f.write(line + '\n')
        print(line)

    w("=" * 160)
    w("ORB COMPLETE REPORT -- MNQ 2020-2024")
    w("Every breakout day, indicator min/max ranges, breakout magnitude, indicator-to-distance relationships")
    w("=" * 160)

    # ==================================================================
    # OVERVIEW
    # ==================================================================
    w("\n" + "=" * 80)
    w("OVERVIEW: TRADING DAYS vs BREAKOUT DAYS")
    w("=" * 80)
    w(f"\n{'Year':>6} | {'Trading Days':>13} | {'Breakout Days':>14} | {'Breakout %':>10} | {'LONG':>6} | {'SHORT':>6} | {'No Breakout':>12}")
    w("-" * 85)

    for year in sorted(df['year'].unique()):
        yr = df[df['year'] == year]
        td = trading_days_per_year.get(year, 252)
        nl = (yr['side'] == 'LONG').sum()
        ns = (yr['side'] == 'SHORT').sum()
        nb = td - len(yr)
        w(f"{year:>6} | {td:>13} | {len(yr):>14} | {len(yr)/td*100:>9.1f}% | {nl:>6} | {ns:>6} | {nb:>12}")

    total_td = sum(trading_days_per_year.values())
    total_bo = len(df)
    w(f"{'TOTAL':>6} | {total_td:>13} | {total_bo:>14} | {total_bo/total_td*100:>9.1f}% | {(df['side']=='LONG').sum():>6} | {(df['side']=='SHORT').sum():>6} | {total_td - total_bo:>12}")

    # ==================================================================
    # PER YEAR: EVERY BREAKOUT + MIN/MAX RANGES
    # ==================================================================
    for year in sorted(df['year'].unique()):
        yr = df[df['year'] == year].sort_values('date')
        td = trading_days_per_year.get(year, 252)

        w(f"\n\n{'='*160}")
        w(f"YEAR {year} -- {len(yr)} BREAKOUTS out of {td} TRADING DAYS ({len(yr)/td*100:.1f}%)")
        w(f"{'='*160}")

        # --- Every breakout day ---
        w(f"\n{'Date':<12} {'Side':<6} {'RngHi':>9} {'RngLo':>9} {'RngW':>7} {'BkOut':>9} {'Time':>8} | "
          f"{'MFE':>6} {'MAE':>6} {'EndEx':>7} | "
          f"{'ATR':>6} {'ADX':>6} {'RSI':>6} {'ROC':>7} {'MOM':>7} | "
          f"{'CCI':>7} {'WillR':>7} {'MACDh':>7} {'MACD':>7} | "
          f"{'BBW':>6} {'BB%B':>6} {'StK':>6} {'StD':>6} | "
          f"{'MFI':>6} {'NATR':>6} {'VolR':>6} {'CLV':>6} | "
          f"{'DM+':>6} {'DM-':>6} {'ArOsc':>6}")
        w("-" * 230)

        for _, row in yr.iterrows():
            def g(col, d=1):
                v = row.get(col, np.nan)
                if pd.isna(v): return f"{'--':>6}"
                if d == 0: return f"{v:>6.0f}"
                if d == 2: return f"{v:>7.2f}"
                return f"{v:>6.{d}f}"

            bt = str(row.get('breakout_time_et', '')).split(' ')[-1][:8] if pd.notna(row.get('breakout_time_et')) else '--'

            w(f"{row['date']:<12} {row['side']:<6} {row['range_high']:>9.2f} {row['range_low']:>9.2f} {row['range_width']:>7.2f} "
              f"{row['breakout_price']:>9.2f} {bt:>8} | "
              f"{row['mfe']:>6.1f} {row['mae']:>6.1f} {row['end_excursion']:>+7.1f} | "
              f"{g('ATRr_14')} {g('ADX_14')} {g('rsi')} {g('roc',2)} {g('mom')} | "
              f"{g('cci')} {g('willr')} {g('MACDh_12_26_9',2)} {g('MACD_12_26_9',2)} | "
              f"{g('bb_width')} {g('bb_pct_b')} {g('STOCHk_14_3_3')} {g('STOCHd_14_3_3')} | "
              f"{g('mfi')} {g('natr')} {g('vol_ratio')} {g('clv')} | "
              f"{g('DMP_14')} {g('DMN_14')} {g('AROONOSC_25',0)}")

        # --- MIN / MAX indicator ranges for this year ---
        w(f"\n{year} INDICATOR MIN/MAX AT BREAKOUT ({len(yr)} breakout days out of {td} total):")
        w(f"  These are the min and max values each indicator had when a breakout occurred.")
        w(f"  {'Indicator':<22} | {'MIN':>12} | {'MAX':>12} | {'MEAN':>12} | {'MEDIAN':>12}")
        w(f"  {'-'*80}")
        for col, name in KEY_IND:
            vals = yr[col].dropna()
            if len(vals) == 0:
                continue
            w(f"  {name:<22} | {vals.min():>12.4f} | {vals.max():>12.4f} | {vals.mean():>12.4f} | {vals.median():>12.4f}")

        # --- Breakout magnitude ---
        w(f"\n{year} BREAKOUT MAGNITUDE (how far price moved after breakout):")
        w(f"  {'Metric':<22} | {'MIN':>10} | {'MAX':>10} | {'AVG':>10} | {'MEDIAN':>10}")
        w(f"  {'-'*72}")
        for label, col in [('MFE (60 min)', 'mfe'), ('MAE (60 min)', 'mae'),
                            ('MFE (30 min)', 'mfe_30'), ('MAE (30 min)', 'mae_30'),
                            ('End Excursion', 'end_excursion'), ('MFE / Range', 'mfe_range_ratio')]:
            vals = yr[col].dropna()
            w(f"  {label:<22} | {vals.min():>10.2f} | {vals.max():>10.2f} | {vals.mean():>10.2f} | {vals.median():>10.2f}")

    # ==================================================================
    # OVERALL MIN/MAX ACROSS ALL 5 YEARS
    # ==================================================================
    w(f"\n\n{'='*160}")
    w(f"OVERALL MIN/MAX -- ALL {len(df)} BREAKOUTS ACROSS 2020-2024 ({total_bo} out of {total_td} trading days = {total_bo/total_td*100:.1f}%)")
    w(f"{'='*160}")

    w(f"\n  {'Indicator':<22} | {'MIN':>12} | {'MAX':>12} | {'MEAN':>12} | {'MEDIAN':>12}")
    w(f"  {'-'*80}")
    for col, name in KEY_IND:
        vals = df[col].dropna()
        if len(vals) == 0:
            continue
        w(f"  {name:<22} | {vals.min():>12.4f} | {vals.max():>12.4f} | {vals.mean():>12.4f} | {vals.median():>12.4f}")

    w(f"\n  Overall Breakout Magnitude:")
    w(f"  {'Metric':<22} | {'MIN':>10} | {'MAX':>10} | {'AVG':>10} | {'MEDIAN':>10}")
    w(f"  {'-'*72}")
    for label, col in [('MFE (60 min)', 'mfe'), ('MAE (60 min)', 'mae'),
                        ('End Excursion', 'end_excursion'), ('MFE / Range', 'mfe_range_ratio')]:
        vals = df[col].dropna()
        w(f"  {label:<22} | {vals.min():>10.2f} | {vals.max():>10.2f} | {vals.mean():>10.2f} | {vals.median():>10.2f}")

    # ==================================================================
    # CORRELATION: indicator value vs breakout distance
    # ==================================================================
    w(f"\n\n{'='*160}")
    w(f"HOW EACH INDICATOR RELATES TO BREAKOUT DISTANCE")
    w(f"Pearson r: positive = higher indicator value correlates with bigger breakout movement")
    w(f"{'='*160}")

    w(f"\n  {'Indicator':<22} | {'r vs MFE':>10} | {'r vs EndExc':>12} | {'Strength':<15} | {'Meaning':<60}")
    w(f"  {'-'*125}")

    corr_data = []
    for col, name in KEY_IND:
        vals = df[[col, 'mfe', 'end_excursion']].dropna()
        if len(vals) < 20:
            continue
        r_mfe = vals[col].corr(vals['mfe'])
        r_end = vals[col].corr(vals['end_excursion'])

        ar = abs(r_mfe)
        if ar >= 0.3: strength = "STRONG"
        elif ar >= 0.15: strength = "MODERATE"
        elif ar >= 0.1: strength = "WEAK"
        else: strength = "NONE"

        if ar < 0.1:
            meaning = "No meaningful relationship to breakout distance"
        elif r_mfe > 0:
            meaning = f"Higher {name} -> price travels further after breakout"
        else:
            meaning = f"Lower {name} -> price travels further after breakout"

        w(f"  {name:<22} | {r_mfe:>+10.4f} | {r_end:>+12.4f} | {strength:<15} | {meaning}")
        corr_data.append((name, col, r_mfe, r_end, strength))

    # Top correlations sorted
    corr_data.sort(key=lambda x: abs(x[2]), reverse=True)
    w(f"\n  Ranked by strength:")
    for i, (name, col, r, re, s) in enumerate(corr_data, 1):
        dir_str = "higher = further" if r > 0 else "lower = further"
        w(f"  {i:>3}. {name:<22} r = {r:>+.4f}  ({dir_str})")

    # ==================================================================
    # CORRELATION BY SIDE: LONG vs SHORT separately
    # ==================================================================
    w(f"\n\n{'='*160}")
    w(f"CORRELATION BY SIDE -- LONG vs SHORT (r vs MFE)")
    w(f"Indicators that show OPPOSITE correlation by side are directionally confirming signals.")
    w(f"{'='*160}")

    w(f"\n  {'Indicator':<22} | {'ALL r':>8} | {'LONG r':>8} (n={len(df[df['side']=='LONG']):>3}) | {'SHORT r':>8} (n={len(df[df['side']=='SHORT']):>3}) | {'Signal':<40}")
    w(f"  {'-'*120}")

    for col, name in KEY_IND:
        all_v = df[[col, 'mfe']].dropna()
        long_v = df[df['side'] == 'LONG'][[col, 'mfe']].dropna()
        short_v = df[df['side'] == 'SHORT'][[col, 'mfe']].dropna()
        if len(long_v) < 10 or len(short_v) < 10:
            continue

        r_all = all_v[col].corr(all_v['mfe'])
        r_long = long_v[col].corr(long_v['mfe'])
        r_short = short_v[col].corr(short_v['mfe'])

        note = ""
        if (r_long > 0 and r_short < 0) or (r_long < 0 and r_short > 0):
            note = "OPPOSITE -- directionally confirming"
        elif abs(r_long) > 0.3 and abs(r_short) > 0.3:
            note = "STRONG both sides"
        elif abs(r_long - r_short) > 0.2:
            note = "Stronger for " + ("LONG" if abs(r_long) > abs(r_short) else "SHORT")

        w(f"  {name:<22} | {r_all:>+8.4f} | {r_long:>+8.4f}       | {r_short:>+8.4f}       | {note}")

    # r vs END EXCURSION by side
    w(f"\n  {'Indicator':<22} | {'ALL r':>8} | {'LONG r':>8}       | {'SHORT r':>8}       | {'Signal':<40}")
    w(f"  {'-'*120}")
    w(f"  (r vs End Excursion -- positive = price stayed in breakout direction after 60 min)")

    for col, name in KEY_IND:
        all_v = df[[col, 'end_excursion']].dropna()
        long_v = df[df['side'] == 'LONG'][[col, 'end_excursion']].dropna()
        short_v = df[df['side'] == 'SHORT'][[col, 'end_excursion']].dropna()
        if len(long_v) < 10 or len(short_v) < 10:
            continue

        r_all = all_v[col].corr(all_v['end_excursion'])
        r_long = long_v[col].corr(long_v['end_excursion'])
        r_short = short_v[col].corr(short_v['end_excursion'])

        note = ""
        if (r_long > 0 and r_short < 0) or (r_long < 0 and r_short > 0):
            note = "OPPOSITE by side"

        w(f"  {name:<22} | {r_all:>+8.4f} | {r_long:>+8.4f}       | {r_short:>+8.4f}       | {note}")

    # ==================================================================
    # BUCKETED: indicator quintiles vs avg breakout distance
    # ==================================================================
    w(f"\n\n{'='*160}")
    w(f"INDICATOR BUCKETS vs BREAKOUT DISTANCE")
    w(f"Each indicator split into 5 equal groups (quintiles). Shows avg MFE per group.")
    w(f"{'='*160}")

    for col, name in KEY_IND:
        vals = df[[col, 'mfe', 'mae', 'end_excursion', 'mfe_range_ratio']].dropna()
        if len(vals) < 25:
            continue
        try:
            vals['bucket'] = pd.qcut(vals[col], 5, duplicates='drop')
        except ValueError:
            continue

        w(f"\n  {name}:")
        w(f"  {'Value Range':<40} | {'N':>4} | {'Avg MFE':>8} | {'Avg MAE':>8} | {'Avg EndExc':>10} | {'Avg MFE/Rng':>11}")
        w(f"  {'-'*95}")

        for bucket in sorted(vals['bucket'].unique()):
            b = vals[vals['bucket'] == bucket]
            w(f"  {str(bucket):<40} | {len(b):>4} | {b['mfe'].mean():>8.1f} | {b['mae'].mean():>8.1f} | "
              f"{b['end_excursion'].mean():>+10.1f} | {b['mfe_range_ratio'].mean():>11.2f}")

    w(f"\n{'='*160}")
    w(f"END OF REPORT")
    w(f"{'='*160}")

print(f"\nReport: {OUT}")
