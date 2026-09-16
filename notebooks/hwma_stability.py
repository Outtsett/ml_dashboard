import marimo

__generated_with = "0.24.0"
app = marimo.App(width="full")


@app.cell
def _():
    import os
    from functools import lru_cache
    from pathlib import Path

    import altair as alt
    import duckdb
    import marimo as mo
    import numpy as np
    import polars as pl

    # Okabe-Ito. Price is black, the average orange, the boundary vermillion;
    # every colour also carries a label or a dash pattern.
    ORANGE, BLUE, VERMILLION, GREY, BLACK = "#E69F00", "#0072B2", "#D55E00", "#8C8C8C", "#000000"
    alt.data_transformers.options["max_rows"] = 200_000

    DATABASE = Path(os.environ.get("HWMA_STABILITY_DATABASE", r"E:\lake-workspace\hwma_stability.duckdb"))

    def results(sql: str) -> pl.DataFrame:
        """Open read-only, read, close: the builder needs the write lock back."""
        _connection = duckdb.connect(str(DATABASE), read_only=True)
        try:
            return pl.from_arrow(_connection.execute(sql).to_arrow_table())
        finally:
            _connection.close()

    @lru_cache(maxsize=1)
    def closes() -> np.ndarray:
        return results("SELECT close FROM hwma_price_series ORDER BY bar_index")["close"].to_numpy().astype(float)

    return (BLACK, BLUE, GREY, ORANGE, VERMILLION, alt, closes, mo, np, pl, results)


@app.cell
def _(closes, mo, results):
    run_information = results("SELECT * FROM hwma_run_information").row(0, named=True)
    grid = results("SELECT * FROM hwma_parameter_grid")
    price = closes()
    mo.md(f"""
# When does a moving average stop being an average?

The Holt-Winters moving average carries three states — a **level**, a **velocity** and an
**acceleration** — and each new bar blends "carry the old estimate forward" with "correct toward the
price that just printed". Drop the carry weights and it stops being an average: the level integrates
velocity, velocity integrates acceleration, and acceleration feeds back positively. That is what
`calcHWMA` did in this repo until 2026-09-15. On these {len(price):,} real {run_information['symbol']}
closes it passed a million by bar 105 and reached **1e93**, far outside the ±9.007e13 a chart value may
take, so lightweight-charts asserted, the assertion reached the error boundary, and the whole Market
page rendered as *Something went wrong*.

Corrected, it is a proper Holt-Winters — **and still not unconditionally safe**. Stability depends on
all three parameters, and the indicator panel does not constrain them. Of the
**{grid.height:,}** combinations measured here, **{grid.filter(grid['spectrally_stable'] == False).height:,}**
are unstable and **{grid.filter(grid['went_negative_unbounded']).height:,}** drive a *price average*
below zero if nothing stops them. The default ({run_information['default_na']},
{run_information['default_nb']}, {run_information['default_nc']}) has spectral radius
**{run_information['default_spectral_radius']:.4f}** and tracks price.

Move the three parameters below and watch where the line goes.
""")
    return grid, price, run_information


@app.cell
def _(mo, run_information):
    na = mo.ui.slider(start=0.05, stop=0.95, step=0.05, value=run_information["default_na"],
                      show_value=True, label="na — level correction")
    nb = mo.ui.slider(start=0.05, stop=0.95, step=0.05, value=run_information["default_nb"],
                      show_value=True, label="nb — velocity correction")
    nc = mo.ui.slider(start=0.05, stop=0.95, step=0.05, value=run_information["default_nc"],
                      show_value=True, label="nc — acceleration correction")
    guard = mo.ui.switch(value=True, label="stop emitting once it leaves the data's range (what the chart does)")
    mo.vstack([mo.hstack([na, nb, nc], justify="start", gap=2), guard])
    return guard, na, nb, nc


