"""
ORB Strategy Optimization — Optuna Bayesian search for optimal thresholds.
Maximizes total PnL with penalty for EOD flattens and low trade count.
"""

import os
import sys
import warnings
from datetime import time as dtime

import numpy as np
import optuna
import pandas as pd
import psycopg2
import pytz

warnings.filterwarnings("ignore")
optuna.logging.set_verbosity(optuna.logging.WARNING)

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

ALL_DAYS = {}


def load_data():
    global ALL_DAYS
    conn = psycopg2.connect(
        host="localhost", port=8812, user="admin", password="quest", database="qdb"
    )

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

            ALL_DAYS[str(td)] = day

    conn.close()
    print(f"Loaded {len(ALL_DAYS)} days")


def simulate(p):
    total_pnl = 0
    total_trades = 0
    wins = 0
    eod_count = 0
    eod_pnl = 0

    for day_df in ALL_DAYS.values():
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

        pr = day_df[day_df["time_et"] >= RANGE_END]

        for i, idx in enumerate(pr.index):
            b = day_df.loc[idx]
            t = b["time_et"]

            if t >= EOD_FLATTEN and in_pos:
                pnl = (b["close"] - ep) if es == "L" else (ep - b["close"])
                total_pnl += pnl
                total_trades += 1
                if pnl > 0:
                    wins += 1
                eod_count += 1
                eod_pnl += pnl
                in_pos = False
                break
            if t >= EOD_FLATTEN:
                break

            if in_pos:
                bh = i - eb
                if es == "L":
                    if b["high"] > ext:
                        ext = b["high"]
                else:
                    if b["low"] < ext:
                        ext = b["low"]

                mn = bh * 5
                dc = max(p["tf"], p["tm"] - (mn / p["dm"]) * (p["tm"] - p["tf"]))
                an = b.get("ATRr_14", np.nan)
                if pd.isna(an) or an <= 0:
                    an = ea
                tr = dc * an

                if es == "L":
                    if b["low"] <= ext - tr:
                        pnl = (ext - tr) - ep
                        total_pnl += pnl
                        total_trades += 1
                        if pnl > 0:
                            wins += 1
                        in_pos = False
                        continue
                else:
                    if b["high"] >= ext + tr:
                        pnl = ep - (ext + tr)
                        total_pnl += pnl
                        total_trades += 1
                        if pnl > 0:
                            wins += 1
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

            # Score
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
            mh = b.get("macdh", np.nan)
            vw = b.get("vwap", c)

            if fw:
                if ba and c > vw and cl >= p["mc"] and ou:
                    es = "L"
                    ep = c
                    ea = av
                    ext = b["high"]
                    in_pos = True
                    td_count += 1
                    eb = i
                elif bb and c < vw and cl <= -p["mc"] and od:
                    es = "S"
                    ep = c
                    ea = av
                    ext = b["low"]
                    in_pos = True
                    td_count += 1
                    eb = i
            elif p["rv"]:
                cr = abs(cl) < p["mc"]
                if ba and pd.notna(mh) and mh < 0 and cr:
                    es = "S"
                    ep = c
                    ea = av
                    ext = b["low"]
                    in_pos = True
                    td_count += 1
                    eb = i
                elif bb and pd.notna(mh) and mh > 0 and cr:
                    es = "L"
                    ep = c
                    ea = av
                    ext = b["high"]
                    in_pos = True
                    td_count += 1
                    eb = i

        if in_pos:
            lb = day_df.iloc[-1]
            pnl = (lb["close"] - ep) if es == "L" else (ep - lb["close"])
            total_pnl += pnl
            total_trades += 1
            eod_count += 1
            eod_pnl += pnl
            if pnl > 0:
                wins += 1

    return total_pnl, total_trades, wins, eod_count, eod_pnl


