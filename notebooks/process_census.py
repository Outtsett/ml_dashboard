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
    import subprocess
    import sys
    return alt, duckdb, mo, pathlib, pd, subprocess, sys


@app.cell
def _(mo):
    mo.md(
        r"""
# Why are there so many node processes?

A `npm run dev` on Windows does not start one process. It starts a **chain**, and
only the last link does any work. Everything above it is a shell wrapper that
launches the next thing and then sits idle holding around 40 MB.

This notebook counts what is actually running, separates **launcher plumbing**
from **runtime**, and lets you model what each launch strategy would cost.

Data lands in `data/diagnostics.duckdb`, table `process_census`, one row per
process per snapshot.
"""
    )
    return


@app.cell
def _(mo, pathlib):
    NOTEBOOK_DIRECTORY = mo.notebook_dir()
    REPOSITORY_ROOT = pathlib.Path(NOTEBOOK_DIRECTORY).resolve().parent
    DATABASE_PATH = REPOSITORY_ROOT / "data" / "diagnostics.duckdb"
    CENSUS_SCRIPT = REPOSITORY_ROOT / "scripts" / "process_census.py"

    # Okabe-Ito. Deuteranopia-safe; no red/green pairing carries meaning.
    OKABE_ITO = {
        "orange": "#E69F00",
        "sky_blue": "#56B4E9",
        "bluish_green": "#009E73",
        "yellow": "#F0E442",
        "blue": "#0072B2",
        "vermillion": "#D55E00",
        "reddish_purple": "#CC79A7",
        "black": "#000000",
    }
    return CENSUS_SCRIPT, DATABASE_PATH, OKABE_ITO


@app.cell
def _(mo):
    refresh_button = mo.ui.run_button(label="Take a new snapshot")
    refresh_button
    return (refresh_button,)


@app.cell
def _(CENSUS_SCRIPT, refresh_button, subprocess, sys):
    # Re-running the collector appends a snapshot; every downstream cell reacts.
    _collector_output = ""
    if refresh_button.value:
        _completed = subprocess.run(
            [sys.executable, str(CENSUS_SCRIPT)],
            capture_output=True,
            text=True,
        )
        _collector_output = _completed.stdout + _completed.stderr
    collector_output = _collector_output
    return (collector_output,)


@app.cell
def _(DATABASE_PATH, collector_output, duckdb):
    # `collector_output` is referenced so a refresh re-reads the table.
    _unused = collector_output
    _connection = duckdb.connect(str(DATABASE_PATH), read_only=True)
    latest_snapshot = _connection.execute(
        """
        SELECT * FROM process_census
        WHERE snapshot_timestamp = (SELECT max(snapshot_timestamp) FROM process_census)
        """
    ).df()
    _connection.close()
    return (latest_snapshot,)


@app.cell
def _(latest_snapshot, mo):
    _node = latest_snapshot[latest_snapshot["process_name"].str.lower() == "node.exe"]
    _plumbing = _node[_node["is_launcher_plumbing"]]
    _runtime = _node[~_node["is_launcher_plumbing"]]
    _timestamp = latest_snapshot["snapshot_timestamp"].iloc[0]

    _headline = mo.md(
        f"""
## Right now

| | node processes | resident memory |
|---|---:|---:|
| Launcher plumbing (does no work) | {len(_plumbing)} | {_plumbing["resident_memory_megabytes"].sum():,.0f} MB |
| Runtime (actually serving) | {len(_runtime)} | {_runtime["resident_memory_megabytes"].sum():,.0f} MB |
| **Total** | **{len(_node)}** | **{_node["resident_memory_megabytes"].sum():,.0f} MB** |

Snapshot taken {_timestamp:%Y-%m-%d %H:%M:%S}, across {len(latest_snapshot):,}
processes on the machine.
"""
    )
    _headline
    return


@app.cell
def _(mo):
    mo.md(r"""## Who owns each process""")
    return


@app.cell
def _(mo):
    process_name_filter = mo.ui.dropdown(
        options=["node.exe", "python.exe", "all processes"],
        value="node.exe",
        label="Show processes named",
    )
    minimum_memory_slider = mo.ui.slider(
        start=0,
        stop=200,
        step=5,
        value=0,
        label="Hide anything under (MB)",
        show_value=True,
    )
    mo.hstack([process_name_filter, minimum_memory_slider], justify="start", gap=2)
    return minimum_memory_slider, process_name_filter


