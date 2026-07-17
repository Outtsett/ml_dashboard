#!/usr/bin/env bash
# Launch aider with quantai-coder (Ollama) for the ML Dashboard.
#
# Usage:
#   bash scripts/aider.sh                    # Interactive mode
#   bash scripts/aider.sh src/server/lib/    # Start with specific files
#   bash scripts/aider.sh --message "fix X"  # One-shot mode

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Verify Ollama is running
if ! curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "ERROR: Ollama is not running. Start with: ollama serve" >&2
    exit 1
fi

# Verify quantai-coder model exists
if ! ollama show quantai-coder &>/dev/null 2>&1; then
    echo "quantai-coder model not found. Building..."
    bash scripts/create-modelfile.sh
fi

# Ollama API base for aider
export OLLAMA_API_BASE=http://localhost:11434

# Launch aider in the conda env
conda run -n aider aider "$@"
