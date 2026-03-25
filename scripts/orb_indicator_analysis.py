"""
ORB Indicator Analysis — Identify indicator value ranges that predict successful breakout follow-through.

Approach: Pull OHLCV year-by-year, compute indicators with pandas-ta, process ORBs.
"""

import psycopg2
import pandas as pd
import numpy as np
from datetime import datetime, timedelta, time as dtime
import pytz
import json
import os
import sys

try:
    import pandas_ta as ta
except ImportError:
    print("Installing pandas-ta...")
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pandas-ta'])
    import pandas_ta as ta

ET = pytz.timezone('US/Eastern')
UTC = pytz.utc

SESSION_OPEN_ET = dtime(9, 30)
RANGE_END_ET = dtime(9, 45)

MFE_THRESHOLD_RANGE_MULT = 1.5
MFE_MAE_RATIO_MIN = 1.5
LOOKFORWARD_MINUTES = 60


def connect_questdb():
    return psycopg2.connect(host='localhost', port=8812, user='admin', password='quest', database='qdb')


def fetch_year_ohlcv(conn, symbol, year):
    """Fetch 1-min OHLCV for a single year. Pull full day for indicator warmup."""
    start = f"{year}-01-01"
    end = f"{year}-12-31"

    query = f"""
        SELECT timestamp, open, high, low, close, volume
        FROM ohlcv
        WHERE symbol = '{symbol}'
          AND timestamp >= '{start}T00:00:00.000000Z'
          AND timestamp <= '{end}T23:59:59.000000Z'
        ORDER BY timestamp
    """
    df = pd.read_sql(query, conn, parse_dates=['timestamp'])
    return df


def compute_5min_bars(df_1m):
    """Resample 1-min bars to 5-min bars."""
    df = df_1m.set_index('timestamp')
    df_5m = df.resample('5min').agg({
        'open': 'first',
        'high': 'max',
        'low': 'min',
        'close': 'last',
        'volume': 'sum'
    }).dropna(subset=['open'])
    df_5m = df_5m.reset_index()
    return df_5m


def compute_indicators(df):
    """Compute all required indicators using pandas-ta on 5-min bars."""
    # ATR
    df.ta.atr(length=14, append=True)
    # Normalized ATR
    df['natr'] = df.ta.natr(length=14)

    # ADX + DI
    adx_df = df.ta.adx(length=14)
    if adx_df is not None:
        for col in adx_df.columns:
            df[col] = adx_df[col]

    # RSI
    df['rsi'] = df.ta.rsi(length=14)

    # ROC
    df['roc'] = df.ta.roc(length=10)

    # Momentum
    df['mom'] = df.ta.mom(length=10)

    # MACD
    macd_df = df.ta.macd(fast=12, slow=26, signal=9)
    if macd_df is not None:
        for col in macd_df.columns:
            df[col] = macd_df[col]

    # CCI
    df['cci'] = df.ta.cci(length=20)

    # Williams %R
    df['willr'] = df.ta.willr(length=14)

    # Bollinger Bands
    bb_df = df.ta.bbands(length=20, std=2)
    if bb_df is not None:
        for col in bb_df.columns:
            df[col] = bb_df[col]

    # Stochastic
    stoch_df = df.ta.stoch(k=14, d=3)
    if stoch_df is not None:
        for col in stoch_df.columns:
            df[col] = stoch_df[col]

    # OBV
    df['obv'] = df.ta.obv()

    # MFI
    df['mfi'] = df.ta.mfi(length=14)

    # Aroon
    aroon_df = df.ta.aroon(length=25)
    if aroon_df is not None:
        for col in aroon_df.columns:
            df[col] = aroon_df[col]

    # PPO / APO — these return DataFrames
    ppo_df = df.ta.ppo(fast=12, slow=26)
    if ppo_df is not None:
        for col in ppo_df.columns:
            df[col] = ppo_df[col]

    apo_df = df.ta.apo(fast=12, slow=26)
    if apo_df is not None:
        if isinstance(apo_df, pd.DataFrame):
            for col in apo_df.columns:
                df[col] = apo_df[col]
        else:
            df['apo'] = apo_df

    # TRIX
    trix_result = df.ta.trix(length=15)
    if trix_result is not None:
        if isinstance(trix_result, pd.DataFrame):
            for col in trix_result.columns:
                df[col] = trix_result[col]
        else:
            df['trix'] = trix_result

    # Ultimate Oscillator
    uo_result = df.ta.uo()
    if uo_result is not None:
        if isinstance(uo_result, pd.DataFrame):
            for col in uo_result.columns:
                df[col] = uo_result[col]
        else:
            df['ultosc'] = uo_result

    return df


