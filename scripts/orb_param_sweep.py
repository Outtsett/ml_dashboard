"""
ORB Parameter Sweep — Find optimal thresholds using the new trailing-from-entry logic.
Tests: score threshold, trail ATR mult, trail decay, BB width, volume threshold, ADX min.
"""

import os
import sys
from datetime import time as dtime

import numpy as np
import pandas as pd
import psycopg2
import pytz

try:
    # Imported for its side effect: registers the `.ta` accessor on DataFrame.
    # The `ta` name itself is never referenced — usage is `df.ta.atr(...)`.
    import pandas_ta as ta  # noqa: F401
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pandas-ta'])

ET = pytz.timezone('US/Eastern')
SESSION_OPEN = dtime(9, 30)
RANGE_END = dtime(9, 45)
TRADING_END = dtime(11, 30)
EOD_FLATTEN = dtime(15, 50)

# Preload data once
def load_all_data():
    conn = psycopg2.connect(host='localhost', port=8812, user='admin', password='quest', database='qdb')
    all_days = {}

    for year in range(2020, 2025):
        print(f"Loading {year}...")
        query = f"""
            SELECT timestamp, open, high, low, close, volume
            FROM ohlcv WHERE symbol = 'MNQ'
              AND timestamp >= '{year}-01-01T00:00:00.000000Z'
              AND timestamp <= '{year}-12-31T23:59:59.000000Z'
            ORDER BY timestamp
        """
        df_1m = pd.read_sql(query, conn, parse_dates=['timestamp'])
        d = df_1m.set_index('timestamp')
        df_5m = d.resample('5min').agg({
            'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'volume': 'sum'
        }).dropna(subset=['open']).reset_index()
        del df_1m

        # Add indicators
        df_5m.ta.atr(length=14, append=True)
        adx_df = df_5m.ta.adx(length=14)
        if adx_df is not None:
            for c in adx_df.columns: df_5m[c] = adx_df[c]
        df_5m['roc'] = df_5m.ta.roc(length=10)
        df_5m['obv'] = df_5m.ta.obv()
        macd_df = df_5m.ta.macd(fast=12, slow=26, signal=9)
        if macd_df is not None:
            for c in macd_df.columns: df_5m[c] = macd_df[c]
        bb_df = df_5m.ta.bbands(length=20, std=2)
        if bb_df is not None:
            for c in bb_df.columns: df_5m[c] = bb_df[c]

        df_5m['ts_et'] = df_5m['timestamp'].dt.tz_localize('UTC').dt.tz_convert(ET)
        df_5m['time_et'] = df_5m['ts_et'].dt.time
        df_5m['date_et'] = df_5m['ts_et'].dt.date

        df_rth = df_5m[(df_5m['time_et'] >= dtime(9, 0)) & (df_5m['time_et'] < dtime(16, 0))].copy().reset_index(drop=True)
        del df_5m

        # Precompute per-day
        bbu_cols = [c for c in df_rth.columns if 'BBU' in c]
        bbl_cols = [c for c in df_rth.columns if 'BBL' in c]
        bbm_cols = [c for c in df_rth.columns if 'BBM' in c]
        macdh_cols = [c for c in df_rth.columns if 'MACDh' in c]

        for td in sorted(df_rth['date_et'].unique()):
            day = df_rth[df_rth['date_et'] == td].copy().reset_index(drop=True)
            if len(day) < 15:
                continue

            # VWAP
            tp = (day['high'] + day['low'] + day['close']) / 3.0
            day['vwap'] = (tp * day['volume']).cumsum() / day['volume'].cumsum().replace(0, np.nan)
            day['vol_avg'] = day['volume'].rolling(20, min_periods=1).mean()
            day['vol_ratio'] = np.where(day['vol_avg'] > 0, day['volume'] / day['vol_avg'], 1)

            if bbu_cols and bbl_cols and bbm_cols:
                bbu = day[bbu_cols[0]]; bbl = day[bbl_cols[0]]; bbm = day[bbm_cols[0]]
                day['bb_width'] = np.where(bbm > 0, (bbu - bbl) / bbm * 100, 0)
                day['bb_pctb'] = np.where((bbu - bbl) > 0, (day['close'] - bbl) / (bbu - bbl), 0.5)
            else:
                day['bb_width'] = 0; day['bb_pctb'] = 0.5

            hl = day['high'] - day['low']
            day['clv'] = np.where(hl > 0, (2 * day['close'] - day['high'] - day['low']) / hl, 0)
            day['macdh'] = day[macdh_cols[0]] if macdh_cols else np.nan

            all_days[str(td)] = day

    conn.close()
    print(f"Loaded {len(all_days)} trading days")
    return all_days


