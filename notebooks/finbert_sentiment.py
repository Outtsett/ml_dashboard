import marimo

__generated_with = "0.16.5"
app = marimo.App(width="full")


@app.cell
def _():
    import marimo as mo

    mo.md(
        r"""
# FinBERT news sentiment — what every model reads

**Think of FinBERT as a desk reader who has read years of financial copy.** Every headline the live
hub sees (RSS feeds, Alpha Vantage, GDELT) is handed to it; it returns how positive, negative and
neutral the text reads. The *score* is positive minus negative, from −1 (clearly bad news) to +1.
Those scores are then **routed** to instruments (a Fed story reaches every index future, the
Treasury curve and every dollar pair) and **added up on each bar, fading with age** — that sum,
and eight other columns built the same way, are appended to the features of **every model** the
dashboard trains.

Pick an instrument and a window below. Every column is drawn with its eight-number summary; the
decay formula underneath is steppable bar by bar, so you can watch which headlines make up a value.
The numbers come from the same code the models use (`lake.sentiment`), over the curated lake plus
today's spool.
"""
    )
    return (mo,)


@app.cell
def _(mo):
    import math
    from datetime import datetime, timedelta, timezone
    from pathlib import Path

    import altair as alt
    import numpy as np
    import polars as pl
    from lake import news, sentiment

    # Today's headlines live in the dashboard hub's spool until the day lands.
    _spool = Path(str(mo.notebook_dir())).parent / "data" / "live" / "spool" / "curated"
    if _spool not in sentiment.SPOOL_DIRS:
        sentiment.SPOOL_DIRS.append(_spool)

    OKABE = {
        "orange": "#E69F00", "blue": "#0072B2", "sky": "#56B4E9", "vermillion": "#D55E00",
        "yellow": "#F0E442", "green": "#009E73", "purple": "#CC79A7", "grey": "#999999",
    }
    VENDOR_COLORS = {"gdelt": OKABE["blue"], "rss": OKABE["orange"], "alphavantage": OKABE["purple"]}
    return (
        OKABE, VENDOR_COLORS, alt, datetime, math, news, np, pl, sentiment, timedelta, timezone,
    )


@app.cell
def _(datetime, mo, news, timedelta, timezone):
    _today = datetime.now(timezone.utc).date()
    root_picker = mo.ui.dropdown(options=list(news.ALL_ROOTS), value="MNQ", label="Instrument root")
    timeframe_picker = mo.ui.dropdown(options={"1 minute": 1, "5 minutes": 5, "15 minutes": 15, "1 hour": 60, "1 day": 1440},
                                      value="5 minutes", label="Bar grid")
    window = mo.ui.date_range(start=_today - timedelta(days=3), stop=_today, label="Window (UTC days)")
    bins = mo.ui.slider(10, 60, value=30, step=5, label="Histogram bins")
    mo.hstack([root_picker, timeframe_picker, window, bins], justify="start", gap=2)
    return bins, root_picker, timeframe_picker, window


@app.cell
def _(datetime, pl, root_picker, sentiment, timedelta, timezone, window):
    root = root_picker.value
    window_start = datetime.combine(window.value[0], datetime.min.time(), tzinfo=timezone.utc)
    window_end = datetime.combine(window.value[1], datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=1)
    _records = sentiment.load_articles(root, window_start - sentiment.LOOKBACK_BEFORE_FIRST_BAR, window_end)
    articles = pl.DataFrame(
        _records or [], schema={"article_id": pl.Utf8, "vendor": pl.Utf8, "tier": pl.Utf8, "relevance": pl.Float64,
                                "direction": pl.Int64, "title": pl.Utf8, "seen_epoch": pl.Float64, "score": pl.Float64},
    ).with_columns(
        pl.from_epoch(pl.col("seen_epoch"), time_unit="s").alias("seen_utc"),
        pl.col("direction").fill_null(1),
    )
    in_window = articles.filter(pl.col("seen_epoch") >= window_start.timestamp())
    stream = sentiment.load_stream(root, window_start.timestamp(), window_end.timestamp())
    return articles, in_window, root, stream, window_end, window_start


@app.cell
def _(in_window, mo, pl, root, stream):
    _distinct = in_window.select(pl.col("article_id").n_unique()).item() if in_window.height else 0
    mo.vstack([
        mo.md(f"## {root}: {_distinct:,} distinct scored headlines in the window, {in_window.height:,} routes"),
        mo.md(f"Coverage spans (when some source was collecting): **{stream.coverage.shape[0]}**. "
              "A bar outside every span has UNKNOWN news — the coverage flag column says so to the model."),
        mo.ui.table(
            in_window.sort("seen_epoch", descending=True)
            .select("seen_utc", "vendor", "tier", "relevance", "direction", "score", "title")
            .to_pandas(),
            selection=None, page_size=12,
        ),
    ])
    return


