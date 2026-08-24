/**
 * Chat Routes — Ollama-powered LLM chat with deep dashboard context.
 *
 * The system prompt is enriched with live dashboard state:
 * trained models, instruments, database stats, feature config, label generators.
 *
 * Routes:
 *   POST /api/chat/completions   — streaming chat completion (SSE)
 *   GET  /api/chat/models        — list available Ollama models
 *   GET  /api/chat/health        — check Ollama availability
 */

import * as fs from 'fs';
import * as path from 'path';
import { Router, type Request, type Response } from 'express';
import { ollamaChat, ollamaModels, ollamaHealth, DEFAULT_MODEL } from '../infrastructure/lib/ollama';
import type { OllamaMessage, OllamaStreamChunk } from '../infrastructure/lib/ollama';
import { listTrainedModels } from '../infrastructure/lib/modelResults';
import { getSymbolsCatalogCache } from '../infrastructure/cache/symbols';
import { getCacheStats } from '../infrastructure/cache';

const router = Router();

// ── Types ──────────────────────────────────────────────────

interface ChatCompletionBody {
  messages: { role: 'user' | 'assistant'; content: string }[];
  model?: string;
  context?: {
    symbol?: string;
    assetType?: string;
    timeframeMinutes?: number;
    activeModel?: string;
    isTraining?: boolean;
  };
}

// ── Dashboard knowledge base ───────────────────────────────

const DASHBOARD_KNOWLEDGE = `You are the AI assistant embedded in the QuantAI trading dashboard — a professional-grade quantitative trading platform for CME Micro Futures (MNQ, MES, MYM, M2K) and Forex pairs.

## Your Role
You are a quantitative trading expert with deep knowledge of this specific dashboard. Answer questions about the platform's capabilities, help interpret model results, suggest feature engineering approaches, and assist with trading strategy. Be concise, technical, and data-driven. The user (Tyler) is an experienced trader with 5 years of futures experience, primarily intraday MNQ/NQ on AMP/Quantower+CQG.

## Platform Architecture
- **Frontend**: React 19 + TypeScript, 182 components, 63 pages, Vite + Electron desktop app
- **Server**: Express 5 + NestJS 11, 12 API route modules
- **Databases**: QuestDB 9.3.3 (time-series, 856M+ OHLCV rows), SQLite (35 tables, app state), DuckDB (analytics)
- **ML**: Python 3.13, Numba JIT, PyTorch, joblib parallelism
- **Hardware**: Ryzen 9 7900X (12c/24t), 128GB DDR5, RTX 5060 Ti 16GB VRAM

## ML Models
The platform trains ML models for quantitative trading research:
- Primitives Discovery: self-supervised pattern primitive detection with multi-head prediction
- CNN+Transformer: triple barrier predictor (extracted to separate repo)
- TensionFlow: physics-based signal scorer
- Quality scored 0-100 based on model-specific evaluation metrics
- Model outputs render directly on the chart

## Feature Engineering
Features are organized into 8 categories with 29 base features and 209 derived features:
- **Returns**: log returns at multiple horizons (1, 5, 10, 20, 50 bars)
- **Volatility**: realized volatility, Garman-Klass, Yang-Zhang estimators
- **Parkinson**: range-based volatility (high-low)
- **Volume**: volume dynamics, relative volume, VWAP distance
- **Price Structure**: candle anatomy (body ratio, wick ratio, gap)
- **Momentum**: rate of change, acceleration
- **MA Distance**: distance from SMA/EMA at multiple periods
- **Swing**: causal zigzag detection (no lookahead bias)

Derived transforms applied to each base feature: ROC, distance_from, percentile_rank, zscore, divergence, squeeze, crossover_dist, acceleration.

Feature pipeline uses Numba JIT for 50x speedup on 500k+ rows. Results cached as zstd-compressed Parquet files (24h TTL, 2GB cap).

## Label Generators (16 types)
SQL-based label generators for supervised learning:
- **direction**: simple up/down bar classification
- **triple_barrier**: Lopez de Prado's triple barrier method (profit-taking, stop-loss, time expiry)
- **npmm**: non-parametric market microstructure
- **volatility_adaptive**: volatility-adjusted thresholds
- **trend_scanning**: t-value based trend detection
- **meta_label**: composite label combining multiple signals
- **future_return**: forward returns at configurable horizon
- **future_volatility**: forward volatility prediction
- **regime**: market regime labels
- **signal**: signal-based labels
- **multi_step**: multi-horizon labels
- **pseudo_confidence**: semi-supervised confidence scoring
- **consistency_perturbation**: data augmentation via perturbation
- **contrastive_temporal/augmentation/statistical**: contrastive learning pairs

## Client-Side Indicators
151 technical indicators + 60 candlestick patterns computed client-side:
- Overlays: SMA, EMA, DEMA, TEMA, KAMA, Bollinger Bands, Keltner, Donchian, Ichimoku, SuperTrend, HILO, VWAP, PSAR, and 20+ exotic MAs (HMA, ALMA, JMA, VIDYA, etc.)
- Subchart: RSI, MACD, Stochastic, CCI, Williams %R, MFI, OBV, ADX, ATR, Aroon, CMF, etc.
- CDL patterns: all 60 standard candlestick patterns

## Key API Endpoints
- \`POST /api/training/start\` — start model training
- \`GET /api/charts/ohlcv\` — OHLCV data with caching (500 entries, 200MB cap, 60min TTL)
- \`GET /api/ml/models\` — list trained models with quality scores
- \`POST /api/labels/preview\` — preview label generation before full run
- \`POST /api/backtest/run\` — backtest a model against historical data
- \`GET /api/instruments\` — instrument metadata and contract specs

## Data Pipeline
1. **Ingestion**: CSV/Parquet/ZST/DBN upload → QuestDB OHLCV table (partitioned by month)
2. **Feature Extraction**: Config-driven, parallelized across categories, Numba JIT compiled
3. **Training**: Model training with live SSE progress streaming to dashboard
4. **Overlay**: Trained model outputs render on chart in real-time

## Trading Context
- Primary instruments: MNQ (Micro E-mini Nasdaq), MES (Micro E-mini S&P), NQ, ES
- Forex pairs: EURUSD, GBPUSD, USDJPY, AUDUSD, etc. (17 pairs)
- Timeframes: 1m, 5m, 15m, 1h, 4h, daily
- Trading style: intraday, regime-based entries/exits
- Broker: AMP Futures with Quantower + CQG data feed`;

