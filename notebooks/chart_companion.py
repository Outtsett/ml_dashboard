import marimo

__generated_with = "0.24.0"
app = marimo.App(width="full")


@app.cell
def _():
    import os

    import altair as alt
    import marimo as mo
    import numpy as np
    import pandas as pd
    from lake import dashboard
    from scipy import stats

    return alt, dashboard, mo, np, os, pd, stats


@app.cell
def _(mo):
    mo.md(r"""
# Chart companion — what the bars on your chart are doing

This notebook follows the Market chart. Whatever symbol, timeframe and stretch of time the chart
shows, this page reads **exactly those bars** (the same `/api/charts/ohlcv` request the chart makes)
and describes them: how far each bar moved, how wide it was, how much traded, and which bars were
unusual compared with the bars just before them. Scroll or zoom the chart and every number below
recomputes.

Think of it as a **second trader looking over your shoulder at the same screen**: you point at a
bar (click it on the chart) and it tells you how unusual that bar was, and it can mark the chart
for you (switch on *Draw on the chart*): arrows on the unusual moves, lines at the visible high,
low and volume-weighted average price, and shading where volatility ran hot.

Everything is **causal**: each bar is compared only with bars before it. The first bars of a window
have no score (shown blank, never zero) until enough history exists; the notebook reads extra bars
before the visible range so the first visible bar is already scored.
""")
    return


@app.cell
def _(dashboard, mo):
    follower = dashboard.follow_chart(mo)
    follower
    return (follower,)


@app.cell
def _(dashboard, follower, mo):
    context = dashboard.chart_context(follower)
    _clock = dashboard.clock_label(context)
    if context is None:
        _md = mo.md(f"""
**{dashboard.NOT_PUBLISHED}.** Open the Market page in the dashboard (http://127.0.0.1:5000) and this
notebook starts following it; nothing below can be computed until the chart says which bars it shows.
""")
    else:
        _selected = context.get("selectedMs")
        _selected_text = (
            f"The bar last clicked is **{dashboard.format_stamp(_selected)}** ({_clock})."
            if _selected is not None
            else "No bar is selected: click a bar on the chart to see it described below."
        )
        _md = mo.md(f"""
**{dashboard.describe_context(context)}.**

Times on this page are in the chart's own clock: **{_clock}**. {_selected_text}
""")
    _md
    return (context,)


@app.cell
def _(mo, os):
    window_slider = mo.ui.slider(10, 200, step=5, value=50, label="Trailing window (bars)", show_value=True)
    threshold_slider = mo.ui.slider(1.0, 4.0, step=0.1, value=2.0, label="Unusual-move threshold (|z|)", show_value=True)
    bin_slider = mo.ui.slider(10, 80, step=5, value=30, label="Histogram bins", show_value=True)
    log_count_checkbox = mo.ui.checkbox(label="Log-scale histogram counts")
    marker_checkbox = mo.ui.checkbox(value=True, label="Arrows on unusual moves")
    level_checkbox = mo.ui.checkbox(value=True, label="Visible high, low and volume-weighted average price")
    zone_checkbox = mo.ui.checkbox(value=True, label="High-volatility shading")
    selected_line_checkbox = mo.ui.checkbox(value=True, label="Vertical line at the selected bar")
    # Off by default so an automated export (the notebook health check) never
    # draws on the chart; CHART_COMPANION_DRAW_ON_START=1 turns it on at start.
    draw_switch = mo.ui.switch(value=os.environ.get("CHART_COMPANION_DRAW_ON_START") == "1", label="Draw on the chart")
    mo.vstack([
        mo.md("""
**Controls.** The *trailing window* is how many earlier bars each bar is compared with. The
*threshold* is how many standard deviations a return must sit from the window's average to count as
unusual. The checkboxes choose what is drawn when *Draw on the chart* is on.
"""),
        mo.hstack([window_slider, threshold_slider], justify="start"),
        mo.hstack([bin_slider, log_count_checkbox], justify="start"),
        mo.hstack([marker_checkbox, level_checkbox, zone_checkbox, selected_line_checkbox], justify="start"),
        draw_switch,
    ])
    return (
        bin_slider,
        draw_switch,
        level_checkbox,
        log_count_checkbox,
        marker_checkbox,
        selected_line_checkbox,
        threshold_slider,
        window_slider,
        zone_checkbox,
    )


