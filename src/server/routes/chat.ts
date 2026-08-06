/**
 * Chat Routes — Ollama-powered LLM chat with RAG retrieval and live dashboard context.
 *
 * Static persona and domain knowledge are baked into the quantai-coder Modelfile.
 * This route injects only:
 *   1. Live dashboard state (~500 tokens) — current symbol, trained models, cache stats
 *   2. RAG-retrieved knowledge (~1500 tokens) — relevant chunks from project documents
 *
 * Routes:
 *   POST /api/chat/completions   — streaming chat completion (SSE)
 *   GET  /api/chat/models        — list available Ollama models
 *   GET  /api/chat/health        — check Ollama + RAG availability
 *   POST /api/chat/rag/ingest    — trigger RAG re-ingestion
 */

import * as fs from 'fs';
import * as path from 'path';
import { Router, type Request, type Response } from 'express';
import { ollamaChat, ollamaModels, ollamaHealth, DEFAULT_MODEL } from '../lib/ollama';
import type { OllamaMessage, OllamaStreamChunk, OllamaOptions } from '../lib/ollama';
import { listTrainedModels } from '../lib/modelResults';
import { getSymbolsCatalogCache } from '../cache/symbols';
import { getCacheStats } from '../cache';
import { retrieveContext, isRagReady, getRagStatus, initRag } from '../lib/rag';

const router = Router();

// ── Types ──────────────────────────────────────────────────

interface ChatCompletionBody {
  messages: { role: 'user' | 'assistant'; content: string }[];
  model?: string;
  options?: OllamaOptions;
  context?: {
    symbol?: string;
    assetType?: string;
    timeframeMinutes?: number;
    activeModel?: string;
    isTraining?: boolean;
  };
}

// ── Initialize RAG on module load ─────────────────────────

initRag().catch(() => { /* logged inside initRag */ });

// ── Dynamic context builder ───────────────────────────────
// Only live dashboard state — static knowledge is in the Modelfile.

function buildDynamicContext(dashboardContext?: ChatCompletionBody['context']): string {
  const parts: string[] = [];

  // Dashboard state from client
  if (dashboardContext) {
    const state: string[] = [];
    if (dashboardContext.symbol) state.push(`Current symbol: ${dashboardContext.symbol}`);
    if (dashboardContext.assetType) state.push(`Asset class: ${dashboardContext.assetType}`);
    if (dashboardContext.timeframeMinutes) state.push(`Timeframe: ${dashboardContext.timeframeMinutes}m`);
    if (dashboardContext.activeModel) state.push(`Active model: ${dashboardContext.activeModel}`);
    if (dashboardContext.isTraining) state.push('Training is currently in progress');
    if (state.length > 0) {
      parts.push(`## Current Dashboard State\n${state.join('\n')}`);
    }
  }

  // Trained models
  try {
    const modelsDir = path.join(process.cwd(), 'data', 'models');
    const models = listTrainedModels(modelsDir);
    if (models.length > 0) {
      const modelLines = models.slice(0, 10).map(m =>
        `- ${m.id}: ${m.modelType} on ${m.symbol} ${m.timeframe}, ${m.n_regimes} regimes, quality=${m.quality_score}, trained ${m.trained_at}`
      );
      parts.push(`## Trained Models (${models.length} total)\n${modelLines.join('\n')}`);
    } else {
      parts.push('## Trained Models\nNo models trained yet.');
    }
  } catch { /* models dir may not exist */ }

  // Symbol catalog
  try {
    const catalog = getSymbolsCatalogCache();
    if (catalog) {
      const futures = catalog.data.filter((s: any) => s.asset_class === 'futures');
      const forex = catalog.data.filter((s: any) => s.asset_class === 'forex');
      parts.push(`## Available Instruments\n${catalog.data.length} total: ${futures.length} futures, ${forex.length} forex`);
    }
  } catch { /* cache may not be warm */ }

  // Cache stats
  try {
    const stats = getCacheStats();
    parts.push(`## Cache Status\n- OHLCV: ${stats.ohlcv.entries} entries, ${stats.ohlcv.sizeMB.toFixed(1)}MB, hit rate ${stats.ohlcv.hitRate}\n- Query: ${stats.query.entries} entries, hit rate ${stats.query.hitRate}`);
  } catch { /* */ }

  // Feature config summary
  try {
    const featPath = path.resolve(process.cwd(), 'src', 'config', 'features.json');
    if (fs.existsSync(featPath)) {
      const featConfig = JSON.parse(fs.readFileSync(featPath, 'utf-8'));
      const categories = Object.keys(featConfig.categories || {});
      const featureCount = (featConfig.features || []).length;
      parts.push(`## Feature Config\n${featureCount} features across ${categories.length} categories: ${categories.join(', ')}`);
    }
  } catch { /* */ }

  if (parts.length === 0) return '';
  return parts.join('\n\n');
}

