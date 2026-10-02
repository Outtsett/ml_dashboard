"""The explainer's in-process API and its JSON-lines loop.

``Explainer`` answers the operations of ``cycleExplainerRequestSchema``
(``packages/shared/src/cycle/explain.ts``) and caches what it loaded:

- a run's ``explain/`` arrays, keyed by their modification times (tuning can
  rewrite them);
- fold models, LRU by (run directory, fold, role), each kept while every file
  under its model folder has the same modification time and size — a model the
  engine re-saves is reloaded;
- the run's ``predictions.parquet`` columns, keyed by its modification time.

``releaseRun`` drops all three for a run. Nothing is memory-mapped, so after it
the run's folder can be deleted on Windows.

``serve(stdin, stdout)`` prints ``{"ready": true, "pid": ...}`` and then one
reply line per request line: ``{"id", "ok": true, "result"}`` or
``{"id", "ok": false, "error", "details"}``. Replies never carry NaN (null
instead). Logging goes to stderr only.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from collections import OrderedDict
from typing import IO, Callable

from . import ExplainError, artifacts
from .common import ExplainContext, bar_reply, build_context, clean, structure_reply, tree_reply

MODEL_CACHE_SIZE = 8
RUN_CACHE_SIZE = 4


class Explainer:
    """The operations, cached. ``adapter_loader(directory) -> adapter``
    replaces ``cycle.models.load_adapter`` (tests only)."""

    def __init__(self, *, model_cache_size: int = MODEL_CACHE_SIZE, run_cache_size: int = RUN_CACHE_SIZE,
                 adapter_loader: Callable[[str], object] | None = None) -> None:
        self.model_cache_size = int(model_cache_size)
        self.run_cache_size = int(run_cache_size)
        self.adapter_loader = adapter_loader
        self._runs: OrderedDict[str, artifacts.RunArrays] = OrderedDict()
        self._models: OrderedDict[tuple[str, int, str], ExplainContext] = OrderedDict()
        self._streamed: dict[str, artifacts.StreamedPredictions | None] = {}
        self.model_loads = 0          # how many times a fold model was (re)loaded, for the tests

    # ── caches ──
    def run_arrays(self, run_directory: str) -> artifacts.RunArrays:
        key = artifacts.normalise(run_directory)
        cached = self._runs.get(key)
        if cached is not None and cached.signature == artifacts.explain_signature(key):
            self._runs.move_to_end(key)
            return cached
        if cached is not None:
            self._drop_run(key)
        if not os.path.isdir(key):
            raise ExplainError("This run's folder does not exist.", key)
        loaded = artifacts.load_run_arrays(key)
        self._runs[key] = loaded
        while len(self._runs) > self.run_cache_size:
            oldest, _ = self._runs.popitem(last=False)
            self._drop_run(oldest)
        return loaded

    def context(self, run_directory: str, fold: int, role: str) -> ExplainContext:
        run = self.run_arrays(run_directory)
        key = (run.run_directory, int(fold), role)
        cached = self._models.get(key)
        if cached is not None and cached.run is run:
            if artifacts.model_signature(artifacts.model_directory(run.run_directory, fold, role)) == cached.signature:
                self._models.move_to_end(key)
                return cached
        self._models.pop(key, None)
        context = build_context(run, int(fold), role, adapter_loader=self.adapter_loader)
        self.model_loads += 1
        self._models[key] = context
        while len(self._models) > self.model_cache_size:
            self._models.popitem(last=False)
        return context

    def streamed(self, context: ExplainContext) -> artifacts.StreamedPredictions | None:
        key = context.run_directory
        signature = artifacts.streamed_signature(key)
        cached = self._streamed.get(key)
        if cached is not None and cached.signature == signature:
            return cached
        if signature is None:
            self._streamed.pop(key, None)
            return None
        loaded = artifacts.load_streamed(key, context.timestamps)
        self._streamed[key] = loaded
        return loaded

    def _drop_run(self, key: str) -> None:
        self._runs.pop(key, None)
        self._streamed.pop(key, None)
        for model_key in [k for k in self._models if k[0] == key]:
            del self._models[model_key]

    def cached_runs(self) -> list[str]:
        return list(self._runs)

    def cached_models(self) -> list[tuple[str, int, str]]:
        return list(self._models)

    # ── operations ──
    def manifest(self, run_directory: str) -> dict:
        return clean(artifacts.manifest(run_directory))

    def structure(self, run_directory: str, fold: int, role: str) -> dict:
        return structure_reply(self.context(run_directory, fold, role))

    def tree(self, run_directory: str, fold: int, role: str, tree: int) -> dict:
        return tree_reply(self.context(run_directory, fold, role), int(tree))

    def explain(self, run_directory: str, fold: int, role: str, timestamp: int) -> dict:
        context = self.context(run_directory, fold, role)
        return bar_reply(context, int(timestamp), self.streamed(context))

    def release_run(self, run_directory: str) -> dict:
        key = artifacts.normalise(run_directory)
        models = sum(1 for k in self._models if k[0] == key)
        held = key in self._runs
        self._drop_run(key)
        import gc

        gc.collect()
        return {"released": run_directory, "models": models, "inputs": held}

    # ── the protocol ──
    def handle(self, request: dict) -> tuple[dict, bool]:
        """One request -> (reply, stop). Never raises."""
        request_id = str(request.get("id", "")) if isinstance(request, dict) else ""
        try:
            if not isinstance(request, dict):
                raise ExplainError("A request must be a JSON object.")
            operation = request.get("op")
            if operation == "ping":
                result = {"pong": True, "pid": os.getpid(), "cwd": os.getcwd(),
                          "environment": {name: os.environ.get(name) for name in
                                          ("CUDA_VISIBLE_DEVICES", "OMP_NUM_THREADS", "PYTHONUNBUFFERED")},
                          "cachedRuns": len(self._runs), "cachedModels": len(self._models)}
            elif operation == "structure":
                result = self.structure(_text(request, "runDirectory"), _integer(request, "fold"), _role(request))
            elif operation == "tree":
                result = self.tree(_text(request, "runDirectory"), _integer(request, "fold"), _role(request),
                                   _integer(request, "tree"))
            elif operation == "explain":
                result = self.explain(_text(request, "runDirectory"), _integer(request, "fold"), _role(request),
                                      _integer(request, "timestamp"))
            elif operation == "releaseRun":
                result = self.release_run(_text(request, "runDirectory"))
            elif operation == "exit":
                return {"id": request_id, "ok": True, "result": {"exiting": True}}, True
            else:
                raise ExplainError(f"Unknown operation {operation!r}.",
                                   "operations: ping, structure, tree, explain, releaseRun, exit")
            return {"id": request_id, "ok": True, "result": clean(result)}, False
        except ExplainError as error:
            reply = {"id": request_id, "ok": False, "error": str(error)}
            if error.details:
                reply["details"] = str(error.details)
            return reply, False
        except Exception as error:  # noqa: BLE001 - one failed request never ends the process
            print(traceback.format_exc(), file=sys.stderr, flush=True)
            return {"id": request_id, "ok": False, "error": f"{type(error).__name__}: {error}",
                    "details": traceback.format_exc(limit=8)}, False


def _text(request: dict, name: str) -> str:
    value = request.get(name)
    if not isinstance(value, str) or not value:
        raise ExplainError(f"The request needs {name} (text).")
    return value


def _integer(request: dict, name: str) -> int:
    value = request.get(name)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ExplainError(f"The request needs {name} (a whole number, 0 or more).")
    return value


def _role(request: dict) -> str:
    role = request.get("role")
    if role not in artifacts.ROLES:
        raise ExplainError(f"Unknown role {role!r}: use direction or price.")
    return role


def encode(reply: dict) -> str:
    """One protocol line. ``allow_nan=False`` guards the never-NaN rule after ``clean``."""
    return json.dumps(clean(reply), allow_nan=False, separators=(",", ":"))


def serve(stdin: IO[str], stdout: IO[str], explainer: Explainer | None = None) -> int:
    """The JSON-lines loop; returns the exit code (0 after ``exit`` or end of input)."""
    explainer = explainer or Explainer()
    stdout.write(json.dumps({"ready": True, "pid": os.getpid()}) + "\n")
    stdout.flush()
    print(f"[explain] serving (pid {os.getpid()})", file=sys.stderr, flush=True)
    while True:
        line = stdin.readline()
        if not line:
            return 0
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as error:
            reply, stop = {"id": "", "ok": False, "error": "The request line is not JSON.", "details": str(error)}, False
        else:
            reply, stop = explainer.handle(request)
        try:
            text = encode(reply)
        except (TypeError, ValueError) as error:
            text = encode({"id": reply.get("id", ""), "ok": False, "error": "The reply could not be written as JSON.",
                           "details": f"{type(error).__name__}: {error}"})
        stdout.write(text + "\n")
        stdout.flush()
        if stop:
            return 0


__all__ = ["Explainer", "encode", "serve"]
