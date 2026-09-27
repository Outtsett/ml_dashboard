import marimo

__generated_with = "0.16.5"
app = marimo.App(width="full")


@app.cell
def _():
    import marimo as mo

    mo.md(
        """
        # Model Cycle runs — every run, every bar, every prediction, from the lake

        Reads the same serving views the dashboard uses: `derived_model_cycle_runs_<table>` (one recipe per run:
        `runs`, `bars`, `predictions`, `trades`, `folds`, `epochs`, `trials`, `metrics`) and
        `derived_model_cycle_audit_<table>` (the 2026-09-26 audit). Pick a run; every table is drawn beside its
        eight-number summary. A run recorded before 2026-09-27 has only predictions, trades and folds.
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
    OKABE = {
        "orange": "#E69F00", "blue": "#0072B2", "sky": "#56B4E9", "vermillion": "#D55E00",
        "yellow": "#F0E442", "green": "#009E73", "purple": "#CC79A7", "black": "#000000",
    }

    def view_exists(name: str) -> bool:
        return con.execute("SELECT count(*) FROM duckdb_views() WHERE view_name = ?", [name]).fetchone()[0] > 0

    def frame(sql: str, parameters=None) -> pl.DataFrame:
        try:
            return pl.from_arrow(con.execute(sql, parameters or []).fetch_arrow_table())
        except Exception as error:  # noqa: BLE001 - a missing view reads as an empty frame, with the reason kept
            return pl.DataFrame({"error": [str(error)[:300]]})

    def eight_numbers(values: pl.Series) -> dict:
        clean = values.drop_nulls().cast(pl.Float64)
        n = clean.len()
        if n == 0:
            return {"count": 0}
        out = {
            "count": n, "mean": clean.mean(), "median": clean.median(), "standard_deviation": clean.std() if n > 1 else float("nan"),
            "skewness": clean.skew() if n > 2 else float("nan"), "kurtosis": clean.kurtosis() if n > 3 else float("nan"),
            "percentile_25": clean.quantile(0.25), "percentile_75": clean.quantile(0.75), "minimum": clean.min(), "maximum": clean.max(),
        }
        return {k: (float(v) if v is not None else float("nan")) if k != "count" else v for k, v in out.items()}
    return OKABE, alt, con, eight_numbers, frame, json, math, pl, view_exists


@app.cell
def _(frame, mo, pl, view_exists):
    if view_exists("derived_model_cycle_runs_runs"):
        runs = frame(
            """
            SELECT recipe, model_id, status, symbol, timeframe, model_key, model_label, implementation, direction_mode,
                   to_timestamp(started_at_timestamp) AS started_at, elapsed_seconds, bar_count, bars_processed, fold_count,
                   folds_completed, tuning_mode, tuning_enabled, tuning_trials_per_fold, tuning_objective, tuning_pinned_parameters,
                   label_horizon_bars, label_gap_multiple, gap_crossing_bar_count, tick_size, round_trip_cost_usd,
                   net_profit_usd, sharpe_ratio, sortino_ratio, maximum_drawdown_usd, profit_factor, win_rate, trade_count,
                   accuracy, f1_score, roc_auc, log_loss, brier_score, buy_and_hold_net_profit_usd,
                   price_forecast_mean_absolute_error_points, persistence_mean_absolute_error_points, price_forecast_skill
            FROM derived_model_cycle_runs_runs ORDER BY started_at_timestamp DESC NULLS LAST
            """
        )
    else:
        runs = pl.DataFrame()
    older = frame(
        """
        SELECT recipe, count(*) AS fold_count, min(test_start) AS first_test, max(test_end) AS last_test,
               sum(test_bar_count) AS test_bars
        FROM derived_model_cycle_runs_folds GROUP BY recipe ORDER BY last_test DESC
        """
    )
    mo.vstack([
        mo.md(f"## Runs — {runs.height} with a full record, {older.height} recipes in the lake in all"),
        mo.ui.table(runs.to_pandas(), selection=None, page_size=15) if runs.height else mo.md("_No run has landed a `runs` table yet: the next run started from the dashboard will._"),
        mo.md("### Every recipe with folds landed (the older three-table runs included)"),
        mo.ui.table(older.to_pandas(), selection=None, page_size=10),
    ])
    return older, runs


@app.cell
def _(OKABE, alt, mo, runs):
    if runs.height and "sharpe_ratio" in runs.columns:
        points = runs.select(["recipe", "model_label", "symbol", "timeframe", "net_profit_usd", "sharpe_ratio", "trade_count", "accuracy", "status"]).drop_nulls(["net_profit_usd", "sharpe_ratio"])
        scatter = (
            alt.Chart(points.to_pandas())
            .mark_point(size=90, filled=True)
            .encode(
                x=alt.X("sharpe_ratio:Q", title="Sharpe ratio (per bar, annualised)"),
                y=alt.Y("net_profit_usd:Q", title="Net profit, USD"),
                color=alt.Color("model_label:N", title="Model", scale=alt.Scale(range=list(OKABE.values()))),
                shape=alt.Shape("status:N", title="Status"),
                tooltip=["recipe", "model_label", "symbol", "timeframe", "net_profit_usd", "sharpe_ratio", "trade_count", "accuracy"],
            )
            .properties(height=320, title="Every recorded run: net profit against Sharpe")
            .interactive()
        )
        out = mo.ui.altair_chart(scatter)
    else:
        out = mo.md("_The run scatter needs the `runs` table._")
    out
    return


@app.cell
def _(mo, older, runs):
    options = {}
    for r in runs.iter_rows(named=True) if runs.height else []:
        options[f"{r['recipe']} · {r['status']}"] = r["recipe"]
    for r in older.iter_rows(named=True):
        if r["recipe"] not in options.values():
            options[f"{r['recipe']} · folds only"] = r["recipe"]
    run_picker = mo.ui.dropdown(options=options, value=next(iter(options)) if options else None, label="Run")
    bins = mo.ui.slider(10, 80, value=40, step=5, label="Histogram bins")
    mo.hstack([run_picker, bins], justify="start", gap=2)
    return bins, run_picker


@app.cell
def _(frame, run_picker):
    recipe = run_picker.value
    predictions = frame(
        """
        SELECT * EXCLUDE (recipe) FROM derived_model_cycle_runs_predictions WHERE recipe = ? ORDER BY timestamp
        """,
        [recipe],
    ) if recipe else None
    trades = frame("SELECT * EXCLUDE (recipe) FROM derived_model_cycle_runs_trades WHERE recipe = ? ORDER BY trade_number", [recipe]) if recipe else None
    folds = frame("SELECT * EXCLUDE (recipe) FROM derived_model_cycle_runs_folds WHERE recipe = ? ORDER BY fold_index", [recipe]) if recipe else None
    trials = frame("SELECT * EXCLUDE (recipe) FROM derived_model_cycle_runs_trials WHERE recipe = ? ORDER BY fold_index, trial", [recipe]) if recipe else None
    epochs = frame("SELECT * EXCLUDE (recipe) FROM derived_model_cycle_runs_epochs WHERE recipe = ? ORDER BY fold_index, trial, epoch", [recipe]) if recipe else None
    metrics = frame("SELECT * EXCLUDE (recipe) FROM derived_model_cycle_runs_metrics WHERE recipe = ? ORDER BY fold_index, iteration", [recipe]) if recipe else None
    bars_summary = frame(
        """
        SELECT role, count(*) AS bars, min(to_timestamp(timestamp)) AS first_bar, max(to_timestamp(timestamp)) AS last_bar,
               sum(CASE WHEN roll_adjustment_points <> 0 THEN 1 ELSE 0 END) AS roll_adjusted_bars
        FROM derived_model_cycle_runs_bars WHERE recipe = ? GROUP BY role ORDER BY role
        """,
        [recipe],
    ) if recipe else None
    return bars_summary, epochs, folds, metrics, predictions, recipe, trades, trials


@app.cell
def _(eight_numbers, mo, pl, predictions, recipe):
    def numeric_summary(table: pl.DataFrame) -> pl.DataFrame:
        rows = []
        for name in table.columns:
            if table[name].dtype in (pl.Float64, pl.Float32, pl.Int64, pl.Int32):
                rows.append({"column": name, **eight_numbers(table[name])})
        return pl.DataFrame(rows) if rows else pl.DataFrame()

    if predictions is not None and predictions.height and "error" not in predictions.columns:
        on_grid = None
        if "predicted_close" in predictions.columns and "tick_size" not in predictions.columns:
            forecasts = predictions.filter(pl.col("predicted_close").is_not_null())
            if forecasts.height:
                on_grid = forecasts.select(((pl.col("predicted_close") / 0.25 - (pl.col("predicted_close") / 0.25).round()).abs() < 1e-9).mean()).item()
        body = [
            mo.md(f"## Predictions — {predictions.height:,} processed bars of `{recipe}`"
                  + (f" · forecasts on the 0.25 grid: {on_grid:.1%}" if on_grid is not None else "")),
            mo.ui.table(numeric_summary(predictions).to_pandas(), selection=None, page_size=25),
        ]
    else:
        body = [mo.md(f"## Predictions — nothing landed for `{recipe}`" if recipe else "## Predictions")]
    mo.vstack(body)
    return (numeric_summary,)


@app.cell
def _(OKABE, alt, bins, mo, pl, predictions):
    charts = []
    if predictions is not None and predictions.height and "error" not in predictions.columns:
        frame_pd = predictions.with_columns(pl.from_epoch("timestamp", time_unit="s").alias("time")).to_pandas()
        charts.append(
            alt.Chart(frame_pd).mark_line(color=OKABE["orange"]).encode(
                x=alt.X("time:T", title="Bar"), y=alt.Y("equity_usd:Q", title="Equity, USD"),
                tooltip=["time:T", "equity_usd:Q", "position_held:Q" if "position_held" in frame_pd.columns else "predicted_direction:Q"],
            ).properties(height=220, title="Equity curve of the test walk").interactive()
        )
        charts.append(
            alt.Chart(frame_pd).mark_bar(color=OKABE["blue"]).encode(
                x=alt.X("probability_up:Q", bin=alt.Bin(maxbins=bins.value), title="P(up)"), y=alt.Y("count():Q", title="Bars"),
            ).properties(height=200, title="P(up) across processed bars")
        )
        if "predicted_close" in frame_pd.columns and "forecast_error_points" in frame_pd.columns:
            resolved = predictions.filter(pl.col("forecast_error_points").is_not_null()).to_pandas()
            if len(resolved):
                charts.append(
                    alt.Chart(resolved).mark_bar(color=OKABE["purple"]).encode(
                        x=alt.X("forecast_error_points:Q", bin=alt.Bin(maxbins=bins.value), title="Forecast error, points (forecast minus actual move)"),
                        y=alt.Y("count():Q", title="Bars"),
                    ).properties(height=200, title="Price forecast error")
                )
                charts.append(
                    alt.Chart(resolved).mark_point(color=OKABE["green"], opacity=0.5).encode(
                        x=alt.X("predicted_move_points:Q", title="Predicted move, points (on the tick grid)"),
                        y=alt.Y("forecast_error_points:Q", title="Error, points"),
                        tooltip=["predicted_move_points", "forecast_error_points", "predicted_close", "close"],
                    ).properties(height=220, title="Forecast versus its error").interactive()
                )
    mo.vstack(charts) if charts else mo.md("")
    return


@app.cell
def _(OKABE, alt, bins, mo, numeric_summary, pl, trades):
    if trades is not None and trades.height and "error" not in trades.columns:
        trades_pd = trades.to_pandas()
        histogram = alt.Chart(trades_pd).mark_bar().encode(
            x=alt.X("net_profit_usd:Q", bin=alt.Bin(maxbins=bins.value), title="Net profit per trade, USD"),
            y=alt.Y("count():Q", title="Trades"),
            color=alt.Color("side:N", scale=alt.Scale(domain=["long", "short"], range=[OKABE["orange"], OKABE["blue"]])),
        ).properties(height=200, title="Closed trades by net profit (orange long, blue short)")
        out = mo.vstack([
            mo.md(f"## Trades — {trades.height:,}"),
            mo.ui.altair_chart(histogram),
            mo.ui.table(numeric_summary(trades).to_pandas(), selection=None, page_size=15),
            mo.ui.table(trades_pd, selection=None, page_size=10),
        ])
    else:
        out = mo.md("## Trades — none landed")
    out
    return


@app.cell
def _(json, mo, pl, folds):
    if folds is not None and folds.height and "error" not in folds.columns:
        shown = folds
        if "parameters" in folds.columns:
            shown = folds.with_columns(pl.col("parameters").map_elements(lambda s: ", ".join(f"{k}={v}" for k, v in (json.loads(s) or {}).items()) if s else "", return_dtype=pl.String).alias("parameters_used"))
        keep = [c for c in ("fold_index", "status", "train_bar_count", "validation_bar_count", "test_bar_count", "training_seconds", "testing_seconds",
                            "tuning_objective", "tuning_trial_count", "tuning_best_trial", "tuning_best_value", "parameters_used", "metrics") if c in shown.columns]
        out = mo.vstack([mo.md(f"## Folds — {folds.height}, each with the hyperparameters its models were fitted with"),
                         mo.ui.table(shown.select(keep).to_pandas(), selection=None, page_size=10)])
    else:
        out = mo.md("## Folds — none landed")
    out
    return


@app.cell
def _(OKABE, alt, mo, trials):
    if trials is not None and trials.height and "error" not in trials.columns:
        trials_pd = trials.to_pandas()
        chart = alt.Chart(trials_pd).mark_point(size=70, filled=True).encode(
            x=alt.X("trial:Q", title="Trial"), y=alt.Y("objective_value:Q", title="Search score (inner validation blocks)"),
            color=alt.Color("state:N", scale=alt.Scale(domain=["complete", "pruned", "failed"], range=[OKABE["orange"], OKABE["sky"], OKABE["vermillion"]])),
            column=alt.Column("fold_index:N", title="Fold") if "fold_index" in trials_pd.columns else alt.Undefined,
            tooltip=list(trials_pd.columns),
        ).properties(height=200, title="Optuna trials per fold: a search score, optimistic by construction")
        out = mo.vstack([mo.md(f"## Tuning trials — {trials.height}"), mo.ui.altair_chart(chart), mo.ui.table(trials_pd, selection=None, page_size=10)])
    else:
        out = mo.md("## Tuning trials — none landed (the run was not tuned, or predates the record)")
    out
    return


@app.cell
def _(OKABE, alt, mo, epochs, metrics):
    parts = []
    if epochs is not None and epochs.height and "error" not in epochs.columns:
        epochs_pd = epochs.to_pandas()
        parts.append(mo.md(f"## Training steps — {epochs.height} epoch summaries"))
        parts.append(mo.ui.altair_chart(
            alt.Chart(epochs_pd).mark_line(point=True).encode(
                x=alt.X("epoch:Q", title="Epoch / round"), y=alt.Y("validation_loss:Q", title="Validation loss"),
                color=alt.Color("model_role:N", scale=alt.Scale(domain=["direction", "price"], range=[OKABE["orange"], OKABE["purple"]])),
                strokeDash=alt.StrokeDash("fold_index:N", title="Fold"), tooltip=list(epochs_pd.columns),
            ).properties(height=220, title="Validation loss per fold and model role").interactive()
        ))
    if metrics is not None and metrics.height and "error" not in metrics.columns:
        parts.append(mo.md(f"## Metric stream — {metrics.height} emitted values"))
        parts.append(mo.ui.table(metrics.to_pandas(), selection=None, page_size=10))
    mo.vstack(parts) if parts else mo.md("")
    return


@app.cell
def _(bars_summary, mo):
    if bars_summary is not None and bars_summary.height and "error" not in bars_summary.columns:
        out = mo.vstack([mo.md("## Bars the model read"), mo.ui.table(bars_summary.to_pandas(), selection=None)])
    else:
        out = mo.md("## Bars the model read — not landed for this run (recorded since 2026-09-27)")
    out
    return


@app.cell
def _(frame, mo):
    findings = frame("SELECT finding_number, area, severity, location, finding, status, what_was_done FROM derived_model_cycle_audit_findings ORDER BY finding_number")
    coverage = frame("SELECT status, count(*) AS specs FROM derived_model_cycle_audit_coverage GROUP BY status ORDER BY specs DESC")
    coverage_rows = frame("SELECT catalog_spec_id, category, subcategory, status, registry_key, implementation, adapter, reason FROM derived_model_cycle_audit_coverage ORDER BY status, category, catalog_spec_id")
    record = frame("SELECT table_name, one_row_per, columns, landed_at_every_fold FROM derived_model_cycle_audit_record")
    mo.vstack([
        mo.md("## The audit (2026-09-26) — `derived_model_cycle_audit_*`"),
        mo.md("### Findings"), mo.ui.table(findings.to_pandas(), selection=None, page_size=25),
        mo.md("### Catalog coverage"), mo.ui.table(coverage.to_pandas(), selection=None), mo.ui.table(coverage_rows.to_pandas(), selection=None, page_size=20),
        mo.md("### The run record"), mo.ui.table(record.to_pandas(), selection=None),
    ])
    return


if __name__ == "__main__":
    app.run()
