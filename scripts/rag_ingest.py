#!/usr/bin/env python3
"""
RAG Document Ingestion Pipeline

Walks project directories, chunks documents by type, embeds via Ollama
nomic-embed-text, and upserts into LanceDB for semantic retrieval.

Usage:
    python scripts/rag_ingest.py --full              # Full reindex
    python scripts/rag_ingest.py --incremental       # Only changed files
    python scripts/rag_ingest.py --source claude      # Only CLAUDE.md
    python scripts/rag_ingest.py --source models      # Only model artifacts
    python scripts/rag_ingest.py --source features    # Only feature config
    python scripts/rag_ingest.py --source specs       # Only spec/plan docs
    python scripts/rag_ingest.py --source routes      # Only API route docs
    python scripts/rag_ingest.py --stats              # Show ingestion stats
"""

import argparse
import hashlib
import json
import re
import sys
import time
from pathlib import Path
from typing import Optional

import requests

# ── Configuration ──────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LANCE_DB_PATH = PROJECT_ROOT / "data" / "rag" / "vectors.lance"
STATE_FILE = PROJECT_ROOT / "data" / "rag" / "ingest_state.json"

OLLAMA_URL = "http://localhost:11434"
EMBED_MODEL = "nomic-embed-text"
EMBED_DIM = 768

# Chunking parameters
MAX_CHUNK_TOKENS = 500
OVERLAP_TOKENS = 50
MIN_CHUNK_TOKENS = 20

# ── Source Definitions ─────────────────────────────────────

SOURCES = {
    "claude": {
        "paths": [PROJECT_ROOT / "CLAUDE.md"],
        "doc_type": "project_docs",
        "chunker": "markdown",
    },
    "features": {
        "paths": [PROJECT_ROOT / "src" / "config" / "features.json"],
        "doc_type": "feature_config",
        "chunker": "json_categories",
    },
    "models": {
        "paths": [PROJECT_ROOT / "data" / "models"],
        "doc_type": "training_log",
        "glob": "*/diagnostics.json",
        "chunker": "json_whole",
    },
    "convergence": {
        "paths": [PROJECT_ROOT / "data" / "models"],
        "doc_type": "evaluation",
        "glob": "*/convergence.json",
        "chunker": "json_tail",
    },
    "specs": {
        "paths": [
            PROJECT_ROOT / "docs" / "plans",
            PROJECT_ROOT / "docs" / "superpowers" / "specs",
        ],
        "doc_type": "spec",
        "glob": "*.md",
        "chunker": "markdown",
    },
    "routes": {
        "paths": [PROJECT_ROOT / "src" / "server" / "routes"],
        "doc_type": "api_docs",
        "glob": "*.ts",
        "chunker": "typescript_jsdoc",
    },
    "trading_notes": {
        "paths": [PROJECT_ROOT / "data" / "trading_notes"],
        "doc_type": "trading_notes",
        "glob": "*.md",
        "chunker": "markdown_paragraphs",
    },
    "questdb_patterns": {
        "paths": [PROJECT_ROOT / "data" / "rag" / "questdb_patterns.md"],
        "doc_type": "query_pattern",
        "chunker": "markdown",
    },
}


# ── Token Estimation ───────────────────────────────────────

def estimate_tokens(text: str) -> int:
    """Rough token count: word count / 0.75."""
    return max(1, int(len(text.split()) / 0.75))


# ── Chunkers ───────────────────────────────────────────────

def chunk_markdown(text: str, source_name: str) -> list[dict]:
    """Split markdown on ## headers. If a section exceeds MAX_CHUNK_TOKENS,
    split on ### headers, then on paragraph boundaries."""
    chunks = []
    sections = re.split(r'^(## .+)$', text, flags=re.MULTILINE)

    # First element is content before any ## header
    current_section = "Introduction"
    buffer = ""

    for part in sections:
        if part.startswith("## "):
            # Flush previous section
            if buffer.strip():
                chunks.extend(_split_large_chunk(buffer.strip(), source_name, current_section))
            current_section = part.replace("## ", "").strip()
            buffer = ""
        else:
            buffer += part

    # Flush final section
    if buffer.strip():
        chunks.extend(_split_large_chunk(buffer.strip(), source_name, current_section))

    return chunks


