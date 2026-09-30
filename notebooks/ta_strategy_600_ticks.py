import marimo

__generated_with = "0.16.5"
app = marimo.App(width="full")


@app.cell
def _():
    import marimo as mo

    mo.md(
        r"""
        # TA-indicator strategy vs 600 MNQ ticks a day

        Every round of the study (`src/ml/ta_strategy`, rounds in `src/config/ta_strategy_rounds.json`, reference
        `docs/ta-strategy-600-ticks.md`) lands its tables in the lake as `derived_ta_strategy_600_ticks_<table>`:
        `rounds`, `configurations`, `folds`, `daily`, `trades`, `predictions`, `feature_importance`, `rolls`,
        `oracle_by_session`, and `reviews` (what the review after each round found, and what to change next).

        **One tick is 0.25 index points = 0.50 USD on one MNQ contract. 600 ticks = 150 points = 300 USD a day.**
        A round trip costs 1.39 USD per side x 2 = 2.78 USD = 5.56 ticks (`src/config/cost_model.json`).
        """
    )
    return (mo,)


@app.cell
def _():
    import math

    import altair as alt
    import numpy as np
    import polars as pl
    from lake import serving

    con = serving.connect()
    con.execute("SET TimeZone='UTC'")
    OKABE = {"orange": "#E69F00", "blue": "#0072B2", "sky": "#56B4E9", "vermillion": "#D55E00",
             "yellow": "#F0E442", "green": "#009E73", "purple": "#CC79A7", "black": "#000000"}
    GOAL = 600.0
    COST_TICKS = 5.56
    PREFIX = "derived_ta_strategy_600_ticks_"

    def view_exists(name: str) -> bool:
        return con.execute("SELECT count(*) FROM duckdb_views() WHERE view_name = ?", [name]).fetchone()[0] > 0

    def frame(sql: str, parameters=None) -> pl.DataFrame:
        try:
            return pl.from_arrow(con.execute(sql, parameters or []).to_arrow_table())
        except Exception as error:  # noqa: BLE001 - a missing view reads as an empty frame with its reason
            return pl.DataFrame({"frame_error": [str(error)[:300]]})

    def eight_numbers(values) -> dict:
        x = np.asarray(values, dtype=float)
        x = x[np.isfinite(x)]
        n = x.size
        if n == 0:
            return {"count": 0}
        from scipy import stats

        return {"count": n, "mean": x.mean(), "median": float(np.median(x)),
                "standard_deviation": x.std(ddof=1) if n > 1 else math.nan,
                "skewness": float(stats.skew(x)) if n > 2 else math.nan,
                "excess_kurtosis": float(stats.kurtosis(x)) if n > 3 else math.nan,
                "percentile_25": float(np.percentile(x, 25)), "percentile_75": float(np.percentile(x, 75)),
                "minimum": x.min(), "maximum": x.max()}

    def small_multiples(data: pl.DataFrame, columns: list[str], bins: int, log_count: bool, width: int = 190):
        """One histogram per column, each on its own x scale, labelled with the column's full name."""
        numeric = [c for c in columns if c in data.columns and (data[c].dtype.is_numeric() or data[c].dtype == pl.Boolean)]
        if not numeric or data.height == 0:
            return None
        rows = []
        for column in numeric:  # binned here, so a 600k-row table sends only bins x columns rows to the browser
            values = data[column].cast(pl.Float64).to_numpy()
            values = values[np.isfinite(values)]
            if values.size == 0:
                continue
            low, high = float(values.min()), float(values.max())
            counts, edges = np.histogram(values, bins=bins if high > low else 1, range=(low, high) if high > low else (low - 0.5, low + 0.5))
            rows += [{"column": column, "bin_start": float(a), "bin_end": float(b), "count": int(n)} for a, b, n in zip(edges[:-1], edges[1:], counts)]
        if not rows:
            return None
        y = alt.Y("count:Q", title="count", scale=alt.Scale(type="symlog") if log_count else alt.Scale())
        return (alt.Chart(pl.DataFrame(rows).to_pandas()).mark_bar(color=OKABE["blue"])
                .encode(x=alt.X("bin_start:Q", title=None), x2="bin_end:Q", y=y,
                        tooltip=["column", alt.Tooltip("bin_start:Q", format=",.3f"), alt.Tooltip("bin_end:Q", format=",.3f"), "count"])
                .properties(width=width, height=110)
                .facet(facet=alt.Facet("column:N", title=None, header=alt.Header(labelFontSize=10, labelLimit=260)), columns=4)
                .resolve_scale(x="independent", y="independent"))
    return COST_TICKS, GOAL, OKABE, PREFIX, alt, eight_numbers, frame, math, np, pl, small_multiples, view_exists


@app.cell
def _(mo):
    mo.md(
        r"""
        ## 1 · The goal as a formula you can operate

        A day's net ticks is the sum of its trades, each trade's gross move minus the round-trip cost. With $N$ trades
        a day that each win $T$ ticks with probability $p$ and lose $T$ ticks otherwise:

        $$\text{net ticks per day} \;=\; \sum_{t=1}^{N}\big(g_t - c\big) \;=\; N\,\big(p\,T - (1-p)\,T - c\big)$$

        Setting it equal to the goal $G$ and solving for the win rate you would need:

        $$p_{\text{needed}} \;=\; \frac{G/N + c + T}{2T}$$

        With a reward-to-risk ratio $R$ (win $R\,T$, lose $T$) the denominator becomes $(R+1)\,T$. Spread over $k$
        contracts, each contract only needs $G/k$ ticks.
        """
    )
    return


@app.cell
def _(mo):
    trades_per_day = mo.ui.slider(1, 100, value=20, label="N · trades per day", show_value=True)
    trade_size = mo.ui.slider(4, 400, step=4, value=80, label="T · risk per trade (ticks)", show_value=True)
    reward_to_risk = mo.ui.slider(0.5, 4.0, step=0.25, value=1.0, label="R · reward-to-risk", show_value=True)
    contracts = mo.ui.slider(1, 20, value=1, label="k · contracts", show_value=True)
    goal_ticks = mo.ui.slider(50, 1200, step=50, value=600, label="G · goal (ticks per day, one contract)", show_value=True)
    mo.hstack([trades_per_day, trade_size, reward_to_risk, contracts, goal_ticks], wrap=True)
    return contracts, goal_ticks, reward_to_risk, trade_size, trades_per_day


@app.cell
def _(COST_TICKS, OKABE, alt, contracts, goal_ticks, mo, np, pl, reward_to_risk, trade_size, trades_per_day):
    _n, _t, _r, _k, _g = trades_per_day.value, trade_size.value, reward_to_risk.value, contracts.value, goal_ticks.value
    _per_contract = _g / _k
    _needed = (_per_contract / _n + COST_TICKS + _t) / ((_r + 1) * _t)
    _break_even = (COST_TICKS + _t) / ((_r + 1) * _t)
    _legend = pl.DataFrame({
        "symbol": ["G", "N", "T", "R", "c", "k", "G/k", "p needed", "p break-even"],
        "name": ["goal", "trades per day", "risk per trade", "reward-to-risk ratio", "round-trip cost",
                 "contracts", "goal per contract", "win rate needed", "win rate to net zero"],
        "holds": ["net ticks wanted per day", "how many round trips a day", "ticks lost on a losing trade",
                  "ticks won on a winner / ticks lost on a loser", "fees + 1 tick slippage per side",
                  "same trade on k contracts", "what each contract must earn",
                  "share of trades that must win", "share that must win to cover costs"],
        "units": ["ticks/day", "trades/day", "ticks", "ratio", "ticks", "contracts", "ticks/day", "share", "share"],
        "current value": [f"{_g:g}", f"{_n}", f"{_t}", f"{_r:g}", f"{COST_TICKS:.2f}", f"{_k}", f"{_per_contract:.1f}",
                          "impossible (> 1)" if _needed > 1 else f"{_needed:.3f}", f"{_break_even:.3f}"],
    })
    _grid = np.arange(1, 101)
    _curve = pl.DataFrame({"trades_per_day": _grid,
                           "win_rate_needed": np.minimum((_per_contract / _grid + COST_TICKS + _t) / ((_r + 1) * _t), 1.2)})
    _line = alt.Chart(_curve.to_pandas()).mark_line(color=OKABE["blue"]).encode(
        x=alt.X("trades_per_day:Q", title="N · trades per day"),
        y=alt.Y("win_rate_needed:Q", title="win rate needed", scale=alt.Scale(domain=[0.3, 1.2])),
        tooltip=["trades_per_day", alt.Tooltip("win_rate_needed:Q", format=".3f")])
    _here = alt.Chart(pl.DataFrame({"x": [_n], "y": [min(_needed, 1.2)]}).to_pandas()).mark_point(
        shape="diamond", size=160, filled=True, color=OKABE["orange"]).encode(x="x:Q", y="y:Q")
    _even = alt.Chart(pl.DataFrame({"y": [_break_even]}).to_pandas()).mark_rule(strokeDash=[4, 4], color=OKABE["black"]).encode(y="y:Q")
    _one = alt.Chart(pl.DataFrame({"y": [1.0]}).to_pandas()).mark_rule(color=OKABE["vermillion"]).encode(y="y:Q")
    mo.vstack([
        mo.md(f"**Win rate needed: {'impossible — above 100%' if _needed > 1 else f'{_needed:.1%}'}** "
              f"(break-even {_break_even:.1%}). The orange diamond is your settings; the dashed line is break-even; "
              f"the vermillion line is 100%."),
        mo.hstack([mo.ui.table(_legend, selection=None), (_line + _even + _one + _here).properties(width=520, height=260)]),
    ])
    return


@app.cell
def _(PREFIX, frame, mo, pl, view_exists):
    rounds = frame(f"SELECT * FROM {PREFIX}rounds ORDER BY round, finished_at") if view_exists(f"{PREFIX}rounds") else pl.DataFrame()
    if rounds.height == 0 or "frame_error" in rounds.columns:
        mo.stop(True, mo.md("No round has landed yet (`derived_ta_strategy_600_ticks_rounds` is missing). Run round 1 "
                            "from ML Studio (runner *TA Strategy: 600 ticks/day study*) and refresh the catalog."))
    round_picker = mo.ui.dropdown(
        options={f"round {r['round']} · {r['title']} · {r['recipe']}": r["recipe"] for r in rounds.iter_rows(named=True)},
        value=f"round {rounds[-1, 'round']} · {rounds[-1, 'title']} · {rounds[-1, 'recipe']}", label="Round")
    return round_picker, rounds


@app.cell
def _(GOAL, OKABE, alt, mo, pl, rounds):
    _wanted = ["round", "recipe", "title", "best_configuration_id", "best_net_ticks_per_session_day",
               "best_interval_95_low", "best_interval_95_high", "primary_configuration_id", "primary_alpha_ticks_per_session_day",
               "primary_alpha_newey_west_t", "primary_passes_pre_registered_criteria", "best_alpha_configuration_id",
               "best_alpha_newey_west_t", "reality_check_p_value_best_alpha", "effective_trial_count",
               "configurations_positive", "configurations_beating_buy_and_hold", "configuration_count"]
    _progress = rounds.select([c for c in _wanted if c in rounds.columns])
    _base = alt.Chart(_progress.to_pandas())
    _bars = _base.mark_bar(color=OKABE["blue"]).encode(
        x=alt.X("recipe:N", title="round (recipe)", sort=None), y=alt.Y("best_net_ticks_per_session_day:Q", title="best net ticks per session day"),
        tooltip=list(_progress.columns))
    _ci = _base.mark_errorbar(color=OKABE["black"]).encode(x="recipe:N", y="best_interval_95_low:Q", y2="best_interval_95_high:Q")
    _goal = alt.Chart(pl.DataFrame({"y": [GOAL]}).to_pandas()).mark_rule(color=OKABE["orange"], strokeWidth=2).encode(y="y:Q")
    mo.vstack([mo.md("## 2 · Progress toward 600, round by round (orange line = goal; whiskers = 95% block-bootstrap interval)"),
               (_bars + _ci + _goal).properties(width=700, height=260), mo.ui.table(_progress, selection=None)])
    return


@app.cell
def _(mo, round_picker):
    sort_by = mo.ui.dropdown(["net_ticks_per_session_day_mean", "alpha_ticks_per_session_day", "alpha_newey_west_t",
                              "excess_over_buy_and_hold_ticks_per_session_day", "trades_per_session_day",
                              "test_area_under_roc_curve_median"],
                             value="net_ticks_per_session_day_mean", label="Sort configurations by (alpha: rounds 2+)")
    timeframe_filter = mo.ui.multiselect(["15m", "1h", "4h", "5m", "30m", "1m"], value=["15m", "1h", "4h", "5m", "30m"], label="Timeframes")
    mo.hstack([round_picker, sort_by, timeframe_filter])
    return sort_by, timeframe_filter


@app.cell
def _(GOAL, OKABE, PREFIX, alt, frame, mo, pl, round_picker, sort_by, timeframe_filter):
    configurations = frame(f"SELECT * FROM {PREFIX}configurations WHERE recipe = ?", [round_picker.value])
    configurations = configurations.filter(pl.col("timeframe").is_in(timeframe_filter.value))
    if sort_by.value in configurations.columns:
        configurations = configurations.sort(sort_by.value, descending=True, nulls_last=True)
    _has_alpha = "alpha_ticks_per_session_day" in configurations.columns
    _p = configurations.to_pandas()
    _base = alt.Chart(_p)
    _bars = _base.mark_bar().encode(
        y=alt.Y("configuration_id:N", sort=None, title=None),
        x=alt.X("net_ticks_per_session_day_mean:Q", title="net ticks per session day (mean)"),
        color=alt.Color("model:N", scale=alt.Scale(range=[OKABE["blue"], OKABE["orange"]])),
        tooltip=["configuration_id", alt.Tooltip("net_ticks_per_session_day_mean:Q", format="+.1f"),
                 alt.Tooltip("buy_and_hold_ticks_per_session_day:Q", format="+.1f"), alt.Tooltip("trades_per_session_day:Q", format=".2f"),
                 alt.Tooltip("win_rate:Q", format=".3f")]
        + ([alt.Tooltip("alpha_ticks_per_session_day:Q", format="+.1f"), alt.Tooltip("alpha_newey_west_t:Q", format="+.2f")] if _has_alpha else []))
    _alpha = (_base.mark_point(shape="triangle-right", size=70, filled=True, color=OKABE["vermillion"]).encode(
        y=alt.Y("configuration_id:N", sort=None), x="alpha_ticks_per_session_day:Q") if _has_alpha else None)
    _ci = _base.mark_errorbar(color=OKABE["black"]).encode(
        y=alt.Y("configuration_id:N", sort=None), x="net_ticks_per_session_day_mean_interval_95_low:Q",
        x2="net_ticks_per_session_day_mean_interval_95_high:Q")
    _hold = _base.mark_tick(color=OKABE["purple"], thickness=2, size=14).encode(
        y=alt.Y("configuration_id:N", sort=None), x="buy_and_hold_ticks_per_session_day:Q")
    _goal = alt.Chart(pl.DataFrame({"x": [GOAL]}).to_pandas()).mark_rule(color=OKABE["orange"], strokeWidth=2).encode(x="x:Q")
    mo.vstack([
        mo.md("## 3 · Every configuration of the round\nBars: mean net ticks per session day, coloured by model; "
              "whiskers: 95% block-bootstrap interval; purple tick: buy-and-hold over the same days; vermillion triangle "
              "(rounds 2+): alpha, what is left after removing buy-and-hold beta; orange rule: the 600 goal."),
        ((_bars + _ci + _hold + _goal + _alpha) if _alpha is not None else (_bars + _ci + _hold + _goal)).properties(
            width=820, height=max(200, 16 * configurations.height)),
        mo.ui.table(configurations, selection=None, page_size=15),
    ])
    return (configurations,)


@app.cell
def _(configurations, mo):
    configuration_picker = mo.ui.dropdown(configurations["configuration_id"].to_list(),
                                          value=configurations[0, "configuration_id"], label="Configuration")
    day_step = mo.ui.slider(1, 400, value=20, label="Step the sum: day d", show_value=True)
    mo.hstack([configuration_picker, day_step])
    return configuration_picker, day_step


@app.cell
def _(GOAL, OKABE, PREFIX, alt, configuration_picker, day_step, eight_numbers, frame, mo, pl, round_picker):
    daily = frame(f"SELECT * FROM {PREFIX}daily WHERE recipe = ? AND configuration_id = ? ORDER BY session_date",
                  [round_picker.value, configuration_picker.value])
    daily = daily.with_columns((pl.col("net_usd") / 0.5).alias("net_ticks"), (pl.col("buy_and_hold_usd") / 0.5).alias("buy_and_hold_ticks"))
    daily = daily.with_columns(pl.col("net_ticks").cum_sum().alias("cumulative_net_ticks"),
                               pl.col("buy_and_hold_ticks").cum_sum().alias("cumulative_buy_and_hold_ticks"),
                               (pl.int_range(1, pl.len() + 1)).alias("day_number"))
    _d = min(day_step.value, daily.height)
    daily = daily.with_columns((pl.col("cumulative_net_ticks") / pl.col("day_number")).alias("running_mean_net_ticks"))
    _row = daily.row(_d - 1, named=True)
    _stats = eight_numbers(daily["net_ticks"].to_numpy())
    _hist = alt.Chart(daily.select("net_ticks").to_pandas()).mark_bar(color=OKABE["blue"]).encode(
        x=alt.X("net_ticks:Q", bin=alt.Bin(maxbins=60), title="net ticks on the day"), y="count()")
    _goal = alt.Chart(pl.DataFrame({"x": [GOAL]}).to_pandas()).mark_rule(color=OKABE["orange"], strokeWidth=2).encode(x="x:Q")
    _cum = alt.Chart(daily.to_pandas()).transform_fold(["cumulative_net_ticks", "cumulative_buy_and_hold_ticks"]).mark_line().encode(
        x=alt.X("session_date:T", title="session day"), y=alt.Y("value:Q", title="cumulative ticks"),
        color=alt.Color("key:N", scale=alt.Scale(range=[OKABE["purple"], OKABE["blue"]]), title=None),
        strokeDash=alt.StrokeDash("key:N", legend=None))
    _running = alt.Chart(daily.head(_d).to_pandas()).mark_line(color=OKABE["blue"]).encode(
        x=alt.X("day_number:Q", title="d · day number"), y=alt.Y("running_mean_net_ticks:Q", title="running mean of the sum ÷ d"))
    _cursor = alt.Chart(pl.DataFrame({"x": [_d], "y": [_row["running_mean_net_ticks"]]}).to_pandas()).mark_point(
        size=140, shape="diamond", filled=True, color=OKABE["orange"]).encode(x="x:Q", y="y:Q")
    mo.vstack([
        mo.md(f"## 4 · {configuration_picker.value}: the daily sum, stepped\n"
              f"$\\overline{{x}} = \\frac{{1}}{{D}}\\sum_{{d=1}}^{{D}} x_d$ — $x_d$ = net ticks on session day $d$ "
              f"(currently day {_d}: **{_row['net_ticks']:+.1f}** ticks on {str(_row['session_date'])[:10]}, "
              f"{_row['trade_count']} trades), $D$ = {daily.height} test days. Running total after day {_d}: "
              f"**{_row['cumulative_net_ticks']:+,.0f}**; running mean **{_row['running_mean_net_ticks']:+.1f}** against the goal 600."),
        mo.hstack([(_hist + _goal).properties(width=420, height=220), (_running + _cursor).properties(width=420, height=220)]),
        _cum.properties(width=880, height=240),
        mo.ui.table(pl.DataFrame([{k: (round(v, 3) if isinstance(v, float) else v) for k, v in _stats.items()}]), selection=None),
    ])
    return (daily,)


