"""
test_shmem.py — Layout constant verification for shmem.py.

Tests that all constants in shmem.py match the values asserted by
tf_layout.h static_assert statements.  No actual mmap operations are
performed — the C engine shared memory need not be running.
"""

from __future__ import annotations

import ml.shared.shmem as shmem

# ─── magic / identity ──────────────────────────────────────────────────────

def test_shm_name():
    assert shmem.SHM_NAME == "Local\\TensionFlowHub"


def test_shm_magic():
    assert shmem.SHM_MAGIC == 0x54464C56


# ─── dimension constants ───────────────────────────────────────────────────

def test_dom_levels():
    assert shmem.DOM_LEVELS == 60


def test_raw_fields():
    assert shmem.RAW_FIELDS == 57


def test_components():
    assert shmem.COMPONENTS == 15


def test_feature_count():
    assert shmem.FEATURE_COUNT == 3420
    assert shmem.FEATURE_COUNT == shmem.RAW_FIELDS * shmem.DOM_LEVELS


def test_component_count():
    assert shmem.COMPONENT_COUNT == 900
    assert shmem.COMPONENT_COUNT == shmem.COMPONENTS * shmem.DOM_LEVELS


def test_tick_ring_cap():
    assert shmem.TICK_RING_CAP == 65536


def test_benchmarks_count():
    assert shmem.BENCHMARKS == 15


def test_distances_count():
    assert shmem.DISTANCES == 210


def test_buckets_count():
    assert shmem.BUCKETS == 5


# ─── block sizes (must match tf_layout.h static_assert values) ─────────────

def test_sz_metadata():
    assert shmem.SZ_METADATA == 256


def test_sz_tick():
    assert shmem.SZ_TICK == 36


def test_sz_tick_ring():
    # TF_STATIC_ASSERT(sizeof(TF_TickRing) == 2359296)
    assert shmem.SZ_TICK_RING == 2_359_296
    assert shmem.SZ_TICK_RING == shmem.TICK_RING_CAP * shmem.SZ_TICK


def test_sz_dom():
    # TF_STATIC_ASSERT(sizeof(TF_DOMSnapshot) == 1000)
    assert shmem.SZ_DOM == 1000


def test_sz_benchmarks():
    # TF_STATIC_ASSERT(sizeof(TF_Benchmarks) == 128)
    assert shmem.SZ_BENCHMARKS == 128


def test_sz_distances():
    # TF_STATIC_ASSERT(sizeof(TF_Distances) == 848)
    assert shmem.SZ_DISTANCES == 848


def test_sz_buckets():
    # TF_STATIC_ASSERT(sizeof(TF_BucketBlock) == 400)
    assert shmem.SZ_BUCKETS == 400


def test_sz_markov():
    # TF_STATIC_ASSERT(sizeof(TF_MarkovState) == 80)
    assert shmem.SZ_MARKOV == 80


def test_sz_features():
    # TF_STATIC_ASSERT(sizeof(TF_FeatureBlock) == 13680)
    assert shmem.SZ_FEATURES == 13_680
    assert shmem.SZ_FEATURES == shmem.RAW_FIELDS * shmem.DOM_LEVELS * 4


def test_sz_components():
    # TF_STATIC_ASSERT(sizeof(TF_ComponentBlock) == 3600)
    assert shmem.SZ_COMPONENTS == 3_600
    assert shmem.SZ_COMPONENTS == shmem.COMPONENTS * shmem.DOM_LEVELS * 4


def test_sz_detections():
    # TF_STATIC_ASSERT(sizeof(TF_DetectionBlock) == 96)
    assert shmem.SZ_DETECTIONS == 96


def test_sz_score():
    # TF_STATIC_ASSERT(sizeof(TF_ScoreBlock) == 64)
    assert shmem.SZ_SCORE == 64


# ─── offset constants: contiguity (each block starts where previous ends) ──

def test_off_metadata_is_zero():
    assert shmem.OFF_METADATA == 0