def find_indicator_columns(df):
    """Find all indicator columns in the dataframe (exclude OHLCV and metadata)."""
    exclude = {'timestamp', 'open', 'high', 'low', 'close', 'volume',
               'ts_et', 'time_et', 'date_et', 'timestamp_utc'}
    return [c for c in df.columns if c not in exclude and df[c].dtype in ['float64', 'float32', 'int64']]


def process_day(day_df, trade_date, indicator_cols):
    """Process a single day for ORB breakout."""
    if len(day_df) < 10:
        return None

    # Opening range
    range_mask = (day_df['time_et'] >= SESSION_OPEN_ET) & (day_df['time_et'] < RANGE_END_ET)
    range_bars = day_df[range_mask]
    if len(range_bars) < 2:
        return None

    range_high = range_bars['high'].max()
    range_low = range_bars['low'].min()
    range_width = range_high - range_low
    if range_width <= 0.25:  # MNQ tick = 0.25, skip if range is basically 0
        return None

    # Derived indicators on breakout bar
    day_df = day_df.copy()
    # BB width and %B
    bbu_cols = [c for c in day_df.columns if 'BBU' in c]
    bbl_cols = [c for c in day_df.columns if 'BBL' in c]
    bbm_cols = [c for c in day_df.columns if 'BBM' in c]
    if bbu_cols and bbl_cols and bbm_cols:
        bbu = day_df[bbu_cols[0]]
        bbl = day_df[bbl_cols[0]]
        bbm = day_df[bbm_cols[0]]
        day_df['bb_width'] = np.where(bbm > 0, (bbu - bbl) / bbm * 100, 0)
        day_df['bb_pct_b'] = np.where((bbu - bbl) > 0, (day_df['close'] - bbl) / (bbu - bbl), 0.5)

    # CLV
    hl = day_df['high'] - day_df['low']
    day_df['clv'] = np.where(hl > 0, (2 * day_df['close'] - day_df['high'] - day_df['low']) / hl, 0)

    # Volume ratio
    day_df['vol_avg_20'] = day_df['volume'].rolling(20, min_periods=1).mean()
    day_df['vol_ratio'] = np.where(day_df['vol_avg_20'] > 0, day_df['volume'] / day_df['vol_avg_20'], 1)

    day_df['range_width'] = range_width
    day_df['range_pct'] = range_width / ((range_high + range_low) / 2) * 100

    # Find breakout
    post_range = day_df[day_df['time_et'] >= RANGE_END_ET]
    if len(post_range) == 0:
        return None

    breakout_idx = None
    breakout_side = None
    for idx in post_range.index:
        c = day_df.loc[idx, 'close']
        if c > range_high:
            breakout_idx = idx
            breakout_side = 'LONG'
            break
        elif c < range_low:
            breakout_idx = idx
            breakout_side = 'SHORT'
            break

    if breakout_idx is None:
        return None

    breakout_price = day_df.loc[breakout_idx, 'close']
    breakout_ts = day_df.loc[breakout_idx, 'ts_et']

    # Follow-through
    post_bo = day_df[day_df.index > breakout_idx].copy()
    if len(post_bo) < 3:
        return None

    cutoff = breakout_ts + timedelta(minutes=LOOKFORWARD_MINUTES)
    post_bo = post_bo[post_bo['ts_et'] <= cutoff]
    if len(post_bo) < 3:
        return None

    if breakout_side == 'LONG':
        mfe = post_bo['high'].max() - breakout_price
        mae = breakout_price - post_bo['low'].min()
        end_exc = post_bo.iloc[-1]['close'] - breakout_price
    else:
        mfe = breakout_price - post_bo['low'].min()
        mae = post_bo['high'].max() - breakout_price
        end_exc = breakout_price - post_bo.iloc[-1]['close']

    # 30-min
    cutoff_30 = breakout_ts + timedelta(minutes=30)
    p30 = post_bo[post_bo['ts_et'] <= cutoff_30]
    if len(p30) > 0:
        mfe_30 = (p30['high'].max() - breakout_price) if breakout_side == 'LONG' else (breakout_price - p30['low'].min())
        mae_30 = (breakout_price - p30['low'].min()) if breakout_side == 'LONG' else (p30['high'].max() - breakout_price)
    else:
        mfe_30, mae_30 = 0, 0

    mfe_rr = mfe / range_width if range_width > 0 else 0
    mfe_mae = mfe / mae if mae > 0 else 99.0
    success = (mfe_rr >= MFE_THRESHOLD_RANGE_MULT) and (mfe_mae >= MFE_MAE_RATIO_MIN)

    result = {
        'date': str(trade_date), 'side': breakout_side,
        'range_high': range_high, 'range_low': range_low,
        'range_width': range_width,
        'range_pct': range_width / ((range_high + range_low) / 2) * 100,
        'breakout_price': breakout_price,
        'breakout_time_et': str(breakout_ts),
        'mfe': mfe, 'mae': mae,
        'mfe_30': mfe_30, 'mae_30': mae_30,
        'mfe_range_ratio': mfe_rr,
        'mfe_mae_ratio': min(mfe_mae, 99.0),
        'end_excursion': end_exc,
        'success': success,
        'bars_after_breakout': len(post_bo),
    }

    # All indicator values at breakout
    all_ind = find_indicator_columns(day_df)
    for col in all_ind:
        val = day_df.loc[breakout_idx, col]
        result[col] = float(val) if pd.notna(val) else np.nan

    return result


