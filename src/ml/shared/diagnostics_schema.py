"""
Self-Describing Diagnostics Schema — Pydantic models.

Mirrors the TypeScript schema at src/client/src/lib/diagnostics-schema.ts exactly.
Models declare their own metrics with renderer hints, mission context, and display
thresholds. The dashboard renders whatever the model emits.

Usage:
    from shared.diagnostics_schema import SelfDescribingDiagnostics, validate_diagnostics

    diag = validate_diagnostics(raw_dict)   # raises ValidationError if invalid
    json_dict = diag.to_json_dict()         # numpy-safe dict for JSON serialization
"""

import math
from typing import Any, Literal, Union

import numpy as np
from pydantic import BaseModel, field_validator, model_validator

# ── Renderer Types ───────────────────────────────────────────────────────────

RendererType = Literal[
    "gauge",
    "number",
    "percent",
    "bars",
    "precision_bars",
    "confusion_matrix",
    "fold_bars",
    "chart_overlay",
    "time_series",
    "heatmap",
    "distribution",
    "table",
    "ring",
    "text",
]


# ── Numpy-safe serialization ────────────────────────────────────────────────

def _numpy_safe(obj: Any) -> Any:
    """Recursively convert numpy types to native Python types for JSON."""
    if isinstance(obj, dict):
        return {k: _numpy_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_numpy_safe(item) for item in obj]
    if isinstance(obj, np.ndarray):
        return _numpy_safe(obj.tolist())
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        val = float(obj)
        if math.isnan(val):
            return None
        return val
    if isinstance(obj, np.generic):
        return obj.item()
    if hasattr(np, "bool_") and isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, float) and math.isnan(obj):
        return None
    return obj


def _coerce_numpy(v: Any) -> Any:
    """Coerce numpy scalars/arrays to native Python types before Pydantic validation."""
    if isinstance(v, np.ndarray):
        return v.tolist()
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    if hasattr(np, "bool_") and isinstance(v, np.bool_):
        return bool(v)
    if isinstance(v, np.generic):
        return v.item()
    if isinstance(v, dict):
        return {k: _coerce_numpy(val) for k, val in v.items()}
    if isinstance(v, (list, tuple)):
        return [_coerce_numpy(item) for item in v]
    return v


# ── Metric Context ───────────────────────────────────────────────────────────

class MetricContext(BaseModel):
    """Thresholds that define what good/bad/neutral looks like for a metric."""

    min: float | None = None
    max: float | None = None
    bad: float | None = None
    good: float | None = None
    great: float | None = None
    breakeven: float | None = None
    baseline: float | None = None
    unit: str | None = None
    decimals: int | None = None
    higher_is_better: bool | None = None
    labels: list[str] | None = None
    data_source: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _coerce_numpy_values(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return _coerce_numpy(data)
        return data


# ── Metric Value Type ────────────────────────────────────────────────────────

# number | Record<string, number> | number[] | number[][]
MetricValue = Union[float, dict[str, float], list[float], list[list[float]]]


# ── Metric Declaration ───────────────────────────────────────────────────────

class MetricDeclaration(BaseModel):
    """A single self-describing metric emitted by a trained model."""

    value: MetricValue
    renderer: RendererType
    mission: str
    context: MetricContext
    group: str | None = None
    order: int | None = None

    @field_validator("value", mode="before")
    @classmethod
    def _coerce_value(cls, v: Any) -> Any:
        return _coerce_numpy(v)

    @field_validator("value")
    @classmethod
    def _validate_value_type(cls, v: Any) -> MetricValue:
        """Ensure value is one of the allowed types: float, dict[str,float], list[float], list[list[float]]."""
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, dict):
            for k, val in v.items():
                if not isinstance(k, str):
                    raise ValueError(f"Metric value dict keys must be strings, got {type(k).__name__}")
                if not isinstance(val, (int, float)):
                    raise ValueError(
                        f"Metric value dict values must be numbers, got {type(val).__name__} for key '{k}'"
                    )
            return {k: float(val) for k, val in v.items()}
        if isinstance(v, list):
            if len(v) == 0:
                return v
            # list[list[float]] — nested matrix (confusion matrix, heatmap)
            if isinstance(v[0], list):
                for i, row in enumerate(v):
                    if not isinstance(row, list):
                        raise ValueError(f"Nested metric value row {i} must be a list, got {type(row).__name__}")
                    for j, val in enumerate(row):
                        if not isinstance(val, (int, float)):
                            raise ValueError(
                                f"Nested metric value[{i}][{j}] must be a number, got {type(val).__name__}"
                            )
                return [[float(val) for val in row] for row in v]
            # list[float]
            for i, val in enumerate(v):
                if not isinstance(val, (int, float)):
                    raise ValueError(f"Metric value list[{i}] must be a number, got {type(val).__name__}")
            return [float(val) for val in v]
        raise ValueError(
            f"Metric value must be float, dict[str,float], list[float], or list[list[float]], got {type(v).__name__}"
        )


