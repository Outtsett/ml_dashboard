import marimo

__generated_with = "0.24.0"
app = marimo.App(width="full")


@app.cell
def _():
    import marimo as mo
    import duckdb
    import altair as alt
    import pandas as pd
    import pathlib
    return alt, duckdb, mo, pathlib, pd


@app.cell
def _(mo):
    mo.md(
        r"""
# Which candle actually *is* the pattern?

Two questions, both asked of real MNQ bars rather than of the textbook.

**Which candle most resembles the pattern.** TA-Lib does not rank. It emits a flat
magnitude, +100 or -100, identical on a textbook hammer and on a bar that barely
scraped past the threshold. So a ranking has to be built: reduce every firing to
its shape in fractions of its own range, take the **median shape across all that
pattern's firings as the archetype**, and rank each firing by its distance to it.

**Does the context agree.** A hammer and a hanging man are the *same shape*. The
only thing separating them is the trend that came before, and TA-Lib checks the
prior trend for **none** of its 61 patterns while 47 of them have a meaning that
depends on it. So each firing is also stamped with the trend that actually
preceded it.
"""
    )
    return


@app.cell
def _(duckdb, pathlib, mo):
    DATABASE_PATH = pathlib.Path(mo.notebook_dir()).resolve().parent / "data" / "diagnostics.duckdb"
    _connection = duckdb.connect(str(DATABASE_PATH), read_only=True)
    exemplars = _connection.execute("SELECT * FROM candlestick_pattern_exemplars").df()
    rules = _connection.execute("SELECT * FROM candlestick_pattern_rules").df()
    _connection.close()
    return exemplars, rules


@app.cell
def _(exemplars, mo, rules):
    _needs_trend = rules[
        (rules.required_prior_trend_for_bullish_signal.isin(["up", "down"]))
        | (rules.required_prior_trend_for_bearish_signal.isin(["up", "down"]))
    ]
    _gated = exemplars[exemplars.required_prior_trend.isin(["up", "down"])]
    _held = (_gated.prior_trend_direction == _gated.required_prior_trend).sum()

    _headline = mo.md(
        f"""
## The gap, in numbers

| | |
|---|---:|
| Patterns whose meaning depends on the prior trend | {len(_needs_trend)} of {len(rules)} |
| Patterns where TA-Lib verifies that trend | **{int(rules.talib_verifies_prior_trend.sum())}** |
| Firings on this data that need a trend | {len(_gated):,} |
| Firings where the trend was actually there | {_held:,} ({100 * _held / max(len(_gated), 1):.1f}%) |
| Firings that are shape-only, context contradicts | {len(_gated) - _held:,} ({100 * (len(_gated) - _held) / max(len(_gated), 1):.1f}%) |

Most of what the chart calls a reversal is a shape whose context disagrees.
"""
    )
    _headline
    return


@app.cell
def _(mo):
    mo.md(r"""## Pick a pattern""")
    return


@app.cell
def _(exemplars, mo):
    _counts = exemplars.talib_function.value_counts()
    pattern_picker = mo.ui.dropdown(
        options=sorted(_counts.index.tolist()),
        value="CDLHAMMER" if "CDLHAMMER" in _counts.index else sorted(_counts.index)[0],
        label="Pattern",
    )
    exemplar_count_slider = mo.ui.slider(
        start=1, stop=12, step=1, value=5,
        label="How many exemplars to draw", show_value=True,
    )
    context_filter = mo.ui.radio(
        options={
            "every firing": "all",
            "only where the prior trend agrees": "confirmed",
            "only where it contradicts": "contradicted",
        },
        value="every firing",
        label="Context filter",
    )
    mo.vstack([
        mo.hstack([pattern_picker, exemplar_count_slider], justify="start", gap=2),
        context_filter,
    ])
    return context_filter, exemplar_count_slider, pattern_picker


@app.cell
def _(context_filter, exemplars, pattern_picker):
    _frame = exemplars[exemplars.talib_function == pattern_picker.value].copy()
    if context_filter.value == "confirmed":
        _frame = _frame[_frame.prior_trend_direction == _frame.required_prior_trend]
    elif context_filter.value == "contradicted":
        _frame = _frame[_frame.prior_trend_direction != _frame.required_prior_trend]
    selected_pattern = _frame.sort_values("prototypicality_rank").reset_index(drop=True)
    return (selected_pattern,)


