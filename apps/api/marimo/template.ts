/**
 * A new notebook, written from a template into one of the configured roots.
 *
 * The template carries the house rules so a notebook starts right instead of
 * being fixed later: a header cell the catalog reads its title and description
 * from, a DuckDB connection to the lake (`lake.serving.connect()`, with the UTC
 * setting the serving layer needs), the Okabe-Ito palette, the eight-number
 * distribution summary, one interactive histogram so a slider is wired from the
 * first save, and the Market chart follower (`lake.dashboard.follow_chart`): with
 * a chart context the example reads exactly the bars the chart shows
 * (`chart_bars`), without one it keeps its self-contained series. It exports clean in every notebook environment on this machine
 * (checked 2026-09-28 in the datalake, quant and forexmodel venvs).
 *
 * The name is checked before anything is written: lower-case snake case, and
 * never the name of a package a notebook imports — a `lake.py` next to the
 * notebooks shadows the `lake` package for every notebook in that folder.
 */

import { existsSync, statSync, writeFileSync } from "fs";
import path from "path";

export const FILE_NAME_PATTERN = /^[a-z][a-z0-9_]{1,60}$/;

/** Module names a notebook file must not take, because a file with that name
 *  beside the notebooks would be imported in place of the package. */
const SHADOWED_MODULES = new Set([
  "marimo", "duckdb", "altair", "numpy", "pandas", "polars", "scipy", "lake", "cycle",
  "torch", "sklearn", "matplotlib", "pyarrow", "json", "math", "random", "statistics",
  "test", "tests", "typing", "types", "string", "time", "datetime", "os", "sys", "io",
]);

/** Windows device names: `con.py` opens the console device, not a file. */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/** Checks a new notebook's name against the rules, and against the folder it goes
 *  into: a name that matches a package or module already beside it (`trend/`
 *  next to the quant notebooks) would shadow that too. */
export function validateFileName(fileName: string, rootPath?: string): string | null {
  if (!FILE_NAME_PATTERN.test(fileName)) {
    return "The file name must be lower-case letters, digits and underscores, starting with a letter (2 to 61 characters).";
  }
  if (WINDOWS_DEVICE_NAME.test(fileName)) {
    return `"${fileName}" is a Windows device name and cannot be a file; choose another name.`;
  }
  if (SHADOWED_MODULES.has(fileName)) {
    return `"${fileName}.py" would shadow the ${fileName} package for every notebook in that folder; choose another name.`;
  }
  if (rootPath && existsSync(path.join(rootPath, fileName))) {
    return `"${fileName}" is already a folder or package in that folder, and "${fileName}.py" would shadow it; choose another name.`;
  }
  return null;
}

/** Title and description go inside a raw triple-quoted string: no quotes run,
 *  no backslash, one line each. */