@app.cell
def _(context, dashboard, mo, window_slider):
    # Two windows of warm-up: the return z-score needs `window` earlier returns,
    # and the volatility percentile ranks a trailing mean (one window) against
    # its own previous `window` values (a second window).
    warmup_bar_count = 2 * window_slider.value + 2
    bars_with_warmup = None
    if context is None:
        load_message = "No bars read: the chart has not published."
    else:
        try:
            bars_with_warmup = dashboard.chart_bars(context, extra_bars_before=warmup_bar_count)
            _visible = int((~bars_with_warmup["before_visible_range"]).sum())
            _warm = int(bars_with_warmup["before_visible_range"].sum())
            load_message = (
                f"Read {_visible:,} visible bars and {_warm:,} warm-up bars before them "
                f"from {dashboard.DASHBOARD_URL}/api/charts/ohlcv."
            )
            if _visible == 0:
                bars_with_warmup = None
                load_message = "The chart's visible range holds no bars."
        except dashboard.ChartLinkError as _error:
            load_message = f"No bars read: {_error}"
    mo.md(load_message)
    return (bars_with_warmup,)


@app.cell
def _(np, pd):
    def trailing_percentile(values, window):
        """For each position, the share of the previous `window` values that are
        at or below the current one (0 to 1). Missing until `window` earlier
        values exist, and missing if any of them is missing."""
        array = np.asarray(values, dtype=float)
        result = np.full(array.size, np.nan)
        for _index in range(window, array.size):
            _history = array[_index - window:_index]
            _current = array[_index]
            if np.isnan(_current) or np.isnan(_history).any():
                continue
            result[_index] = float((_history <= _current).mean())
        return pd.Series(result, index=getattr(values, "index", None))

    return (trailing_percentile,)


@app.cell
def _(bars_with_warmup, np, pd, trailing_percentile, window_slider):
    companion_bars = None
    if bars_with_warmup is not None:
        _frame = bars_with_warmup.copy()
        _window = window_slider.value
        _previous_close = _frame["close"].shift(1)
        _frame["log_return"] = np.log(_frame["close"] / _previous_close)
        # True range: the bar's full reach including any gap from the previous
        # close. Missing on the first bar (no previous close), never high - low.
        _frame["true_range_points"] = pd.concat(
            [
                _frame["high"] - _frame["low"],
                (_frame["high"] - _previous_close).abs(),
                (_frame["low"] - _previous_close).abs(),
            ],
            axis=1,
        ).max(axis=1, skipna=False)
        # The z-score compares each return with the `window` returns BEFORE it.
        _earlier = _frame["log_return"].shift(1)
        _frame["return_trailing_mean"] = _earlier.rolling(_window, min_periods=_window).mean()
        _frame["return_trailing_standard_deviation"] = _earlier.rolling(_window, min_periods=_window).std(ddof=1)
        _deviation = _frame["return_trailing_standard_deviation"].where(_frame["return_trailing_standard_deviation"] > 0)
        _frame["return_zscore"] = (_frame["log_return"] - _frame["return_trailing_mean"]) / _deviation
        _frame["return_percentile_in_window"] = trailing_percentile(_frame["log_return"], _window)
        _frame["trailing_true_range_points"] = _frame["true_range_points"].rolling(_window, min_periods=_window).mean()
        _frame["trailing_true_range_percentile"] = trailing_percentile(_frame["trailing_true_range_points"], _window)
        # Missing (not False) while the percentile is still warming up.
        _volatility_rank = _frame["trailing_true_range_percentile"]
        _frame["high_volatility"] = (_volatility_rank >= 0.9).astype("boolean").mask(_volatility_rank.isna())
        _frame["bar_time_text"] = _frame["timestamp"].dt.strftime("%Y-%m-%d %H:%M")
        companion_bars = _frame[~_frame["before_visible_range"]].reset_index(drop=True)
    return (companion_bars,)


