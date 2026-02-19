import { Router, Request, Response } from "express";
import { storage } from "../storage";
import { insertNewsArticleSchema } from "@shared/schema";
import { z } from "zod";
import { getString } from "./helpers";

const router = Router();

// News API - fetch financial news for a symbol using Yahoo Finance RSS
router.get("/news/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol);

    // Map common symbols to Yahoo Finance compatible tickers
    const symbolMap: Record<string, string> = {
      // CME Equity Index Futures
      'ES': 'ES=F',
      'MES': 'ES=F',
      'NQ': 'NQ=F',
      'MNQ': 'NQ=F',
      'RTY': 'RTY=F',
      'M2K': 'RTY=F',
      // CBOT Dow Futures
      'YM': 'YM=F',
      'MYM': 'YM=F',
      // Forex pairs
      'EURUSD': 'EURUSD=X',
      'USDJPY': 'USDJPY=X',
      'GBPUSD': 'GBPUSD=X',
      'AUDUSD': 'AUDUSD=X',
      'USDCAD': 'USDCAD=X',
      'USDCHF': 'USDCHF=X',
      'NZDUSD': 'NZDUSD=X',
      'EURJPY': 'EURJPY=X',
      'GBPJPY': 'GBPJPY=X',
      'EURGBP': 'EURGBP=X',
      'AUDJPY': 'AUDJPY=X',
      'EURAUD': 'EURAUD=X',
      'EURCHF': 'EURCHF=X',
      'AUDNZD': 'AUDNZD=X',
      'GBPAUD': 'GBPAUD=X',
    };

    const yahooSymbol = symbolMap[symbol] || symbol;

    // Fetch news from Yahoo Finance RSS feed
    const rssUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(yahooSymbol)}&region=US&lang=en-US`;

    const response = await fetch(rssUrl);
    const xmlText = await response.text();

    // Parse RSS XML manually (simple parsing)
    const items: any[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xmlText)) !== null) {
      const itemXml = match[1];
      const getTag = (tag: string) => {
        const m = itemXml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return m ? (m[1] || m[2] || '').trim() : '';
      };

      const title = getTag('title');
      const link = getTag('link');
      const pubDate = getTag('pubDate');
      const description = getTag('description');

      if (title) {
        // Simple sentiment analysis based on keywords
        const text = (title + ' ' + description).toLowerCase();
        let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
        const positiveWords = ['surge', 'gain', 'rise', 'jump', 'rally', 'bull', 'up', 'high', 'record', 'growth', 'profit'];
        const negativeWords = ['drop', 'fall', 'crash', 'plunge', 'bear', 'down', 'low', 'loss', 'decline', 'fear', 'sell'];

        const posScore = positiveWords.filter(w => text.includes(w)).length;
        const negScore = negativeWords.filter(w => text.includes(w)).length;

        if (posScore > negScore) sentiment = 'positive';
        else if (negScore > posScore) sentiment = 'negative';

        items.push({
          title,
          summary: description.replace(/<[^>]*>/g, '').substring(0, 200) + '...',
          url: link,
          source: 'Yahoo Finance',
          publishedAt: pubDate || new Date().toISOString(),
          symbol,
          sentiment,
        });
      }

      if (items.length >= 15) break;
    }

    res.json(items);
  } catch (error) {
    console.error("Error fetching news:", error);
    // Return mock data on error
    res.json([]);
  }
});

router.get("/news/alphavantage/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol);
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

    if (!apiKey) {
      return res.json([]);
    }

    const tickerMap: Record<string, string> = {
      'ES': 'SPY',
      'MES': 'SPY',
      'NQ': 'QQQ',
      'MNQ': 'QQQ',
      'RTY': 'IWM',
      'M2K': 'IWM',
      'YM': 'DIA',
      'MYM': 'DIA',
      'EURUSD': 'FOREX:EUR',
      'USDJPY': 'FOREX:JPY',
      'GBPUSD': 'FOREX:GBP',
      'AUDUSD': 'FOREX:AUD',
      'USDCAD': 'FOREX:CAD',
      'USDCHF': 'FOREX:CHF',
      'NZDUSD': 'FOREX:NZD',
      'EURJPY': 'FOREX:EUR',
      'GBPJPY': 'FOREX:GBP',
      'EURGBP': 'FOREX:EUR',
      'AUDJPY': 'FOREX:AUD',
      'EURAUD': 'FOREX:EUR',
      'EURCHF': 'FOREX:EUR',
      'AUDNZD': 'FOREX:AUD',
      'GBPAUD': 'FOREX:GBP',
      'GBPCHF': 'FOREX:GBP',
      'CADJPY': 'FOREX:CAD',
    };

    const ticker = tickerMap[symbol] || symbol;
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${ticker}&apikey=${apiKey}&limit=20`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.feed) {
      return res.json([]);
    }

    const items = data.feed.slice(0, 15).map((item: any) => {
      const sentimentScore = parseFloat(item.overall_sentiment_score || 0);
      let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
      if (sentimentScore > 0.15) sentiment = 'positive';
      else if (sentimentScore < -0.15) sentiment = 'negative';

      return {
        title: item.title,
        summary: item.summary?.substring(0, 250) + '...',
        url: item.url,
        source: item.source || 'Alpha Vantage',
        publishedAt: item.time_published ?
          new Date(item.time_published.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6')).toISOString() :
          new Date().toISOString(),
        symbol,
        sentiment,
        sentimentScore,
      };
    });

    res.json(items);
  } catch (error) {
    console.error("Error fetching Alpha Vantage news:", error);
    res.json([]);
  }
});

