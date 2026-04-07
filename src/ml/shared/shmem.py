"""
shmem.py — TensionFlow shared memory reader/writer.

Maps the Windows named file mapping "Local\\TensionFlowHub" and provides
typed access to each block defined in tf_layout.h.  All constants mirror
the C header exactly; sizes are verified by static assertions in the C
engine at build time.

Single-writer-per-block rule (from tf_layout.h):
  Metadata       — C engine
  TickRing       — C engine
  DOM            — C engine
  Benchmarks     — Java (MotiveWave)
  Distances      — Python (feature pipeline)
  BucketBlock    — Java (MotiveWave)
  Markov         — Python (HMM model)
  FeatureBlock   — Python (feature pipeline)
  ComponentBlock — Python (PCA/component pipeline)
  DetectionBlock — Python (detection model)
  ScoreBlock     — Python (scoring model)  ← written by ShmemWriter
"""

from __future__ import annotations

import mmap
import struct
import time
from dataclasses import dataclass
from typing import Optional

import numpy as np

# ─── string / magic constants ──────────────────────────────────────────────

SHM_NAME: str = "Local\\TensionFlowHub"
SHM_MAGIC: int = 0x54464C56   # "TFLV" little-endian

# ─── dimension constants (must match tf_layout.h #defines exactly) ─────────

DOM_LEVELS:      int = 60
RAW_FIELDS:      int = 57
COMPONENTS:      int = 15
FEATURE_COUNT:   int = RAW_FIELDS * DOM_LEVELS      # 3420
COMPONENT_COUNT: int = COMPONENTS * DOM_LEVELS       # 900
TICK_RING_CAP:   int = 65536
BENCHMARKS:      int = 15
DISTANCES:       int = 210
BUCKETS:         int = 5
DETECTION_TYPES: int = 6

# ─── block size constants (verified by C static_assert in tf_layout.h) ─────

SZ_METADATA:   int = 256
SZ_TICK:       int = 36
SZ_TICK_RING:  int = TICK_RING_CAP * SZ_TICK           # 65536 * 36 = 2,359,296
SZ_DOM:        int = 1000
SZ_BENCHMARKS: int = 128
SZ_DISTANCES:  int = 848
SZ_BUCKETS:    int = 400
SZ_MARKOV:     int = 80
SZ_FEATURES:   int = RAW_FIELDS * DOM_LEVELS * 4       # 3420 * 4 = 13,680
SZ_COMPONENTS: int = COMPONENTS * DOM_LEVELS * 4        # 900 * 4 = 3,600
SZ_DETECTIONS: int = 96
SZ_SCORE:      int = 64

# ─── block offset constants (chained, matching TF_OFF_* macros) ─────────────

OFF_METADATA:    int = 0
OFF_TICK_RING:   int = OFF_METADATA    + SZ_METADATA    # 256
OFF_DOM:         int = OFF_TICK_RING   + SZ_TICK_RING   # 2,359,552
OFF_BENCHMARKS:  int = OFF_DOM         + SZ_DOM         # 2,360,552
OFF_DISTANCES:   int = OFF_BENCHMARKS  + SZ_BENCHMARKS  # 2,360,680
OFF_BUCKET_BLOCK: int = OFF_DISTANCES  + SZ_DISTANCES   # 2,361,528
OFF_MARKOV:      int = OFF_BUCKET_BLOCK + SZ_BUCKETS    # 2,361,928
OFF_FEATURES:    int = OFF_MARKOV      + SZ_MARKOV      # 2,362,008
OFF_COMPONENTS:  int = OFF_FEATURES    + SZ_FEATURES    # 2,375,688
OFF_DETECTIONS:  int = OFF_COMPONENTS  + SZ_COMPONENTS  # 2,379,288
OFF_SCORE:       int = OFF_DETECTIONS  + SZ_DETECTIONS  # 2,379,384

TOTAL_SIZE: int = OFF_SCORE + SZ_SCORE                  # 2,379,448

