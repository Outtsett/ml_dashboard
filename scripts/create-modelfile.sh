#!/usr/bin/env bash
# Build and register the quantai-coder custom Ollama model.
#
# Usage:
#   bash scripts/create-modelfile.sh           # Build model
#   bash scripts/create-modelfile.sh --rebuild  # Force rebuild

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MODELFILE="$PROJECT_ROOT/ollama/Modelfile"
MODEL_NAME="quantai-coder"
ENV_FILE="$PROJECT_ROOT/.env"

# ── Preflight checks ──────────────────────────────────────

if ! command -v ollama &>/dev/null; then
    echo "ERROR: ollama not found in PATH" >&2
    exit 1
fi

if ! curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "ERROR: Ollama is not running. Start with: ollama serve" >&2
    exit 1
fi

if [ ! -f "$MODELFILE" ]; then
    echo "ERROR: Modelfile not found at $MODELFILE" >&2
    exit 1
fi

# ── Check if model already exists ─────────────────────────

FORCE_REBUILD=false
if [ "${1:-}" = "--rebuild" ]; then
    FORCE_REBUILD=true
fi

if ! $FORCE_REBUILD && ollama show "$MODEL_NAME" &>/dev/null 2>&1; then
    echo "Model '$MODEL_NAME' already exists."
    echo "Use --rebuild to force recreation."
    ollama show "$MODEL_NAME" --modelfile | head -20
    exit 0
fi

# ── Build the model ───────────────────────────────────────

echo "Building '$MODEL_NAME' from $MODELFILE..."
echo "Base model: qwen3-coder:30b"
echo ""

ollama create "$MODEL_NAME" -f "$MODELFILE"

# ── Validate ──────────────────────────────────────────────

echo ""
echo "Validating model..."
if ollama show "$MODEL_NAME" &>/dev/null 2>&1; then
    echo "Model '$MODEL_NAME' created successfully."
    echo ""
    echo "Parameters:"
    ollama show "$MODEL_NAME" --modelfile | grep "^PARAMETER" || true
    echo ""

    # Update .env if it exists
    if [ -f "$ENV_FILE" ]; then
        if grep -q "^OLLAMA_MODEL=" "$ENV_FILE"; then
            sed -i "s/^OLLAMA_MODEL=.*/OLLAMA_MODEL=$MODEL_NAME/" "$ENV_FILE"
            echo "Updated $ENV_FILE: OLLAMA_MODEL=$MODEL_NAME"
        else
            echo "OLLAMA_MODEL=$MODEL_NAME" >> "$ENV_FILE"
            echo "Added OLLAMA_MODEL=$MODEL_NAME to $ENV_FILE"
        fi
    fi

    echo ""
    echo "Test with: ollama run $MODEL_NAME \"What is HDP-HMM?\""
else
    echo "ERROR: Model creation failed" >&2
    exit 1
fi