// Helper functions for fetching news (shared between REST and SSE)
async function fetchYahooNews(symbol: string): Promise<any[]> {
  try {
    const yahooTickers: Record<string, string> = {
      'ES': 'ES=F', 'MES': 'ES=F', 'NQ': 'NQ=F', 'MNQ': 'NQ=F',
      'RTY': 'RTY=F', 'M2K': 'RTY=F', 'YM': 'YM=F', 'MYM': 'YM=F',
      'EURUSD': 'EURUSD=X', 'USDJPY': 'JPY=X', 'GBPUSD': 'GBPUSD=X',
      'AUDUSD': 'AUDUSD=X', 'USDCAD': 'CAD=X', 'USDCHF': 'CHF=X',
      'NZDUSD': 'NZDUSD=X', 'EURJPY': 'EURJPY=X', 'GBPJPY': 'GBPJPY=X',
      'EURGBP': 'EURGBP=X', 'AUDJPY': 'AUDJPY=X', 'EURAUD': 'EURAUD=X',
      'EURCHF': 'EURCHF=X', 'AUDNZD': 'AUDNZD=X', 'GBPAUD': 'GBPAUD=X',
    };
    const ticker = yahooTickers[symbol] || symbol;
    const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${ticker}&region=US&lang=en-US`;
    const response = await fetch(url);
    const text = await response.text();

    const items: any[] = [];
    const itemMatches = text.match(/<item>([\s\S]*?)<\/item>/g) || [];

    for (const itemXml of itemMatches) {
      const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/);
      const descMatch = itemXml.match(/<description>([\s\S]*?)<\/description>/);
      const pubDateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

      const title = titleMatch?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || '';
      const link = linkMatch?.[1] || '';
      const description = descMatch?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') || '';
      const pubDate = pubDateMatch?.[1] || new Date().toISOString();

      if (title && link) {
        const posWords = ['surge', 'rally', 'gain', 'rise', 'bullish', 'up', 'high', 'growth', 'profit', 'beat'];
        const negWords = ['drop', 'fall', 'decline', 'loss', 'bearish', 'down', 'low', 'crash', 'miss', 'concern'];
        const textLower = (title + ' ' + description).toLowerCase();
        const posScore = posWords.filter(w => textLower.includes(w)).length;
        const negScore = negWords.filter(w => textLower.includes(w)).length;
        let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
        if (posScore > negScore) sentiment = 'positive';
        else if (negScore > posScore) sentiment = 'negative';

        items.push({
          title,
          summary: description.replace(/<[^>]*>/g, '').substring(0, 200) + '...',
          url: link,
          source: 'Yahoo Finance',
          publishedAt: pubDate,
          symbol,
          sentiment,
        });
      }
      if (items.length >= 15) break;
    }
    return items;
  } catch (error) {
    console.error("Error fetching Yahoo news:", error);
    return [];
  }
}

async function fetchAlphaVantageNews(symbol: string): Promise<any[]> {
  try {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) return [];

    const tickerMap: Record<string, string> = {
      'ES': 'SPY', 'MES': 'SPY', 'NQ': 'QQQ', 'MNQ': 'QQQ',
      'RTY': 'IWM', 'M2K': 'IWM', 'YM': 'DIA', 'MYM': 'DIA',
      'EURUSD': 'FOREX:EUR', 'USDJPY': 'FOREX:JPY', 'GBPUSD': 'FOREX:GBP',
      'AUDUSD': 'FOREX:AUD', 'USDCAD': 'FOREX:CAD', 'USDCHF': 'FOREX:CHF',
      'NZDUSD': 'FOREX:NZD', 'EURJPY': 'FOREX:EUR', 'GBPJPY': 'FOREX:GBP',
      'EURGBP': 'FOREX:EUR', 'AUDJPY': 'FOREX:AUD', 'EURAUD': 'FOREX:EUR',
      'EURCHF': 'FOREX:EUR', 'AUDNZD': 'FOREX:AUD', 'GBPAUD': 'FOREX:GBP',
      'GBPCHF': 'FOREX:GBP', 'CADJPY': 'FOREX:CAD',
    };

    const ticker = tickerMap[symbol] || symbol;
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${ticker}&apikey=${apiKey}&limit=20`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.feed) return [];

    return data.feed.slice(0, 15).map((item: any) => {
      const sentimentScore = parseFloat(item.overall_sentiment_score || 0);
      let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
      if (sentimentScore > 0.15) sentiment = 'positive';
      else if (sentimentScore < -0.15) sentiment = 'negative';

      return {
        title: item.title,
        summary: item.summary?.substring(0, 250) + '...',
        url: item.url,
        source: item.source || 'Alpha Vantage',
        publishedAt: item.time_published ?
          new Date(item.time_published.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6')).toISOString() :
          new Date().toISOString(),
        symbol,
        sentiment,
        sentimentScore,
      };
    });
  } catch (error) {
    console.error("Error fetching Alpha Vantage news:", error);
    return [];
  }
}

