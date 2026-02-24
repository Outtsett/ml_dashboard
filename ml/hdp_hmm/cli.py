"""
HDP-HMM Command-Line Interface
================================

Argparse-based CLI for training single-symbol, all-symbols,
or universal multi-symbol HDP-HMM regime models.
"""

import argparse
import json
import sys
import traceback
from pathlib import Path

from .config import (
    ALL_SYMBOLS,
    DEFAULT_INDICATOR_GROUPS,
    INDICATOR_GROUPS,
    TIMEFRAME_MAP,
)
from .training import train_hdp_hmm, train_universal


def main() -> None:
    """Entry point for HDP-HMM training CLI."""

    parser = argparse.ArgumentParser(
        description="Train true HDP-HMM regime detector (auto-discovers # regimes)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Single symbol -- K is discovered automatically
  python -m ml.hdp_hmm --symbol EURUSD --timeframe 1d

  # More Gibbs iterations for thorough exploration
  python -m ml.hdp_hmm --symbol ES --timeframe 30m --gibbs-iter 200

  # Higher gamma = more willing to create new regimes
  python -m ml.hdp_hmm --symbol NQ --timeframe 1h --gamma 10

  # Higher kappa = stickier regimes (longer durations)
  python -m ml.hdp_hmm --symbol CL --timeframe 4h --kappa 100

  # All symbols (trains each independently)
  python -m ml.hdp_hmm --all-symbols --timeframe 1d

  # UNIVERSAL model (trains ONE model on ALL symbols together)
  python -m ml.hdp_hmm --universal --timeframe 30m

  # Universal with specific symbols
  python -m ml.hdp_hmm --universal --symbols ES,NQ,CL,GC --timeframe 1h

  # Include pre-computed indicators
  python -m ml.hdp_hmm --symbol ES --timeframe 1d --include-indicators

  # Only specific indicator groups
  python -m ml.hdp_hmm --symbol ES --timeframe 1d --include-indicators --indicator-groups momentum,trend,volatility

  # Universal + indicators
  python -m ml.hdp_hmm --universal --timeframe 1d --include-indicators
        """,
    )

    parser.add_argument("--symbol", type=str, default="MNQ", help="Symbol to train on")
    parser.add_argument(
        "--all-symbols",
        action="store_true",
        help="Train all symbols (each independently)",
    )
    parser.add_argument(
        "--universal",
        action="store_true",
        help="Train ONE universal model on all symbols combined",
    )
    parser.add_argument(
        "--symbols",
        type=str,
        default=None,
        help="Comma-separated symbols for universal mode (e.g., ES,NQ,CL,GC)",
    )
    parser.add_argument("--timeframe", type=str, default="1m", help="Timeframe")
    parser.add_argument(
        "--start", type=str, default=None, help="Start date (YYYY-MM-DD)"
    )
    parser.add_argument("--end", type=str, default=None, help="End date (YYYY-MM-DD)")
    parser.add_argument(
        "--gibbs-iter",
        type=int,
        default=100,
        help="Gibbs sampling iterations (default: 100)",
    )
    parser.add_argument(
        "--burn-in",
        type=int,
        default=30,
        help="Burn-in iterations to discard (default: 30)",
    )
    parser.add_argument(
        "--test-split",
        type=float,
        default=0.15,
        help="Held-out test fraction (default: 0.15)",
    )
    parser.add_argument(
        "--wf-windows", type=int, default=5, help="Walk-forward windows (default: 5)"
    )
    parser.add_argument(
        "--alpha",
        type=float,
        default=1.0,
        help="Transition concentration (default: 1.0)",
    )
    parser.add_argument(
        "--gamma",
        type=float,
        default=5.0,
        help="Top-level DP concentration -- higher=more regimes (default: 5.0)",
    )
    parser.add_argument(
        "--kappa",
        type=float,
        default=50.0,
        help="Stickiness -- higher=longer regime durations (default: 50.0)",
    )
    parser.add_argument(
        "--json", action="store_true", help="Output diagnostics JSON to stdout"
    )
    parser.add_argument(
        "--data-file",
        type=str,
        default=None,
        help="Pre-exported parquet file path (bypasses DuckDB file lock)",
    )
    parser.add_argument(
        "--data-dir",
        type=str,
        default=None,
        help=(
            "Directory of pre-exported parquet files (universal mode, one per symbol)"
        ),
    )
    parser.add_argument(
        "--include-indicators",
        action="store_true",
        default=True,
        help="Merge pre-computed pandas-ta indicators -- ON by default (use --no-indicators to disable)",
    )
    parser.add_argument(
        "--no-indicators",
        action="store_true",
        default=False,
        help="Disable pre-computed indicators (use only 12 core features)",
    )
    parser.add_argument(
        "--indicator-groups",
        type=str,
        default=None,
        help=(
            "Comma-separated indicator groups to include "
            "(e.g., momentum,trend,volatility). "
            "Default: ALL groups (momentum,trend,volatility,volume,overlap,candle,statistics,cycle)"
        ),
    )
    parser.add_argument(
        "--all-features",
        action="store_true",
        default=False,
        help="Use ALL indicator columns (ignore group filtering, load every non-skip column)",
    )
    parser.add_argument(
        "--train-window-weeks",
        type=int,
        default=8,
        help="Rolling training window size in weeks (default: 8)",
    )
    parser.add_argument(
        "--step-weeks",
        type=int,
        default=2,
        help="Walk-forward step size in weeks (default: 2)",
    )
    parser.add_argument(
        "--wf-gibbs-iter",
        type=int,
        default=50,
        help="Gibbs iterations per walk-forward window (default: 50)",
    )

    args = parser.parse_args()

    if args.timeframe not in TIMEFRAME_MAP:
        print(
            f"Error: Unknown timeframe '{args.timeframe}'. "
            f"Valid: {list(TIMEFRAME_MAP.keys())}"
        )
        sys.exit(1)

    all_results: list = []

    # Parse indicator groups
    # Indicators ON by default; --no-indicators disables them
    use_indicators = args.include_indicators and not args.no_indicators
    ind_groups = None
    if use_indicators:
        if args.all_features:
            # None = load ALL non-skip columns (no group filter)
            ind_groups = None
        elif args.indicator_groups:
            ind_groups = [g.strip() for g in args.indicator_groups.split(",")]
            valid = set(INDICATOR_GROUPS.keys())
            invalid = [g for g in ind_groups if g not in valid]
            if invalid:
                print(
                    f"Error: Unknown indicator groups: {invalid}. "
                    f"Valid: {sorted(valid)}"
                )
                sys.exit(1)
        else:
            ind_groups = list(DEFAULT_INDICATOR_GROUPS)

    if args.universal:
        # Universal mode: train ONE model on multiple symbols
        if args.symbols:
            symbols = [s.strip().upper() for s in args.symbols.split(",")]
        else:
            symbols = ALL_SYMBOLS

        # Build data_files dict from --data-dir if provided
        data_files = None
        if args.data_dir:
            data_dir = Path(args.data_dir)
            if data_dir.exists():
                data_files = {}
                for sym in symbols:
                    pf = data_dir / f"{sym}.parquet"
                    if pf.exists():
                        data_files[sym] = str(pf)
                    else:
                        print(f"  WARNING: no parquet for {sym} in {data_dir}")

        try:
            result = train_universal(
                symbols=symbols,
                timeframe=args.timeframe,
                start=args.start,
                end=args.end,
                gibbs_iter=args.gibbs_iter,
                burn_in=args.burn_in,
                test_split=args.test_split,
                walk_forward_windows=args.wf_windows,
                alpha=args.alpha,
                gamma=args.gamma,
                kappa=args.kappa,
                data_files=data_files,
                include_indicators=use_indicators,
                indicator_groups=ind_groups,
            )
            all_results.append(result)
        except Exception as e:  # pylint: disable=broad-exception-caught
            print(f"\n  ERROR in universal training: {e}")
            traceback.print_exc()
    else:
        # Single-symbol or all-symbols mode (each independently)
        symbols = ALL_SYMBOLS if args.all_symbols else [args.symbol.upper()]

        for sym in symbols:
            try:
                result = train_hdp_hmm(
                    symbol=sym,
                    timeframe=args.timeframe,
                    gibbs_iter=args.gibbs_iter,
                    burn_in=args.burn_in,
                    walk_forward_windows=args.wf_windows,
                    alpha=args.alpha,
                    gamma=args.gamma,
                    kappa=args.kappa,
                    indicator_groups=ind_groups,
                    train_window_weeks=args.train_window_weeks,
                    step_weeks=args.step_weeks,
                    wf_gibbs_iter=args.wf_gibbs_iter,
                    data_file=args.data_file,
                )
                all_results.append(result)
            except Exception as e:  # pylint: disable=broad-exception-caught
                print(f"\n  ERROR training {sym}: {e}")
                traceback.print_exc()

    if args.json and all_results:
        print("\n__JSON_OUTPUT__")
        print(
            json.dumps(
                all_results if len(all_results) > 1 else all_results[0],
                default=str,
            )
        )
