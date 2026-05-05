/**
 * Sentiment Analysis — keyword-based sentiment scoring for news headlines.
 */

const POSITIVE_WORDS = ['surge', 'rally', 'gain', 'rise', 'bullish', 'up', 'high', 'growth', 'profit', 'beat', 'jump', 'record'];
const NEGATIVE_WORDS = ['drop', 'fall', 'decline', 'loss', 'bearish', 'down', 'low', 'crash', 'miss', 'concern', 'plunge', 'fear', 'sell'];

export type Sentiment = 'positive' | 'negative' | 'neutral';

/** Simple keyword-based sentiment from title + description text */
export function classifySentiment(text: string): Sentiment {
  const lower = text.toLowerCase();
  const posScore = POSITIVE_WORDS.filter(w => lower.includes(w)).length;
  const negScore = NEGATIVE_WORDS.filter(w => lower.includes(w)).length;

  if (posScore > negScore) return 'positive';
  if (negScore > posScore) return 'negative';
  return 'neutral';
}
