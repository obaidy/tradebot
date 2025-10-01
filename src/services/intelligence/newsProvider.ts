import axios, { AxiosInstance } from 'axios';
import { NewsSentimentProvider, NewsSentimentRecord } from '../../analytics/intelligence/regimeDetector';
import { logger } from '../../utils/logger';

const DEFAULT_NEWS_TIMEOUT = Number(process.env.NEWS_API_TIMEOUT_MS || 3_000);

function normalizeSymbol(pair: string) {
  const up = pair.toUpperCase();
  const parts = up.split(/[/:_-]/g).filter(Boolean);
  return parts[0] ?? up;
}

export class CryptoCompareNewsSentimentProvider implements NewsSentimentProvider {
  private readonly client: AxiosInstance;
  private readonly apiKey?: string;
  private readonly categories: string[];

  constructor(params: { apiKey?: string; categories?: string[] } = {}) {
    this.apiKey = params.apiKey;
    this.categories = params.categories ?? [];
    this.client = axios.create({
      baseURL: process.env.CRYPTOCOMPARE_NEWS_URL || 'https://min-api.cryptocompare.com/data/v2',
      timeout: DEFAULT_NEWS_TIMEOUT,
    });
  }

  async fetchLatestSentiment(pair: string): Promise<NewsSentimentRecord | null> {
    if (!this.apiKey) return null;
    const asset = normalizeSymbol(pair);
    const categories = [...new Set([asset, ...this.categories])]
      .map((s) => encodeURIComponent(s))
      .join(',');
    try {
      const response = await this.client.get('/news/', {
        params: {
          lang: 'EN',
          categories: categories || undefined,
          excludeCategories: 'Sponsored',
          sortOrder: 'popular',
          extraParams: 'tradebot',
        },
        headers: {
          Authorization: `Apikey ${this.apiKey}`,
        },
      });

      const articles: Array<Record<string, any>> = Array.isArray(response.data?.Data)
        ? response.data.Data
        : [];
      if (!articles.length) return null;

      const scored = articles
        .map((article) => {
          const score = Number(article.overall_sentiment_score ?? article.sentimentScore ?? 0);
          const confidence = Number(article.overall_sentiment_confidence ?? article.sentimentConfidence ?? 0.35);
          return {
            score,
            confidence: Math.max(0, Math.min(1, confidence)),
            headline: article.title ?? article.body?.slice(0, 256) ?? 'Unknown',
            source: article.source ?? article.source_info?.name ?? 'CryptoCompare',
            published: Number(article.published_on ?? Date.now() / 1000) * 1000,
          };
        })
        .filter((item) => Number.isFinite(item.score))
        .sort((a, b) => (b.confidence * Math.abs(b.score)) - (a.confidence * Math.abs(a.score)));

      if (!scored.length) return null;

      const top = scored[0];
      return {
        score: Math.max(-1, Math.min(1, top.score)),
        confidence: top.confidence,
        headline: top.headline,
        source: top.source,
        timestamp: top.published,
      };
    } catch (error) {
      logger.warn('crypto_compare_news_error', {
        event: 'crypto_compare_news_error',
        pair,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

export class CoinDeskNewsSentimentProvider implements NewsSentimentProvider {
  private readonly client: AxiosInstance;
  private readonly apiKey?: string;

  constructor(options: { apiKey?: string; baseUrl?: string } = {}) {
    this.apiKey = options.apiKey;
    this.client = axios.create({
      baseURL: options.baseUrl || process.env.COINDESK_NEWS_URL || 'https://production.api.coindesk.com/v2',
      timeout: DEFAULT_NEWS_TIMEOUT,
    });
  }

  async fetchLatestSentiment(pair: string): Promise<NewsSentimentRecord | null> {
    const asset = normalizeSymbol(pair);
    try {
      const response = await this.client.get('/content/linked/list', {
        params: {
          asset,
          limit: 5,
          sort_by: 'relevance',
        },
        headers: this.apiKey
          ? {
              Authorization: `Bearer ${this.apiKey}`,
            }
          : undefined,
      });
      const items: Array<Record<string, any>> = Array.isArray(response.data?.data?.items)
        ? response.data.data.items
        : [];
      if (!items.length) return null;

      const sentimentAggregate = items.reduce(
        (acc, item) => {
          const sentiment = Number(item.sentiment?.score ?? item.metadata?.sentimentScore ?? 0);
          const confidence = Number(item.sentiment?.confidence ?? item.metadata?.sentimentConfidence ?? 0.3);
          if (Number.isFinite(sentiment)) {
            acc.score += sentiment * confidence;
            acc.confidence += confidence;
          }
          return acc;
        },
        { score: 0, confidence: 0 }
      );

      if (!Number.isFinite(sentimentAggregate.score) || sentimentAggregate.confidence <= 0) {
        return null;
      }

      const latest = items[0] ?? {};
      return {
        score: Math.max(-1, Math.min(1, sentimentAggregate.score / sentimentAggregate.confidence)),
        confidence: Math.max(0.1, Math.min(1, sentimentAggregate.confidence / items.length)),
        headline: latest.headline ?? latest.title ?? latest.metadata?.headline ?? undefined,
        source: latest.source ?? 'CoinDesk',
        timestamp: Number(latest.publish_date ?? latest.metadata?.publishDate ?? Date.now()),
      };
    } catch (error) {
      logger.warn('coindesk_news_error', {
        event: 'coindesk_news_error',
        pair,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
