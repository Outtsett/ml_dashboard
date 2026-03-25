"""
ORB Strategy Backtest — Simulates the full strategy logic on historical data.
No stop loss. Trailing stop + TP + EOD flatten only.
Identifies gaps in the logic.
"""

import psycopg2
import pandas as pd
import numpy as np
from datetime import timedelta, time as dtime
import pytz
import os
import sys

try:
    import pandas_ta as ta
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'pandas-ta'])
    import pandas_ta as ta

ET = pytz.timezone('US/Eastern')
SESSION_OPEN = dtime(9, 30)
RANGE_END = dtime(9, 45)
TRADING_END = dtime(11, 30)
EOD_FLATTEN = dtime(15, 50)

# Strategy parameters matching the C# code
PARAMS = {
    'range_minutes': 15,
    'volume_threshold': 0.8,
    'adx_min': 20,
    'roc_min': 0.0,
    'min_clv': 0.5,
    'bb_width_max': 0.55,
    'long_bbpctb': (0.53, 0.81),
    'short_bbpctb': (0.04, 0.40),
    'score_threshold': 7,
    'breakout_reversal': True,
    'trail_atr_mult': 1.5,
    'breakeven_atr_mult': 1.0,
    'tp_momentum_mult': 2.0,
    'tp_min_atr': 1.0,
    'max_trades_per_day': 2,
    'use_vwap': True,
}


def fetch_year(conn, symbol, year):
    query = f"""
        SELECT timestamp, open, high, low, close, volume
        FROM ohlcv WHERE symbol = '{symbol}'
          AND timestamp >= '{year}-01-01T00:00:00.000000Z'
          AND timestamp <= '{year}-12-31T23:59:59.000000Z'
        ORDER BY timestamp
    """
    return pd.read_sql(query, conn, parse_dates=['timestamp'])


def resample_5min(df):
    d = df.set_index('timestamp')
    d5 = d.resample('5min').agg({
        'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'volume': 'sum'
    }).dropna(subset=['open']).reset_index()
    return d5


def add_indicators(df):
    df.ta.atr(length=14, append=True)
    adx_df = df.ta.adx(length=14)
    if adx_df is not None:
        for c in adx_df.columns:
            df[c] = adx_df[c]
    df['roc'] = df.ta.roc(length=10)
    df['obv'] = df.ta.obv()
    macd_df = df.ta.macd(fast=12, slow=26, signal=9)
    if macd_df is not None:
        for c in macd_df.columns:
            df[c] = macd_df[c]
    bb_df = df.ta.bbands(length=20, std=2)
    if bb_df is not None:
        for c in bb_df.columns:
            df[c] = bb_df[c]
    return df


def compute_vwap(bars):
    """Compute cumulative VWAP from session bars."""
    tp = (bars['high'] + bars['low'] + bars['close']) / 3.0
    cum_tpv = (tp * bars['volume']).cumsum()
    cum_vol = bars['volume'].cumsum()
    return np.where(cum_vol > 0, cum_tpv / cum_vol, bars['close'])