// ── POST /api/chat/completions ─────────────────────────────

router.post('/chat/completions', async (req: Request, res: Response) => {
  const body = req.body as ChatCompletionBody;

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

  const model = body.model || DEFAULT_MODEL;

  // Extract last user message for RAG query
  const lastUserMessage = [...body.messages]
    .reverse()
    .find(m => m.role === 'user')?.content || '';

  // Build system context: dynamic state + RAG retrieval
  const [dynamicContext, ragContext] = await Promise.all([
    Promise.resolve(buildDynamicContext(body.context)),
    lastUserMessage ? retrieveContext(lastUserMessage, 5) : Promise.resolve(''),
  ]);

  const systemParts = [dynamicContext, ragContext].filter(Boolean);
  const systemContent = systemParts.length > 0 ? systemParts.join('\n\n') : '';

  // Build full message array
  const messages: OllamaMessage[] = [];
  if (systemContent) {
    messages.push({ role: 'system', content: systemContent });
  }
  messages.push(
    ...body.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  );

  // Set up SSE response
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const abortController = new AbortController();

  req.on('close', () => {
    abortController.abort();
  });

  try {
    const ollamaRes = await ollamaChat(messages, model, abortController.signal, body.options);

    if (!ollamaRes.body) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'No response body from Ollama' })}\n\n`);
      res.end();
      return;
    }

    // Ollama streams newline-delimited JSON
    const reader = (ollamaRes.body as any).getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as OllamaStreamChunk;

          if (chunk.message?.content) {
            res.write(`event: token\ndata: ${JSON.stringify({ content: chunk.message.content })}\n\n`);
          }

          if (chunk.done) {
            res.write(`event: done\ndata: ${JSON.stringify({
              model: chunk.model,
              evalCount: chunk.eval_count,
              totalDuration: chunk.total_duration,
              ragEnabled: isRagReady(),
            })}\n\n`);
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      // Client disconnected — normal
    } else {
      const errorMsg = err.message || 'Unknown error';
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ error: errorMsg })}\n\n`);
      } catch {
        // Response already closed
      }
    }
  }

  try { res.end(); } catch { /* already closed */ }
});

// ── GET /api/chat/models ───────────────────────────────────

router.get('/chat/models', async (_req: Request, res: Response) => {
  try {
    const models = await ollamaModels();
    res.json({
      models,
      default: DEFAULT_MODEL,
    });
  } catch (err: any) {
    res.status(503).json({ error: err.message });
  }
});

// ── GET /api/chat/health ───────────────────────────────────

router.get('/chat/health', async (_req: Request, res: Response) => {
  const [healthy, ragStatus] = await Promise.all([
    ollamaHealth(),
    getRagStatus(),
  ]);
  res.json({
    healthy,
    url: process.env.OLLAMA_URL || 'http://localhost:11434',
    rag: ragStatus,
  });
});

// ── POST /api/chat/rag/ingest ──────────────────────────────

router.post('/chat/rag/ingest', async (_req: Request, res: Response) => {
  const { exec } = await import('child_process');
  const scriptPath = path.resolve(process.cwd(), 'scripts', 'rag_ingest.py');

  if (!fs.existsSync(scriptPath)) {
    res.status(404).json({ error: 'rag_ingest.py not found' });
    return;
  }

  // Fire-and-forget ingestion
  const child = exec(`python "${scriptPath}" --incremental`, {
    cwd: process.cwd(),
    timeout: 300_000, // 5 min max
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (d: string) => { stdout += d; });
  child.stderr?.on('data', (d: string) => { stderr += d; });

  child.on('close', async (code: number | null) => {
    if (code === 0) {
      // Reinitialize RAG to pick up new data
      await initRag();
      console.log(`[RAG] Incremental ingestion complete: ${stdout.trim()}`);
    } else {
      console.error(`[RAG] Ingestion failed (exit ${code}): ${stderr.trim()}`);
    }
  });

  res.json({ status: 'ingestion_started', mode: 'incremental' });
});

export default router;
