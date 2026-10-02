"""Contract rolls in a stitched futures series, and additive (Panama) back-adjustment.

The lake's bare-root futures series (``symbol == root``, e.g. ``MNQ``) is RAW
traded prices spliced at each roll — not back-adjusted
(`datalake/scripts/promote_mnq_continuous.py`: 0 of 96.7M closes off the tick
grid). Two contracts on the same day trade at different prices (the calendar
spread), so the splice prints a step: measured on MNQ, +241.75 points at the
2025-09-15 MNQU5→MNQZ5 roll and +256.75 at the 2025-12-15 MNQZ5→MNQH6 roll.
Unadjusted, a position held across that bar books the step as profit or loss
(±$513 per MNQ contract on one bar), the bar's label is forced up, and every
return feature sees a spike that no trader could have captured.

Additive back-adjustment shifts every bar BEFORE a roll by that roll's gap, so:
  - the roll bar's move is the real move of the new contract;
  - every point move inside a contract segment is unchanged, which is what the
    simulator's USD P&L (points × point value) needs — a ratio adjustment would
    rescale those moves;
  - the newest contract's prices are exactly as traded; older segments read as
    "today's contract terms".

Where a bar came from is found by matching its close to the per-contract bars
at the same timestamp (the per-contract and stitched views bucket the same
1-second bars, so a match is exact — measured 29,121 of 29,121 MNQ 5m bars over
2025-08..12, none ambiguous). The gap is the new contract's close minus the old
contract's close at the old segment's last bar, when both traded.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# How far back from a roll to look for a bar both contracts traded.
GAP_SEARCH_BARS = 12


@dataclass(frozen=True)
class Roll:
    index: int              # first bar that came from the new contract
    timestamp: int          # its epoch seconds
    from_contract: str
    to_contract: str
    gap_points: float       # new close - old close at a bar both traded (see `measured_at`)
    measured_at: int        # epoch seconds of that bar
    exact: bool             # False: no common bar, the gap is new open - old close (includes one bar's move)

    def as_plan(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "fromContract": self.from_contract,
            "toContract": self.to_contract,
            "gapPoints": self.gap_points,
            "exact": self.exact,
        }


def source_contracts(
    timestamps: np.ndarray,
    close: np.ndarray,
    contract_rows: list[tuple[str, int, float, float]],
) -> list[str | None]:
    """The contract each stitched bar came from: the contract whose close at that
    timestamp equals the bar's close (highest volume when several match). A bar
    no contract matches inherits the previous bar's contract."""
    by_time: dict[int, list[tuple[str, float, float]]] = {}
    for symbol, timestamp, contract_close, volume in contract_rows:
        by_time.setdefault(int(timestamp), []).append((symbol, float(contract_close), float(volume or 0.0)))
    sources: list[str | None] = []
    previous: str | None = None
    for timestamp, bar_close in zip(timestamps.tolist(), close.tolist()):
        matches = [(symbol, volume) for symbol, contract_close, volume in by_time.get(int(timestamp), []) if contract_close == bar_close]
        if matches:
            previous = max(matches, key=lambda match: match[1])[0]
        sources.append(previous)
    return sources


def find_rolls(
    timestamps: np.ndarray,
    open_prices: np.ndarray,
    close: np.ndarray,
    contract_rows: list[tuple[str, int, float, float]],
) -> list[Roll]:
    """Rolls in a stitched series, from its bars and the per-contract bars over
    the same span (``(symbol, epoch_seconds, close, volume)`` rows)."""
    sources = source_contracts(timestamps, close, contract_rows)
    close_of: dict[tuple[str, int], float] = {(symbol, int(t)): float(c) for symbol, t, c, _ in contract_rows}
    rolls: list[Roll] = []
    for index in range(1, len(sources)):
        old, new = sources[index - 1], sources[index]
        if old is None or new is None or old == new:
            continue
        gap = None
        measured_at = int(timestamps[index - 1])
        for back in range(1, min(GAP_SEARCH_BARS, index) + 1):
            t = int(timestamps[index - back])
            new_close = close_of.get((new, t))
            old_close = close_of.get((old, t))
            if new_close is not None and old_close is not None:
                gap, measured_at = new_close - old_close, t
                break
        exact = gap is not None
        if gap is None:
            gap = float(open_prices[index]) - float(close[index - 1])
        rolls.append(Roll(index, int(timestamps[index]), old, new, float(gap), measured_at, exact))
    return rolls


def back_adjust(
    open_prices: np.ndarray,
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    rolls: list[Roll],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Additive back-adjustment: every bar before a roll moves by that roll's gap
    (cumulatively across rolls). Returns adjusted open, high, low, close and the
    per-bar adjustment in points (0 on the newest contract)."""
    adjustment = np.zeros(close.shape[0], dtype=np.float64)
    for roll in rolls:
        adjustment[: roll.index] += roll.gap_points
    return open_prices + adjustment, high + adjustment, low + adjustment, close + adjustment, adjustment


def contract_rows_from_lake(con, root: str, timeframe: str, first: int, last: int) -> list[tuple[str, int, float, float]]:
    """Per-contract bars of a futures root over ``[first, last]`` epoch seconds,
    calendar spreads excluded, from the lake view for ``timeframe``. Empty when
    the timeframe has no pre-aggregated view or the root has no contracts."""
    from lake.serving import TIMEFRAME_VIEW

    view = TIMEFRAME_VIEW.get(timeframe)
    if view is None:
        return []
    rows = con.execute(
        f"SELECT symbol, CAST(epoch(timestamp) AS BIGINT), close, volume FROM {view} "
        "WHERE root = ? AND symbol <> root AND symbol NOT LIKE '%-%' "
        "AND timestamp >= to_timestamp(?) AND timestamp <= to_timestamp(?)",
        [root, int(first), int(last)],
    ).fetchall()
    return [(str(symbol), int(t), float(c), float(v or 0.0)) for symbol, t, c, v in rows]