@app.cell
def _(companion_bars, context, dashboard, mo, np, pd, stats):
    COLUMN_TITLES = {
        "open": "Open price",
        "high": "High price",
        "low": "Low price",
        "close": "Close price",
        "volume": "Volume",
        "log_return": "Log return (natural log of close over previous close)",
        "true_range_points": "True range (price points)",
    }

    def eight_number_summary(values):
        _finite = np.asarray(values, dtype=float)
        _finite = _finite[np.isfinite(_finite)]
        _count = _finite.size
        _constant = _count == 0 or float(np.ptp(_finite)) == 0.0
        _nan = float("nan")
        return {
            "count": float(_count),
            "mean": float(np.mean(_finite)) if _count else _nan,
            "median": float(np.median(_finite)) if _count else _nan,
            "standard deviation": float(np.std(_finite, ddof=1)) if _count > 1 else _nan,
            "skewness": float(stats.skew(_finite, bias=False)) if _count >= 3 and not _constant else _nan,
            "kurtosis (excess)": float(stats.kurtosis(_finite, bias=False)) if _count >= 4 and not _constant else _nan,
            "25th percentile": float(np.percentile(_finite, 25)) if _count else _nan,
            "75th percentile": float(np.percentile(_finite, 75)) if _count else _nan,
            "minimum": float(np.min(_finite)) if _count else _nan,
            "maximum": float(np.max(_finite)) if _count else _nan,
        }

    if companion_bars is None:
        _out = mo.md("The distribution summary appears once the chart has published its bars.")
    else:
        _summary = pd.DataFrame(
            {COLUMN_TITLES[_column]: eight_number_summary(companion_bars[_column]) for _column in COLUMN_TITLES}
        )
        _summary.index.name = "statistic"
        _out = mo.vstack([
            mo.md(f"""
## The visible bars in numbers

Every column of the visible bars, eight ways. **Mean and standard deviation** describe the middle
and the spread; **skewness** says whether the long tail points up (positive) or down (negative);
**kurtosis** (excess, 0 for a bell curve) says how much more often extreme bars happen than a bell
curve would predict; the **percentiles, minimum and maximum** show where the bulk and the single
most extreme bar sit. The *log return* is the bar's move as a fraction of the previous close
(0.001 is one tenth of one percent); the *true range* is how far the bar reached, including any gap
from the previous close, in price points. Times are {dashboard.clock_label(context)}.
"""),
            mo.ui.table(_summary.reset_index(), selection=None, pagination=False),
        ])
    _out
    return COLUMN_TITLES, eight_number_summary


@app.cell
def _(
    COLUMN_TITLES,
    alt,
    bin_slider,
    companion_bars,
    context,
    dashboard,
    log_count_checkbox,
    mo,
):
    if companion_bars is None:
        _out = mo.md("The small multiples appear once the chart has published its bars.")
    else:
        alt.data_transformers.disable_max_rows()
        _clock = dashboard.clock_label(context)
        _brush = alt.selection_interval(encodings=["x"], name="time_brush")
        _base = alt.Chart(companion_bars)
        _panels = []
        for _column, _title in COLUMN_TITLES.items():
            _line = (
                _base.mark_line(color="#0072B2", strokeWidth=1)
                .encode(
                    x=alt.X("timestamp_milliseconds:T", scale=alt.Scale(type="utc"), title=f"Bar time, {_clock}"),
                    y=alt.Y(f"{_column}:Q", title=_title, scale=alt.Scale(zero=False)),
                    tooltip=[
                        alt.Tooltip("bar_time_text:N", title=f"Bar time ({_clock})"),
                        alt.Tooltip(f"{_column}:Q", title=_title, format=",.6g"),
                    ],
                )
                .add_params(_brush)
                .properties(width=330, height=120, title=_title)
            )
            _all = _base.mark_bar(color="#56B4E9", opacity=0.45).encode(
                x=alt.X(f"{_column}:Q", bin=alt.Bin(maxbins=bin_slider.value), title=_title),
                y=alt.Y(
                    "count():Q",
                    title="Bar count",
                    scale=alt.Scale(type="symlog" if log_count_checkbox.value else "linear"),
                ),
            )
            _brushed = (
                _base.mark_bar(color="#0072B2")
                .encode(
                    x=alt.X(f"{_column}:Q", bin=alt.Bin(maxbins=bin_slider.value)),
                    y=alt.Y("count():Q"),
                )
                .transform_filter(_brush)
            )
            _histogram = alt.layer(_all, _brushed).properties(width=330, height=120)
            _panels.append(alt.vconcat(_line, _histogram))
        _rows = [alt.hconcat(*_panels[_start:_start + 3]) for _start in range(0, len(_panels), 3)]
        _chart = alt.vconcat(*_rows).configure_view(stroke=None)
        _out = mo.vstack([
            mo.md("""
## Every column, seen

One panel per column: the line is the value bar by bar across the visible range, the histogram
below it is how often each value occurred. **Drag across any line** to brush a stretch of time: every
histogram then shows that stretch in dark blue over the whole range in light blue, so you can see
whether (say) the widest bars all came from one burst. Re-bin with the slider; switch the counts to
a log scale to see the rare values in the tails.
"""),
            mo.ui.altair_chart(_chart),
        ])
    _out
    return


