import marimo

__generated_with = "0.24.0"
app = marimo.App(width="full")


@app.cell
def _():
    import calendar
    import json
    from datetime import date, timedelta
    from pathlib import Path

    import altair as alt
    import duckdb
    import marimo as mo
    import polars as pl
    from lake import serving

    return Path, alt, calendar, date, duckdb, json, mo, pl, serving, timedelta


@app.cell
def _(mo):
    mo.md(
        r"""
# Stock-index futures: tick, exchange, contract and months

The numbers on this page come from `src/config/contract_specifications.json`, built by
`scripts/build_contract_specifications.py` from AMP Futures' contract-specifications page
(the three stock-index sections: E-nano, Micro E-mini, Stock Index). CME / CBOT rows also carry
what CME Group's own contract-specs pages state. The full write-up is
`docs/contract-specifications.md`.

Think of each contract as a **fixed-size bet on an index number**. The exchange sets three things:
how big one step of the price is (the *tick*), how much money one step moves for one contract
(the *tick value*), and which months the contract expires in (the *months*). Everything a simulator
turns into dollars follows from those three.
"""
    )
    return


@app.cell
def _(Path, duckdb, json, mo, pl):
    SPEC_PATH = Path(mo.notebook_dir()).parent / "src" / "config" / "contract_specifications.json"
    specification_document = json.loads(SPEC_PATH.read_text(encoding="utf-8"))
    MONTH_CODES = specification_document["month_codes"]
    LAKE_ROOTS = specification_document["lake_roots"]

    _rows = []
    for _contract in specification_document["contracts"]:
        _rows.append(
            {
                "symbol": _contract["symbol"],
                "name": _contract["name"],
                "product_group": _contract["product_group"],
                "exchange": _contract["exchange"],
                "exchange_group": _contract["exchange_group"],
                "currency": _contract["currency"],
                "contract_multiplier_per_index_point": float(_contract["contract_multiplier_per_index_point"]),
                "tick_size_index_points": float(_contract["tick_size_index_points"]),
                "tick_value_per_contract": float(_contract["tick_value_per_contract"]),
                "price_decimal_places": int(_contract["price_decimal_places"]),
                "contract_months": ",".join(_contract["contract_months"]) if _contract["contract_months"] else None,
                "contract_months_note": _contract["contract_months_note"],
                "in_lake": bool(_contract["in_lake"]),
                "verification": " + ".join(_contract["verification"]),
                "trading_hours_central_time": _contract.get("trading_hours_central_time"),
                "last_trading_day": _contract.get("last_trading_day"),
            }
        )
    contract_specifications = pl.DataFrame(_rows)

    # The numbers live in DuckDB for the rest of the page (and for any later question).
    specification_db = duckdb.connect()
    specification_db.register("contract_specifications", contract_specifications.to_arrow())
    mo.md(
        f"Loaded **{contract_specifications.height} contracts** from `{SPEC_PATH.name}` "
        f"(retrieved {specification_document['retrieved_on']}) into the DuckDB table `contract_specifications`."
    )
    return (
        LAKE_ROOTS,
        MONTH_CODES,
        SPEC_PATH,
        contract_specifications,
        specification_db,
        specification_document,
    )


@app.cell
def _():
    # Okabe-Ito, deuteranopia-safe. Meaning is never carried by red/green alone.
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
    EXCHANGE_GROUP_COLORS = {
        "CME Group": OKABE_ITO["blue"],
        "Eurex": OKABE_ITO["orange"],
        "Cboe Global Markets": OKABE_ITO["reddish_purple"],
        "ICE Futures Europe": OKABE_ITO["sky"],
        "Japan Exchange Group": OKABE_ITO["vermillion"],
        "Singapore Exchange": OKABE_ITO["bluish_green"],
        "ASX": OKABE_ITO["yellow"],
        "Hong Kong Exchanges and Clearing": OKABE_ITO["black"],
    }
    return EXCHANGE_GROUP_COLORS, OKABE_ITO