def _split_large_chunk(text: str, source: str, section: str) -> list[dict]:
    """Recursively split chunks that exceed MAX_CHUNK_TOKENS."""
    if estimate_tokens(text) <= MAX_CHUNK_TOKENS:
        return [{"text": text, "source": source, "section": section}]

    # Try splitting on ### headers
    sub_sections = re.split(r'^(### .+)$', text, flags=re.MULTILINE)
    if len(sub_sections) > 1:
        results = []
        sub_section = section
        sub_buffer = ""
        for part in sub_sections:
            if part.startswith("### "):
                if sub_buffer.strip():
                    results.extend(_split_large_chunk(sub_buffer.strip(), source, sub_section))
                sub_section = f"{section} > {part.replace('### ', '').strip()}"
                sub_buffer = ""
            else:
                sub_buffer += part
        if sub_buffer.strip():
            results.extend(_split_large_chunk(sub_buffer.strip(), source, sub_section))
        return results

    # Fall back to paragraph splitting
    paragraphs = text.split("\n\n")
    results = []
    current = ""
    for para in paragraphs:
        if estimate_tokens(current + "\n\n" + para) > MAX_CHUNK_TOKENS and current.strip():
            results.append({"text": current.strip(), "source": source, "section": section})
            # Overlap: keep last OVERLAP_TOKENS worth of text
            words = current.split()
            overlap_words = int(OVERLAP_TOKENS * 0.75)
            current = " ".join(words[-overlap_words:]) + "\n\n" + para if overlap_words < len(words) else para
        else:
            current = current + "\n\n" + para if current else para

    if current.strip():
        results.append({"text": current.strip(), "source": source, "section": section})

    return results


def chunk_markdown_paragraphs(text: str, source_name: str) -> list[dict]:
    """Split on paragraph boundaries, ~300 tokens per chunk."""
    paragraphs = text.split("\n\n")
    chunks = []
    current = ""
    section = source_name

    # Try to extract a title from the first line
    first_line = text.strip().split("\n")[0]
    if first_line.startswith("# "):
        section = first_line.replace("# ", "").strip()

    for para in paragraphs:
        if estimate_tokens(current + "\n\n" + para) > 300 and current.strip():
            chunks.append({"text": current.strip(), "source": source_name, "section": section})
            words = current.split()
            overlap_words = int(OVERLAP_TOKENS * 0.75)
            current = " ".join(words[-overlap_words:]) + "\n\n" + para if overlap_words < len(words) else para
        else:
            current = current + "\n\n" + para if current else para

    if current.strip():
        chunks.append({"text": current.strip(), "source": source_name, "section": section})

    return chunks


