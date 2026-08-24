"""
Pre-trained Model Forecasting — Chronos (Amazon) on YOUR market data

Zero look-ahead guarantee:
  1. We load N bars from DuckDB (read_only=True)
  2. We split at a HARD cutoff: first (N - forecast_horizon) bars = CONTEXT
  3. The model ONLY sees context bars — it literally cannot access future bars
  4. We predict the next forecast_horizon bars
  5. We compare predictions against the ACTUAL bars that came after the cutoff
  6. Results saved as JSON for the dashboard to display

Usage:
  python scripts/pretrained-forecast.py --symbol MNQ --timeframe 300 --context 200 --horizon 20
  python scripts/pretrained-forecast.py --symbol ES --timeframe 3600 --context 500 --horizon 50
  python scripts/pretrained-forecast.py --symbol EURUSD --timeframe 60 --context 300 --horizon 30
"""

import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

import numpy as np
import torch

# ============================================================================
# CONFIGURATION
# ============================================================================

API_BASE = os.environ.get("API_BASE", "http://localhost:5000/api")
OUTPUT_DIR = Path(__file__).parent.parent / "data" / "forecasts"

MODEL_SIZES = {
    "tiny": "amazon/chronos-t5-tiny",  # 8M params, fastest
    "mini": "amazon/chronos-t5-mini",  # 20M params
    "small": "amazon/chronos-t5-small",  # 46M params
    "base": "amazon/chronos-t5-base",  # 200M params
    "large": "amazon/chronos-t5-large",  # 710M params, most accurate
}

TIMEFRAME_MAP = {
    60: "1m",
    300: "5m",
    900: "15m",
    1800: "30m",
    3600: "1h",
    14400: "4h",
    86400: "1d",
}

# ============================================================================
# DATA LOADING — via Express API (respects DuckDB mutex)
# ============================================================================


def load_bars(symbol: str, timeframe_sec: int, total_bars: int) -> list[dict]:
    """
    Load bars via the same API endpoint the price chart uses:
      /api/ohlcv/:symbol?timeframe=Xs&limit=N
    This goes through TimescaleDB/DuckDB with proper aggregation.
    """
    tf_label = TIMEFRAME_MAP.get(timeframe_sec, f"{timeframe_sec}s")

    # Same endpoint the TradingChart component calls in MarketData.tsx
    url = f"{API_BASE}/ohlcv/{symbol}?timeframe={timeframe_sec}s&limit={total_bars}&loadFromStart=true"
    print(f"[DATA] Fetching {total_bars} bars of {symbol} @ {tf_label} ...")
    print(f"[DATA] URL: {url}")

    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw_data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:500]
        print(f"[ERROR] HTTP {e.code}: {body}")
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] API request failed: {e}")
        print("[HINT] Make sure the dev server is running: npm run dev")
        sys.exit(1)

    # The endpoint returns an array directly
    if not isinstance(raw_data, list):
        raw_data = raw_data.get("data", raw_data.get("rows", []))

    print(f"[DATA] Got {len(raw_data)} bars")

    if len(raw_data) == 0:
        print(f"[ERROR] No data returned for {symbol} @ {tf_label}")
        sys.exit(1)

    # Normalize field names — API returns timestamp as ms string
    bars = []
    for row in raw_data:
        ts_raw = row.get("timestamp") or row.get("ts") or row.get("time") or ""
        # Convert ms timestamp to ISO string if numeric
        if isinstance(ts_raw, (int, float)) or (
            isinstance(ts_raw, str) and ts_raw.isdigit()
        ):
            from datetime import datetime, timezone

            ts_ms = int(ts_raw)
            ts_str = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat()
        else:
            ts_str = str(ts_raw)
        bars.append(
            {
                "ts": ts_str,
                "open": float(row.get("open", 0)),
                "high": float(row.get("high", 0)),
                "low": float(row.get("low", 0)),
                "close": float(row.get("close", 0)),
                "volume": float(row.get("volume", 0) or 0),
            }
        )

    # Ensure chronological order (endpoint may return latest first)
    if len(bars) >= 2:
        if bars[0]["ts"] > bars[-1]["ts"]:
            bars.reverse()

    print(f"[DATA] Loaded {len(bars)} bars: {bars[0]['ts']} → {bars[-1]['ts']}")
    return bars


# ============================================================================
# CHRONOS FORECASTING — strict no-look-ahead
# ============================================================================