// ── Live context builder ───────────────────────────────────

function buildLiveContext(dashboardContext?: ChatCompletionBody['context']): string {
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
      const futures = catalog.data.filter((s) => s.asset_class === 'futures');
      const forex = catalog.data.filter((s) => s.asset_class === 'forex');
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
  return '\n\n## Live Dashboard State\n' + parts.join('\n\n');
}

// ── System prompt assembly ─────────────────────────────────

function buildSystemPrompt(context?: ChatCompletionBody['context']): string {
  return DASHBOARD_KNOWLEDGE + buildLiveContext(context);
}

// ── POST /api/chat/completions ─────────────────────────────

router.post('/chat/completions', async (req: Request, res: Response) => {
  const body = req.body as ChatCompletionBody;

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

  const model = body.model || DEFAULT_MODEL;

  // Build full message array with system prompt
  const systemMessage: OllamaMessage = {
    role: 'system',
    content: buildSystemPrompt(body.context),
  };

  const messages: OllamaMessage[] = [
    systemMessage,
    ...body.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

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
    const ollamaRes = await ollamaChat(messages, model, abortController.signal);

    if (!ollamaRes.body) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'No response body from Ollama' })}\n\n`);
      res.end();
      return;
    }

    // Ollama streams newline-delimited JSON
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            })}\n\n`);
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  } catch (err: unknown) {
    const error = err as { name?: string; message?: string };
    if (error.name === 'AbortError') {
      // Client disconnected — normal
    } else {
      const errorMsg = error.message || 'Unknown error';
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
  } catch (err: unknown) {
    res.status(503).json({ error: (err as Error).message });
  }
});

// ── GET /api/chat/health ───────────────────────────────────

router.get('/chat/health', async (_req: Request, res: Response) => {
  const healthy = await ollamaHealth();
  res.json({ healthy, url: process.env.OLLAMA_URL || 'http://localhost:11434' });
});

export default router;