@app.cell
def _(contract_specifications, mo):
    _groups = sorted(contract_specifications["exchange_group"].unique().to_list())
    _currencies = sorted(contract_specifications["currency"].unique().to_list())
    exchange_group_filter = mo.ui.multiselect(options=_groups, value=_groups, label="Exchange groups")
    currency_filter = mo.ui.multiselect(options=_currencies, value=_currencies, label="Currencies")
    lake_only_switch = mo.ui.switch(value=False, label="Only the 8 roots the lake carries")
    mo.hstack([exchange_group_filter, currency_filter, lake_only_switch], gap=2, wrap=True)
    return currency_filter, exchange_group_filter, lake_only_switch


@app.cell
def _(contract_specifications, currency_filter, exchange_group_filter, lake_only_switch, mo, pl):
    filtered_specifications = contract_specifications.filter(
        pl.col("exchange_group").is_in(exchange_group_filter.value)
        & pl.col("currency").is_in(currency_filter.value)
        & (pl.col("in_lake") if lake_only_switch.value else pl.lit(True))
    )
    mo.vstack(
        [
            mo.md(
                f"**{filtered_specifications.height} of {contract_specifications.height} contracts** shown. "
                "Every column is spelled out; hover a header to sort, type in a header to filter."
            ),
            mo.ui.table(
                filtered_specifications.select(
                    "symbol",
                    "name",
                    "product_group",
                    "exchange",
                    "exchange_group",
                    "currency",
                    "contract_multiplier_per_index_point",
                    "tick_size_index_points",
                    "tick_value_per_contract",
                    "contract_months",
                    "contract_months_note",
                    "in_lake",
                    "verification",
                ),
                selection=None,
                page_size=45,
            ),
        ]
    )
    return (filtered_specifications,)


@app.cell
def _(EXCHANGE_GROUP_COLORS, alt, filtered_specifications, mo):
    _base = alt.Chart(filtered_specifications.to_pandas()).encode(
        y=alt.Y("symbol:N", sort="-x", title="contract symbol"),
        color=alt.Color(
            "exchange_group:N",
            title="exchange group",
            scale=alt.Scale(domain=list(EXCHANGE_GROUP_COLORS), range=list(EXCHANGE_GROUP_COLORS.values())),
        ),
        tooltip=[
            "symbol", "name", "exchange_group", "currency",
            alt.Tooltip("contract_multiplier_per_index_point:Q", title="multiplier per index point"),
            alt.Tooltip("tick_size_index_points:Q", title="tick size (index points)"),
            alt.Tooltip("tick_value_per_contract:Q", title="tick value per contract"),
        ],
    )
    # Points, not bars: a bar on a log axis starts at zero, which the axis cannot show, so it vanishes.
    _tick_value = _base.mark_point(filled=True, size=90, shape="circle").encode(
        x=alt.X("tick_value_per_contract:Q", title="one tick, in the contract's own currency (log scale)", scale=alt.Scale(type="log")),
    ).properties(width=420, height=24 * max(filtered_specifications.height, 1), title="What one tick is worth")
    _multiplier = _base.mark_point(filled=True, size=90, shape="diamond").encode(
        x=alt.X("contract_multiplier_per_index_point:Q", title="one index point, in the contract's own currency (log scale)", scale=alt.Scale(type="log")),
    ).properties(width=420, height=24 * max(filtered_specifications.height, 1), title="What one index point is worth")
    mo.vstack(
        [
            mo.md(
                "Two views of the same rows. Left: the money one **tick** moves. Right: the money one whole **index point** "
                "moves (the multiplier). A contract with a fine tick and a big multiplier (ES: 0.25 points, $50 per point) "
                "sits far right but only mid-left. Circles (tick) and diamonds (point) are in each contract's own currency, so compare within a colour."
            ),
            mo.ui.altair_chart(_tick_value | _multiplier),
        ]
    )
    return


@app.cell
def _(mo):
    mo.md(
        r"""
## The formula, operated

$$\text{tick value} = \text{tick size} \times \text{multiplier}
\qquad\qquad
\text{profit} = \frac{\Delta p}{\text{tick size}} \times \text{tick value} \times n$$

Pick a contract, drag how far the index moved and how many contracts you hold. Every symbol below the
formula shows the value it currently holds, and the staircase shows each tick adding its tick value to
the running total.
"""
    )
    return


