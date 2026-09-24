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
# The data lifecycle, audited

Every byte of market data takes the same trip: it is **stored** in the lake, **retrieved** by DuckDB,
**moved** to the server, the browser or a Python process, **computed on**, **held in memory**,
**temporarily saved** in a cache or on disk, and eventually **destroyed** — evicted, expired,
cleaned up, or never. This notebook is the audit of that trip, one stage at a time.

Think of it as a warehouse walk-through: where the stock sits on the shelves, how long it takes a
picker to fetch an order, how many times the same box gets copied onto a different shelf, and
which back rooms fill up because nobody ever throws anything out.

Every finding was measured by a researcher and then attacked by a separate verifier who re-opened
the code and re-ran the numbers. What survived is below; what was struck is at the bottom with the
reason. The numbers live in the lake at
`s3://derived/data_lifecycle_audit/recipe=measured_audit_2026_09_23/`.
"""
    )
    return


@app.cell
def _(duckdb_connect):
    RECIPE_ROOT = "s3://derived/data_lifecycle_audit/recipe=measured_audit_2026_09_23"
    connection = duckdb_connect()

    def read_table(name):
        return connection.execute(
            # hive_partitioning off: otherwise the recipe= and table= path
            # segments come back as two extra columns on every table.
            f"SELECT * FROM read_parquet('{RECIPE_ROOT}/table={name}/*.parquet', hive_partitioning = false)"
        ).pl()

    # Okabe-Ito. Severity is carried by colour AND by marker shape AND by label,
    # so nothing depends on telling two hues apart.
    SEVERITY_ORDER = ["critical", "high", "medium", "low"]
    SEVERITY_COLOUR = ["#D55E00", "#E69F00", "#56B4E9", "#0072B2"]
    SEVERITY_SHAPE = ["diamond", "triangle-up", "circle", "square"]
    EFFORT_ORDER = ["small", "medium", "large"]
    STAGE_ORDER = [
        "store_layout", "retrieve", "transfer_serialize", "compute",
        "memory", "temporary_storage", "end_of_life",
    ]
    STAGE_LABEL = {
        "store_layout": "1 · stored (layout on disk)",
        "retrieve": "2 · retrieved (read / query)",
        "transfer_serialize": "3 · moved (serialized, sent)",
        "compute": "4 · computed on",
        "memory": "5 · held in memory",
        "temporary_storage": "6 · temporarily saved",
        "end_of_life": "7 · destroyed (or not)",
    }
    STRAND_LABEL = {
        "lake_storage": "Lake (Iceberg + serving snapshot)",
        "server_read_path": "Server read path + browser",
        "temporary_storage": "Caches and temp stores",
        "python_compute": "Python training + builders",
        "gaps": "Gaps (critic)",
    }
    return (
        EFFORT_ORDER,
        SEVERITY_COLOUR,
        SEVERITY_ORDER,
        SEVERITY_SHAPE,
        STAGE_LABEL,
        STAGE_ORDER,
        STRAND_LABEL,
        read_table,
    )


@app.cell
def _(STAGE_LABEL, STRAND_LABEL, pl, read_table):
    findings = read_table("findings").with_columns(
        pl.col("lifecycle_stage").replace_strict(STAGE_LABEL, default=pl.col("lifecycle_stage")).alias("stage_label"),
        pl.col("strand").replace_strict(STRAND_LABEL, default=pl.col("strand")).alias("strand_label"),
    )
    refuted_findings = read_table("refuted_findings")
    headline_measurements = read_table("headline_measurements")
    documentation_confirmed = read_table("documentation_confirmed")
    raw_table_index = read_table("raw_table_index")
    return (
        documentation_confirmed,
        findings,
        headline_measurements,
        raw_table_index,
        refuted_findings,
    )


@app.cell
def _(EFFORT_ORDER, SEVERITY_ORDER, STAGE_LABEL, STAGE_ORDER, STRAND_LABEL, findings, mo):
    stage_filter = mo.ui.multiselect(
        options={STAGE_LABEL[_s]: _s for _s in STAGE_ORDER},
        value=[STAGE_LABEL[_s] for _s in STAGE_ORDER],
        label="Lifecycle stage",
    )
    severity_filter = mo.ui.multiselect(options=SEVERITY_ORDER, value=SEVERITY_ORDER, label="Severity")
    effort_filter = mo.ui.multiselect(options=EFFORT_ORDER, value=EFFORT_ORDER, label="Effort")
    _strands = sorted(findings["strand"].unique().to_list())
    strand_filter = mo.ui.multiselect(
        options={STRAND_LABEL.get(_s, _s): _s for _s in _strands},
        value=[STRAND_LABEL.get(_s, _s) for _s in _strands],
        label="Where in the system",
    )
    text_filter = mo.ui.text(label="Search text", placeholder="e.g. cache, iceberg, float32")
    mo.hstack([stage_filter, severity_filter, effort_filter, strand_filter, text_filter], wrap=True)
    return effort_filter, severity_filter, stage_filter, strand_filter, text_filter


@app.cell
def _(effort_filter, findings, pl, severity_filter, stage_filter, strand_filter, text_filter):
    _text = (text_filter.value or "").strip().lower()
    filtered_findings = findings.filter(
        pl.col("lifecycle_stage").is_in(stage_filter.value)
        & pl.col("severity").is_in(severity_filter.value)
        & pl.col("effort").is_in(effort_filter.value)
        & pl.col("strand").is_in(strand_filter.value)
    )
    if _text:
        filtered_findings = filtered_findings.filter(
            pl.concat_str(["title", "component", "current_behavior", "improvement", "file_path"], separator=" ")
            .str.to_lowercase()
            .str.contains(_text, literal=True)
        )
    return (filtered_findings,)


@app.cell
def _(SEVERITY_ORDER, filtered_findings, findings, mo, pl):
    def _count(frame, severity):
        return frame.filter(pl.col("severity") == severity).height

    mo.hstack(
        [mo.stat(value=f"{filtered_findings.height} of {findings.height}", label="findings shown", bordered=True)]
        + [
            mo.stat(value=str(_count(filtered_findings, _s)), label=f"{_s} severity", bordered=True)
            for _s in SEVERITY_ORDER
        ],
        justify="start",
    )
    return


@app.cell
def _(mo):
    mo.md(
        r"""
