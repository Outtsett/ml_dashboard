"""Land the dashboard-definition support / resistance zone features (packages/ml-engine/packages/shared/src/zones.py) for a
symbol and timeframe, on EXACTLY the bars the Market chart serves (``/api/charts/ohlcv``, ratio-
adjusted so the newest contract is unscaled), as a derived dataset the dashboard reads back
(``derived_zone_features_<timeframe>``), then draw the chart's window on the Market chart through the chart link.

    .venv/Scripts/python.exe scripts/land_zone_features.py --symbol MNQ --timeframe 5m --start 2019-06-01

Columns follow the training spec: support_zone, resistance_zone, zone_strength, plus the zone prices,
strengths, counts, bandwidth and pivot confirmations. One definition — the chart's — one dataset.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(ROOT / "src"))

from shared import protocol, zones  # noqa: E402

DATASET = "zone_features"   # one dataset per timeframe: zone_features_<timeframe>
COLOURS = {"support": "#0072B2", "resistance": "#E69F00", "level": "#56B4E9"}


def fetch_chart_bars(symbol: str, timeframe: str, start_ms: int, end_ms: int) -> pd.DataFrame:
    """Every bar the chart would draw between ``start_ms`` and ``end_ms``, on the chart's own price scale.

    The route returns the newest ``limit`` bars of a window with the window's newest contract unscaled
    and earlier contracts ratio-adjusted to it (as the chart draws), so the pages are read backwards,
    each overlapping the next by one bar, and every older page is scaled by the ratio of the two
    prices of that shared bar — the chart's own roll rule carried across pages."""
    from lake import dashboard

    pages: list[pd.DataFrame] = []
    cursor_end = end_ms
    factor = 1.0
    while cursor_end > start_ms:
        chunk = dashboard._fetch_bar_rows(symbol, timeframe, start_ms, cursor_end)  # noqa: SLF001 - the chart's own request
        if not chunk:
            break
        page = pd.DataFrame(chunk).sort_values("timestamp").reset_index(drop=True)
        if pages:
            newer = pages[-1]
            shared = newer.loc[newer["timestamp"] == page["timestamp"].iloc[-1], "close"]
            if len(shared) and float(page["close"].iloc[-1]) > 0:
                factor *= float(shared.iloc[0]) / float(page["close"].iloc[-1])
            page = page[page["timestamp"] < newer["timestamp"].iloc[0]]
        for column in ("open", "high", "low", "close"):
            page[column] = page[column].astype(float) * factor
        pages.append(page)
        protocol.emit_log(f"[bars] {sum(len(p) for p in pages):,} so far, back to {datetime.fromtimestamp(int(page['timestamp'].iloc[0]) / 1000, tz=timezone.utc):%Y-%m-%d %H:%M}"
                          + (f" (scaled x{factor:.6f})" if factor != 1.0 else ""))
        if len(chunk) < dashboard._MAX_BARS_PER_REQUEST:  # noqa: SLF001
            break
        cursor_end = int(page["timestamp"].iloc[0])   # the oldest bar of this page is the shared bar of the next
    frame = pd.concat(pages[::-1], ignore_index=True).drop_duplicates("timestamp").sort_values("timestamp").reset_index(drop=True)
    frame["time"] = frame["timestamp"] // 1000
    return frame


