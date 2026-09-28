"""The run record's manifest line: appended by read-then-write through pyarrow.

The dashboard's environment has no ``s3fs``, so the line cannot go through
``UPath.open("a")``; these tests drive ``store._append_manifest_line`` against a
local pyarrow filesystem standing in for the object store.
"""
from __future__ import annotations

import json
import os
import sys

import pytest
from pyarrow import fs

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "ml"))

layout = pytest.importorskip("lake.layout")

from cycle import store  # noqa: E402


@pytest.fixture()
def manifest_key(tmp_path, monkeypatch):
    """Point the manifest at a local file and return its path."""
    path = (tmp_path / "model_cycle_runs.jsonl").as_posix()
    monkeypatch.setattr(layout, "arrow_fs", lambda: fs.LocalFileSystem())
    monkeypatch.setattr(layout, "arrow_key", lambda _location: path)
    return path


def lines_of(path: str) -> list[str]:
    with open(path, encoding="utf-8") as handle:
        return handle.read().splitlines()


def test_the_first_line_creates_the_manifest(manifest_key):
    store._append_manifest_line("model_cycle_runs", json.dumps({"table": "runs", "recipe": "first"}))
    assert [json.loads(line)["recipe"] for line in lines_of(manifest_key)] == ["first"]


def test_a_second_line_keeps_the_first(manifest_key):
    store._append_manifest_line("model_cycle_runs", json.dumps({"table": "runs", "recipe": "first"}))
    store._append_manifest_line("model_cycle_runs", json.dumps({"table": "bars", "recipe": "first"}))
    assert [json.loads(line)["table"] for line in lines_of(manifest_key)] == ["runs", "bars"]


def test_the_same_line_is_written_once(manifest_key):
    line = json.dumps({"table": "runs", "recipe": "first"})
    store._append_manifest_line("model_cycle_runs", line)
    store._append_manifest_line("model_cycle_runs", line)
    assert lines_of(manifest_key) == [line]


def test_a_manifest_without_a_final_newline_is_not_joined_to_the_new_line(manifest_key):
    with open(manifest_key, "w", encoding="utf-8", newline="") as handle:
        handle.write(json.dumps({"table": "runs", "recipe": "first"}))
    store._append_manifest_line("model_cycle_runs", json.dumps({"table": "bars", "recipe": "first"}))
    assert [json.loads(line)["table"] for line in lines_of(manifest_key)] == ["runs", "bars"]


def test_a_line_that_keeps_being_overwritten_raises(manifest_key, monkeypatch):
    """Another writer that always wins is reported, never swallowed."""
    monkeypatch.setattr(store, "_read_manifest", lambda _filesystem, _key: "")
    with pytest.raises(RuntimeError, match="overwritten"):
        store._append_manifest_line("model_cycle_runs", json.dumps({"table": "runs", "recipe": "first"}))
