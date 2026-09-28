"""FinBERT news sentiment is in every model the dashboard trains — the gate.

Tyler's rule (2026-09-27): FinBERT is part of every trading model, whatever the
family, experimental ones included. The family is computed in one place
(``lake.sentiment``, via ``shared.sentiment``) and reaches models by three
paths; each is pinned here so a new trainer, a pinned category list or a
refactor cannot quietly train without it:

1. ``shared.features.compute_features`` — every hand-written and generated
   trainer. It appends the family whatever ``categories`` says and raises
   without the symbol and bar timestamps it needs.
2. The Model Cycle — every registry model runs ``src/ml/cycle/main.py``, which
   builds features with a ``MarketContext`` and calls ``require_finbert``.
3. Every runner in ``runners.json`` either runs one of the above, or names
   how the family reaches it — or its script is not on this machine.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path

import numpy as np
import pytest

REPO = Path(__file__).resolve().parents[1]
ML = REPO / "src" / "ml"


@pytest.fixture()
def no_news(monkeypatch):
    """No lake access: every symbol has no articles and no coverage."""
    from lake import sentiment as impl

    monkeypatch.setattr(impl, "load_stream", lambda root, start, end: impl.ArticleStream.empty())
    return impl


def _ohlcv(n=400, seed=7):
    rng = np.random.default_rng(seed)
    close = 100 + np.cumsum(rng.normal(0, 0.2, n))
    high = close + rng.uniform(0.01, 0.3, n)
    low = close - rng.uniform(0.01, 0.3, n)
    open_ = np.r_[close[0], close[:-1]]
    volume = rng.uniform(100, 1000, n)
    stamps = 1_750_000_000 + 60 * np.arange(n)
    return open_, high, low, close, volume, stamps


def _pinned_category_lists() -> list[list[str] | None]:
    lists: list[list[str] | None] = [None, ["returns"]]
    for path in ("runners.json", "models.json"):
        data = json.loads((REPO / "src" / "config" / path).read_text(encoding="utf-8"))
        entries = data.get("runners") or data.get("models") or {}
        for entry in entries.values():
            categories = entry.get("featureCategories") if isinstance(entry, dict) else None
            if categories:
                lists.append(list(categories))
    return lists


# ── path 1: compute_features ─────────────────────────────────────────────


@pytest.mark.parametrize("categories", _pinned_category_lists(), ids=lambda c: "all" if c is None else ",".join(c))
def test_compute_features_always_appends_the_family(categories, no_news):
    from shared.features import compute_features
    from shared.sentiment import FEATURE_NAMES

    open_, high, low, close, volume, stamps = _ohlcv()
    data = {"open_": open_, "high": high, "low": low, "close": close, "volume": volume,
            "symbol": "MNQ", "timeframe": "1m", "timestamp": stamps, "clock": "UTC"}
    matrix, names, _ = compute_features(data, categories=categories, n_jobs=1)
    assert [n for n in names if n.startswith("finbert_")] == list(FEATURE_NAMES)
    assert matrix.shape == (len(stamps), len(names))
    assert np.isfinite(matrix[:, -len(FEATURE_NAMES):]).all()


def test_compute_features_refuses_a_caller_without_bar_identity(no_news):
    from shared.features import compute_features

    open_, high, low, close, volume, _ = _ohlcv()
    with pytest.raises(ValueError, match="FinBERT"):
        compute_features({"open_": open_, "high": high, "low": low, "close": close, "volume": volume})


def _trainer_sources() -> list[Path]:
    sources = sorted(ML.glob("*/main.py")) + sorted(ML.glob("*/hpo_main.py"))
    sources += [ML / "shared" / "hpo_runner.py", REPO / "src" / "templates" / "architectures" / "_base.py.j2"]
    return [p for p in sources if p.exists() and p.parent.name != "cycle"]


@pytest.mark.parametrize("path", _trainer_sources(), ids=lambda p: str(p.relative_to(REPO)))
def test_every_trainer_passes_the_bars_identity(path):
    """A trainer that calls compute_features passes feature_context(raw) (or the
    loader's dict, which carries it); none calls the OHLCV-only engine."""
    text = path.read_text(encoding="utf-8")
    assert "compute_base_features" not in text, "only the Model Cycle may call the OHLCV-only engine"
    for call in re.finditer(r"compute_features\((?P<args>[^)]*)\)", text):
        args = call.group("args")
        if "def " in text[max(0, call.start() - 4):call.start()]:
            continue
        assert "feature_context(" in args or re.search(r"\b(raw|bars|data)\b", args), (
            f"{path.name}: compute_features({args}) does not pass the symbol, timestamps and clock"
        )


def test_only_the_cycle_calls_the_ohlcv_only_engine():
    offenders = [
        str(p.relative_to(REPO)) for p in ML.rglob("*.py")
        if "compute_base_features" in p.read_text(encoding="utf-8")
        and p.relative_to(ML).as_posix() not in ("shared/features.py", "cycle/features.py")
    ]
    assert offenders == []


# ── path 2: the Model Cycle ──────────────────────────────────────────────


def test_cycle_main_builds_with_context_and_requires_the_family():
    tree = ast.parse((ML / "cycle" / "main.py").read_text(encoding="utf-8"))
    calls = {
        (node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, "attr", "")): node
        for node in ast.walk(tree) if isinstance(node, ast.Call)
    }
    assert "require_finbert" in calls
    build = calls["build_features"]
    assert any(k.arg == "context" for k in build.keywords), "build_features must receive context="