def overlays_for_window(features: pd.DataFrame, context: dict, symbol: str) -> list[dict]:
    """Markers where the spec's flags fire inside the chart's visible window, and the zones as of the
    window's last bar as level lines labelled with their touches."""
    from lake import dashboard

    start, end = int(context["visibleStartMs"]) // 1000, int(context["visibleEndMs"]) // 1000
    window = features[(features["time"] >= start) & (features["time"] <= end)]
    if window.empty:
        window = features.tail(400)
    overlays = []
    touched = window[window["support_zone"] == 1]
    if len(touched):
        overlays.append(dashboard.markers("support_zone", [{"time": int(t) * 1000, "position": "below", "shape": "arrowUp", "text": f"support x{int(k)}"}
                                                           for t, k in zip(touched["time"], touched["support_zone_strength"])][-1500:],
                                          label="Support touch (low within the bandwidth of a support zone)", color=COLOURS["support"]))
    touched = window[window["resistance_zone"] == 1]
    if len(touched):
        overlays.append(dashboard.markers("resistance_zone", [{"time": int(t) * 1000, "position": "above", "shape": "arrowDown", "text": f"resistance x{int(k)}"}
                                                              for t, k in zip(touched["time"], touched["resistance_zone_strength"])][-1500:],
                                          label="Resistance touch (high within the bandwidth of a resistance zone)", color=COLOURS["resistance"]))
    last = window.iloc[-1]
    overlays.append(dashboard.line("zone_price_support", window["time"] * 1000, window["zone_price_support"], label="Support zone (nearest)", color=COLOURS["support"]))
    overlays.append(dashboard.line("zone_price_resistance", window["time"] * 1000, window["zone_price_resistance"], label="Resistance zone (nearest)", color=COLOURS["resistance"]))
    overlays.append(dashboard.line("zone_strength", window["time"] * 1000, window["zone_strength"], label="Zone strength (touches of the support or resistance zone being touched)", color=COLOURS["level"], pane="pane"))
    protocol.emit_log(f"[overlays] window {datetime.fromtimestamp(start, tz=timezone.utc):%Y-%m-%d} .. {datetime.fromtimestamp(end, tz=timezone.utc):%Y-%m-%d}: "
                      f"{int(window['support_zone'].sum())} support touches, {int(window['resistance_zone'].sum())} resistance touches, "
                      f"bandwidth at the last bar {float(last['bandwidth_points']):.2f} points")
    return overlays


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--symbol", default="MNQ")
    parser.add_argument("--timeframe", default=None, help="Default: the Market chart's current timeframe")
    parser.add_argument("--start", default="2019-06-01")
    parser.add_argument("--end", default=None, help="Default: the chart's last loaded bar")
    parser.add_argument("--lookback", type=int, default=zones.PIVOT_LOOKBACK)
    parser.add_argument("--bandwidth-multiple", type=float, default=zones.BANDWIDTH_TRUE_RANGE_MULTIPLE)
    parser.add_argument("--window-bars", type=int, default=None, help="The chart's window (default: what the chart loads for the timeframe; 0 = all bars so far)")
    parser.add_argument("--max-levels", type=int, default=zones.MAX_LEVELS, help="Most-touched zones kept, as the chart draws them; 0 = every zone")
    parser.add_argument("--recipe", default=None)
    parser.add_argument("--output-dir", default=str(ROOT / "data" / "models"))
    parser.add_argument("--no-land", action="store_true")
    parser.add_argument("--no-draw", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    started = time.monotonic()
    from lake import dashboard

    context = dashboard.fetch_chart_context() or {}
    if not args.timeframe:
        args.timeframe = str(context.get("timeframe") or "5m")
    if args.window_bars is None:
        args.window_bars = zones.chart_window_bars(args.timeframe)
    start_ms = int(pd.Timestamp(args.start).timestamp() * 1000)
    end_ms = int(pd.Timestamp(args.end).timestamp() * 1000) if args.end else int(context.get("lastBarMs") or pd.Timestamp.now(tz="UTC").timestamp() * 1000)
    bars = fetch_chart_bars(args.symbol, args.timeframe, start_ms, end_ms)
    protocol.emit_log(f"[data] {args.symbol} {args.timeframe}: {len(bars):,} bars from the chart's own route, "
                      f"{datetime.fromtimestamp(bars['time'].iloc[0], tz=timezone.utc):%Y-%m-%d} .. {datetime.fromtimestamp(bars['time'].iloc[-1], tz=timezone.utc):%Y-%m-%d}")
    t0 = time.monotonic()
    features = zones.zone_features(bars, lookback=args.lookback, bandwidth_multiple=args.bandwidth_multiple, window_bars=args.window_bars,
                                   max_levels=args.max_levels or None)
    protocol.emit_log(f"[zones] computed in {time.monotonic() - t0:.1f}s: {int(features['pivot_high'].sum()):,} pivot highs, {int(features['pivot_low'].sum()):,} pivot lows; "
                      f"support_zone on {features['support_zone'].mean():.1%} of bars, resistance_zone on {features['resistance_zone'].mean():.1%}; "
                      f"zone_strength when touched: median {float(features.loc[features['zone_strength'] > 0, 'zone_strength'].median()):.0f}, "
                      f"max {int(features['zone_strength'].max())}; final bandwidth {float(features['bandwidth_points'].iloc[-1]):.2f} points; window {args.window_bars:,} bars")
    table = features.drop(columns=["time"])
    table.insert(0, "timestamp", pd.to_datetime(features["time"], unit="s"))
    table.insert(0, "timeframe", args.timeframe)
    table.insert(0, "symbol", args.symbol)
    table["pivot_lookback_bars"] = args.lookback
    table["bandwidth_true_range_multiple"] = args.bandwidth_multiple
    table["window_bars"] = args.window_bars
    table["maximum_levels"] = args.max_levels
    recipe = args.recipe or f"{args.symbol}_{args.timeframe}_lookback{args.lookback}_band{str(args.bandwidth_multiple).replace('.', 'p')}_top{args.max_levels}_window{args.window_bars}"
    directory = os.path.join(args.output_dir, f"zone_features_{recipe}")
    from ta_strategy import store

    paths = store.write_local({"zone_features": table}, directory)
    landing = None
    if not args.no_land:
        landing = store.land(paths, recipe, f"dashboard-definition S/R zone features for {args.symbol} {args.timeframe} on the chart's bars",
                             dataset=f"{DATASET}_{args.timeframe}")
        for name, info in landing.items():
            protocol.emit_log(f"[save] {name}: {info['rows']:,} rows -> {info['uri']} (manifest {info['manifest']})")
    if not args.no_draw and context.get("symbol") == args.symbol:
        status = dashboard.push_overlays("zone_features", context, overlays_for_window(features, context, args.symbol))
        protocol.emit_log(f"[chart] {status.message}")
    elif not args.no_draw:
        protocol.emit_log(f"[chart] not drawn: the Market chart shows {context.get('symbol') or 'nothing'}, not {args.symbol}")
    protocol.emit_done(directory, {"recipe": recipe, "rows": int(len(table)), "lake": landing, "seconds": time.monotonic() - started})
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        import traceback

        protocol.emit_error(f"{type(error).__name__}: {error}", traceback.format_exc())
        raise SystemExit(1)
