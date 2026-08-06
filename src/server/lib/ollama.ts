/**
 * Ollama HTTP client — chat streaming, embeddings, and model listing.
 *
 * Connects to local Ollama instance (default localhost:11434).
 * Streams chat completions as newline-delimited JSON chunks.
 * Provides embedding generation via nomic-embed-text for RAG pipeline.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'quantai-coder';
const DEFAULT_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
const CHAT_TIMEOUT_MS = 120_000; // 2 min — cold model load can be slow
const EMBED_TIMEOUT_MS = 30_000; // 30s — embeddings are fast

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaStreamChunk {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaModel {
  name: string;
  size: number;
  parameter_size: string;
  quantization_level: string;
  family: string;
}

export type OllamaOptions = Record<string, number | string | boolean>;

/**
 * Stream a chat completion from Ollama.
 * Returns the raw Response so the caller can pipe the body stream.
 *
 * Ollama streams newline-delimited JSON: each line is an OllamaStreamChunk.
 * The final chunk has `done: true` and includes timing/token stats.
 *
 * @param options - Per-request inference overrides (temperature, top_k, etc.).
 *                  These override the Modelfile defaults for this request only.
 */
export async function ollamaChat(
  messages: OllamaMessage[],
  model: string = DEFAULT_MODEL,
  signal?: AbortSignal,
  options?: OllamaOptions,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

  // Chain external signal to our controller
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...(options && { options }),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errBody = await res.text().catch(() => 'unknown error');
      throw new Error(`Ollama error ${res.status}: ${errBody}`);
    }

    return res;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      throw new Error('Ollama is not running. Start it with: ollama serve');
    }
    throw err;
  }
}

/**
 * Generate an embedding vector for a text input.
 *
 * Uses nomic-embed-text by default (768-dim, CPU-only, ~50ms on Ryzen 9).
 * Called by the RAG pipeline to embed queries at retrieval time.
 */
export async function ollamaEmbed(
  text: string,
  model: string = DEFAULT_EMBED_MODEL,
): Promise<number[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: text }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errBody = await res.text().catch(() => 'unknown error');
      throw new Error(`Ollama embed error ${res.status}: ${errBody}`);
    }

    const data = (await res.json()) as { embeddings: number[][] };
    if (!data.embeddings?.[0]) {
      throw new Error('Ollama returned empty embeddings');
    }
    return data.embeddings[0];
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      throw new Error('Ollama is not running. Start it with: ollama serve');
    }
    throw err;
  }
}

/**
 * Generate embedding vectors for multiple texts in a single request.
 * More efficient than calling ollamaEmbed() in a loop.
 */
export async function ollamaEmbedBatch(
  texts: string[],
  model: string = DEFAULT_EMBED_MODEL,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS * 2);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errBody = await res.text().catch(() => 'unknown error');
      throw new Error(`Ollama embed error ${res.status}: ${errBody}`);
    }

    const data = (await res.json()) as { embeddings: number[][] };
    if (!data.embeddings || data.embeddings.length !== texts.length) {
      throw new Error(`Expected ${texts.length} embeddings, got ${data.embeddings?.length ?? 0}`);
    }
    return data.embeddings;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      throw new Error('Ollama is not running. Start it with: ollama serve');
    }
    throw err;
  }
}

/**
 * List available Ollama models.
 */
export async function ollamaModels(): Promise<OllamaModel[]> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!res.ok) {
      throw new Error(`Ollama error ${res.status}`);
    }
    const data = (await res.json()) as { models: any[] };
    return data.models.map((m: any) => ({
      name: m.name,
      size: m.size,
      parameter_size: m.details?.parameter_size ?? 'unknown',
      quantization_level: m.details?.quantization_level ?? 'unknown',
      family: m.details?.family ?? 'unknown',
    }));
  } catch (err: any) {
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      throw new Error('Ollama is not running. Start it with: ollama serve');
    }
    throw err;
  }
}

/**
 * Check if Ollama is reachable.
 */
export async function ollamaHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export { DEFAULT_MODEL, DEFAULT_EMBED_MODEL, OLLAMA_URL };