def simulate_day(day_df, p):
    """Simulate one trading day. Returns list of trade dicts."""
    if len(day_df) < 15:
        return []

    # VWAP
    day_df = day_df.copy()
    day_df['vwap'] = compute_vwap(day_df)

    # Volume rolling avg
    day_df['vol_avg'] = day_df['volume'].rolling(20, min_periods=1).mean()
    day_df['vol_ratio'] = np.where(day_df['vol_avg'] > 0, day_df['volume'] / day_df['vol_avg'], 1)

    # BB width and %B
    bbu_cols = [c for c in day_df.columns if 'BBU' in c]
    bbl_cols = [c for c in day_df.columns if 'BBL' in c]
    bbm_cols = [c for c in day_df.columns if 'BBM' in c]
    if bbu_cols and bbl_cols and bbm_cols:
        bbu = day_df[bbu_cols[0]]
        bbl = day_df[bbl_cols[0]]
        bbm = day_df[bbm_cols[0]]
        day_df['bb_width'] = np.where(bbm > 0, (bbu - bbl) / bbm * 100, 0)
        day_df['bb_pctb'] = np.where((bbu - bbl) > 0, (day_df['close'] - bbl) / (bbu - bbl), 0.5)
    else:
        day_df['bb_width'] = 0
        day_df['bb_pctb'] = 0.5

    # CLV
    hl = day_df['high'] - day_df['low']
    day_df['clv'] = np.where(hl > 0, (2 * day_df['close'] - day_df['high'] - day_df['low']) / hl, 0)

    # Opening range
    range_mask = (day_df['time_et'] >= SESSION_OPEN) & (day_df['time_et'] < RANGE_END)
    range_bars = day_df[range_mask]
    if len(range_bars) < 2:
        return []

    range_high = range_bars['high'].max()
    range_low = range_bars['low'].min()
    range_width = range_high - range_low
    if range_width <= 0:
        return []

    range_mid = (range_high + range_low) / 2.0

    # Iterate bars after range formation
    trades = []
    trades_today = 0
    in_position = False
    entry_price = 0
    entry_side = None
    entry_atr = 0
    extreme_price = 0
    at_breakeven = False
    is_reversal = False
    tp_price = 0
    momentum_impulse = 0
    order_placed = False
    entry_bar_idx = 0
    entry_time = None
    entry_score = 0

    post_range = day_df[day_df['time_et'] >= RANGE_END]

    for idx in post_range.index:
        bar = day_df.loc[idx]
        t = bar['time_et']

        # EOD flatten
        if t >= EOD_FLATTEN and in_position:
            pnl = (bar['close'] - entry_price) if entry_side == 'LONG' else (entry_price - bar['close'])
            trades.append({
                'entry_time': entry_time, 'exit_time': str(bar['ts_et']),
                'side': entry_side, 'type': 'reversal' if is_reversal else 'breakout',
                'entry_price': entry_price, 'exit_price': bar['close'],
                'pnl': pnl, 'exit_reason': 'EOD_FLATTEN',
                'score': entry_score, 'tp_price': tp_price,
                'range_width': range_width, 'atr': entry_atr,
            })
            in_position = False
            break

        if t >= EOD_FLATTEN:
            break

        # If in position: check trailing stop and TP
        if in_position:
            # Update extreme
            if entry_side == 'LONG':
                if bar['high'] > extreme_price:
                    extreme_price = bar['high']
                # TP hit?
                if bar['high'] >= tp_price:
                    pnl = tp_price - entry_price
                    trades.append({
                        'entry_time': entry_time, 'exit_time': str(bar['ts_et']),
                        'side': entry_side, 'type': 'reversal' if is_reversal else 'breakout',
                        'entry_price': entry_price, 'exit_price': tp_price,
                        'pnl': pnl, 'exit_reason': 'TP',
                        'score': entry_score, 'tp_price': tp_price,
                        'range_width': range_width, 'atr': entry_atr,
                    })
                    in_position = False
                    continue
                # Trailing stop (no breakeven for reversals)
                if not is_reversal and not at_breakeven:
                    profit_dist = extreme_price - entry_price
                    if profit_dist >= p['breakeven_atr_mult'] * entry_atr:
                        at_breakeven = True
                if at_breakeven or is_reversal:
                    atr_now = day_df.loc[idx, 'ATRr_14'] if 'ATRr_14' in day_df.columns else entry_atr
                    if pd.isna(atr_now) or atr_now <= 0:
                        atr_now = entry_atr
                    trail = p['trail_atr_mult'] * atr_now
                    stop = extreme_price - trail
                    if bar['low'] <= stop:
                        pnl = stop - entry_price
                        trades.append({
                            'entry_time': entry_time, 'exit_time': str(bar['ts_et']),
                            'side': entry_side, 'type': 'reversal' if is_reversal else 'breakout',
                            'entry_price': entry_price, 'exit_price': stop,
                            'pnl': pnl, 'exit_reason': 'TRAIL_STOP',
                            'score': entry_score, 'tp_price': tp_price,
                            'range_width': range_width, 'atr': entry_atr,
                        })
                        in_position = False
                        continue
            else:  # SHORT
                if bar['low'] < extreme_price:
                    extreme_price = bar['low']
                if bar['low'] <= tp_price:
                    pnl = entry_price - tp_price
                    trades.append({
                        'entry_time': entry_time, 'exit_time': str(bar['ts_et']),
                        'side': entry_side, 'type': 'reversal' if is_reversal else 'breakout',
                        'entry_price': entry_price, 'exit_price': tp_price,
                        'pnl': pnl, 'exit_reason': 'TP',
                        'score': entry_score, 'tp_price': tp_price,
                        'range_width': range_width, 'atr': entry_atr,
                    })
                    in_position = False
                    continue
                if not is_reversal and not at_breakeven:
                    profit_dist = entry_price - extreme_price
                    if profit_dist >= p['breakeven_atr_mult'] * entry_atr:
                        at_breakeven = True
                if at_breakeven or is_reversal:
                    atr_now = day_df.loc[idx, 'ATRr_14'] if 'ATRr_14' in day_df.columns else entry_atr
                    if pd.isna(atr_now) or atr_now <= 0:
                        atr_now = entry_atr
                    trail = p['trail_atr_mult'] * atr_now
                    stop = extreme_price + trail
                    if bar['high'] >= stop:
                        pnl = entry_price - stop
                        trades.append({
                            'entry_time': entry_time, 'exit_time': str(bar['ts_et']),
                            'side': entry_side, 'type': 'reversal' if is_reversal else 'breakout',
                            'entry_price': entry_price, 'exit_price': stop,
                            'pnl': pnl, 'exit_reason': 'TRAIL_STOP',
                            'score': entry_score, 'tp_price': tp_price,
                            'range_width': range_width, 'atr': entry_atr,
                        })
                        in_position = False
                        continue
            continue

        # Not in position — check for entry
        if t >= TRADING_END:
            continue
        if trades_today >= p['max_trades_per_day']:
            continue
        if order_placed:
            continue

        prev_close = bar['close']
        prev_high = bar['high']
        prev_low = bar['low']
        prev_open = bar['open']
        prev_vol = bar['volume']

        atr_val = bar.get('ATRr_14', np.nan)
        if pd.isna(atr_val) or atr_val <= 0:
            continue

        adx_val = bar.get('ADX_14', np.nan)
        roc_val = bar.get('roc', np.nan)
        bb_width = bar.get('bb_width', 0)
        bb_pctb = bar.get('bb_pctb', 0.5)
        vol_ratio = bar.get('vol_ratio', 0)
        vwap_val = bar.get('vwap', prev_close)
        clv = bar.get('clv', 0)

        # MACD histogram
        macdh_cols = [c for c in day_df.columns if 'MACDh' in c]
        macdh = bar[macdh_cols[0]] if macdh_cols else np.nan

        # ROC previous
        prev_idx = idx - 1 if idx > 0 else idx
        roc_prev = day_df.loc[prev_idx, 'roc'] if prev_idx in day_df.index else np.nan

        # OBV
        obv_cur = bar.get('obv', np.nan)
        obv_5ago_idx = max(day_df.index[0], idx - 5)
        obv_prev = day_df.loc[obv_5ago_idx, 'obv'] if 'obv' in day_df.columns else np.nan
        obv_rising = pd.notna(obv_cur) and pd.notna(obv_prev) and obv_cur > obv_prev
        obv_falling = pd.notna(obv_cur) and pd.notna(obv_prev) and obv_cur < obv_prev

        broke_above = prev_close > range_high
        broke_below = prev_close < range_low

        if not broke_above and not broke_below:
            continue

        vol_confirmed = prev_vol > bar.get('vol_avg', 0) * p['volume_threshold']
        if not vol_confirmed:
            continue

        # Weighted scoring
        score = 0
        if bb_width > 0 and bb_width <= p['bb_width_max']:
            score += 3
        if pd.notna(adx_val) and adx_val >= p['adx_min']:
            score += 2
        if vol_ratio >= p['volume_threshold']:
            score += 2
        roc_valid = pd.notna(roc_val) and pd.notna(roc_prev)
        if roc_valid:
            if broke_above and roc_val > p['roc_min'] and roc_val >= roc_prev:
                score += 2
            elif broke_below and roc_val < -p['roc_min'] and roc_val <= roc_prev:
                score += 2
        if broke_above and bb_pctb >= p['long_bbpctb'][0] and bb_pctb <= p['long_bbpctb'][1]:
            score += 1
        elif broke_below and bb_pctb >= p['short_bbpctb'][0] and bb_pctb <= p['short_bbpctb'][1]:
            score += 1

        follow = score >= p['score_threshold']

        bar_body = abs(prev_close - prev_open)
        rel_vol = vol_ratio
        mom_impulse = bar_body * rel_vol

        bar_range = prev_high - prev_low
        bar_clv = (2 * prev_close - prev_high - prev_low) / bar_range if bar_range > 0 else 0

        # Follow breakout
        if follow:
            if broke_above:
                if p['use_vwap'] and prev_close <= vwap_val:
                    continue
                if bar_clv < p['min_clv']:
                    continue
                if not obv_rising:
                    continue
                # LONG entry
                entry_side = 'LONG'
                entry_price = prev_close
                entry_atr = atr_val
                extreme_price = prev_high
                at_breakeven = False
                is_reversal = False
                tp_dist = max(mom_impulse * p['tp_momentum_mult'], atr_val * p['tp_min_atr'])
                tp_price = entry_price + tp_dist
                in_position = True
                trades_today += 1
                entry_time = str(bar['ts_et'])
                entry_score = score
                momentum_impulse = mom_impulse

            elif broke_below:
                if p['use_vwap'] and prev_close >= vwap_val:
                    continue
                if bar_clv > -p['min_clv']:
                    continue
                if not obv_falling:
                    continue
                entry_side = 'SHORT'
                entry_price = prev_close
                entry_atr = atr_val
                extreme_price = prev_low
                at_breakeven = False
                is_reversal = False
                tp_dist = max(mom_impulse * p['tp_momentum_mult'], atr_val * p['tp_min_atr'])
                tp_price = entry_price - tp_dist
                in_position = True
                trades_today += 1
                entry_time = str(bar['ts_et'])
                entry_score = score
                momentum_impulse = mom_impulse

        # Reversal
        elif p['breakout_reversal']:
            clv_rejection = abs(bar_clv) < p['min_clv']

            if broke_above and pd.notna(macdh) and macdh < 0 and clv_rejection:
                entry_side = 'SHORT'
                entry_price = prev_close
                entry_atr = atr_val
                extreme_price = prev_low
                at_breakeven = False
                is_reversal = True
                # TP at closer of VWAP or range mid
                dist_mid = abs(entry_price - range_mid)
                dist_vwap = abs(entry_price - vwap_val)
                target = vwap_val if (dist_vwap > 0 and dist_vwap < dist_mid) else range_mid
                tp_price = target
                in_position = True
                trades_today += 1
                entry_time = str(bar['ts_et'])
                entry_score = score

            elif broke_below and pd.notna(macdh) and macdh > 0 and clv_rejection:
                entry_side = 'LONG'
                entry_price = prev_close
                entry_atr = atr_val
                extreme_price = prev_high
                at_breakeven = False
                is_reversal = True
                dist_mid = abs(entry_price - range_mid)
                dist_vwap = abs(entry_price - vwap_val)
                target = vwap_val if (dist_vwap > 0 and dist_vwap < dist_mid) else range_mid
                tp_price = target
                in_position = True
                trades_today += 1
                entry_time = str(bar['ts_et'])
                entry_score = score

    # Position still open at end of data (shouldn't happen with EOD flatten)
    if in_position:
        last = day_df.iloc[-1]
        pnl = (last['close'] - entry_price) if entry_side == 'LONG' else (entry_price - last['close'])
        trades.append({
            'entry_time': entry_time, 'exit_time': str(last['ts_et']),
            'side': entry_side, 'type': 'reversal' if is_reversal else 'breakout',
            'entry_price': entry_price, 'exit_price': last['close'],
            'pnl': pnl, 'exit_reason': 'SESSION_END',
            'score': entry_score, 'tp_price': tp_price,
            'range_width': range_width, 'atr': entry_atr,
        })

    return trades