@app.function
def eight_numbers(values, name):
    """mean, median, standard deviation, skewness, kurtosis, 25th/75th percentiles, min, max."""
    import numpy as _np

    _v = _np.asarray(values, dtype=float)
    _v = _v[_np.isfinite(_v)]
    _n = _v.size
    if _n == 0:
        return {"column": name, "count": 0}
    _mean = float(_v.mean())
    _sd = float(_v.std(ddof=1)) if _n > 1 else float("nan")
    _centred = _v - _mean
    _m2 = float((_centred**2).mean())
    _skew = float((_centred**3).mean() / _m2**1.5) if _n > 2 and _m2 > 0 else float("nan")
    _kurt = float((_centred**4).mean() / _m2**2 - 3.0) if _n > 3 and _m2 > 0 else float("nan")
    return {
        "column": name, "count": _n, "mean": _mean, "median": float(_np.median(_v)), "standard_deviation": _sd,
        "skewness": _skew, "excess_kurtosis": _kurt, "percentile_25": float(_np.percentile(_v, 25)),
        "percentile_75": float(_np.percentile(_v, 75)), "min": float(_v.min()), "max": float(_v.max()),
    }


@app.cell
def _(VENDOR_COLORS, alt, bins, in_window, mo, pl):
    _scores = in_window.unique("article_id")
    if _scores.height == 0:
        _out = mo.md("No scored headlines for this instrument in the window yet.")
    else:
        _hist = (
            alt.Chart(_scores.select("score", "vendor").to_pandas())
            .mark_bar(opacity=0.8)
            .encode(
                x=alt.X("score:Q", bin=alt.Bin(maxbins=bins.value), title="FinBERT score (positive − negative probability)"),
                y=alt.Y("count():Q", title="headlines", stack=True),
                color=alt.Color("vendor:N", scale=alt.Scale(domain=list(VENDOR_COLORS), range=list(VENDOR_COLORS.values())),
                                title="vendor"),
                tooltip=["vendor:N", "count():Q"],
            )
            .properties(height=220, title="Score distribution, one headline counted once")
        )
        _hourly = (
            alt.Chart(
                _scores.with_columns(pl.col("seen_utc").dt.truncate("1h").alias("hour")).group_by("hour", "vendor")
                .len().to_pandas()
            )
            .mark_bar()
            .encode(
                x=alt.X("hour:T", title="hour first seen (UTC)"),
                y=alt.Y("len:Q", title="headlines", stack=True),
                color=alt.Color("vendor:N", scale=alt.Scale(domain=list(VENDOR_COLORS), range=list(VENDOR_COLORS.values()))),
                tooltip=["hour:T", "vendor:N", "len:Q"],
            )
            .properties(height=220, title="Headlines per hour")
        )
        _summary = pl.DataFrame([eight_numbers(_scores.filter(pl.col("vendor") == _v)["score"].to_numpy(), _v)
                                 for _v in sorted(_scores["vendor"].unique().to_list())]
                                + [eight_numbers(_scores["score"].to_numpy(), "all vendors")])
        _out = mo.vstack([mo.hstack([mo.ui.altair_chart(_hist), mo.ui.altair_chart(_hourly)]),
                          mo.ui.table(_summary.to_pandas(), selection=None)])
    _out
    return


@app.cell
def _(np, sentiment, stream, timeframe_picker, window_end, window_start):
    step_minutes = timeframe_picker.value
    grid = np.arange(window_start.timestamp(), min(window_end.timestamp(), __import__("time").time()), step_minutes * 60.0)
    features = sentiment.compute_from_stream(grid, stream, float(step_minutes))
    return features, grid, step_minutes


@app.cell
def _(OKABE, alt, features, grid, mo, pl, sentiment):
    _frame = pl.DataFrame({"time": (grid * 1000).astype("int64"),
                           **{_n: features[:, _i] for _i, _n in enumerate(sentiment.FEATURE_NAMES)}}).with_columns(
        pl.from_epoch(pl.col("time"), time_unit="ms"))
    _long = _frame.unpivot(index="time", variable_name="feature", value_name="value").with_columns(
        pl.col("feature").replace_strict(sentiment.DISPLAY_NAMES).alias("feature_name"))
    _small = (
        alt.Chart(_long.to_pandas())
        .mark_line(interpolate="step-after", color=OKABE["blue"], strokeWidth=1.2)
        .encode(x=alt.X("time:T", title="bar open (UTC)"), y=alt.Y("value:Q", title=None),
                tooltip=["time:T", "feature_name:N", alt.Tooltip("value:Q", format=".4f")])
        .properties(width=330, height=120)
        .facet(facet=alt.Facet("feature_name:N", title=None), columns=3)
        .resolve_scale(y="independent")
    )
    _summary = pl.DataFrame([eight_numbers(features[:, _i], sentiment.DISPLAY_NAMES[_n])
                             for _i, _n in enumerate(sentiment.FEATURE_NAMES)])
    mo.vstack([
        mo.md(f"## The nine columns every model gets, on a {len(grid):,}-bar grid"),
        mo.ui.altair_chart(_small, chart_selection=False, legend_selection=False),
        mo.ui.table(_summary.to_pandas(), selection=None),
    ])
    return


