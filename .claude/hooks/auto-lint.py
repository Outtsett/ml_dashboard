"""Claude Code PostToolUse hook: auto-fix imports after file edits."""

import json
import subprocess
import sys


def main() -> None:
    data = json.loads(sys.stdin.read())
    fp = data.get("tool_input", {}).get("file_path", "")
    if not fp:
        sys.exit(0)

    if fp.endswith(".py"):
        subprocess.run(
            ["ruff", "check", "--fix", "--select", "F401,I", fp],
            capture_output=True,
        )
    elif fp.endswith((".ts", ".tsx")):
        subprocess.run(
            ["npx", "eslint", "--fix", fp],
            capture_output=True,
        )


if __name__ == "__main__":
    main()