@app.cell
def _(na, nb, nc, np, price):
    def state_matrix(a: float, b: float, c: float) -> np.ndarray:
        """Maps [level, velocity, acceleration] to its next value. Price is an
        input, not part of the loop, so this matrix alone decides stability."""
        _level = np.array([1 - a, 1 - a, 0.5 * (1 - a)])
        _level_change = _level - np.array([1.0, 0.0, 0.0])
        _velocity = b * _level_change + np.array([0.0, 1 - b, 1 - b])
        _velocity_change = _velocity - np.array([0.0, 1.0, 0.0])
        _acceleration = c * _velocity_change + np.array([0.0, 0.0, 1 - c])
        return np.vstack([_level, _velocity, _acceleration])

    def hwma_path(a: float, b: float, c: float) -> tuple[np.ndarray, int | None]:
        """The recursion, unbounded, plus the bar where it first left the range."""
        _low, _high = float(price.min()), float(price.max())
        _span = max(_high - _low, abs(_high) * 1e-6, 1e-9)
        _floor, _ceiling = _low - 10 * _span, _high + 10 * _span
        _level, _velocity, _acceleration = float(price[0]), 0.0, 0.0
        _out = np.empty(len(price)); _out[0] = _level
        _left = None
        with np.errstate(over="ignore", invalid="ignore"):
            for _i in range(1, len(price)):
                _pl, _pv, _pa = _level, _velocity, _acceleration
                _level = (1 - a) * (_pl + _pv + 0.5 * _pa) + a * price[_i]
                _velocity = (1 - b) * (_pv + _pa) + b * (_level - _pl)
                _acceleration = (1 - c) * _pa + c * (_velocity - _pv)
                _out[_i] = _level
                if _left is None and (not np.isfinite(_level) or _level < _floor or _level > _ceiling):
                    _left = _i
        return _out, _left

    matrix = state_matrix(na.value, nb.value, nc.value)
    eigenvalues = np.linalg.eigvals(matrix)
    radius = float(np.max(np.abs(eigenvalues)))
    path, left_at = hwma_path(na.value, nb.value, nc.value)
    return eigenvalues, hwma_path, left_at, matrix, path, radius, state_matrix


@app.cell
def _(eigenvalues, left_at, matrix, mo, na, nb, nc, path, price, radius, run_information):
    _rows = "\n".join(
        f"| {' | '.join(f'{v:+.4f}' for v in row)} |" for row in matrix)
    _emitted = path[: left_at] if left_at is not None else path
    _md = f"""
$$F_t=(1-n_a)\\left(F_{{t-1}}+V_{{t-1}}+\\tfrac{{1}}{{2}}A_{{t-1}}\\right)+n_a C_t \\qquad
V_t=(1-n_b)\\left(V_{{t-1}}+A_{{t-1}}\\right)+n_b\\left(F_t-F_{{t-1}}\\right) \\qquad
A_t=(1-n_c)A_{{t-1}}+n_c\\left(V_t-V_{{t-1}}\\right)$$

| symbol | name | what it holds | units | now |
|---|---|---|---|---|
| $F_t$ | level | the average itself, what the chart draws | points | **{path[len(path) - 1]:,.2f}** at the last bar |
| $V_t$ | velocity | how fast the level is moving | points per bar | — |
| $A_t$ | acceleration | how fast the velocity is changing | points per bar² | — |
| $C_t$ | close | the price this bar printed | points | **{price[len(price) - 1]:,.2f}** |
| $n_a$ | level correction | how hard the level is pulled to price; 1 = follow price exactly | share | **{na.value:.2f}** |
| $n_b$ | velocity correction | how hard velocity is re-estimated from the level's move | share | **{nb.value:.2f}** |
| $n_c$ | acceleration correction | how hard acceleration is re-estimated from velocity's move | share | **{nc.value:.2f}** |
| $\\rho$ | spectral radius | largest eigenvalue of the state matrix; **< 1 decays, ≥ 1 compounds** | ratio | **{radius:.4f}** |

The state matrix and its eigenvalues at these settings:

| level | velocity | acceleration |
|---|---|---|
{_rows}

Eigenvalues: {', '.join(f'{v.real:+.4f}{v.imag:+.4f}i' if abs(v.imag) > 1e-9 else f'{v.real:+.4f}' for v in eigenvalues)}
"""
    _verdict = (f"**Stable** (ρ = {radius:.4f} < 1). The line below tracks price for all "
                f"{len(price):,} bars." if radius < 1 else
                f"**Unstable** (ρ = {radius:.4f} ≥ 1). Every shock compounds.")
    _stop = ("" if left_at is None else
             f" It leaves the data's range at **bar {left_at:,}**, which is where the chart stops "
             f"drawing it; unbounded it reaches **{path[len(path) - 1]:,.3g}**.")
    mo.md(_md + "\n" + _verdict + _stop)
    return


