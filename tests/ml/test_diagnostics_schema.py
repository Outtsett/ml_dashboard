"""Tests for shared.diagnostics_schema — Pydantic models for self-describing diagnostics."""

import importlib
import pathlib

import numpy as np
import pytest
from pydantic import ValidationError

# tests/ml/shared/ shadows src/ml/shared in pytest's import resolution.
# Use importlib.util to load the production module by absolute path.
_schema_path = pathlib.Path(__file__).resolve().parent.parent.parent / "src" / "ml" / "shared" / "diagnostics_schema.py"
_spec = importlib.util.spec_from_file_location("shared.diagnostics_schema", _schema_path)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

ArchitectureInfo = _mod.ArchitectureInfo
MetricContext = _mod.MetricContext
MetricDeclaration = _mod.MetricDeclaration
SelfDescribingDiagnostics = _mod.SelfDescribingDiagnostics
TrainingMetadata = _mod.TrainingMetadata
validate_diagnostics = _mod.validate_diagnostics


# ── Fixtures ──────────────────────────────────────────────────────────────────


def _cnn_transformer_diagnostics() -> dict:
    """Realistic CNN-Transformer diagnostics dict matching production output."""
    return {
        "model_type": "cnn-transformer",
        "model_label": "CNN+Transformer v2",
        "symbol": "MNQ",
        "timeframe": "5m",
        "metrics": {
            "profit_factor": {
                "value": 1.85,
                "renderer": "gauge",
                "mission": "Is this model profitable after costs?",
                "context": {
                    "breakeven": 1.0,
                    "good": 1.5,
                    "great": 2.0,
                    "higher_is_better": True,
                    "decimals": 2,
                },
                "group": "performance",
                "order": 0,
            },
            "sharpe": {
                "value": 1.42,
                "renderer": "number",
                "mission": "Risk-adjusted return quality",
                "context": {
                    "good": 1.0,
                    "great": 2.0,
                    "bad": 0.0,
                    "higher_is_better": True,
                    "decimals": 2,
                },
                "group": "performance",
                "order": 1,
            },
            "accuracy": {
                "value": 0.67,
                "renderer": "percent",
                "mission": "Overall classification accuracy",
                "context": {
                    "baseline": 0.33,
                    "good": 0.55,
                    "great": 0.70,
                    "unit": "%",
                    "higher_is_better": True,
                },
                "group": "quality",
            },
            "class_precision": {
                "value": {"tp": 0.72, "sl": 0.61, "timeout": 0.55},
                "renderer": "precision_bars",
                "mission": "Per-class precision",
                "context": {
                    "baseline": 0.33,
                    "labels": ["tp", "sl", "timeout"],
                    "higher_is_better": True,
                },
                "group": "quality",
            },
            "confusion_matrix": {
                "value": [
                    [120.0, 15.0, 10.0],
                    [20.0, 95.0, 12.0],
                    [8.0, 18.0, 80.0],
                ],
                "renderer": "confusion_matrix",
                "mission": "Where does the model confuse classes?",
                "context": {
                    "labels": ["tp", "sl", "timeout"],
                },
                "group": "quality",
            },
            "fold_accuracies": {
                "value": [0.65, 0.68, 0.64, 0.70, 0.66],
                "renderer": "fold_bars",
                "mission": "Walk-forward fold stability",
                "context": {
                    "baseline": 0.33,
                    "good": 0.55,
                    "higher_is_better": True,
                },
                "group": "stability",
            },
        },
        "training": {
            "duration_sec": 342.5,
            "trained_at": "2026-03-27T10:30:00",
            "n_bars_train": 8000,
            "n_bars_val": 2000,
            "epochs": 50,
            "best_epoch": 38,
        },
        "architecture": {
            "type": "CNN+Transformer",
            "param_count": 1_200_000,
            "window_size": 64,
            "d_model": 128,
            "n_heads": 8,
            "n_layers": 8,
        },
        "convergence": {
            "epochs": [1.0, 2.0, 3.0, 4.0, 5.0],
            "train_loss": [0.95, 0.82, 0.71, 0.65, 0.60],
            "val_loss": [0.98, 0.88, 0.79, 0.74, 0.72],
        },
    }