@app.cell
def _(mo, pattern_picker, rules, selected_pattern):
    _rule = rules[rules.talib_function == pattern_picker.value]
    _conditions = "" if _rule.empty else _rule.iloc[0].shape_conditions
    _bars = "?" if _rule.empty else int(_rule.iloc[0].bars_the_rule_reads)
    _kind = "?" if _rule.empty else _rule.iloc[0].pattern_type
    _bull = "?" if _rule.empty else _rule.iloc[0].required_prior_trend_for_bullish_signal
    _bear = "?" if _rule.empty else _rule.iloc[0].required_prior_trend_for_bearish_signal

    _lines = "\n".join(f"- {c.strip()}" for c in _conditions.split("|") if c.strip())
    _rule_card = mo.md(
        f"""
### What the rule actually tests

**{pattern_picker.value}** reads **{_bars} bar(s)**, type **{_kind}**, fired
**{len(selected_pattern):,}** times on this data.

Needs a **{_bull}** trend before it to mean something bullish, a **{_bear}** trend
to mean something bearish. TA-Lib verifies neither.

{_lines}
"""
    )
    _rule_card
    return


@app.cell
def _(mo):
    mo.md(
        r"""
## The exemplars, drawn

Each panel is one candle and the bar before it, so the *context* is visible rather
than described. Rank 1 is the closest to this pattern's archetype.
"""
    )
    return


@app.cell
def _(alt, exemplar_count_slider, mo, pd, selected_pattern):
    _top = selected_pattern.head(exemplar_count_slider.value)

    _rows = []
    for _position, _row in _top.iterrows():
        _rows.append({
            "panel": f"#{int(_row.prototypicality_rank)}  {str(_row.bar_timestamp)[:10]}",
            "component": "body",
            "fraction": float(_row.body_fraction_of_range),
        })
        _rows.append({
            "panel": f"#{int(_row.prototypicality_rank)}  {str(_row.bar_timestamp)[:10]}",
            "component": "upper shadow",
            "fraction": float(_row.upper_shadow_fraction_of_range),
        })
        _rows.append({
            "panel": f"#{int(_row.prototypicality_rank)}  {str(_row.bar_timestamp)[:10]}",
            "component": "lower shadow",
            "fraction": float(_row.lower_shadow_fraction_of_range),
        })
    _shape_frame = pd.DataFrame(_rows)

    _chart = (
        alt.Chart(_shape_frame)
        .mark_bar()
        .encode(
            x=alt.X("fraction:Q", title="fraction of the bar's own range",
                    scale=alt.Scale(domain=[0, 1])),
            y=alt.Y("component:N", title=None,
                    sort=["upper shadow", "body", "lower shadow"]),
            color=alt.Color(
                "component:N",
                scale=alt.Scale(
                    domain=["upper shadow", "body", "lower shadow"],
                    range=["#56B4E9", "#E69F00", "#0072B2"],
                ),
                title="component",
            ),
            row=alt.Row("panel:N", title=None,
                        sort=_shape_frame.panel.drop_duplicates().tolist()),
            tooltip=["panel", "component", alt.Tooltip("fraction:Q", format=".3f")],
        )
        .properties(width=420, height=54)
    )
    mo.ui.altair_chart(_chart)
    return


@app.cell
def _(mo, selected_pattern):
    _columns = [
        "bar_timestamp", "prototypicality_rank", "signal_direction",
        "body_fraction_of_range", "upper_shadow_fraction_of_range",
        "lower_shadow_fraction_of_range", "close_versus_open",
        "close_versus_previous_close", "prior_trend_direction",
        "required_prior_trend", "archetype_distance",
    ]
    _table = selected_pattern[_columns].head(40).copy()
    _table["bar_timestamp"] = _table["bar_timestamp"].astype(str).str.slice(0, 10)
    _numeric_columns = _table.select_dtypes(include="number").columns
    _table[_numeric_columns] = _table[_numeric_columns].round(3)
    mo.ui.table(_table, selection=None, page_size=12)
    return