## Where along the trip the problems are

Each column is one stage of the lifecycle, left to right in the order a byte travels. Each row is
the part of the system that owns it. A bigger mark means more findings in that cell; the colour
**and** the shape say how bad the worst one is (◆ critical, ▲ high, ● medium, ■ low).
Click a mark to narrow the table below to that cell; click empty space to clear it.
"""
    )
    return


@app.cell
def _(
    SEVERITY_COLOUR,
    SEVERITY_ORDER,
    SEVERITY_SHAPE,
    STAGE_LABEL,
    STAGE_ORDER,
    alt,
    filtered_findings,
    mo,
    pl,
):
    _rank = {_s: _i for _i, _s in enumerate(SEVERITY_ORDER)}
    _cells = (
        filtered_findings.with_columns(pl.col("severity").replace_strict(_rank).alias("severity_rank"))
        .group_by(["stage_label", "strand_label"])
        .agg(
            pl.len().alias("finding_count"),
            pl.col("severity_rank").min().alias("worst_severity_rank"),
            pl.col("title").str.join(" | ").alias("titles"),
        )
        .with_columns(
            pl.col("worst_severity_rank")
            .replace_strict({_i: _s for _s, _i in _rank.items()}, return_dtype=pl.Utf8)
            .alias("worst_severity")
        )
    )
    _select = alt.selection_point(fields=["stage_label", "strand_label"], name="cell")
    _chart = (
        alt.Chart(_cells.to_pandas())
        .mark_point(filled=True, opacity=0.9)
        .encode(
            x=alt.X("stage_label:N", sort=[STAGE_LABEL[_s] for _s in STAGE_ORDER], title="Lifecycle stage",
                    axis=alt.Axis(labelAngle=0, labelLimit=150, labelFontSize=12, titleFontSize=13,
                                  labelExpr="split(datum.label, ' (')")),
            y=alt.Y("strand_label:N", title="Part of the system",
                    axis=alt.Axis(labelFontSize=12, titleFontSize=13, labelLimit=260)),
            size=alt.Size("finding_count:Q", title="Findings in the cell", scale=alt.Scale(range=[150, 1800]),
                          legend=alt.Legend(orient="bottom")),
            # Colour and shape share one title, so Vega-Lite merges them into a
            # single legend: every severity reads by hue AND by marker.
            color=alt.Color("worst_severity:N", title="Worst severity in the cell",
                            scale=alt.Scale(domain=SEVERITY_ORDER, range=SEVERITY_COLOUR),
                            legend=alt.Legend(orient="bottom", symbolSize=180)),
            shape=alt.Shape("worst_severity:N", title="Worst severity in the cell",
                            scale=alt.Scale(domain=SEVERITY_ORDER, range=SEVERITY_SHAPE)),
            tooltip=[
                alt.Tooltip("stage_label:N", title="Stage"),
                alt.Tooltip("strand_label:N", title="Part"),
                alt.Tooltip("finding_count:Q", title="Findings"),
                alt.Tooltip("worst_severity:N", title="Worst severity"),
                alt.Tooltip("titles:N", title="Titles"),
            ],
        )
        .add_params(_select)
        .properties(height=340, width=1050)
    )
    lifecycle_map = mo.ui.altair_chart(_chart)
    lifecycle_map
    return (lifecycle_map,)


@app.cell
def _(filtered_findings, lifecycle_map, pl):
    _picked = lifecycle_map.value
    if _picked is not None and len(_picked) > 0 and "stage_label" in _picked.columns:
        _keys = pl.from_pandas(_picked[["stage_label", "strand_label"]]).unique()
        map_findings = filtered_findings.join(_keys, on=["stage_label", "strand_label"], how="semi")
    else:
        map_findings = filtered_findings
    return (map_findings,)


@app.cell
def _(mo):
    mo.md(
        r"""