@app.cell
def _(contract_specifications, mo):
    _symbols = contract_specifications.sort("symbol")["symbol"].to_list()
    product_pick = mo.ui.dropdown(options=_symbols, value="MNQ", label="Contract")
    contracts_held = mo.ui.slider(1, 20, value=1, step=1, label="Contracts held (n)")
    mo.hstack([product_pick, contracts_held], gap=2, wrap=True)
    return contracts_held, product_pick


@app.cell
def _(contract_specifications, mo, pl, product_pick):
    picked = contract_specifications.filter(pl.col("symbol") == product_pick.value).row(0, named=True)
    _tick = picked["tick_size_index_points"]
    # The slider steps in whole ticks so the price can only land where the exchange lets it trade.
    _max_ticks = 200
    points_moved = mo.ui.slider(
        -_max_ticks * _tick, _max_ticks * _tick, value=40 * _tick, step=_tick,
        label=f"Index moved, Δp (index points, one step = one tick of {_tick:g})",
        show_value=True,
    )
    points_moved
    return picked, points_moved


@app.cell
def _(OKABE_ITO, alt, contracts_held, mo, picked, pl, points_moved):
    _tick_size = picked["tick_size_index_points"]
    _multiplier = picked["contract_multiplier_per_index_point"]
    _tick_value = picked["tick_value_per_contract"]
    _currency = picked["currency"]
    _n = contracts_held.value
    _delta = points_moved.value
    _ticks = round(_delta / _tick_size)
    _profit = _ticks * _tick_value * _n
    _sign = "+" if _profit >= 0 else "−"

    _legend = f"""
| symbol | name | holds | value now |
|---|---|---|---|
| tick size | minimum price step of **{picked["symbol"]}**, in index points | `tick_size_index_points` | {_tick_size:g} points |
| multiplier | money one index point is worth for one contract | `contract_multiplier_per_index_point` | {_currency} {_multiplier:g} per point |
| tick value | money one tick is worth for one contract = tick size × multiplier | `tick_value_per_contract` | {_currency} {_tick_value:g} = {_tick_size:g} × {_multiplier:g} |
| Δp | how far the index moved, from the slider | — | {_delta:+g} points = {_ticks:+d} ticks |
| n | contracts held, from the slider | — | {_n} |
| profit | Δp ÷ tick size × tick value × n | — | **{_sign}{_currency} {abs(_profit):,.2f}** |
"""

    _steps = list(range(0, _ticks + (1 if _ticks >= 0 else -1), 1 if _ticks >= 0 else -1))
    _stairs = pl.DataFrame(
        {
            "tick_index": _steps,
            "running_total": [step * _tick_value * _n for step in _steps],
            "index_price_move_points": [step * _tick_size for step in _steps],
        }
    )
    _chart = (
        alt.Chart(_stairs.to_pandas())
        .mark_line(interpolate="step-after", color=OKABE_ITO["orange"] if _profit >= 0 else OKABE_ITO["blue"], strokeWidth=2.5)
        .encode(
            x=alt.X("tick_index:Q", title="tick number i (each step is one tick)"),
            y=alt.Y("running_total:Q", title=f"running total, {_currency}"),
            tooltip=[
                alt.Tooltip("tick_index:Q", title="tick i"),
                alt.Tooltip("index_price_move_points:Q", title="index moved (points)"),
                alt.Tooltip("running_total:Q", title=f"running total ({_currency})", format=",.2f"),
            ],
        )
        .properties(width=560, height=260, title=f"{picked['name']} ({picked['symbol']}): each tick adds {_currency} {_tick_value * _n:g} for {_n} contract(s)")
    )
    mo.vstack([mo.md(_legend), mo.ui.altair_chart(_chart)])
    return


@app.cell
def _(mo):
    mo.md(
        r"""
## Months — the quarterly cycle, and when the lake's volume actually rolled

Stock-index futures list on the **H, M, U, Z** cycle: March, June, September, December. Each contract
stops trading on the **third Friday** of its month. Traders move to the next contract before that —
CME's published roll date for equity-index futures is the **Monday before the third Friday** — and the
lake shows when the *volume* actually moved: the first day the next contract traded more than the
expiring one, computed here from the daily per-contract bars in `ohlcv_1d`.
"""
    )
    return


