"""
Long-lived TA-Lib candlestick-pattern worker.

Speaks JSON lines on stdin/stdout so the Node server can compute a pattern the
moment it is clicked, the way MotiveWave, Quantower, NinjaTrader and TradingView
do it — the indicator is a calculation over the bars on screen, not a row set
fetched from a table someone remembered to materialize.

Why a worker rather than a table
--------------------------------
`talib_candle_patterns` only ever carried 1m/5m/15m for a three-month window, so
a request for 1d fell through to browser-side approximations and marked the
wrong bars. A calculation has no coverage: whatever bars arrive get scored.

Why a worker rather than a TypeScript port
------------------------------------------
This IS TA-Lib — the same C library the rest of the stack cites — so the numbers
are correct by construction rather than by a reviewer's confidence in a rewrite.
The 60-odd browser detectors are hand-written approximations and disagree with it
on real bars. Spawning per request would cost ~700ms of interpreter start; one
resident process answers in single-digit milliseconds.

Protocol
--------
Request  {"id": str, "op": "patterns", "names": [str, ...] | null,
          "open": [float], "high": [float], "low": [float], "close": [float]}
Response {"id": str, "ok": true, "series": {name: [[index, value], ...]}}
Request  {"id": str, "op": "catalog"}
Response {"id": str, "ok": true, "patterns": [{name, function, bars, penetration}]}
Failure  {"id": str, "ok": false, "error": str}

Only non-zero bars are returned. TA-Lib emits 0 for "did not fire", and across 61
patterns over a few thousand bars that is millions of zeros nobody draws.

`value` passes through TA-Lib's own magnitude, scaled by 100: +/-100 for most
patterns, +/-80 for engulfing/harami/haramicross, +/-200 for hikkake/hikkakemod.
Sign is direction, magnitude is the pattern's own statement about itself, and the
existing chart code already reads this [-2, 2] convention.
"""
from __future__ import annotations

import json
import sys

import numpy as np
import talib
# Imported by name, not reached as `talib.abstract`: plain `import talib` does
# not bind the submodule, so the attribute lookup raises and a try/except around
# it quietly reports lookback 0 for all 61 patterns — which is wrong for every
# one of them and invisible, because 0 is a plausible-looking number.
from talib import abstract


def _pattern_functions() -> dict[str, str]:
    """Bare pattern name -> TA-Lib function name, for all 61."""
    names = talib.get_function_groups()["Pattern Recognition"]
    return {fn[3:].lower(): fn for fn in names}


PATTERNS = _pattern_functions()

# TA-Lib's own lookback per pattern: the count of leading bars it refuses to
# score, because its thresholds (BodyLong, BodyDoji, ShadowShort, Near, Far...)
# are rolling averages over a trailing window rather than fixed ratios. Doji
# needs 10 prior bars, three-black-crows 13. Any rewrite that hardcodes a ratio
# marks bars TA-Lib will not, which is the discrepancy this worker removes.
#
# Deliberately not wrapped in try/except: a lookback this layer cannot read is a
# broken install, and reporting 0 would hide it behind a believable number.
LOOKBACK = {name: int(getattr(abstract, fn).lookback) for name, fn in PATTERNS.items()}

# The patterns whose C signature takes a penetration factor. TA-Lib's defaults
# are used; they are part of the library's definition of the pattern, not a
# tuning knob this layer should invent a value for.
PENETRATION_DEFAULTS = {
    "abandonedbaby": 0.3,
    "darkcloudcover": 0.5,
    "eveningdojistar": 0.3,
    "eveningstar": 0.3,
    "mathold": 0.5,
    "morningdojistar": 0.3,
    "morningstar": 0.3,
}


def _run(name: str, o, h, l, c) -> np.ndarray:
    fn = getattr(talib, PATTERNS[name])
    if name in PENETRATION_DEFAULTS:
        return fn(o, h, l, c, penetration=PENETRATION_DEFAULTS[name])
    return fn(o, h, l, c)


def handle(request: dict) -> dict:
    rid = request.get("id")
    op = request.get("op", "patterns")

    if op == "catalog":
        return {
            "id": rid,
            "ok": True,
            "patterns": [
                {
                    "name": name,
                    "function": fn,
                    "lookback": LOOKBACK[name],
                    "penetration": PENETRATION_DEFAULTS.get(name),
                }
                for name, fn in sorted(PATTERNS.items())
            ],
        }

    if op != "patterns":
        return {"id": rid, "ok": False, "error": f"Unknown op '{op}'"}

    try:
        o = np.asarray(request["open"], dtype=np.float64)
        h = np.asarray(request["high"], dtype=np.float64)
        l = np.asarray(request["low"], dtype=np.float64)
        c = np.asarray(request["close"], dtype=np.float64)
    except (KeyError, TypeError, ValueError) as exc:
        return {"id": rid, "ok": False, "error": f"Bad OHLC payload: {exc}"}

    if not (len(o) == len(h) == len(l) == len(c)):
        return {
            "id": rid,
            "ok": False,
            "error": (
                f"OHLC arrays disagree on length: open={len(o)} high={len(h)} "
                f"low={len(l)} close={len(c)}"
            ),
        }
    if len(c) == 0:
        return {"id": rid, "ok": True, "series": {}}

    requested = request.get("names") or sorted(PATTERNS)
    unknown = [n for n in requested if n not in PATTERNS]
    if unknown:
        return {
            "id": rid,
            "ok": False,
            "error": (
                f"Unknown TA-Lib pattern(s): {', '.join(unknown)}. "
                f"TA-Lib defines {len(PATTERNS)} candlestick patterns."
            ),
        }

    series: dict[str, list] = {}
    for name in requested:
        try:
            out = _run(name, o, h, l, c)
        except Exception as exc:  # a single bad pattern must not kill the batch
            return {"id": rid, "ok": False, "error": f"{name}: {exc}"}
        hits = np.nonzero(out)[0]
        if hits.size:
            # int() on the value keeps the wire payload compact; TA-Lib's output
            # is integral by construction.
            series[name] = [[int(i), int(out[i])] for i in hits]

    return {"id": rid, "ok": True, "series": series}


def main() -> None:
    # Unbuffered line-at-a-time both ways: the Node side correlates by `id`, so a
    # half-flushed line would stall a request that has already been answered.
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            sys.stdout.write(json.dumps({"id": None, "ok": False, "error": f"Bad JSON: {exc}"}) + "\n")
            sys.stdout.flush()
            continue
        try:
            response = handle(request)
        except Exception as exc:  # never let one request take the worker down
            response = {"id": request.get("id"), "ok": False, "error": str(exc)}
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
