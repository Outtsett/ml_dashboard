"""
ORB Audit — Run backtest with Optuna-optimized params, detailed trade log.
"""

import os
import sys
import warnings
from datetime import time as dtime

import numpy as np
import pandas as pd
import psycopg2
import pytz

warnings.filterwarnings("ignore")

try:
    # Imported for its side effect: registers the `.ta` accessor on DataFrame.
    # The `ta` name itself is never referenced — usage is `df.ta.atr(...)`.
    import pandas_ta as ta  # noqa: F401
except ImportError:
    import subprocess

    subprocess.check_call([sys.executable, "-m", "pip", "install", "pandas-ta"])

ET = pytz.timezone("US/Eastern")
SESSION_OPEN = dtime(9, 30)
RANGE_END = dtime(9, 45)
TRADING_END = dtime(11, 30)
EOD_FLATTEN = dtime(15, 50)

# Optuna-optimized parameters
P = {
    "st": 7,
    "tm": 2.5,
    "tf": 0.6,
    "dm": 210,
    "bw": 1.0,
    "vt": 1.0,
    "am": 25,
    "mc": 0.7,
    "lbm": 0.6,
    "lbx": 1.0,
    "sbm": 0.1,
    "sbx": 0.3,
    "rv": True,
}


def load_data():
    conn = psycopg2.connect(
        host="localhost", port=8812, user="admin", password="quest", database="qdb"
    )
    all_days = {}
    for year in range(2020, 2025):
        print(f"Loading {year}...")
        df_1m = pd.read_sql(
            f"""
            SELECT timestamp, open, high, low, close, volume
            FROM ohlcv WHERE symbol = 'MNQ'
              AND timestamp >= '{year}-01-01' AND timestamp <= '{year}-12-31'
            ORDER BY timestamp
        """,
            conn,
            parse_dates=["timestamp"],
        )
        d5 = (
            df_1m.set_index("timestamp")
            .resample("5min")
            .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
            .dropna(subset=["open"])
            .reset_index()
        )
        del df_1m
        d5.ta.atr(length=14, append=True)
        for r in [
            d5.ta.adx(length=14),
            d5.ta.macd(fast=12, slow=26, signal=9),
            d5.ta.bbands(length=20, std=2),
        ]:
            if r is not None:
                for c in r.columns:
                    d5[c] = r[c]
        d5["roc"] = d5.ta.roc(length=10)
        d5["obv"] = d5.ta.obv()
        d5["ts_et"] = d5["timestamp"].dt.tz_localize("UTC").dt.tz_convert(ET)
        d5["time_et"] = d5["ts_et"].dt.time
        d5["date_et"] = d5["ts_et"].dt.date
        d5 = d5[(d5["time_et"] >= dtime(9, 0)) & (d5["time_et"] < dtime(16, 0))].reset_index(
            drop=True
        )
        bbu = [c for c in d5.columns if "BBU" in c]
        bbl = [c for c in d5.columns if "BBL" in c]
        bbm = [c for c in d5.columns if "BBM" in c]
        mh = [c for c in d5.columns if "MACDh" in c]
        for td in d5["date_et"].unique():
            day = d5[d5["date_et"] == td].copy().reset_index(drop=True)
            if len(day) < 15:
                continue
            tp = (day["high"] + day["low"] + day["close"]) / 3.0
            cv = day["volume"].cumsum().replace(0, np.nan)
            day["vwap"] = (tp * day["volume"]).cumsum() / cv
            day["vol_avg"] = day["volume"].rolling(20, min_periods=1).mean()
            day["vol_ratio"] = np.where(day["vol_avg"] > 0, day["volume"] / day["vol_avg"], 1)
            if bbu and bbl and bbm:
                u, l, m = day[bbu[0]], day[bbl[0]], day[bbm[0]]
                day["bb_width"] = np.where(m > 0, (u - l) / m * 100, 0)
                day["bb_pctb"] = np.where((u - l) > 0, (day["close"] - l) / (u - l), 0.5)
            else:
                day["bb_width"] = 0
                day["bb_pctb"] = 0.5
            hl = day["high"] - day["low"]
            day["clv"] = np.where(hl > 0, (2 * day["close"] - day["high"] - day["low"]) / hl, 0)
            day["macdh"] = day[mh[0]] if mh else np.nan
            all_days[str(td)] = day
    conn.close()
    return all_days