@app.cell
def _(mo):
    bins = mo.ui.slider(5, 80, value=30, label="Bins", show_value=True)
    log_count = mo.ui.switch(value=False, label="Log count axis")
    mo.hstack([bins, log_count])
    return bins, log_count


@app.cell
def _(PREFIX, bins, configuration_picker, daily, frame, log_count, mo, round_picker, small_multiples):
    trades = frame(f"SELECT * FROM {PREFIX}trades WHERE recipe = ? AND configuration_id = ?", [round_picker.value, configuration_picker.value])
    folds = frame(f"SELECT * FROM {PREFIX}folds WHERE recipe = ? AND configuration_id = ?", [round_picker.value, configuration_picker.value])
    mo.vstack([
        mo.md("## 5 · Every column, drawn\n### Daily table (this configuration)"),
        small_multiples(daily, [c for c in daily.columns if c not in ("round", "fold_index")], bins.value, log_count.value) or mo.md("empty"),
        mo.md("### Trades (this configuration)"),
        small_multiples(trades, [c for c in trades.columns if c not in ("round", "trade_number", "fold_index")], bins.value, log_count.value) or mo.md("no trades"),
        mo.md("### Folds (this configuration)"),
        small_multiples(folds, [c for c in folds.columns if c not in ("round", "fold_index")], bins.value, log_count.value) or mo.md("empty"),
        mo.ui.table(folds, selection=None),
    ])
    return


@app.cell
def _(bins, configurations, log_count, mo, small_multiples):
    mo.vstack([mo.md("### Configurations table (every configuration of the round)"),
               small_multiples(configurations, [c for c in configurations.columns if c not in ("round",)], bins.value, log_count.value) or mo.md("empty")])
    return


@app.cell
def _(GOAL, OKABE, PREFIX, alt, bins, frame, log_count, mo, pl, round_picker, small_multiples):
    oracle = frame(f"SELECT * FROM {PREFIX}oracle_by_session WHERE recipe = ? AND complete_session", [round_picker.value])
    _cols = [c for c in oracle.columns if c.endswith("_ticks") or c.endswith("_count")]
    _share = oracle.select([(GOAL / pl.col(c)).alias(c.replace("_net_ticks", "_goal_share")) for c in oracle.columns if c.endswith("swing_net_ticks")])
    _melt = _share.unpivot(variable_name="ceiling", value_name="goal_share_of_ceiling").to_pandas()
    _box = alt.Chart(_melt).mark_boxplot(color=OKABE["blue"]).encode(
        y=alt.Y("ceiling:N", title=None), x=alt.X("goal_share_of_ceiling:Q", title="600 ÷ hindsight ceiling (share of the day's swings you must capture)", scale=alt.Scale(domain=[0, 0.6], clamp=True)))
    mo.vstack([mo.md("## 6 · What the market offered each session (perfect-hindsight zigzag, each leg charged a round trip)"),
               _box.properties(width=760, height=260),
               small_multiples(oracle, _cols, bins.value, log_count.value) or mo.md("empty")])
    return


@app.cell
def _(OKABE, PREFIX, alt, frame, mo, round_picker):
    importance = frame(f"SELECT timeframe, horizon_bars, feature, gain_share_mean, folds_present FROM {PREFIX}feature_importance "
                       "WHERE recipe = ? ORDER BY gain_share_mean DESC", [round_picker.value])
    _top = importance.head(40).to_pandas()
    mo.vstack([mo.md("## 7 · What LightGBM leaned on (gain share, averaged over folds; top 40 across all fits)"),
               alt.Chart(_top).mark_bar(color=OKABE["sky"]).encode(
                   y=alt.Y("feature:N", sort="-x", title=None), x=alt.X("gain_share_mean:Q", title="gain share"),
                   tooltip=["timeframe", "horizon_bars", "feature", "gain_share_mean", "folds_present"]).properties(width=640, height=620)])
    return


@app.cell
def _(PREFIX, frame, mo, pl, view_exists):
    reviews = frame(f"SELECT * FROM {PREFIX}reviews ORDER BY round, rank") if view_exists(f"{PREFIX}reviews") else pl.DataFrame()
    mo.vstack([mo.md("## 8 · Review after each round: what to do better, ranked by expected ticks per day"),
               mo.ui.table(reviews, selection=None, page_size=20) if reviews.height else mo.md("No review has landed yet.")])
    return


@app.cell
def _(frame, mo, pl, view_exists):
    RULE = "derived_ta_rule_strategies_600_ticks_"
    rule_rounds = frame(f"SELECT * FROM {RULE}rounds ORDER BY round") if view_exists(f"{RULE}rounds") else pl.DataFrame()
    if rule_rounds.height == 0 or "frame_error" in rule_rounds.columns:
        mo.stop(True, mo.md("## 9 · Conditional TA-Lib rules\nNo rule-search round has landed yet."))
    rule_round_picker = mo.ui.dropdown({f"rule round {r['round']} · {r['recipe']}": r["recipe"] for r in rule_rounds.iter_rows(named=True)},
                                       value=f"rule round {rule_rounds[-1, 'round']} · {rule_rounds[-1, 'recipe']}", label="Rule round")
    rule_period = mo.ui.radio(["all_years", "in_sample", "out_of_sample"], value="all_years", label="Period (all_years: rounds 2+)")
    rule_timeframes = mo.ui.multiselect(["1m", "5m", "15m", "30m", "1h"], value=["1m", "5m", "15m", "30m", "1h"], label="Timeframes")
    minimum_trades = mo.ui.slider(0, 1000, step=25, value=100, label="Minimum trades", show_value=True)
    mo.vstack([
        mo.md(r"""
## 9 · Conditional TA-Lib rules with 2:1 brackets (no model)

Each strategy is a TA-Lib condition (a crossing or a state change at a bar's close) plus a filter, entering at the
next open into a bracket: stop $S$ ticks, target $2S$. The target is a **40% win rate** at 2:1, which is a profit
factor of $\frac{0.40 \times 2}{0.60 \times 1} = 1.33$ before costs. Net per trade at that win rate is
$0.4 \cdot 2S - 0.6 \cdot S - c = 0.2S - 5.56$ ticks, so 600 a day needs $N \ge 600 / (0.2S - 5.56)$ trades.
Each dot is one strategy; hollow diamonds are **random entries into the same bracket**. A rule only adds something
where it sits above its bracket's random win rate.
"""),
        mo.hstack([rule_round_picker, rule_period, rule_timeframes, minimum_trades]),
        mo.ui.table(rule_rounds, selection=None),
    ])
    return RULE, minimum_trades, rule_period, rule_round_picker, rule_timeframes


@app.cell
def _(OKABE, RULE, alt, frame, minimum_trades, mo, pl, rule_period, rule_round_picker, rule_timeframes):
    strategies = frame(f"SELECT * FROM {RULE}strategies WHERE recipe = ?", [rule_round_picker.value])
    # Round 1 scored "win rate" (net > 0, including trades closed positive at the session end) against a
    # bracket-level random baseline. From round 2 the test is the TARGET-HIT rate against a null matched to
    # each strategy's gate, hours and side, and an "all_years" period exists.
    _strict = "all_years_target_hit_rate" in strategies.columns
    _p = rule_period.value if (_strict or rule_period.value != "all_years") else "out_of_sample"
    strategies = strategies.filter(pl.col("timeframe").is_in(rule_timeframes.value) & (pl.col(f"{_p}_trade_count") >= minimum_trades.value))
    if _strict:
        _rate, _rate_title, _null = f"{_p}_target_hit_rate", "target-hit rate (trades that reached the 2:1 target)", f"{_p}_matched_null_target_hit_rate"
        strategies = strategies.with_columns(pl.col(_null).alias("random_rate"), pl.col("gate").alias("filter"))
    else:
        _rate, _rate_title = f"{_p}_win_rate", "win rate incl. session-end exits (round 1's test)"
        baselines = frame(f"SELECT timeframe, stop, avg({_p}_win_rate) AS random_rate, avg({_p}_profit_factor) AS random_profit_factor "
                          f"FROM {RULE}random_entry_baselines WHERE recipe = ? GROUP BY 1, 2", [rule_round_picker.value])
        strategies = strategies.join(baselines, on=["timeframe", "stop"], how="left")
    strategies = strategies.with_columns((pl.col(_rate) - pl.col("random_rate")).alias("lift_over_random"))
    _tf_colors = alt.Scale(domain=["1m", "5m", "15m", "30m", "1h"],
                           range=[OKABE["sky"], OKABE["blue"], OKABE["orange"], OKABE["green"], OKABE["purple"]])
    # only the columns the charts draw travel to the browser (all ~70 made a 26 MB spec)
    _plot = strategies.select("strategy_id", "timeframe", "filter", "random_rate", "lift_over_random", _rate, f"{_p}_profit_factor",
                              f"{_p}_net_ticks_per_session_day", f"{_p}_trades_per_session_day", f"{_p}_payoff_ratio").to_pandas()
    _pts = alt.Chart(_plot).mark_circle(size=30, opacity=0.65).encode(
        x=alt.X(f"{_rate}:Q", title=_rate_title, scale=alt.Scale(domain=[0.0, 0.65])),
        y=alt.Y(f"{_p}_profit_factor:Q", title="profit factor (net)", scale=alt.Scale(domain=[0.4, 2.0], clamp=True)),
        color=alt.Color("timeframe:N", scale=_tf_colors), shape=alt.Shape("filter:N", legend=None),
        tooltip=["strategy_id", alt.Tooltip(f"{_rate}:Q", format=".3f"), alt.Tooltip("random_rate:Q", format=".3f", title="matched random"),
                 alt.Tooltip(f"{_p}_profit_factor:Q", format=".3f"), alt.Tooltip(f"{_p}_net_ticks_per_session_day:Q", format="+.1f"),
                 alt.Tooltip(f"{_p}_trades_per_session_day:Q", format=".2f"), alt.Tooltip(f"{_p}_payoff_ratio:Q", format=".2f")])
    if _strict:
        _rand = alt.Chart(_plot).mark_point(shape="diamond", size=40, filled=False, color=OKABE["black"], opacity=0.5).encode(
            x="random_rate:Q", y=alt.Y(f"{_p}_profit_factor:Q", scale=alt.Scale(domain=[0.4, 2.0], clamp=True)),
            tooltip=["strategy_id", alt.Tooltip("random_rate:Q", format=".3f")])
    else:
        _rand = alt.Chart(baselines.to_pandas()).mark_point(shape="diamond", size=90, filled=False, color=OKABE["black"]).encode(
            x="random_rate:Q", y=alt.Y("random_profit_factor:Q", scale=alt.Scale(domain=[0.4, 2.0], clamp=True)),
            tooltip=["timeframe", "stop", alt.Tooltip("random_rate:Q", format=".3f")])
    _x40 = alt.Chart(pl.DataFrame({"x": [0.40]}).to_pandas()).mark_rule(color=OKABE["vermillion"], strokeDash=[4, 3]).encode(x="x:Q")
    _y133 = alt.Chart(pl.DataFrame({"y": [1.333]}).to_pandas()).mark_rule(color=OKABE["vermillion"], strokeDash=[4, 3]).encode(y="y:Q")
    _ticks = alt.Chart(_plot).mark_circle(size=28, opacity=0.6).encode(
        x=alt.X(f"{_p}_trades_per_session_day:Q", title="trades per session day", scale=alt.Scale(type="log")),
        y=alt.Y(f"{_p}_net_ticks_per_session_day:Q", title="net ticks per session day"),
        color=alt.Color("timeframe:N", scale=_tf_colors), tooltip=["strategy_id"])
    mo.vstack([
        mo.md(f"**{strategies.height:,} strategies shown ({'round 2+ strict test: target-hit rate; each hollow diamond is that strategy' + chr(39) + 's matched random entry' if _strict else 'round 1 test: win rate; diamonds are random entries per bracket'}).** "
              "Left: rate vs profit factor; the vermillion lines are 40% and 1.33, so the target zone is the top-right corner. "
              "Right: trades per day vs net ticks per day (the 600 goal is far above this axis)."),
        mo.hstack([(_pts + _rand + _x40 + _y133).properties(width=520, height=380), _ticks.properties(width=460, height=380)]),
        mo.ui.table(strategies.sort(f"{_p}_net_ticks_per_session_day", descending=True, nulls_last=True).head(300),
                    selection=None, page_size=15),
        mo.md("The table shows the 300 best by net ticks per day for the period; the lake table has all of them."),
    ])
    return (strategies,)


@app.cell
def _(OKABE, RULE, alt, frame, mo, pl, rule_round_picker):
    _in = frame(f"SELECT strategy_id, timeframe, in_sample_net_ticks_per_session_day AS in_sample, "
                f"out_of_sample_net_ticks_per_session_day AS out_of_sample FROM {RULE}strategies "
                f"WHERE recipe = ? AND in_sample_trade_count >= 100", [rule_round_picker.value])
    _chart = alt.Chart(_in.to_pandas()).mark_circle(size=22, opacity=0.5, color=OKABE["blue"]).encode(
        x=alt.X("in_sample:Q", title="in-sample net ticks/day (2019-06..2023)"),
        y=alt.Y("out_of_sample:Q", title="out-of-sample net ticks/day (2024-2025)"), tooltip=["strategy_id", "in_sample", "out_of_sample"])
    _zero = alt.Chart(pl.DataFrame({"v": [0.0]}).to_pandas())
    mo.vstack([mo.md("### Does choosing in-sample pick winners out of sample? (each dot a strategy)"),
               (_chart + _zero.mark_rule(color=OKABE["black"]).encode(x="v:Q") + _zero.mark_rule(color=OKABE["black"]).encode(y="v:Q")).properties(width=560, height=380)])
    return


@app.cell
def _(RULE, frame, mo, rule_round_picker):
    _kept = frame(f"SELECT DISTINCT strategy_id FROM {RULE}daily WHERE recipe = ? ORDER BY 1", [rule_round_picker.value])
    kept_picker = mo.ui.dropdown(_kept["strategy_id"].to_list(), value=_kept[0, "strategy_id"], label="Strategy (trades stored)")
    kept_picker
    return (kept_picker,)


@app.cell
def _(OKABE, RULE, alt, bins, eight_numbers, frame, kept_picker, log_count, mo, pl, rule_round_picker, small_multiples):
    _daily = frame(f"SELECT * FROM {RULE}daily WHERE recipe = ? AND strategy_id = ? ORDER BY session_date",
                   [rule_round_picker.value, kept_picker.value]).with_columns(pl.col("net_ticks").cum_sum().alias("cumulative_net_ticks"))
    _trades = frame(f"SELECT * FROM {RULE}trades WHERE recipe = ? AND strategy_id = ?", [rule_round_picker.value, kept_picker.value])
    _curve = alt.Chart(_daily.to_pandas()).mark_line(color=OKABE["blue"]).encode(
        x=alt.X("session_date:T", title="session day"), y=alt.Y("cumulative_net_ticks:Q", title="cumulative net ticks"),
        strokeDash=alt.StrokeDash("period:N"))
    _exits = _trades.group_by("exit_reason").agg(pl.len().alias("trades"), pl.col("net_ticks").mean().alias("mean_net_ticks"))
    _stats = eight_numbers(_daily["net_ticks"].to_numpy())
    mo.vstack([
        mo.md(f"### {kept_picker.value}: equity (dashed = out of sample), exits, and every column"),
        _curve.properties(width=880, height=240),
        mo.hstack([mo.ui.table(_exits, selection=None), mo.ui.table(pl.DataFrame([{k: (round(v, 3) if isinstance(v, float) else v) for k, v in _stats.items()}]), selection=None)]),
        small_multiples(_trades, [c for c in _trades.columns if c not in ("round",)], bins.value, log_count.value) or mo.md("no trades"),
    ])
    return


@app.cell
def _(OKABE, RULE, alt, frame, kept_picker, mo, pl, rule_round_picker, view_exists):
    _yearly = (frame(f"SELECT * FROM {RULE}yearly WHERE recipe = ? AND strategy_id = ? ORDER BY year",
                     [rule_round_picker.value, kept_picker.value]) if view_exists(f"{RULE}yearly") else pl.DataFrame())
    if _yearly.height and "frame_error" not in _yearly.columns:
        _bars = alt.Chart(_yearly.to_pandas()).mark_bar().encode(
            x=alt.X("year:O"), y=alt.Y("net_per_trade_lift_over_matched_null:Q", title="net ticks per trade above matched random"),
            color=alt.condition("datum.net_per_trade_lift_over_matched_null > 0", alt.value(OKABE["orange"]), alt.value(OKABE["blue"])),
            tooltip=["year", "trade_count", alt.Tooltip("target_hit_rate:Q", format=".3f"), alt.Tooltip("matched_null_target_hit_rate:Q", format=".3f"),
                     alt.Tooltip("net_ticks_per_trade:Q", format="+.1f"), alt.Tooltip("net_ticks_per_session_day:Q", format="+.1f")])
        _view = mo.vstack([mo.md(f"### {kept_picker.value}: lift over matched random entries, year by year "
                                 "(orange above, blue below; a pass needs 5 of 7 years above)"), _bars.properties(width=560, height=220),
                           mo.ui.table(_yearly, selection=None)])
    else:
        _view = mo.md("Year-by-year lift is recorded from rule round 2 on.")
    _reviews = frame(f"SELECT * FROM {RULE}reviews ORDER BY round, rank") if view_exists(f"{RULE}reviews") else pl.DataFrame()
    mo.vstack([_view, mo.md("### Reviews of the rule rounds: what to do better, and whether each recommendation survived the skeptic"),
               mo.ui.table(_reviews, selection=None, page_size=12) if _reviews.height else mo.md("No rule review has landed yet.")])
    return


@app.cell
def _(bins, log_count, mo, small_multiples, strategies):
    mo.vstack([mo.md("### Strategies table: every column"),
               small_multiples(strategies, [c for c in strategies.columns if c not in ("round",)], bins.value, log_count.value) or mo.md("empty")])
    return


@app.cell
def _(frame, mo, pl, view_exists):
    CONDITIONAL = "derived_ta_conditional_strategies_600_ticks_"
    conditional_rounds = frame(f"SELECT * FROM {CONDITIONAL}rounds ORDER BY round") if view_exists(f"{CONDITIONAL}rounds") else pl.DataFrame()
    if conditional_rounds.height == 0 or "frame_error" in conditional_rounds.columns:
        mo.stop(True, mo.md("## 10 · Multi-timeframe support/resistance and conditional strategies\nNo round has landed yet."))
    conditional_picker = mo.ui.dropdown({f"round {r['round']} · {r['recipe']}": r["recipe"] for r in conditional_rounds.iter_rows(named=True)},
                                        value=f"round {conditional_rounds[-1, 'round']} · {conditional_rounds[-1, 'recipe']}", label="Conditional round")
    mo.vstack([mo.md(r"""
## 10 · Multi-timeframe support/resistance and conditional strategies

**Levels** (`src/ml/ta_strategy/levels.py`). Every level is an event with the moment it became knowable:
- prior-session, prior-RTH and prior-week high/low/close;
- the overnight high/low, and the 15- and 30-minute opening ranges;
- round 100s and 50s in traded prices;
- Williams fractals on 15m, 1h and 4h (15:00-anchored), known only at their confirmation bar;
- the session VWAP ±1/±2σ.

At each 15m bar the active levels within 6 ATR merge into **zones**. The nearest zone below the close is support and the nearest above is resistance. A zone's *strength* is how many distinct source families it holds.

**Level quality.** For each family, $\text{held rate}$ is the share of first tests where price moved $1\times$ATR away on the tested side before $1\times$ATR through the level.
- **Null A** puts the same level at the same ATR distance in a random other session.
- **Null B** reruns everything on sessions whose minutes were shuffled, which is the bounce a level definition produces mechanically.

$$\text{edge} = (\text{held} - \text{held}_{A}) - (\text{held}^{\text{shuffled}} - \text{held}^{\text{shuffled}}_{A})$$

**Conditional strategies** (`src/config/ta_conditional_templates.json`) are ANDed TA-Lib conditions with several exits. Optuna tunes their parameters on the years **before** each test year. The objective is the excess over random entries matched on session window, hour and side, using the same exits.
"""), conditional_picker, mo.ui.table(conditional_rounds, selection=None)])
    return CONDITIONAL, conditional_picker


