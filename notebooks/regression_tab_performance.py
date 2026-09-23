import marimo

__generated_with = "0.24.0"
app = marimo.App(width="full")


@app.cell
def _():
    import altair as alt
    import marimo as mo
    import polars as pl
    from lake.catalog import duckdb_connect
    return alt, duckdb_connect, mo, pl


@app.cell
def _(mo):
    mo.md(
        r"""
# Price Regression tab — how much to draw, and whether Redis would help

Two questions, answered from measurements taken on 2026-09-23 against real MNQ bars and the live
dashboard. The numbers live in the lake at
`s3://derived/regression_tab_performance/recipe=measured_2026_09_23/`.

**How many points should a scatter draw?** Think of each panel as a photograph of a crowd taken
from a fixed spot. Draw too few people and the photo shows a different crowd: gaps where it was
dense, a lone figure where there were fifty. Draw more and the picture converges on the real
crowd — but every extra person still costs time to paint. The budget is the smallest crowd whose
photo reads the same as the whole crowd.

**Would an in-memory store like Redis make it faster?** Redis is a separate program the server would
ask for cached answers over a socket. The server already keeps its cached answers in its own memory.
Section 2 puts the two side by side, then shows where the time actually went.
"""
    )
    return


@app.cell
def _(duckdb_connect):
    RECIPE_ROOT = "s3://derived/regression_tab_performance/recipe=measured_2026_09_23"
    connection = duckdb_connect()

    def read_table(name):
        return connection.execute(
            f"SELECT * FROM read_parquet('{RECIPE_ROOT}/table={name}/*.parquet')"
        ).pl()

    render_threshold = read_table("render_threshold")
    canvas_draw = read_table("canvas_draw")
    latency_layers = read_table("latency_layers")
    client_fit = read_table("client_fit")
    cache_option_reference = read_table("cache_option_reference")
    BUDGET_LEVELS = sorted(render_threshold["requested_budget"].unique().to_list())
    return (
        BUDGET_LEVELS,
        cache_option_reference,
        canvas_draw,
        client_fit,
        latency_layers,
        render_threshold,
    )


@app.cell
def _(BUDGET_LEVELS, mo, render_threshold):
    budget_slider = mo.ui.slider(
        steps=BUDGET_LEVELS, value=5000, label="points drawn per panel (budget)", show_value=True, full_width=True
    )
    geometry_dropdown = mo.ui.dropdown(
        options=sorted(render_threshold["geometry"].unique().to_list()),
        value="thumbnail@panel700",
        label="panel (surface @ side-panel width in pixels)",
    )
    mode_dropdown = mo.ui.dropdown(
        options=["all", *sorted(render_threshold["mode"].unique().to_list())], value="all", label="Y axis"
    )
    visible_panels_slider = mo.ui.slider(1, 16, value=8, label="panels on screen at once", show_value=True)
    mo.vstack(
        [
            mo.md("## 1. How many points to draw"),
            budget_slider,
            mo.hstack([geometry_dropdown, mode_dropdown, visible_panels_slider], justify="start"),
        ]
    )
    return budget_slider, geometry_dropdown, mode_dropdown, visible_panels_slider


@app.cell
def _(geometry_dropdown, mode_dropdown, pl, render_threshold):
    selected_render = render_threshold.filter(pl.col("geometry") == geometry_dropdown.value)
    if mode_dropdown.value != "all":
        selected_render = selected_render.filter(pl.col("mode") == mode_dropdown.value)
    selected_render = selected_render.with_columns(
        (pl.col("bar_series") + " · " + pl.col("mode") + " · " + pl.col("variable")).alias("series")
    )
    render_by_budget = (
        selected_render.group_by("requested_budget")
        .agg(
            pl.col("coverage_fraction").median().alias("median_coverage_fraction"),
            pl.col("histogram_total_variation").median().alias("median_shape_error"),
            pl.col("histogram_total_variation").quantile(0.9, "linear").alias("ninetieth_percentile_shape_error"),
            (pl.col("histogram_total_variation") < 0.05).mean().alias("share_of_variables_faithful"),
            pl.col("points_drawn").median().alias("median_points_drawn"),
            pl.len().alias("series_count"),
        )
        .sort("requested_budget")
    )
    return render_by_budget, selected_render