def run():
    conn = psycopg2.connect(host='localhost', port=8812, user='admin', password='quest', database='qdb')
    all_trades = []

    for year in range(2020, 2025):
        print(f"--- {year} ---")
        df_1m = fetch_year(conn, 'MNQ', year)
        print(f"  1m rows: {len(df_1m):,}")
        df_5m = resample_5min(df_1m)
        del df_1m
        print(f"  5m bars: {len(df_5m):,}")
        df_5m = add_indicators(df_5m)
        df_5m['ts_et'] = df_5m['timestamp'].dt.tz_localize('UTC').dt.tz_convert(ET)
        df_5m['time_et'] = df_5m['ts_et'].dt.time
        df_5m['date_et'] = df_5m['ts_et'].dt.date
        df_rth = df_5m[(df_5m['time_et'] >= dtime(9, 0)) & (df_5m['time_et'] < dtime(16, 0))].copy().reset_index(drop=True)
        del df_5m

        trading_days = sorted(df_rth['date_et'].unique())
        year_trades = []
        for td in trading_days:
            day_df = df_rth[df_rth['date_et'] == td].reset_index(drop=True)
            t = simulate_day(day_df, PARAMS)
            year_trades.extend(t)

        print(f"  Trades: {len(year_trades)}")
        all_trades.extend(year_trades)
        del df_rth

    conn.close()

    if not all_trades:
        print("No trades.")
        return

    df = pd.DataFrame(all_trades)

    # Results
    print(f"\n{'='*100}")
    print(f"BACKTEST RESULTS — {len(df)} trades, 2020-2024")
    print(f"{'='*100}")

    for trade_type in ['ALL', 'breakout', 'reversal']:
        td = df if trade_type == 'ALL' else df[df['type'] == trade_type]
        if len(td) == 0:
            continue
        wins = (td['pnl'] > 0).sum()
        print(f"\n  {trade_type.upper()} ({len(td)} trades):")
        print(f"    Win rate: {wins}/{len(td)} ({wins/len(td)*100:.1f}%)")
        print(f"    Total PnL: {td['pnl'].sum():+.2f} pts")
        print(f"    Avg PnL: {td['pnl'].mean():+.2f} pts")
        print(f"    Med PnL: {td['pnl'].median():+.2f} pts")
        print(f"    Max Win: {td['pnl'].max():+.2f}")
        print(f"    Max Loss: {td['pnl'].min():+.2f}")
        print(f"    Avg Win: {td[td['pnl']>0]['pnl'].mean():+.2f}" if wins > 0 else "")
        print(f"    Avg Loss: {td[td['pnl']<=0]['pnl'].mean():+.2f}" if (len(td)-wins) > 0 else "")

    # Exit reasons
    print(f"\n  EXIT REASONS:")
    for reason in df['exit_reason'].unique():
        rd = df[df['exit_reason'] == reason]
        wins = (rd['pnl'] > 0).sum()
        print(f"    {reason:<15} | {len(rd):>4} trades | {wins}/{len(rd)} win ({wins/len(rd)*100:.0f}%) | PnL: {rd['pnl'].sum():+.1f} | Avg: {rd['pnl'].mean():+.2f}")

    # By side
    print(f"\n  BY SIDE:")
    for side in ['LONG', 'SHORT']:
        sd = df[df['side'] == side]
        if len(sd) == 0:
            continue
        wins = (sd['pnl'] > 0).sum()
        print(f"    {side:<6} | {len(sd):>4} trades | {wins}/{len(sd)} win ({wins/len(sd)*100:.0f}%) | PnL: {sd['pnl'].sum():+.1f}")

    # By year
    print(f"\n  BY YEAR:")
    df['year'] = pd.to_datetime(df['entry_time']).dt.year
    for yr in sorted(df['year'].unique()):
        yd = df[df['year'] == yr]
        wins = (yd['pnl'] > 0).sum()
        bo = yd[yd['type'] == 'breakout']
        rv = yd[yd['type'] == 'reversal']
        print(f"    {yr} | {len(yd):>4} trades ({len(bo)} BO, {len(rv)} REV) | {wins}/{len(yd)} win ({wins/len(yd)*100:.0f}%) | PnL: {yd['pnl'].sum():+.1f}")

    # Score analysis
    print(f"\n  BY SCORE:")
    for sc in sorted(df['score'].unique()):
        sd = df[df['score'] == sc]
        wins = (sd['pnl'] > 0).sum()
        print(f"    Score {sc:>2} | {len(sd):>4} trades | {wins}/{len(sd)} win ({wins/len(sd)*100:.0f}%) | PnL: {sd['pnl'].sum():+.1f} | Avg: {sd['pnl'].mean():+.2f}")

    # Gaps analysis
    print(f"\n{'='*100}")
    print("GAP ANALYSIS")
    print(f"{'='*100}")

    # Reversal TP hit rate
    rev = df[df['type'] == 'reversal']
    if len(rev) > 0:
        tp_hits = rev[rev['exit_reason'] == 'TP']
        trail_hits = rev[rev['exit_reason'] == 'TRAIL_STOP']
        eod_hits = rev[rev['exit_reason'] == 'EOD_FLATTEN']
        print(f"\n  REVERSAL EXIT BREAKDOWN:")
        print(f"    TP hit: {len(tp_hits)} ({len(tp_hits)/len(rev)*100:.0f}%) | Avg PnL: {tp_hits['pnl'].mean():+.2f}" if len(tp_hits) > 0 else "    TP hit: 0")
        print(f"    Trail stop: {len(trail_hits)} ({len(trail_hits)/len(rev)*100:.0f}%) | Avg PnL: {trail_hits['pnl'].mean():+.2f}" if len(trail_hits) > 0 else "    Trail stop: 0")
        print(f"    EOD flatten: {len(eod_hits)} ({len(eod_hits)/len(rev)*100:.0f}%) | Avg PnL: {eod_hits['pnl'].mean():+.2f}" if len(eod_hits) > 0 else "    EOD flatten: 0")

    # Breakout TP hit rate
    bo = df[df['type'] == 'breakout']
    if len(bo) > 0:
        tp_hits = bo[bo['exit_reason'] == 'TP']
        trail_hits = bo[bo['exit_reason'] == 'TRAIL_STOP']
        eod_hits = bo[bo['exit_reason'] == 'EOD_FLATTEN']
        print(f"\n  BREAKOUT EXIT BREAKDOWN:")
        print(f"    TP hit: {len(tp_hits)} ({len(tp_hits)/len(bo)*100:.0f}%) | Avg PnL: {tp_hits['pnl'].mean():+.2f}" if len(tp_hits) > 0 else "    TP hit: 0")
        print(f"    Trail stop: {len(trail_hits)} ({len(trail_hits)/len(bo)*100:.0f}%) | Avg PnL: {trail_hits['pnl'].mean():+.2f}" if len(trail_hits) > 0 else "    Trail stop: 0")
        print(f"    EOD flatten: {len(eod_hits)} ({len(eod_hits)/len(bo)*100:.0f}%) | Avg PnL: {eod_hits['pnl'].mean():+.2f}" if len(eod_hits) > 0 else "    EOD flatten: 0")

    # Biggest losers
    print(f"\n  TOP 10 WORST TRADES:")
    worst = df.nsmallest(10, 'pnl')
    for _, t in worst.iterrows():
        print(f"    {t['entry_time'][:16]} {t['side']:<5} {t['type']:<9} score={t['score']} PnL={t['pnl']:+.2f} exit={t['exit_reason']} rngW={t['range_width']:.1f}")

    # Trades where reversal had no chance (TP wrong side of entry)
    if len(rev) > 0:
        bad_tp = rev[
            ((rev['side'] == 'LONG') & (rev['tp_price'] <= rev['entry_price'])) |
            ((rev['side'] == 'SHORT') & (rev['tp_price'] >= rev['entry_price']))
        ]
        if len(bad_tp) > 0:
            print(f"\n  GAP: {len(bad_tp)} REVERSAL TRADES WITH TP ON WRONG SIDE OF ENTRY:")
            for _, t in bad_tp.iterrows():
                print(f"    {t['entry_time'][:16]} {t['side']} entry={t['entry_price']:.2f} tp={t['tp_price']:.2f}")

    # Trailing stop too tight / too loose
    trail_trades = df[df['exit_reason'] == 'TRAIL_STOP']
    if len(trail_trades) > 0:
        losing_trails = trail_trades[trail_trades['pnl'] < 0]
        print(f"\n  TRAILING STOP LOSSES: {len(losing_trails)}/{len(trail_trades)} ({len(losing_trails)/len(trail_trades)*100:.0f}%)")
        if len(losing_trails) > 0:
            print(f"    Avg loss on trail stop: {losing_trails['pnl'].mean():+.2f}")

    # Save
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'orb_backtest_results.csv')
    df.to_csv(out, index=False)
    print(f"\nResults: {out}")


if __name__ == '__main__':
    run()