@app.cell
def _(CONDITIONAL, OKABE, alt, conditional_picker, frame, mo, pl):
    _q = frame(f"SELECT * FROM {CONDITIONAL}level_quality WHERE recipe = ?", [conditional_picker.value])
    _all = _q.filter(pl.col("year") == "all").sort("lift_net_of_mechanics")
    _long = _all.select("family", "held_rate_lift_over_null", "shuffled_lift_over_null", "lift_net_of_mechanics").unpivot(
        index="family", variable_name="measure", value_name="lift").to_pandas()
    _bars = alt.Chart(_long).mark_bar().encode(
        y=alt.Y("family:N", sort=_all["family"].to_list(), title=None), x=alt.X("lift:Q", title="held-rate lift (share of first tests)"),
        color=alt.Color("measure:N", scale=alt.Scale(domain=["held_rate_lift_over_null", "shuffled_lift_over_null", "lift_net_of_mechanics"],
                                                     range=[OKABE["sky"], OKABE["black"], OKABE["vermillion"]])),
        yOffset="measure:N", tooltip=["family", "measure", alt.Tooltip("lift:Q", format="+.3f")])
    _years = _q.filter(pl.col("year") != "all").to_pandas()
    _yearly = alt.Chart(_years).mark_line(point=True).encode(
        x=alt.X("year:O"), y=alt.Y("lift_net_of_mechanics:Q", title="edge net of mechanics"),
        color=alt.Color("family:N", scale=alt.Scale(scheme="viridis")), tooltip=["family", "year", "resolved_tests",
                                                                              alt.Tooltip("lift_net_of_mechanics:Q", format="+.3f")])
    _zero = alt.Chart(pl.DataFrame({"x": [0.0]}).to_pandas()).mark_rule(color=OKABE["black"]).encode(x="x:Q")
    mo.vstack([mo.md("### Do the levels hold price? (sky: vs distance-matched random levels; black: the same in a shuffled world; "
                     "vermillion: what is left, the real edge. Negative means price breaks through more often than chance)"),
               mo.hstack([(_bars + _zero).properties(width=520, height=420), _yearly.properties(width=460, height=320)]),
               mo.ui.table(_all, selection=None)])
    return


@app.cell
def _(CONDITIONAL, conditional_picker, frame, mo):
    session_days = frame(f"SELECT DISTINCT CAST(bar_timestamp + INTERVAL 9 HOUR AS DATE) AS d FROM {CONDITIONAL}zones_15m "
                  "WHERE recipe = ? ORDER BY d", [conditional_picker.value])["d"].to_list()
    level_day = mo.ui.slider(0, len(session_days) - 1, value=len(session_days) - 20, label="Session", show_value=False)
    level_sources = mo.ui.multiselect(["prior_session", "prior_rth", "overnight", "opening_range", "prior_week", "round_number",
                                       "fractal_15m", "fractal_1h", "fractal_4h"],
                                      value=["prior_session", "overnight", "opening_range", "fractal_1h", "fractal_4h"], label="Level families")
    mo.hstack([level_day, level_sources])
    return level_day, level_sources, session_days


@app.cell
def _(CONDITIONAL, OKABE, alt, conditional_picker, frame, level_day, level_sources, mo, pl, session_days):
    _day = session_days[level_day.value]
    _z = frame(f"SELECT * FROM {CONDITIONAL}zones_15m WHERE recipe = ? AND CAST(bar_timestamp + INTERVAL 9 HOUR AS DATE) = ? "
               "ORDER BY bar_timestamp", [conditional_picker.value, _day])
    _t0, _t1 = _z["bar_timestamp"].min(), _z["bar_timestamp"].max()
    _ev = frame(f"SELECT family, source, price, known_from_timestamp, valid_until_timestamp FROM {CONDITIONAL}level_events "
                "WHERE recipe = ? AND known_from_timestamp <= ? AND valid_until_timestamp > ? AND family IN (SELECT UNNEST(?))",
                [conditional_picker.value, _t1, _t0, level_sources.value])
    _lo, _hi = float(_z["close"].min()), float(_z["close"].max())
    _pad = (_hi - _lo) * 0.3 + 10
    _ev = _ev.filter((pl.col("price") > _lo - _pad) & (pl.col("price") < _hi + _pad)).with_columns(
        pl.max_horizontal(pl.col("known_from_timestamp"), pl.lit(_t0)).alias("from"),
        pl.min_horizontal(pl.col("valid_until_timestamp"), pl.lit(_t1)).alias("to"))
    _scale = alt.Scale(domain=[_lo - _pad, _hi + _pad])
    _price = alt.Chart(_z.to_pandas()).mark_line(color=OKABE["black"]).encode(
        x=alt.X("bar_timestamp:T", title="15m bar (Pacific wall clock)"), y=alt.Y("close:Q", scale=_scale, title="back-adjusted price"))
    _sup = alt.Chart(_z.to_pandas()).mark_area(opacity=0.25, color=OKABE["blue"]).encode(
        x="bar_timestamp:T", y=alt.Y("support_low:Q", scale=_scale), y2="support_high:Q")
    _res = alt.Chart(_z.to_pandas()).mark_area(opacity=0.25, color=OKABE["orange"]).encode(
        x="bar_timestamp:T", y=alt.Y("resistance_low:Q", scale=_scale), y2="resistance_high:Q")
    _lv = alt.Chart(_ev.to_pandas()).mark_rule(strokeWidth=2, opacity=0.8).encode(
        x="from:T", x2="to:T", y=alt.Y("price:Q", scale=_scale),
        color=alt.Color("family:N", scale=alt.Scale(scheme="viridis")), strokeDash=alt.StrokeDash("family:N"),
        tooltip=["source", alt.Tooltip("price:Q", format=",.2f"), "known_from_timestamp:T", "valid_until_timestamp:T"])
    mo.vstack([mo.md(f"### Session {_day}: price, the nearest support zone (blue band) and resistance zone (orange band) at every 15m bar, "
                     "and each active level from the chosen families (drawn only while it was known and valid)"),
               (_sup + _res + _lv + _price).properties(width=900, height=420)])
    return


@app.cell
def _(CONDITIONAL, GOAL, OKABE, alt, bins, conditional_picker, frame, log_count, mo, pl, small_multiples):
    _t = frame(f"SELECT * FROM {CONDITIONAL}templates WHERE recipe = ? ORDER BY excess_ticks_per_session_day DESC", [conditional_picker.value])
    _f = frame(f"SELECT * FROM {CONDITIONAL}folds WHERE recipe = ? ORDER BY template, test_year", [conditional_picker.value])
    _base = alt.Chart(_t.select("template", "net_ticks_per_session_day", "matched_null_net_ticks_per_session_day",
                                "excess_ticks_per_session_day", "excess_newey_west_t").to_pandas())
    _bars = _base.mark_bar(color=OKABE["blue"]).encode(y=alt.Y("template:N", sort=None, title=None),
                                                      x=alt.X("net_ticks_per_session_day:Q", title="out-of-sample 2022-2025 net ticks per session day"),
                                                      tooltip=["template", alt.Tooltip("excess_ticks_per_session_day:Q", format="+.1f"),
                                                               alt.Tooltip("excess_newey_west_t:Q", format="+.2f")])
    _null = _base.mark_tick(color=OKABE["purple"], thickness=3, size=16).encode(y=alt.Y("template:N", sort=None),
                                                                                x="matched_null_net_ticks_per_session_day:Q")
    _goal = alt.Chart(pl.DataFrame({"x": [GOAL]}).to_pandas()).mark_rule(color=OKABE["orange"], strokeWidth=2).encode(x="x:Q")
    _fold = alt.Chart(_f.select("template", "test_year", "test_excess_ticks_per_session_day").to_pandas()).mark_bar().encode(
        x=alt.X("test_year:O"), y=alt.Y("test_excess_ticks_per_session_day:Q", title="excess over matched random, ticks/day"),
        color=alt.condition("datum.test_excess_ticks_per_session_day > 0", alt.value(OKABE["orange"]), alt.value(OKABE["blue"])),
        column=alt.Column("template:N", title=None)).properties(width=150, height=160)
    mo.vstack([mo.md("### Conditional templates, tuned on prior years and tested on the next one (blue bar: net; purple tick: "
                     "matched random entries with the same exits; orange rule: 600)"),
               (_bars + _null + _goal).properties(width=820, height=220), _fold, mo.ui.table(_t, selection=None),
               mo.md("Parameters Optuna chose for each test year (tuned only on the years before it):"), mo.ui.table(_f, selection=None),
               small_multiples(_t, [c for c in _t.columns if c not in ("round",)], bins.value, log_count.value) or mo.md("")])
    return


@app.cell
def _(CONDITIONAL, OKABE, alt, bins, conditional_picker, frame, log_count, mo, pl, small_multiples):
    _names = frame(f"SELECT DISTINCT template FROM {CONDITIONAL}templates WHERE recipe = ?", [conditional_picker.value])["template"].to_list()
    template_picker = mo.ui.dropdown(_names, value=_names[0], label="Template")
    template_picker
    return (template_picker,)


@app.cell
def _(CONDITIONAL, OKABE, alt, bins, conditional_picker, frame, log_count, mo, pl, small_multiples, template_picker):
    _d = frame(f"SELECT * FROM {CONDITIONAL}daily WHERE recipe = ? AND template = ? ORDER BY session_date",
               [conditional_picker.value, template_picker.value]).with_columns(
        pl.col("net_ticks").cum_sum().alias("cumulative_net_ticks"), pl.col("matched_null_net_ticks").cum_sum().alias("cumulative_matched_null_ticks"))
    _tr = frame(f"SELECT * FROM {CONDITIONAL}trials WHERE recipe = ? AND template = ?", [conditional_picker.value, template_picker.value])
    _x = frame(f"SELECT * FROM {CONDITIONAL}trades WHERE recipe = ? AND template = ?", [conditional_picker.value, template_picker.value])
    _eq = alt.Chart(_d.select("session_date", "cumulative_net_ticks", "cumulative_matched_null_ticks").to_pandas()).transform_fold(
        ["cumulative_net_ticks", "cumulative_matched_null_ticks"]).mark_line().encode(
        x="session_date:T", y=alt.Y("value:Q", title="cumulative ticks, 1 contract"),
        color=alt.Color("key:N", scale=alt.Scale(range=[OKABE["purple"], OKABE["blue"]]), title=None), strokeDash="key:N")
    _trials = alt.Chart(_tr.select("fold", "test_year", "objective_excess_sharpe_per_day", "trades_per_session_day").to_pandas()).mark_circle(
        size=24, opacity=0.6).encode(x=alt.X("trades_per_session_day:Q", title="training trades per day"),
                                     y=alt.Y("objective_excess_sharpe_per_day:Q", title="objective (excess Sharpe per day, penalised)"),
                                     color=alt.Color("test_year:O", scale=alt.Scale(scheme="cividis")))
    _exits = _x.group_by("exit_reason").agg(pl.len().alias("trades"), pl.col("net_ticks").mean().alias("mean_net_ticks"),
                                           pl.col("net_r_multiple").mean().alias("mean_net_r")).sort("trades", descending=True)
    mo.vstack([mo.md(f"### {template_picker.value}: out-of-sample equity vs matched random, every Optuna trial, exits, every column"),
               mo.hstack([_eq.properties(width=520, height=260), _trials.properties(width=420, height=260)]),
               mo.ui.table(_exits, selection=None),
               small_multiples(_x, [c for c in _x.columns if c not in ("round", "test_year")], bins.value, log_count.value) or mo.md("no trades")])
    return


@app.cell
def _(CONDITIONAL, OKABE, alt, frame, mo, pl, view_exists):
    if not view_exists(f"{CONDITIONAL}confirmation_rounds"):
        mo.stop(True, mo.md("### Pre-registered confirmation\nNot landed yet."))
    _r = frame(f"SELECT * FROM {CONDITIONAL}confirmation_rounds ORDER BY finished_at")
    _recipe = _r[-1, "recipe"]
    _s = frame(f"SELECT * FROM {CONDITIONAL}confirmation_strategies WHERE recipe = ?", [_recipe])
    _d = frame(f"SELECT * FROM {CONDITIONAL}confirmation_daily WHERE recipe = ? ORDER BY session_date", [_recipe])
    _pooled = _d.group_by("session_date").agg(pl.col("excess_ticks").mean().alias("pooled_excess_ticks")).sort("session_date").with_columns(
        pl.col("pooled_excess_ticks").cum_sum().alias("cumulative_pooled_excess_ticks"))
    _each = _d.sort("session_date").with_columns(pl.col("excess_ticks").cum_sum().over("name").alias("cumulative_excess_ticks"))
    _lines = alt.Chart(_each.select("session_date", "name", "cumulative_excess_ticks").to_pandas()).mark_line(opacity=0.7).encode(
        x="session_date:T", y=alt.Y("cumulative_excess_ticks:Q", title="cumulative excess over matched random (ticks, 1 contract)"),
        color=alt.Color("name:N", scale=alt.Scale(range=[OKABE["blue"], OKABE["orange"], OKABE["purple"]])), strokeDash="name:N")
    _pool = alt.Chart(_pooled.to_pandas()).mark_line(color=OKABE["black"], strokeWidth=2.5).encode(
        x="session_date:T", y="cumulative_pooled_excess_ticks:Q")
    _target = _s.select("name", "win_rate", "profit_factor", "net_ticks_per_session_day", "excess_ticks_per_session_day",
                        "excess_newey_west_t", "meets_40_percent_win_rate_and_profit_factor_1_33", "trades_per_session_day")
    mo.vstack([mo.md(f"### Pre-registered confirmation on {_r[-1, 'symbol']} {_r[-1, 'span_start']} to {_r[-1, 'span_end']} "
                     f"(frozen before the run): **{'CONFIRMED' if _r[-1, 'confirmed'] else 'NOT CONFIRMED'}**; pooled excess "
                     f"{_r[-1, 'pooled_excess_ticks_per_session_day']:+.2f} ticks/day, t {_r[-1, 'pooled_excess_newey_west_t']:+.2f} "
                     f"(black line: pooled; the rule needs t >= 2, trimmed t >= 2 and 3 of 4 sub-periods positive)"),
               (_lines + _pool).properties(width=880, height=300), mo.ui.table(_target, selection=None),
               mo.ui.table(_r, selection=None), mo.ui.table(_s, selection=None)])
    return


@app.cell
def _(CONDITIONAL, frame, mo, view_exists):
    if not view_exists(f"{CONDITIONAL}frequency_variants"):
        mo.stop(True, mo.md("## 11 · Frequency: ETH and RTH, long and short, many trades a day\nRound 4 has not landed yet."))
    _latest = "WHERE recipe = (SELECT max(recipe) FROM {v})"
    frequency_variants = frame(f"SELECT * FROM {CONDITIONAL}frequency_variants " + _latest.format(v=f"{CONDITIONAL}frequency_variants"))
    frequency_portfolio = frame(f"SELECT * FROM {CONDITIONAL}frequency_portfolio " + _latest.format(v=f"{CONDITIONAL}frequency_portfolio"))
    frequency_years = frame(f"SELECT * FROM {CONDITIONAL}frequency_years " + _latest.format(v=f"{CONDITIONAL}frequency_years"))
    frequency_hours = frame(f"SELECT * FROM {CONDITIONAL}frequency_hours " + _latest.format(v=f"{CONDITIONAL}frequency_hours"))
    _symbols = sorted(frequency_variants["symbol"].unique().to_list())
    frequency_symbol = mo.ui.dropdown(_symbols, value="MNQ" if "MNQ" in _symbols else _symbols[0], label="Market")
    frequency_session = mo.ui.radio(["frozen", "overnight", "whole_day"], value="whole_day", label="Session window", inline=True)
    frequency_cap = mo.ui.radio({"2 per session": 2, "unlimited": 0}, value="unlimited", label="Entries per session", inline=True)
    frequency_timeframe = mo.ui.radio(["15m", "5m", "1m"], value="15m", label="Bar", inline=True)
    frequency_strictness = mo.ui.radio(["frozen", "looser", "loosest"], value="frozen", label="Entry thresholds", inline=True)
    frequency_trades_per_day = mo.ui.slider(1, 200, value=10, step=1, label="Trades per day", show_value=True)
    mo.vstack([mo.md(
        "## 11 · Frequency: ETH and RTH, long and short, many trades a day\n\n"
        "600 ticks is the **day's total**: every trade, long or short, overnight (ETH, 13:00 to 06:30 Pacific) or regular hours "
        "(RTH, 06:30 to 13:00). Round 4 takes the three frozen strategies and changes only the session window, the entry cap, "
        "the bar and a pre-declared ladder of looser entry thresholds (`src/config/ta_conditional_rounds.json`, round 4)."),
        mo.hstack([frequency_symbol, frequency_session, frequency_cap]), mo.hstack([frequency_timeframe, frequency_strictness])])
    return (frequency_cap, frequency_hours, frequency_portfolio, frequency_session, frequency_strictness, frequency_symbol,
            frequency_timeframe, frequency_variants, frequency_years, frequency_trades_per_day)


@app.cell
def _(COST_TICKS, GOAL, OKABE, alt, frequency_symbol, frequency_trades_per_day, frequency_variants, mo, np, pl):
    _n = frequency_trades_per_day.value
    _need_net = GOAL / _n
    _need_gross = _need_net + COST_TICKS
    _v = frequency_variants.filter(pl.col("symbol") == frequency_symbol.value).drop_nulls("gross_ticks_per_trade")
    _xs = np.geomspace(0.2, 200, 200)
    _curve = pl.DataFrame({"trades_per_session_day": _xs, "required_gross_ticks_per_trade": GOAL / _xs + COST_TICKS})
    _line = alt.Chart(_curve.to_pandas()).mark_line(color=OKABE["vermillion"], strokeWidth=2).encode(
        x=alt.X("trades_per_session_day:Q", scale=alt.Scale(type="log"), title="trades per session day (log)"),
        y=alt.Y("required_gross_ticks_per_trade:Q", scale=alt.Scale(type="symlog"), title="gross ticks captured per trade (symlog)"))
    _cost = alt.Chart(pl.DataFrame({"y": [COST_TICKS]}).to_pandas()).mark_rule(color=OKABE["black"], strokeDash=[4, 3]).encode(y="y:Q")
    _here = alt.Chart(pl.DataFrame({"trades_per_session_day": [_n], "required_gross_ticks_per_trade": [_need_gross]}).to_pandas()).mark_point(
        shape="cross", size=260, color=OKABE["vermillion"], filled=True).encode(x="trades_per_session_day:Q", y="required_gross_ticks_per_trade:Q")
    _dots = alt.Chart(_v.select("variant", "trades_per_session_day", "gross_ticks_per_trade", "timeframe", "session_window",
                                "net_ticks_per_session_day").to_pandas()).mark_point(filled=True, opacity=0.8, size=60).encode(
        x="trades_per_session_day:Q", y="gross_ticks_per_trade:Q",
        color=alt.Color("timeframe:N", scale=alt.Scale(domain=["15m", "5m", "1m"], range=[OKABE["blue"], OKABE["orange"], OKABE["purple"]])),
        shape=alt.Shape("session_window:N", scale=alt.Scale(domain=["frozen", "overnight", "whole_day"], range=["circle", "triangle-up", "square"])),
        tooltip=["variant", alt.Tooltip("trades_per_session_day:Q", format=".2f"), alt.Tooltip("gross_ticks_per_trade:Q", format=".2f"),
                 alt.Tooltip("net_ticks_per_session_day:Q", format="+.1f")])
    _above = _v.filter(pl.col("gross_ticks_per_trade") >= GOAL / pl.col("trades_per_session_day") + COST_TICKS).height
    _formula = (r"$$\text{net per day} \;=\; \sum_{i=1}^{N} \left(g_i - c\right) \;\ge\; 600"
                r" \quad\Longleftrightarrow\quad \bar g \;\ge\; \frac{600}{N} + c$$")
    _legend = (
        "| symbol | name | holds | now |\n|---|---|---|---|\n"
        r"| $\sum_{i=1}^{N}$ | sum over | every trade *i* of the session day, 1 to *N* | — |" "\n"
        f"| $N$ | trades per day | round trips in the day, long and short, ETH and RTH | **{_n}** |\n"
        "| $g_i$ | gross ticks of trade *i* | exit minus entry in ticks, signed by the side | — |\n"
        rf"| $\bar g$ | average gross ticks per trade | what the strategy must capture on average | needs **{_need_gross:.2f}** |" "\n"
        f"| $c$ | round-trip cost | 1.39 USD x 2 sides / 0.50 USD a tick (stops also pay 1 tick of slippage, not in this line) | **{COST_TICKS:.2f} ticks** |\n"
        f"| $600/N$ | net each trade must keep | the goal split evenly over the day's trades | **{_need_net:.2f}** |\n")
    mo.vstack([mo.md("### What each trade has to capture for the day to total 600\n\n" + _formula + "\n\n" + _legend +
                     f"\nDrag *N*: the red cross slides along the red curve. Every dot is one round-4 variant measured on "
                     f"{frequency_symbol.value} (colour: bar size; shape: session window). **A dot above the curve totals 600 a day; "
                     f"{_above} of {_v.height} are above it.** The dashed black line is the cost alone: below it a strategy loses on "
                     "every trade before slippage."), frequency_trades_per_day, (_line + _cost + _dots + _here).properties(width=880, height=380)])
    return