@app.cell
def _(alt, budget_slider, mo, render_by_budget, selected_render):
    _base = alt.Chart(selected_render.to_pandas())
    _rule = alt.Chart().mark_rule(color="#0072B2", strokeDash=[4, 3]).encode(x=alt.datum(budget_slider.value))
    _coverage = (
        _base.mark_line(opacity=0.18, color="#56B4E9").encode(
            x=alt.X("requested_budget:Q", scale=alt.Scale(type="log"), title="points drawn per panel (log scale)"),
            y=alt.Y("coverage_fraction:Q", title="share of the plot's pixels painted"),
            detail="series:N",
        )
        + alt.Chart(render_by_budget.to_pandas())
        .mark_line(point=alt.OverlayMarkDef(shape="square", size=40), color="#E69F00", strokeWidth=2.5)
        .encode(x="requested_budget:Q", y="median_coverage_fraction:Q")
        + _rule
    ).properties(width=520, height=260, title="Painted pixels keep rising — there is no early point where more dots stop showing")

    _target = alt.Chart().mark_rule(color="#CC79A7", strokeDash=[2, 2]).encode(y=alt.datum(0.05))
    _shape = (
        _base.mark_line(opacity=0.18, color="#56B4E9").encode(
            x=alt.X("requested_budget:Q", scale=alt.Scale(type="log"), title="points drawn per panel (log scale)"),
            y=alt.Y("histogram_total_variation:Q", title="shape error (total-variation distance)"),
            detail="series:N",
        )
        + alt.Chart(render_by_budget.to_pandas())
        .mark_line(point=alt.OverlayMarkDef(shape="diamond", size=50), color="#E69F00", strokeWidth=2.5)
        .encode(x="requested_budget:Q", y="median_shape_error:Q")
        + _rule
        + _target
    ).properties(width=520, height=260, title="The cloud reads true once shape error is under 0.05 (dashed pink)")
    mo.hstack([_coverage, _shape])
    return


@app.cell
def _(mo):
    mo.md(
        r"""
**Reading the shape error.** Both all the bars and the drawn points are dropped into the same
$30 \times 20$ grid of cells, and the two sets of shares are compared:

$$\mathrm{TV} \;=\; \tfrac{1}{2}\sum_{i=1}^{600} \bigl|\,p_i - q_i\,\bigr|$$

| symbol | name | what it holds |
|---|---|---|
| $\mathrm{TV}$ | total-variation distance | the share of the cloud drawn in the wrong place: 0 is identical, 1 is nothing in common |
| $i$ | cell index | one of the $30 \times 20 = 600$ cells the plot is divided into |
| $p_i$ | share of ALL bars in cell $i$ | 0.004 means 0.4% of every bar lands in that cell |
| $q_i$ | share of the DRAWN points in cell $i$ | the same, for the thinned points on screen |
| $\sum$ | sum over the 600 cells | add every cell's difference |
| $\tfrac12$ | one half | each misplaced point is counted twice — where it is missing and where it is extra |

Under 0.05, fewer than 5% of the cloud is out of place: the picture reads the same as all the data.
"""
    )
    return


@app.cell
def _(budget_slider, canvas_draw, mo, pl, render_by_budget, visible_panels_slider):
    _row = render_by_budget.filter(pl.col("requested_budget") == budget_slider.value)
    # Steady runs only (2 and 3); run 1 was taken while the page was busy.
    _steady = canvas_draw.filter((pl.col("surface") == "thumbnail") & (pl.col("run_index") > 1))
    _per_point = _steady["microseconds_per_point"].median()
    _panel_milliseconds = _per_point * budget_slider.value / 1000
    _frame_milliseconds = _panel_milliseconds * visible_panels_slider.value
    if _row.height:
        _md = mo.md(
            f"""
### A budget of {budget_slider.value:,} points per panel

| measure | value |
|---|---|
| points actually drawn (median; thinning takes every k-th bar) | {_row["median_points_drawn"][0]:,.0f} |
| median shape error | {_row["median_shape_error"][0]:.4f} |
| 90th-percentile shape error | {_row["ninetieth_percentile_shape_error"][0]:.4f} |
| variables whose shape error is under 0.05 | {_row["share_of_variables_faithful"][0]:.0%} of {_row["series_count"][0]} |
| median share of pixels painted | {_row["median_coverage_fraction"][0]:.3f} |
| canvas time per thumbnail (about {_per_point:.2f} µs a point) | {_panel_milliseconds:.1f} ms |
| canvas time for {visible_panels_slider.value} panels on screen | {_frame_milliseconds:.1f} ms — one screen frame is 16.7 ms |

The tab draws **5,000** ordinary points per thumbnail at rest and **10,000** in the detail view, plus
every flagged outlier; only panels on screen paint; and while a panel is being resized it draws
**700** and fills in the rest 150 ms after the width stops changing.
"""
        )
    else:
        _md = mo.md("No series is longer than this budget here, so there is nothing to thin.")
    _md
    return


