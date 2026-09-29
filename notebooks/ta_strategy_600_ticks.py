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


if __name__ == "__main__":
    app.run()