def run_analysis(symbol='MNQ', start_year=2020, end_year=2024):
    print(f"ORB Indicator Analysis")
    print(f"Symbol: {symbol} | Years: {start_year}-{end_year}")
    print(f"Opening Range: 15 min (9:30-9:45 ET) | Follow-through: {LOOKFORWARD_MINUTES} min")
    print(f"Success: MFE >= {MFE_THRESHOLD_RANGE_MULT}x range, MFE/MAE >= {MFE_MAE_RATIO_MIN}")
    print("=" * 80)

    conn = connect_questdb()
    all_results = []

    for year in range(start_year, end_year + 1):
        print(f"\n--- {year} ---")

        # Fetch 1-min OHLCV
        print(f"  Fetching 1-min OHLCV for {year}...")
        df_1m = fetch_year_ohlcv(conn, symbol, year)
        print(f"  Rows: {len(df_1m):,}")

        if len(df_1m) == 0:
            continue

        # Resample to 5-min
        print(f"  Resampling to 5-min bars...")
        df_5m = compute_5min_bars(df_1m)
        print(f"  5-min bars: {len(df_5m):,}")

        del df_1m  # free memory

        # Compute indicators
        print(f"  Computing indicators...")
        df_5m = compute_indicators(df_5m)

        # Convert to ET and filter to RTH
        df_5m['ts_et'] = df_5m['timestamp'].dt.tz_localize('UTC').dt.tz_convert(ET)
        df_5m['time_et'] = df_5m['ts_et'].dt.time
        df_5m['date_et'] = df_5m['ts_et'].dt.date

        # Filter to extended RTH (9:00-16:00 ET for warmup + trading)
        df_rth = df_5m[(df_5m['time_et'] >= dtime(9, 0)) & (df_5m['time_et'] < dtime(16, 0))].copy()
        df_rth = df_rth.reset_index(drop=True)
        print(f"  RTH bars: {len(df_rth):,}")

        del df_5m

        # Get indicator columns
        indicator_cols = find_indicator_columns(df_rth)

        # Process each trading day
        trading_days = sorted(df_rth['date_et'].unique())
        year_results = []
        no_bo = 0

        for td in trading_days:
            day_df = df_rth[df_rth['date_et'] == td].reset_index(drop=True)
            try:
                r = process_day(day_df, td, indicator_cols)
                if r:
                    year_results.append(r)
                else:
                    no_bo += 1
            except Exception as e:
                pass  # skip silently

        print(f"  Days: {len(trading_days)} | Breakouts: {len(year_results)} | No breakout: {no_bo}")
        all_results.extend(year_results)

        del df_rth

    conn.close()

    if not all_results:
        print("No breakouts found.")
        return None

    df_results = pd.DataFrame(all_results)
    print(f"\n{'='*80}")
    print(f"TOTAL: {len(df_results)} breakouts across {start_year}-{end_year}")

    print_summary(df_results)
    print_indicator_analysis(df_results)

    # Save
    out_dir = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(out_dir, 'orb_analysis_results.csv')
    df_results.to_csv(csv_path, index=False)
    print(f"\nCSV: {csv_path}")

    optimal = compute_optimal_ranges(df_results)
    json_path = os.path.join(out_dir, 'orb_optimal_ranges.json')
    with open(json_path, 'w') as f:
        json.dump(optimal, f, indent=2, default=str)
    print(f"JSON: {json_path}")

    return df_results


