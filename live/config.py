"""packages/config/live.json, and the credentials the hub needs, read by name."""

from __future__ import annotations

import json
import os
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CONFIG_PATH = REPO / "packages" / "config" / "live.json"


def load() -> dict:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def secret(name: str) -> str | None:
    """An environment variable by name â€” the process's own first, then the
    Windows user environment, where dotfiles/apply.ps1 puts every credential.
    The second matters: a dashboard started before a key was added passes this
    process an environment without it."""
    value = os.environ.get(name)
    if value:
        return value
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            value, _ = winreg.QueryValueEx(key, name)
            return str(value) or None
    except OSError:
        return None


def spool_dir(config: dict) -> Path:
    path = REPO / config.get("spoolDir", "data/live/spool")
    path.mkdir(parents=True, exist_ok=True)
    return path