@app.cell
def _(alt, companion_bars, context, dashboard, mo, pd, stats, threshold_slider, window_slider):
    if companion_bars is None:
        _out = mo.md("The unusual-move chart appears once the chart has published its bars.")
    else:
        _clock = dashboard.clock_label(context)
        _threshold = threshold_slider.value
        _scored = companion_bars.dropna(subset=["return_zscore"])
        _flagged = _scored[_scored["return_zscore"].abs() >= _threshold].assign(
            direction=lambda _f: _f["return_zscore"].map(lambda _z: "up move" if _z > 0 else "down move")
        )
        _x = alt.X("timestamp_milliseconds:T", scale=alt.Scale(type="utc"), title=f"Bar time, {_clock}")
        _line = alt.Chart(_scored).mark_line(color="#999999", strokeWidth=1).encode(
            x=_x,
            y=alt.Y("return_zscore:Q", title="Return z-score (standard deviations from the trailing mean)"),
        )
        _rules = alt.Chart(
            pd.DataFrame({"threshold": [_threshold, -_threshold]})
        ).mark_rule(strokeDash=[4, 4], color="#000000").encode(y="threshold:Q")
        _points = alt.Chart(_flagged).mark_point(filled=True, size=70).encode(
            x=_x,
            y="return_zscore:Q",
            color=alt.Color(
                "direction:N",
                scale=alt.Scale(domain=["up move", "down move"], range=["#E69F00", "#0072B2"]),
                title="Direction",
            ),
            shape=alt.Shape(
                "direction:N",
                scale=alt.Scale(domain=["up move", "down move"], range=["triangle-up", "triangle-down"]),
                title="Direction",
            ),
            tooltip=[
                alt.Tooltip("bar_time_text:N", title=f"Bar time ({_clock})"),
                alt.Tooltip("return_zscore:Q", title="Return z-score", format="+.2f"),
                alt.Tooltip("log_return:Q", title="Log return", format="+.5f"),
            ],
        )
        _chart = alt.layer(_line, _rules, _points).properties(width=1000, height=240)
        _up = int((_flagged["return_zscore"] > 0).sum())
        _down = int((_flagged["return_zscore"] < 0).sum())
        _unscored = int(companion_bars["return_zscore"].isna().sum())
        _out = mo.vstack([
            mo.md(f"""
## Which bars moved unusually

For every bar, **z = (r − m) / s**, read left to right:

| Symbol | In words | Now |
|---|---|---|
| z | return z-score: how many standard deviations this bar's return sits from normal | plotted below |
| r | this bar's log return (natural log of close over previous close) | per bar |
| m | trailing mean: the average log return of the **{window_slider.value} bars before** this one | per bar |
| s | trailing standard deviation of those same {window_slider.value} earlier returns | per bar |
| threshold | how far from normal counts as unusual | {_threshold:.1f} |

**{_up + _down:,} of {len(_scored):,} scored bars** pass |z| ≥ {_threshold:.1f}: {_up:,} up moves
(orange, triangle up) and {_down:,} down moves (blue, triangle down). {_unscored:,} visible bars have
no score because fewer than {window_slider.value} earlier returns exist for them. Under a bell curve
about {100 * 2 * (1 - stats.norm.cdf(_threshold)):.1f}% of bars would pass this
threshold by chance; a much larger share means the returns have fat tails.
"""),
            _chart,
        ])
    _out
    return