def test_off_tick_ring_contiguous():
    assert shmem.OFF_TICK_RING == shmem.OFF_METADATA + shmem.SZ_METADATA
    assert shmem.OFF_TICK_RING == 256


def test_off_dom_contiguous():
    assert shmem.OFF_DOM == shmem.OFF_TICK_RING + shmem.SZ_TICK_RING
    assert shmem.OFF_DOM == 2_359_552


def test_off_benchmarks_contiguous():
    assert shmem.OFF_BENCHMARKS == shmem.OFF_DOM + shmem.SZ_DOM
    assert shmem.OFF_BENCHMARKS == 2_360_552


def test_off_distances_contiguous():
    assert shmem.OFF_DISTANCES == shmem.OFF_BENCHMARKS + shmem.SZ_BENCHMARKS
    assert shmem.OFF_DISTANCES == 2_360_680


def test_off_bucket_block_contiguous():
    assert shmem.OFF_BUCKET_BLOCK == shmem.OFF_DISTANCES + shmem.SZ_DISTANCES
    assert shmem.OFF_BUCKET_BLOCK == 2_361_528


def test_off_markov_contiguous():
    assert shmem.OFF_MARKOV == shmem.OFF_BUCKET_BLOCK + shmem.SZ_BUCKETS
    assert shmem.OFF_MARKOV == 2_361_928


def test_off_features_contiguous():
    assert shmem.OFF_FEATURES == shmem.OFF_MARKOV + shmem.SZ_MARKOV
    assert shmem.OFF_FEATURES == 2_362_008


def test_off_components_contiguous():
    assert shmem.OFF_COMPONENTS == shmem.OFF_FEATURES + shmem.SZ_FEATURES
    assert shmem.OFF_COMPONENTS == 2_375_688


def test_off_detections_contiguous():
    assert shmem.OFF_DETECTIONS == shmem.OFF_COMPONENTS + shmem.SZ_COMPONENTS
    assert shmem.OFF_DETECTIONS == 2_379_288


def test_off_score_contiguous():
    assert shmem.OFF_SCORE == shmem.OFF_DETECTIONS + shmem.SZ_DETECTIONS
    assert shmem.OFF_SCORE == 2_379_384


# ─── total size ────────────────────────────────────────────────────────────

def test_total_size():
    # Header comment: "Total shared memory size: 2,379,448 bytes"
    assert shmem.TOTAL_SIZE == shmem.OFF_SCORE + shmem.SZ_SCORE
    assert shmem.TOTAL_SIZE == 2_379_448


# ─── score pack format sanity ──────────────────────────────────────────────

def test_score_pack_size():
    # _SCORE_FMT must produce 44 bytes (64 - 20 reserved)
    assert shmem._SCORE_PACK_SIZE == 44


def test_score_block_total():
    # packed (44) + reserved (20) must equal SZ_SCORE (64)
    assert shmem._SCORE_PACK_SIZE + 20 == shmem.SZ_SCORE


# ─── metadata sequence counter offsets ────────────────────────────────────

def test_meta_feature_seq_offset():
    # feature_seq is at byte 36 of TF_Metadata (from header annotation)
    assert shmem._META_OFF_FEATURE_SEQ == 36


def test_meta_component_seq_offset():
    # component_seq at byte 44
    assert shmem._META_OFF_COMPONENT_SEQ == 44


def test_meta_score_seq_offset():
    # score_seq at byte 52
    assert shmem._META_OFF_SCORE_SEQ == 52


# ─── all blocks accounted for: sum of sizes == TOTAL_SIZE ──────────────────

def test_sum_of_block_sizes_equals_total():
    total = (
        shmem.SZ_METADATA
        + shmem.SZ_TICK_RING
        + shmem.SZ_DOM
        + shmem.SZ_BENCHMARKS
        + shmem.SZ_DISTANCES
        + shmem.SZ_BUCKETS
        + shmem.SZ_MARKOV
        + shmem.SZ_FEATURES
        + shmem.SZ_COMPONENTS
        + shmem.SZ_DETECTIONS
        + shmem.SZ_SCORE
    )
    assert total == shmem.TOTAL_SIZE
