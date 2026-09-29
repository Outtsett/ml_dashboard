import marimo

__generated_with = "0.16.5"
app = marimo.App(width="full")


@app.cell
def _():
    import marimo as mo

    mo.md(
        """
# Multimodal MNQ bracket model — every trial against the acceptance gate

The plan of record is `docs/plans/2026-09-29-multimodal/PLAN.md`; every step is in `CHECKPOINTS.md` beside it.
A trial is one walk-forward run of the runner `multimodal_fusion+bracket_meta_label`, started from the dashboard:
it trains per quarter, chooses the trading policy for each quarter from the EARLIER quarters only, trades every
session with 2:1 and 3:1 brackets on MNQ, and is scored after AMP costs on the canonical window 2021Q2..2025Q2.

| Gate | What it asks | Threshold |
|---|---|---|
| G1 | profitable after costs | net profit > 0 |
| G2 | trades every day | every session has a closed trade |
| G3 | win rate | >= 40% of trades win |
| G4 | 2:1 profit ratio (both readings) | average win >= 2x average loss AND profit factor >= 2 |
| G5 | not luck | bootstrap 95% lower bound > 0, >= 75% of quarters positive, profitable with +1 tick per side |

The locked holdout (2025-07-01 .. 2025-12-31) and the forward period (2026) are not in any table below until the
gate's single look.
"""
    )
    return (mo,)


@app.cell
def _():
    import json
    from pathlib import Path

    import altair as alt
    import polars as pl
    from lake import serving

    con = serving.connect(with_bars=False)
    con.execute("SET TimeZone='UTC'")
    OKABE = {"orange": "#E69F00", "blue": "#0072B2", "sky": "#56B4E9", "vermillion": "#D55E00",
             "yellow": "#F0E442", "green": "#009E73", "purple": "#CC79A7", "grey": "#8a8a8a"}

    def frame(sql: str) -> pl.DataFrame:
        try:
            return pl.from_arrow(con.execute(sql).to_arrow_table())
        except Exception as error:  # noqa: BLE001 - a missing view reads as an empty frame, with the reason kept
            return pl.DataFrame({"frame_error": [str(error)[:300]]})

    def eight_numbers(values: pl.Series) -> dict:
        clean = values.drop_nulls().cast(pl.Float64)
        n = clean.len()
        if n == 0:
            return {"count": 0}
        return {"count": n, "mean": clean.mean(), "median": clean.median(),
                "standard_deviation": clean.std() if n > 1 else float("nan"),
                "skewness": clean.skew() if n > 2 else float("nan"), "kurtosis": clean.kurtosis() if n > 3 else float("nan"),
                "percentile_25": clean.quantile(0.25), "percentile_75": clean.quantile(0.75),
                "minimum": clean.min(), "maximum": clean.max()}

    plan_dir = Path(__file__).resolve().parents[1] / "docs" / "plans" / "2026-09-29-multimodal"
    return OKABE, alt, eight_numbers, frame, json, pl, plan_dir


@app.cell
def _(frame, json, pl):
    _raw = frame(
        "SELECT recipe, scope, summary_json FROM derived_multimodal_runs_summary "
        "WHERE scope IN ('canonical_2021q2_2025q2', 'policy_tuned_quarters') AND recipe NOT LIKE 'gate_%'"
    )
    _rows = []
    if "summary_json" in _raw.columns:
        for _recipe, _scope, _json in _raw.iter_rows():
            _s = json.loads(_json)
            _rows.append({
                "trial": _recipe, "scope": _scope, "trade_count": _s.get("trade_count"),
                "sessions_traded_share": _s.get("sessions_traded_share"), "win_rate": _s.get("win_rate"),
                "payoff_ratio": _s.get("payoff_ratio"), "profit_factor": _s.get("profit_factor"),
                "net_profit_usd": _s.get("net_profit_usd"), "quarters_positive_share": _s.get("quarters_positive_share"),
                "bootstrap_probability_profitable": _s.get("bootstrap_probability_profitable"),
                "gate_passed_count": sum(bool(v) for v in (_s.get("gate") or {}).values()),
            })
    summaries = pl.DataFrame(_rows) if _rows else pl.DataFrame()
    # a trial scored before the canonical window existed keeps its policy-tuned scope (the same quarters)
    trials = (summaries.sort("scope").group_by("trial", maintain_order=True).first().sort("trial")
              if summaries.height else summaries)
    return (trials,)