@app.cell
def _(LAKE_ROOTS, date, mo):
    roll_root_pick = mo.ui.dropdown(options=LAKE_ROOTS, value="MNQ", label="Root")
    roll_year_pick = mo.ui.slider(2016, date.today().year + 1, value=2025, step=1, label="Year", show_value=True)
    mo.hstack([roll_root_pick, roll_year_pick], gap=2, wrap=True)
    return roll_root_pick, roll_year_pick


@app.cell
def _(pl, serving):
    _connection = serving.connect()
    _connection.execute("SET TimeZone='UTC'")
    observed_rolls = _connection.execute(
        """
        WITH daily AS (
          SELECT root, symbol, CAST(timestamp AS DATE) AS day, sum(volume) AS volume
          FROM ohlcv_1d
          WHERE root IN ('ES','NQ','YM','RTY','MES','MNQ','MYM','M2K') AND symbol <> root AND symbol NOT LIKE '%-%'
          GROUP BY 1, 2, 3),
        front AS (
          SELECT root, day, arg_max(symbol, volume) AS front_contract, max(volume) AS front_contract_volume
          FROM daily GROUP BY 1, 2),
        sequenced AS (
          SELECT root, day, front_contract, front_contract_volume,
                 lag(front_contract) OVER (PARTITION BY root ORDER BY day) AS previous_contract
          FROM front)
        SELECT root, day AS roll_day, previous_contract, front_contract, front_contract_volume
        FROM sequenced WHERE previous_contract IS NOT NULL AND previous_contract <> front_contract
        ORDER BY root, day
        """
    ).pl()
    front_contract_by_day = _connection.execute(
        """
        WITH daily AS (
          SELECT root, symbol, CAST(timestamp AS DATE) AS day, sum(volume) AS volume
          FROM ohlcv_1d
          WHERE root IN ('ES','NQ','YM','RTY','MES','MNQ','MYM','M2K') AND symbol <> root AND symbol NOT LIKE '%-%'
          GROUP BY 1, 2, 3)
        SELECT root, day, arg_max(symbol, volume) AS front_contract FROM daily GROUP BY 1, 2 ORDER BY 1, 2
        """
    ).pl()
    _connection.close()
    observed_rolls = observed_rolls.with_columns(pl.col("roll_day").cast(pl.Date))
    front_contract_by_day = front_contract_by_day.with_columns(pl.col("day").cast(pl.Date))
    return front_contract_by_day, observed_rolls


@app.cell
def _(calendar, date):
    def third_friday(year, month):
        _first_weekday, _days = calendar.monthrange(year, month)
        _first_friday = 1 + (calendar.FRIDAY - _first_weekday) % 7
        return date(year, month, _first_friday + 14)

    QUARTERLY = [("H", 3), ("M", 6), ("U", 9), ("Z", 12)]
    return QUARTERLY, third_friday