## What to do first

Across: how much work the fix is. Up: how much it matters. The top-left corner is the cheap,
important work. Each mark is one finding; marks in the same box are spread sideways so none hide
another. Hover for the title and the expected gain.
"""
    )
    return


@app.cell
def _(EFFORT_ORDER, SEVERITY_COLOUR, SEVERITY_ORDER, SEVERITY_SHAPE, alt, map_findings, mo):
    _chart = (
        alt.Chart(map_findings.select(
            "identifier", "title", "severity", "effort", "expected_gain", "component", "stage_label"
        ).to_pandas())
        .mark_point(filled=True, size=180, opacity=0.85)
        .encode(
            x=alt.X("effort:N", sort=EFFORT_ORDER, scale=alt.Scale(domain=EFFORT_ORDER), title="Effort to fix",
                    axis=alt.Axis(labelAngle=0, labelFontSize=13, titleFontSize=13)),
            xOffset=alt.XOffset("identifier:N"),
            y=alt.Y("severity:N", sort=SEVERITY_ORDER, scale=alt.Scale(domain=SEVERITY_ORDER), title="Severity",
                    axis=alt.Axis(labelFontSize=13, titleFontSize=13)),
            color=alt.Color("severity:N", title="Severity",
                            scale=alt.Scale(domain=SEVERITY_ORDER, range=SEVERITY_COLOUR),
                            legend=alt.Legend(orient="bottom", symbolSize=180)),
            shape=alt.Shape("severity:N", title="Severity",
                            scale=alt.Scale(domain=SEVERITY_ORDER, range=SEVERITY_SHAPE)),
            tooltip=["identifier", "title", "component", "stage_label", "expected_gain"],
        )
        .properties(height=300, width=1050)
    )
    priority_chart = mo.ui.altair_chart(_chart)
    priority_chart
    return (priority_chart,)


@app.cell
def _(SEVERITY_ORDER, EFFORT_ORDER, map_findings, mo, pl, priority_chart):
    _picked = priority_chart.value
    _frame = map_findings
    if _picked is not None and len(_picked) > 0 and "identifier" in _picked.columns:
        _frame = _frame.filter(pl.col("identifier").is_in(list(_picked["identifier"])))
    _frame = _frame.with_columns(
        pl.col("severity").replace_strict({_s: _i for _i, _s in enumerate(SEVERITY_ORDER)}).alias("_severity_rank"),
        pl.col("effort").replace_strict({_s: _i for _i, _s in enumerate(EFFORT_ORDER)}).alias("_effort_rank"),
    ).sort(["_severity_rank", "_effort_rank", "identifier"])
    findings_table = mo.ui.table(
        _frame.select(
            "identifier", "severity", "effort", "stage_label", "component", "title", "expected_gain",
            "measured_value", "measured_unit", "file_path", "line_number",
        ).rename({
            "stage_label": "lifecycle stage", "expected_gain": "expected gain",
            "measured_value": "measured value", "measured_unit": "measured unit",
            "file_path": "file path", "line_number": "line number",
        }),
        selection="single",
        page_size=15,
        label="Findings — select a row to read the whole finding",
    )
    findings_table
    return (findings_table,)


@app.cell
def _(findings, findings_table, mo, pl):
    _chosen = findings_table.value
    if _chosen is None or len(_chosen) == 0:
        _card = mo.md("_Select a finding in the table above to read what the code does now, the evidence, "
                      "the fix, the expected gain, the risk and what the verifier changed._")
    else:
        _identifier = _chosen["identifier"][0] if hasattr(_chosen, "columns") else _chosen[0]["identifier"]
        _row = findings.filter(pl.col("identifier") == _identifier).row(0, named=True)
        _location = _row["file_path"] + (f":{_row['line_number']}" if _row["line_number"] else "")
        _measured = (
            f"{_row['measured_value']:,.6g} {_row['measured_unit']}" if _row["measured_value"] is not None
            else "not a single number"
        )
        _card = mo.md(
f"""### {_row['identifier']} — {_row['title']}

