/**
 * News Fetchers — Yahoo Finance RSS + Alpha Vantage API.
 *
 * Pure data-fetching functions with no HTTP/Express dependency.
 * Used by both REST endpoints and SSE streaming.
 */

import { getYahooTicker, getAlphaVantageTicker } from './symbolMapping';
import { classifySentiment, type Sentiment } from './sentiment';

export interface NewsItem {
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  symbol: string;
  sentiment: Sentiment;
  sentimentScore?: number;
}

/** One entry in Alpha Vantage's NEWS_SENTIMENT `feed` array (fields we read). */
interface AlphaVantageFeedItem {
  title: string;
  summary?: string;
  url: string;
  source?: string;
  time_published?: string;
  overall_sentiment_score?: number | string;
}

/** Fetch news from Yahoo Finance RSS feed */
export async function fetchYahooNews(symbol: string): Promise<NewsItem[]> {
  try {
    const ticker = getYahooTicker(symbol);
    const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`;
    const response = await fetch(url);
    const text = await response.text();

    const items: NewsItem[] = [];
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
        items.push({
          title,
          summary: description.replace(/<[^>]*>/g, '').substring(0, 200) + '...',
          url: link,
          source: 'Yahoo Finance',
          publishedAt: pubDate,
          symbol,
          sentiment: classifySentiment(title + ' ' + description),
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

/** Fetch news from Alpha Vantage API */
export async function fetchAlphaVantageNews(symbol: string): Promise<NewsItem[]> {
  try {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) return [];

    const ticker = getAlphaVantageTicker(symbol);
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${ticker}&apikey=${apiKey}&limit=20`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.feed) return [];

    return data.feed.slice(0, 15).map((item: AlphaVantageFeedItem) => {
      const sentimentScore = parseFloat(String(item.overall_sentiment_score ?? 0));
      let sentiment: Sentiment = 'neutral';
      if (sentimentScore > 0.15) sentiment = 'positive';
      else if (sentimentScore < -0.15) sentiment = 'negative';

      return {
        title: item.title,
        summary: item.summary?.substring(0, 250) + '...',
        url: item.url,
        source: item.source || 'Alpha Vantage',
        publishedAt: item.time_published
          ? new Date(item.time_published.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6')).toISOString()
          : new Date().toISOString(),
        symbol,
        sentiment,
        sentimentScore,
      } satisfies NewsItem;
    });
  } catch (error) {
    console.error("Error fetching Alpha Vantage news:", error);
    return [];
  }
}

/** Fetch from both sources, merge, sort by date descending */
export async function fetchCombinedNews(symbol: string, limit = 25): Promise<NewsItem[]> {
  const [yahooNews, alphaNews] = await Promise.all([
    fetchYahooNews(symbol),
    fetchAlphaVantageNews(symbol),
  ]);

  return [...alphaNews, ...yahooNews]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit);
}
