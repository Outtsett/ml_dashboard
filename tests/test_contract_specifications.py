"""``src/config/contract_specifications.json`` is reproducible from the AMP page and agrees with the cost model.

The builder is run on the saved copy of AMP Futures' contract-specifications page
(``tests/fixtures/amp_contract_specifications_2026-09-25.html``) and must produce the committed
file byte for byte (apart from the retrieval date). Every row must be internally consistent
(tick value = tick size × multiplier), and ``cost_model.json`` — the file the trade simulators
price with — must carry the same tick size, tick value and point value for every symbol it lists.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_contract_specifications as builder  # noqa: E402

SPECIFICATION_PATH = ROOT / "src" / "config" / "contract_specifications.json"
COST_MODEL_PATH = ROOT / "src" / "config" / "cost_model.json"
FIXTURE_PATH = ROOT / "tests" / "fixtures" / "amp_contract_specifications_2026-09-25.html"

DOCUMENT = json.loads(SPECIFICATION_PATH.read_text(encoding="utf-8"))
CONTRACTS = {contract["symbol"]: contract for contract in DOCUMENT["contracts"]}
LAKE_ROOTS = {"ES", "NQ", "YM", "RTY", "MES", "MNQ", "MYM", "M2K"}


def test_builder_reproduces_the_committed_file():
    built = builder.build(FIXTURE_PATH.read_text(encoding="utf-8", errors="replace"), DOCUMENT["retrieved_on"])
    assert built == DOCUMENT


def test_contract_count_and_unique_symbols():
    assert DOCUMENT["contract_count"] == len(DOCUMENT["contracts"]) == 42
    assert len(CONTRACTS) == 42


@pytest.mark.parametrize("symbol", sorted(CONTRACTS))
def test_tick_value_is_tick_size_times_multiplier(symbol):
    contract = CONTRACTS[symbol]
    assert contract["tick_size_index_points"] > 0
    assert contract["contract_multiplier_per_index_point"] > 0
    assert contract["tick_size_index_points"] * contract["contract_multiplier_per_index_point"] == pytest.approx(
        contract["tick_value_per_contract"], abs=1e-9
    )


@pytest.mark.parametrize("symbol", sorted(CONTRACTS))
def test_price_decimal_places_fit_the_tick(symbol):
    contract = CONTRACTS[symbol]
    tick = contract["tick_size_index_points"]
    decimals = contract["price_decimal_places"]
    assert round(tick, decimals) == tick
    if decimals:
        assert round(tick, decimals - 1) != tick


def test_lake_roots_are_flagged_and_cme_verified():
    assert {symbol for symbol, contract in CONTRACTS.items() if contract["in_lake"]} == LAKE_ROOTS
    assert set(DOCUMENT["lake_roots"]) == LAKE_ROOTS
    for symbol in LAKE_ROOTS:
        contract = CONTRACTS[symbol]
        assert contract["verification"] == ["amp_futures", "cme_group"]
        assert contract["globex_code"] == symbol
        assert contract["currency"] == "USD"
        assert contract["contract_months"] == ["H", "M", "U", "Z"]
        assert "4:00 p.m. - 5:00 p.m. CT" in contract["trading_hours_central_time"]
        assert "3rd friday" in contract["last_trading_day"].lower()
        assert contract["cme_group_url"].startswith("https://www.cmegroup.com/markets/equities/")
        assert contract["exchange_rulebook"].startswith("CBOT" if symbol in {"YM", "MYM"} else "CME")


def test_cme_roll_date_rule_matches_the_lake():
    rule = DOCUMENT["cme_equity_index_roll_date"]
    assert "Monday prior to the third Friday" in rule["rule"]
    assert rule["source_url"].startswith("https://www.cmegroup.com/")


def test_every_amp_correction_states_its_reason():
    corrected = {symbol: contract["amp_corrections"] for symbol, contract in CONTRACTS.items() if "amp_corrections" in contract}
    assert set(corrected) == set(builder.AMP_CORRECTIONS)
    for symbol, fields in corrected.items():
        for field, correction in fields.items():
            assert correction["amp_value"] != correction["value"], (symbol, field)
            assert len(correction["reason"]) > 40, (symbol, field)


def test_cost_model_agrees_with_the_specification():
    cost_model = json.loads(COST_MODEL_PATH.read_text(encoding="utf-8"))
    assert cost_model, "cost_model.json prices no symbol"
    for symbol, entry in cost_model.items():
        contract = CONTRACTS[symbol]
        assert entry["tick_size"] == contract["tick_size_index_points"], symbol
        assert entry["tick_value"] == contract["tick_value_per_contract"], symbol
        assert entry["point_value"] == contract["contract_multiplier_per_index_point"], symbol