def _hdp_hmm_diagnostics() -> dict:
    """Realistic HDP-HMM diagnostics dict matching production output."""
    return {
        "model_type": "hdp-hmm",
        "model_label": "HDP-HMM Regime Detector",
        "symbol": "MNQ",
        "timeframe": "5m",
        "metrics": {
            "quality_score": {
                "value": 0.78,
                "renderer": "gauge",
                "mission": "Overall regime model quality",
                "context": {
                    "min": 0.0,
                    "max": 1.0,
                    "bad": 0.3,
                    "good": 0.6,
                    "great": 0.8,
                    "higher_is_better": True,
                    "decimals": 2,
                },
                "group": "quality",
                "order": 0,
            },
            "n_regimes": {
                "value": 5.0,
                "renderer": "number",
                "mission": "Active regime count",
                "context": {
                    "min": 2.0,
                    "max": 20.0,
                    "unit": "regimes",
                    "decimals": 0,
                },
                "group": "structure",
            },
            "silhouette": {
                "value": 0.42,
                "renderer": "number",
                "mission": "Cluster separation quality",
                "context": {
                    "min": -1.0,
                    "max": 1.0,
                    "bad": 0.0,
                    "good": 0.3,
                    "great": 0.5,
                    "higher_is_better": True,
                    "decimals": 3,
                },
                "group": "quality",
            },
            "regime_distribution": {
                "value": {"trending_up": 0.25, "ranging": 0.35, "volatile": 0.20, "trending_down": 0.15, "breakout": 0.05},
                "renderer": "ring",
                "mission": "Time spent in each regime",
                "context": {
                    "labels": ["trending_up", "ranging", "volatile", "trending_down", "breakout"],
                    "unit": "%",
                },
                "group": "structure",
            },
            "transition_matrix": {
                "value": [
                    [0.85, 0.05, 0.05, 0.03, 0.02],
                    [0.04, 0.88, 0.03, 0.03, 0.02],
                    [0.06, 0.04, 0.82, 0.05, 0.03],
                    [0.03, 0.03, 0.06, 0.86, 0.02],
                    [0.10, 0.05, 0.10, 0.05, 0.70],
                ],
                "renderer": "heatmap",
                "mission": "Regime transition probabilities",
                "context": {
                    "min": 0.0,
                    "max": 1.0,
                    "labels": ["trending_up", "ranging", "volatile", "trending_down", "breakout"],
                },
                "group": "structure",
            },
        },
        "training": {
            "duration_sec": 45.2,
            "trained_at": "2026-03-27T09:15:00",
            "n_bars_train": 7500,
            "n_bars_val": 2500,
        },
        "architecture": {
            "type": "HDP-HMM",
            "gibbs_iter": 200,
            "burn_in": 50,
            "alpha": 1.0,
            "gamma": 1.0,
            "kappa": 10.0,
        },
        "convergence": {
            "epochs": [1.0, 50.0, 100.0, 150.0, 200.0],
            "log_likelihood": [-50000.0, -42000.0, -38000.0, -36500.0, -36200.0],
        },
    }


# ── Test: Valid CNN-Transformer diagnostics ───────────────────────────────────