router.get("/news/combined/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.params.symbol);

    const [yahooNews, alphaNews] = await Promise.all([
      fetchYahooNews(symbol),
      fetchAlphaVantageNews(symbol),
    ]);

    const combined = [...alphaNews, ...yahooNews]
      .sort((a: any, b: any) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, 25);

    res.json(combined);
  } catch (error) {
    console.error("Error fetching combined news:", error);
    res.json([]);
  }
});

// SSE endpoint for real-time news streaming
router.get("/news/stream/:symbol", async (req: Request, res: Response) => {
  const symbol = getString(req.params.symbol);

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  // Per-connection seen news tracker
  const seenNews = new Set<string>();

  // Send news updates
  const sendNews = async () => {
    try {
      const [yahooNews, alphaNews] = await Promise.all([
        fetchYahooNews(symbol),
        fetchAlphaVantageNews(symbol),
      ]);

      const combined = [...alphaNews, ...yahooNews]
        .sort((a: any, b: any) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

      // Filter for new items only
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

  // Send initial batch immediately
  await sendNews();

  // Poll for new news every 15 seconds (APIs don't support true push)
  const interval = setInterval(sendNews, 15000);

  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`:heartbeat\n\n`);
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(interval);
    clearInterval(heartbeat);
  });
});

// News persistence routes
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
    const limit = parseInt(getString(req.query.limit as string) || '50');

    const articles = await storage.getNewsBySymbol(symbol, limit);
    res.json(articles);
  } catch (error) {
    console.error("Error fetching news by symbol:", error);
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

export default router;
