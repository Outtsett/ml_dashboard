/**
 * News route — HTTP layer only.
 *
 * Handles request parsing and response formatting.
 * All fetching/sentiment logic lives in lib/news/.
 */

import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { insertNewsArticleSchema } from "@shared/schema";
import { z } from "zod";
import { getString } from "./helpers";
import { fetchYahooNews, fetchAlphaVantageNews, fetchCombinedNews } from "../lib/news/newsFetcher";
import { isValidSymbol } from "@shared/validation";

const router = Router();

// Yahoo Finance RSS news for a symbol
router.get("/news/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol);
    if (!isValidSymbol(symbol)) {
      return res.status(400).json({ error: 'Invalid symbol format' });
    }
    const items = await fetchYahooNews(symbol);
    res.json(items);
  } catch (error) {
    console.error("Error fetching news:", error);
    res.json([]);
  }
});

// Alpha Vantage news for a symbol
router.get("/news/alphavantage/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol);
    if (!isValidSymbol(symbol)) {
      return res.status(400).json({ error: 'Invalid symbol format' });
    }
    const items = await fetchAlphaVantageNews(symbol);
    res.json(items);
  } catch (error) {
    console.error("Error fetching Alpha Vantage news:", error);
    res.json([]);
  }
});

// Combined news from both sources
router.get("/news/combined/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol);
    if (!isValidSymbol(symbol)) {
      return res.status(400).json({ error: 'Invalid symbol format' });
    }
    const combined = await fetchCombinedNews(symbol);
    res.json(combined);
  } catch (error) {
    console.error("Error fetching combined news:", error);
    res.json([]);
  }
});

// SSE endpoint for real-time news streaming
router.get("/news/stream/:symbol", async (req: Request, res: Response) => {
  const symbol = getString(req.params.symbol);
  if (!isValidSymbol(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol format' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const seenNews = new Set<string>();

  const sendNews = async () => {
    try {
      const combined = await fetchCombinedNews(symbol, 30);

      const newItems = combined.filter(item => {
        const itemKey = `${item.title}-${item.publishedAt}`;
        if (seenNews.has(itemKey)) return false;
        seenNews.add(itemKey);
        return true;
      });

      if (newItems.length > 0) {
        res.write(`event: news\n`);
        res.write(`data: ${JSON.stringify(newItems)}\n\n`);
      }
    } catch (error) {
      console.error("Error in news stream:", error);
    }
  };

  await sendNews();
  const interval = setInterval(sendNews, 15000);
  const heartbeat = setInterval(() => { res.write(`:heartbeat\n\n`); }, 30000);

  req.on('close', () => {
    clearInterval(interval);
    clearInterval(heartbeat);
  });
});

// ── News persistence routes ──────────────────────────────────────────────────

router.get("/news-db", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(getString(req.query.limit as string) || '50');
    const symbol = getString(req.query.symbol as string);
    const source = getString(req.query.source as string);

    const articles = await storage.getNewsArticles({
      limit,
      symbol: symbol || undefined,
      source: source || undefined
    });

    res.json(articles);
  } catch (error) {
    console.error("Error fetching news from database:", error);
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

router.get("/news-db/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getString(req.params.id));
    const article = await storage.getNewsArticleById(id);

    if (!article) {
      return res.status(404).json({ error: "Article not found" });
    }

    res.json(article);
  } catch (error) {
    console.error("Error fetching news article:", error);
    res.status(500).json({ error: "Failed to fetch news article" });
  }
});

const createNewsSchema = insertNewsArticleSchema.extend({
  symbols: z.array(z.string()).optional()
});

router.post("/news-db", async (req: Request, res: Response) => {
  try {
    const parsed = createNewsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { symbols, ...articleData } = parsed.data;

    if (articleData.externalId) {
      const existing = await storage.getNewsArticleByExternalId(articleData.externalId);
      if (existing) {
        return res.status(200).json({ ...existing, duplicate: true });
      }
    }

    const article = await storage.createNewsArticle(articleData, symbols);
    res.status(201).json(article);
  } catch (error) {
    console.error("Error creating news article:", error);
    res.status(500).json({ error: "Failed to create news article" });
  }
});

const updateSentimentSchema = z.object({
  sentimentScore: z.number().min(-1).max(1),
  sentimentLabel: z.enum(['bullish', 'bearish', 'neutral']),
  sentimentConfidence: z.number().min(0).max(1)
});

router.put("/news-db/:id/sentiment", async (req: Request, res: Response) => {
  try {
    const id = parseInt(getString(req.params.id));

    const parsed = updateSentimentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }

    const { sentimentScore, sentimentLabel, sentimentConfidence } = parsed.data;

    await storage.updateNewsSentiment(id, sentimentScore, sentimentLabel, sentimentConfidence);
    res.json({ success: true });
  } catch (error) {
    console.error("Error updating sentiment:", error);
    res.status(500).json({ error: "Failed to update sentiment" });
  }
});

router.get("/news-db/symbol/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol);
    if (!isValidSymbol(symbol)) {
      return res.status(400).json({ error: 'Invalid symbol format' });
    }
    const limit = parseInt(getString(req.query.limit as string) || '50');

    const articles = await storage.getNewsBySymbol(symbol, limit);
    res.json(articles);
  } catch (error) {
    console.error("Error fetching news by symbol:", error);
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

export default router;