# ─── TF_Metadata field offsets (byte positions within the metadata block) ──
# Derived by counting bytes in TF_Metadata struct (packed, no compiler padding):
#   magic(u32:4) + version(u32:4) + session_state(u8:1) + _pad(3:3)
#   = 12 bytes before first sequence counter
#   tick_seq(u64:8)  offs 12
#   dom_seq(u64:8)   offs 20
#   benchmark_seq(u64:8) offs 28
#   feature_seq(u64:8)   offs 36
#   component_seq(u64:8) offs 44
#   score_seq(u64:8)     offs 52

_META_OFF_FEATURE_SEQ:   int = 36
_META_OFF_COMPONENT_SEQ: int = 44
_META_OFF_SCORE_SEQ:     int = 52

# ─── TF_ScoreBlock field layout (within score block, relative to OFF_SCORE) ─
# composite_score(f32:4) + upzone_dcs(f32:4) + downzone_dcs(f32:4) +
# tension_delta(f32:4) + signal(i8:1) + action(u8:1) + regime_id(u8:1) +
# weight_mode(u8:1) + confidence(f32:4) + qty(i16:2) + _pad(2:2) +
# stop_ticks(f32:4) + target_ticks(f32:4) + score_timestamp_ms(i64:8)
_SCORE_FMT: str = "<4fbBBBfhxx2fq"
# That packs: composite(f), upzone(f), downzone(f), tension_delta(f),
#             signal(b=int8), action(B=uint8), regime_id(B), weight_mode(B),
#             confidence(f), qty(h), [2 pad bytes via xx], stop(f), target(f),
#             timestamp(q)
# Byte count: 4*4 + 1+1+1+1 + 4 + 2+2 + 4+4+8 = 16+4+4+4+16 = 44 bytes
# Remaining 20 bytes are _reserved_score (not packed here, written as zeros)

_SCORE_PACK_SIZE: int = struct.calcsize(_SCORE_FMT)  # must be 44


# ─── dataclass ─────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class FeatureSnapshot:
    """Atomic snapshot of all Python-readable blocks from shared memory."""
    feature_seq:        int
    features:           np.ndarray   # shape (57, 60) float32, field-major
    components:         np.ndarray   # shape (15, 60) float32, component-major
    benchmarks:         np.ndarray   # shape (15,)   float64
    distances:          np.ndarray   # shape (210,)  float32
    markov_state:       int          # 0-3
    markov_confidence:  float
    vol_regime:         int          # 0-3


# ─── ShmemReader ────────────────────────────────────────────────────────────

