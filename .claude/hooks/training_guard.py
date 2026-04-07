"""Claude Code PreToolUse hook: guard GPU resources before ML training runs."""

import json
import re
import subprocess
import sys

# Patterns that indicate a training run is being launched
TRAINING_PATTERNS = [
    r"\bpython\b.*\btrain",
    r"\bpython\b.*\bfit\b",
    r"\bpython\b.*training_runner",
    r"\bpython\b.*walkforward",
    r"\.venv[\\/].*python.*\btrain",
    r"\bconda\s+run\b.*\btrain",
]

COMPILED_TRAINING = [re.compile(p, re.IGNORECASE) for p in TRAINING_PATTERNS]

# VRAM usage threshold (percentage) — block if above this
VRAM_THRESHOLD = 60


def is_training_command(command: str) -> bool:
    """Check if command looks like a training launch."""
    return any(p.search(command) for p in COMPILED_TRAINING)


def check_gpu_vram() -> tuple[bool, str]:
    """Check GPU VRAM usage via nvidia-smi. Returns (is_overloaded, message)."""
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total,memory.free", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return False, "nvidia-smi failed — cannot check GPU state"

        lines = result.stdout.strip().split("\n")
        for i, line in enumerate(lines):
            parts = [int(x.strip()) for x in line.split(",")]
            if len(parts) >= 3:
                used, total, free = parts[0], parts[1], parts[2]
                usage_pct = (used / total) * 100 if total > 0 else 0
                if usage_pct > VRAM_THRESHOLD:
                    return True, (
                        f"GPU {i}: {used}MB / {total}MB used ({usage_pct:.0f}%). "
                        f"Free: {free}MB. Threshold: {VRAM_THRESHOLD}%. "
                        f"Another process may be using the GPU. "
                        f"Check with 'nvidia-smi' before proceeding."
                    )
                return False, f"GPU {i}: {used}MB / {total}MB ({usage_pct:.0f}%) — OK"

    except FileNotFoundError:
        return False, "nvidia-smi not found — GPU check skipped"
    except subprocess.TimeoutExpired:
        return False, "nvidia-smi timed out — GPU check skipped"
    except (ValueError, IndexError):
        return False, "Could not parse nvidia-smi output"

    return False, "No GPU found"


def check_metric_emission(command: str) -> bool:
    """Heuristic check for whether the training script likely emits metrics."""
    # Check if the command references scripts known to emit metrics
    known_metric_scripts = ["training_runner", "walkforward", "panel_dashboard"]
    return any(s in command.lower() for s in known_metric_scripts)


def main() -> None:
    try:
        data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)

    tool_input = data.get("tool_input", {})
    command = tool_input.get("command", "")

    if not command or not is_training_command(command):
        sys.exit(0)

    # Check GPU VRAM
    overloaded, gpu_msg = check_gpu_vram()

    if overloaded:
        result = {
            "hookSpecificOutput": {"permissionDecision": "ask"},
            "systemMessage": f"GPU OVERLOADED — training may OOM or degrade performance. {gpu_msg}",
        }
        print(json.dumps(result), file=sys.stderr)
        sys.exit(2)

    # Advisory: check for metric emission
    warnings = []
    if not check_metric_emission(command):
        warnings.append(
            "This training command may not emit metrics via emit_metric(). "
            "Verify metrics stream to the dashboard before starting long training runs."
        )

    if warnings:
        result = {
            "systemMessage": f"TRAINING ADVISORY: {' '.join(warnings)} GPU status: {gpu_msg}",
        }
        print(json.dumps(result))

    sys.exit(0)


if __name__ == "__main__":
    main()
