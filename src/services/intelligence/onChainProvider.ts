import axios, { AxiosInstance } from 'axios';
import { OnChainMetricsProvider, OnChainMetricsSnapshot } from '../../analytics/intelligence/regimeDetector';
import { logger } from '../../utils/logger';

const DEFAULT_ONCHAIN_TIMEOUT = Number(process.env.ONCHAIN_API_TIMEOUT_MS || 4_000);

const SUPPORTED_ASSETS: Record<string, string> = {
  BTC: 'BTC',
  ETH: 'ETH',
};

interface GlassnodeProviderOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class GlassnodeOnChainMetricsProvider implements OnChainMetricsProvider {
  private readonly client: AxiosInstance;
  private readonly apiKey?: string;

  constructor(options: GlassnodeProviderOptions = {}) {
    this.apiKey = options.apiKey;
    this.client = axios.create({
      baseURL: options.baseUrl || 'https://api.glassnode.com/v1',
      timeout: DEFAULT_ONCHAIN_TIMEOUT,
    });
  }

  async fetchLatestMetrics(pair: string): Promise<OnChainMetricsSnapshot | null> {
    if (!this.apiKey) return null;
    const asset = SUPPORTED_ASSETS[pair.split(/[/:_-]/g)[0]?.toUpperCase() ?? ''];
    if (!asset) return null;

    try {
      const [whaleVolume, exchangeFlows, txnCount] = await Promise.all([
        this.fetchEndpoint('/metrics/transactions/transfers_volume_whale', asset),
        this.fetchEndpoint('/metrics/distribution/balance_exchanges_relative', asset),
        this.fetchEndpoint('/metrics/transactions/transfers_count', asset),
      ]);

      if (whaleVolume === null && exchangeFlows === null && txnCount === null) {
        return null;
      }

      const whaleInflowUsd = Math.max(0, whaleVolume ?? 0);
      const exchangeRelative = exchangeFlows ?? 0;
      const exchangeInflowUsd = exchangeRelative > 0 ? exchangeRelative * whaleInflowUsd : Math.abs(exchangeRelative) * whaleInflowUsd;
      const exchangeOutflowUsd = exchangeRelative < 0 ? Math.abs(exchangeRelative) * whaleInflowUsd : 0;
      const whaleOutflowUsd = whaleInflowUsd * 0.65; // heuristic ratio when outflows dominate
      const largeTxnCount = Math.max(0, Math.round((txnCount ?? 0) / 10));

      return {
        whaleInflowUsd,
        whaleOutflowUsd,
        exchangeInflowUsd,
        exchangeOutflowUsd,
        largeTxnCount,
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.warn('glassnode_onchain_error', {
        event: 'glassnode_onchain_error',
        pair,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async fetchEndpoint(path: string, asset: string): Promise<number | null> {
    try {
      const response = await this.client.get(path, {
        params: {
          a: asset,
          i: '24h',
          s: Math.floor(Date.now() / 1000) - 86400 * 7,
          api_key: this.apiKey,
        },
      });
      const data: Array<{ t: number; v: number }> = Array.isArray(response.data) ? response.data : [];
      if (!data.length) return null;
      const latest = data[data.length - 1];
      if (!latest || !Number.isFinite(latest.v)) return null;
      return Number(latest.v);
    } catch (error) {
      logger.debug('glassnode_endpoint_failed', {
        event: 'glassnode_endpoint_failed',
        endpoint: path,
        asset,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

export class PlaceholderOnChainMetricsProvider implements OnChainMetricsProvider {
  async fetchLatestMetrics(): Promise<OnChainMetricsSnapshot | null> {
    return null;
  }
}