@app.cell
def _(BLACK, ORANGE, VERMILLION, alt, guard, left_at, mo, np, path, pl, price, radius):
    _n = len(price)
    _shown = np.arange(_n)
    _values = path.copy()
    if guard.value and left_at is not None:
        _values[left_at:] = np.nan
    _frame = pl.DataFrame({
        "bar": _shown, "close": price, "hwma": _values,
    }).unpivot(index="bar", variable_name="series", value_name="value").drop_nulls()
    _frame = _frame.filter(_frame["value"].is_finite())
    _scale = alt.Scale(domain=["close", "hwma"], range=[BLACK, ORANGE])
    _chart = alt.Chart(_frame.to_pandas()).mark_line(strokeWidth=1.4).encode(
        x=alt.X("bar:Q", title="bar"),
        y=alt.Y("value:Q", title="price, points", scale=alt.Scale(zero=False)),
        color=alt.Color("series:N", scale=_scale, title=None),
        strokeDash=alt.StrokeDash("series:N", scale=alt.Scale(domain=["close", "hwma"], range=[[1, 0], [1, 0]]),
                                  legend=None),
        tooltip=["series:N", "bar:Q", alt.Tooltip("value:Q", format=",.2f")],
    ).properties(width=900, height=320,
                 title=f"price and the average, ρ = {radius:.4f}")
    _layers = [_chart]
    if left_at is not None:
        _mark = alt.Chart(pl.DataFrame({"bar": [left_at]}).to_pandas()).mark_rule(
            color=VERMILLION, strokeDash=[5, 3], strokeWidth=2).encode(
            x="bar:Q", tooltip=[alt.Tooltip("bar:Q", title="left the data's range at bar")])
        _layers.append(_mark)
    mo.as_html(alt.layer(*_layers).resolve_scale(color="independent"))
    return


@app.cell
def _(mo):
    mo.md(r"""
## The stability boundary

Each cell is one $(n_a, n_b)$ pair at the $n_c$ you chose: **blue is stable**, the average decays back
toward price after a shock; **orange is unstable**, every shock compounds. The black contour is
$\rho = 1$, and the cross is where your sliders sit. The panel beside it counts what the recursion
actually did on the real closes at each setting.
""")
    return


@app.cell
def _(BLACK, BLUE, ORANGE, alt, grid, mo, na, nb, nc, pl):
    _slice = grid.filter(pl.col("nc") == nc.value)
    _heat = alt.Chart(_slice.to_pandas()).mark_rect().encode(
        x=alt.X("na:O", title="na — level correction"),
        y=alt.Y("nb:O", title="nb — velocity correction", sort="descending"),
        color=alt.Color("spectral_radius:Q", title="ρ",
                        scale=alt.Scale(scheme="blueorange", domainMid=1.0)),
        tooltip=["na:Q", "nb:Q", alt.Tooltip("spectral_radius:Q", format=".4f"),
                 "spectrally_stable:N", "went_negative_unbounded:N",
                 alt.Tooltip("left_range_at_bar:Q", title="left range at bar"),
                 alt.Tooltip("unbounded_minimum:Q", format=",.3g")],
    ).properties(width=430, height=380, title=f"spectral radius at nc = {nc.value:.2f}")
    _here = alt.Chart(pl.DataFrame({"na": [na.value], "nb": [nb.value]}).to_pandas()).mark_point(
        shape="cross", size=220, strokeWidth=3, color=BLACK).encode(x="na:O", y=alt.Y("nb:O", sort="descending"))

    _counts = grid.group_by("nc").agg(
        pl.col("spectrally_stable").not_().sum().alias("unstable"),
        pl.col("went_negative_unbounded").sum().alias("goes negative"),
        pl.col("left_range_at_bar").is_not_null().sum().alias("stopped early"),
    ).sort("nc").unpivot(index="nc", variable_name="outcome", value_name="combinations")
    _bars = alt.Chart(_counts.to_pandas()).mark_line(point=True, strokeWidth=2).encode(
        x=alt.X("nc:Q", title="nc — acceleration correction"),
        y=alt.Y("combinations:Q", title="combinations (of 361 per nc)"),
        color=alt.Color("outcome:N", scale=alt.Scale(
            domain=["unstable", "goes negative", "stopped early"], range=[ORANGE, BLUE, BLACK]), title=None),
        strokeDash=alt.StrokeDash("outcome:N", scale=alt.Scale(
            domain=["unstable", "goes negative", "stopped early"], range=[[1, 0], [5, 3], [2, 2]]), legend=None),
        tooltip=["nc:Q", "outcome:N", "combinations:Q"],
    ).properties(width=430, height=380, title="what each nc slice does on the real closes")
    mo.as_html(alt.hconcat(alt.layer(_heat, _here), _bars).resolve_scale(color="independent"))
    return