@app.cell
def _(
    MONTH_CODES,
    OKABE_ITO,
    QUARTERLY,
    alt,
    date,
    front_contract_by_day,
    mo,
    observed_rolls,
    pl,
    roll_root_pick,
    roll_year_pick,
    third_friday,
    timedelta,
):
    _root = roll_root_pick.value
    _year = roll_year_pick.value
    _expiries = pl.DataFrame(
        {
            "month_code": [code for code, _month in QUARTERLY],
            "month_name": [MONTH_CODES[code] for code, _month in QUARTERLY],
            "third_friday_expiry": [third_friday(_year, month) for _code, month in QUARTERLY],
        }
    ).with_columns(
        (pl.col("third_friday_expiry") - pl.duration(days=4)).alias("cme_roll_date"),
    )
    _rolls = observed_rolls.filter(
        (pl.col("root") == _root) & (pl.col("roll_day").dt.year() == _year)
    ).sort("roll_day")
    _segments = front_contract_by_day.filter(
        (pl.col("root") == _root) & (pl.col("day").dt.year() == _year)
    )

    _segment_chart = (
        alt.Chart(_segments.to_pandas())
        .mark_tick(thickness=3, size=28)
        .encode(
            x=alt.X("day:T", title=f"{_year}", scale=alt.Scale(domain=[str(date(_year, 1, 1)), str(date(_year, 12, 31))])),
            y=alt.value(40),
            color=alt.Color(
                "front_contract:N",
                title="front contract (most volume that day)",
                # Okabe-Ito, never the red/green of the default categorical scheme.
                scale=alt.Scale(range=[OKABE_ITO[name] for name in ("blue", "orange", "sky", "vermillion", "bluish_green", "reddish_purple", "yellow", "black")]),
            ),
            tooltip=[alt.Tooltip("day:T", title="day"), alt.Tooltip("front_contract:N", title="front contract")],
        )
    )
    _expiry_rules = (
        alt.Chart(_expiries.to_pandas())
        .mark_rule(color=OKABE_ITO["black"], strokeDash=[6, 3], strokeWidth=1.5)
        .encode(x="third_friday_expiry:T", tooltip=[alt.Tooltip("month_code:N", title="month code"), alt.Tooltip("third_friday_expiry:T", title="third Friday (expiry)")])
    )
    _conventional_rules = (
        alt.Chart(_expiries.to_pandas())
        .mark_rule(color=OKABE_ITO["sky"], strokeWidth=1.5)
        .encode(x="cme_roll_date:T", tooltip=[alt.Tooltip("cme_roll_date:T", title="CME roll date (Monday before the third Friday)")])
    )
    _observed_points = (
        alt.Chart(_rolls.to_pandas())
        .mark_point(shape="triangle-down", size=220, filled=True, color=OKABE_ITO["vermillion"])
        .encode(
            x="roll_day:T",
            y=alt.value(12),
            tooltip=[
                alt.Tooltip("roll_day:T", title="volume moved on"),
                alt.Tooltip("previous_contract:N", title="from"),
                alt.Tooltip("front_contract:N", title="to"),
                alt.Tooltip("front_contract_volume:Q", title="new front volume that day", format=","),
            ],
        )
    )
    _chart = (_segment_chart + _expiry_rules + _conventional_rules + _observed_points).properties(
        width=900, height=90,
        title=f"{_root} {_year}: front contract by day (colour), third-Friday expiries (dashed black), CME roll date (sky), lake's observed volume roll (▼ vermillion)",
    )

    _table_rows = []
    for _expiry in _expiries.iter_rows(named=True):
        _match = _rolls.filter(
            (pl.col("roll_day") >= _expiry["third_friday_expiry"] - timedelta(days=21))
            & (pl.col("roll_day") <= _expiry["third_friday_expiry"] + timedelta(days=3))
        )
        _observed = _match.row(0, named=True) if _match.height else None
        _table_rows.append(
            {
                "month_code": _expiry["month_code"],
                "month": _expiry["month_name"],
                "third_friday_expiry": _expiry["third_friday_expiry"].isoformat(),
                "cme_roll_date": _expiry["cme_roll_date"].isoformat(),
                "lake_observed_roll_day": _observed["roll_day"].isoformat() if _observed else "no bars",
                "days_before_expiry": (_expiry["third_friday_expiry"] - _observed["roll_day"]).days if _observed else None,
                "from_contract": _observed["previous_contract"] if _observed else None,
                "to_contract": _observed["front_contract"] if _observed else None,
            }
        )
    mo.vstack(
        [
            mo.ui.altair_chart(_chart),
            mo.md(
                f"Rolls the lake recorded for **{_root}** in {_year}: **{_rolls.height}** (a quarterly contract gives four a year; "
                "more means the daily-volume leader flipped back and forth around a roll, fewer means missing days — "
                f"the lake's MNQ 1-minute bars stop at 2025-12-30 and resume 2026-03-02)."
            ),
            mo.ui.table(pl.DataFrame(_table_rows), selection=None),
        ]
    )
    return


@app.cell
def _(mo):
    mo.md(
        r"""
## Hours — the exchange schedule, seen in the bars

CME Globex equity-index futures trade **Sunday 5:00 p.m. to Friday 4:00 p.m. Central**, with a daily
halt from **4:00 to 5:00 p.m. Central**. The lake stamps futures bars in **Pacific wall-clock time**
(`CLAUDE.md`, *Open findings*), so that halt is the stamped hour 14 and the week opens at stamped
15:00 on Sunday. Count the 1-minute bars by hour and the halt is the missing bar.
"""
    )
    return


@app.cell
def _(LAKE_ROOTS, mo):
    hours_root_pick = mo.ui.dropdown(options=LAKE_ROOTS, value="MNQ", label="Root (1-minute bars, ohlcv_1m)")
    hours_root_pick
    return (hours_root_pick,)


