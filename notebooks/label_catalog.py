import marimo

__generated_with = "0.16.5"
app = marimo.App(width="full")


@app.cell
def _():
    import marimo as mo

    mo.md(
        """
        # Label catalog — every landed label set, its lifecycle and what the labels are worth

        Reads the lake through the same serving views the dashboard uses: `derived_labels` (every landed set,
        one recipe per label set) and `derived_label_audit_*` (the 2026-09-26 audit record). Pick a set, and
        every contract column is drawn beside its eight-number summary; the sample-weight formula below is
        steppable bar by bar.
        """
    )
    return (mo,)


@app.cell
def _():
    import json
    import math

    import altair as alt
    import polars as pl
    from lake import serving

    con = serving.connect()
    con.execute("SET TimeZone='UTC'")

    # Okabe-Ito, never red/green for meaning.
    OKABE = {
        "orange": "#E69F00", "blue": "#0072B2", "sky": "#56B4E9", "vermillion": "#D55E00",
        "yellow": "#F0E442", "green": "#009E73", "purple": "#CC79A7", "black": "#000000",
    }
    return OKABE, alt, con, json, math, pl


@app.cell
def _(con, json, pl):
    # The manifest is the registry: one line per landed set with its validation report.
    manifest_text = con.execute("SELECT content FROM read_text('s3://meta/ingest_manifests/labels.jsonl')").fetchone()[0]
    manifest_rows = []
    for raw in manifest_text.splitlines():
        raw = raw.strip()
        if not raw:
            continue
        line = json.loads(raw)
        validation = line.get("validation") or {}
        gates = validation.get("gates") or {}
        manifest_rows.append({
            "label_set_id": line.get("label_set_id"),
            "recipe": line.get("recipe"),
            "generator_type": line.get("generator_type"),
            "label_encoding": line.get("label_encoding"),
            "symbol": line.get("symbol"),
            "timeframe_minutes": line.get("timeframe_minutes"),
            "rows": line.get("rows"),
            "first_event": line.get("ts_min"),
            "last_event": line.get("ts_max"),
            "max_horizon_bars": line.get("max_horizon_bars"),
            "purge_bars": line.get("purge_bars"),
            "validation_passed": validation.get("passed"),
            "class_balance_ratio": validation.get("classBalanceRatio"),
            "coverage_fraction": validation.get("coverageFraction"),
            "no_lookahead": (gates.get("noLookahead") or {}).get("detail"),
            "written_at": line.get("written_at"),
            "parameters": json.dumps(line.get("parameters"), sort_keys=True),
        })
    manifest = pl.DataFrame(manifest_rows).sort("label_set_id")
    return (manifest,)


@app.cell
def _(manifest, mo):
    mo.vstack([
        mo.md(f"## Landed sets — {manifest.height} recipes in `derived_labels`"),
        mo.ui.table(manifest.to_pandas(), selection=None, page_size=20),
    ])
    return


@app.cell
def _(manifest, mo):
    recipe_options = {f"#{r['label_set_id']} {r['recipe']}": r["recipe"] for r in manifest.iter_rows(named=True)}
    recipe_picker = mo.ui.dropdown(options=recipe_options, value=next(iter(recipe_options)) if recipe_options else None, label="Label set")
    bins = mo.ui.slider(10, 80, value=40, step=5, label="Histogram bins")
    usable_only = mo.ui.switch(value=True, label="Usable rows only")
    log_scale = mo.ui.switch(value=False, label="Log count axis")
    mo.hstack([recipe_picker, bins, usable_only, log_scale], justify="start", gap=2)
    return bins, log_scale, recipe_picker, usable_only


@app.cell
def _(con, pl, recipe_picker, usable_only):
    recipe = recipe_picker.value
    where = "WHERE recipe = ?" + (" AND usable" if usable_only.value else "")
    rows = pl.from_arrow(con.execute(
        f"""
        SELECT timestamp, close, label, resolution_bars, realized_return_points, realized_return_fraction,
               realized_return_volatility_units, trailing_volatility_points, concurrent_label_count,
               sample_uniqueness_weight, return_attribution_weight, clears_round_trip_cost, usable, usable_reason
        FROM derived_labels {where}
        ORDER BY timestamp
        """,
        [recipe],
    ).arrow())
    return recipe, rows