@app.cell
def _(alt, budget_slider, canvas_draw, mo):
    _lines = (
        alt.Chart(canvas_draw.to_pandas())
        .mark_line(point=True)
        .encode(
            x=alt.X("points_drawn:Q", scale=alt.Scale(type="log"), title="points drawn (log scale)"),
            y=alt.Y("median_draw_milliseconds:Q", title="canvas time, milliseconds"),
            color=alt.Color("surface:N", scale=alt.Scale(range=["#0072B2", "#E69F00"]), title="surface"),
            strokeDash=alt.StrokeDash("run_index:N", title="run"),
            shape=alt.Shape("run_index:N", legend=None),
            tooltip=["run_index", "surface", "points_drawn", "median_draw_milliseconds", "microseconds_per_point", "note"],
        )
    )
    _frame = alt.Chart().mark_rule(color="#CC79A7", strokeDash=[2, 2]).encode(y=alt.datum(16.7))
    _rule = alt.Chart().mark_rule(color="#0072B2", strokeDash=[4, 3]).encode(x=alt.datum(budget_slider.value))
    mo.vstack(
        [
            mo.md(
                "Canvas cost is close to linear: about 1 µs a point in the two steady runs (0.6–1.2 µs). "
                "Run 1 was 2–4× slower, taken while the page was busy, and its detail-view 10,000 and "
                "20,000 readings are equal — treat it as an outlier. Dashed pink: one 60 Hz frame."
            ),
            (_lines + _frame + _rule).properties(width=620, height=240),
        ]
    )
    return


@app.cell
def _(eight_numbers, mo, pl, budget_slider, selected_render):
    _values = selected_render.filter(pl.col("requested_budget") == budget_slider.value)["histogram_total_variation"]
    mo.vstack(
        [
            mo.md(f"Distribution of the shape error across the selected variables at a budget of {budget_slider.value:,}:"),
            eight_numbers(_values, "shape error (total variation)"),
        ]
    )
    return


@app.cell
def _(pl):
    def eight_numbers(values, label):
        _series = values.drop_nulls()
        _count = _series.len()
        return pl.DataFrame(
            {
                "measure": [
                    "count", "mean", "median", "standard deviation", "skewness", "excess kurtosis",
                    "25th percentile", "75th percentile", "minimum", "maximum",
                ],
                label: [
                    float(_count),
                    _series.mean(),
                    _series.median(),
                    _series.std(),
                    _series.skew(bias=False) if _count >= 3 else float("nan"),
                    _series.kurtosis(bias=False) if _count >= 4 else float("nan"),
                    _series.quantile(0.25, "linear"),
                    _series.quantile(0.75, "linear"),
                    _series.min(),
                    _series.max(),
                ],
            }
        )

    return (eight_numbers,)


@app.cell
def _(mo):
    state_radio = mo.ui.radio(options=["cold", "warm"], value="cold", label="cache state", inline=True)
    mo.vstack([mo.md("## 2. Where the time goes — and where Redis would sit"), state_radio])
    return (state_radio,)