@app.cell
def _(mo, plan_dir, trials):
    _ledger = plan_dir / "trials.jsonl"
    _count = sum(1 for _ in _ledger.open(encoding="utf-8")) if _ledger.exists() else 0
    _table = mo.ui.table(trials, selection=None, label=f"{trials.height} trials in the lake; {_count} lines in trials.jsonl")
    mo.vstack([mo.md("## Every trial, canonical window (2021Q2..2025Q2)"), _table])
    return


@app.cell
def _(OKABE, alt, mo, pl, trials):
    _charts = []
    if trials.height:
        for _metric, _line, _title in (("profit_factor", 2.0, "Profit factor (gate 2.0; coin-flip entries 0.88-0.95)"),
                                       ("win_rate", 0.40, "Win rate (gate 0.40)"),
                                       ("payoff_ratio", 2.0, "Average win / average loss (gate 2.0)"),
                                       ("net_profit_usd", 0.0, "Net profit, USD (gate > 0)")):
            _data = trials.select("trial", pl.col(_metric).alias("value")).to_pandas()
            _points = alt.Chart(_data).mark_circle(size=90, color=OKABE["blue"]).encode(
                x=alt.X("trial:N", sort=None, axis=alt.Axis(labelAngle=-40, labelLimit=160)), y=alt.Y("value:Q", title=_metric),
                tooltip=["trial", alt.Tooltip("value:Q", format=".4f")])
            _rule = alt.Chart().mark_rule(color=OKABE["orange"], strokeDash=[6, 4]).encode(y=alt.datum(_line))
            _charts.append((_points + _rule).properties(title=_title, width=420, height=220))
    _out = mo.hstack(_charts[:2]) if _charts else mo.md("No trial has landed yet.")
    _out2 = mo.hstack(_charts[2:]) if len(_charts) > 2 else mo.md("")
    mo.vstack([mo.md("## Each trial against its gate line (dashed, orange)"), _out, _out2])
    return


@app.cell
def _(mo, trials):
    _options = trials["trial"].to_list() if trials.height else []
    _best = trials.sort("profit_factor", descending=True)["trial"][0] if trials.height else None
    trial_picker = mo.ui.dropdown(options=_options, value=_best, label="Trial")
    trial_picker
    return (trial_picker,)


@app.cell
def _(frame, pl, trial_picker):
    _recipe = trial_picker.value or ""
    trades = frame(f"SELECT * FROM derived_multimodal_runs_trades WHERE recipe = '{_recipe}'")
    if "session" in trades.columns:
        trades = trades.with_columns((pl.col("net_points") * 2.0).alias("net_usd"),
                                     pl.from_epoch(pl.col("session") * 86400, time_unit="s").dt.date().alias("session_date"))
    return (trades,)