class TestValidCnnTransformer:
    def test_validates_successfully(self):
        data = _cnn_transformer_diagnostics()
        diag = validate_diagnostics(data)
        assert diag.model_type == "cnn-transformer"
        assert diag.symbol == "MNQ"
        assert diag.timeframe == "5m"
        assert len(diag.metrics) == 6

    def test_metric_types_preserved(self):
        diag = validate_diagnostics(_cnn_transformer_diagnostics())
        # scalar
        assert diag.metrics["profit_factor"].value == 1.85
        # dict
        assert diag.metrics["class_precision"].value == {"tp": 0.72, "sl": 0.61, "timeout": 0.55}
        # list[list[float]]
        assert len(diag.metrics["confusion_matrix"].value) == 3
        assert len(diag.metrics["confusion_matrix"].value[0]) == 3
        # list[float]
        assert len(diag.metrics["fold_accuracies"].value) == 5

    def test_training_metadata(self):
        diag = validate_diagnostics(_cnn_transformer_diagnostics())
        assert diag.training.duration_sec == 342.5
        assert diag.training.epochs == 50
        assert diag.training.best_epoch == 38
        assert diag.training.n_bars_train == 8000

    def test_architecture_extra_fields(self):
        diag = validate_diagnostics(_cnn_transformer_diagnostics())
        assert diag.architecture is not None
        assert diag.architecture.type == "CNN+Transformer"
        assert diag.architecture.param_count == 1_200_000
        # Extra fields allowed
        assert diag.architecture.window_size == 64
        assert diag.architecture.d_model == 128

    def test_convergence(self):
        diag = validate_diagnostics(_cnn_transformer_diagnostics())
        assert diag.convergence is not None
        assert "epochs" in diag.convergence
        assert len(diag.convergence["epochs"]) == 5
        assert len(diag.convergence["train_loss"]) == 5


# ── Test: Valid HDP-HMM diagnostics ──────────────────────────────────────────


class TestValidHdpHmm:
    def test_validates_successfully(self):
        data = _hdp_hmm_diagnostics()
        diag = validate_diagnostics(data)
        assert diag.model_type == "hdp-hmm"
        assert diag.symbol == "MNQ"
        assert len(diag.metrics) == 5

    def test_ring_and_heatmap_renderers(self):
        diag = validate_diagnostics(_hdp_hmm_diagnostics())
        assert diag.metrics["regime_distribution"].renderer == "ring"
        assert diag.metrics["transition_matrix"].renderer == "heatmap"

    def test_architecture_without_param_count(self):
        diag = validate_diagnostics(_hdp_hmm_diagnostics())
        assert diag.architecture is not None
        assert diag.architecture.param_count is None
        assert diag.architecture.gibbs_iter == 200


# ── Test: Missing required fields ─────────────────────────────────────────────


class TestMissingRequiredFields:
    def test_missing_model_type(self):
        data = _cnn_transformer_diagnostics()
        del data["model_type"]
        with pytest.raises(ValidationError) as exc_info:
            validate_diagnostics(data)
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("model_type",) for e in errors)

    def test_missing_symbol(self):
        data = _cnn_transformer_diagnostics()
        del data["symbol"]
        with pytest.raises(ValidationError) as exc_info:
            validate_diagnostics(data)
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("symbol",) for e in errors)

    def test_missing_metrics(self):
        data = _cnn_transformer_diagnostics()
        del data["metrics"]
        with pytest.raises(ValidationError) as exc_info:
            validate_diagnostics(data)
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("metrics",) for e in errors)

    def test_missing_training(self):
        data = _cnn_transformer_diagnostics()
        del data["training"]
        with pytest.raises(ValidationError) as exc_info:
            validate_diagnostics(data)
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("training",) for e in errors)

    def test_missing_metric_mission(self):
        data = _cnn_transformer_diagnostics()
        del data["metrics"]["profit_factor"]["mission"]
        with pytest.raises(ValidationError) as exc_info:
            validate_diagnostics(data)
        errors = exc_info.value.errors()
        assert any("mission" in str(e["loc"]) for e in errors)

    def test_missing_metric_renderer(self):
        data = _cnn_transformer_diagnostics()
        del data["metrics"]["profit_factor"]["renderer"]
        with pytest.raises(ValidationError) as exc_info:
            validate_diagnostics(data)
        errors = exc_info.value.errors()
        assert any("renderer" in str(e["loc"]) for e in errors)

    def test_missing_metric_context(self):
        data = _cnn_transformer_diagnostics()
        del data["metrics"]["profit_factor"]["context"]
        with pytest.raises(ValidationError) as exc_info:
            validate_diagnostics(data)
        errors = exc_info.value.errors()
        assert any("context" in str(e["loc"]) for e in errors)

    def test_missing_training_duration(self):
        data = _cnn_transformer_diagnostics()
        del data["training"]["duration_sec"]
        with pytest.raises(ValidationError) as exc_info:
            validate_diagnostics(data)
        errors = exc_info.value.errors()
        assert any("duration_sec" in str(e["loc"]) for e in errors)

    def test_missing_training_trained_at(self):
        data = _cnn_transformer_diagnostics()
        del data["training"]["trained_at"]
        with pytest.raises(ValidationError) as exc_info:
            validate_diagnostics(data)
        errors = exc_info.value.errors()
        assert any("trained_at" in str(e["loc"]) for e in errors)


