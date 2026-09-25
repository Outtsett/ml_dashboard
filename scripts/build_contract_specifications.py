"""Build ``src/config/contract_specifications.json`` from AMP Futures' contract-specifications page.

    uv run python scripts/build_contract_specifications.py                 # fetch the live page
    uv run python scripts/build_contract_specifications.py --html <file>   # parse a saved copy
    uv run python scripts/build_contract_specifications.py --check         # exit 1 if the JSON would change

What is read: the three stock-index sections of
https://www.ampfutures.com/trading-info/contract-specifications — *E-nano Futures*,
*Micro E-mini Futures* and *Stock Index* — each a six-column table (name, symbol, exchange,
contract size, months, "tick / $ value"). Every other section (currencies, energies, ...) is ignored.

What is added: ``CME_GROUP_VERIFIED`` below carries the fields CME Group's own contract-specs
pages state for the CME / CBOT products (Globex code, trading hours, last trading day, settlement)
and marks those rows ``verification: ["amp_futures", "cme_group"]``. Rows outside CME Group are
``["amp_futures"]`` only — AMP is the sole source read for them.

The page's own typos are corrected by ``AMP_CORRECTIONS`` (each with the reason), never silently.

Column names follow the naming rule: no abbreviations, units in the name. ``tick_size_index_points``
is the minimum price fluctuation in index points, ``tick_value_per_contract`` is what one tick is
worth in the row's ``currency``, ``contract_multiplier_per_index_point`` is the currency amount one
index point is worth per contract (the "point value" the simulators multiply by).
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path

SOURCE_URL = "https://www.ampfutures.com/trading-info/contract-specifications"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "src" / "config" / "contract_specifications.json"

SECTION_TO_PRODUCT_GROUP = {
    "E-nano Futures": "e_nano",
    "Micro E-mini Futures": "micro_e_mini",
    "Stock Index": "stock_index",
}
COLUMN_HEADERS = {"Name", "Symbol", "Exchange", "Contract Size", "Months", "Tick / $ Value"}
STOP_SECTION = "Currencies"

MONTH_CODES = {
    "F": "January", "G": "February", "H": "March", "J": "April", "K": "May", "M": "June",
    "N": "July", "Q": "August", "U": "September", "V": "October", "X": "November", "Z": "December",
}

# Roots the lake carries (Iceberg ``market.bars``, ``symbols`` table: 886 contracts + spreads).
LAKE_ROOTS = {"ES", "NQ", "YM", "RTY", "MES", "MNQ", "MYM", "M2K"}

# AMP's exchange labels -> (listing exchange code, exchange group). "CBOT/CME" means listed on
# CBOT and traded on CME Globex; the listing exchange is what the instruments table stores.
EXCHANGE_BY_AMP_LABEL = {
    "CME": ("CME", "CME Group"),
    "CBOT/CME": ("CBOT", "CME Group"),
    "Eurex": ("EUREX", "Eurex"),
    "CFE/CBOE": ("CFE", "Cboe Global Markets"),
    "ICE Europe - Financials": ("ICE_EUROPE", "ICE Futures Europe"),
    "Osaka - Japan (JPX)": ("OSE", "Japan Exchange Group"),
    "Singapore Exchange (SGX)": ("SGX", "Singapore Exchange"),
    "Australian Securities Exchange (ASX)": ("ASX", "ASX"),
    "Hong Kong (HKEX)": ("HKEX", "Hong Kong Exchanges and Clearing"),
}

# Typos on the AMP page, corrected with the reason. Keyed by symbol -> field -> (amp_value, value, reason).
AMP_CORRECTIONS = {
    "AP": {
        "contract_size": (
            "$25 X Index Value",
            "A$25 X Index Value",
            "AMP prints a bare dollar sign; the tick value on the same row is A$25.00 for a 1-point tick, so the "
            "multiplier is A$25 (the ASX SPI 200 future is Australian-dollar-denominated).",
        ),
    },
    "Y": {
        "contract_size": (
            "€2 x Index Value",
            "£2 x Index Value",
            "AMP prints a euro sign; the tick value on the same row is £1 for a 0.5 tick, so the multiplier is £2 "
            "(ICE Futures Europe FTSE 250 Index Future is sterling-denominated).",
        ),
    },
}

# Fields CME Group's own contract-specs pages state, every one read in a live browser tab on
# 2026-09-25 (cmegroup.com answers a plain HTTP fetch with 403, so a scripted fetch cannot be
# the source). Only CME / CBOT products; the wording is each page's own. The lake's futures bars
# are stamped Pacific wall-clock, so the 4:00-5:00 p.m. CT maintenance halt is the empty stamped
# hour 14 and the Sunday 5:00 p.m. CT open is stamped 15:00.
_CME_ROOT = "https://www.cmegroup.com/markets/equities"
_US_INDEX_HOURS = (
    "CME Globex: Sunday 6:00 p.m. - Friday 5:00 p.m. ET (5:00 p.m. - 4:00 p.m. CT) with a daily "
    "maintenance period from 5:00 p.m. - 6:00 p.m. ET (4:00 p.m. - 5:00 p.m. CT)"
)
_NIKKEI_HOURS = (
    "Sunday - Friday 6:00 p.m. - 5:00 p.m. ET (5:00 p.m. - 4:00 p.m. CT) with a 60-minute break each day "
    "beginning at 5:00 p.m. ET (4:00 p.m. CT)"
)
_THIRD_FRIDAY = "Trading terminates at 9:30 a.m. ET on the 3rd Friday of the contract month"
_FINANCIALLY_SETTLED = "Financially settled"
_QUARTERLY = "Quarterly contracts (Mar, Jun, Sep, Dec) listed for "

# CME Group's equity-index roll-date rule (https://www.cmegroup.com/trading/equity-index/rolldates.html,
# a canvas page read from a screenshot on 2026-09-25; its 2025 table: expiry 3/21, 6/20, 9/19, 12/19 and
# roll 3/17, 6/16, 9/15, 12/15). Measured in the lake from daily per-contract volume, ES moved to the next
# contract on exactly those four Mondays and MNQ on three of them (its March move landed on Tuesday 03-18).
CME_EQUITY_INDEX_ROLL_DATE = {
    "rule": "The Monday prior to the third Friday of the expiration month (Nikkei 225 and TOPIX: the Monday prior to the second Friday)",
    "source_url": "https://www.cmegroup.com/trading/equity-index/rolldates.html",
}

# CME Group's E-nano FAQ (https://www.cmegroup.com/articles/faqs/faq-e-nano-equity-index-futures.html),
# dated 24 AUG 2026, "Now live: E-nano Equity Index futures".
E_NANO_FUTURES = {
    "launched": "2026-08-24",
    "note": (
        "Multipliers are 1/10 of the Micro E-mini's and 1/100 of the E-mini's; tick increments are double the "
        "Micro E-mini's; the nearest two quarterly months are listed; NDOW is CBOT-listed, the other three CME; "
        "financially settled versus the third-Friday Special Opening Quotation; not eligible for block or BTIC trading"
    ),
    "source_url": "https://www.cmegroup.com/articles/faqs/faq-e-nano-equity-index-futures.html",
}

CME_GROUP_VERIFIED: dict[str, dict] = {}


def _cme(
    symbol: str,
    page: str,
    rulebook: str,
    months_listed: str,
    *,
    spread: float | None = None,
    hours: str = _US_INDEX_HOURS,
    last_trading_day: str = _THIRD_FRIDAY,
    clearing_code: str | None = None,
) -> None:
    entry = {
        "globex_code": symbol,
        "clearing_code": clearing_code or symbol,
        "contract_months_listed_by_exchange": months_listed,
        "trading_hours_central_time": hours,
        "last_trading_day": last_trading_day,
        "settlement": _FINANCIALLY_SETTLED,
        "exchange_rulebook": rulebook,
        "cme_group_url": f"{_CME_ROOT}/{page}.contractSpecs.html",
    }
    if spread is not None:
        entry["tick_size_calendar_spread_index_points"] = spread
    CME_GROUP_VERIFIED[symbol] = entry


_cme("ES", "sp/e-mini-sandp500", "CME 358", _QUARTERLY + "21 consecutive quarters", spread=0.05)
_cme("NQ", "nasdaq/e-mini-nasdaq-100", "CME 359",
     _QUARTERLY + "6 consecutive quarters, 2 additional June contracts and 4 additional December contract months", spread=0.05)
_cme("RTY", "russell/e-mini-russell-2000", "CME 393",
     _QUARTERLY + "5 consecutive quarters, 2 additional June contract months and 4 additional December contract months", spread=0.05)
_cme("YM", "dow-jones/e-mini-dow", "CBOT 27", _QUARTERLY + "4 consecutive quarters")
_cme("EMD", "sp/e-mini-sandp-midcap-400", "CME 362", _QUARTERLY + "5 consecutive quarters", spread=0.05, clearing_code="ME")
_cme("MES", "sp/micro-e-mini-sandp-500", "CME 353", _QUARTERLY + "5 consecutive quarters", spread=0.05)
_cme("MNQ", "nasdaq/micro-e-mini-nasdaq-100", "CME 361", _QUARTERLY + "5 consecutive quarters", spread=0.05)
_cme("M2K", "russell/micro-e-mini-russell-2000", "CME 363", _QUARTERLY + "5 consecutive quarters", spread=0.05)
_cme("MYM", "dow-jones/micro-e-mini-dow", "CBOT 28", _QUARTERLY + "4 consecutive quarters", spread=1.0)
_cme("NKD", "international-indices/nikkei-225-dollar", "CME 352",
     _QUARTERLY + "12 quarters, and 3 additional Dec contract months", hours=_NIKKEI_HOURS, clearing_code="NK",
     last_trading_day="Trading terminates at 5:00 p.m. ET on the Thursday prior to the second Friday of the contract month")
_cme("MNK", "international-indices/micro-nikkei-usd", "CME 352C", _QUARTERLY + "2 consecutive quarters", hours=_NIKKEI_HOURS,
     last_trading_day="5:00 p.m. ET on the business day prior to the 2nd Friday of the contract month")
_cme("NES", "sp/e-nano-sandp-500", "CME 343", "Quarterly contracts listed for 2 consecutive quarters", spread=0.10)
_cme("NNQ", "nasdaq/e-nano-nasdaq-100", "CME 344", "Quarterly contracts listed for 2 consecutive quarters", spread=0.05)
_cme("N2K", "russell/e-nano-russell-2000", "CME 345", "Quarterly contracts listed for 2 consecutive quarters", spread=0.10)
_cme("NDOW", "dow-jones/e-nano-dow", "CBOT 31", "Quarterly contracts listed for 2 consecutive quarters", spread=1.0)


CURRENCY_BY_SIGN = [
    ("HK$", "HKD"), ("A$", "AUD"), ("US$", "USD"), ("$", "USD"),
    ("€", "EUR"), ("£", "GBP"), ("¥", "JPY"),
]


def parse_money(text: str) -> tuple[float, str | None]:
    """'$12.50' -> (12.5, 'USD'); '¥10,000' -> (10000, 'JPY'); '0.25' -> (0.25, None)."""
    text = text.strip().replace(",", "")
    currency = None
    for sign, code in CURRENCY_BY_SIGN:
        if sign in text:
            currency = code
            text = text.replace(sign, "")
            break
    return float(text.strip()), currency


def parse_contract_size(text: str) -> tuple[float, str]:
    """'$50 x Index Value' -> (50, 'USD'); '50HK$ per index point' -> (50, 'HKD')."""
    match = re.match(r"^\s*([^\d]*)\s*([\d.,]+)\s*([^\d\s]*)\s+(?:x|X|per)\b", text)
    if not match:
        raise ValueError(f"cannot read contract size {text!r}")
    leading, number, trailing = match.group(1), match.group(2), match.group(3)
    sign = (leading or trailing).strip()
    currency = next((code for candidate, code in CURRENCY_BY_SIGN if candidate == sign), None)
    if currency is None:
        raise ValueError(f"unknown currency sign {sign!r} in {text!r}")
    return float(number.replace(",", "")), currency


def parse_months(text: str) -> tuple[list[str] | None, str]:
    text = text.strip()
    if re.fullmatch(r"[FGHJKMNQUVXZ](,[FGHJKMNQUVXZ])*", text):
        return text.split(","), "quarterly cycle: " + ", ".join(MONTH_CODES[c] for c in text.split(","))
    if text.lower().startswith("see exch"):
        return None, "listing cycle set by the exchange; not stated by AMP"
    if text.lower() == "all":
        return None, "all calendar months listed, per AMP"
    raise ValueError(f"cannot read months {text!r}")


def decimal_places(tick_size: float) -> int:
    text = f"{tick_size:.10f}".rstrip("0").rstrip(".")
    return len(text.split(".")[1]) if "." in text else 0


def page_lines(raw_html: str) -> list[str]:
    """The page's text, one table cell per line (the page's tables are div grids, not <table>)."""
    body = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw_html, flags=re.S | re.I)
    text = re.sub(r"<br\s*/?>", "\n", body, flags=re.I)
    text = re.sub(r"</(tr|div|p|h\d|li|section|article)>", "\n", text, flags=re.I)
    text = re.sub(r"</(td|th)>", " | ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.split("\n")]
    return [line.rstrip(" |").strip() for line in lines if line.strip(" |").strip()]


def parse_stock_index_rows(raw_html: str) -> list[dict]:
    lines = page_lines(raw_html)
    try:
        start = lines.index("E-nano Futures")
        stop = lines.index(STOP_SECTION, start)
    except ValueError as error:
        raise ValueError("the AMP page no longer has the expected section headers") from error
    rows: list[dict] = []
    group: str | None = None
    cells: list[str] = []
    for line in lines[start:stop]:
        if line in SECTION_TO_PRODUCT_GROUP:
            group, cells = SECTION_TO_PRODUCT_GROUP[line], []
            continue
        if line in COLUMN_HEADERS or line.startswith("New CME"):
            continue
        cells.append(line)
        if len(cells) == 6:
            name, symbol, exchange, contract_size, months, tick = cells
            cells = []
            tick_match = re.fullmatch(r"(\S+)\s*/\s*(\S+)", tick)
            if not tick_match:
                raise ValueError(f"cannot read tick cell {tick!r} for {symbol}")
            rows.append({
                "product_group": group,
                "name": name,
                "symbol": symbol,
                "exchange_as_listed_by_amp": exchange,
                "contract_size_as_listed_by_amp": contract_size,
                "contract_months_as_listed_by_amp": months,
                "tick_as_listed_by_amp": tick,
                "_tick_size": tick_match.group(1),
                "_tick_value": tick_match.group(2),
            })
    if cells:
        raise ValueError(f"a row ended with {len(cells)} cells: {cells}")
    return rows


def build_contract(row: dict) -> dict:
    symbol = row["symbol"]
    corrections = AMP_CORRECTIONS.get(symbol, {})
    contract_size_text = row["contract_size_as_listed_by_amp"]
    if "contract_size" in corrections:
        amp_value, corrected, _reason = corrections["contract_size"]
        if contract_size_text != amp_value:
            raise ValueError(f"{symbol}: AMP changed its contract size to {contract_size_text!r}; drop the correction")
        contract_size_text = corrected
    multiplier, currency = parse_contract_size(contract_size_text)
    tick_size, tick_size_currency = parse_money(row["_tick_size"])
    tick_value, tick_value_currency = parse_money(row["_tick_value"])
    if tick_value_currency and tick_value_currency != currency:
        raise ValueError(f"{symbol}: tick value in {tick_value_currency} but contract size in {currency}")
    if abs(tick_size * multiplier - tick_value) > 1e-9:
        raise ValueError(f"{symbol}: tick {tick_size} x multiplier {multiplier} != tick value {tick_value}")
    exchange, exchange_group = EXCHANGE_BY_AMP_LABEL[row["exchange_as_listed_by_amp"]]
    months, months_note = parse_months(row["contract_months_as_listed_by_amp"])
    contract = {
        "symbol": symbol,
        "name": row["name"],
        "product_group": row["product_group"],
        "exchange": exchange,
        "exchange_group": exchange_group,
        "exchange_as_listed_by_amp": row["exchange_as_listed_by_amp"],
        "currency": currency,
        "contract_multiplier_per_index_point": multiplier,
        "contract_size_as_listed_by_amp": row["contract_size_as_listed_by_amp"],
        "tick_size_index_points": tick_size,
        "tick_value_per_contract": tick_value,
        "tick_as_listed_by_amp": row["tick_as_listed_by_amp"],
        "price_decimal_places": decimal_places(tick_size),
        "contract_months": months,
        "contract_months_note": months_note,
        "contract_months_as_listed_by_amp": row["contract_months_as_listed_by_amp"],
        "in_lake": symbol in LAKE_ROOTS,
        "verification": ["amp_futures"],
        "amp_futures_url": SOURCE_URL,
    }
    if tick_size_currency is not None:
        contract["tick_size_note"] = f"AMP prints the tick with a currency sign ({row['_tick_size']}); it is {tick_size:g} index points"
    if corrections:
        contract["amp_corrections"] = {
            field: {"amp_value": amp_value, "value": value, "reason": reason}
            for field, (amp_value, value, reason) in corrections.items()
        }
    if symbol in CME_GROUP_VERIFIED:
        contract.update(CME_GROUP_VERIFIED[symbol])
        contract["verification"] = ["amp_futures", "cme_group"]
    return contract


def build(raw_html: str, retrieved_on: str) -> dict:
    rows = parse_stock_index_rows(raw_html)
    contracts = [build_contract(row) for row in rows]
    symbols = [contract["symbol"] for contract in contracts]
    if len(set(symbols)) != len(symbols):
        raise ValueError(f"duplicate symbols: {sorted(s for s in symbols if symbols.count(s) > 1)}")
    missing_lake = LAKE_ROOTS - set(symbols)
    if missing_lake:
        raise ValueError(f"lake roots missing from the AMP page: {sorted(missing_lake)}")
    unused_cme = set(CME_GROUP_VERIFIED) - set(symbols)
    if unused_cme:
        raise ValueError(f"CME_GROUP_VERIFIED has symbols the page does not list: {sorted(unused_cme)}")
    return {
        "$comment": (
            "Stock-index futures contract specifications. Built by scripts/build_contract_specifications.py "
            "from AMP Futures' contract-specifications page; CME / CBOT rows carry the fields CME Group's own "
            "contract-specs pages state. Read by scripts/seed-instruments.ts (the SQLite instruments table), "
            "src/client/src/market/components/chartConfig.ts (chart tick labels) and "
            "notebooks/contract_specifications.py. Every number the simulators use for USD P&L "
            "(src/config/cost_model.json) must agree with this file; tests/test_contract_specifications.py checks."
        ),
        "source_url": SOURCE_URL,
        "retrieved_on": retrieved_on,
        "sections_read": list(SECTION_TO_PRODUCT_GROUP),
        "lake_roots": sorted(LAKE_ROOTS),
        "month_codes": MONTH_CODES,
        "cme_equity_index_roll_date": CME_EQUITY_INDEX_ROLL_DATE,
        "e_nano_futures": E_NANO_FUTURES,
        "contract_count": len(contracts),
        "contracts": contracts,
    }


def fetch_page() -> str:
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8", errors="replace")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--html", type=Path, help="parse a saved copy of the page instead of fetching it")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--retrieved-on", default=date.today().isoformat())
    parser.add_argument("--check", action="store_true", help="exit 1 if the output file would change")
    args = parser.parse_args(argv)

    raw_html = args.html.read_text(encoding="utf-8", errors="replace") if args.html else fetch_page()
    document = build(raw_html, args.retrieved_on)
    rendered = json.dumps(document, indent=2, ensure_ascii=False) + "\n"

    if args.check:
        current = args.output.read_text(encoding="utf-8") if args.output.exists() else ""
        current_document = json.loads(current) if current else {}
        # retrieved_on legitimately differs between runs; compare everything else.
        same = {**current_document, "retrieved_on": None} == {**document, "retrieved_on": None}
        print(f"{'unchanged' if same else 'CHANGED'}: {args.output}")
        return 0 if same else 1

    args.output.write_text(rendered, encoding="utf-8")
    verified = sum("cme_group" in c["verification"] for c in document["contracts"])
    print(f"wrote {args.output} : {document['contract_count']} contracts, {verified} CME-verified, "
          f"{sum(c['in_lake'] for c in document['contracts'])} in the lake")
    return 0


if __name__ == "__main__":
    sys.exit(main())
