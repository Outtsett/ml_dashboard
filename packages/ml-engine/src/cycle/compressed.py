"""Compressed files beside a run's artifacts.

Every file the engine writes next to a run is zstandard-compressed
(``*.zst``, level 3). Measured 2026-10-07: JSON surfaces 112x, terminal
lines 53x, int64/float64 series 2-4x, float32 feature matrices 1.06x (near
incompressible, kept for one convention; a 4 MB matrix reads in 6 ms). Readers accept the compressed name first and the plain name
second, so runs recorded before 2026-10-07 still open.
"""
from __future__ import annotations

import io
import json
import os

import numpy as np
import zstandard

LEVEL = 3
SUFFIX = ".zst"


def write_bytes(path: str, payload: bytes) -> str:
    """Write ``payload`` zstandard-compressed to ``path + '.zst'`` atomically; returns the path written."""
    target = path if path.endswith(SUFFIX) else path + SUFFIX
    temporary = target + ".tmp"
    with open(temporary, "wb") as handle:
        handle.write(zstandard.ZstdCompressor(level=LEVEL).compress(payload))
    os.replace(temporary, target)
    # a plain copy from an older write would shadow nothing, but it would waste the space
    plain = target[: -len(SUFFIX)]
    if os.path.isfile(plain):
        os.remove(plain)
    return target


def read_bytes(path: str) -> bytes:
    """Read ``path`` (plain or ``.zst``), trying the compressed name first."""
    compressed = path if path.endswith(SUFFIX) else path + SUFFIX
    if os.path.isfile(compressed):
        with open(compressed, "rb") as handle:
            # the frame carries its content size (written whole), so one-shot decompression applies
            return zstandard.ZstdDecompressor().decompress(handle.read())
    plain = path[: -len(SUFFIX)] if path.endswith(SUFFIX) else path
    with open(plain, "rb") as handle:
        return handle.read()


def exists(path: str) -> bool:
    compressed = path if path.endswith(SUFFIX) else path + SUFFIX
    plain = path[: -len(SUFFIX)] if path.endswith(SUFFIX) else path
    return os.path.isfile(compressed) or os.path.isfile(plain)


def mtime(path: str) -> float | None:
    compressed = path if path.endswith(SUFFIX) else path + SUFFIX
    plain = path[: -len(SUFFIX)] if path.endswith(SUFFIX) else path
    for candidate in (compressed, plain):
        try:
            return os.path.getmtime(candidate)
        except OSError:
            continue
    return None


def write_json(path: str, value) -> str:
    return write_bytes(path, json.dumps(value).encode("utf-8"))


def read_json(path: str):
    return json.loads(read_bytes(path).decode("utf-8"))


def write_array(path: str, values: np.ndarray) -> str:
    buffer = io.BytesIO()
    np.save(buffer, values, allow_pickle=False)
    return write_bytes(path, buffer.getvalue())


def read_array(path: str) -> np.ndarray:
    return np.load(io.BytesIO(read_bytes(path)), allow_pickle=False)