@app.cell
def _(companion_bars, context, dashboard, mo, pd, window_slider):
    selected_bar = None
    _selected_ms = context.get("selectedMs") if context else None
    if companion_bars is None or _selected_ms is None:
        _out = mo.md("""
## The selected bar

Click a bar on the Market chart to see it here: its return, how unusual that return was, and
where it ranks among the bars before it.
""")
    else:
        # Only a bar ON SCREEN is the selected bar: the exact bar when the click
        # landed on one, else the bar containing that time — and nothing when the
        # time lies outside the visible bars (the last visible bar is not it).
        _visible = companion_bars[~companion_bars["before_visible_range"]] if "before_visible_range" in companion_bars else companion_bars
        _times = _visible["timestamp_milliseconds"]
        _inside = not _visible.empty and int(_times.iloc[0]) <= int(_selected_ms) <= int(_times.iloc[-1])
        _exact = _visible[_times == int(_selected_ms)]
        _at_or_before = _exact if not _exact.empty else (_visible[_times <= int(_selected_ms)] if _inside else _visible.iloc[0:0])
        if _at_or_before.empty:
            _out = mo.md(f"""
## The selected bar

The selected bar ({dashboard.format_stamp(_selected_ms)}) is outside the visible range; scroll the
chart to it.
""")
        else:
            selected_bar = _at_or_before.iloc[-1]
            _z = selected_bar["return_zscore"]
            _percentile = selected_bar["return_percentile_in_window"]
            _volatility = selected_bar["trailing_true_range_percentile"]
            if pd.isna(_z):
                _words = (f"This bar has no z-score yet: fewer than {window_slider.value} earlier returns "
                          "exist for it.")
            else:
                _direction = "above" if _z > 0 else "below"
                _words = (f"This bar's return sat **{abs(_z):.2f} standard deviations {_direction}** the average of "
                          f"the {window_slider.value} bars before it, and was at or above "
                          f"**{100 * _percentile:.0f}%** of them.")
            if not pd.isna(_volatility):
                _words += (f" Its trailing true range was at or above {100 * _volatility:.0f}% of the previous "
                           f"{window_slider.value} values"
                           + (" (high volatility)." if _volatility >= 0.9 else "."))
            _row = pd.DataFrame([{
                f"bar time ({dashboard.clock_label(context)})": selected_bar["bar_time_text"],
                "open": selected_bar["open"],
                "high": selected_bar["high"],
                "low": selected_bar["low"],
                "close": selected_bar["close"],
                "volume": selected_bar["volume"],
                "log_return": selected_bar["log_return"],
                "true_range_points": selected_bar["true_range_points"],
                "return_zscore": _z,
                "return_percentile_in_window": _percentile,
                "trailing_true_range_percentile": _volatility,
            }])
            _out = mo.vstack([
                mo.md(f"""
## The selected bar

{_words}
"""),
                mo.ui.table(_row, selection=None, pagination=False),
            ])
    _out
    return (selected_bar,)