@app.cell
def _(GOAL, OKABE, alt, frequency_symbol, frequency_variants, mo, pl):
    _v = frequency_variants.filter((pl.col("symbol") == frequency_symbol.value) & (pl.col("maximum_entries_per_session") == 0))
    _base = alt.Chart(_v.to_pandas()).encode(
        x=alt.X("trades_per_session_day:Q", scale=alt.Scale(type="log"), title="trades per session day (log)"),
        y=alt.Y("net_ticks_per_session_day:Q", title="net ticks per session day, 1 contract"),
        color=alt.Color("timeframe:N", scale=alt.Scale(domain=["15m", "5m", "1m"], range=[OKABE["blue"], OKABE["orange"], OKABE["purple"]])),
        shape=alt.Shape("entry_strictness:N", scale=alt.Scale(domain=["frozen", "looser", "loosest"], range=["circle", "diamond", "triangle-down"])),
        tooltip=["variant", alt.Tooltip("net_ticks_per_trade:Q", format="+.2f"), alt.Tooltip("excess_ticks_per_session_day:Q", format="+.1f"),
                 alt.Tooltip("excess_newey_west_t:Q", format="+.2f"), alt.Tooltip("win_rate:Q", format=".3f")])
    _goal = alt.Chart(pl.DataFrame({"y": [GOAL]}).to_pandas()).mark_rule(color=OKABE["vermillion"], strokeDash=[6, 3]).encode(y="y:Q")
    _zero = alt.Chart(pl.DataFrame({"y": [0.0]}).to_pandas()).mark_rule(color=OKABE["black"]).encode(y="y:Q")
    _facet = alt.layer(_base.mark_point(filled=True, size=70), _goal, _zero, data=_v.to_pandas()).properties(width=280, height=240).facet(
        column=alt.Column("name:N", title=None), row=alt.Row("session_window:N", title=None))
    mo.vstack([mo.md("### More trades, fewer ticks each: net per day against trades per day (unlimited entries; red dashed = 600)"), _facet])
    return


@app.cell
def _(GOAL, OKABE, alt, frequency_cap, frequency_portfolio, frequency_session, frequency_strictness, frequency_symbol,
      frequency_timeframe, frequency_years, mo, pl):
    _keys = ((pl.col("symbol") == frequency_symbol.value) & (pl.col("session_window") == frequency_session.value)
             & (pl.col("maximum_entries_per_session") == frequency_cap.value) & (pl.col("timeframe") == frequency_timeframe.value)
             & (pl.col("entry_strictness") == frequency_strictness.value))
    _p = frequency_portfolio.filter(_keys)
    _y = frequency_years.filter(_keys & (pl.col("row_kind") == "all_books")).sort("year")
    _price = frequency_years.filter((pl.col("symbol") == frequency_symbol.value) & (pl.col("row_kind") == "variant")).group_by("year").agg(
        pl.col("average_close_price").mean()).sort("year")
    _bars = alt.Chart(_y.to_pandas()).mark_bar().encode(
        x=alt.X("year:O"), y=alt.Y("net_ticks_per_session_day:Q", title="three books summed (1 contract each, up to 3 at once): net ticks per day"),
        color=alt.condition("datum.net_ticks_per_session_day > 0", alt.value(OKABE["orange"]), alt.value(OKABE["blue"])),
        tooltip=["year", alt.Tooltip("net_ticks_per_session_day:Q", format="+.1f"), alt.Tooltip("excess_ticks_per_session_day:Q", format="+.1f"),
                 alt.Tooltip("share_of_days_at_or_above_600:Q", format=".1%")])
    _goal = alt.Chart(pl.DataFrame({"y": [GOAL]}).to_pandas()).mark_rule(color=OKABE["vermillion"], strokeDash=[6, 3]).encode(y="y:Q")
    _px = alt.Chart(_price.to_pandas()).mark_line(point=True, color=OKABE["black"]).encode(
        x="year:O", y=alt.Y("average_close_price:Q", title="average price (index points)"))
    _head = ("no setting selected" if _p.height == 0 else
             f"{_p[0, 'net_ticks_per_session_day']:+.1f} net ticks/day over the span ({100 * _p[0, 'share_of_goal_600']:.1f}% of 600) from "
             f"{_p[0, 'trades_per_session_day']:.2f} trades/day; excess over matched random {_p[0, 'excess_ticks_per_session_day']:+.1f} "
             f"(t {_p[0, 'excess_newey_west_t']:+.2f}); worst drawdown {_p[0, 'maximum_drawdown_ticks']:,.0f} ticks")
    mo.vstack([mo.md(f"### All three books together, one contract each (up to 3 open at once), year by year ({frequency_symbol.value}, {frequency_session.value}, "
                     f"{'unlimited' if frequency_cap.value == 0 else frequency_cap.value} entries, {frequency_timeframe.value}, "
                     f"{frequency_strictness.value} thresholds)\n\n{_head}. The same percentage move is more ticks at a higher price, "
                     "so read the bars beside the price line."),
               mo.hstack([(_bars + _goal).properties(width=560, height=300), _px.properties(width=300, height=300)]),
               mo.ui.table(_y, selection=None)])
    return


@app.cell
def _(OKABE, alt, frequency_cap, frequency_hours, frequency_session, frequency_strictness, frequency_symbol, frequency_timeframe,
      frequency_variants, mo, pl):
    _keys = ((pl.col("symbol") == frequency_symbol.value) & (pl.col("maximum_entries_per_session") == frequency_cap.value)
             & (pl.col("timeframe") == frequency_timeframe.value) & (pl.col("entry_strictness") == frequency_strictness.value)
             & ((pl.col("session_window") == frequency_session.value) | (pl.col("name") == "opening_range_breakout_runner")))
    _h = frequency_hours.filter(_keys)
    _heat = alt.Chart(_h.to_pandas()).mark_rect().encode(
        x=alt.X("entry_hour_pacific:O", title="entry hour (Pacific; RTH is 6:30-13:00)"), y=alt.Y("name:N", title=None),
        color=alt.Color("net_ticks_per_trade:Q", scale=alt.Scale(scheme="cividis"), title="net ticks per trade"),
        tooltip=["name", "entry_hour_pacific", "trades", alt.Tooltip("net_ticks_per_trade:Q", format="+.2f"),
                 alt.Tooltip("long_net_ticks_per_trade:Q", format="+.2f"), alt.Tooltip("short_net_ticks_per_trade:Q", format="+.2f"),
                 alt.Tooltip("win_rate:Q", format=".3f")])
    _sign = alt.Chart(_h.to_pandas()).mark_text(fontSize=12, fontWeight="bold").encode(
        x="entry_hour_pacific:O", y="name:N", text=alt.condition("datum.net_ticks_per_trade > 0", alt.value("+"), alt.value("-")),
        color=alt.condition("datum.net_ticks_per_trade > 0", alt.value(OKABE["black"]), alt.value("#ffffff")))
    _v = frequency_variants.filter(_keys)
    _split = _v.select("name", "long_net_ticks_per_session_day", "short_net_ticks_per_session_day",
                       "regular_hours_net_ticks_per_session_day", "overnight_net_ticks_per_session_day").unpivot(
        index="name", variable_name="part", value_name="net_ticks_per_session_day")
    _bars = alt.Chart(_split.to_pandas()).mark_bar().encode(
        y=alt.Y("part:N", title=None), x=alt.X("net_ticks_per_session_day:Q", title="net ticks per session day"),
        color=alt.condition("datum.net_ticks_per_session_day > 0", alt.value(OKABE["orange"]), alt.value(OKABE["blue"])),
        row=alt.Row("name:N", title=None))
    mo.vstack([mo.md("### Where the day's ticks come from: hour of entry (+ / - marks the sign) and the long / short / RTH / ETH split"),
               (_heat + _sign).properties(width=820, height=120), _bars.properties(width=520, height=110)])
    return


@app.cell
def _(bins, eight_numbers, frequency_symbol, frequency_variants, log_count, mo, pl, small_multiples):
    _v = frequency_variants.filter(pl.col("symbol") == frequency_symbol.value)
    _numeric = [c for c in _v.columns if _v[c].dtype.is_numeric()]
    _eight = pl.DataFrame([{"column": c, **eight_numbers(_v[c].to_numpy())} for c in _numeric])
    mo.vstack([mo.md(f"### Round-4 variants on {frequency_symbol.value}: every column, and its eight numbers"),
               small_multiples(_v, _numeric, bins.value, log_count.value), mo.ui.table(_eight, selection=None),
               mo.ui.table(_v, selection=None)])
    return


@app.cell
def _(CONDITIONAL, frame, mo, view_exists):
    if not view_exists(f"{CONDITIONAL}season_buckets"):
        mo.stop(True, mo.md("## 12 · Time of day, ETH vs RTH, time events\nThe timing study has not landed yet."))
    season_buckets = frame(f"SELECT * FROM {CONDITIONAL}season_buckets WHERE recipe IN (SELECT max(recipe) FROM {CONDITIONAL}season_buckets GROUP BY symbol)")
    season_sessions = frame(f"SELECT * FROM {CONDITIONAL}season_sessions WHERE recipe IN (SELECT max(recipe) FROM {CONDITIONAL}season_sessions GROUP BY symbol)")
    season_parts = frame(f"SELECT * FROM {CONDITIONAL}season_parts WHERE recipe IN (SELECT max(recipe) FROM {CONDITIONAL}season_parts GROUP BY symbol)")
    season_events = frame(f"SELECT * FROM {CONDITIONAL}season_events WHERE recipe IN (SELECT max(recipe) FROM {CONDITIONAL}season_events GROUP BY symbol)")
    season_calendar = frame(f"SELECT * FROM {CONDITIONAL}season_calendar WHERE recipe IN (SELECT max(recipe) FROM {CONDITIONAL}season_calendar GROUP BY symbol)")
    season_stability = frame(f"SELECT * FROM {CONDITIONAL}season_stability WHERE recipe IN (SELECT max(recipe) FROM {CONDITIONAL}season_stability GROUP BY symbol)")
    _symbols = sorted(season_buckets["symbol"].unique().to_list())
    season_symbol = mo.ui.dropdown(_symbols, value="MNQ" if "MNQ" in _symbols else _symbols[0], label="Market")
    _years = ["all"] + sorted([y for y in season_buckets["year"].unique().to_list() if y != "all"])
    season_year = mo.ui.dropdown(_years, value="all", label="Year")
    season_weekday = mo.ui.dropdown(["all", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], value="all", label="Weekday")
    season_metric = mo.ui.dropdown({
        "relative volatility (x the session's average minute)": "relative_volatility_to_session_average",
        "5-minute range, ticks": "average_five_minute_range_ticks",
        "30-minute efficiency ratio / random walk (above 1 trends, below 1 ranges)": "efficiency_relative_to_random_walk",
        "variance ratio VR(5) (above 1 trends, below 1 mean-reverts)": "variance_ratio_five_minutes",
        "autocorrelation, lags 2-4 minutes": "autocorrelation_lags_two_to_four_minutes",
        "breakout follow-through probability": "breakout_follow_through_probability",
        "volume, contracts": "mean_volume_contracts"}, value="relative volatility (x the session's average minute)", label="Measure")
    mo.vstack([mo.md(
        "## 12 · Time of day, ETH vs RTH, time events\n\n"
        "How volatility and ranging change through the CME session (15:00 to 14:00 Pacific), overnight (ETH) against regular "
        "hours (RTH, 06:30-13:00), by weekday, around time events and on calendar days (`src/ml/ta_strategy/timing.py`, "
        "tables `derived_ta_conditional_strategies_600_ticks_season_*`). The strategies read the same shape CAUSALLY: each "
        "session's profile comes only from sessions before it (`seasonality.py`)."),
        mo.hstack([season_symbol, season_year, season_weekday]), season_metric])
    return (season_buckets, season_calendar, season_events, season_metric, season_parts, season_sessions, season_stability,
            season_symbol, season_weekday, season_year)


@app.cell
def _(OKABE, alt, mo, pl, season_buckets, season_metric, season_symbol, season_weekday, season_year):
    _b = season_buckets.filter((pl.col("symbol") == season_symbol.value) & (pl.col("year") == season_year.value)
                               & (pl.col("weekday") == season_weekday.value)).sort("session_offset_minutes")
    _order = _b["bucket_start_pacific"].to_list()
    _rth = alt.Chart(pl.DataFrame({"start": ["06:30"], "end": ["12:55"]}).to_pandas()).mark_rect(opacity=0.08, color=OKABE["blue"]).encode(
        x=alt.X("start:N", sort=_order), x2="end:N")
    _line = alt.Chart(_b.select(list(dict.fromkeys(["bucket_start_pacific", "session_part", "session_count", "weekday", "relative_volatility_to_session_average", "average_five_minute_range_ticks", "efficiency_relative_to_random_walk", "variance_ratio_five_minutes", "breakout_follow_through_probability", season_metric.value]))).to_pandas()).mark_line(point=alt.OverlayMarkDef(size=18)).encode(
        x=alt.X("bucket_start_pacific:N", sort=_order, title="5-minute bucket (Pacific); shaded = regular hours",
                axis=alt.Axis(values=_order[::12], labelAngle=-45)),
        y=alt.Y(f"{season_metric.value}:Q", title=season_metric.selected_key),
        color=alt.Color("session_part:N", scale=alt.Scale(domain=["overnight", "regular_hours"], range=[OKABE["orange"], OKABE["blue"]])),
        shape=alt.Shape("session_part:N", scale=alt.Scale(domain=["overnight", "regular_hours"], range=["triangle-up", "circle"])),
        tooltip=["bucket_start_pacific", "session_part", "session_count",
                 alt.Tooltip("relative_volatility_to_session_average:Q", format=".2f"),
                 alt.Tooltip("average_five_minute_range_ticks:Q", format=".1f"),
                 alt.Tooltip("efficiency_relative_to_random_walk:Q", format=".2f"),
                 alt.Tooltip("variance_ratio_five_minutes:Q", format=".2f"),
                 alt.Tooltip("breakout_follow_through_probability:Q", format=".3f")])
    _heat_data = season_buckets.filter((pl.col("symbol") == season_symbol.value) & (pl.col("year") == "all") & (pl.col("weekday") != "all"))
    _heat = alt.Chart(_heat_data.select("weekday", "bucket_start_pacific", season_metric.value).to_pandas()).mark_rect().encode(
        x=alt.X("bucket_start_pacific:N", sort=_order, title=None, axis=alt.Axis(values=_order[::12], labelAngle=-45)),
        y=alt.Y("weekday:N", sort=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], title=None),
        color=alt.Color(f"{season_metric.value}:Q", scale=alt.Scale(scheme="cividis"), title=None),
        tooltip=["weekday", "bucket_start_pacific", alt.Tooltip(f"{season_metric.value}:Q", format=".3f")])
    mo.vstack([mo.md(f"### {season_metric.selected_key} through the session ({season_symbol.value}, {season_year.value}, "
                     f"{season_weekday.value}; orange triangles = overnight, blue circles = regular hours)"),
               (_rth + _line).properties(width=1000, height=300),
               mo.md("### The same measure by weekday (all years)"), _heat.properties(width=1000, height=150)])
    return


@app.cell
def _(OKABE, alt, bins, eight_numbers, mo, np, pl, season_parts, season_sessions, season_symbol):
    _s = season_sessions.filter(pl.col("symbol") == season_symbol.value)
    _long = pl.concat([
        _s.select(pl.lit(part).alias("session_part"), pl.col(f"{part}_{m}").alias("value"), pl.lit(m).alias("measure"))
        for part in ("overnight", "regular_hours")
        for m in ("realized_volatility_basis_points", "range_ticks", "efficiency_ratio", "volume_contracts")])
    _hist = []
    for (_m, _p), _g in _long.group_by(["measure", "session_part"]):
        _v = _g["value"].drop_nulls().to_numpy()
        _v = _v[np.isfinite(_v)]
        if _v.size == 0:
            continue
        _lo, _hi = np.percentile(_v, [0.5, 99.5])
        _c, _e = np.histogram(np.clip(_v, _lo, _hi), bins=bins.value, range=(_lo, _hi))
        _hist.append(pl.DataFrame({"measure": _m, "session_part": _p, "left": _e[:-1], "right": _e[1:], "sessions": _c}))
    _h = pl.concat(_hist)
    _chart = alt.Chart(_h.to_pandas()).mark_bar(opacity=0.55).encode(
        x=alt.X("left:Q", title=None), x2="right:Q", y=alt.Y("sessions:Q", stack=None),
        color=alt.Color("session_part:N", scale=alt.Scale(domain=["overnight", "regular_hours"], range=[OKABE["orange"], OKABE["blue"]])),
        opacity=alt.value(0.55)).properties(width=300, height=160).facet(facet=alt.Facet("measure:N", title=None), columns=2).resolve_scale(x="independent", y="independent")
    _eight = season_parts.filter((pl.col("symbol") == season_symbol.value) & (pl.col("year") == "all")).select(
        "measure", "session_part", *[c for c in season_parts.columns if c.startswith("value_")])
    _ratio = eight_numbers(_s["overnight_to_regular_hours_volatility_ratio"].to_numpy())
    _share = eight_numbers(_s["overnight_share_of_session_variance"].to_numpy())
    mo.vstack([mo.md(f"### Overnight vs regular hours, one value per session ({season_symbol.value}; orange = overnight, blue = regular hours)\n\n"
                     f"Overnight volatility is **{_ratio['median']:.2f}x** regular hours in the median session "
                     f"(25th-75th {_ratio['percentile_25']:.2f}-{_ratio['percentile_75']:.2f}); overnight carries "
                     f"**{100 * _share['median']:.0f}%** of the session's variance in the median session over ~72% of its minutes."),
               _chart, mo.ui.table(_eight, selection=None)])
    return