def print_summary(df):
    n = len(df)
    s = int(df['success'].sum())
    f = n - s
    nl = int((df['side'] == 'LONG').sum())
    ns = int((df['side'] == 'SHORT').sum())

    print(f"\n{'='*80}")
    print("BREAKOUT SUMMARY")
    print(f"{'='*80}")
    print(f"Total: {n} | LONG: {nl} ({nl/n*100:.0f}%) | SHORT: {ns} ({ns/n*100:.0f}%)")
    print(f"Success: {s} ({s/n*100:.1f}%) | Failure: {f} ({f/n*100:.1f}%)")

    for side in ['LONG', 'SHORT']:
        sd = df[df['side'] == side]
        if len(sd) == 0:
            continue
        ss = int(sd['success'].sum())
        print(f"\n  {side}: {ss}/{len(sd)} success ({ss/len(sd)*100:.1f}%)")
        print(f"    MFE: {sd['mfe'].mean():.1f} avg, {sd['mfe'].median():.1f} med")
        print(f"    MAE: {sd['mae'].mean():.1f} avg, {sd['mae'].median():.1f} med")
        print(f"    MFE/Range: {sd['mfe_range_ratio'].mean():.2f}x avg")
        print(f"    Range: {sd['range_width'].mean():.1f} avg [{sd['range_width'].quantile(0.1):.1f} - {sd['range_width'].quantile(0.9):.1f}]")


def print_indicator_analysis(df):
    sdf = df[df['success'] == True]
    fdf = df[df['success'] == False]
    indicator_cols = find_indicator_columns(df)

    print(f"\n{'='*80}")
    print(f"INDICATOR ANALYSIS: SUCCESS ({len(sdf)}) vs FAILURE ({len(fdf)})")
    print(f"{'='*80}")

    print(f"\n{'Indicator':<28} | {'Succ Mean':>10} {'(Med)':>8} | {'Fail Mean':>10} {'(Med)':>8} | {'Delta%':>8} | {'Succ P25-P75':>24}")
    print("-" * 116)

    significant = []

    for col in sorted(indicator_cols):
        sv = sdf[col].dropna()
        fv = fdf[col].dropna()
        if len(sv) < 10 or len(fv) < 10:
            continue

        sm, smed = sv.mean(), sv.median()
        fm, fmed = fv.mean(), fv.median()
        base = abs(fm) if abs(fm) > 0.001 else 1
        delta = (sm - fm) / base * 100
        sp25, sp75 = sv.quantile(0.25), sv.quantile(0.75)

        print(f"{col:<28} | {sm:>10.2f} {f'({smed:.1f})':>8} | {fm:>10.2f} {f'({fmed:.1f})':>8} | {delta:>+7.1f}% | [{sp25:>10.2f} - {sp75:>10.2f}]")

        if abs(delta) > 10:
            significant.append({
                'indicator': col, 'delta_pct': delta,
                's_mean': sm, 'f_mean': fm,
                's_p10': sv.quantile(0.10), 's_p25': sp25,
                's_p75': sp75, 's_p90': sv.quantile(0.90),
            })

    if significant:
        significant.sort(key=lambda x: abs(x['delta_pct']), reverse=True)
        print(f"\n{'='*80}")
        print("TOP DISCRIMINATING INDICATORS (>10% delta)")
        print(f"{'='*80}")
        print(f"{'Indicator':<28} | {'Delta%':>8} | {'Succ Mean':>10} | {'Fail Mean':>10} | {'Optimal P10-P90':>28}")
        print("-" * 100)
        for item in significant[:20]:
            print(f"{item['indicator']:<28} | {item['delta_pct']:>+7.1f}% | {item['s_mean']:>10.2f} | {item['f_mean']:>10.2f} | [{item['s_p10']:>10.2f} - {item['s_p90']:>10.2f}]")