@app.cell
def _(mo, pl, rows):
    NUMERIC_COLUMNS = [
        "label", "resolution_bars", "realized_return_points", "realized_return_fraction", "realized_return_volatility_units",
        "trailing_volatility_points", "concurrent_label_count", "sample_uniqueness_weight", "return_attribution_weight",
    ]

    def eight_numbers(frame: pl.DataFrame, column: str) -> dict:
        s = frame.get_column(column).cast(pl.Float64).drop_nulls().drop_nans()
        n = s.len()
        return {
            "column": column,
            "count": n,
            "mean": s.mean() if n else None,
            "median": s.median() if n else None,
            "standard_deviation": s.std() if n > 1 else None,
            "skewness": s.skew() if n >= 3 else None,
            "kurtosis": s.kurtosis() if n >= 4 else None,
            "percentile_25": s.quantile(0.25) if n else None,
            "percentile_75": s.quantile(0.75) if n else None,
            "minimum": s.min() if n else None,
            "maximum": s.max() if n else None,
        }

    summary = pl.DataFrame([eight_numbers(rows, c) for c in NUMERIC_COLUMNS])
    mo.vstack([
        mo.md(f"### Eight numbers per contract column — {rows.height:,} rows"),
        mo.ui.table(summary.to_pandas(), selection=None),
    ])
    return (NUMERIC_COLUMNS,)


@app.cell
def _(NUMERIC_COLUMNS, OKABE, alt, bins, log_scale, mo, rows):
    # Every column gets its own graphic: a histogram per column, in one grid.
    charts = []
    for column in NUMERIC_COLUMNS:
        data = rows.select(column).drop_nulls().to_pandas()
        if data.empty:
            continue
        y = alt.Y("count()", title="rows", scale=alt.Scale(type="symlog") if log_scale.value else alt.Undefined)
        charts.append(
            alt.Chart(data, title=column.replace("_", " "))
            .mark_bar(color=OKABE["blue"])
            .encode(x=alt.X(f"{column}:Q", bin=alt.Bin(maxbins=bins.value), title=column.replace("_", " ")), y=y, tooltip=[alt.Tooltip(f"{column}:Q", bin=True), "count()"])
            .properties(width=260, height=150)
        )
    grid = alt.concat(*charts, columns=3).resolve_scale(x="independent", y="independent")
    mo.vstack([mo.md("### Distribution of every column"), grid])
    return


@app.cell
def _(OKABE, alt, mo, pl, rows):
    # Label share by month: does the class mix drift through the history?
    monthly = (
        rows.with_columns(pl.col("timestamp").dt.truncate("1mo").alias("month"))
        .group_by(["month", "label"]).len()
        .with_columns((pl.col("len") / pl.col("len").sum().over("month")).alias("share"))
        .sort(["month", "label"])
    )
    labels_present = sorted(monthly.get_column("label").unique().to_list())
    if len(labels_present) <= 6:
        palette = [OKABE["blue"], OKABE["purple"], OKABE["orange"], OKABE["green"], OKABE["sky"], OKABE["vermillion"]]
        chart = (
            alt.Chart(monthly.to_pandas())
            .mark_area(interpolate="step")
            .encode(
                x=alt.X("month:T", title="month"),
                y=alt.Y("share:Q", stack="normalize", title="share of rows"),
                color=alt.Color("label:N", scale=alt.Scale(range=palette[: len(labels_present)]), title="label"),
                tooltip=["month:T", "label:N", alt.Tooltip("len:Q", title="rows"), alt.Tooltip("share:Q", format=".3f")],
            )
            .properties(width=900, height=220, title="Label share by month")
        )
    else:
        chart = (
            alt.Chart(rows.with_columns(pl.col("timestamp").dt.truncate("1mo").alias("month")).group_by("month").agg(pl.col("label").mean().alias("mean_label"), pl.len().alias("rows")).sort("month").to_pandas())
            .mark_line(color=OKABE["blue"], point=True)
            .encode(x="month:T", y=alt.Y("mean_label:Q", title="mean label"), tooltip=["month:T", "mean_label:Q", "rows:Q"])
            .properties(width=900, height=220, title="Mean label by month (continuous label)")
        )
    mo.vstack([mo.md("### The label through time"), chart])
    return


@app.cell
def _(OKABE, alt, mo, pl, rows):
    # Realized return against the causal volatility scale: what one unit of the label was worth.
    sample = rows.filter(pl.col("realized_return_points").is_not_null() & pl.col("trailing_volatility_points").is_not_null())
    if sample.height > 20000:
        sample = sample.sample(20000, seed=0)
    scatter = (
        alt.Chart(sample.select(["trailing_volatility_points", "realized_return_points", "label"]).to_pandas())
        .mark_circle(size=6, opacity=0.35)
        .encode(
            x=alt.X("trailing_volatility_points:Q", title="trailing volatility (points, causal, 100 bars)"),
            y=alt.Y("realized_return_points:Q", title="realized return (points)"),
            color=alt.Color("label:N", scale=alt.Scale(range=[OKABE["blue"], OKABE["purple"], OKABE["orange"], OKABE["green"], OKABE["sky"]]), title="label"),
            tooltip=["trailing_volatility_points:Q", "realized_return_points:Q", "label:N"],
        )
        .properties(width=900, height=300, title="Realized return against the volatility scale (up to 20,000 rows)")
        .interactive()
    )
    mo.vstack([mo.md("### Return against volatility"), scatter])
    return


