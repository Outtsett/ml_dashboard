"""Repository-wide pytest hooks.

Exit without unloading native libraries when CUDA was used.
    After cuDNN models in one process, the CUDA/cuDNN DLL-detach routines
    fast-fail with 0xC0000409 (STATUS_STACK_BUFFER_OVERRUN) while the
    interpreter exits — after every test has passed and been reported — so the
    pytest PROCESS exits non-zero and any gate reading the exit code calls a
    green suite red (measured 2026-09-26 on tests/test_cycle_networks.py).
    ``src/ml/cycle/main.py::_leave`` works around the same crash for a run;
    this hook does the same for the test process: once pytest has reported,
    flush and terminate with the session's own exit status. Only when torch
    initialised CUDA; a CPU-only run exits normally.
"""

from __future__ import annotations

import os
import sys

_exit_status: int | None = None

# Test helper modules that live in this folder (``cycle_bridge_harness``) import by
# plain name. APPENDED, never prepended: a ``tests`` package installed in
# site-packages shadows ``import tests.<module>``, and nothing here may shadow ``src``.
_TESTS_DIRECTORY = os.path.dirname(os.path.abspath(__file__))
if _TESTS_DIRECTORY not in sys.path:
    sys.path.append(_TESTS_DIRECTORY)


def pytest_sessionfinish(session, exitstatus) -> None:  # noqa: ANN001 - pytest hook signature
    global _exit_status
    _exit_status = int(exitstatus)


def pytest_unconfigure(config) -> None:  # noqa: ANN001 - pytest hook signature
    torch = sys.modules.get("torch")
    if torch is None or _exit_status is None:
        return
    try:
        cuda_used = bool(torch.cuda.is_available() and torch.cuda.is_initialized())
    except Exception:  # noqa: BLE001 - a broken torch import is not this hook's problem
        return
    if not cuda_used:
        return
    sys.stdout.flush()
    sys.stderr.flush()
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        kernel32.TerminateProcess.argtypes = (wintypes.HANDLE, wintypes.UINT)
        kernel32.TerminateProcess.restype = wintypes.BOOL
        kernel32.TerminateProcess(kernel32.GetCurrentProcess(), _exit_status)
    os._exit(_exit_status)