@app.cell
def _(latest_snapshot, minimum_memory_slider, process_name_filter):
    _frame = latest_snapshot.copy()
    if process_name_filter.value != "all processes":
        _frame = _frame[
            _frame["process_name"].str.lower() == process_name_filter.value.lower()
        ]
    filtered_processes = _frame[
        _frame["resident_memory_megabytes"] >= minimum_memory_slider.value
    ]
    return (filtered_processes,)


@app.cell
def _(OKABE_ITO, alt, filtered_processes, mo):
    _by_category = filtered_processes.groupby(
        ["owner_category", "is_launcher_plumbing"], as_index=False
    ).agg(
        process_count=("process_identifier", "count"),
        resident_memory_megabytes=("resident_memory_megabytes", "sum"),
    )
    _by_category["role"] = _by_category["is_launcher_plumbing"].map(
        {True: "launcher plumbing", False: "runtime"}
    )

    _scale = alt.Scale(
        domain=["launcher plumbing", "runtime"],
        range=[OKABE_ITO["sky_blue"], OKABE_ITO["orange"]],
    )

    _count_chart = (
        alt.Chart(_by_category)
        .mark_bar()
        .encode(
            y=alt.Y("owner_category:N", sort="-x", title=None),
            x=alt.X("process_count:Q", title="number of processes"),
            color=alt.Color("role:N", scale=_scale, title="role"),
            tooltip=[
                "owner_category",
                "role",
                "process_count",
                "resident_memory_megabytes",
            ],
        )
        .properties(height=280, width=340, title="Process count by owner")
    )

    _memory_chart = (
        alt.Chart(_by_category)
        .mark_bar()
        .encode(
            y=alt.Y("owner_category:N", sort="-x", title=None, axis=None),
            x=alt.X("resident_memory_megabytes:Q", title="resident memory (MB)"),
            color=alt.Color("role:N", scale=_scale, legend=None),
            tooltip=[
                "owner_category",
                "role",
                "process_count",
                "resident_memory_megabytes",
            ],
        )
        .properties(height=280, width=340, title="Resident memory by owner")
    )

    mo.ui.altair_chart(_count_chart | _memory_chart)
    return


@app.cell
def _(mo):
    mo.md(
        r"""
## The chain

Each row is one process. Depth is how many launcher ancestors sit above it.
Only the deepest row holds a listening socket. Every row above it is a wrapper
waiting for its child to exit.
"""
    )
    return


@app.cell
def _(latest_snapshot, mo, pd):
    _dashboard = latest_snapshot[
        latest_snapshot["owner_category"].str.startswith("dashboard")
    ].copy()
    _dashboard = _dashboard.sort_values(["launcher_chain_depth", "process_identifier"])
    chain_ladder = pd.DataFrame(
        {
            "launcher_chain_depth": _dashboard["launcher_chain_depth"],
            "process_name": _dashboard["process_name"],
            "role": _dashboard["is_launcher_plumbing"].map(
                {True: "launcher plumbing", False: "runtime"}
            ),
            "owner_category": _dashboard["owner_category"],
            "resident_memory_megabytes": _dashboard["resident_memory_megabytes"],
            "listening_ports": _dashboard["listening_ports"],
            "command_line": _dashboard["command_line"].str.slice(0, 110),
        }
    )
    mo.ui.table(chain_ladder, selection=None, page_size=20)
    return (chain_ladder,)


@app.cell
def _(mo):
    mo.md(
        r"""
## What each launch strategy would cost

$$N_{\text{total}} \;=\; C \times \bigl(L + R\bigr) \;+\; 2M \;+\; P$$

| symbol | full-word name | what it holds | where it comes from |
|---|---|---|---|
| $N_{\text{total}}$ | total node processes | what Task Manager shows | computed below |
| $C$ | chain count | dev servers running at once | slider |
| $L$ | launcher processes per chain | the idle wrappers above the app | set by launch mode |
| $R$ | runtime processes per chain | processes that actually serve | fixed at 1 |
| $M$ | model context protocol server count | Claude Code connectors | slider |
| $P$ | python and esbuild children | hardware node, esbuild service | slider |

The factor **2** on $M$ is not a fudge. Every `npx -y <server>` costs an
`npx-cli.js` launcher that stays resident **plus** the server it launches.
"""
    )
    return


