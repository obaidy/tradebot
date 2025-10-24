import axios from 'axios';
import { SentimentSnapshotsRepository, InsertSentimentSnapshotInput } from '../../db/sentimentSnapshotsRepo';
import { logger } from '../../utils/logger';

export interface SentimentSignal {
  token: string;
  symbol?: string;
  mentions5m: number;
  mentions30m: number;
  trendingScore: number;
  liquidityUsd?: number | null;
  dexVolume5m?: number | null;
  source: string;
  meta?: Record<string, unknown>;
}

interface CollectOptions {
  minimumMentions?: number;
  maximumResults?: number;
}

const DEFAULT_MINIMUM_MENTIONS = Number(process.env.SENTIMENT_MIN_MENTIONS ?? 12);

async function fetchDexToolsSignals(): Promise<SentimentSignal[]> {
  const apiKey = process.env.DEXTOOLS_API_KEY;
  if (!apiKey) return [];
  try {
    const url = process.env.DEXTOOLS_TRENDING_URL ?? 'https://public.dextools.io/trading/api/trending/ethereum/5m';
    const response = await axios.get(url, {
      headers: {
        'X-API-KEY': apiKey,
        Accept: 'application/json',
      },
      timeout: 8_000,
    });
    const payload = response.data;
    if (!payload || !Array.isArray(payload.data)) {
      return [];
    }
    return payload.data
      .map((entry: any) => {
        const mentions5m = Number(entry.metrics?.mentions?.['5m'] ?? entry.mentions_5m ?? 0);
        const mentions30m = Number(entry.metrics?.mentions?.['30m'] ?? entry.mentions_30m ?? 0);
        const trendingScore = Number(entry.score ?? entry.trending_score ?? mentions5m);
        return {
          token: String(entry.address ?? entry.token ?? '').toLowerCase(),
          symbol: entry.symbol ?? entry.ticker ?? undefined,
          mentions5m,
          mentions30m,
          trendingScore,
          liquidityUsd: entry.liquidity_usd ?? entry.liquidity ?? null,
          dexVolume5m: entry.dex_volume_5m ?? entry.volume_5m ?? null,
          source: 'dextools',
          meta: {
            rank: entry.rank ?? entry.position ?? null,
            pair: entry.pair ?? null,
            url: entry.url ?? entry.link ?? null,
          },
        } as SentimentSignal;
      })
      .filter((signal: SentimentSignal) => Boolean(signal.token));
  } catch (error) {
    logger.warn('sentiment_dextools_fetch_failed', {
      event: 'sentiment_dextools_fetch_failed',
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function fetchExternalMentions(): Promise<SentimentSignal[]> {
  const bearer = process.env.X_BEARER;
  if (!bearer) return [];
  try {
    const query = encodeURIComponent('#DeFi OR #airdrop OR dxsale');
    const url =
      process.env.X_SENTIMENT_URL ??
      `https://api.twitter.com/2/tweets/search/recent?query=${query}&tweet.fields=public_metrics,created_at&max_results=50`;
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${bearer}`,
      },
      timeout: 6_000,
    });
    const data = response.data;
    if (!data || !Array.isArray(data.data)) return [];
    const grouped = new Map<string, { mentions: number; likes: number }>();
    for (const tweet of data.data) {
      if (!tweet.text) continue;
      const match = tweet.text.match(/\$[A-Za-z0-9]{2,10}/g);
      if (!match) continue;
      for (const tag of match) {
        const token = tag.slice(1).toLowerCase();
        const snapshot = grouped.get(token) ?? { mentions: 0, likes: 0 };
        snapshot.mentions += 1;
        snapshot.likes += Number(tweet.public_metrics?.like_count ?? 0);
        grouped.set(token, snapshot);
      }
    }
    return Array.from(grouped.entries()).map(([token, snapshot]) => ({
      token,
      symbol: token.toUpperCase(),
      mentions5m: snapshot.mentions,
      mentions30m: Math.round(snapshot.mentions * 2),
      trendingScore: snapshot.mentions + snapshot.likes * 0.2,
      liquidityUsd: null,
      dexVolume5m: null,
      source: 'x',
      meta: {
        likes: snapshot.likes,
      },
    }));
  } catch (error) {
    logger.warn('sentiment_x_fetch_failed', {
      event: 'sentiment_x_fetch_failed',
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function normalizeSignals(signals: SentimentSignal[], options: CollectOptions): SentimentSignal[] {
  const map = new Map<string, SentimentSignal>();
  const minimumMentions = options.minimumMentions ?? DEFAULT_MINIMUM_MENTIONS;
  for (const signal of signals) {
    if (!signal.token) continue;
    if (signal.mentions5m < minimumMentions) continue;
    const existing = map.get(signal.token);
    if (!existing) {
      map.set(signal.token, { ...signal });
      continue;
    }
    const merged: SentimentSignal = {
      token: signal.token,
      symbol: existing.symbol ?? signal.symbol,
      mentions5m: existing.mentions5m + signal.mentions5m,
      mentions30m: existing.mentions30m + signal.mentions30m,
      trendingScore: existing.trendingScore + signal.trendingScore,
      liquidityUsd: signal.liquidityUsd ?? existing.liquidityUsd ?? null,
      dexVolume5m: signal.dexVolume5m ?? existing.dexVolume5m ?? null,
      source: existing.source.includes(signal.source) ? existing.source : `${existing.source},${signal.source}`,
      meta: {
        ...(existing.meta ?? {}),
        ...(signal.meta ?? {}),
      },
    };
    map.set(signal.token, merged);
  }
  const merged = Array.from(map.values());
  merged.sort((a, b) => b.trendingScore - a.trendingScore);
  const limit = options.maximumResults ?? Number(process.env.SENTIMENT_MAX_RESULTS ?? 25);
  return merged.slice(0, limit);
}

export async function collectSentimentSignals(options: CollectOptions = {}): Promise<SentimentSignal[]> {
  const [dextools, xSignals] = await Promise.all([fetchDexToolsSignals(), fetchExternalMentions()]);
  const combined = [...dextools, ...xSignals];
  return normalizeSignals(combined, options);
}

export async function ingestSentimentSignals(
  repo: SentimentSnapshotsRepository,
  options: CollectOptions = {}
): Promise<SentimentSignal[]> {
  const signals = await collectSentimentSignals(options);
  const inserts: InsertSentimentSnapshotInput[] = signals.map((signal) => ({
    token: signal.token,
    mentions5m: signal.mentions5m,
    mentions30m: signal.mentions30m,
    trendingScore: signal.trendingScore,
    liquidityUsd: signal.liquidityUsd ?? null,
    dexVolume5m: signal.dexVolume5m ?? null,
    meta: {
      source: signal.source,
      symbol: signal.symbol ?? null,
      ...(signal.meta ?? {}),
    },
  }));
  for (const snapshot of inserts) {
    await repo.insert(snapshot);
  }
  return signals;
}