def chunk_json_categories(text: str, source_name: str) -> list[dict]:
    """Split JSON config by top-level categories."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return [{"text": text[:2000], "source": source_name, "section": "parse_error"}]

    chunks = []
    categories = data.get("categories", {})
    for cat_name, cat_data in categories.items():
        chunk_text = f"Feature category: {cat_name}\n{json.dumps(cat_data, indent=2)}"
        chunks.append({"text": chunk_text, "source": source_name, "section": cat_name})

    features = data.get("features", [])
    if features:
        feat_text = f"Feature list ({len(features)} features):\n"
        feat_text += "\n".join(f"- {f.get('name', f)}: {f.get('description', '')}" if isinstance(f, dict) else f"- {f}" for f in features[:50])
        chunks.append({"text": feat_text, "source": source_name, "section": "feature_list"})

    return chunks


def chunk_json_whole(text: str, source_name: str) -> list[dict]:
    """Treat whole JSON as one chunk (for small files like diagnostics)."""
    try:
        data = json.loads(text)
        # Extract model ID from the data if available
        model_id = data.get("model_id", data.get("id", source_name))
        summary_parts = []
        for key, value in data.items():
            if isinstance(value, (str, int, float, bool)):
                summary_parts.append(f"{key}: {value}")
            elif isinstance(value, list) and len(value) <= 5:
                summary_parts.append(f"{key}: {value}")
        chunk_text = f"Model diagnostics for {model_id}:\n" + "\n".join(summary_parts)
        return [{"text": chunk_text, "source": source_name, "section": str(model_id)}]
    except json.JSONDecodeError:
        return [{"text": text[:2000], "source": source_name, "section": "parse_error"}]


def chunk_json_tail(text: str, source_name: str) -> list[dict]:
    """Extract last 10 entries from convergence JSON arrays."""
    try:
        data = json.loads(text)
        if isinstance(data, list):
            tail = data[-10:]
            chunk_text = f"Convergence (last {len(tail)} entries):\n{json.dumps(tail, indent=2)}"
            return [{"text": chunk_text, "source": source_name, "section": "convergence_tail"}]
        elif isinstance(data, dict):
            # Some convergence files are dicts with arrays
            summary = {}
            for key, val in data.items():
                if isinstance(val, list):
                    summary[key] = val[-10:]
                else:
                    summary[key] = val
            chunk_text = f"Convergence summary:\n{json.dumps(summary, indent=2)}"
            return [{"text": chunk_text, "source": source_name, "section": "convergence_summary"}]
    except json.JSONDecodeError:
        pass
    return [{"text": text[:2000], "source": source_name, "section": "parse_error"}]


def chunk_typescript_jsdoc(text: str, source_name: str) -> list[dict]:
    """Extract JSDoc blocks + exported function/route signatures from TypeScript."""
    chunks = []

    # Extract JSDoc blocks with following function/const/router declarations
    pattern = r'(/\*\*[\s\S]*?\*/)\s*((?:export\s+)?(?:async\s+)?(?:function|const|router\.(?:get|post|put|delete|patch))\s*[^\n]+)'
    matches = re.findall(pattern, text)

    for jsdoc, signature in matches:
        # Clean up JSDoc
        clean_doc = re.sub(r'\s*\*\s?', '\n', jsdoc).strip().strip('/')
        chunk_text = f"{clean_doc}\n\nSignature: {signature.strip()}"
        # Extract function/route name
        name_match = re.search(r'(?:function|const)\s+(\w+)|(?:router\.(?:get|post|put|delete|patch))\s*\([\'"]([^\'"]+)', signature)
        section = name_match.group(1) or name_match.group(2) if name_match else source_name
        chunks.append({"text": chunk_text, "source": source_name, "section": section})

    # If no JSDoc found, extract route definitions
    if not chunks:
        route_pattern = r'router\.(get|post|put|delete|patch)\s*\([\'"]([^\'"]+)[\'"]'
        routes = re.findall(route_pattern, text)
        if routes:
            route_text = f"Routes in {source_name}:\n" + "\n".join(f"- {method.upper()} {path}" for method, path in routes)
            chunks.append({"text": route_text, "source": source_name, "section": "routes"})

    return chunks


CHUNKER_MAP = {
    "markdown": chunk_markdown,
    "markdown_paragraphs": chunk_markdown_paragraphs,
    "json_categories": chunk_json_categories,
    "json_whole": chunk_json_whole,
    "json_tail": chunk_json_tail,
    "typescript_jsdoc": chunk_typescript_jsdoc,
}


# ── Embedding ──────────────────────────────────────────────

def embed_texts(texts: list[str], batch_size: int = 32) -> list[list[float]]:
    """Embed texts via Ollama /api/embed endpoint."""
    all_embeddings = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        try:
            resp = requests.post(
                f"{OLLAMA_URL}/api/embed",
                json={"model": EMBED_MODEL, "input": batch},
                timeout=60,
            )
            resp.raise_for_status()
            data = resp.json()
            embeddings = data.get("embeddings", [])
            if len(embeddings) != len(batch):
                raise ValueError(f"Expected {len(batch)} embeddings, got {len(embeddings)}")
            all_embeddings.extend(embeddings)
        except requests.exceptions.ConnectionError:
            print(f"ERROR: Cannot connect to Ollama at {OLLAMA_URL}. Is it running?", file=sys.stderr)
            sys.exit(1)
        except Exception as e:
            print(f"ERROR: Embedding failed: {e}", file=sys.stderr)
            sys.exit(1)

        if i + batch_size < len(texts):
            print(f"  Embedded {min(i + batch_size, len(texts))}/{len(texts)} chunks...", flush=True)

    return all_embeddings


# ── File Collection ────────────────────────────────────────

def collect_files(source_key: str) -> list[Path]:
    """Collect all files for a given source definition."""
    source_def = SOURCES[source_key]
    files = []

    for base_path in source_def["paths"]:
        if not base_path.exists():
            continue

        if base_path.is_file():
            files.append(base_path)
        elif base_path.is_dir():
            glob_pattern = source_def.get("glob", "*")
            files.extend(sorted(base_path.glob(glob_pattern)))

    return files


def file_hash(filepath: Path) -> str:
    """SHA-256 hash of file contents."""
    return hashlib.sha256(filepath.read_bytes()).hexdigest()


# ── State Management ───────────────────────────────────────

def load_state() -> dict:
    """Load ingestion state (file hashes for dedup)."""
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state: dict) -> None:
    """Save ingestion state."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