def run_chronos_forecast(
    bars: list[dict],
    context_length: int,
    forecast_horizon: int,
    model_size: str = "small",
    num_samples: int = 20,
) -> dict:
    """
    Run Chronos forecast with HARD cutoff to prevent look-ahead.

    bars[0:context_length]           = CONTEXT (model sees ONLY these)
    bars[context_length:context_length+forecast_horizon] = ACTUALS (for comparison only, NEVER fed to model)
    """
    from chronos import ChronosPipeline

    # ── HARD CUTOFF: split data ──────────────────────────────────────
    context_bars = bars[:context_length]
    actual_bars = bars[context_length : context_length + forecast_horizon]

    if len(actual_bars) < forecast_horizon:
        print(
            f"[WARN] Only {len(actual_bars)} actual bars available for comparison "
            f"(requested {forecast_horizon}). Adjusting horizon."
        )
        forecast_horizon = len(actual_bars)

    if forecast_horizon == 0:
        raise ValueError("No actual bars available after cutoff for comparison!")

    print(f"\n{'=' * 60}")
    print(f"  LOOK-AHEAD PREVENTION PROOF")
    print(f"{'=' * 60}")
    print(f"  Context bars:  {len(context_bars)} (model sees ONLY these)")
    print(f"  Context range: {context_bars[0]['ts']} → {context_bars[-1]['ts']}")
    print(f"  ─── HARD WALL ── model cannot see past here ───")
    print(f"  Actual bars:   {len(actual_bars)} (for comparison ONLY)")
    print(f"  Actual range:  {actual_bars[0]['ts']} → {actual_bars[-1]['ts']}")
    print(f"{'=' * 60}\n")

    # ── Extract close prices for context ─────────────────────────────
    context_closes = torch.tensor(
        [b["close"] for b in context_bars], dtype=torch.float32
    )

    # ── Load pre-trained model ───────────────────────────────────────
    model_id = MODEL_SIZES.get(model_size, MODEL_SIZES["small"])
    print(f"[MODEL] Loading Chronos {model_size} ({model_id})...")
    print(f"[MODEL] This may download ~200MB on first run...")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[MODEL] Using device: {device}")

    pipeline = ChronosPipeline.from_pretrained(
        model_id,
        device_map=device,
        torch_dtype=torch.float32,
    )

    # ── Generate forecast ────────────────────────────────────────────
    print(
        f"[FORECAST] Generating {num_samples} sample paths, {forecast_horizon} bars ahead..."
    )
    t0 = time.time()

    forecast = pipeline.predict(
        inputs=context_closes.unsqueeze(0),  # [1, context_length]
        prediction_length=forecast_horizon,
        num_samples=num_samples,
    )
    # forecast shape: [1, num_samples, forecast_horizon]

    elapsed = time.time() - t0
    print(f"[FORECAST] Done in {elapsed:.1f}s")

    # ── Compute statistics ───────────────────────────────────────────
    samples = forecast[0].numpy()  # [num_samples, forecast_horizon]
    median = np.median(samples, axis=0).tolist()
    mean = np.mean(samples, axis=0).tolist()
    low_10 = np.percentile(samples, 10, axis=0).tolist()
    low_25 = np.percentile(samples, 25, axis=0).tolist()
    high_75 = np.percentile(samples, 75, axis=0).tolist()
    high_90 = np.percentile(samples, 90, axis=0).tolist()

    actual_closes = [b["close"] for b in actual_bars[:forecast_horizon]]

    # ── Compute error metrics ────────────────────────────────────────
    errors = [abs(m - a) for m, a in zip(median, actual_closes)]
    mae = sum(errors) / len(errors)
    pct_errors = [abs(m - a) / a * 100 for m, a in zip(median, actual_closes)]
    mape = sum(pct_errors) / len(pct_errors)

    # Direction accuracy: did the model predict the right direction?
    direction_correct = 0
    for i in range(len(actual_closes)):
        pred_dir = 1 if median[i] > context_closes[-1].item() else -1
        actual_dir = 1 if actual_closes[i] > context_closes[-1].item() else -1
        if pred_dir == actual_dir:
            direction_correct += 1
    direction_accuracy = direction_correct / len(actual_closes) * 100

    print(f"\n[RESULTS] MAE: {mae:.4f}")
    print(f"[RESULTS] MAPE: {mape:.2f}%")
    print(f"[RESULTS] Direction accuracy: {direction_accuracy:.1f}%")

    # ── Build result ─────────────────────────────────────────────────
    result = {
        "metadata": {
            "model": model_id,
            "model_size": model_size,
            "device": device,
            "num_samples": num_samples,
            "context_length": context_length,
            "forecast_horizon": forecast_horizon,
            "elapsed_seconds": round(elapsed, 2),
            "generated_at": datetime.now().isoformat(),
            "look_ahead_proof": {
                "context_end": context_bars[-1]["ts"],
                "forecast_start": actual_bars[0]["ts"],
                "model_saw_only": f"bars 0-{context_length - 1}",
                "compared_against": f"bars {context_length}-{context_length + forecast_horizon - 1}",
            },
        },
        "metrics": {
            "mae": round(mae, 6),
            "mape": round(mape, 4),
            "direction_accuracy": round(direction_accuracy, 2),
        },
        "context": {
            "timestamps": [b["ts"] for b in context_bars],
            "close": [b["close"] for b in context_bars],
            "open": [b["open"] for b in context_bars],
            "high": [b["high"] for b in context_bars],
            "low": [b["low"] for b in context_bars],
        },
        "forecast": {
            "timestamps": [b["ts"] for b in actual_bars[:forecast_horizon]],
            "median": [round(v, 6) for v in median],
            "mean": [round(v, 6) for v in mean],
            "low_10": [round(v, 6) for v in low_10],
            "low_25": [round(v, 6) for v in low_25],
            "high_75": [round(v, 6) for v in high_75],
            "high_90": [round(v, 6) for v in high_90],
            "actual_close": actual_closes,
        },
        "sample_paths": samples.tolist(),
    }

    return result