@app.cell
def _(OKABE, alt, mo, pl, season_events, season_symbol):
    _names = sorted(season_events.filter(pl.col("symbol") == season_symbol.value)["event"].unique().to_list())
    season_event_pick = mo.ui.multiselect(_names, value=[n for n in ("london_open", "us_data_0830_with_release", "us_data_0830_without_release", "rth_open") if n in _names], label="Events")
    season_event_scale = mo.ui.radio({"relative to the hour before (-60..-31)": "relative_to_pre_event_hour",
                                      "basis points per minute": "mean_absolute_one_minute_return_basis_points"},
                                     value="relative to the hour before (-60..-31)", label="Scale", inline=True)
    mo.vstack([season_event_pick, season_event_scale])
    return season_event_pick, season_event_scale


@app.cell
def _(OKABE, alt, mo, pl, season_event_pick, season_event_scale, season_events, season_symbol):
    _e = season_events.filter((pl.col("symbol") == season_symbol.value) & (pl.col("year") == "all") & pl.col("event").is_in(season_event_pick.value))
    _palette = [OKABE[k] for k in ("blue", "orange", "sky", "vermillion", "green", "purple", "black", "yellow")]
    _chart = alt.Chart(_e.to_pandas()).mark_line().encode(
        x=alt.X("minutes_from_event:Q", title="minutes from the event"), y=alt.Y(f"{season_event_scale.value}:Q", title="relative to the hour before (-60..-31)" if season_event_scale.value == "relative_to_pre_event_hour" else "basis points per minute"),
        color=alt.Color("event:N", scale=alt.Scale(range=_palette)), strokeDash="event:N",
        tooltip=["event", "minutes_from_event", "session_count", alt.Tooltip(f"{season_event_scale.value}:Q", format=".2f")])
    _zero = alt.Chart(pl.DataFrame({"x": [0]}).to_pandas()).mark_rule(color=OKABE["black"], strokeDash=[3, 3]).encode(x="x:Q")
    mo.vstack([mo.md("### Volatility around each time event (all years): how much and for how long it rises"), (_chart + _zero).properties(width=900, height=300)])
    return


@app.cell
def _(OKABE, alt, mo, pl, season_calendar, season_stability, season_symbol):
    _c = season_calendar.filter(pl.col("symbol") == season_symbol.value).with_columns(
        (pl.col("log_ratio_difference") / pl.col("log_ratio_newey_west_t")).abs().alias("standard_error")).with_columns(
        (pl.col("log_ratio_difference") - 2 * pl.col("standard_error")).alias("low"), (pl.col("log_ratio_difference") + 2 * pl.col("standard_error")).alias("high"))
    _base = alt.Chart(_c.to_pandas()).encode(y=alt.Y("calendar_condition:N", title=None, sort="-x"))
    _rule = _base.mark_rule().encode(x=alt.X("low:Q", title="log volatility vs trailing 20-session median, minus other sessions (+/- 2 SE)"), x2="high:Q",
                                     color=alt.Color("session_part:N", scale=alt.Scale(domain=["overnight", "regular_hours"], range=[OKABE["orange"], OKABE["blue"]])))
    _dot = _base.mark_point(filled=True, size=60).encode(x="log_ratio_difference:Q", color="session_part:N",
                                                          shape=alt.Shape("session_part:N", scale=alt.Scale(range=["triangle-up", "circle"])),
                                                          tooltip=["calendar_condition", "session_part", "session_count",
                                                                   alt.Tooltip("volatility_ratio_to_trailing_median:Q", format=".2f"),
                                                                   alt.Tooltip("log_ratio_newey_west_t:Q", format="+.2f")])
    _zero = alt.Chart(pl.DataFrame({"x": [0.0]}).to_pandas()).mark_rule(color=OKABE["black"]).encode(x="x:Q")
    _s = season_stability.filter(pl.col("symbol") == season_symbol.value)
    _stab = alt.Chart(_s.to_pandas()).mark_line(point=True).encode(
        x="year:O", y=alt.Y("out_of_sample_r_squared_of_log_volatility:Q", title="share of bucket-to-bucket volatility the causal profile explains"),
        color=alt.Color("session_part:N", scale=alt.Scale(domain=["overnight", "regular_hours", "whole_session"], range=[OKABE["orange"], OKABE["blue"], OKABE["black"]])),
        tooltip=["year", "session_part", alt.Tooltip("correlation_with_previous_year_profile:Q", format=".3f"),
                 alt.Tooltip("out_of_sample_r_squared_of_log_volatility:Q", format=".3f")])
    mo.vstack([mo.md("### Calendar days: which sessions run hotter or colder than usual (causal baseline)"),
               (_rule + _dot + _zero).properties(width=620, height=420),
               mo.md("### Is the time-of-day shape predictable? Out-of-sample fit of the causal profile, by year"), _stab.properties(width=620, height=260)])
    return


@app.cell
def _(mo):
    expected_move_start = mo.ui.slider(0, 1375, value=930 - 30, step=5, label="Start (minutes after 15:00 Pacific)", show_value=True)
    expected_move_horizon = mo.ui.slider(5, 240, value=60, step=5, label="Horizon h (minutes)", show_value=True)
    expected_move_level = mo.ui.slider(0.5, 3.0, value=1.0, step=0.1, label="Level L (x a typical day)", show_value=True)
    mo.hstack([expected_move_start, expected_move_horizon, expected_move_level])
    return expected_move_horizon, expected_move_level, expected_move_start


@app.cell
def _(OKABE, alt, expected_move_horizon, expected_move_level, expected_move_start, mo, np, pl, season_buckets, season_symbol):
    _b = season_buckets.filter((pl.col("symbol") == season_symbol.value) & (pl.col("weekday") == "all")
                               & (pl.col("year") != "all")).sort("session_offset_minutes")
    _last = _b["year"].max()
    _b = _b.filter(pl.col("year") == _last)
    _shape = np.repeat(_b["relative_volatility_to_session_average"].to_numpy(), 5)
    _abs_bp = float(np.nanmean(_b["mean_absolute_one_minute_return_basis_points"].to_numpy()))
    _price = 23000.0
    _o, _h, _L = expected_move_start.value, expected_move_horizon.value, expected_move_level.value
    _window = _shape[_o + 1: min(_o + 1 + _h, _shape.size)]
    _sum_sq = float(np.nansum(_window ** 2))
    _level = _L * _abs_bp / 1e4
    _move = np.sqrt(8 / np.pi) * np.sqrt(np.pi / 2) * _level * np.sqrt(_sum_sq) * _price
    _flat = np.sqrt(8 / np.pi) * np.sqrt(np.pi / 2) * _level * np.sqrt(_window.size) * _price
    _clock = f"{(_o + 900) % 1440 // 60:02d}:{(_o + 900) % 1440 % 60:02d}"
    _curve = pl.DataFrame({"minute": np.arange(_shape.size), "shape_squared": _shape ** 2,
                           "in_window": (np.arange(_shape.size) > _o) & (np.arange(_shape.size) <= _o + _h)})
    _bars = alt.Chart(_curve.to_pandas()).mark_area(interpolate="step").encode(
        x=alt.X("minute:Q", title="minutes after 15:00 Pacific"), y=alt.Y("shape_squared:Q", title="s_u squared (expected variance per minute, x average)"),
        color=alt.condition("datum.in_window", alt.value(OKABE["orange"]), alt.value(OKABE["sky"])))
    _formula = (r"$$\text{expected range}_{t,h} \;=\; \sqrt{\tfrac{8}{\pi}}\cdot\sqrt{\tfrac{\pi}{2}}\; L_t \sqrt{\sum_{u=t+1}^{t+h} s_u^{2}}\;\cdot P_t$$")
    _legend = (
        "| symbol | name | holds | now |\n|---|---|---|---|\n"
        r"| $\sum_{u=t+1}^{t+h}$ | sum over | each minute *u* from the next one to *h* minutes ahead (stops at the 14:00 session end) | " f"{_window.size} minutes from {_clock} |\n"
        f"| $s_u$ | seasonal shape of minute *u* | expected abs 1-minute return of its 5-minute bucket / the session's average minute ({season_symbol.value} {_last}) | peak {np.nanmax(_window) if _window.size else float('nan'):.2f} in window |\n"
        f"| $L_t$ | volatility level | de-seasonalised average-minute abs return right now (EWMA, half-life 60 minutes) | {_L:.1f} x typical = {_level * 1e4:.2f} bp |\n"
        r"| $\sqrt{\pi/2}$ | abs-to-sigma | turns a mean absolute return into a standard deviation (normal returns) | 1.253 |" "\n"
        r"| $\sqrt{8/\pi}$ | range factor | expected high-low range of a random walk / its standard deviation | 1.596 |" "\n"
        f"| $P_t$ | price | index points | {_price:,.0f} |\n")
    mo.vstack([mo.md("### The expected move the strategies size stops and targets with\n\n" + _formula + "\n\n" + _legend +
                     f"\n**Expected {_h}-minute range from {_clock}: {_move:.1f} points = {_move / 0.25:.0f} ticks** "
                     f"(a flat day with no time-of-day shape would say {_flat:.1f} points). Slide the start across 06:30: the "
                     "orange window picks up the open's spike and the range jumps, which is why a trailing ATR measured "
                     "overnight is too tight at the open and too wide at lunch."),
               _bars.properties(width=1000, height=220)])
    return


@app.cell
def _(CONDITIONAL, GOAL, OKABE, alt, frame, mo, pl, view_exists):
    if not view_exists(f"{CONDITIONAL}rounds"):
        mo.stop(True)
    _r = frame(f"SELECT * FROM {CONDITIONAL}rounds WHERE round = 5 ORDER BY finished_at")
    if _r.height == 0 or "frame_error" in _r.columns:
        mo.stop(True, mo.md("### Round 5 (time-conditioned strategies)\nNot landed yet."))
    _recipe = _r[-1, "recipe"]
    _t = frame(f"SELECT * FROM {CONDITIONAL}templates WHERE recipe = ?", [_recipe])
    _t = _t.with_columns(pl.when(pl.col("template").str.contains("_eth")).then(pl.lit("overnight")).otherwise(pl.lit("regular_hours")).alias("session_part"),
                         pl.when(pl.col("template").str.starts_with("atr_breakout_control")).then(pl.lit("ATR control"))
                         .when(pl.col("template").str.starts_with("seasonal")).then(pl.lit("seasonal"))
                         .otherwise(pl.lit("time event")).alias("kind"))
    _bar = alt.Chart(_t.to_pandas()).mark_bar().encode(
        y=alt.Y("template:N", sort="-x", title=None), x=alt.X("net_ticks_per_session_day:Q", title="stitched out-of-sample net ticks per session day (2022-2025)"),
        color=alt.condition("datum.net_ticks_per_session_day > 0", alt.value(OKABE["orange"]), alt.value(OKABE["blue"])),
        tooltip=["template", "kind", "session_part", alt.Tooltip("trades_per_session_day:Q", format=".2f"),
                 alt.Tooltip("excess_ticks_per_session_day:Q", format="+.1f"), alt.Tooltip("excess_newey_west_t:Q", format="+.2f"),
                 alt.Tooltip("win_rate:Q", format=".3f"), alt.Tooltip("profit_factor:Q", format=".2f")])
    _excess = alt.Chart(_t.to_pandas()).mark_point(shape="diamond", size=90, filled=True, color=OKABE["black"]).encode(
        y=alt.Y("template:N", sort="-x"), x="excess_ticks_per_session_day:Q")
    _d = frame(f"SELECT template, session_date, excess_ticks FROM {CONDITIONAL}daily WHERE recipe = ? ORDER BY session_date", [_recipe]).with_columns(
        pl.col("excess_ticks").cum_sum().over("template").alias("cumulative_excess_ticks"))
    _lines = alt.Chart(_d.to_pandas()).mark_line().encode(
        x="session_date:T", y=alt.Y("cumulative_excess_ticks:Q", title="cumulative excess over matched random entries (ticks)"),
        color=alt.Color("template:N", scale=alt.Scale(range=[OKABE[k] for k in ("blue", "orange", "sky", "vermillion", "green", "purple", "black", "yellow", "blue")])),
        strokeDash="template:N")
    mo.vstack([mo.md(f"### Round 5: time-conditioned strategies, tuned on prior years, tested 2022-2025 (bar = net, black diamond = excess over matched random; goal {GOAL:.0f})"),
               (_bar + _excess).properties(width=820, height=320), _lines.properties(width=1000, height=300),
               mo.ui.table(_t, selection=None), mo.ui.table(_r, selection=None)])
    return


@app.cell
def _(bins, eight_numbers, log_count, mo, pl, season_sessions, season_symbol, small_multiples):
    _s = season_sessions.filter(pl.col("symbol") == season_symbol.value)
    _numeric = [c for c in _s.columns if _s[c].dtype.is_numeric() and c != "year"]
    _eight = pl.DataFrame([{"column": c, **eight_numbers(_s[c].to_numpy())} for c in _numeric])
    mo.vstack([mo.md(f"### Session table ({season_symbol.value}): every column, and its eight numbers"),
               small_multiples(_s, _numeric, bins.value, log_count.value), mo.ui.table(_eight, selection=None)])
    return


@app.cell
def _(CONDITIONAL, frame, mo, view_exists):
    if not view_exists(f"{CONDITIONAL}cascade_stage_moves"):
        mo.stop(True, mo.md("## 13 · Multi-timeframe cascade, volume at levels, volatility indicators\nThe cascade study has not landed yet."))
    _latest = "WHERE recipe IN (SELECT max(recipe) FROM {v} GROUP BY symbol)"
    cascade_levels = frame(f"SELECT * FROM {CONDITIONAL}cascade_levels " + _latest.format(v=f"{CONDITIONAL}cascade_levels"))
    cascade_occupancy = frame(f"SELECT * FROM {CONDITIONAL}cascade_occupancy " + _latest.format(v=f"{CONDITIONAL}cascade_occupancy"))
    cascade_moves = frame(f"SELECT * FROM {CONDITIONAL}cascade_stage_moves " + _latest.format(v=f"{CONDITIONAL}cascade_stage_moves"))
    cascade_volume = frame(f"SELECT * FROM {CONDITIONAL}cascade_volume_deciles " + _latest.format(v=f"{CONDITIONAL}cascade_volume_deciles"))
    cascade_volume_summary = frame(f"SELECT * FROM {CONDITIONAL}cascade_volume_summary " + _latest.format(v=f"{CONDITIONAL}cascade_volume_summary"))
    cascade_volatility = frame(f"SELECT * FROM {CONDITIONAL}cascade_volatility_indicators " + _latest.format(v=f"{CONDITIONAL}cascade_volatility_indicators"))
    cascade_oracle = frame(f"SELECT * FROM {CONDITIONAL}cascade_oracle " + _latest.format(v=f"{CONDITIONAL}cascade_oracle"))
    _symbols = sorted(cascade_moves["symbol"].unique().to_list())
    cascade_symbol = mo.ui.dropdown(_symbols, value="MNQ" if "MNQ" in _symbols else _symbols[0], label="Market")
    cascade_part = mo.ui.radio(["all", "overnight", "regular_hours"], value="all", label="Session part", inline=True)
    cascade_horizon = mo.ui.slider(15, 120, value=60, step=15, label="Horizon after the cascade (minutes)", show_value=True)
    mo.vstack([mo.md(
        "## 13 · Multi-timeframe cascade, volume at levels, volatility indicators\n\n"
        "Swing levels (Williams fractals) on 1m, 5m, 15m and 30m bars, known only k bars after the swing. A 1-minute close through the "
        "1m resistance, then the 5m, then the 15m, then the 30m (each at or above the last, within a window) is an UP cascade of that many "
        "stages; support breaks in that order are a DOWN cascade (`src/ml/ta_strategy/cascade.py`, tables "
        "`derived_ta_conditional_strategies_600_ticks_cascade_*`). Every state is causal."),
        mo.hstack([cascade_symbol, cascade_part, cascade_horizon])])
    return (cascade_horizon, cascade_levels, cascade_moves, cascade_occupancy, cascade_oracle, cascade_part, cascade_symbol,
            cascade_volatility, cascade_volume, cascade_volume_summary)


@app.cell
def _(OKABE, alt, cascade_horizon, cascade_levels, cascade_moves, cascade_occupancy, cascade_part, cascade_symbol, mo, pl):
    _o = cascade_occupancy.filter((pl.col("symbol") == cascade_symbol.value) & (pl.col("session_part") == cascade_part.value)
                                  & pl.col("state").is_in(["stage_up", "stage_down"]))
    _occ = alt.Chart(_o.to_pandas()).mark_bar().encode(
        x=alt.X("stage:O", title="stages reached"), y=alt.Y("share_of_minutes:Q", title="share of minutes", axis=alt.Axis(format="%")),
        color=alt.Color("state:N", scale=alt.Scale(domain=["stage_up", "stage_down"], range=[OKABE["orange"], OKABE["blue"]])),
        xOffset="state:N", tooltip=["state", "stage", alt.Tooltip("share_of_minutes:Q", format=".1%")]).properties(width=360, height=220)
    _m = cascade_moves.filter((pl.col("symbol") == cascade_symbol.value) & (pl.col("session_part") == cascade_part.value)
                              & (pl.col("horizon_minutes") == cascade_horizon.value))
    _base = alt.Chart(_m.to_pandas()).encode(x=alt.X("stage:O", title="stage first reached"),
                                             color=alt.Color("direction:N", scale=alt.Scale(domain=["up", "down"], range=[OKABE["orange"], OKABE["blue"]])),
                                             xOffset="direction:N")
    _bars = _base.mark_bar(opacity=0.7).encode(y=alt.Y("mean_signed_move_ticks:Q", title=f"signed move over the next {cascade_horizon.value} min (ticks, + = with the cascade)"),
                                               tooltip=["direction", "stage", "events", alt.Tooltip("events_per_session_day:Q", format=".2f"),
                                                        alt.Tooltip("mean_signed_move_ticks:Q", format="+.1f"), alt.Tooltip("bootstrap_low:Q", format="+.1f"),
                                                        alt.Tooltip("bootstrap_high:Q", format="+.1f"), alt.Tooltip("share_positive:Q", format=".3f"),
                                                        alt.Tooltip("unconditional_mean_signed_move_ticks:Q", format="+.1f")])
    _err = _base.mark_rule(strokeWidth=2).encode(y="bootstrap_low:Q", y2="bootstrap_high:Q")
    _unc = _base.mark_tick(color=OKABE["black"], thickness=2, size=22).encode(y="unconditional_mean_signed_move_ticks:Q")
    _zero = alt.Chart(pl.DataFrame({"y": [0.0]}).to_pandas()).mark_rule(color=OKABE["black"]).encode(y="y:Q")
    mo.vstack([mo.md(f"### Does the cascade point the way? ({cascade_symbol.value}, {cascade_part.value})\n\n"
                     "Left: how often each number of stages is on. Right: at the minute a cascade FIRST reaches each stage, the signed move "
                     "over the next horizon (bar), its session-block bootstrap 95% interval (line) and the unconditional drift at the "
                     "same session part (black tick). Cost per trade is 5.56 ticks: a bar must clear that, and the black tick, to matter."),
               mo.hstack([_occ, (_bars + _err + _unc + _zero).properties(width=520, height=260)]),
               mo.ui.table(cascade_levels.filter(pl.col("symbol") == cascade_symbol.value), selection=None)])
    return