@app.cell
def _(alt, latency_layers, mo, pl, state_radio):
    _objects = (
        latency_layers.filter(
            (pl.col("layer") == "regression_columns_object") & (pl.col("cache_state") == state_radio.value)
        )
        .group_by("object")
        .agg(pl.col("total_milliseconds").median().alias("median_milliseconds"))
    )
    _labels = {
        "original_rule_reads_one_second_table": "first version (before the whole-table catalog bounds)",
        "regression_columns_one_minute_copy_only": "anatomy from the one-minute copy only (loses 2019-2024)",
        "regression_columns_all_current_rule": "as the tab reads it now (both anatomy tables)",
    }
    _all = (
        latency_layers.filter(
            pl.col("measurement_set").is_in(list(_labels))
            & pl.col("layer").is_in(["regression_columns_all", *list(_labels)[1:]])
            & (pl.col("cache_state") == state_radio.value)
            & (pl.col("timeframe") == "1d")
        )
        .group_by("measurement_set")
        .agg(pl.col("total_milliseconds").median().alias("median_milliseconds"))
        .with_columns(pl.col("measurement_set").replace(_labels).alias("rule"))
    )
    _object_chart = (
        alt.Chart(_objects.to_pandas())
        .mark_bar(color="#56B4E9")
        .encode(
            y=alt.Y("object:N", sort="-x", title="lake table (MNQ, daily)"),
            x=alt.X("median_milliseconds:Q", title=f"{state_radio.value} read, median milliseconds"),
            tooltip=["object", "median_milliseconds"],
        )
        .properties(width=520, height=160, title="Cold reads are dominated by candle_anatomy: one row per SECOND, 96.7M rows")
    )
    _rules = (
        alt.Chart(_all.to_pandas())
        .mark_bar()
        .encode(
            x=alt.X("median_milliseconds:Q", title=f"{state_radio.value} read of every MNQ daily lake column, milliseconds"),
            y=alt.Y("rule:N", title=None),
            color=alt.Color("rule:N", scale=alt.Scale(range=["#0072B2", "#E69F00", "#009E73"]), legend=None),
            tooltip=["rule", "median_milliseconds"],
        )
        .properties(width=520, height=110)
    )
    mo.vstack(
        [
            _object_chart,
            mo.md(
                "The one-minute copy of the anatomy table reads 12× faster, but it starts 2024-02-29 and the "
                "one-second table goes back to 2019-05-05 — so the tab keeps both, pays ~2.5 s once per window, "
                "and answers every repeat from memory in ~11 ms. A finer table is skipped only when a coarser "
                "one covers its whole span."
            ),
            _rules,
        ]
    )
    return


@app.cell
def _(alt, cache_option_reference, mo):
    _chart = (
        alt.Chart(cache_option_reference.to_pandas())
        .mark_bar()
        .encode(
            y=alt.Y("option:N", title=None, sort=None),
            x=alt.X("milliseconds:Q", title="milliseconds"),
            color=alt.Color("option:N", scale=alt.Scale(range=["#0072B2", "#E69F00", "#CC79A7"]), legend=None),
            tooltip=["option", "payload_megabytes", "milliseconds", "source"],
        )
        .properties(width=620, height=120)
    )
    mo.vstack(
        [
            mo.md(
                """
The server already answers a repeated request from its **own memory** (an LRU cache — the least
recently used entries are dropped first): about 11 ms for the whole 0.9 MB HTTP response, and the
lookup inside that is handing over an object already in memory, not a copy. Redis would keep the same
answer in a **separate program**: every hit becomes a socket round trip plus turning megabytes of
text back into objects — work the in-process cache never does. Redis earns its keep when several
server processes must share one cache, when a cache must survive a restart, or when machines share
it. This dashboard is one process on one machine, and its data is immutable history that one cold
read rebuilds. The Redis rows are published benchmark figures, not measured here.
"""
            ),
            _chart,
        ]
    )
    return


@app.cell
def _(alt, client_fit, mo):
    _chart = (
        alt.Chart(client_fit.to_pandas())
        .transform_calculate(label="datum.where + ' · ' + datum.bars + ' bars · ' + datum.variables + ' variables'")
        .mark_bar()
        .encode(
            x=alt.X("milliseconds:Q", title="milliseconds to fit every panel"),
            y=alt.Y("label:N", title=None, sort=None),
            color=alt.Color("where:N", scale=alt.Scale(range=["#D55E00", "#009E73"]), title="where the fits ran"),
            tooltip=["where", "bars", "variables", "milliseconds", "note"],
        )
        .properties(width=620, height=160)
    )
    mo.vstack(
        [
            mo.md(
                "## 3. The other real cost: fitting on the page's own thread\n\n"
                "49 regressions over 20,000 bars measured 852 ms of work that froze every control. "
                "They now run in a background worker; the page's thread had no task over 50 ms during a refit."
            ),
            _chart,
        ]
    )
    return


if __name__ == "__main__":
    app.run()