@app.cell
def _(grid, mo, step_minutes):
    bar_index = mo.ui.slider(0, max(len(grid) - 1, 0), value=max(len(grid) - 1, 0), label="Bar (step through the window)",
                             full_width=True)
    half_life = mo.ui.slider(5, 2880, value=int(max(20, 4 * step_minutes)), step=5,
                             label="Half-life h (minutes) — the model uses max(20 min, 4 bars)")
    mo.vstack([
        mo.md(r"""
## The decayed sum, term by term

$$S(t) \;=\; \sum_{i\,:\,a_i < t} w_i \, s_i \, 2^{-(t - a_i)/h}$$

| symbol | name | what it holds |
|---|---|---|
| $S(t)$ | decayed sentiment | the value on the bar opening at $t$ (before the signed log the model sees) |
| $\sum_{i : a_i < t}$ | sum over | every headline known **strictly before** the bar opened |
| $a_i$ | known at | when headline $i$ became known (GDELT: the end of its 15-minute crawl bucket) |
| $w_i$ | weight | relevance × direction: how much the story bears on this instrument, −1 when it is about a pair's quote currency |
| $s_i$ | score | FinBERT: p(positive) − p(negative) |
| $h$ | half-life | minutes until a headline counts half |
"""),
        bar_index, half_life,
    ])
    return bar_index, half_life


@app.cell
def _(OKABE, alt, bar_index, datetime, grid, half_life, math, mo, np, pl, stream, timezone):
    if len(grid) == 0 or stream.known_at.size == 0:
        _out = mo.md("No bars or no headlines to step through.")
    else:
        _t = float(grid[bar_index.value])
        _h = half_life.value * 60.0
        _mask = stream.known_at < _t
        _age_minutes = (_t - stream.known_at[_mask]) / 60.0
        _decay = np.power(2.0, -(_t - stream.known_at[_mask]) / _h)
        _terms = stream.weight[_mask] * stream.score[_mask] * _decay
        _table = pl.DataFrame({
            "known_at_utc": [datetime.fromtimestamp(_a, tz=timezone.utc).strftime("%Y-%m-%d %H:%M") for _a in stream.known_at[_mask]],
            "age_minutes": _age_minutes, "weight_w": stream.weight[_mask], "score_s": stream.score[_mask],
            "decay_2^(-age/h)": _decay, "term": _terms,
        }).sort("age_minutes").head(40)
        _total = float(_terms.sum())
        _bars = (
            alt.Chart(_table.head(25).to_pandas())
            .mark_bar()
            .encode(
                x=alt.X("term:Q", title="term = w·s·2^(−age/h)"),
                y=alt.Y("known_at_utc:N", sort=None, title="headline (newest first)"),
                color=alt.condition("datum.term >= 0", alt.value(OKABE["orange"]), alt.value(OKABE["blue"])),
                tooltip=["known_at_utc:N", alt.Tooltip("age_minutes:Q", format=".1f"), alt.Tooltip("weight_w:Q", format=".2f"),
                         alt.Tooltip("score_s:Q", format=".3f"), alt.Tooltip("decay_2^(-age/h):Q", format=".4f"),
                         alt.Tooltip("term:Q", format=".4f")],
            )
            .properties(height=360, title="The 25 newest terms (orange adds, blue subtracts)")
        )
        _out = mo.vstack([
            mo.md(f"**Bar opening {datetime.fromtimestamp(_t, tz=timezone.utc):%Y-%m-%d %H:%M} UTC** · h = {half_life.value} min · "
                  f"{int(_mask.sum()):,} headlines known before it · **S(t) = {_total:+.4f}** · "
                  f"the model sees sign(S)·log(1+|S|) = {math.copysign(math.log1p(abs(_total)), _total):+.4f}"),
            mo.hstack([mo.ui.altair_chart(_bars), mo.ui.table(_table.to_pandas(), selection=None, page_size=12)]),
        ])
    _out
    return


if __name__ == "__main__":
    app.run()
