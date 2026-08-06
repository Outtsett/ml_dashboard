/**
 * RAG (Retrieval-Augmented Generation) module.
 *
 * Embedded LanceDB vector store for semantic search over project documents.
 * Uses nomic-embed-text via Ollama for query embedding (768-dim, CPU-only).
 *
 * Architecture:
 *   Query -> ollamaEmbed() -> LanceDB search -> formatted context string
 *   The context string is injected into the chat system message alongside
 *   live dashboard state. The Modelfile handles the static persona/knowledge.
 *
 * Data is ingested by scripts/rag_ingest.py (Python) and stored in
 * data/rag/vectors.lance (Lance columnar format on disk).
 */

import * as path from 'path';
import * as fs from 'fs';
import { ollamaEmbed } from './ollama';

// LanceDB types — imported dynamically to handle missing dependency gracefully
let lancedb: typeof import('@lancedb/lancedb') | null = null;
let db: any = null;
let table: any = null;

const LANCE_DB_PATH = path.resolve(process.cwd(), 'data', 'rag', 'vectors.lance');
const DEFAULT_TOP_K = 5;
const MAX_CONTEXT_TOKENS = 2000; // Approximate max tokens for RAG context

/** Schema for documents stored in LanceDB */
export interface RagDocument {
  id: string;
  text: string;
  vector: number[];
  source: string;       // e.g., "CLAUDE.md", "diagnostics.json"
  section: string;      // e.g., "Feature Engineering", "MNQ_1m_hdp_hmm"
  doc_type: string;     // project_docs, training_log, evaluation, feature_config, api_docs, spec, trading_notes, query_pattern
  created_at: string;   // ISO 8601
}

/** A retrieved chunk with its similarity score */
export interface RetrievedChunk {
  text: string;
  source: string;
  section: string;
  doc_type: string;
  score: number;
}

/**
 * Initialize LanceDB connection. Called once at server start.
 * Fails silently if LanceDB is not installed or the database doesn't exist yet
 * (before first ingestion run).
 */
export async function initRag(): Promise<boolean> {
  try {
    lancedb = await import('@lancedb/lancedb');
  } catch {
    console.warn('[RAG] @lancedb/lancedb not installed — RAG disabled. Run: npm install @lancedb/lancedb');
    return false;
  }

  const dbDir = path.dirname(LANCE_DB_PATH);
  if (!fs.existsSync(dbDir)) {
    console.warn(`[RAG] Data directory ${dbDir} does not exist — RAG disabled. Run: python scripts/rag_ingest.py --full`);
    return false;
  }

  try {
    db = await lancedb.connect(LANCE_DB_PATH);
    const tableNames = await db.tableNames();
    if (tableNames.includes('documents')) {
      table = await db.openTable('documents');
      const rowCount = await table.countRows();
      console.log(`[RAG] Initialized — ${rowCount} document chunks loaded from ${LANCE_DB_PATH}`);
      return true;
    } else {
      console.warn('[RAG] No "documents" table found — RAG disabled. Run: python scripts/rag_ingest.py --full');
      return false;
    }
  } catch (err: any) {
    console.warn(`[RAG] Failed to open LanceDB: ${err.message} — RAG disabled`);
    return false;
  }
}

/**
 * Check if RAG is available and has data.
 */
export function isRagReady(): boolean {
  return table !== null;
}

/**
 * Retrieve relevant document chunks for a user query.
 *
 * 1. Embeds the query via Ollama nomic-embed-text
 * 2. Searches LanceDB for top-K most similar chunks
 * 3. Formats results with source attribution
 *
 * Returns empty string if RAG is not initialized or query fails.
 */
export async function retrieveContext(
  query: string,
  topK: number = DEFAULT_TOP_K,
): Promise<string> {
  if (!table) return '';

  try {
    // Embed the query
    const queryVector = await ollamaEmbed(query);

    // Search LanceDB
    const results = await table
      .vectorSearch(queryVector)
      .limit(topK)
      .toArray();

    if (!results || results.length === 0) return '';

    // Format retrieved chunks with source attribution
    const chunks: RetrievedChunk[] = results.map((r: any) => ({
      text: r.text,
      source: r.source,
      section: r.section,
      doc_type: r.doc_type,
      score: r._distance != null ? 1 / (1 + r._distance) : 0, // Convert L2 distance to similarity
    }));

    // Sort by relevance (highest similarity first)
    chunks.sort((a, b) => b.score - a.score);

    // Build context string, respecting token budget
    const lines: string[] = ['## Relevant Knowledge'];
    let estimatedTokens = 5; // Header

    for (const chunk of chunks) {
      const header = `[Source: ${chunk.source} > ${chunk.section}]`;
      const entry = `${header}\n${chunk.text}`;
      const entryTokens = Math.ceil(entry.split(/\s+/).length / 0.75); // Rough token estimate

      if (estimatedTokens + entryTokens > MAX_CONTEXT_TOKENS) break;

      lines.push(entry);
      estimatedTokens += entryTokens;
    }

    return lines.length > 1 ? lines.join('\n\n') : '';
  } catch (err: any) {
    console.error(`[RAG] Retrieval failed: ${err.message}`);
    return '';
  }
}

/**
 * Retrieve raw chunks with scores (for debugging/inspection).
 */
export async function retrieveChunks(
  query: string,
  topK: number = DEFAULT_TOP_K,
): Promise<RetrievedChunk[]> {
  if (!table) return [];

  try {
    const queryVector = await ollamaEmbed(query);
    const results = await table
      .vectorSearch(queryVector)
      .limit(topK)
      .toArray();

    return (results || []).map((r: any) => ({
      text: r.text,
      source: r.source,
      section: r.section,
      doc_type: r.doc_type,
      score: r._distance != null ? 1 / (1 + r._distance) : 0,
    }));
  } catch (err: any) {
    console.error(`[RAG] Chunk retrieval failed: ${err.message}`);
    return [];
  }
}

/**
 * Get RAG status info for health checks.
 */
export async function getRagStatus(): Promise<{
  ready: boolean;
  documentCount: number;
  dbPath: string;
}> {
  if (!table) {
    return { ready: false, documentCount: 0, dbPath: LANCE_DB_PATH };
  }

  try {
    const count = await table.countRows();
    return { ready: true, documentCount: count, dbPath: LANCE_DB_PATH };
  } catch {
    return { ready: false, documentCount: 0, dbPath: LANCE_DB_PATH };
  }
}