# ── Test: Invalid renderer type ───────────────────────────────────────────────


class TestInvalidRendererType:
    def test_unknown_renderer_raises(self):
        data = _cnn_transformer_diagnostics()
        data["metrics"]["profit_factor"]["renderer"] = "sparkline"
        with pytest.raises(ValidationError) as exc_info:
            validate_diagnostics(data)
        errors = exc_info.value.errors()
        assert any("renderer" in str(e["loc"]) for e in errors)

    def test_empty_renderer_raises(self):
        data = _cnn_transformer_diagnostics()
        data["metrics"]["profit_factor"]["renderer"] = ""
        with pytest.raises(ValidationError) as exc_info:
            validate_diagnostics(data)
        errors = exc_info.value.errors()
        assert any("renderer" in str(e["loc"]) for e in errors)

    def test_all_valid_renderers_accepted(self):
        valid_renderers = [
            "gauge", "number", "percent", "bars", "precision_bars",
            "confusion_matrix", "fold_bars", "chart_overlay", "time_series",
            "heatmap", "distribution", "table", "ring", "text",
        ]
        data = _cnn_transformer_diagnostics()
        for renderer in valid_renderers:
            data["metrics"]["profit_factor"]["renderer"] = renderer
            diag = validate_diagnostics(data)
            assert diag.metrics["profit_factor"].renderer == renderer


# ── Test: Metric value type mismatches ────────────────────────────────────────


class TestMetricValueTypeMismatch:
    def test_string_value_raises(self):
        data = _cnn_transformer_diagnostics()
        data["metrics"]["profit_factor"]["value"] = "not_a_number"
        with pytest.raises(ValidationError):
            validate_diagnostics(data)

    def test_nested_string_in_list_raises(self):
        data = _cnn_transformer_diagnostics()
        data["metrics"]["fold_accuracies"]["value"] = [0.65, "bad", 0.64]
        with pytest.raises(ValidationError):
            validate_diagnostics(data)

    def test_dict_with_non_numeric_values_raises(self):
        data = _cnn_transformer_diagnostics()
        data["metrics"]["class_precision"]["value"] = {"tp": "high", "sl": 0.61}
        with pytest.raises(ValidationError):
            validate_diagnostics(data)

    def test_none_value_raises(self):
        data = _cnn_transformer_diagnostics()
        data["metrics"]["profit_factor"]["value"] = None
        with pytest.raises(ValidationError):
            validate_diagnostics(data)

    def test_bool_value_raises(self):
        """Booleans are not valid metric values."""
        data = _cnn_transformer_diagnostics()
        data["metrics"]["profit_factor"]["value"] = True
        # In Python, bool is a subclass of int, which coerces to float.
        # This is acceptable — Pydantic will coerce True -> 1.0.
        diag = validate_diagnostics(data)
        assert diag.metrics["profit_factor"].value == 1.0


# ── Test: Numpy type coercion ─────────────────────────────────────────────────