def simulate(all_days, p):
    """Run the strategy with given parameters across all days."""
    trades = []

    for date_str, day_df in all_days.items():
        range_mask = (day_df['time_et'] >= SESSION_OPEN) & (day_df['time_et'] < RANGE_END)
        range_bars = day_df[range_mask]
        if len(range_bars) < 2: continue

        range_high = range_bars['high'].max()
        range_low = range_bars['low'].min()
        range_width = range_high - range_low
        if range_width <= 0: continue

        trades_today = 0
        in_pos = False
        entry_price = entry_atr = extreme = 0
        entry_side = None
        entry_bar = 0
        is_rev = False

        post_range = day_df[day_df['time_et'] >= RANGE_END]

        for i, idx in enumerate(post_range.index):
            bar = day_df.loc[idx]
            t = bar['time_et']

            # EOD flatten
            if t >= EOD_FLATTEN and in_pos:
                pnl = (bar['close'] - entry_price) if entry_side == 'LONG' else (entry_price - bar['close'])
                trades.append({'pnl': pnl, 'exit': 'EOD', 'type': 'rev' if is_rev else 'bo', 'side': entry_side, 'date': date_str})
                in_pos = False
                break
            if t >= EOD_FLATTEN: break

            if in_pos:
                bars_held = i - entry_bar

                # Update extreme
                if entry_side == 'LONG':
                    if bar['high'] > extreme: extreme = bar['high']
                else:
                    if bar['low'] < extreme: extreme = bar['low']

                # Time-decay trail
                minutes_in = bars_held * 5  # 5-min bars
                decay = max(p['trail_floor'], p['trail_mult'] - (minutes_in / p['decay_minutes']) * (p['trail_mult'] - p['trail_floor']))

                atr_now = bar.get('ATRr_14', np.nan)
                if pd.isna(atr_now) or atr_now <= 0: atr_now = entry_atr
                trail = decay * atr_now

                if entry_side == 'LONG':
                    stop = extreme - trail
                    if bar['low'] <= stop:
                        pnl = stop - entry_price
                        trades.append({'pnl': pnl, 'exit': 'TRAIL', 'type': 'rev' if is_rev else 'bo', 'side': entry_side, 'date': date_str})
                        in_pos = False
                        continue
                else:
                    stop = extreme + trail
                    if bar['high'] >= stop:
                        pnl = entry_price - stop
                        trades.append({'pnl': pnl, 'exit': 'TRAIL', 'type': 'rev' if is_rev else 'bo', 'side': entry_side, 'date': date_str})
                        in_pos = False
                        continue
                continue

            # Entry logic
            if t >= TRADING_END: continue
            if trades_today >= 2: continue

            c = bar['close']
            atr_val = bar.get('ATRr_14', np.nan)
            if pd.isna(atr_val) or atr_val <= 0: continue

            broke_above = c > range_high
            broke_below = c < range_low
            if not broke_above and not broke_below: continue

            vol_ratio = bar.get('vol_ratio', 0)
            if bar['volume'] <= bar.get('vol_avg', 0) * p['vol_thresh']: continue

            # Score
            adx = bar.get('ADX_14', np.nan)
            bb_w = bar.get('bb_width', 0)
            bb_b = bar.get('bb_pctb', 0.5)
            roc = bar.get('roc', np.nan)
            roc_prev_idx = max(day_df.index[0], idx - 1)
            roc_prev = day_df.loc[roc_prev_idx, 'roc'] if 'roc' in day_df.columns else np.nan
            clv = bar.get('clv', 0)
            macdh = bar.get('macdh', np.nan)
            vwap = bar.get('vwap', c)
            obv_cur = bar.get('obv', np.nan)
            obv_5 = day_df.loc[max(day_df.index[0], idx - 5), 'obv'] if 'obv' in day_df.columns else np.nan

            score = 0
            if bb_w > 0 and bb_w <= p['bb_width_max']: score += 3
            if pd.notna(adx) and adx >= p['adx_min']: score += 2
            if vol_ratio >= p['vol_thresh']: score += 2
            roc_valid = pd.notna(roc) and pd.notna(roc_prev)
            if roc_valid:
                if broke_above and roc > 0 and roc >= roc_prev: score += 2
                elif broke_below and roc < 0 and roc <= roc_prev: score += 2
            if broke_above and bb_b >= p['long_bbpctb'][0] and bb_b <= p['long_bbpctb'][1]: score += 1
            elif broke_below and bb_b >= p['short_bbpctb'][0] and bb_b <= p['short_bbpctb'][1]: score += 1

            follow = score >= p['score_thresh']
            obv_rising = pd.notna(obv_cur) and pd.notna(obv_5) and obv_cur > obv_5
            obv_falling = pd.notna(obv_cur) and pd.notna(obv_5) and obv_cur < obv_5

            if follow:
                if broke_above and (not p['use_vwap'] or c > vwap) and clv >= p['min_clv'] and obv_rising:
                    entry_side = 'LONG'; entry_price = c; entry_atr = atr_val
                    extreme = bar['high']; is_rev = False; in_pos = True
                    trades_today += 1; entry_bar = i
                elif broke_below and (not p['use_vwap'] or c < vwap) and clv <= -p['min_clv'] and obv_falling:
                    entry_side = 'SHORT'; entry_price = c; entry_atr = atr_val
                    extreme = bar['low']; is_rev = False; in_pos = True
                    trades_today += 1; entry_bar = i
            elif p['reversal']:
                clv_rej = abs(clv) < p['min_clv']
                if broke_above and pd.notna(macdh) and macdh < 0 and clv_rej:
                    entry_side = 'SHORT'; entry_price = c; entry_atr = atr_val
                    extreme = bar['low']; is_rev = True; in_pos = True
                    trades_today += 1; entry_bar = i
                elif broke_below and pd.notna(macdh) and macdh > 0 and clv_rej:
                    entry_side = 'LONG'; entry_price = c; entry_atr = atr_val
                    extreme = bar['high']; is_rev = True; in_pos = True
                    trades_today += 1; entry_bar = i

        if in_pos:
            last = day_df.iloc[-1]
            pnl = (last['close'] - entry_price) if entry_side == 'LONG' else (entry_price - last['close'])
            trades.append({'pnl': pnl, 'exit': 'EOD', 'type': 'rev' if is_rev else 'bo', 'side': entry_side, 'date': date_str})

    return pd.DataFrame(trades) if trades else pd.DataFrame()


