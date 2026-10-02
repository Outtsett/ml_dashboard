"""A stand-in for `packages/ml-engine/src/cycle/explain_main.py --serve`, for the server pool tests.

Speaks the explainer's JSON-lines protocol (`packages/shared/src/cycle/explain.ts`): one
ready line `{"ready": true, "pid": ...}` on stdout, then one reply line per
request line read from stdin. Logging goes to stderr. Replies carry canned
results that are valid against the explain.ts schemas (a two-tree model), so
the tests exercise the pool and routes without any model library.

Behaviour is chosen by arguments:
  --log PATH             append every request received to PATH, one JSON line each
  --ready-delay SECONDS  wait before printing the ready line
  --no-ready             never print the ready line
  --noise                print a non-JSON line on stdout before the ready line
  --exit-at-start CODE   write a sentence to stderr and exit with CODE before ready
  --reply-delay SECONDS  wait before answering structure / tree / explain
  --crash-on OP          write to stderr and exit 3 when OP arrives
  --crash-once-file PATH crash on the first structure / tree / explain if PATH does not
                         exist yet (creating it), answer normally afterwards
  --error-on OP          answer OP with ok: false
  --invalid              answer structure / tree / explain with results the schemas reject
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

MODEL_OPERATIONS = ("structure", "tree", "explain")


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--log")
    parser.add_argument("--ready-delay", type=float, default=0.0)
    parser.add_argument("--no-ready", action="store_true")
    parser.add_argument("--noise", action="store_true")
    parser.add_argument("--exit-at-start", type=int)
    parser.add_argument("--reply-delay", type=float, default=0.0)
    parser.add_argument("--crash-on")
    parser.add_argument("--crash-once-file")
    parser.add_argument("--error-on")
    parser.add_argument("--invalid", action="store_true")
    return parser.parse_args()


def write_line(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def model_id_of(request: dict) -> str:
    return os.path.basename(os.path.normpath(request.get("runDirectory", ""))) or "unknown"


def structure_result(request: dict) -> dict:
    price = request["role"] == "price"
    return {
        "modelId": model_id_of(request),
        "foldIndex": request["fold"],
        "role": request["role"],
        "explainKind": "trees",
        "link": "identity" if price else "logistic",
        "baseValue": 0.0,
        "logisticCurve": None,
        "trees": {
            "treeCount": 2,
            "usedTreeCount": 2,
            "aggregation": "sum",
            "learningRate": 0.1,
            "maxDepth": 1,
            "depthHistogram": [0, 2],
            "leafCount": 4,
            "featureUsage": [{"featureIndex": 0, "splitCount": 2, "totalGain": 1.5}],
            "oblivious": False,
            "splitRule": "less_than",
        },
        "linear": None,
        "neighbors": None,
        "naiveBayes": None,
        "supportVectors": None,
        "calibration": None,
        "stacking": None,
        "neural": None,
    }


def tree_result(request: dict) -> dict:
    return {
        "modelId": model_id_of(request),
        "foldIndex": request["fold"],
        "role": request["role"],
        "treeIndex": request["tree"],
        "splitRule": "less_than",
        "nodes": {
            "left": [1, -1, -1],
            "right": [2, -1, -1],
            "feature": [0, -1, -1],
            "threshold": [0.5, None, None],
            "missingGoesLeft": [True, None, None],
            "value": [0.0, -0.2, 0.3],
            "cover": [10.0, 4.0, 6.0],
            "depth": [0, 1, 1],
        },
        "obliviousLevels": None,
        "obliviousLeafValues": None,
    }


def bar_result(request: dict) -> dict:
    raw = 0.1
    probability_up = 1.0 / (1.0 + math.exp(-raw))
    return {
        "modelId": model_id_of(request),
        "timestamp": request["timestamp"],
        "foldIndex": request["fold"],
        "role": request["role"],
        "explainKind": "trees",
        "link": "logistic",
        "inputs": {
            "values": [0.7, None],
            "scaled": False,
            "raw": [1.2, None],
            "trainingPercentile": [0.8, None],
            "window": None,
        },
        "output": {
            "raw": raw,
            "probabilityUp": probability_up,
            "targetUnits": None,
            "scale": None,
            "movePoints": None,
            "close": 100.0,
            "predictedClose": None,
        },
        "engineReload": probability_up,
        "streamed": None,
        "trees": {
            "baseValue": 0.0,
            "leafValues": [0.3, -0.2],
            "runningTotal": [0.3, 0.1],
            "leafNode": [2, 1],
            "pathOffsets": [0, 1, 2],
            "pathNode": [0, 0],
            "pathFeature": [0, 0],
            "pathThreshold": [0.5, 0.5],
            "pathWentLeft": [False, True],
        },
        "contributions": None,
        "neighbors": None,
        "supportVectors": None,
        "calibration": None,
        "stacking": None,
        "neural": None,
    }


def invalid_result(request: dict) -> dict:
    # "link" is not one of the contract's links and "foldIndex" is a string.
    return {"modelId": model_id_of(request), "foldIndex": "zero", "link": "not_a_link"}


def main() -> int:
    arguments = parse_arguments()

    def log_request(request: dict) -> None:
        if arguments.log:
            with open(arguments.log, "a", encoding="utf-8") as handle:
                handle.write(json.dumps(request) + "\n")

    if arguments.exit_at_start is not None:
        sys.stderr.write("fake explainer: failing on purpose at start\n")
        sys.stderr.flush()
        return arguments.exit_at_start

    if arguments.noise:
        sys.stdout.write("numba chatter that is not JSON\n")
        sys.stdout.flush()
    if arguments.ready_delay:
        time.sleep(arguments.ready_delay)
    if not arguments.no_ready:
        write_line({"ready": True, "pid": os.getpid()})
    sys.stderr.write("fake explainer: serving\n")
    sys.stderr.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request = json.loads(line)
        log_request(request)
        operation = request.get("op")
        request_id = request.get("id", "")

        if operation == arguments.crash_on:
            sys.stderr.write(f"fake explainer: crashing on purpose on {operation}\n")
            sys.stderr.flush()
            return 3
        if operation in MODEL_OPERATIONS and arguments.crash_once_file and not os.path.exists(arguments.crash_once_file):
            with open(arguments.crash_once_file, "w", encoding="utf-8") as handle:
                handle.write("crashed once\n")
            sys.stderr.write("fake explainer: crashing once on purpose\n")
            sys.stderr.flush()
            return 3
        if operation == arguments.error_on:
            write_line({"id": request_id, "ok": False, "error": f"The fake explainer refuses {operation}.", "details": "asked to by --error-on"})
            continue

        if operation == "ping":
            write_line(
                {
                    "id": request_id,
                    "ok": True,
                    "result": {
                        "pong": True,
                        "cwd": os.getcwd(),
                        "environment": {
                            name: os.environ.get(name)
                            for name in ("CUDA_VISIBLE_DEVICES", "OMP_NUM_THREADS", "PYTHONUNBUFFERED")
                        },
                    },
                }
            )
        elif operation == "releaseRun":
            write_line({"id": request_id, "ok": True, "result": {"released": request.get("runDirectory")}})
        elif operation == "exit":
            write_line({"id": request_id, "ok": True, "result": {"exiting": True}})
            return 0
        elif operation in MODEL_OPERATIONS:
            if arguments.reply_delay:
                time.sleep(arguments.reply_delay)
            if arguments.invalid:
                result = invalid_result(request)
            elif operation == "structure":
                result = structure_result(request)
            elif operation == "tree":
                result = tree_result(request)
            else:
                result = bar_result(request)
            write_line({"id": request_id, "ok": True, "result": result})
        else:
            write_line({"id": request_id, "ok": False, "error": f"Unknown operation {operation!r}."})
    return 0


if __name__ == "__main__":
    sys.exit(main())