class TestNumpyCoercion:
    def test_numpy_float_in_value(self):
        data = _cnn_transformer_diagnostics()
        data["metrics"]["profit_factor"]["value"] = np.float64(1.85)
        diag = validate_diagnostics(data)
        assert diag.metrics["profit_factor"].value == 1.85
        assert isinstance(diag.metrics["profit_factor"].value, float)

    def test_numpy_int_in_training(self):
        data = _cnn_transformer_diagnostics()
        data["training"]["epochs"] = np.int32(50)
        data["training"]["n_bars_train"] = np.int64(8000)
        diag = validate_diagnostics(data)
        assert diag.training.epochs == 50
        assert diag.training.n_bars_train == 8000

    def test_numpy_array_as_value(self):
        data = _cnn_transformer_diagnostics()
        data["metrics"]["fold_accuracies"]["value"] = np.array([0.65, 0.68, 0.64, 0.70, 0.66])
        diag = validate_diagnostics(data)
        assert diag.metrics["fold_accuracies"].value == [0.65, 0.68, 0.64, 0.70, 0.66]

    def test_numpy_2d_array_as_value(self):
        data = _cnn_transformer_diagnostics()
        data["metrics"]["confusion_matrix"]["value"] = np.array([
            [120, 15, 10],
            [20, 95, 12],
            [8, 18, 80],
        ], dtype=np.float64)
        diag = validate_diagnostics(data)
        assert len(diag.metrics["confusion_matrix"].value) == 3
        assert diag.metrics["confusion_matrix"].value[0][0] == 120.0

    def test_numpy_bool_in_context(self):
        data = _cnn_transformer_diagnostics()
        data["metrics"]["profit_factor"]["context"]["higher_is_better"] = np.bool_(True)
        diag = validate_diagnostics(data)
        assert diag.metrics["profit_factor"].context.higher_is_better is True

    def test_numpy_in_convergence(self):
        data = _cnn_transformer_diagnostics()
        data["convergence"]["epochs"] = np.arange(1, 6, dtype=np.float64)
        data["convergence"]["train_loss"] = np.array([0.95, 0.82, 0.71, 0.65, 0.60])
        diag = validate_diagnostics(data)
        assert diag.convergence["epochs"] == [1.0, 2.0, 3.0, 4.0, 5.0]


# ── Test: Round-trip serialization ────────────────────────────────────────────


class TestRoundTrip:
    def test_dict_validate_to_json_dict_validate(self):
        """dict -> validate -> to_json_dict -> validate again must produce identical output."""
        original = _cnn_transformer_diagnostics()
        diag1 = validate_diagnostics(original)
        json_dict = diag1.to_json_dict()

        # Second validation from the JSON dict
        diag2 = validate_diagnostics(json_dict)

        # Both should produce identical JSON dicts
        assert diag1.to_json_dict() == diag2.to_json_dict()

    def test_round_trip_hdp_hmm(self):
        original = _hdp_hmm_diagnostics()
        diag1 = validate_diagnostics(original)
        json_dict = diag1.to_json_dict()
        diag2 = validate_diagnostics(json_dict)
        assert diag1.to_json_dict() == diag2.to_json_dict()

    def test_to_json_dict_no_numpy_types(self):
        """to_json_dict output must contain zero numpy types."""
        data = _cnn_transformer_diagnostics()
        # Inject numpy types
        data["metrics"]["profit_factor"]["value"] = np.float64(1.85)
        data["training"]["epochs"] = np.int32(50)
        data["convergence"]["epochs"] = np.arange(1, 6, dtype=np.float64)

        diag = validate_diagnostics(data)
        json_dict = diag.to_json_dict()

        _assert_no_numpy(json_dict)

    def test_round_trip_with_numpy_heavy_data(self):
        """Numpy-heavy input must survive round-trip cleanly."""
        data = _cnn_transformer_diagnostics()
        data["metrics"]["fold_accuracies"]["value"] = np.array([0.65, 0.68, 0.64, 0.70, 0.66])
        data["metrics"]["confusion_matrix"]["value"] = np.array([
            [120, 15, 10],
            [20, 95, 12],
            [8, 18, 80],
        ], dtype=np.float64)
        data["training"]["duration_sec"] = np.float64(342.5)
        data["training"]["n_bars_train"] = np.int64(8000)

        diag1 = validate_diagnostics(data)
        json_dict = diag1.to_json_dict()
        _assert_no_numpy(json_dict)

        diag2 = validate_diagnostics(json_dict)
        assert diag1.to_json_dict() == diag2.to_json_dict()