class ShmemReader:
    """
    Opens the TensionFlow Windows named file mapping for read access.

    Usage::

        with ShmemReader() as r:
            snap = r.read_snapshot()

    The underlying mmap is opened with ACCESS_READ so this class never
    modifies shared state.
    """

    def __init__(self) -> None:
        self._mm: Optional[mmap.mmap] = None

    # ── lifecycle ─────────────────────────────────────────────────────────

    def open(self) -> None:
        """Open and validate the named shared memory mapping."""
        import ctypes
        import ctypes.wintypes

        # OpenFileMapping(FILE_MAP_READ=4, bInheritHandle=False, lpName)
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = kernel32.OpenFileMappingW(
            ctypes.c_ulong(4),   # FILE_MAP_READ
            ctypes.c_bool(False),
            SHM_NAME,
        )
        if not handle:
            err = ctypes.GetLastError()
            raise OSError(f"OpenFileMappingW failed for '{SHM_NAME}': error {err}")

        self._mm = mmap.mmap(handle, TOTAL_SIZE, access=mmap.ACCESS_READ)
        kernel32.CloseHandle(handle)  # mmap holds its own reference

        self._validate_magic()

    def close(self) -> None:
        """Close the mmap if open."""
        if self._mm is not None:
            self._mm.close()
            self._mm = None

    def __enter__(self) -> ShmemReader:
        self.open()
        return self

    def __exit__(self, *_) -> None:
        self.close()

    # ── validation ────────────────────────────────────────────────────────

    def _validate_magic(self) -> None:
        assert self._mm is not None
        self._mm.seek(OFF_METADATA)
        raw = self._mm.read(4)
        magic = struct.unpack_from("<I", raw)[0]
        if magic != SHM_MAGIC:
            raise ValueError(
                f"Shared memory magic mismatch: expected 0x{SHM_MAGIC:08X}, "
                f"got 0x{magic:08X}.  Is the C engine running?"
            )

    # ── metadata reads ────────────────────────────────────────────────────

    def read_feature_seq(self) -> int:
        """Read the feature_seq counter from TF_Metadata (u64 at offset 36)."""
        assert self._mm is not None
        self._mm.seek(OFF_METADATA + _META_OFF_FEATURE_SEQ)
        return struct.unpack_from("<Q", self._mm.read(8))[0]

    def _read_u64_at(self, meta_field_offset: int) -> int:
        assert self._mm is not None
        self._mm.seek(OFF_METADATA + meta_field_offset)
        return struct.unpack_from("<Q", self._mm.read(8))[0]

    # ── snapshot read ─────────────────────────────────────────────────────

    def read_snapshot(self) -> FeatureSnapshot:
        """
        Read all Python-relevant blocks atomically using the seqlock pattern.

        Reads feature_seq before and after; if it changed during the read,
        retries up to 16 times before raising RuntimeError.
        """
        assert self._mm is not None, "call open() first"

        for _attempt in range(16):
            seq_before = self._read_u64_at(_META_OFF_FEATURE_SEQ)

            # TF_FeatureBlock: 3420 float32 values, field-major (57 x 60)
            self._mm.seek(OFF_FEATURES)
            features_raw = self._mm.read(SZ_FEATURES)
            features = np.frombuffer(features_raw, dtype=np.float32).copy()
            features = features.reshape(RAW_FIELDS, DOM_LEVELS)

            # TF_ComponentBlock: 900 float32 values, component-major (15 x 60)
            self._mm.seek(OFF_COMPONENTS)
            comp_raw = self._mm.read(SZ_COMPONENTS)
            components = np.frombuffer(comp_raw, dtype=np.float32).copy()
            components = components.reshape(COMPONENTS, DOM_LEVELS)

            # TF_Benchmarks: 15 float64 values (120 bytes used, 8 bytes pad)
            self._mm.seek(OFF_BENCHMARKS)
            bench_raw = self._mm.read(15 * 8)  # 120 bytes, skip 8-byte pad
            benchmarks = np.frombuffer(bench_raw, dtype=np.float64).copy()

            # TF_Distances: 210 float32 values (840 bytes used, 8 bytes pad)
            self._mm.seek(OFF_DISTANCES)
            dist_raw = self._mm.read(DISTANCES * 4)  # 840 bytes, skip 8-byte pad
            distances = np.frombuffer(dist_raw, dtype=np.float32).copy()

            # TF_MarkovState: current_state(u8), vol_regime(u8), confidence(f32)
            self._mm.seek(OFF_MARKOV)
            markov_raw = self._mm.read(6)  # u8 + u8 + f32
            markov_state = markov_raw[0]
            vol_regime = markov_raw[1]
            markov_confidence = struct.unpack_from("<f", markov_raw, 2)[0]

            seq_after = self._read_u64_at(_META_OFF_FEATURE_SEQ)

            if seq_before == seq_after:
                return FeatureSnapshot(
                    feature_seq=seq_before,
                    features=features,
                    components=components,
                    benchmarks=benchmarks,
                    distances=distances,
                    markov_state=markov_state,
                    markov_confidence=markov_confidence,
                    vol_regime=vol_regime,
                )

            time.sleep(0.0005)  # 0.5ms back-off

        raise RuntimeError(
            "read_snapshot: feature_seq changed on every attempt (16 retries). "
            "Writer is updating faster than we can read."
        )