@app.cell
def _(mo):
    mo.md(
        r"""
        ### The sample weights, as objects

        Average uniqueness of label $i$ over its span $[t_{i,0},\, t_{i,1}]$ (López de Prado, AFML 4.5):

        $$\bar u_i \;=\; \frac{1}{t_{i,1}-t_{i,0}+1}\sum_{t=t_{i,0}}^{t_{i,1}} \frac{1}{c_t}, \qquad
        c_t \;=\; \#\{\, j : t_{j,0} \le t \le t_{j,1} \,\}$$

        | glyph | name | holds | units |
        |---|---|---|---|
        | $i$ | label index | the label whose weight is being computed | — |
        | $t_{i,0}$ | event bar | the bar the label is computed from (`timestamp`) | bar ordinal |
        | $t_{i,1}$ | resolution bar | `timestamp` + `resolution_bars` | bar ordinal |
        | $c_t$ | concurrency | labels whose span covers bar $t$ (`concurrent_label_count` at the event bar) | count |
        | $\bar u_i$ | average uniqueness | `sample_uniqueness_weight`, in $(0, 1]$ | fraction |

        Step through a window of the selected set: the slider picks a bar, the table shows every label whose span
        covers it, $c_t$ for that bar, and the running sum that becomes the selected label's $\bar u_i$.
        """
    )
    return


@app.cell
def _(mo, rows):
    window_start = mo.ui.slider(0, max(0, rows.height - 60), value=0, step=1, label="First label of the window (row index)")
    step = mo.ui.slider(0, 59, value=0, step=1, label="Step: which label of the window to trace")
    mo.hstack([window_start, step], gap=2)
    return step, window_start


@app.cell
def _(mo, pl, rows, step, window_start):
    window = rows.slice(window_start.value, 60).with_row_index("k")
    if window.height == 0:
        mo.md("No rows in this window.")
    else:
        # Bar ordinals inside the window: event = k, resolution = k + resolution_bars (rows are consecutive bars
        # for a per-bar generator; for a sparse generator the ordinal is the row index, an approximation).
        spans = window.select(
            pl.col("k"),
            pl.col("timestamp"),
            pl.col("label"),
            pl.col("resolution_bars").cast(pl.Int64).alias("resolution_bars"),
            (pl.col("k") + pl.col("resolution_bars").cast(pl.Int64)).alias("resolution_k"),
            pl.col("sample_uniqueness_weight"),
        )
        chosen = spans.filter(pl.col("k") == min(step.value, window.height - 1)).row(0, named=True)
        terms = []
        running = 0.0
        for t in range(chosen["k"], chosen["resolution_k"] + 1):
            covering = spans.filter((pl.col("k") <= t) & (pl.col("resolution_k") >= t))
            c_t = covering.height
            running += 1.0 / c_t if c_t else 0.0
            terms.append({"bar t": t, "c_t (labels covering t)": c_t, "1 / c_t": round(1.0 / c_t, 4) if c_t else None, "running sum": round(running, 4)})
        span_length = chosen["resolution_k"] - chosen["k"] + 1
        mo.vstack([
            mo.md(
                f"Label at row **{chosen['k']}** ({chosen['timestamp']}), label {chosen['label']}, resolves {chosen['resolution_bars']} bars later. "
                f"Window estimate of ū = {running:.4f} / {span_length} = **{running / span_length:.4f}**; landed `sample_uniqueness_weight` = **{chosen['sample_uniqueness_weight']:.4f}** "
                f"(the landed value counts labels outside this 60-row window too)."
            ),
            mo.ui.table(pl.DataFrame(terms).to_pandas(), selection=None),
        ])
    return


@app.cell
def _(con, mo, pl):
    audit_tables = {}
    for name in ("findings", "generators", "legacy_tables", "suite"):
        try:
            audit_tables[name] = pl.from_arrow(con.execute(f"SELECT * EXCLUDE (recipe) FROM derived_label_audit_{name}").arrow())
        except Exception as exc:  # the audit record is landed by scripts/land_label_audit.py
            audit_tables[name] = pl.DataFrame({"missing": [str(exc)[:200]]})
    mo.vstack([
        mo.md("## The audit record (2026-09-26) — `derived_label_audit_*`"),
        mo.md("### Findings, by severity"),
        mo.ui.table(audit_tables["findings"].to_pandas(), selection=None, page_size=25),
        mo.md("### Every generator and what changed"),
        mo.ui.table(audit_tables["generators"].to_pandas(), selection=None, page_size=25),
        mo.md("### Legacy label tables in the lake"),
        mo.ui.table(audit_tables["legacy_tables"].to_pandas(), selection=None),
        mo.md("### The canonical suite"),
        mo.ui.table(audit_tables["suite"].to_pandas(), selection=None, page_size=40),
    ])
    return


if __name__ == "__main__":
    app.run()