**Severity** {_row['severity']} · **effort** {_row['effort']} · **confidence** {_row['confidence']} ·
**stage** {_row['stage_label']} · **part** {_row['strand_label']} · **verifier** {_row['verdict']}

`{_location}`

| | |
|---|---|
| **What happens now** | {_row['current_behavior']} |
| **Measured** | {_measured} |
| **Evidence** | {_row['evidence']} |
| **The change** | {_row['improvement']} |
| **Expected gain** | {_row['expected_gain']} |
| **What could break** | {_row['risk']} |
| **What the verifier checked** | {_row['verification_note']} |
"""
        )
    _card
    return


@app.cell
def _(mo):
    mo.md(
        r"""
## Every column of the findings, drawn

One small panel per column, so nothing in the table is summarized without also being seen.
Category columns show a count per value; the number columns show their distribution; the long
text columns show how much was written in each (a thin finding shows up as a short bar).
The panels follow the filters at the top.
"""
    )
    return


@app.cell
def _(mo):
    findings_panel_top = mo.ui.slider(start=5, stop=40, step=1, value=12, label="Values shown per category panel")
    findings_panel_bins = mo.ui.slider(start=5, stop=60, step=1, value=20, label="Bins per numeric panel")
    findings_panel_log = mo.ui.checkbox(value=False, label="Log scale on counts")
    mo.hstack([findings_panel_top, findings_panel_bins, findings_panel_log], justify="start")
    return findings_panel_bins, findings_panel_log, findings_panel_top


@app.cell
def _(alt, pl):
    OKABE_BLUE = "#0072B2"
    OKABE_ORANGE = "#E69F00"

    def column_panel(frame, column, top, bins, log_scale):
        """One small multiple for one column; the panel type follows the column's data."""
        _series = frame.get_column(column)
        _scale = alt.Scale(type="symlog") if log_scale else alt.Scale()
        _title = column.replace("_", " ")
        if _series.dtype.is_numeric():
            _data = frame.select(pl.col(column).cast(pl.Float64)).drop_nulls().to_pandas()
            if len(_data) == 0:
                return None
            return (
                alt.Chart(_data, title=_title)
                .mark_bar(color=OKABE_BLUE)
                .encode(
                    x=alt.X(f"{column}:Q", bin=alt.Bin(maxbins=bins), title=_title),
                    y=alt.Y("count():Q", scale=_scale, title="rows"),
                    tooltip=[alt.Tooltip("count():Q", title="rows")],
                )
                .properties(width=260, height=150)
            )
        _text = _series.cast(pl.Utf8).fill_null("(empty)")
        _distinct = _text.n_unique()
        if _distinct <= max(top, 25) or _distinct < 0.5 * len(_text):
            _counts = (
                _text.value_counts(sort=True).head(top).rename({column: "value"}).to_pandas()
            )
            return (
                alt.Chart(_counts, title=f"{_title} ({_distinct} distinct)")
                .mark_bar(color=OKABE_BLUE)
                .encode(
                    y=alt.Y("value:N", sort="-x", title=None),
                    x=alt.X("count:Q", scale=_scale, title="rows"),
                    tooltip=["value", "count"],
                )
                .properties(width=260, height=max(90, 14 * len(_counts)))
            )
        _lengths = pl.DataFrame({"characters": _text.str.len_chars()}).to_pandas()
        return (
            alt.Chart(_lengths, title=f"{_title} — characters written per row")
            .mark_bar(color=OKABE_ORANGE)
            .encode(
                x=alt.X("characters:Q", bin=alt.Bin(maxbins=bins), title="characters"),
                y=alt.Y("count():Q", scale=_scale, title="rows"),
            )
            .properties(width=260, height=150)
        )

    def small_multiples(frame, top, bins, log_scale, per_row=4):
        _panels = [p for p in (column_panel(frame, c, top, bins, log_scale) for c in frame.columns) if p is not None]
        _rows = [alt.hconcat(*_panels[_i:_i + per_row]) for _i in range(0, len(_panels), per_row)]
        return alt.vconcat(*_rows) if _rows else None

    return (small_multiples,)