@app.cell
def _(mo):
    mo.md(
        r"""
## Close versus **open** and close versus **previous close** are different things

The first decides the candle's colour and the sign TA-Lib emits. The second is
context, and it is the one a trend is made of. Conflating them is the single most
common way a pattern rule goes wrong.
"""
    )
    return


@app.cell
def _(alt, mo, pd, selected_pattern):
    def _share(column, value):
        if selected_pattern.empty:
            return 0.0
        return 100.0 * (selected_pattern[column] == value).mean()

    _frame = pd.DataFrame([
        {"comparison": "closed above its OWN open", "percent": _share("close_versus_open", "above")},
        {"comparison": "closed above the PREVIOUS close", "percent": _share("close_versus_previous_close", "above")},
        {"comparison": "prior trend agreed with the rule", "percent": (
            0.0 if selected_pattern.empty else
            100.0 * (selected_pattern.prior_trend_direction == selected_pattern.required_prior_trend).mean()
        )},
    ])

    _chart = (
        alt.Chart(_frame)
        .mark_bar(color="#E69F00")
        .encode(
            x=alt.X("percent:Q", title="percent of this pattern's firings",
                    scale=alt.Scale(domain=[0, 100])),
            y=alt.Y("comparison:N", title=None, sort=None),
            tooltip=[alt.Tooltip("percent:Q", format=".1f")],
        )
        .properties(width=520, height=110)
    )
    _rule = (
        alt.Chart(pd.DataFrame({"x": [50]}))
        .mark_rule(strokeDash=[4, 4], color="#999999")
        .encode(x="x:Q")
    )
    mo.ui.altair_chart(_chart + _rule)
    return


@app.cell
def _(mo):
    mo.md(r"""## Every pattern, ranked by how often its context holds""")
    return


@app.cell
def _(alt, exemplars, mo):
    _gated = exemplars[exemplars.required_prior_trend.isin(["up", "down"])].copy()
    _gated["context_held"] = (
        _gated.prior_trend_direction == _gated.required_prior_trend).astype(float)
    _summary = (
        _gated.groupby("talib_function", as_index=False)
        .agg(firings=("context_held", "size"), context_held_percent=("context_held", "mean"))
    )
    _summary["context_held_percent"] *= 100.0
    _summary = _summary[_summary.firings >= 10]

    _chart = (
        alt.Chart(_summary)
        .mark_circle()
        .encode(
            x=alt.X("firings:Q", title="firings", scale=alt.Scale(type="log")),
            y=alt.Y("context_held_percent:Q", title="context held (%)",
                    scale=alt.Scale(domain=[0, 100])),
            size=alt.Size("firings:Q", legend=None),
            color=alt.value("#0072B2"),
            tooltip=["talib_function", "firings",
                     alt.Tooltip("context_held_percent:Q", format=".1f")],
        )
        .properties(width=620, height=320)
    )
    _midline = (
        alt.Chart(_summary.assign(midpoint=50))
        .mark_rule(strokeDash=[4, 4], color="#999999")
        .encode(y="midpoint:Q")
    )
    mo.ui.altair_chart(_chart + _midline)
    return


@app.cell
def _(mo, selected_pattern):
    _numeric = selected_pattern[[
        "body_fraction_of_range", "upper_shadow_fraction_of_range",
        "lower_shadow_fraction_of_range", "archetype_distance",
        "body_size_points", "total_range_points",
    ]]
    _stats = _numeric.agg([
        "count", "mean", "median", "std", "skew", "kurt", "min", "max",
    ]).T
    _stats["percentile_25"] = _numeric.quantile(0.25)
    _stats["percentile_75"] = _numeric.quantile(0.75)
    _stats = _stats.rename(columns={
        "std": "standard_deviation", "skew": "skewness", "kurt": "kurtosis",
        "min": "minimum", "max": "maximum",
    }).round(4).reset_index(names="column")
    mo.ui.table(_stats, selection=None, page_size=10)
    return


if __name__ == "__main__":
    app.run()