@app.cell
def _(mo):
    launch_mode_radio = mo.ui.radio(
        options={
            "npm run dev — npm, cross-env, tsx, nested node watch, app": 4,
            "npm run dev:lean — node --watch, one supervisor, app": 1,
            "node --watch --env-file=.env --import tsx (direct)": 1,
            "node --env-file=.env --import tsx (direct, no watch)": 0,
        },
        value="npm run dev — npm, cross-env, tsx, nested node watch, app",
        label="Launch mode, which sets L",
    )
    chain_count_slider = mo.ui.slider(
        start=1, stop=6, step=1, value=1,
        label="C — dev-server chains running", show_value=True,
    )
    mcp_server_slider = mo.ui.slider(
        start=0, stop=20, step=1, value=7,
        label="M — MCP servers connected", show_value=True,
    )
    child_process_slider = mo.ui.slider(
        start=0, stop=10, step=1, value=3,
        label="P — python and esbuild children", show_value=True,
    )
    mo.vstack(
        [
            launch_mode_radio,
            mo.hstack(
                [chain_count_slider, mcp_server_slider, child_process_slider],
                justify="start",
                gap=2,
            ),
        ]
    )
    return (
        chain_count_slider,
        child_process_slider,
        launch_mode_radio,
        mcp_server_slider,
    )


@app.cell
def _(
    chain_count_slider,
    child_process_slider,
    launch_mode_radio,
    mcp_server_slider,
    mo,
):
    _launcher_per_chain = launch_mode_radio.value
    _runtime_per_chain = 1
    _chains = chain_count_slider.value
    _mcp = mcp_server_slider.value
    _children = child_process_slider.value

    _dashboard_total = _chains * (_launcher_per_chain + _runtime_per_chain)
    _mcp_total = 2 * _mcp
    _grand_total = _dashboard_total + _mcp_total + _children

    _baseline = 1 * (4 + 1) + 2 * _mcp + _children
    _delta = _grand_total - _baseline

    _verdict = mo.md(
        f"""
### {_grand_total} node processes

| term | expands to | value |
|---|---|---:|
| C x (L + R) | {_chains} x ({_launcher_per_chain} + {_runtime_per_chain}) | {_dashboard_total} |
| 2M | 2 x {_mcp} | {_mcp_total} |
| P | — | {_children} |
| **total** | | **{_grand_total}** |

Of the {_dashboard_total} dashboard processes, **{_chains * _runtime_per_chain}**
{"does" if _chains * _runtime_per_chain == 1 else "do"} work and
**{_chains * _launcher_per_chain}** sit idle as wrappers.

Against the `npm run dev` baseline with one chain: **{_delta:+d}** processes.
"""
    )
    _verdict
    return


@app.cell
def _(mo):
    mo.md(
        r"""
## Distribution of resident memory, by owner

Mean and standard deviation describe a Gaussian, and process memory is not
Gaussian. Skewness and kurtosis show the single fat process that drags the mean,
and minimum and maximum name it.
"""
    )
    return


@app.cell
def _(filtered_processes, mo):
    _grouped = filtered_processes.groupby("owner_category")["resident_memory_megabytes"]
    distribution_statistics = (
        _grouped.agg(
            count="count",
            mean="mean",
            median="median",
            standard_deviation="std",
            skewness=lambda _s: _s.skew() if len(_s) >= 3 else float("nan"),
            kurtosis=lambda _s: _s.kurt() if len(_s) >= 4 else float("nan"),
            percentile_25=lambda _s: _s.quantile(0.25),
            percentile_75=lambda _s: _s.quantile(0.75),
            minimum="min",
            maximum="max",
        )
        .round(2)
        .reset_index()
    )
    mo.ui.table(distribution_statistics, selection=None, page_size=15)
    return (distribution_statistics,)


@app.cell
def _(mo):
    mo.md(
        r"""
## Every numeric column, one panel each

Nothing summarized without also being seen.
"""
    )
    return


@app.cell
def _(OKABE_ITO, alt, filtered_processes, mo):
    _numeric_columns = [
        "resident_memory_megabytes",
        "launcher_chain_depth",
        "listening_port_count",
    ]
    _panels = []
    for _column in _numeric_columns:
        _panels.append(
            alt.Chart(filtered_processes)
            .mark_bar(color=OKABE_ITO["blue"])
            .encode(
                x=alt.X(f"{_column}:Q", bin=alt.Bin(maxbins=24), title=_column),
                y=alt.Y("count():Q", title="processes"),
                tooltip=[alt.Tooltip("count():Q", title="processes")],
            )
            .properties(width=280, height=180, title=_column)
        )

    mo.ui.altair_chart(alt.hconcat(*_panels).resolve_scale(y="independent"))
    return


@app.cell
def _(collector_output, mo):
    _shown = (
        mo.md(f"```\n{collector_output}\n```")
        if collector_output
        else mo.md("_Press **Take a new snapshot** to re-sample the machine._")
    )
    _shown
    return


if __name__ == "__main__":
    app.run()