# ─── ShmemWriter ────────────────────────────────────────────────────────────

class ShmemWriter:
    """
    Opens the TensionFlow Windows named file mapping for read/write access.

    Only write to the blocks this process owns (ScoreBlock per tf_layout.h).
    Writing to blocks owned by the C engine or Java will corrupt shared state.

    Usage::

        with ShmemWriter() as w:
            w.write_score(composite=0.72, upzone=4480.25, downzone=4478.5,
                          tension_delta=0.08, signal=1, action=1,
                          regime_id=1, weight_mode=0, confidence=0.85,
                          qty=1, stop_ticks=8.0, target_ticks=16.0)
    """

    def __init__(self) -> None:
        self._mm: Optional[mmap.mmap] = None

    # ── lifecycle ─────────────────────────────────────────────────────────

    def open(self) -> None:
        """Open the named shared memory mapping for read/write."""
        import ctypes

        FILE_MAP_WRITE = 2
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = kernel32.OpenFileMappingW(
            ctypes.c_ulong(FILE_MAP_WRITE),
            ctypes.c_bool(False),
            SHM_NAME,
        )
        if not handle:
            err = ctypes.GetLastError()
            raise OSError(f"OpenFileMappingW (WRITE) failed for '{SHM_NAME}': error {err}")

        self._mm = mmap.mmap(handle, TOTAL_SIZE, access=mmap.ACCESS_WRITE)
        kernel32.CloseHandle(handle)

    def close(self) -> None:
        if self._mm is not None:
            self._mm.flush()
            self._mm.close()
            self._mm = None

    def __enter__(self) -> ShmemWriter:
        self.open()
        return self

    def __exit__(self, *_) -> None:
        self.close()

    # ── score write ───────────────────────────────────────────────────────

    def write_score(
        self,
        composite: float,
        upzone: float,
        downzone: float,
        tension_delta: float,
        signal: int,
        action: int,
        regime_id: int,
        weight_mode: int,
        confidence: float,
        qty: int,
        stop_ticks: float,
        target_ticks: float,
    ) -> None:
        """
        Pack and write TF_ScoreBlock at OFF_SCORE, then increment score_seq.

        Field layout (64 bytes total):
          +0  composite_score  f32
          +4  upzone_dcs       f32
          +8  downzone_dcs     f32
          +12 tension_delta    f32
          +16 signal           i8
          +17 action           u8
          +18 regime_id        u8
          +19 weight_mode      u8
          +20 confidence       f32
          +24 qty              i16
          +26 _pad[2]          --
          +28 stop_ticks       f32
          +32 target_ticks     f32
          +36 score_timestamp_ms i64
          +44 _reserved[20]   --
        """
        assert self._mm is not None, "call open() first"

        timestamp_ms = int(time.time() * 1000)

        packed = struct.pack(
            _SCORE_FMT,
            float(composite),
            float(upzone),
            float(downzone),
            float(tension_delta),
            int(signal),           # signal is int8_t: -2, -1, +1, +2
            action & 0xFF,
            regime_id & 0xFF,
            weight_mode & 0xFF,
            float(confidence),
            qty,                  # i16
            float(stop_ticks),
            float(target_ticks),
            timestamp_ms,
        )
        assert len(packed) == _SCORE_PACK_SIZE  # 44

        # Write score block: 44 packed bytes + 20 reserved zeros = 64 bytes
        self._mm.seek(OFF_SCORE)
        self._mm.write(packed + bytes(20))

        # Increment score_seq in metadata (seqlock write protocol)
        self._mm.seek(OFF_METADATA + _META_OFF_SCORE_SEQ)
        raw_seq = self._mm.read(8)
        current_seq = struct.unpack_from("<Q", raw_seq)[0]
        self._mm.seek(OFF_METADATA + _META_OFF_SCORE_SEQ)
        self._mm.write(struct.pack("<Q", current_seq + 1))