def _cycle_keys() -> list[str]:
    from cycle.catalog import runnable_keys

    return list(runnable_keys())


def test_every_cycle_model_runs_the_cycle_entry_point():
    template = json.loads((REPO / "src" / "config" / "cycle_models" / "_cycle.json").read_text(encoding="utf-8"))
    assert template["runnerTemplate"]["script"] == "src/ml/cycle/main.py"


@pytest.mark.parametrize("model_key", _cycle_keys())
def test_no_cycle_model_overrides_the_entry_point(model_key):
    from cycle.catalog import entry

    record = entry(model_key)
    assert "script" not in record and "runnerTemplate" not in record, (
        f"{model_key} names its own script — it would skip cycle/main.py and its FinBERT requirement"
    )


def test_build_features_appends_the_family_after_the_zscore_and_never_drops_it(no_news):
    from cycle.features import FeatureSet, MarketContext, build_features, require_finbert
    from shared.sentiment import FEATURE_NAMES

    open_, high, low, close, volume, stamps = _ohlcv(n=600)
    ohlcv = {"open": open_, "high": high, "low": low, "close": close, "volume": volume}
    with_family = build_features(ohlcv, check_causality=False,
                                 context=MarketContext("MNQ", "1m", stamps, "UTC"))
    require_finbert(with_family)
    tail = with_family.names[-len(FEATURE_NAMES):]
    assert tail == list(FEATURE_NAMES)                          # appended last, after the z-scored block
    assert not any(n.startswith("finbert_") for n in with_family.dropped)   # constant here, and still kept
    with pytest.raises(ValueError, match="FinBERT"):
        require_finbert(build_features(ohlcv, check_causality=False))
    with pytest.raises(ValueError, match="FinBERT"):
        require_finbert(FeatureSet(np.zeros((3, 1), np.float32), ["return_1"]))


# ── path 3: every runner the dashboard can launch ────────────────────────

# Runners whose script is not a dashboard trainer, and how FinBERT reaches them.
EXTERNAL = {
    "online_rls_mtf+online_direction_skill": "lake.sentiment",   # Trading/quant appends the family itself
}


def _runners() -> list[tuple[str, dict]]:
    data = json.loads((REPO / "src" / "config" / "runners.json").read_text(encoding="utf-8"))
    return sorted(data["runners"].items())


@pytest.mark.parametrize("key,runner", _runners(), ids=[k for k, _ in _runners()])
def test_every_runner_reaches_finbert(key, runner):
    script = Path(runner["script"])
    path = script if script.is_absolute() else REPO / script
    if not path.exists():
        pytest.skip(f"{key}: {runner['script']} is not on this machine, so it cannot train anything")
    text = path.read_text(encoding="utf-8")
    if key in EXTERNAL:
        assert EXTERNAL[key] in text, f"{key} must take the family from {EXTERNAL[key]}"
        return
    wrapped = re.search(r"subprocess\.(call|run|Popen)", text) and "compute_features" not in text
    if wrapped:
        targets = [Path(t) for t in re.findall(r'r"([A-Za-z]:\\[^"]+)"', text)]
        if targets and not any(t.exists() for t in targets):
            pytest.skip(f"{key}: wraps {', '.join(map(str, targets))}, which is not on this machine")
        pytest.fail(f"{key}: {runner['script']} hands training to another program that never sees FinBERT")
    assert "compute_features" in text or "load_features_with_cache" in text, (
        f"{key}: {runner['script']} does not use the shared feature engine"
    )