def simulate_detailed(all_days, p):
    trades = []
    for date_str, day_df in sorted(all_days.items()):
        rm = (day_df["time_et"] >= SESSION_OPEN) & (day_df["time_et"] < RANGE_END)
        rb = day_df[rm]
        if len(rb) < 2:
            continue
        rh, rl = rb["high"].max(), rb["low"].min()
        rw = rh - rl
        if rw <= 0:
            continue

        td_count = 0
        in_pos = False
        ep = ea = ext = 0.0
        es = None
        eb = 0
        ir = False
        entry_time = ""
        entry_score = 0
        entry_bbw = 0
        entry_adx = 0
        entry_roc = 0
        entry_clv = 0
        entry_volr = 0
        entry_macdh = 0
        entry_bbpctb = 0
        peak_profit = 0

        pr = day_df[day_df["time_et"] >= RANGE_END]
        for i, idx in enumerate(pr.index):
            b = day_df.loc[idx]
            t = b["time_et"]

            if t >= EOD_FLATTEN and in_pos:
                pnl = (b["close"] - ep) if es == "L" else (ep - b["close"])
                trades.append(
                    {
                        "date": date_str,
                        "entry_time": entry_time,
                        "exit_time": str(b["ts_et"]),
                        "side": "LONG" if es == "L" else "SHORT",
                        "type": "reversal" if ir else "breakout",
                        "entry": ep,
                        "exit": b["close"],
                        "pnl": pnl,
                        "exit_reason": "EOD",
                        "score": entry_score,
                        "range_w": rw,
                        "atr": ea,
                        "bbw": entry_bbw,
                        "adx": entry_adx,
                        "roc": entry_roc,
                        "clv": entry_clv,
                        "vol_ratio": entry_volr,
                        "macdh": entry_macdh,
                        "bb_pctb": entry_bbpctb,
                        "peak_profit": peak_profit,
                        "bars_held": i - eb,
                        "trail_mult_at_exit": max(
                            p["tf"], p["tm"] - ((i - eb) * 5 / p["dm"]) * (p["tm"] - p["tf"])
                        ),
                    }
                )
                in_pos = False
                break
            if t >= EOD_FLATTEN:
                break

            if in_pos:
                bh = i - eb
                if es == "L":
                    if b["high"] > ext:
                        ext = b["high"]
                    cur_profit = ext - ep
                else:
                    if b["low"] < ext:
                        ext = b["low"]
                    cur_profit = ep - ext
                if cur_profit > peak_profit:
                    peak_profit = cur_profit

                mn = bh * 5
                dc = max(p["tf"], p["tm"] - (mn / p["dm"]) * (p["tm"] - p["tf"]))
                an = b.get("ATRr_14", np.nan)
                if pd.isna(an) or an <= 0:
                    an = ea
                tr = dc * an

                if es == "L":
                    stop = ext - tr
                    if b["low"] <= stop:
                        pnl = stop - ep
                        trades.append(
                            {
                                "date": date_str,
                                "entry_time": entry_time,
                                "exit_time": str(b["ts_et"]),
                                "side": "LONG",
                                "type": "reversal" if ir else "breakout",
                                "entry": ep,
                                "exit": stop,
                                "pnl": pnl,
                                "exit_reason": "TRAIL",
                                "score": entry_score,
                                "range_w": rw,
                                "atr": ea,
                                "bbw": entry_bbw,
                                "adx": entry_adx,
                                "roc": entry_roc,
                                "clv": entry_clv,
                                "vol_ratio": entry_volr,
                                "macdh": entry_macdh,
                                "bb_pctb": entry_bbpctb,
                                "peak_profit": peak_profit,
                                "bars_held": bh,
                                "trail_mult_at_exit": dc,
                            }
                        )
                        in_pos = False
                        continue
                else:
                    stop = ext + tr
                    if b["high"] >= stop:
                        pnl = ep - stop
                        trades.append(
                            {
                                "date": date_str,
                                "entry_time": entry_time,
                                "exit_time": str(b["ts_et"]),
                                "side": "SHORT",
                                "type": "reversal" if ir else "breakout",
                                "entry": ep,
                                "exit": stop,
                                "pnl": pnl,
                                "exit_reason": "TRAIL",
                                "score": entry_score,
                                "range_w": rw,
                                "atr": ea,
                                "bbw": entry_bbw,
                                "adx": entry_adx,
                                "roc": entry_roc,
                                "clv": entry_clv,
                                "vol_ratio": entry_volr,
                                "macdh": entry_macdh,
                                "bb_pctb": entry_bbpctb,
                                "peak_profit": peak_profit,
                                "bars_held": bh,
                                "trail_mult_at_exit": dc,
                            }
                        )
                        in_pos = False
                        continue
                continue

            if t >= TRADING_END or td_count >= 2:
                continue
            c = b["close"]
            av = b.get("ATRr_14", np.nan)
            if pd.isna(av) or av <= 0:
                continue
            ba = c > rh
            bb = c < rl
            if not ba and not bb:
                continue
            if b["volume"] <= b.get("vol_avg", 0) * p["vt"]:
                continue

            sc = 0
            bw = b.get("bb_width", 0)
            if bw > 0 and bw <= p["bw"]:
                sc += 3
            ax = b.get("ADX_14", np.nan)
            if pd.notna(ax) and ax >= p["am"]:
                sc += 2
            vr = b.get("vol_ratio", 0)
            if vr >= p["vt"]:
                sc += 2
            rc = b.get("roc", np.nan)
            rp = (
                day_df.loc[max(day_df.index[0], idx - 1), "roc"]
                if "roc" in day_df.columns
                else np.nan
            )
            if pd.notna(rc) and pd.notna(rp):
                if ba and rc > 0 and rc >= rp:
                    sc += 2
                elif bb and rc < 0 and rc <= rp:
                    sc += 2
            bp = b.get("bb_pctb", 0.5)
            if ba and bp >= p["lbm"] and bp <= p["lbx"]:
                sc += 1
            elif bb and bp >= p["sbm"] and bp <= p["sbx"]:
                sc += 1

            fw = sc >= p["st"]
            cl = b.get("clv", 0)
            oc = b.get("obv", np.nan)
            o5 = (
                day_df.loc[max(day_df.index[0], idx - 5), "obv"]
                if "obv" in day_df.columns
                else np.nan
            )
            ou = pd.notna(oc) and pd.notna(o5) and oc > o5
            od = pd.notna(oc) and pd.notna(o5) and oc < o5
            mhv = b.get("macdh", np.nan)
            vw = b.get("vwap", c)

            entered = False
            if fw:
                if ba and c > vw and cl >= p["mc"] and ou:
                    es = "L"
                    ep = c
                    ea = av
                    ext = b["high"]
                    ir = False
                    in_pos = True
                    entered = True
                elif bb and c < vw and cl <= -p["mc"] and od:
                    es = "S"
                    ep = c
                    ea = av
                    ext = b["low"]
                    ir = False
                    in_pos = True
                    entered = True
            elif p["rv"]:
                cr = abs(cl) < p["mc"]
                if ba and pd.notna(mhv) and mhv < 0 and cr:
                    es = "S"
                    ep = c
                    ea = av
                    ext = b["low"]
                    ir = True
                    in_pos = True
                    entered = True
                elif bb and pd.notna(mhv) and mhv > 0 and cr:
                    es = "L"
                    ep = c
                    ea = av
                    ext = b["high"]
                    ir = True
                    in_pos = True
                    entered = True

            if entered:
                td_count += 1
                eb = i
                peak_profit = 0
                entry_time = str(b["ts_et"])
                entry_score = sc
                entry_bbw = bw
                entry_adx = ax if pd.notna(ax) else 0
                entry_roc = rc if pd.notna(rc) else 0
                entry_clv = cl
                entry_volr = vr
                entry_macdh = mhv if pd.notna(mhv) else 0
                entry_bbpctb = bp

        if in_pos:
            lb = day_df.iloc[-1]
            pnl = (lb["close"] - ep) if es == "L" else (ep - lb["close"])
            trades.append(
                {
                    "date": date_str,
                    "entry_time": entry_time,
                    "exit_time": str(lb["ts_et"]),
                    "side": "LONG" if es == "L" else "SHORT",
                    "type": "reversal" if ir else "breakout",
                    "entry": ep,
                    "exit": lb["close"],
                    "pnl": pnl,
                    "exit_reason": "SESSION_END",
                    "score": entry_score,
                    "range_w": rw,
                    "atr": ea,
                    "bbw": entry_bbw,
                    "adx": entry_adx,
                    "roc": entry_roc,
                    "clv": entry_clv,
                    "vol_ratio": entry_volr,
                    "macdh": entry_macdh,
                    "bb_pctb": entry_bbpctb,
                    "peak_profit": peak_profit,
                    "bars_held": len(pr) - eb,
                    "trail_mult_at_exit": p["tf"],
                }
            )

    return pd.DataFrame(trades)