@app.cell
def _(OKABE, alt, cascade_part, cascade_symbol, cascade_volume, cascade_volume_summary, mo, pl):
    _v = cascade_volume.filter((pl.col("symbol") == cascade_symbol.value) & (pl.col("session_part") == cascade_part.value)
                               & (pl.col("measure") == "relative_volume"))
    _base = alt.Chart(_v.to_pandas()).encode(x=alt.X("decile:O", title="decile of the approach's relative volume (last 10 minutes / time-of-day profile)"))
    _real = _base.mark_line(point=True, color=OKABE["orange"]).encode(y=alt.Y("break_rate:Q", title="share of level tests that BROKE"),
                                                                      tooltip=["timeframe", "decile", "tests", alt.Tooltip("break_rate:Q", format=".3f"),
                                                                               alt.Tooltip("shuffled_volume_break_rate:Q", format=".3f"),
                                                                               alt.Tooltip("measure_low:Q", format=".2f"), alt.Tooltip("measure_high:Q", format=".2f")])
    _band = _base.mark_area(opacity=0.2, color=OKABE["orange"]).encode(y="break_rate_wilson_low:Q", y2="break_rate_wilson_high:Q")
    _null = _base.mark_line(strokeDash=[4, 3], color=OKABE["black"]).encode(y="shuffled_volume_break_rate:Q")
    _facet = alt.layer(_band, _real, _null, data=_v.to_pandas()).properties(width=190, height=180).facet(column=alt.Column("timeframe:N", title=None))
    _s = cascade_volume_summary.filter(pl.col("symbol") == cascade_symbol.value)
    mo.vstack([mo.md("### Do levels break or hold with the volume of the approach? (orange: real, with Wilson band; dashed black: the same "
                     "tests with volume shuffled within each session)\n\nThe shuffled line keeps the session's total volume and the level "
                     "geometry and destroys only the minute-by-minute link between volume and price. What the orange line adds over the "
                     "dashed one is the information in volume."), _facet,
               mo.md("**Correlation of each measure with breaking, and with the approach's own range (volume tracks range mechanically): "
                     "the 'given range' column is what survives once the range is taken out.**"),
               mo.ui.table(_s, selection=None)])
    return


@app.cell
def _(OKABE, alt, cascade_part, cascade_symbol, cascade_volatility, mo, pl):
    _i = cascade_volatility.filter((pl.col("symbol") == cascade_symbol.value) & (pl.col("session_part") == cascade_part.value))
    _base = alt.Chart(_i.to_pandas()).encode(y=alt.Y("measure:N", sort="-x", title=None))
    _rule = _base.mark_rule().encode(x=alt.X("spearman_bootstrap_low:Q", title="Spearman with the outcome (session-block bootstrap 95%)"), x2="spearman_bootstrap_high:Q")
    _dot = _base.mark_point(filled=True, size=70, color=OKABE["blue"]).encode(x="spearman:Q", tooltip=["measure", "outcome", "bars", alt.Tooltip("spearman:Q", format="+.3f")])
    _zero = alt.Chart(pl.DataFrame({"x": [0.0]}).to_pandas()).mark_rule(color=OKABE["black"]).encode(x="x:Q")
    _facet = alt.layer(_rule, _dot, _zero, data=_i.to_pandas()).properties(width=330, height=300).facet(column=alt.Column("outcome:N", title=None))
    mo.vstack([mo.md("### Which volatility measure anticipates the next hour? Left: the range of the next 60 minutes / ATR. Right: the move in "
                     "the cascade's direction / ATR (follow-through, on minutes where a cascade is on)."), _facet])
    return


@app.cell
def _(GOAL, OKABE, alt, cascade_oracle, cascade_symbol, mo, pl):
    _o = cascade_oracle.filter(pl.col("symbol") == cascade_symbol.value)
    _bars = alt.Chart(_o.to_pandas()).mark_bar(color=OKABE["sky"]).encode(
        x=alt.X("timeframe:N", sort=["1m", "5m", "15m", "30m"], title="swing ladder"), y=alt.Y("ceiling_net_ticks_per_session_day_mean:Q", title="net ticks per session day"),
        tooltip=["timeframe", alt.Tooltip("trades_per_session_day:Q", format=".1f"), alt.Tooltip("ceiling_net_ticks_per_session_day_mean:Q", format=",.0f"),
                 alt.Tooltip("ceiling_net_ticks_per_session_day_median:Q", format=",.0f"), alt.Tooltip("share_of_session_days_at_or_above_600:Q", format=".1%"),
                 alt.Tooltip("required_capture_share_for_600:Q", format=".1%")])
    _goal = alt.Chart(pl.DataFrame({"y": [GOAL]}).to_pandas()).mark_rule(color=OKABE["vermillion"], strokeDash=[6, 3]).encode(y="y:Q")
    mo.vstack([mo.md("### The delayed-oracle ceiling: enter at each confirmed swing (causal), exit at the NEXT swing's exact price (hindsight), "
                     "skip losers, pay every cost. The most cascade-style trading could earn; red dashed = 600."),
               (_bars + _goal).properties(width=420, height=240), mo.ui.table(_o, selection=None)])
    return


@app.cell
def _(CONDITIONAL, GOAL, OKABE, alt, frame, mo, pl, view_exists):
    if not view_exists(f"{CONDITIONAL}rounds"):
        mo.stop(True)
    _r = frame(f"SELECT * FROM {CONDITIONAL}rounds WHERE round = 10 ORDER BY finished_at")
    if _r.height == 0 or "frame_error" in _r.columns:
        mo.stop(True, mo.md("### Round 10 (cascade strategies)\nNot landed yet."))
    _recipe = _r[-1, "recipe"]
    _t = frame(f"SELECT * FROM {CONDITIONAL}templates WHERE recipe = ?", [_recipe])
    _bar = alt.Chart(_t.to_pandas()).mark_bar().encode(
        y=alt.Y("template:N", sort="-x", title=None), x=alt.X("net_ticks_per_session_day:Q", title="stitched out-of-sample net ticks per session day (2022-2025)"),
        color=alt.condition("datum.net_ticks_per_session_day > 0", alt.value(OKABE["orange"]), alt.value(OKABE["blue"])),
        tooltip=["template", alt.Tooltip("trades_per_session_day:Q", format=".2f"), alt.Tooltip("excess_ticks_per_session_day:Q", format="+.1f"),
                 alt.Tooltip("excess_newey_west_t:Q", format="+.2f"), alt.Tooltip("win_rate:Q", format=".3f"), alt.Tooltip("profit_factor:Q", format=".2f")])
    _excess = alt.Chart(_t.to_pandas()).mark_point(shape="diamond", size=90, filled=True, color=OKABE["black"]).encode(y=alt.Y("template:N", sort="-x"), x="excess_ticks_per_session_day:Q")
    _goal = alt.Chart(pl.DataFrame({"x": [GOAL]}).to_pandas()).mark_rule(color=OKABE["vermillion"], strokeDash=[6, 3]).encode(x="x:Q")
    _d = frame(f"SELECT template, session_date, net_ticks FROM {CONDITIONAL}daily WHERE recipe = ? ORDER BY session_date", [_recipe]).with_columns(
        pl.col("net_ticks").cum_sum().over("template").alias("cumulative_net_ticks"))
    _lines = alt.Chart(_d.to_pandas()).mark_line().encode(x="session_date:T", y=alt.Y("cumulative_net_ticks:Q", title="cumulative net ticks, 1 contract"),
                                                          color=alt.Color("template:N", scale=alt.Scale(range=[OKABE[k] for k in ("blue", "orange", "sky", "vermillion", "green", "purple", "black", "yellow")])),
                                                          strokeDash="template:N")
    mo.vstack([mo.md("### Round 10: the cascade strategies with volume, volatility and momentum confirmations, tuned on prior years, tested 2022-2025 (bar = net, diamond = excess over matched random; red dashed = 600)"),
               (_bar + _excess + _goal).properties(width=820, height=300), _lines.properties(width=1000, height=300), mo.ui.table(_t, selection=None)])
    return


@app.cell
def _(CONDITIONAL, cascade_symbol, frame, mo, view_exists):
    if not view_exists(f"{CONDITIONAL}cascade_minute_state"):
        mo.stop(True, mo.md("### Session view\nThe per-minute cascade state has not landed yet."))
    _dates = frame(f"SELECT DISTINCT session_date FROM {CONDITIONAL}cascade_minute_state WHERE symbol = ? AND recipe = "
                   f"(SELECT max(recipe) FROM {CONDITIONAL}cascade_minute_state WHERE symbol = ?) ORDER BY session_date", [cascade_symbol.value, cascade_symbol.value])
    _labels = [str(d)[:10] for d in _dates["session_date"].to_list()]
    cascade_day = mo.ui.dropdown(_labels, value=_labels[-60] if len(_labels) > 60 else _labels[-1], label="Session day")
    cascade_tfs = mo.ui.multiselect(["1m", "5m", "15m", "30m"], value=["5m", "15m", "30m"], label="Levels drawn")
    cascade_template_pick = mo.ui.dropdown(["cascade_trend", "cascade_trend_volume", "cascade_trend_momentum", "cascade_trend_momentum_cross",
                                            "cascade_trend_full", "cascade_trend_full_rth", "cascade_trend_rth", "cascade_aligned_control"],
                                           value="cascade_trend", label="Round-10 trades to mark")
    mo.hstack([cascade_day, cascade_tfs, cascade_template_pick])
    return cascade_day, cascade_template_pick, cascade_tfs


@app.cell
def _(CONDITIONAL, OKABE, alt, cascade_day, cascade_symbol, cascade_template_pick, cascade_tfs, frame, mo, pl):
    _sym = cascade_symbol.value
    _st = frame(f"SELECT timestamp, close, volume, stage_up, stage_down, direction FROM {CONDITIONAL}cascade_minute_state WHERE symbol = ? "
                f"AND CAST(session_date AS DATE) = CAST(? AS DATE) AND recipe = (SELECT max(recipe) FROM {CONDITIONAL}cascade_minute_state WHERE symbol = ?) "
                "ORDER BY timestamp", [_sym, cascade_day.value, _sym])
    _t0, _t1 = _st["timestamp"].min(), _st["timestamp"].max()
    _lv = frame(f"SELECT timeframe, price, side, known_timestamp, end_timestamp, broken FROM {CONDITIONAL}cascade_levels_detail WHERE symbol = ? "
                f"AND known_timestamp <= ? AND end_timestamp >= ? AND recipe = (SELECT max(recipe) FROM {CONDITIONAL}cascade_levels_detail WHERE symbol = ?)",
                [_sym, _t1, _t0, _sym])
    _lv = _lv.filter(pl.col("timeframe").is_in(cascade_tfs.value)).with_columns(
        pl.when(pl.col("known_timestamp") < _t0).then(pl.lit(_t0)).otherwise(pl.col("known_timestamp")).alias("start"),
        pl.when(pl.col("end_timestamp") > _t1).then(pl.lit(_t1)).otherwise(pl.col("end_timestamp")).alias("end"),
        pl.when(pl.col("side") == 1).then(pl.lit("resistance")).otherwise(pl.lit("support")).alias("kind"))
    _tr = frame(f"SELECT entry_timestamp, exit_timestamp, side, entry_price, exit_price, net_ticks, exit_reason FROM {CONDITIONAL}trades "
                f"WHERE template = ? AND CAST(session_date AS DATE) = CAST(? AS DATE) AND recipe = (SELECT max(recipe) FROM {CONDITIONAL}rounds WHERE round = 10)",
                [cascade_template_pick.value, cascade_day.value])
    _price = alt.Chart(_st.select("timestamp", "close").to_pandas()).mark_line(color=OKABE["black"], strokeWidth=1).encode(
        x=alt.X("timestamp:T", title="Pacific wall clock"), y=alt.Y("close:Q", scale=alt.Scale(zero=False), title="close (back-adjusted points)"))
    _levels = alt.Chart(_lv.to_pandas()).mark_rule(strokeWidth=2, opacity=0.7).encode(
        x="start:T", x2="end:T", y="price:Q",
        color=alt.Color("timeframe:N", scale=alt.Scale(domain=["1m", "5m", "15m", "30m"], range=[OKABE["sky"], OKABE["blue"], OKABE["orange"], OKABE["vermillion"]])),
        strokeDash=alt.StrokeDash("kind:N", scale=alt.Scale(domain=["resistance", "support"], range=[[1, 0], [4, 3]])),
        tooltip=["timeframe", "kind", alt.Tooltip("price:Q", format=".2f"), "known_timestamp:T", "end_timestamp:T", "broken"])
    _chart = _price + _levels
    if _tr.height and "frame_error" not in _tr.columns:
        _tp = _tr.with_columns(pl.when(pl.col("side") == "long").then(pl.lit("triangle-up")).otherwise(pl.lit("triangle-down")).alias("shape"))
        _entries = alt.Chart(_tp.to_pandas()).mark_point(size=120, filled=True).encode(
            x="entry_timestamp:T", y="entry_price:Q", shape=alt.Shape("shape:N", scale=None),
            color=alt.condition("datum.net_ticks > 0", alt.value(OKABE["orange"]), alt.value(OKABE["blue"])),
            tooltip=["side", "entry_timestamp:T", "exit_timestamp:T", alt.Tooltip("net_ticks:Q", format="+.0f"), "exit_reason"])
        _exits = alt.Chart(_tp.to_pandas()).mark_point(shape="cross", size=80, color=OKABE["black"]).encode(x="exit_timestamp:T", y="exit_price:Q")
        _chart = _chart + _entries + _exits
    _stages = _st.select("timestamp", "stage_up", "stage_down").with_columns((-pl.col("stage_down")).alias("stage_down_negative")).unpivot(
        index="timestamp", on=["stage_up", "stage_down_negative"], variable_name="which", value_name="stages")
    _step = alt.Chart(_stages.to_pandas()).mark_area(interpolate="step-after", opacity=0.7).encode(
        x="timestamp:T", y=alt.Y("stages:Q", title="stages: up (+) / down (-)"),
        color=alt.Color("which:N", scale=alt.Scale(domain=["stage_up", "stage_down_negative"], range=[OKABE["orange"], OKABE["blue"]]), legend=None))
    _vol = alt.Chart(_st.select("timestamp", "volume").to_pandas()).mark_bar(color=OKABE["sky"]).encode(x="timestamp:T", y=alt.Y("volume:Q", title="volume"))
    mo.vstack([mo.md(f"### Session {cascade_day.value} ({_sym}): the levels of each timeframe from the minute they are known to the minute they break "
                     "(solid = resistance, dashed = support), the cascade stage counter, volume, and the round-10 trades (▲ long, ▼ short, × exit; "
                     "orange = won, blue = lost). Hover any level or trade."),
               alt.vconcat(_chart.properties(width=1000, height=380), _step.properties(width=1000, height=110), _vol.properties(width=1000, height=80)).resolve_scale(x="shared")])
    return


@app.cell
def _(CONDITIONAL, frame, mo, view_exists):
    if not view_exists(f"{CONDITIONAL}zone_summary"):
        mo.stop(True, mo.md("## 14 · Trading AT the zones: what happens at the first touch\nThe zone-touch study has not landed yet."))
    _latest = "WHERE recipe IN (SELECT max(recipe) FROM {v} GROUP BY symbol)"
    zone_summary = frame(f"SELECT * FROM {CONDITIONAL}zone_summary " + _latest.format(v=f"{CONDITIONAL}zone_summary"))
    zone_leak = frame(f"SELECT * FROM {CONDITIONAL}zone_leak_check " + _latest.format(v=f"{CONDITIONAL}zone_leak_check"))
    _symbols = sorted(zone_summary["symbol"].unique().to_list())
    zone_symbol = mo.ui.dropdown(_symbols, value="MNQ" if "MNQ" in _symbols else _symbols[0], label="Market")
    _conditions = [c for c in zone_summary["condition"].unique().to_list() if c not in ("all", "strength_trend", "gapped_through")]
    zone_condition = mo.ui.dropdown(sorted(_conditions), value="strength_bucket", label="Condition")
    zone_metric = mo.ui.radio(["bounce", "next zone reached"], value="bounce", label="Outcome", inline=True)
    mo.vstack([mo.md(
        "## 14 · Trading AT the zones: what happens at the first touch\n\n"
        "Every zone of the multi-timeframe map (prior session / RTH / week levels, opening ranges, round numbers, 15m / 1h / 4h fractals, "
        "5m / 15m / 30m swing levels, VWAP bands, merged per 5m bar; strength = distinct families) is watched on the 1-minute path. "
        "A TOUCH is the first minute whose low enters the support zone from above (mirror at resistance); the zone is the one known at "
        "the previous bar's close. **Bounce** = price moved 1 ATR away from the zone before a close through its far edge. **Next zone "
        "reached** = the opposing zone's near edge was reached before the touched zone broke. Each is compared with the same test on a "
        "pseudo level at the same distance, same time of day, in a random other session (the matched null): the **lift** is what "
        "knowing WHERE the zone is buys. `src/ml/ta_strategy/zones.py`, tables `…_zone_touches`, `…_zone_summary`, `…_zone_leak_check`."),
        mo.hstack([zone_symbol, zone_condition, zone_metric])])
    return zone_condition, zone_leak, zone_metric, zone_summary, zone_symbol