@app.cell
def _(mo):
    mo.md(r"""
## Every column of the measurement

One panel per numeric column of `hwma_parameter_grid`, with the eight numbers beneath it. The long
tails are the unstable corner: a handful of parameter sets reach values no price series could justify,
which is exactly why the chart now stops drawing once the line leaves the data's range.
""")
    return


@app.cell
def _(alt, grid, mo, np, pl):
    from scipy.stats import kurtosis as _kurtosis
    from scipy.stats import skew as _skew

    _numeric = [c for c, t in grid.schema.items() if t.is_numeric()]
    _hist_rows, _summary_rows = [], []
    for _column in _numeric:
        _v = grid[_column].cast(pl.Float64).to_numpy()
        _v = _v[np.isfinite(_v)]
        if len(_v) == 0:
            continue
        # Log-spaced bins where the column spans orders of magnitude, so a tail
        # of 1e90 does not collapse every real value into one bar.
        _positive = _v[_v > 0]
        _log = len(_positive) > 0 and _positive.max() / max(_positive.min(), 1e-12) > 1e4
        _values = np.log10(np.abs(_v) + 1e-12) if _log else _v
        _counts, _edges = np.histogram(_values, bins=40)
        _hist_rows += [{"column": _column + (" (log10 |value|)" if _log else ""),
                        "left": float(_edges[_i]), "right": float(_edges[_i + 1]), "count": int(_counts[_i])}
                       for _i in range(len(_counts))]
        _summary_rows.append({
            "column": _column, "count": len(_v), "mean": _v.mean(), "median": float(np.median(_v)),
            "standard_deviation": _v.std(ddof=1) if len(_v) > 1 else None,
            "skewness": float(_skew(_v)) if len(_v) > 2 and np.ptp(_v) > 0 else None,
            "excess_kurtosis": float(_kurtosis(_v)) if len(_v) > 3 and np.ptp(_v) > 0 else None,
            "percentile_25": float(np.percentile(_v, 25)), "percentile_75": float(np.percentile(_v, 75)),
            "minimum": _v.min(), "maximum": _v.max(),
        })
    _chart = alt.Chart(pl.DataFrame(_hist_rows).to_pandas()).mark_rect(
        color="#56B4E9", stroke="white", strokeWidth=0.3).encode(
        x=alt.X("left:Q", title=None, scale=alt.Scale(zero=False)), x2="right:Q",
        y=alt.Y("count:Q", title="combinations"),
        tooltip=["column:N", alt.Tooltip("left:Q", format=",.3g"), alt.Tooltip("right:Q", format=",.3g"), "count:Q"],
    ).properties(width=250, height=130).facet(
        facet=alt.Facet("column:N", title=None), columns=4).resolve_scale(x="independent", y="independent")
    mo.vstack([mo.as_html(_chart),
               mo.ui.table(pl.DataFrame(_summary_rows).with_columns(pl.col(pl.Float64).round(4)),
                           selection=None, page_size=20)])
    return


if __name__ == "__main__":
    app.run()