# ── Main Ingestion ─────────────────────────────────────────

def ingest(
    sources: Optional[list[str]] = None,
    incremental: bool = False,
) -> dict:
    """Run ingestion pipeline.

    Returns dict with ingestion stats.
    """
    try:
        import lancedb
        import pyarrow as pa  # noqa: F401  — imported to probe availability
    except ImportError:
        print("ERROR: lancedb and pyarrow required. Run: pip install lancedb pyarrow", file=sys.stderr)
        sys.exit(1)

    # Ensure embedding model is available
    try:
        test_resp = requests.post(
            f"{OLLAMA_URL}/api/embed",
            json={"model": EMBED_MODEL, "input": "test"},
            timeout=30,
        )
        if test_resp.status_code == 404:
            print(f"Embedding model '{EMBED_MODEL}' not found. Pulling...", flush=True)
            pull_resp = requests.post(
                f"{OLLAMA_URL}/api/pull",
                json={"name": EMBED_MODEL},
                timeout=300,
                stream=True,
            )
            for line in pull_resp.iter_lines():
                if line:
                    status = json.loads(line)
                    if "status" in status:
                        print(f"  {status['status']}", flush=True)
            print(f"Model '{EMBED_MODEL}' ready.", flush=True)
        test_resp.raise_for_status()
    except requests.exceptions.ConnectionError:
        print(f"ERROR: Cannot connect to Ollama at {OLLAMA_URL}. Is it running?", file=sys.stderr)
        sys.exit(1)

    state = load_state() if incremental else {}
    source_keys = sources if sources else list(SOURCES.keys())

    all_chunks = []
    files_processed = 0
    files_skipped = 0

    for source_key in source_keys:
        if source_key not in SOURCES:
            print(f"WARNING: Unknown source '{source_key}', skipping", file=sys.stderr)
            continue

        source_def = SOURCES[source_key]
        chunker = CHUNKER_MAP[source_def["chunker"]]
        doc_type = source_def["doc_type"]
        files = collect_files(source_key)

        print(f"\n[{source_key}] Found {len(files)} file(s)")

        for filepath in files:
            fhash = file_hash(filepath)
            state_key = str(filepath.relative_to(PROJECT_ROOT))

            if incremental and state.get(state_key) == fhash:
                files_skipped += 1
                continue

            try:
                text = filepath.read_text(encoding="utf-8", errors="replace")
            except Exception as e:
                print(f"  WARNING: Cannot read {filepath}: {e}", file=sys.stderr)
                continue

            if estimate_tokens(text) < MIN_CHUNK_TOKENS:
                continue

            source_name = filepath.name
            chunks = chunker(text, source_name)

            # Filter tiny chunks
            chunks = [c for c in chunks if estimate_tokens(c["text"]) >= MIN_CHUNK_TOKENS]

            for chunk in chunks:
                chunk["doc_type"] = doc_type

            all_chunks.extend(chunks)
            state[state_key] = fhash
            files_processed += 1
            print(f"  {source_name}: {len(chunks)} chunks")

    if not all_chunks:
        print("\nNo new chunks to ingest.")
        save_state(state)
        return {"files_processed": 0, "files_skipped": files_skipped, "chunks": 0}

    # Embed all chunks
    print(f"\nEmbedding {len(all_chunks)} chunks via {EMBED_MODEL}...")
    t0 = time.time()
    texts = [c["text"] for c in all_chunks]
    embeddings = embed_texts(texts)
    embed_time = time.time() - t0
    print(f"Embedding complete in {embed_time:.1f}s ({len(all_chunks) / max(embed_time, 0.001):.0f} chunks/s)")

    # Build records for LanceDB
    records = []
    for i, chunk in enumerate(all_chunks):
        chunk_id = hashlib.sha256(
            f"{chunk['source']}:{chunk['section']}:{chunk['text'][:200]}".encode()
        ).hexdigest()[:16]

        records.append({
            "id": chunk_id,
            "text": chunk["text"],
            "vector": embeddings[i],
            "source": chunk["source"],
            "section": chunk["section"],
            "doc_type": chunk["doc_type"],
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        })

    # Write to LanceDB
    print(f"\nWriting {len(records)} records to LanceDB at {LANCE_DB_PATH}...")
    LANCE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    db = lancedb.connect(str(LANCE_DB_PATH))

    if incremental:
        # Append mode: add new chunks (LanceDB handles dedup by overwrite)
        try:
            tbl = db.open_table("documents")
            tbl.add(records)
            total_rows = tbl.count_rows()
        except Exception:
            # Table doesn't exist yet, create it
            tbl = db.create_table("documents", records, mode="overwrite")
            total_rows = len(records)
    else:
        # Full reindex: overwrite entire table
        tbl = db.create_table("documents", records, mode="overwrite")
        total_rows = len(records)

    save_state(state)

    stats = {
        "files_processed": files_processed,
        "files_skipped": files_skipped,
        "chunks": len(records),
        "total_rows": total_rows,
        "embed_time_s": round(embed_time, 1),
    }

    print(f"\nIngestion complete:")
    print(f"  Files processed: {files_processed}")
    print(f"  Files skipped (unchanged): {files_skipped}")
    print(f"  Chunks ingested: {len(records)}")
    print(f"  Total rows in DB: {total_rows}")
    print(f"  Embedding time: {embed_time:.1f}s")

    return stats