def evaluate(df):
    if len(df) == 0:
        return {'trades': 0, 'pnl': 0, 'win_rate': 0, 'avg_pnl': 0, 'eod_count': 0, 'eod_pnl': 0}
    wins = (df['pnl'] > 0).sum()
    eod = df[df['exit'] == 'EOD']
    return {
        'trades': len(df),
        'pnl': df['pnl'].sum(),
        'win_rate': wins / len(df) * 100,
        'avg_pnl': df['pnl'].mean(),
        'max_loss': df['pnl'].min(),
        'eod_count': len(eod),
        'eod_pnl': eod['pnl'].sum() if len(eod) > 0 else 0,
    }


def run():
    all_days = load_all_data()

    # Parameter grid
    configs = []

    # Focused sweep on highest-impact params
    for score_thresh in [5, 6, 7, 8]:
        for trail_mult in [1.0, 1.5, 2.0]:
            for trail_floor in [0.3, 0.5]:
                for decay_min in [60, 120]:
                    for bb_width_max in [0.4, 0.55, 1.0]:
                        for vol_thresh in [0.6, 0.8]:
                            for adx_min in [15, 20]:
                                configs.append({
                                    'score_thresh': score_thresh,
                                    'trail_mult': trail_mult,
                                    'trail_floor': trail_floor,
                                    'decay_minutes': decay_min,
                                    'bb_width_max': bb_width_max,
                                    'vol_thresh': vol_thresh,
                                    'adx_min': adx_min,
                                    'min_clv': 0.5,
                                    'long_bbpctb': (0.53, 0.81),
                                    'short_bbpctb': (0.04, 0.40),
                                    'use_vwap': True,
                                    'reversal': True,
                                })

    print(f"Testing {len(configs)} parameter combinations...")

    results = []
    for i, cfg in enumerate(configs):
        if i % 500 == 0:
            print(f"  {i}/{len(configs)}...")
        df = simulate(all_days, cfg)
        ev = evaluate(df)
        ev.update({k: v for k, v in cfg.items() if not isinstance(v, tuple) and not isinstance(v, bool)})
        ev['reversal'] = cfg['reversal']
        results.append(ev)

    rdf = pd.DataFrame(results)
    rdf = rdf[rdf['trades'] >= 20]  # minimum 20 trades

    # Sort by total PnL
    rdf = rdf.sort_values('pnl', ascending=False)

    print(f"\n{'='*120}")
    print(f"TOP 20 CONFIGURATIONS BY TOTAL PnL (min 20 trades)")
    print(f"{'='*120}")
    print(f"{'PnL':>8} {'Trades':>6} {'Win%':>5} {'AvgPnL':>7} {'EOD#':>5} {'EOD$':>7} | {'Score':>5} {'Trail':>5} {'Floor':>5} {'Decay':>5} {'BBW':>5} {'Vol':>5} {'ADX':>5}")
    print("-" * 120)

    for _, r in rdf.head(20).iterrows():
        print(f"{r['pnl']:>+8.1f} {r['trades']:>6.0f} {r['win_rate']:>5.1f} {r['avg_pnl']:>+7.2f} {r['eod_count']:>5.0f} {r['eod_pnl']:>+7.1f} | "
              f"{r['score_thresh']:>5.0f} {r['trail_mult']:>5.2f} {r['trail_floor']:>5.2f} {r['decay_minutes']:>5.0f} {r['bb_width_max']:>5.2f} {r['vol_thresh']:>5.2f} {r['adx_min']:>5.0f}")

    # Also show top by avg PnL
    rdf2 = rdf.sort_values('avg_pnl', ascending=False)
    print(f"\n{'='*120}")
    print(f"TOP 20 BY AVG PnL PER TRADE")
    print(f"{'='*120}")
    print(f"{'PnL':>8} {'Trades':>6} {'Win%':>5} {'AvgPnL':>7} {'EOD#':>5} {'EOD$':>7} | {'Score':>5} {'Trail':>5} {'Floor':>5} {'Decay':>5} {'BBW':>5} {'Vol':>5} {'ADX':>5}")
    print("-" * 120)

    for _, r in rdf2.head(20).iterrows():
        print(f"{r['pnl']:>+8.1f} {r['trades']:>6.0f} {r['win_rate']:>5.1f} {r['avg_pnl']:>+7.2f} {r['eod_count']:>5.0f} {r['eod_pnl']:>+7.1f} | "
              f"{r['score_thresh']:>5.0f} {r['trail_mult']:>5.2f} {r['trail_floor']:>5.2f} {r['decay_minutes']:>5.0f} {r['bb_width_max']:>5.2f} {r['vol_thresh']:>5.2f} {r['adx_min']:>5.0f}")

    # Save
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'orb_param_sweep.csv')
    rdf.to_csv(out, index=False)
    print(f"\nFull results: {out}")


if __name__ == '__main__':
    run()