function clean(text: string, limit: number): string {
  return text.replace(/\\/g, "/").replace(/"{3,}/g, "\"").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function renderNotebookTemplate(title: string, description: string): string {
  const header = clean(title, 120) || "Untitled notebook";
  const summary = clean(description, 300) || "What this notebook shows, in one sentence.";
  return `import marimo

__generated_with = "0.25.0"
app = marimo.App(width="full")


@app.cell
def _():
    import marimo as mo
    return (mo,)


@app.cell
def _(mo):
    mo.md(r"""
# ${header}

${summary}
""")
    return


@app.cell
def _():
    import duckdb

    try:
        from lake.serving import connect

        con = connect()
        connection_source = "lake.serving.connect(), every served view including derived_*"
    except ImportError:
        con = duckdb.connect()
        connection_source = "an in-memory DuckDB (this environment has no lake package)"
    # The lake stores UTC; without this DuckDB renders the machine's local zone.
    con.execute("SET TimeZone='UTC'")
    return con, connection_source


@app.cell
def _(connection_source, mo):
    mo.md(f"Reading from {connection_source}.")
    return


@app.cell
def _():
    # Okabe-Ito: readable with deuteranopia. Up / positive = orange, down / negative = blue.
    OKABE_ITO = {
        "blue": "#0072B2",
        "orange": "#E69F00",
        "sky": "#56B4E9",
        "vermillion": "#D55E00",
        "yellow": "#F0E442",
        "bluish_green": "#009E73",
        "reddish_purple": "#CC79A7",
        "black": "#000000",
    }
    return (OKABE_ITO,)


@app.cell
def _():
    import numpy as np
    import pandas as pd
    from scipy import stats

    def distribution_summary(values):
        """Mean, median, standard deviation, skewness, kurtosis, 25th and 75th
        percentiles, minimum and maximum. A moment the sample is too small for
        (fewer than 3 values for skewness, 4 for kurtosis) is NaN, never omitted."""
        finite = np.asarray(values, dtype=float)
        finite = finite[np.isfinite(finite)]
        count = finite.size
        constant = count == 0 or float(np.ptp(finite)) == 0.0
        nan = float("nan")
        rows = [
            ("count", float(count)),
            ("mean", float(np.mean(finite)) if count else nan),
            ("median", float(np.median(finite)) if count else nan),
            ("standard deviation", float(np.std(finite, ddof=1)) if count > 1 else nan),
            ("skewness", float(stats.skew(finite, bias=False)) if count >= 3 and not constant else nan),
            ("kurtosis (excess)", float(stats.kurtosis(finite, bias=False)) if count >= 4 and not constant else nan),
            ("25th percentile", float(np.percentile(finite, 25)) if count else nan),
            ("75th percentile", float(np.percentile(finite, 75)) if count else nan),
            ("minimum", float(np.min(finite)) if count else nan),
            ("maximum", float(np.max(finite)) if count else nan),
        ]
        return pd.DataFrame(rows, columns=["statistic", "value"])

    return (distribution_summary,)


@app.cell
def _(mo):
    # Follows the Market chart: every cell that reads chart_follower re-runs when
    # the chart changes (lake.dashboard, docs in its module docstring). Without
    # the lake package or anywidget the notebook keeps its self-contained example.
    try:
        from lake import dashboard

        chart_follower = dashboard.follow_chart(mo)
    except ImportError:
        dashboard = None
        chart_follower = mo.md("Chart following needs the lake package and anywidget in this environment.")
    chart_follower
    return chart_follower, dashboard


@app.cell
def _(chart_follower, con, dashboard):
    # With a chart context the example is the close of exactly the bars the
    # chart shows. Replace it with the lake read this notebook is about: the
    # 1-minute MNQ bars, a derived_* view, or an s3://derived/ dataset.
    chart_context = dashboard.chart_context(chart_follower) if dashboard is not None else None
    example = None
    example_source = "a synthetic series (the Market chart has not published a context)"
    if chart_context is not None:
        try:
            _bars = dashboard.chart_bars(chart_context)
            if len(_bars):
                example = _bars.assign(bar_index=range(len(_bars)), example_value=_bars["close"])[
                    ["bar_index", "timestamp", "example_value"]
                ]
                example_source = (
                    f"the close of the {len(_bars):,} bars the chart shows "
                    f"({chart_context['symbol']} {chart_context['timeframe']})"
                )
        except dashboard.ChartLinkError as _error:
            example_source = f"a synthetic series (the chart's bars could not be read: {_error})"
    if example is None:
        example = con.sql(
            "SELECT range AS bar_index, sin(range / 15.0) + range / 400.0 AS example_value FROM range(500)"
        ).df()
    return chart_context, example, example_source


@app.cell
def _(mo):
    bin_count = mo.ui.slider(10, 80, value=30, label="Histogram bins")
    log_scale = mo.ui.checkbox(label="Log-scale count axis")
    mo.hstack([bin_count, log_scale], justify="start")
    return bin_count, log_scale


@app.cell
def _(OKABE_ITO, bin_count, distribution_summary, example, example_source, log_scale, mo):
    import altair as alt

    _histogram = (
        alt.Chart(example)
        .mark_bar(color=OKABE_ITO["blue"])
        .encode(
            x=alt.X("example_value:Q", bin=alt.Bin(maxbins=bin_count.value), title="Example value"),
            y=alt.Y("count():Q", title="Bar count", scale=alt.Scale(type="symlog" if log_scale.value else "linear")),
        )
        .properties(width=380, height=220, title="Example value, every bar")
    )
    _line = (
        alt.Chart(example)
        .mark_line(color=OKABE_ITO["orange"])
        .encode(x=alt.X("bar_index:Q", title="Bar index"), y=alt.Y("example_value:Q", title="Example value"))
        .properties(width=380, height=220, title="Example value over the bars")
    )
    mo.vstack([
        mo.md(f"The example value is {example_source}."),
        mo.hstack([_histogram, _line], justify="start"),
        mo.ui.table(distribution_summary(example["example_value"]), selection=None),
    ])
    return


if __name__ == "__main__":
    app.run()
`;
}

/** Writes the template to `<root>/<fileName>.py`, refusing to overwrite. Returns the absolute path. */
export function writeNotebookFromTemplate(rootPath: string, fileName: string, title: string, description: string): string {
  const target = path.resolve(rootPath, `${fileName}.py`);
  if (path.dirname(target) !== path.resolve(rootPath)) throw new Error("The notebook must be written directly inside the chosen folder.");
  // "wx": fail if the file exists, so an existing notebook is never replaced.
  writeFileSync(target, renderNotebookTemplate(title, description), { encoding: "utf8", flag: "wx" });
  if (!statSync(target).isFile()) throw new Error(`${target} is not a regular file.`);
  return target;
}