@app.cell
def _(OKABE, alt, mo, pl, zone_condition, zone_leak, zone_metric, zone_summary, zone_symbol):
    _s = zone_summary.filter((pl.col("symbol") == zone_symbol.value) & (pl.col("condition") == zone_condition.value))
    _bounce = zone_metric.value == "bounce"
    _lift, _lo, _hi, _p, _bh = (("lift_over_matched_random", "lift_bootstrap_low", "lift_bootstrap_high", "lift_bootstrap_p", "survives_benjamini_hochberg_q10") if _bounce
                                else ("reach_lift_over_matched_random", "reach_lift_bootstrap_low", "reach_lift_bootstrap_high", "reach_lift_bootstrap_p", "reach_survives_benjamini_hochberg_q10"))
    _rate, _null = ("bounce_rate", "null_bounce_rate") if _bounce else ("next_zone_reach_rate", "null_next_zone_reach_rate")
    _s = _s.with_columns(pl.when(pl.col(_bh)).then(pl.lit("survives BH q=0.10")).otherwise(pl.lit("does not survive")).alias("multiple_comparisons"))
    _base = alt.Chart(_s.to_pandas()).encode(x=alt.X("value:N", title=zone_condition.value, sort=None))
    _bar = _base.mark_bar(opacity=0.75).encode(
        y=alt.Y(f"{_lift}:Q", title=f"{zone_metric.value}: lift over the matched null (probability)"),
        color=alt.condition(f"datum.{_lift} > 0", alt.value(OKABE["orange"]), alt.value(OKABE["blue"])),
        tooltip=["value", "touches", "sessions", alt.Tooltip(f"{_rate}:Q", format=".3f"), alt.Tooltip(f"{_null}:Q", format=".3f"),
                 alt.Tooltip(f"{_lift}:Q", format="+.3f"), alt.Tooltip(f"{_lo}:Q", format="+.3f"), alt.Tooltip(f"{_hi}:Q", format="+.3f"),
                 alt.Tooltip(f"{_p}:Q", format=".3f"), "multiple_comparisons", alt.Tooltip("break_even_hit_rate_zone_to_zone_median:Q", format=".3f")])
    _err = _base.mark_rule(strokeWidth=2, color=OKABE["black"]).encode(y=f"{_lo}:Q", y2=f"{_hi}:Q")
    _mark = _base.mark_point(size=110, filled=True, color=OKABE["black"]).encode(
        y=f"{_hi}:Q", shape=alt.Shape("multiple_comparisons:N", scale=alt.Scale(domain=["survives BH q=0.10", "does not survive"], range=["diamond", "circle"])))
    _zero = alt.Chart(pl.DataFrame({"y": [0.0]}).to_pandas()).mark_rule(color=OKABE["black"]).encode(y="y:Q")
    _rates = _s.select("value", _rate, _null, "break_even_hit_rate_zone_to_zone_median").unpivot(index="value", variable_name="which", value_name="probability")
    _rates_chart = alt.Chart(_rates.to_pandas()).mark_point(size=90, filled=True).encode(
        x=alt.X("value:N", title=zone_condition.value, sort=None), y=alt.Y("probability:Q", title="probability", scale=alt.Scale(domain=[0, 1])),
        color=alt.Color("which:N", scale=alt.Scale(domain=[_rate, _null, "break_even_hit_rate_zone_to_zone_median"],
                                                   range=[OKABE["orange"], OKABE["black"], OKABE["vermillion"]])),
        shape=alt.Shape("which:N", scale=alt.Scale(domain=[_rate, _null, "break_even_hit_rate_zone_to_zone_median"], range=["circle", "cross", "triangle-down"])),
        tooltip=["value", "which", alt.Tooltip("probability:Q", format=".3f")])
    _all = zone_summary.filter((pl.col("symbol") == zone_symbol.value) & (pl.col("condition") == "all"))
    _trend = zone_summary.filter((pl.col("symbol") == zone_symbol.value) & (pl.col("condition") == "strength_trend"))
    _gap = zone_summary.filter((pl.col("symbol") == zone_symbol.value) & (pl.col("condition") == "gapped_through"))
    _lk = zone_leak.filter(pl.col("symbol") == zone_symbol.value)
    _head = (f"Pooled ({zone_symbol.value}): {int(_all[0, 'touches']):,} first touches in {int(_all[0, 'sessions']):,} sessions "
             f"({_all[0, 'touches_per_session_day']:.1f} a session day); bounce {_all[0, 'bounce_rate']:.3f} vs null {_all[0, 'null_bounce_rate']:.3f}, "
             f"lift {_all[0, 'lift_over_matched_random']:+.3f} [{_all[0, 'lift_bootstrap_low']:+.3f}, {_all[0, 'lift_bootstrap_high']:+.3f}]; "
             f"next zone reached {_all[0, 'next_zone_reach_rate']:.3f} vs null {_all[0, 'null_next_zone_reach_rate']:.3f}, lift "
             f"{_all[0, 'reach_lift_over_matched_random']:+.3f} [{_all[0, 'reach_lift_bootstrap_low']:+.3f}, {_all[0, 'reach_lift_bootstrap_high']:+.3f}]. "
             f"Cells tested {int(_all[0, 'cells_tested'])}; bounce lifts surviving Benjamini-Hochberg q = 0.10: "
             f"{int(zone_summary.filter((pl.col('symbol') == zone_symbol.value))['survives_benjamini_hochberg_q10'].sum())}; reach lifts: "
             f"{int(zone_summary.filter((pl.col('symbol') == zone_symbol.value))['reach_survives_benjamini_hochberg_q10'].sum())}.") if _all.height else ""
    if _trend.height:
        _head += f" Strength trend (Spearman over the strength buckets' lifts): rho {_trend[0, 'lift_over_matched_random']:+.2f}, p {_trend[0, 'lift_bootstrap_p']:.2f}."
    if _gap.height:
        _head += f" Gap-throughs (excluded): {int(_gap[0, 'touches']):,}."
    if _lk.height == 2:
        _head += (f" Leaky control (zones of the touch bar applied to its own minutes): bounce {_lk.filter(pl.col('arm') == 'leaky')[0, 'bounce_rate']:.3f} "
                  f"vs honest {_lk.filter(pl.col('arm') == 'honest')[0, 'bounce_rate']:.3f}, so the honest arm is not leaking.")
    mo.vstack([mo.md(f"### Lift over the matched null by {zone_condition.value} ({zone_symbol.value}; bar = lift, line = session-block bootstrap 95%, "
                     "diamond = survives Benjamini-Hochberg at q = 0.10)\n\n" + _head),
               mo.hstack([(_bar + _err + _mark + _zero).properties(width=460, height=280), _rates_chart.properties(width=460, height=280)]),
               mo.md("Right: the observed rate (orange circle), the matched null (black cross) and the **break-even hit rate** of the zone-to-zone "
                     "bracket, p* = (S + 6.56) / (S + T + 1) with S = zone width + buffer and T = the distance to the next zone, in ticks "
                     "(red triangle). The bracket pays only where the orange circle sits above the red triangle."),
               mo.ui.table(_s, selection=None)])
    return


@app.cell
def _(CONDITIONAL, frame, mo, view_exists, zone_symbol):
    if not view_exists(f"{CONDITIONAL}zone_touches"):
        mo.stop(True)
    zone_touches = frame(f"SELECT * FROM {CONDITIONAL}zone_touches WHERE symbol = ? AND recipe = (SELECT max(recipe) FROM {CONDITIONAL}zone_touches WHERE symbol = ?)",
                         [zone_symbol.value, zone_symbol.value])
    zone_net_per_trade = mo.ui.slider(1, 60, value=10, step=1, label="Net ticks a trade the entry would have to average", show_value=True)
    return zone_net_per_trade, zone_touches


@app.cell
def _(COST_TICKS, GOAL, OKABE, alt, bins, eight_numbers, log_count, mo, np, pl, small_multiples, zone_net_per_trade, zone_summary, zone_symbol, zone_touches):
    _t = zone_touches.filter(pl.col("resolved") & ~pl.col("gapped_through"))
    _days = _t["session_date"].n_unique()
    _per_day = _t.height / max(_days, 1)
    _needed = GOAL / zone_net_per_trade.value
    _formula = (r"$$\text{trades needed} = \frac{600}{\overline{\text{net}}} = \frac{600}{" + f"{zone_net_per_trade.value}" + r"} = " + f"{_needed:.0f}" +
                r"\qquad \text{touches a day} = " + f"{_per_day:.1f}" + r"\qquad \text{ceiling} = \text{touches} \times \overline{\text{net}} = " + f"{_per_day * zone_net_per_trade.value:,.0f}$$")
    _oracle = zone_summary.filter((pl.col("symbol") == zone_symbol.value) & (pl.col("condition").is_in(["all", "strength_bucket", "session_part"])))
    _ob = alt.Chart(_oracle.to_pandas()).mark_bar(color=OKABE["sky"]).encode(
        x=alt.X("value:N", title="all / strength bucket / session part", sort=None), y=alt.Y("oracle_zone_to_zone_ticks_per_session_day:Q", title="oracle ticks per session day"),
        tooltip=["condition", "value", "touches", alt.Tooltip("oracle_zone_to_zone_ticks_per_session_day:Q", format=",.0f"), alt.Tooltip("favourable_ticks_median:Q", format=".0f")])
    _goal = alt.Chart(pl.DataFrame({"y": [GOAL]}).to_pandas()).mark_rule(color=OKABE["vermillion"], strokeDash=[6, 3]).encode(y="y:Q")
    _fav = _t["favourable_ticks"].to_numpy()
    _share_paying = float(np.mean(_fav > COST_TICKS)) if _fav.size else float("nan")
    _cols = ["favourable_ticks", "next_zone_distance_ticks", "zone_width_ticks", "stop_ticks_zone_to_zone", "break_even_hit_rate_zone_to_zone", "strength",
             "approach_speed_ticks_per_minute", "approach_length_atr", "rsi_14_previous_bar", "relative_volume_15", "seasonal_ahead_ratio_30",
             "seasonal_expected_move_60_ticks", "hour_pacific", "null_bounce_rate", "null_next_zone_reach_rate"]
    _cols = [c for c in _cols if c in _t.columns]
    _eight = pl.DataFrame([{"column": c, **eight_numbers(_t[c].to_numpy())} for c in _cols])
    mo.vstack([mo.md(f"### The 600 arithmetic at the zones ({zone_symbol.value}): drag the net per trade\n\n" + _formula + "\n\n"
                     f"Legend: **net** = average net ticks a trade after the 5.56-tick round trip; **touches a day** = resolved first touches per session day "
                     f"({_t.height:,} over {_days:,} days); **ceiling** = what trading every touch at that average would total. The best excursion before the "
                     f"zone broke exceeded the cost on {_share_paying:.1%} of touches (median {float(np.median(_fav)) if _fav.size else float('nan'):.0f} ticks), "
                     f"so the ORACLE ceiling below (exit at that best price, skip the rest, pay every cost) is the most any zone strategy could earn."),
               mo.hstack([zone_net_per_trade]),
               mo.hstack([(_ob + _goal).properties(width=520, height=240)]),
               mo.md(f"### Every column of the touch table ({zone_symbol.value}), and its eight numbers"),
               small_multiples(_t, _cols, bins.value, log_count.value), mo.ui.table(_eight, selection=None)])
    return


@app.cell
def _(CONDITIONAL, GOAL, OKABE, alt, frame, mo, pl, view_exists):
    if not view_exists(f"{CONDITIONAL}rounds"):
        mo.stop(True)
    _r = frame(f"SELECT * FROM {CONDITIONAL}rounds WHERE round IN (12, 13) ORDER BY round, finished_at")
    if _r.height == 0 or "frame_error" in _r.columns:
        mo.stop(True, mo.md("### Rounds 12 and 13 (zone strategies and the swings-only control)\nNot landed yet."))
    _recipes = _r.group_by("round").agg(pl.col("recipe").last())
    _t = pl.concat([frame(f"SELECT * FROM {CONDITIONAL}templates WHERE recipe = ?", [rec]).with_columns(pl.lit(int(rnd)).alias("round"))
                    for rnd, rec in _recipes.iter_rows()], how="diagonal_relaxed")
    _bar = alt.Chart(_t.to_pandas()).mark_bar().encode(
        y=alt.Y("template:N", sort="-x", title=None), x=alt.X("net_ticks_per_session_day:Q", title="stitched out-of-sample net ticks per session day (2022-2025)"),
        color=alt.condition("datum.net_ticks_per_session_day > 0", alt.value(OKABE["orange"]), alt.value(OKABE["blue"])),
        tooltip=["round", "template", alt.Tooltip("trades_per_session_day:Q", format=".2f"), alt.Tooltip("net_ticks_per_trade:Q", format="+.2f"),
                 alt.Tooltip("excess_ticks_per_session_day:Q", format="+.1f"), alt.Tooltip("excess_newey_west_t:Q", format="+.2f"),
                 alt.Tooltip("win_rate:Q", format=".3f"), alt.Tooltip("profit_factor:Q", format=".2f")])
    _excess = alt.Chart(_t.to_pandas()).mark_point(shape="diamond", size=90, filled=True, color=OKABE["black"]).encode(y=alt.Y("template:N", sort="-x"), x="excess_ticks_per_session_day:Q")
    _goal = alt.Chart(pl.DataFrame({"x": [GOAL]}).to_pandas()).mark_rule(color=OKABE["vermillion"], strokeDash=[6, 3]).encode(x="x:Q")
    _d = pl.concat([frame(f"SELECT template, session_date, net_ticks FROM {CONDITIONAL}daily WHERE recipe = ? ORDER BY session_date", [rec])
                    for _, rec in _recipes.iter_rows()], how="diagonal_relaxed").with_columns(pl.col("net_ticks").cum_sum().over("template").alias("cumulative_net_ticks"))
    _lines = alt.Chart(_d.to_pandas()).mark_line().encode(x="session_date:T", y=alt.Y("cumulative_net_ticks:Q", title="cumulative net ticks, 1 contract"),
                                                          color=alt.Color("template:N", scale=alt.Scale(range=[OKABE[k] for k in ("blue", "orange", "sky", "vermillion", "green", "purple", "black", "yellow", "blue", "orange")])),
                                                          strokeDash="template:N", tooltip=["template", "session_date:T", alt.Tooltip("cumulative_net_ticks:Q", format=",.0f")])
    mo.vstack([mo.md("### Rounds 12 and 13: the zone strategies (bounce, unconfirmed touch, zone-to-zone, bounce exit, RSI / calm / higher-timeframe confirmations, "
                     "the breakout control) and the swings-only control, tuned on prior years, tested 2022-2025 (bar = net, diamond = excess over matched "
                     "random entries with the same stop and target geometry; red dashed = 600)"),
               (_bar + _excess + _goal).properties(width=820, height=340), _lines.properties(width=1000, height=300), mo.ui.table(_t, selection=None)])
    return


@app.cell
def _(mo, pl, zone_touches):
    _dates = sorted(zone_touches["session_date"].unique().to_list())
    _labels = [str(d)[:10] for d in _dates]
    zone_day = mo.ui.dropdown(_labels, value=_labels[-60] if len(_labels) > 60 else _labels[-1], label="Session day")
    zone_template_pick = mo.ui.dropdown(["zone_bounce", "zone_touch_unconfirmed", "zone_bounce_rth", "zone_to_zone", "zone_to_zone_bounce_exit", "zone_bounce_rsi",
                                         "zone_bounce_calm", "zone_bounce_higher_timeframe", "zone_break_control"], value="zone_bounce", label="Round-12 trades to mark")
    mo.hstack([zone_day, zone_template_pick])
    return zone_day, zone_template_pick


@app.cell
def _(CONDITIONAL, OKABE, alt, frame, mo, pl, view_exists, zone_day, zone_symbol, zone_template_pick, zone_touches):
    _sym = zone_symbol.value
    _tt = zone_touches.filter(pl.col("session_date").cast(pl.Utf8).str.slice(0, 10) == zone_day.value).with_columns(
        pl.when(pl.col("gapped_through")).then(pl.lit("gapped through")).when(pl.col("bounced")).then(pl.lit("bounced"))
        .when(pl.col("broke")).then(pl.lit("broke")).otherwise(pl.lit("timed out")).alias("outcome"),
        pl.when(pl.col("side") == 1).then(pl.lit("triangle-up")).otherwise(pl.lit("triangle-down")).alias("shape"))
    _t0, _t1 = _tt["timestamp"].min(), _tt["timestamp"].max()
    _has_state = view_exists(f"{CONDITIONAL}cascade_minute_state")
    _st = frame(f"SELECT timestamp, close FROM {CONDITIONAL}cascade_minute_state WHERE symbol = ? AND CAST(session_date AS DATE) = CAST(? AS DATE) "
                f"AND recipe = (SELECT max(recipe) FROM {CONDITIONAL}cascade_minute_state WHERE symbol = ?) ORDER BY timestamp", [_sym, zone_day.value, _sym]) if _has_state else pl.DataFrame()
    _layers = []
    if _st.height and "frame_error" not in _st.columns:
        _layers.append(alt.Chart(_st.to_pandas()).mark_line(color=OKABE["black"], strokeWidth=1).encode(
            x=alt.X("timestamp:T", title="Pacific wall clock"), y=alt.Y("close:Q", scale=alt.Scale(zero=False), title="close (back-adjusted points)")))
    _zones = alt.Chart(_tt.to_pandas()).mark_rule(strokeWidth=6, opacity=0.35).encode(
        x="timestamp:T", y="near_edge:Q", y2="far_edge:Q",
        color=alt.Color("side_name:N", scale=alt.Scale(domain=["support", "resistance"], range=[OKABE["blue"], OKABE["orange"]])))
    _pts = alt.Chart(_tt.to_pandas()).mark_point(size=110, filled=True).encode(
        x="timestamp:T", y=alt.Y("near_edge:Q", scale=alt.Scale(zero=False)), shape=alt.Shape("shape:N", scale=None),
        color=alt.Color("outcome:N", scale=alt.Scale(domain=["bounced", "broke", "timed out", "gapped through"],
                                                     range=[OKABE["orange"], OKABE["blue"], OKABE["black"], OKABE["purple"]])),
        tooltip=["timestamp:T", "side_name", "outcome", alt.Tooltip("strength:Q", format=".0f"), "families", alt.Tooltip("near_edge:Q", format=".2f"),
                 alt.Tooltip("favourable_ticks:Q", format=".0f"), alt.Tooltip("next_zone_distance_ticks:Q", format=".0f"),
                 alt.Tooltip("break_even_hit_rate_zone_to_zone:Q", format=".2f"), "reached_next_zone"])
    _layers += [_zones, _pts]
    _tr = frame(f"SELECT entry_timestamp, exit_timestamp, side, entry_price, exit_price, net_ticks, exit_reason FROM {CONDITIONAL}trades "
                f"WHERE template = ? AND CAST(session_date AS DATE) = CAST(? AS DATE) AND recipe = (SELECT max(recipe) FROM {CONDITIONAL}rounds WHERE round = 12)",
                [zone_template_pick.value, zone_day.value]) if view_exists(f"{CONDITIONAL}trades") else pl.DataFrame()
    if _tr.height and "frame_error" not in _tr.columns:
        _tp = _tr.with_columns(pl.when(pl.col("side") == "long").then(pl.lit("triangle-up")).otherwise(pl.lit("triangle-down")).alias("shape"))
        _layers.append(alt.Chart(_tp.to_pandas()).mark_point(size=160, filled=False, strokeWidth=2).encode(
            x="entry_timestamp:T", y="entry_price:Q", shape=alt.Shape("shape:N", scale=None),
            color=alt.condition("datum.net_ticks > 0", alt.value(OKABE["orange"]), alt.value(OKABE["blue"])),
            tooltip=["side", "entry_timestamp:T", "exit_timestamp:T", alt.Tooltip("net_ticks:Q", format="+.0f"), "exit_reason"]))
        _layers.append(alt.Chart(_tp.to_pandas()).mark_point(shape="cross", size=80, color=OKABE["black"]).encode(x="exit_timestamp:T", y="exit_price:Q"))
    mo.vstack([mo.md(f"### Session {zone_day.value} ({_sym}): every first touch of a zone (▲ support, ▼ resistance; the thick bar is the zone; orange = bounced, "
                     "blue = broke, black = timed out, purple = gapped through) on the close, and the round-12 trades of the chosen template "
                     "(hollow ▲/▼ entry, × exit). Hover a touch for its families, strength, room to the next zone and break-even."),
               alt.layer(*_layers).properties(width=1000, height=420)])
    return


@app.cell
def _(mo):
    zone_how_day = mo.ui.text(value="2025-12-29", label="Session day (the CME session that ENDS on this date, 15:00 -> 14:00 Pacific)")
    zone_how_symbol = mo.ui.dropdown(["MNQ", "NQ", "ES", "MES"], value="MNQ", label="Market")
    zone_how_timeframe = mo.ui.radio(["5m", "15m", "30m"], value="5m", label="Bar", inline=True)
    zone_how_width = mo.ui.slider(0.05, 0.6, value=0.25, step=0.05, label="Merge gap w (x ATR)", show_value=True)
    zone_how_reach = mo.ui.slider(1.0, 8.0, value=6.0, step=0.5, label="Reach r (x ATR from the close)", show_value=True)
    zone_how_families = mo.ui.multiselect(["session", "overnight", "opening_range", "week", "round", "fractal_15m", "fractal_1h", "fractal_4h",
                                           "swing_5m", "swing_15m", "swing_30m", "vwap"],
                                          value=["session", "overnight", "opening_range", "week", "round", "fractal_15m", "fractal_1h", "fractal_4h",
                                                 "swing_5m", "swing_15m", "swing_30m", "vwap"], label="Level families in the map")
    mo.vstack([mo.md(
        "## 15 · How a zone is built, on the candles\n\n"
        "Every level is an EVENT (price, family, the minute it became knowable, the minute it stops being valid): the previous "
        "session's / RTH's / week's high, low and close, the overnight range, the 15- and 30-minute opening ranges, round numbers, "
        "Williams fractals on 15m / 1h / 4h bars (known k bars after the extreme), the 5m / 15m / 30m swing levels, and the session "
        "VWAP with its +/-1 and +/-2 sigma bands (recomputed every minute). **At the close of every bar** the levels that are known, "
        "still valid and within r x ATR of the close are sorted by price and **single-linked into zones**: a gap larger than "
        "max(w x ATR, 4 ticks) starts a new zone. A zone's **strength** is the number of distinct level families in it. The zone "
        "whose centre is nearest below the close is **support**, the nearest above is **resistance**; they apply to the NEXT bar. "
        "`levels.zones_for_bars` (`src/ml/ta_strategy/levels.py`) does exactly this; the cells below rebuild it for one session "
        "from the lake's minutes and let you move every dial."),
        mo.hstack([zone_how_symbol, zone_how_day, zone_how_timeframe]), mo.hstack([zone_how_width, zone_how_reach]), zone_how_families])
    return zone_how_day, zone_how_families, zone_how_reach, zone_how_symbol, zone_how_timeframe, zone_how_width