@app.cell
def _(OKABE_ITO, alt, hours_root_pick, mo, pl, serving):
    _connection = serving.connect()
    _connection.execute("SET TimeZone='UTC'")
    _counts = _connection.execute(
        "SELECT hour(timestamp) AS stamped_hour_pacific, count(*) AS one_minute_bar_count "
        "FROM ohlcv_1m WHERE symbol = ? GROUP BY 1 ORDER BY 1",
        [hours_root_pick.value],
    ).pl()
    _connection.close()
    bars_by_hour = (
        pl.DataFrame({"stamped_hour_pacific": list(range(24))})
        .join(_counts, on="stamped_hour_pacific", how="left")
        .with_columns(pl.col("one_minute_bar_count").fill_null(0))
        .with_columns(
            ((pl.col("stamped_hour_pacific") + 2) % 24).alias("hour_central_time"),
            (pl.col("one_minute_bar_count") == 0).alias("no_bars"),
        )
    )
    _chart = (
        alt.Chart(bars_by_hour.to_pandas())
        .mark_bar()
        .encode(
            x=alt.X("stamped_hour_pacific:O", title="stamped hour (Pacific wall-clock, as stored in the lake)"),
            y=alt.Y("one_minute_bar_count:Q", title="1-minute bars in the lake"),
            color=alt.Color(
                "no_bars:N",
                title="",
                scale=alt.Scale(domain=[False, True], range=[OKABE_ITO["blue"], OKABE_ITO["vermillion"]]),
                legend=alt.Legend(labelExpr="datum.label == 'true' ? 'no bars: the 4-5 p.m. CT halt' : 'bars present'"),
            ),
            tooltip=[
                alt.Tooltip("stamped_hour_pacific:O", title="stamped hour (Pacific)"),
                alt.Tooltip("hour_central_time:O", title="hour (Central)"),
                alt.Tooltip("one_minute_bar_count:Q", title="1-minute bars", format=","),
            ],
        )
        .properties(width=820, height=240, title=f"{hours_root_pick.value}: 1-minute bars per stamped hour")
    )
    _empty = bars_by_hour.filter(pl.col("no_bars"))["stamped_hour_pacific"].to_list()
    mo.vstack(
        [
            mo.ui.altair_chart(_chart),
            mo.md(
                f"Empty stamped hours for **{hours_root_pick.value}**: **{_empty}** — "
                + ("hour 14 Pacific is 16:00 Central, the daily halt." if _empty == [14] else "compare with the CME schedule above.")
            ),
        ]
    )
    return (bars_by_hour,)


@app.cell
def _(contract_specifications, mo, pl, specification_db):
    _verified = specification_db.execute(
        "SELECT verification, count(*) AS contracts, sum(CASE WHEN in_lake THEN 1 ELSE 0 END) AS in_lake "
        "FROM contract_specifications GROUP BY 1 ORDER BY 1"
    ).pl()
    _lake_rows = contract_specifications.filter(pl.col("in_lake")).select(
        "symbol", "exchange", "tick_size_index_points", "tick_value_per_contract",
        "contract_multiplier_per_index_point", "contract_months", "trading_hours_central_time", "last_trading_day",
    )
    mo.vstack(
        [
            mo.md(
                r"""
## Where these numbers are used, and how far they were checked

| reader | what it takes from the specification |
|---|---|
| `scripts/seed-instruments.ts` → SQLite `instruments` | tick size, tick value, multiplier (point value), exchange, months, decimal places, for the 8 lake roots — served at `/api/instruments` |
| `src/client/src/market/components/chartConfig.ts` | tick size, tick value and decimals for the chart's price scale and its "Tick: … = $…" label |
| `src/config/cost_model.json` (MNQ) | tick size, tick value, point value beside the broker fees; `tests/test_contract_specifications.py` holds it equal to this file |
| `src/ml/cycle/simulate.py`, `src/ml/blocks/trading_env.py`, `src/ml/lens/adapters.py` | read the cost model, so USD P&L = points × multiplier rests on these rows |
"""
            ),
            mo.ui.table(_verified, selection=None),
            mo.md("The eight roots the lake carries, with the CME Group fields:"),
            mo.ui.table(_lake_rows, selection=None),
        ]
    )
    return


if __name__ == "__main__":
    app.run()