# ── Test: Convergence validation ──────────────────────────────────────────────


class TestConvergenceValidation:
    def test_convergence_without_epochs_key_raises(self):
        data = _cnn_transformer_diagnostics()
        data["convergence"] = {
            "train_loss": [0.95, 0.82, 0.71],
            "val_loss": [0.98, 0.88, 0.79],
        }
        with pytest.raises(ValidationError) as exc_info:
            validate_diagnostics(data)
        assert "epochs" in str(exc_info.value)

    def test_convergence_none_is_valid(self):
        data = _cnn_transformer_diagnostics()
        data["convergence"] = None
        diag = validate_diagnostics(data)
        assert diag.convergence is None

    def test_convergence_absent_is_valid(self):
        data = _cnn_transformer_diagnostics()
        del data["convergence"]
        diag = validate_diagnostics(data)
        assert diag.convergence is None


# ── Test: Optional fields ─────────────────────────────────────────────────────


class TestOptionalFields:
    def test_minimal_valid_diagnostics(self):
        """Absolute minimum required fields."""
        data = {
            "model_type": "test",
            "symbol": "MNQ",
            "timeframe": "1m",
            "metrics": {
                "score": {
                    "value": 0.5,
                    "renderer": "number",
                    "mission": "Test metric",
                    "context": {},
                }
            },
            "training": {
                "duration_sec": 10.0,
                "trained_at": "2026-01-01T00:00:00",
            },
        }
        diag = validate_diagnostics(data)
        assert diag.model_type == "test"
        assert diag.model_label is None
        assert diag.architecture is None
        assert diag.convergence is None
        assert diag.extra is None

    def test_extra_dict_preserved(self):
        data = _cnn_transformer_diagnostics()
        data["extra"] = {"custom_key": "custom_value", "nested": {"a": 1}}
        diag = validate_diagnostics(data)
        assert diag.extra["custom_key"] == "custom_value"
        assert diag.extra["nested"]["a"] == 1

    def test_empty_metrics_dict_valid(self):
        data = {
            "model_type": "test",
            "symbol": "MNQ",
            "timeframe": "1m",
            "metrics": {},
            "training": {
                "duration_sec": 1.0,
                "trained_at": "2026-01-01T00:00:00",
            },
        }
        diag = validate_diagnostics(data)
        assert len(diag.metrics) == 0


# ── Test: Integer coercion ────────────────────────────────────────────────────


class TestIntegerCoercion:
    def test_int_value_coerced_to_float(self):
        data = _cnn_transformer_diagnostics()
        data["metrics"]["profit_factor"]["value"] = 2
        diag = validate_diagnostics(data)
        assert diag.metrics["profit_factor"].value == 2.0
        assert isinstance(diag.metrics["profit_factor"].value, float)

    def test_int_list_coerced_to_float_list(self):
        data = _cnn_transformer_diagnostics()
        data["metrics"]["fold_accuracies"]["value"] = [1, 2, 3, 4, 5]
        diag = validate_diagnostics(data)
        assert diag.metrics["fold_accuracies"].value == [1.0, 2.0, 3.0, 4.0, 5.0]


# ── Helpers ───────────────────────────────────────────────────────────────────


def _assert_no_numpy(obj, path="root"):
    """Recursively assert no numpy types exist in a nested dict/list structure."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            _assert_no_numpy(v, path=f"{path}.{k}")
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            _assert_no_numpy(v, path=f"{path}[{i}]")
    else:
        assert not isinstance(obj, (np.generic, np.ndarray)), (
            f"Found numpy type {type(obj).__name__} at {path}"
        )