# ── Training Metadata ────────────────────────────────────────────────────────

class TrainingMetadata(BaseModel):
    """Training metadata for timing and data split info."""

    duration_sec: float
    trained_at: str
    n_bars_train: int | None = None
    n_bars_val: int | None = None
    epochs: int | None = None
    best_epoch: int | None = None

    @model_validator(mode="before")
    @classmethod
    def _coerce_numpy_values(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return _coerce_numpy(data)
        return data


# ── Architecture Info ─────────────────────────────────────────────────────────

class ArchitectureInfo(BaseModel):
    """Model architecture info — allows arbitrary extra fields."""

    type: str
    param_count: int | None = None

    model_config = {"extra": "allow"}

    @model_validator(mode="before")
    @classmethod
    def _coerce_numpy_values(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return _coerce_numpy(data)
        return data


# ── Self-Describing Diagnostics ──────────────────────────────────────────────

class SelfDescribingDiagnostics(BaseModel):
    """
    Top-level diagnostics container emitted by any trained model.

    The dashboard renders whatever metrics are declared here — no
    model-type-specific UI code needed.
    """

    model_type: str
    model_label: str | None = None
    symbol: str
    timeframe: str
    metrics: dict[str, MetricDeclaration]
    training: TrainingMetadata
    architecture: ArchitectureInfo | None = None
    convergence: dict[str, list[float]] | None = None
    extra: dict[str, Any] | None = None

    @field_validator("convergence", mode="before")
    @classmethod
    def _coerce_convergence(cls, v: Any) -> Any:
        if v is None:
            return v
        if isinstance(v, dict):
            return {k: _coerce_numpy(val) for k, val in v.items()}
        return v

    @field_validator("convergence")
    @classmethod
    def _validate_convergence_has_epochs(cls, v: dict[str, list[float]] | None) -> dict[str, list[float]] | None:
        """TypeScript schema requires 'epochs' key in convergence dict."""
        if v is not None and "epochs" not in v:
            raise ValueError("convergence dict must contain an 'epochs' key (TypeScript schema requirement)")
        return v

    @field_validator("extra", mode="before")
    @classmethod
    def _coerce_extra(cls, v: Any) -> Any:
        if v is None:
            return v
        if isinstance(v, dict):
            return _numpy_safe(v)
        return v

    def to_json_dict(self) -> dict[str, Any]:
        """Convert to a plain dict safe for JSON serialization.

        Handles numpy scalars, arrays, and NaN values that may have been
        injected after validation (e.g., via extra fields or convergence data).

        Returns
        -------
        dict
            A dict with only native Python types — ready for json.dumps().
        """
        raw = self.model_dump(mode="python")
        return _numpy_safe(raw)


# ── Public Helper ─────────────────────────────────────────────────────────────

def validate_diagnostics(data: dict[str, Any]) -> SelfDescribingDiagnostics:
    """Validate a raw dict against the self-describing diagnostics schema.

    Parameters
    ----------
    data : dict
        Raw diagnostics dict (e.g., loaded from JSON or built in a training script).

    Returns
    -------
    SelfDescribingDiagnostics
        Validated Pydantic model.

    Raises
    ------
    pydantic.ValidationError
        With clear per-field error messages if validation fails.
    """
    return SelfDescribingDiagnostics.model_validate(data)