@app.cell
def _(
    filtered_findings,
    findings_panel_bins,
    findings_panel_log,
    findings_panel_top,
    small_multiples,
):
    small_multiples(
        filtered_findings.drop("stage_label", "strand_label"),
        findings_panel_top.value,
        findings_panel_bins.value,
        findings_panel_log.value,
    )
    return


@app.cell
def _(mo):
    mo.md(
        r"""
## The measurements behind the findings

Every number a researcher measured, grouped by where in the system it was taken. The raw per-item
tables (one row per file, per endpoint call, per directory, per dtype…) are below that: pick one
and every column gets its own panel plus the full eight-number summary.
"""
    )
    return


@app.cell
def _(STRAND_LABEL, headline_measurements, mo, pl):
    mo.ui.table(
        headline_measurements.with_columns(
            pl.col("strand").replace_strict(STRAND_LABEL, default=pl.col("strand")).alias("part of the system")
        ).select("part of the system", "measurement_name", "value", "unit", "method", "raw_table_name")
        .rename({"measurement_name": "measurement", "raw_table_name": "raw table"}),
        page_size=12,
        selection=None,
        label="Headline measurements",
    )
    return


@app.cell
def _(mo, raw_table_index):
    raw_table_picker = mo.ui.dropdown(
        options={
            f"{_r['strand']} · {_r['source_file']} ({_r['row_count']:,} rows)": _r["raw_table_name"]
            for _r in raw_table_index.iter_rows(named=True)
        },
        value=None,
        label="Raw measurement table",
    )
    raw_panel_bins = mo.ui.slider(start=5, stop=80, step=1, value=30, label="Bins per numeric panel")
    raw_panel_top = mo.ui.slider(start=5, stop=40, step=1, value=15, label="Values shown per category panel")
    raw_panel_log = mo.ui.checkbox(value=True, label="Log scale on counts")
    mo.hstack([raw_table_picker, raw_panel_bins, raw_panel_top, raw_panel_log], wrap=True)
    return raw_panel_bins, raw_panel_log, raw_panel_top, raw_table_picker


@app.cell
def _(mo, pl, raw_table_index, raw_table_picker, read_table):
    if raw_table_picker.value:
        raw_table = read_table(raw_table_picker.value)
    elif raw_table_index.height:
        raw_table = read_table(raw_table_index.sort("row_count", descending=True)["raw_table_name"][0])
    else:
        raw_table = pl.DataFrame()

    def eight_number_summary(frame):
        _rows = []
        for _column in frame.columns:
            _values = frame.get_column(_column)
            if not _values.dtype.is_numeric():
                continue
            _values = _values.cast(pl.Float64).drop_nulls()
            _count = _values.len()
            _rows.append({
                "column": _column,
                "rows": _count,
                "mean": _values.mean(),
                "median": _values.median(),
                "standard deviation": _values.std(),
                "skewness": _values.skew() if _count >= 3 else None,
                "kurtosis (excess)": _values.kurtosis() if _count >= 4 else None,
                "25th percentile": _values.quantile(0.25, "linear"),
                "75th percentile": _values.quantile(0.75, "linear"),
                "minimum": _values.min(),
                "maximum": _values.max(),
            })
        return pl.DataFrame(_rows) if _rows else pl.DataFrame({"column": []})

    mo.vstack([
        mo.md(f"**{raw_table_picker.selected_key or 'largest raw table'}** — {raw_table.height:,} rows, "
              f"{raw_table.width} columns"),
        mo.ui.table(eight_number_summary(raw_table), selection=None, label="Eight-number summary, every numeric column"),
        mo.ui.table(raw_table, page_size=10, selection=None, label="The rows"),
    ])
    return (raw_table,)


@app.cell
def _(raw_panel_bins, raw_panel_log, raw_panel_top, raw_table, small_multiples):
    small_multiples(raw_table, raw_panel_top.value, raw_panel_bins.value, raw_panel_log.value) if raw_table.width else None
    return


@app.cell
def _(mo, refuted_findings):
    mo.vstack([
        mo.md(
            r"""
## What the verifiers struck

These were proposed by a researcher and rejected by the verifier who re-opened the code and
re-ran the numbers — either the claim was false, the fix was wrong for the installed version, or
it repeated another finding. They are kept so the same idea is not proposed twice.
"""
        ),
        mo.ui.table(refuted_findings, selection=None, page_size=10),
    ])
    return


@app.cell
def _(documentation_confirmed, mo):
    mo.vstack([
        mo.md("## Library behaviour confirmed from source or documentation"),
        mo.ui.table(documentation_confirmed, selection=None, page_size=10),
    ])
    return


if __name__ == "__main__":
    app.run()