def compute_optimal_ranges(df):
    sdf = df[df['success'] == True]
    fdf = df[df['success'] == False]
    indicator_cols = find_indicator_columns(df)

    optimal = {
        'metadata': {
            'total_breakouts': int(len(df)),
            'success_count': int(len(sdf)),
            'failure_count': int(len(fdf)),
            'success_rate': round(len(sdf) / len(df) * 100, 1) if len(df) > 0 else 0,
            'long_count': int((df['side'] == 'LONG').sum()),
            'short_count': int((df['side'] == 'SHORT').sum()),
            'lookforward_minutes': LOOKFORWARD_MINUTES,
            'mfe_threshold': MFE_THRESHOLD_RANGE_MULT,
            'analysis_date': datetime.now().isoformat(),
        },
        'indicators': {},
        'recommended_filters': {}
    }

    for col in indicator_cols:
        sv = sdf[col].dropna()
        fv = fdf[col].dropna()
        if len(sv) < 10:
            continue

        entry = {
            'success_mean': round(float(sv.mean()), 4),
            'success_median': round(float(sv.median()), 4),
            'success_std': round(float(sv.std()), 4),
            'success_p10': round(float(sv.quantile(0.10)), 4),
            'success_p25': round(float(sv.quantile(0.25)), 4),
            'success_p75': round(float(sv.quantile(0.75)), 4),
            'success_p90': round(float(sv.quantile(0.90)), 4),
            'success_count': int(len(sv)),
        }
        if len(fv) >= 10:
            entry['failure_mean'] = round(float(fv.mean()), 4)
            entry['failure_median'] = round(float(fv.median()), 4)
            entry['failure_count'] = int(len(fv))
            base = abs(entry['failure_mean']) if abs(entry['failure_mean']) > 0.001 else 1
            entry['delta_pct'] = round((entry['success_mean'] - entry['failure_mean']) / base * 100, 2)

        optimal['indicators'][col] = entry

    # Recommended filters
    for col in indicator_cols:
        if col in optimal['indicators']:
            ind = optimal['indicators'][col]
            if 'delta_pct' in ind and abs(ind['delta_pct']) > 5:
                optimal['recommended_filters'][col] = {
                    'min': ind['success_p25'],
                    'max': ind['success_p75'],
                    'p10': ind['success_p10'],
                    'p90': ind['success_p90'],
                    'delta_pct': ind.get('delta_pct', 0),
                }

    return optimal


def find_indicator_columns(df):
    exclude = {'timestamp', 'open', 'high', 'low', 'close', 'volume',
               'ts_et', 'time_et', 'date_et', 'timestamp_utc', 'vol_avg_20'}
    result = []
    for c in df.columns:
        if c in exclude:
            continue
        if c in ('date', 'side', 'range_high', 'range_low', 'breakout_price',
                 'breakout_time_et', 'mfe', 'mae', 'mfe_30', 'mae_30',
                 'mfe_range_ratio', 'mfe_mae_ratio', 'end_excursion',
                 'success', 'bars_after_breakout'):
            continue
        if df[c].dtype in ['float64', 'float32', 'int64', 'int32']:
            result.append(c)
    return result


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--symbol', default='MNQ')
    parser.add_argument('--start-year', type=int, default=2020)
    parser.add_argument('--end-year', type=int, default=2024)
    parser.add_argument('--lookforward', type=int, default=60)
    parser.add_argument('--mfe-threshold', type=float, default=1.5)
    parser.add_argument('--mfe-mae-ratio', type=float, default=1.5)
    args = parser.parse_args()

    LOOKFORWARD_MINUTES = args.lookforward
    MFE_THRESHOLD_RANGE_MULT = args.mfe_threshold
    MFE_MAE_RATIO_MIN = args.mfe_mae_ratio

    run_analysis(args.symbol, args.start_year, args.end_year)
