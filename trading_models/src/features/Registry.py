"""
Feature registry: the dimension table every engineered market-state flag points at.

Why this exists
---------------
Flags in `features.parquet` are wide columns; the same flags in `events.parquet`
are rows keyed by `feature_id`. Both must agree on one immutable identity per
feature so that:
  * a Postgres `feature_registry` table can be the FK target of the event fact table,
  * a vector DB can carry the bit position as a stable embedding dimension,
  * a re-run years later produces the same IDs (IDs are written by hand, never
    derived from list order, so adding a feature can never renumber old ones).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from enum import Enum

import polars as pl


class FeatureKind(str, Enum):
    """What role a column plays. Only FLAG columns enter the state code."""

    FLAG = "flag"            # Int8 0/1, backward-looking, safe as a model input
    STATE = "state"          # Int8 ternary {-1,0,1}, backward-looking, safe as input
    VALUE = "value"          # continuous indicator value, safe as input
    LABEL = "label"          # forward-looking target. NEVER a model input.


@dataclass(frozen=True)
class FeatureSpec:
    """
    Immutable identity + documentation for one engineered column.

    `feature_id` is the permanent key. `bit` is the position inside the
    `state_code` bitmask (FLAG kind only; None otherwise).
    """

    feature_id: int                      # permanent FK value; never reuse, never renumber
    key: str                             # column name in features.parquet
    family: str                          # grouping, e.g. "macd"
    kind: FeatureKind                    # role of the column
    description: str                     # human-readable definition
    bit: int | None = None               # bitmask slot for FLAG features
    params: dict = field(default_factory=dict)  # hyperparameters that define the feature


class FeatureRegistry:
    """
    Collects FeatureSpecs from every block and enforces the invariants that make
    IDs safe to use as foreign keys: unique ids, unique keys, unique bits, and
    labels kept out of the bitmask (label leakage into model inputs is fatal).
    """

    MAX_BITS = 32  # state_code is UInt32

    def __init__(self) -> None:
        self._specs: dict[int, FeatureSpec] = {}

    def register(self, spec: FeatureSpec) -> None:
        """Add one spec, rejecting any collision with an existing identity."""
        if spec.feature_id in self._specs:
            raise ValueError(f"duplicate feature_id {spec.feature_id} ({spec.key})")
        if any(s.key == spec.key for s in self._specs.values()):
            raise ValueError(f"duplicate feature key {spec.key}")
        if spec.kind is FeatureKind.FLAG:
            if spec.bit is None or not 0 <= spec.bit < self.MAX_BITS:
                raise ValueError(f"flag {spec.key} needs a bit in [0,{self.MAX_BITS})")
            if any(s.bit == spec.bit for s in self._specs.values()):
                raise ValueError(f"duplicate bit {spec.bit} ({spec.key})")
        elif spec.bit is not None:
            # Only backward-looking flags may occupy the bitmask.
            raise ValueError(f"{spec.kind.value} feature {spec.key} must not take a state bit")
        self._specs[spec.feature_id] = spec

    def extend(self, specs: list[FeatureSpec]) -> None:
        """Register a block's specs in one call."""
        for spec in specs:
            self.register(spec)

    @property
    def specs(self) -> list[FeatureSpec]:
        """All specs ordered by feature_id (deterministic output ordering)."""
        return [self._specs[i] for i in sorted(self._specs)]

    def of_kind(self, kind: FeatureKind) -> list[FeatureSpec]:
        """Specs of one kind, ordered by feature_id."""
        return [s for s in self.specs if s.kind is kind]

    def flags_by_bit(self) -> list[FeatureSpec]:
        """FLAG specs ordered by bit: this order IS the state-vector dimension order."""
        return sorted(self.of_kind(FeatureKind.FLAG), key=lambda s: s.bit)

    def to_frame(self) -> pl.DataFrame:
        """Dimension table written to feature_registry.parquet (and loadable into Postgres)."""
        rows = []
        for s in self.specs:
            row = asdict(s)
            row["kind"] = s.kind.value
            row["params"] = json.dumps(s.params, sort_keys=True)  # JSON text: portable to PG jsonb
            rows.append(row)
        return pl.DataFrame(
            rows,
            schema={
                "feature_id": pl.Int16,
                "key": pl.Utf8,
                "family": pl.Utf8,
                "kind": pl.Utf8,
                "description": pl.Utf8,
                "bit": pl.Int8,
                "params": pl.Utf8,
            },
        )
