/**
 * Ollama HTTP client — thin wrapper for chat streaming and model listing.
 *
 * Connects to local Ollama instance (default localhost:11434).
 * Streams chat completions as newline-delimited JSON chunks.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen3-coder:30b';
const CHAT_TIMEOUT_MS = 120_000; // 2 min — cold model load can be slow

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

/**
 * Stream a chat completion from Ollama.
 * Returns the raw Response so the caller can pipe the body stream.
 *
 * Ollama streams newline-delimited JSON: each line is an OllamaStreamChunk.
 * The final chunk has `done: true` and includes timing/token stats.
 */
export async function ollamaChat(
  messages: OllamaMessage[],
  model: string = DEFAULT_MODEL,
  signal?: AbortSignal,
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
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errBody = await res.text().catch(() => 'unknown error');
      throw new Error(`Ollama error ${res.status}: ${errBody}`);
    }

    return res;
  } catch (err) {
    clearTimeout(timeout);
    if (
      (err as { cause?: NodeJS.ErrnoException }).cause?.code === 'ECONNREFUSED' ||
      (err as Error).message?.includes('ECONNREFUSED')
    ) {
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
    const data = await res.json() as { models: any[] };
    return data.models.map((m: any) => ({
      name: m.name,
      size: m.size,
      parameter_size: m.details?.parameter_size ?? 'unknown',
      quantization_level: m.details?.quantization_level ?? 'unknown',
      family: m.details?.family ?? 'unknown',
    }));
  } catch (err) {
    if (
      (err as { cause?: NodeJS.ErrnoException }).cause?.code === 'ECONNREFUSED' ||
      (err as Error).message?.includes('ECONNREFUSED')
    ) {
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

export { DEFAULT_MODEL, OLLAMA_URL };