def show_stats() -> None:
    """Display current ingestion state and DB stats."""
    try:
        import lancedb
    except ImportError:
        print("ERROR: lancedb required. Run: pip install lancedb", file=sys.stderr)
        sys.exit(1)

    state = load_state()
    print(f"Ingestion state: {len(state)} files tracked")
    for path_str, fhash in sorted(state.items()):
        print(f"  {path_str}: {fhash[:12]}...")

    if LANCE_DB_PATH.exists():
        db = lancedb.connect(str(LANCE_DB_PATH))
        try:
            tbl = db.open_table("documents")
            count = tbl.count_rows()
            print(f"\nLanceDB: {count} document chunks")
        except Exception as e:
            print(f"\nLanceDB: error opening table: {e}")
    else:
        print(f"\nLanceDB: not initialized (no data at {LANCE_DB_PATH})")


# ── CLI ────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="RAG Document Ingestion Pipeline")
    parser.add_argument("--full", action="store_true", help="Full reindex of all sources")
    parser.add_argument("--incremental", action="store_true", help="Only process changed files")
    parser.add_argument("--source", type=str, help=f"Ingest specific source: {', '.join(SOURCES.keys())}")
    parser.add_argument("--stats", action="store_true", help="Show ingestion statistics")
    args = parser.parse_args()

    if args.stats:
        show_stats()
        return

    if not args.full and not args.incremental and not args.source:
        parser.print_help()
        print(f"\nAvailable sources: {', '.join(SOURCES.keys())}")
        return

    sources = [args.source] if args.source else None
    incremental = args.incremental and not args.full

    ingest(sources=sources, incremental=incremental)


if __name__ == "__main__":
    main()