@app.cell
def _(OKABE, alt, eight_numbers, mo, pl, trades):
    if "net_usd" not in trades.columns or trades.height == 0:
        _out = mo.md("Pick a trial with trades.")
    else:
        _daily = trades.group_by("session_date").agg(pl.col("net_usd").sum()).sort("session_date").with_columns(
            pl.col("net_usd").cum_sum().alias("cumulative_net_usd"))
        _equity = alt.Chart(_daily.to_pandas()).mark_line(color=OKABE["blue"]).encode(
            x=alt.X("session_date:T", title="session"), y=alt.Y("cumulative_net_usd:Q", title="cumulative net, USD per contract"),
            tooltip=["session_date:T", alt.Tooltip("cumulative_net_usd:Q", format=",.2f")]).properties(width=620, height=260, title="Equity, out of sample")
        _quarters = trades.group_by("quarter").agg(pl.col("net_usd").sum(), pl.len().alias("trade_count")).sort("quarter").to_pandas()
        _bars = alt.Chart(_quarters).mark_bar().encode(
            x=alt.X("quarter:N", sort=None), y=alt.Y("net_usd:Q", title="net, USD"),
            color=alt.condition(alt.datum.net_usd > 0, alt.value(OKABE["orange"]), alt.value(OKABE["blue"])),
            tooltip=["quarter", alt.Tooltip("net_usd:Q", format=",.2f"), "trade_count"]).properties(width=620, height=220,
                                                                                               title="Net by quarter (orange up, blue down)")
        _hist = alt.Chart(trades.select("net_points").to_pandas()).mark_bar().encode(
            x=alt.X("net_points:Q", bin=alt.Bin(maxbins=60), title="trade net points"), y="count()",
            color=alt.condition(alt.datum.net_points > 0, alt.value(OKABE["orange"]), alt.value(OKABE["blue"]))).properties(
            width=420, height=220, title="Trade outcomes")
        _eight = eight_numbers(trades["net_points"])
        _by_head = trades.group_by("head").agg(pl.len().alias("trade_count"), (pl.col("net_points") > 0).mean().alias("win_rate"),
                                               pl.col("net_points").mean().alias("expectancy_points"), pl.col("forced").mean().alias("forced_share")).sort("head")
        _out = mo.vstack([mo.hstack([_equity, _hist]), _bars,
                          mo.md("**Trade net points, eight numbers:** " + ", ".join(f"{k} {v:,.3f}" if isinstance(v, float) else f"{k} {v}" for k, v in _eight.items())),
                          mo.ui.table(_by_head, selection=None, label="By bracket head")])
    _out
    return


@app.cell
def _(OKABE, alt, frame, mo, pl, trial_picker):
    _recipe = trial_picker.value or ""
    _p = frame(f"SELECT * FROM derived_multimodal_runs_predictions WHERE recipe = '{_recipe}'")
    _charts = []
    if "long_r2_probability" in _p.columns:
        for _head in ("long_r2", "short_r2", "long_r3", "short_r3"):
            _d = _p.select(pl.col(f"{_head}_probability").alias("p"), pl.col(f"{_head}_net_points").alias("net")).drop_nulls()
            _d = _d.with_columns((pl.col("p").rank("ordinal") * 10 / (_d.height + 1)).floor().cast(pl.Int32).alias("decile"))
            _g = _d.group_by("decile").agg(pl.col("p").mean().alias("predicted"), (pl.col("net") > 0).mean().alias("realised")).sort("decile").to_pandas()
            _base = alt.Chart(_g).encode(x=alt.X("decile:O", title=f"{_head}: predicted-probability decile"))
            _charts.append((_base.mark_line(color=OKABE["blue"], point=True).encode(y=alt.Y("realised:Q", title="win rate")) +
                            _base.mark_line(color=OKABE["orange"], strokeDash=[5, 3], point=True).encode(y="predicted:Q")).properties(
                width=300, height=200, title=f"{_head}: realised (blue) vs predicted (orange)"))
    mo.vstack([mo.md("## Does the model rank outcomes? Realised win rate by predicted-probability decile"),
               mo.hstack(_charts) if _charts else mo.md("No predictions for this trial.")])
    return