def audit(df):
    print(f"\n{'=' * 120}")
    print(f"AUDIT — {len(df)} TRADES (Optuna-optimized params)")
    print(f"{'=' * 120}")

    # Summary
    wins = (df["pnl"] > 0).sum()
    losses = len(df) - wins
    print(
        f"\nTotal PnL: {df['pnl'].sum():+.2f} pts | Trades: {len(df)} | Win: {wins} ({wins / len(df) * 100:.1f}%) | Loss: {losses}"
    )
    print(
        f"Avg Win: {df[df['pnl'] > 0]['pnl'].mean():+.2f} | Avg Loss: {df[df['pnl'] <= 0]['pnl'].mean():+.2f} | Max DD trade: {df['pnl'].min():+.2f}"
    )

    # By year
    df["year"] = pd.to_datetime(df["date"]).dt.year
    print(f"\nBY YEAR:")
    for yr in sorted(df["year"].unique()):
        yd = df[df["year"] == yr]
        w = (yd["pnl"] > 0).sum()
        bo = yd[yd["type"] == "breakout"]
        rv = yd[yd["type"] == "reversal"]
        print(
            f"  {yr}: {len(yd):>3} trades ({len(bo)} BO, {len(rv)} REV) | {w}/{len(yd)} win ({w / len(yd) * 100:.0f}%) | PnL: {yd['pnl'].sum():>+8.1f} | Avg: {yd['pnl'].mean():>+6.2f}"
        )

    # By type
    print(f"\nBY TYPE:")
    for tt in ["breakout", "reversal"]:
        td = df[df["type"] == tt]
        if len(td) == 0:
            continue
        w = (td["pnl"] > 0).sum()
        print(
            f"  {tt:<10}: {len(td):>3} trades | {w}/{len(td)} win ({w / len(td) * 100:.0f}%) | PnL: {td['pnl'].sum():>+8.1f} | Avg: {td['pnl'].mean():>+6.2f}"
        )

    # By exit reason
    print(f"\nBY EXIT:")
    for ex in df["exit_reason"].unique():
        ed = df[df["exit_reason"] == ex]
        w = (ed["pnl"] > 0).sum()
        print(
            f"  {ex:<10}: {len(ed):>3} trades | {w}/{len(ed)} win ({w / len(ed) * 100:.0f}%) | PnL: {ed['pnl'].sum():>+8.1f} | Avg: {ed['pnl'].mean():>+6.2f}"
        )

    # By side
    print(f"\nBY SIDE:")
    for s in ["LONG", "SHORT"]:
        sd = df[df["side"] == s]
        if len(sd) == 0:
            continue
        w = (sd["pnl"] > 0).sum()
        print(
            f"  {s:<6}: {len(sd):>3} trades | {w}/{len(sd)} win ({w / len(sd) * 100:.0f}%) | PnL: {sd['pnl'].sum():>+8.1f}"
        )

    # Peak profit vs actual PnL (profit left on table)
    print(f"\nPROFIT CAPTURE:")
    df["capture_pct"] = np.where(df["peak_profit"] > 0, df["pnl"] / df["peak_profit"] * 100, 0)
    winning = df[df["pnl"] > 0]
    losing = df[df["pnl"] <= 0]
    print(
        f"  Winners: avg peak={winning['peak_profit'].mean():.1f} pts, avg captured={winning['pnl'].mean():.1f} pts ({winning['capture_pct'].mean():.0f}%)"
    )
    if len(losing) > 0:
        print(
            f"  Losers:  avg peak={losing['peak_profit'].mean():.1f} pts, then gave back to PnL={losing['pnl'].mean():.1f} pts"
        )
        losers_had_profit = losing[losing["peak_profit"] > 0]
        print(
            f"    {len(losers_had_profit)}/{len(losing)} losers were profitable at some point (peak > 0)"
        )
        if len(losers_had_profit) > 0:
            print(
                f"    Avg peak before reversal: {losers_had_profit['peak_profit'].mean():.1f} pts"
            )

    # Hold time analysis
    print(f"\nHOLD TIME (bars x 5min):")
    print(
        f"  Winners: avg {winning['bars_held'].mean():.0f} bars ({winning['bars_held'].mean() * 5:.0f} min)"
    )
    if len(losing) > 0:
        print(
            f"  Losers:  avg {losing['bars_held'].mean():.0f} bars ({losing['bars_held'].mean() * 5:.0f} min)"
        )

    # Trail multiplier at exit
    print(f"\nTRAIL MULT AT EXIT:")
    print(f"  Winners: avg {winning['trail_mult_at_exit'].mean():.2f}x ATR")
    if len(losing) > 0:
        print(f"  Losers:  avg {losing['trail_mult_at_exit'].mean():.2f}x ATR")

    # Score distribution
    print(f"\nBY SCORE:")
    for sc in sorted(df["score"].unique()):
        sd = df[df["score"] == sc]
        w = (sd["pnl"] > 0).sum()
        print(
            f"  Score {sc:>2}: {len(sd):>3} trades | {w}/{len(sd)} win ({w / len(sd) * 100:.0f}%) | PnL: {sd['pnl'].sum():>+8.1f} | Avg: {sd['pnl'].mean():>+6.2f}"
        )

    # Every trade
    print(f"\n{'=' * 120}")
    print(f"ALL TRADES")
    print(f"{'=' * 120}")
    print(
        f"{'Date':<12} {'Time':>8} {'Side':<6} {'Type':<9} {'Entry':>9} {'Exit':>9} {'PnL':>8} {'ExitR':>6} {'Sc':>3} {'Bars':>4} {'Peak':>6} {'RngW':>6} {'ATR':>6} {'ADX':>5} {'BBW':>5} {'ROC':>6} {'CLV':>5} {'VolR':>5} {'MACDh':>6} {'BB%B':>5}"
    )
    print("-" * 160)

    cum_pnl = 0
    for _, t in df.iterrows():
        cum_pnl += t["pnl"]
        et = str(t["entry_time"]).split(" ")[1][:5] if pd.notna(t.get("entry_time")) else ""
        print(
            f"{t['date']:<12} {et:>8} {t['side']:<6} {t['type']:<9} {t['entry']:>9.2f} {t['exit']:>9.2f} {t['pnl']:>+8.2f} {t['exit_reason']:>6} {t['score']:>3} {t['bars_held']:>4.0f} {t['peak_profit']:>6.1f} {t['range_w']:>6.1f} {t['atr']:>6.1f} {t['adx']:>5.1f} {t['bbw']:>5.2f} {t['roc']:>6.3f} {t['clv']:>5.2f} {t['vol_ratio']:>5.2f} {t['macdh']:>6.2f} {t['bb_pctb']:>5.2f}"
        )

    # Equity curve
    print(f"\nEQUITY CURVE (cumulative):")
    cum = 0
    for _, t in df.iterrows():
        cum += t["pnl"]
        marker = "*" if t["pnl"] > 0 else "x"
        bar_len = int(abs(t["pnl"]) / 2)
        bar = "+" * bar_len if t["pnl"] > 0 else "-" * bar_len
        print(f"  {t['date']} {t['pnl']:>+7.1f} {marker} {bar:<40} cum={cum:>+8.1f}")

    # Worst trades deep dive
    print(f"\n{'=' * 120}")
    print(f"WORST 10 TRADES — DEEP DIVE")
    print(f"{'=' * 120}")
    worst = df.nsmallest(10, "pnl")
    for _, t in worst.iterrows():
        print(
            f"\n  {t['date']} {t['side']} {t['type']} | Entry={t['entry']:.2f} Exit={t['exit']:.2f} PnL={t['pnl']:+.2f}"
        )
        print(
            f"    Score={t['score']} ADX={t['adx']:.1f} BBW={t['bbw']:.2f}% ROC={t['roc']:.3f} CLV={t['clv']:.2f} VolR={t['vol_ratio']:.2f} MACDh={t['macdh']:.2f} BB%B={t['bb_pctb']:.2f}"
        )
        print(
            f"    RangeW={t['range_w']:.1f} ATR={t['atr']:.1f} BarsHeld={t['bars_held']:.0f} ({t['bars_held'] * 5:.0f}min) PeakProfit={t['peak_profit']:.1f} TrailAtExit={t['trail_mult_at_exit']:.2f}x"
        )
        if t["peak_profit"] > 0:
            print(
                f"    ** Was profitable ({t['peak_profit']:.1f} pts peak) before reversing to {t['pnl']:+.1f} **"
            )

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "orb_audit_results.csv")
    df.to_csv(out, index=False)
    print(f"\nSaved: {out}")


if __name__ == "__main__":
    data = load_data()
    print(f"Loaded {len(data)} days")
    df = simulate_detailed(data, P)
    audit(df)