def objective(trial):
    p = {
        "st": trial.suggest_int("score_threshold", 4, 9),
        "tm": trial.suggest_float("trail_mult", 0.75, 2.5, step=0.25),
        "tf": trial.suggest_float("trail_floor", 0.2, 0.75, step=0.05),
        "dm": trial.suggest_float("decay_minutes", 30, 240, step=30),
        "bw": trial.suggest_float("bb_width_max", 0.3, 1.5, step=0.1),
        "vt": trial.suggest_float("vol_threshold", 0.4, 1.2, step=0.1),
        "am": trial.suggest_float("adx_min", 10, 30, step=5),
        "mc": trial.suggest_float("min_clv", 0.2, 0.7, step=0.1),
        "lbm": trial.suggest_float("long_bbpctb_min", 0.3, 0.7, step=0.1),
        "lbx": trial.suggest_float("long_bbpctb_max", 0.6, 1.0, step=0.1),
        "sbm": trial.suggest_float("short_bbpctb_min", -0.1, 0.3, step=0.1),
        "sbx": trial.suggest_float("short_bbpctb_max", 0.2, 0.6, step=0.1),
        "rv": trial.suggest_categorical("reversal", [True, False]),
    }

    pnl, trades, wins, eod_n, eod_pnl = simulate(p)

    if trades < 15:
        return -9999

    win_rate = wins / trades * 100
    avg_pnl = pnl / trades

    # Objective: maximize avg PnL with penalties
    # Penalize heavy EOD flatten reliance
    eod_ratio = eod_n / trades if trades > 0 else 0
    score = avg_pnl - (eod_ratio * 5)  # penalize if >50% trades hit EOD

    # Report
    trial.set_user_attr("total_pnl", pnl)
    trial.set_user_attr("trades", trades)
    trial.set_user_attr("win_rate", win_rate)
    trial.set_user_attr("eod_count", eod_n)
    trial.set_user_attr("eod_pnl", eod_pnl)

    return score


def run():
    load_data()

    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=42))
    study.optimize(objective, n_trials=200, show_progress_bar=True)

    print(f"\n{'=' * 100}")
    print(f"OPTIMIZATION COMPLETE — {len(study.trials)} trials")
    print(f"{'=' * 100}")

    # Top 20 trials
    trials = sorted(study.trials, key=lambda t: t.value if t.value else -9999, reverse=True)
    print(
        f"\n{'Score':>7} {'PnL':>8} {'Trades':>6} {'Win%':>5} {'EOD#':>5} {'EOD$':>7} | Parameters"
    )
    print("-" * 120)

    for t in trials[:20]:
        if t.value is None or t.value < -999:
            continue
        ua = t.user_attrs
        params = t.params
        print(
            f"{t.value:>+7.2f} {ua.get('total_pnl', 0):>+8.1f} {ua.get('trades', 0):>6} {ua.get('win_rate', 0):>5.1f} "
            f"{ua.get('eod_count', 0):>5} {ua.get('eod_pnl', 0):>+7.1f} | "
            f"sc={params.get('score_threshold', '')} tr={params.get('trail_mult', 0):.2f} fl={params.get('trail_floor', 0):.2f} "
            f"dc={params.get('decay_minutes', 0):.0f} bw={params.get('bb_width_max', 0):.2f} "
            f"vol={params.get('vol_threshold', 0):.1f} adx={params.get('adx_min', 0):.0f} "
            f"clv={params.get('min_clv', 0):.1f} rev={params.get('reversal', '')}"
        )

    best = study.best_trial
    print(f"\n{'=' * 100}")
    print(f"BEST PARAMETERS:")
    print(f"{'=' * 100}")
    for k, v in best.params.items():
        print(f"  {k}: {v}")
    print(f"\n  Total PnL: {best.user_attrs.get('total_pnl', 0):+.1f}")
    print(f"  Trades: {best.user_attrs.get('trades', 0)}")
    print(f"  Win Rate: {best.user_attrs.get('win_rate', 0):.1f}%")
    print(f"  EOD Flattens: {best.user_attrs.get('eod_count', 0)}")

    # Save
    import json

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "orb_optimal_params.json")
    with open(out, "w") as f:
        json.dump(
            {
                "best_params": best.params,
                "best_value": best.value,
                "total_pnl": best.user_attrs.get("total_pnl", 0),
                "trades": best.user_attrs.get("trades", 0),
                "win_rate": best.user_attrs.get("win_rate", 0),
            },
            f,
            indent=2,
        )
    print(f"\nSaved: {out}")


if __name__ == "__main__":
    run()
