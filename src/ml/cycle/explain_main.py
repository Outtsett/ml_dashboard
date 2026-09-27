"""The "Inside the model" explainer process: one warm, CPU-only Python that
answers ``src/shared/cycle/explain.ts`` requests over stdin / stdout.

Spawned by ``src/server/training/cycleExplainer.ts`` (cwd = the repository root,
``CUDA_VISIBLE_DEVICES=""``, ``OMP_NUM_THREADS=4``, ``PYTHONUNBUFFERED=1``)::

    .venv/Scripts/python.exe src/ml/cycle/explain_main.py --serve

It prints ``{"ready": true, "pid": ...}``, then one JSON reply line per request
line (``cycle.explain.server.serve``). Only replies reach stdout: file
descriptor 1 is pointed at stderr before any model library loads, so a library
that prints (a native one included) cannot corrupt the protocol; the replies go
to a duplicate of the original stdout.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

_ML_ROOT = Path(__file__).resolve().parents[1]
if str(_ML_ROOT) not in sys.path:
    sys.path.insert(0, str(_ML_ROOT))

# Windows + torch: torch must be imported before numpy, or a later torch import
# can deadlock. The explainer is CPU-only (the pool empties CUDA_VISIBLE_DEVICES),
# so torch is imported only when it is installed at all.
try:
    if importlib.util.find_spec("torch") is not None:
        import torch  # noqa: F401
except Exception:  # noqa: BLE001 - torch is optional: tabular models explain without it
    pass

import argparse  # noqa: E402

# The repository root goes LAST (same reason as main.py: numba's cache for
# shared.features may re-import it as ``src.ml.shared.features``).
_PROJECT_ROOT = _ML_ROOT.parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.append(str(_PROJECT_ROOT))


def _protocol_streams():
    """(stdin, protocol stdout). Moves fd 1 onto stderr so stray prints — Python
    or native — land in the log, and returns a writer on a duplicate of the
    original stdout for the replies."""
    sys.stdout.flush()
    protocol_fd = os.dup(1)
    os.dup2(2, 1)
    protocol = os.fdopen(protocol_fd, "w", encoding="utf-8", newline="\n", buffering=1)
    sys.stdout = sys.stderr
    stdin = sys.stdin
    try:
        stdin.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass
    return stdin, protocol


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Model Cycle explainer (JSON lines over stdin / stdout)")
    parser.add_argument("--serve", action="store_true", help="serve requests until exit or end of input")
    arguments = parser.parse_args(argv)
    if not arguments.serve:
        parser.print_help(sys.stderr)
        return 2
    stdin, protocol = _protocol_streams()
    from cycle.explain.server import serve

    try:
        return serve(stdin, protocol)
    finally:
        protocol.flush()


def _leave(exit_code: int) -> None:
    """Exit without unloading native libraries (see ``cycle/main.py``'s
    ``_leave``: torch / CUDA DLL-detach routines can fast-fail at exit on
    Windows). Everything written is flushed first; the pipe keeps it."""
    try:
        sys.stdout.flush()
        sys.stderr.flush()
    except Exception:  # noqa: BLE001
        pass
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        kernel32.TerminateProcess.argtypes = (wintypes.HANDLE, wintypes.UINT)
        kernel32.TerminateProcess.restype = wintypes.BOOL
        kernel32.TerminateProcess(kernel32.GetCurrentProcess(), exit_code)
    os._exit(exit_code)


def _run() -> int:
    try:
        return main()
    except SystemExit as stop:
        return stop.code if isinstance(stop.code, int) else 2
    except BaseException:  # noqa: BLE001 - reported on stderr, then the process leaves
        import traceback

        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    _leave(_run())