@app.cell
def _(con, mo, np, pl, zone_how_day, zone_how_families, zone_how_reach, zone_how_symbol, zone_how_timeframe, zone_how_width):
    import sys as _sys
    from pathlib import Path as _Path

    _root = _Path(__file__).resolve().parents[1] if "__file__" in globals() else _Path.cwd()
    for _p in (str(_root / "src" / "ml"), str(_root / "src")):
        if _p not in _sys.path:
            _sys.path.insert(0, _p)
    import pandas as _pd
    import talib as _talib

    from ta_strategy import cascade as _cascade
    from ta_strategy import levels as _levels
    from ta_strategy.data import aggregate as _aggregate
    from ta_strategy.data import load_minutes_rebuilt as _load
    from ta_strategy.data import session_dates as _session_dates

    _day = _pd.Timestamp(zone_how_day.value)
    _tick = 0.25
    con.execute("SET TimeZone='UTC'")
    zone_how_minutes = _load(con, zone_how_symbol.value, (_day - _pd.Timedelta(days=16)).strftime("%Y-%m-%d"), (_day + _pd.Timedelta(days=1)).strftime("%Y-%m-%d"))
    _frame = zone_how_minutes.frame
    _ctx = _levels.minute_context(_frame)
    _vwap = _levels.session_vwap(_ctx)
    _events = _pd.concat([_levels.all_level_events(_frame, _ctx), _cascade.level_events(_frame)], ignore_index=True).sort_values("known_from", kind="stable").reset_index(drop=True)
    _events = _events[_events["family_group"].isin(zone_how_families.value)]
    _width = {"5m": 5, "15m": 15, "30m": 30}[zone_how_timeframe.value]
    _bars, _ = _aggregate(_frame, _width)
    _b = {k: _bars[k].to_numpy(np.float64) for k in ("open", "high", "low", "close", "volume")}
    _bar_end = _bars["timestamp"].to_numpy(np.int64) + _width * 60
    _atr = _talib.ATR(_b["high"], _b["low"], _b["close"], 14)
    _zones = _levels.zones_for_bars(_bar_end, _b["close"], _atr, _bars["last_minute_index"].to_numpy(np.int64), _events,
                                    _vwap if "vwap" in zone_how_families.value else None, _tick, zone_how_width.value, zone_how_reach.value)
    _bar_days = _session_dates(_bars["timestamp"].to_numpy(np.int64))
    _target = np.datetime64(_day.strftime("%Y-%m-%d"))
    _in_day = _bar_days == _target
    if not _in_day.any():
        _have = sorted({str(d)[:10] for d in np.unique(_bar_days)})
        mo.stop(True, mo.md(f"No session ends on {zone_how_day.value} in the lake. Sessions nearby: {', '.join(_have[-6:])}."))
    _idx = np.flatnonzero(_in_day)
    zone_how_bars = pl.DataFrame({"bar": np.arange(_idx.size), "timestamp": _pd.to_datetime(_bars["timestamp"].to_numpy(np.int64)[_idx], unit="s"),
                                  "bar_end": _bar_end[_idx], "open": _b["open"][_idx], "high": _b["high"][_idx], "low": _b["low"][_idx],
                                  "close": _b["close"][_idx], "volume": _b["volume"][_idx], "atr": _atr[_idx],
                                  "last_minute_index": _bars["last_minute_index"].to_numpy(np.int64)[_idx]})
    zone_how_zones = pl.from_pandas(_zones.iloc[_idx].reset_index(drop=True)).with_columns(pl.Series("bar", np.arange(_idx.size)))
    zone_how_events = _events
    zone_how_vwap = _vwap
    zone_how_tick = _tick
    zone_how_bar = mo.ui.slider(0, int(_idx.size - 1), value=min(int(_idx.size - 1), 90), step=1, label="Bar of the session (step it)", show_value=True)
    mo.vstack([mo.md(f"{zone_how_symbol.value} session ending {zone_how_day.value}: {_idx.size} {zone_how_timeframe.value} bars, {len(_events):,} level events known in the loaded window "
                     f"({len(zone_how_minutes.frame):,} minutes, {len(zone_how_minutes.rolls)} rolls back-adjusted)."), zone_how_bar])
    return zone_how_bar, zone_how_bars, zone_how_events, zone_how_minutes, zone_how_tick, zone_how_vwap, zone_how_zones


@app.cell
def _(OKABE, alt, mo, np, pl, zone_how_bar, zone_how_bars, zone_how_events, zone_how_families, zone_how_reach, zone_how_tick, zone_how_timeframe, zone_how_vwap, zone_how_width, zone_how_zones):
    import pandas as _pd

    _i = zone_how_bar.value
    _row = zone_how_bars.row(_i, named=True)
    _close, _atr, _end = float(_row["close"]), float(_row["atr"]), int(_row["bar_end"])
    _ev = zone_how_events
    _active = _ev[(_ev["known_from"] <= _end) & (_ev["valid_until"] > _end)].copy()
    _active["distance_atr"] = (_active["price"] - _close) / _atr if np.isfinite(_atr) and _atr > 0 else np.nan
    _members = _active[np.abs(_active["distance_atr"]) <= zone_how_reach.value][["price", "source", "family", "family_group", "distance_atr"]].copy()
    if "vwap" in zone_how_families.value:
        _m = int(_row["last_minute_index"])
        _vw = _pd.DataFrame({"price": [zone_how_vwap[k][_m] for k in zone_how_vwap], "source": list(zone_how_vwap), "family": "session_vwap", "family_group": "vwap"})
        _vw["distance_atr"] = (_vw["price"] - _close) / _atr
        _members = _pd.concat([_members, _vw[np.abs(_vw["distance_atr"]) <= zone_how_reach.value]], ignore_index=True)
    _members = _members.sort_values("price").reset_index(drop=True)
    _gap = max(zone_how_width.value * _atr, 4 * zone_how_tick) if np.isfinite(_atr) else np.nan
    _members["gap_to_previous"] = _members["price"].diff()
    _members["starts_new_zone"] = _members["gap_to_previous"].isna() | (_members["gap_to_previous"] > _gap)
    _members["zone"] = _members["starts_new_zone"].cumsum()
    _z = _members.groupby("zone").agg(low=("price", "min"), high=("price", "max"), centre=("price", "mean"), levels=("price", "size"),
                                      families=("family_group", lambda g: "+".join(sorted(set(g)))), strength=("family_group", "nunique")).reset_index()
    _z["side"] = np.where(_z["centre"] <= _close, "below the close", "above the close")
    _below = _z[_z["centre"] <= _close]
    _above = _z[_z["centre"] > _close]
    _z["role"] = ""
    if len(_below):
        _z.loc[_below.index[-1], "role"] = "SUPPORT (nearest below)"
    if len(_above):
        _z.loc[_above.index[0], "role"] = "RESISTANCE (nearest above)"
    _z["width_ticks"] = (_z["high"] - _z["low"]) / zone_how_tick
    _z["distance_from_close_ticks"] = (_z["centre"] - _close) / zone_how_tick
    _formula = (r"$$\text{gap}_{\text{max}} = \max(w \cdot \text{ATR},\ 4\ \text{ticks}) = \max(" + f"{zone_how_width.value:.2f} \\times {_atr:.2f},\\ 1.00) = {_gap:.2f}" + r"\ \text{points}$$" + "\n\n" +
                r"$$\text{new zone at level } i \iff p_i - p_{i-1} > \text{gap}_{\text{max}} \qquad"
                r"\text{strength}(Z) = \left|\{\text{family}(\ell) : \ell \in Z\}\right| \qquad"
                r"S = \arg\max_{Z:\ \bar p_Z \le c} \bar p_Z,\quad R = \arg\min_{Z:\ \bar p_Z > c} \bar p_Z$$")
    _legend = (f"**w** merge gap in ATR = {zone_how_width.value:.2f} · **ATR** ATR(14) of the {zone_how_timeframe.value} bars at this bar = {_atr:.2f} points · "
               f"**r** reach = {zone_how_reach.value:.1f} ATR = {zone_how_reach.value * _atr:.1f} points either side of the close · "
               f"**c** this bar's close = {_close:.2f} · **pᵢ** the i-th level price (sorted) · **p̄_Z** a zone's centre (mean of its levels) · "
               f"**S / R** the support / resistance zone handed to the next bar. Levels in reach: {len(_members)}; zones: {len(_z)}.")
    _zone_chart = alt.Chart(_z).mark_rect(opacity=0.6).encode(
        y=alt.Y("low:Q", scale=alt.Scale(zero=False), title="price (back-adjusted points)"), y2="high:Q", x=alt.value(0), x2=alt.value(220),
        color=alt.Color("role:N", scale=alt.Scale(domain=["SUPPORT (nearest below)", "RESISTANCE (nearest above)", ""], range=[OKABE["blue"], OKABE["orange"], "#999999"]), legend=None),
        tooltip=["zone", "families", "strength", "levels", alt.Tooltip("low:Q", format=".2f"), alt.Tooltip("high:Q", format=".2f"), alt.Tooltip("width_ticks:Q", format=".0f"), "role"])
    _level_marks = alt.Chart(_members).mark_tick(thickness=2, size=200, orient="horizontal").encode(
        y="price:Q", color=alt.Color("family_group:N", scale=alt.Scale(scheme="viridis"), title="family"),
        tooltip=["source", "family_group", alt.Tooltip("price:Q", format=".2f"), alt.Tooltip("distance_atr:Q", format="+.2f"), alt.Tooltip("gap_to_previous:Q", format=".2f"), "starts_new_zone", "zone"])
    _close_rule = alt.Chart(_pd.DataFrame({"y": [_close]})).mark_rule(color=OKABE["black"], strokeWidth=2).encode(y="y:Q")
    _reach = alt.Chart(_pd.DataFrame({"y": [_close - zone_how_reach.value * _atr], "y2": [_close + zone_how_reach.value * _atr]})).mark_rect(opacity=0.08, color=OKABE["black"]).encode(y="y:Q", y2="y2:Q")
    mo.vstack([mo.md(f"### Bar {_i} of the session ({_row['timestamp']}, close {_close:.2f}): the levels in reach, sorted, and where the gaps cut them into zones\n\n" + _formula + "\n\n" + _legend),
               mo.hstack([(_reach + _zone_chart + _level_marks + _close_rule).resolve_scale(color="independent").properties(width=240, height=420, title="price ladder at this bar: ticks = levels, bands = zones, black = close"),
                          mo.vstack([mo.md("**Levels in reach (sorted by price; a gap above the threshold starts a new zone)**"),
                                     mo.ui.table(pl.from_pandas(_members.round(3)), selection=None),
                                     mo.md("**Zones**"), mo.ui.table(pl.from_pandas(_z.round(3)), selection=None)])])])
    return


@app.cell
def _(OKABE, alt, mo, pl, zone_how_bar, zone_how_bars, zone_how_events, zone_how_families, zone_how_symbol, zone_how_timeframe, zone_how_zones):
    import pandas as _pd

    _bars = zone_how_bars.with_columns(pl.when(pl.col("close") >= pl.col("open")).then(pl.lit("up")).otherwise(pl.lit("down")).alias("direction"))
    _z = zone_how_zones.join(zone_how_bars.select("bar", "timestamp"), on="bar")
    _width_ms = {"5m": 5, "15m": 15, "30m": 30}[zone_how_timeframe.value] * 60 * 1000
    _zp = _z.to_pandas()
    _zp["t_next"] = _zp["timestamp"] + _pd.Timedelta(milliseconds=_width_ms)          # the zone of bar b applies to bar b + 1
    _zp["t_next_end"] = _zp["t_next"] + _pd.Timedelta(milliseconds=_width_ms)
    _bp = _bars.to_pandas()
    _bp["t_end"] = _bp["timestamp"] + _pd.Timedelta(milliseconds=_width_ms)
    _t0, _t1 = _bp["timestamp"].min(), _bp["t_end"].max()
    _lo, _hi = float(_bp["low"].min()), float(_bp["high"].max())
    _pad = (_hi - _lo) * 0.15
    _scale = alt.Scale(domain=[_lo - _pad, _hi + _pad], zero=False)
    _x = alt.X("timestamp:T", title="Pacific wall clock")
    _sup = alt.Chart(_zp).mark_rect(opacity=0.45, color=OKABE["blue"]).encode(x="t_next:T", x2="t_next_end:T", y=alt.Y("support_low:Q", scale=_scale), y2="support_high:Q",
                                                                            tooltip=[alt.Tooltip("t_next:T", title="applies to bar"), alt.Tooltip("support_low:Q", format=".2f"), alt.Tooltip("support_high:Q", format=".2f"), "support_strength", "support_families"])
    _res = alt.Chart(_zp).mark_rect(opacity=0.45, color=OKABE["orange"]).encode(x="t_next:T", x2="t_next_end:T", y=alt.Y("resistance_low:Q", scale=_scale), y2="resistance_high:Q",
                                                                              tooltip=[alt.Tooltip("t_next:T", title="applies to bar"), alt.Tooltip("resistance_low:Q", format=".2f"), alt.Tooltip("resistance_high:Q", format=".2f"), "resistance_strength", "resistance_families"])
    _ev = zone_how_events
    _t0s, _t1s = int(_t0.timestamp()), int(_t1.timestamp())
    _ev = _ev[(_ev["known_from"] <= _t1s) & (_ev["valid_until"] > _t0s) & (_ev["price"] > _lo - _pad) & (_ev["price"] < _hi + _pad)].copy()
    _ev["from"] = _pd.to_datetime(np.maximum(_ev["known_from"].to_numpy(np.int64), _t0s), unit="s")
    _ev["to"] = _pd.to_datetime(np.minimum(_ev["valid_until"].to_numpy(np.int64), _t1s), unit="s")
    _lv = alt.Chart(_ev).mark_rule(strokeWidth=1.5, opacity=0.85).encode(x="from:T", x2="to:T", y=alt.Y("price:Q", scale=_scale),
                                                                       color=alt.Color("family_group:N", scale=alt.Scale(scheme="viridis"), title="level family"), strokeDash="family_group:N",
                                                                       tooltip=["source", "family_group", alt.Tooltip("price:Q", format=",.2f"), "from:T", "to:T"])
    _wick = alt.Chart(_bp).mark_rule(strokeWidth=1).encode(x=_x, y=alt.Y("low:Q", scale=_scale, title="price (back-adjusted points)"), y2="high:Q",
                                                          color=alt.Color("direction:N", scale=alt.Scale(domain=["up", "down"], range=[OKABE["orange"], OKABE["blue"]]), legend=None))
    _body = alt.Chart(_bp).mark_bar(size=max(2, int(900 / max(len(_bp), 1)) - 1)).encode(x=_x, y="open:Q", y2="close:Q",
                                                                                          color=alt.Color("direction:N", scale=alt.Scale(domain=["up", "down"], range=[OKABE["orange"], OKABE["blue"]]), legend=None),
                                                                                          tooltip=["bar", "timestamp:T", alt.Tooltip("open:Q", format=".2f"), alt.Tooltip("high:Q", format=".2f"), alt.Tooltip("low:Q", format=".2f"), alt.Tooltip("close:Q", format=".2f"), alt.Tooltip("atr:Q", format=".2f")])
    _sel = _bp.iloc[[zone_how_bar.value]]
    _cursor = alt.Chart(_sel).mark_rule(color=OKABE["black"], strokeWidth=2, strokeDash=[4, 3]).encode(x="timestamp:T")
    _chart = alt.layer(_sup, _res, _lv, _wick, _body, _cursor).resolve_scale(color="independent").properties(width=1000, height=520).interactive(bind_y=False)
    mo.vstack([mo.md(f"### {zone_how_symbol.value} {zone_how_timeframe.value} candles with the zones each bar HANDS TO THE NEXT bar (blue band = support, orange band = resistance; "
                     "band opacity is constant, hover for strength and families), every level event while it was known and valid (lines by family), "
                     "and the bar picked above (dashed). Drag to pan, wheel to zoom in time."), _chart])
    return


@app.cell
def _(mo):
    zone_how_push = mo.ui.run_button(label="Show these zones on the Market chart (127.0.0.1:5000)")
    mo.hstack([zone_how_push, mo.md("Draws the session's support / resistance bands (as four step lines) and the level events on the dashboard's candlestick chart, on the chart's own price scale (the chart shows raw contract prices; the offset to the back-adjusted series is measured on the session's bars and removed). Put the Market chart on the same symbol, 5m, and this day first.")])
    return (zone_how_push,)


@app.cell
def _(mo, np, pl, zone_how_bars, zone_how_day, zone_how_events, zone_how_push, zone_how_symbol, zone_how_timeframe, zone_how_zones):
    mo.stop(not zone_how_push.value, mo.md("Press the button to draw the zones on the Market chart."))
    import pandas as _pd
    from lake import dashboard as _dash

    _context = _dash.fetch_chart_context()
    if not _context or _context.get("symbol") != zone_how_symbol.value:
        mo.stop(True, mo.md(f"The Market chart shows {_context.get('symbol') if _context else 'nothing'}; select {zone_how_symbol.value} there first."))
    _z = zone_how_zones.join(zone_how_bars.select("bar", "timestamp", "close"), on="bar").to_pandas()
    _width_ms = {"5m": 5, "15m": 15, "30m": 30}[zone_how_timeframe.value] * 60 * 1000
    _bar_ms = (_z["timestamp"] - _pd.Timestamp(0)) // _pd.Timedelta(milliseconds=1)      # unit-safe epoch milliseconds
    _z["t_next_ms"] = _bar_ms + _width_ms
    # the chart draws raw contract prices; the notebook's series is back-adjusted, so measure the offset on the same bars
    _offset = 0.0
    try:
        _chart = _dash.chart_bars({**_context, "visibleStartMs": int(_z["t_next_ms"].min()) - 3 * _width_ms, "visibleEndMs": int(_z["t_next_ms"].max()) + _width_ms})
        _mine = _pd.DataFrame({"timestamp_milliseconds": _bar_ms, "close_adjusted": _z["close"]})
        _joined = _chart.merge(_mine, on="timestamp_milliseconds", how="inner")
        if len(_joined):
            _offset = float(np.median(_joined["close"] - _joined["close_adjusted"]))
    except Exception as _error:  # noqa: BLE001 - the chart may be on another timeframe; draw unadjusted and say so
        _offset_note = f"(could not measure the roll offset: {str(_error)[:120]}; drawn unadjusted)"
    else:
        _offset_note = f"(roll offset removed: {_offset:+.2f} points)"
    _overlays = []
    for _name, _colour in (("support", "#0072B2"), ("resistance", "#E69F00")):
        for _edge in ("low", "high"):
            _overlays.append(_dash.line(f"{_name}_{_edge}", _z["t_next_ms"], _z[f"{_name}_{_edge}"] + _offset, label=f"{_name} zone {_edge}", color=_colour))
    _t0s, _t1s = int(_z["t_next_ms"].min() // 1000), int(_z["t_next_ms"].max() // 1000)
    _ev = zone_how_events[(zone_how_events["known_from"] <= _t1s) & (zone_how_events["valid_until"] > _t0s)]
    _ev = _ev[_ev["family"] != "session_vwap"].sort_values("known_from").head(30)
    for _k, _e in enumerate(_ev.itertuples()):
        _overlays.append(_dash.level(f"level_{_k}", float(_e.price) + _offset, label=str(_e.source), color="#56B4E9", style="dotted"))
    _status = _dash.push_overlays("zones_how", _context, _overlays)
    mo.md(f"**{_status.message}** {_offset_note}. Source `zones_how` on the Market chart; the day drawn is the session ending {zone_how_day.value}.")
    return


if __name__ == "__main__":
    app.run()