# ============================================================================
# MAIN
# ============================================================================


def main():
    parser = argparse.ArgumentParser(
        description="Pre-trained model forecast on market data"
    )
    parser.add_argument(
        "--symbol", type=str, default="ES", help="Symbol (e.g., ES, MNQ, EURUSD)"
    )
    parser.add_argument(
        "--timeframe",
        type=int,
        default=3600,
        help="Timeframe in seconds (60=1m, 300=5m, 3600=1H)",
    )
    parser.add_argument(
        "--context", type=int, default=200, help="Context bars (model input)"
    )
    parser.add_argument(
        "--horizon", type=int, default=20, help="Forecast horizon (bars ahead)"
    )
    parser.add_argument(
        "--model-size",
        type=str,
        default="small",
        choices=MODEL_SIZES.keys(),
        help="Model size: tiny/mini/small/base/large",
    )
    parser.add_argument(
        "--samples", type=int, default=20, help="Number of sample paths"
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output JSON path (auto-generated if omitted)",
    )
    args = parser.parse_args()

    # Total bars needed = context + horizon (horizon bars are for comparison only)
    total_bars = args.context + args.horizon + 10  # +10 buffer

    # Load data
    bars = load_bars(args.symbol, args.timeframe, total_bars)

    if len(bars) < args.context + args.horizon:
        print(
            f"[ERROR] Only {len(bars)} bars available, need {args.context + args.horizon}"
        )
        sys.exit(1)

    # Run forecast
    result = run_chronos_forecast(
        bars=bars,
        context_length=args.context,
        forecast_horizon=args.horizon,
        model_size=args.model_size,
        num_samples=args.samples,
    )

    # Add symbol/timeframe to metadata
    result["metadata"]["symbol"] = args.symbol
    result["metadata"]["timeframe_sec"] = args.timeframe
    result["metadata"]["timeframe_label"] = TIMEFRAME_MAP.get(
        args.timeframe, f"{args.timeframe}s"
    )

    # Save
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if args.output:
        out_path = Path(args.output)
    else:
        tf_label = TIMEFRAME_MAP.get(args.timeframe, f"{args.timeframe}s")
        out_path = (
            OUTPUT_DIR / f"chronos_{args.symbol}_{tf_label}_{args.model_size}.json"
        )

    with open(out_path, "w") as f:
        json.dump(result, f, indent=2)

    print(f"\n[SAVED] {out_path} ({out_path.stat().st_size / 1024:.1f} KB)")
    print(f"\n{'=' * 60}")
    print(
        f"  Summary: Chronos {args.model_size} on {args.symbol} {TIMEFRAME_MAP.get(args.timeframe, '')}"
    )
    print(f"  Context: {args.context} bars | Horizon: {args.horizon} bars")
    print(f"  MAE: {result['metrics']['mae']:.4f}")
    print(f"  MAPE: {result['metrics']['mape']:.2f}%")
    print(f"  Direction: {result['metrics']['direction_accuracy']:.1f}%")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