@app.cell
def _(OKABE, alt, frame, mo, pl, trial_picker):
    _recipe = trial_picker.value or ""
    _imp = frame(f"SELECT * FROM derived_multimodal_runs_importance WHERE recipe = '{_recipe}'")
    _parts = []
    if "auc_drop" in _imp.columns:
        _drops = _imp.filter(pl.col("auc_drop").is_not_null() & pl.col("auc_drop").is_not_nan())
        if _drops.height:
            _g = (_drops.with_columns(pl.col("feature").str.replace("__token", "").alias("block"))
                  .group_by("block", "head").agg(pl.col("auc_drop").mean()).to_pandas())
            _heads = sorted(_g["head"].unique())
            _palette = [OKABE[k] for k in ("blue", "orange", "sky", "vermillion")][: len(_heads)]
            _parts += [mo.md("## Modality ablation: test-quarter AUC lost when one block is switched off "
                             "(fusion: its token zeroed; gradient-boosted trees: its columns shuffled; 0 = the block adds nothing)"),
                       alt.Chart(_g).mark_bar().encode(
                           x=alt.X("auc_drop:Q", title="AUC drop"), y=alt.Y("block:N", title="block"),
                           color=alt.Color("head:N", scale=alt.Scale(domain=_heads, range=_palette), title="head"),
                           row=alt.Row("head:N", title=None),
                           tooltip=["block", "head", alt.Tooltip("auc_drop:Q", format=".4f")]).properties(width=420, height=120)]
    if "gain_share" in _imp.columns:
        _gain = _imp.filter(~pl.col("feature").str.ends_with("__token") & pl.col("gain_share").is_not_null()
                            & pl.col("gain_share").is_not_nan())
        if _gain.height:
            _g2 = (_gain.with_columns(pl.col("feature").str.split("_").list.first().alias("block"))
                   .group_by("block", "head").agg(pl.col("gain_share").sum() / pl.col("fold").n_unique()).to_pandas())
            _parts += [mo.md("## Share of the gradient-boosted trees' split gain, per block"),
                       alt.Chart(_g2).mark_bar(color=OKABE["sky"]).encode(
                           x=alt.X("gain_share:Q", title="share of split gain"), y=alt.Y("block:N", title="block"),
                           row=alt.Row("head:N", title=None),
                           tooltip=["block", "head", alt.Tooltip("gain_share:Q", format=".3f")]).properties(width=420, height=120)]
    mo.vstack(_parts or [mo.md("## Modalities"), mo.md("No importance recorded.")])
    return


@app.cell
def _(OKABE, alt, frame, mo):
    _b = frame("SELECT * FROM derived_multimodal_labels_base_rates WHERE breakdown = 'decision_hour'")
    if "profit_factor" in _b.columns:
        _d = _b.to_pandas()
        _d["bracket"] = _d["side"].map({1: "long", -1: "short"}) + " " + _d["reward_multiple"].astype(int).astype(str) + ":1"
        _heat = alt.Chart(_d).mark_rect().encode(
            x=alt.X("decision_hour:O", title="decision hour, Pacific"), y=alt.Y("bracket:N"),
            color=alt.Color("profit_factor:Q", scale=alt.Scale(scheme="cividis")),
            tooltip=["bracket", "decision_hour", alt.Tooltip("profit_factor:Q", format=".3f"), alt.Tooltip("win_rate:Q", format=".3f"),
                     "recipe"]).properties(width=520, height=160, title="Coin-flip entries: profit factor by hour (the bar every model must beat)")
        _out = mo.vstack([mo.md("## Base rates"), _heat])
    else:
        _out = mo.md("Base rates not landed.")
    _out
    return


@app.cell
def _(frame, mo):
    _a = frame("SELECT path, relevant_to_training, edge_evidence, lookahead_risk, costs_included, out_of_sample, edge_summary, recommendation "
               "FROM derived_multimodal_notebook_audit_notebooks ORDER BY edge_evidence, path")
    mo.vstack([mo.md("## The notebook audit (P1): 72 notebooks, what each established"), mo.ui.table(_a, selection=None, page_size=15)])
    return


@app.cell
def _(frame, json, mo):
    _g = frame("SELECT recipe, summary_json FROM derived_multimodal_runs_summary WHERE recipe LIKE 'gate_%'")
    if "summary_json" in _g.columns and _g.height:
        _lines = []
        for _recipe, _json in _g.iter_rows():
            _s = json.loads(_json)
            _lines.append(f"- **{_recipe}**: {_s}")
        _md = "## The acceptance gate (holdout, one look)\n\n" + "\n".join(_lines)
    else:
        _md = "## The acceptance gate (holdout, one look)\n\nNot run yet: the holdout 2025-07-01..2025-12-31 is still locked (0 of 1 looks)."
    mo.md(_md)
    return


if __name__ == "__main__":
    app.run()