@app.cell
def _(
    companion_bars,
    context,
    dashboard,
    level_checkbox,
    marker_checkbox,
    mo,
    pd,
    selected_bar,
    selected_line_checkbox,
    threshold_slider,
    zone_checkbox,
):
    chart_overlays = []
    visible_levels = {}
    if companion_bars is not None and context is not None:
        _threshold = threshold_slider.value
        if marker_checkbox.value:
            _scored = companion_bars.dropna(subset=["return_zscore"])
            for _sign, _name, _position, _shape, _color, _label in (
                (1, "unusual_up_moves", "below", "arrowUp", "#E69F00", "Unusual up move (return z-score)"),
                (-1, "unusual_down_moves", "above", "arrowDown", "#0072B2", "Unusual down move (return z-score)"),
            ):
                _hits = _scored[_sign * _scored["return_zscore"] >= _threshold]
                # The chart takes 2,000 markers per overlay: keep the largest moves.
                _hits = _hits.reindex(_hits["return_zscore"].abs().sort_values(ascending=False).index).head(2_000)
                _hits = _hits.sort_values("timestamp_milliseconds")
                if len(_hits):
                    chart_overlays.append(dashboard.markers(
                        _name,
                        pd.DataFrame({
                            "time": _hits["timestamp_milliseconds"],
                            "position": _position,
                            "shape": _shape,
                            "text": _hits["return_zscore"].map(lambda _z: f"{_z:.1f}"),
                        }),
                        label=_label,
                        color=_color,
                    ))
        if level_checkbox.value:
            _typical = (companion_bars["high"] + companion_bars["low"] + companion_bars["close"]) / 3
            _volume_total = companion_bars["volume"].sum()
            visible_levels = {
                "visible_high": ("Visible high", float(companion_bars["high"].max()), "#CC79A7"),
                "visible_low": ("Visible low", float(companion_bars["low"].min()), "#009E73"),
            }
            if _volume_total > 0:
                visible_levels["visible_volume_weighted_average_price"] = (
                    "Visible volume-weighted average price",
                    float((_typical * companion_bars["volume"]).sum() / _volume_total),
                    "#000000",
                )
            for _identifier, (_label, _price, _color) in visible_levels.items():
                chart_overlays.append(dashboard.level(_identifier, _price, label=_label, color=_color, style="dashed"))
        if zone_checkbox.value:
            _hot = companion_bars["high_volatility"].fillna(False).astype(bool)
            _run_id = (_hot != _hot.shift()).cumsum()
            _spans = [
                (_run["timestamp_milliseconds"].iloc[0], _run["timestamp_milliseconds"].iloc[-1], "high volatility")
                for _, _run in companion_bars[_hot].groupby(_run_id[_hot])
            ][:2_000]
            if _spans:
                chart_overlays.append(dashboard.zones("high_volatility", _spans, label="high volatility", color="#56B4E9"))
        if selected_line_checkbox.value and selected_bar is not None:
            chart_overlays.append(dashboard.vertical_lines(
                "selected_bar", [int(selected_bar["timestamp_milliseconds"])], label="Selected bar", color="#D55E00",
            ))

    _kind_words = {"marker": "arrows", "level": "horizontal line", "zone": "shaded spans", "vline": "vertical line"}
    _rows = []
    for _overlay in chart_overlays:
        _items = _overlay.get("markers") or _overlay.get("zones") or _overlay.get("times") or [_overlay.get("price")]
        _rows.append({
            "overlay": _overlay.get("label", _overlay["id"]),
            "drawn as": _kind_words.get(_overlay["kind"], _overlay["kind"]),
            "colour": _overlay.get("color", ""),
            "item_count": len(_items),
            "price": _overlay.get("price"),
        })
    if chart_overlays:
        _out = mo.vstack([
            mo.md("""
## What would be drawn on the chart

Arrows mark the unusual moves (orange arrow up under the bar for an up move, blue arrow down above
the bar for a down move, each labelled with its z-score). Dashed lines mark the highest high, the
lowest low and the volume-weighted average price of the visible range (the average price weighted
by how much traded at each bar, using each bar's typical price, the mean of high, low and close).
Light-blue shading marks stretches where the trailing true range sat in the top 10% of its own
previous values. A vertical line marks the selected bar.
"""),
            mo.ui.table(pd.DataFrame(_rows), selection=None, pagination=False),
        ])
    else:
        _out = mo.md("Nothing to draw yet.")
    _out
    return (chart_overlays,)


@app.cell
def _(dashboard, mo):
    OVERLAY_SOURCE = "chart_companion"
    # Seeded from the dashboard: drawings a previous kernel left on the chart are
    # this notebook's, so switching drawing off (or leaving it off) clears them.
    get_drawn, set_drawn = mo.state(OVERLAY_SOURCE in dashboard.overlay_sources())
    return OVERLAY_SOURCE, get_drawn, set_drawn


@app.cell
def _(OVERLAY_SOURCE, chart_overlays, context, dashboard, draw_switch, get_drawn, mo, set_drawn):
    if draw_switch.value and context is not None and chart_overlays:
        _status = dashboard.push_overlays(OVERLAY_SOURCE, context, chart_overlays)
        if _status.ok:
            set_drawn(True)
        _message = _status.message
    elif draw_switch.value and context is not None:
        _status = dashboard.clear_overlays(OVERLAY_SOURCE)
        set_drawn(False)
        _message = f"Nothing is selected to draw. {_status.message}"
    elif draw_switch.value:
        _message = f"Nothing drawn: {dashboard.NOT_PUBLISHED}."
    elif get_drawn():
        _status = dashboard.clear_overlays(OVERLAY_SOURCE)
        if _status.ok:
            set_drawn(False)
        _message = f"Drawing switched off. {_status.message}"
    else:
        _message = "Drawing is off: switch on *Draw on the chart* above to put these on the Market chart."
    mo.md(f"**Chart overlays:** {_message}")
    return


if __name__ == "__main__":
    app.run()
