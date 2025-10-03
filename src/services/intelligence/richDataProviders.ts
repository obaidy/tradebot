import axios, { AxiosInstance } from 'axios';
import {
  OptionsFlowProvider,
  OptionsFlowSnapshot,
  SocialSentimentProvider,
  SocialSentimentSnapshot,
  InstitutionalFlowProvider,
  InstitutionalFlowSnapshot,
  MacroEconomicProvider,
  MacroSignalSnapshot,
  AlternativeDataProvider,
  AlternativeDataSnapshot,
} from '../../analytics/intelligence/regimeDetector';
import { logger } from '../../utils/logger';

const DEFAULT_TIMEOUT_MS = Number(process.env.INTELLIGENCE_PROVIDER_TIMEOUT_MS || 4_000);

type RestProviderConfig = {
  baseUrl: string;
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
};

type MaybeArray<T> = T | T[] | null | undefined;

function normalizeSymbol(pair: string) {
  return pair.split(/[/:_-]/g)[0]?.toUpperCase() ?? pair.toUpperCase();
}

function pickLatest<T extends { timestamp?: number }>(payload: MaybeArray<T>): T | null {
  if (!payload) return null;
  if (Array.isArray(payload)) {
    if (!payload.length) return null;
    return payload
      .slice()
      .sort((a, b) => (Number(b.timestamp ?? 0) || 0) - (Number(a.timestamp ?? 0) || 0))[0];
  }
  return payload;
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function authHeaders(apiKey?: string) {
  if (!apiKey) return undefined;
  return { Authorization: `Bearer ${apiKey}` };
}

export class RestOptionsFlowDataProvider implements OptionsFlowProvider {
  private readonly client: AxiosInstance;
  private readonly endpoint: string;
  private readonly apiKey?: string;

  constructor(config: RestProviderConfig) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint ?? '/options/flow/latest';
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  }

  async fetchOptionsFlow(pair: string): Promise<OptionsFlowSnapshot | null> {
    try {
      const response = await this.client.get(this.endpoint, {
        params: { symbol: normalizeSymbol(pair) },
        headers: authHeaders(this.apiKey),
      });
      const latest = pickLatest(response.data?.data ?? response.data);
      if (!latest) return null;

      const callVolume = toNumber(latest.call_volume_usd ?? latest.callVolumeUsd ?? latest.callsNotionalUsd);
      const putVolume = toNumber(latest.put_volume_usd ?? latest.putVolumeUsd ?? latest.putsNotionalUsd);
      const sweepNotional = toNumber(latest.sweep_notional_usd ?? latest.sweepNotionalUsd ?? latest.sweepNotional, 0);
      const unusualRaw = toNumber(latest.unusual_activity_score ?? latest.unusualScore ?? latest.score, 0);
      const bias = String(latest.bias ?? latest.direction ?? '').toLowerCase();
      const biasScore = bias === 'bullish' ? 1 : bias === 'bearish' ? -1 : 0;
      const unusualActivityScore = Math.max(-1, Math.min(1, unusualRaw || biasScore));

      return {
        callVolumeUsd: Math.max(callVolume, 0),
        putVolumeUsd: Math.max(putVolume, 0),
        sweepNotionalUsd: sweepNotional > 0 ? sweepNotional : undefined,
        unusualActivityScore,
        timestamp: Number(latest.timestamp ?? latest.collected_at ?? Date.now()),
      };
    } catch (error) {
      logger.warn('options_flow_provider_error', {
        event: 'options_flow_provider_error',
        error: error instanceof Error ? error.message : String(error),
        provider: 'RestOptionsFlowDataProvider',
      });
      return null;
    }
  }
}

export class RestSocialSentimentProvider implements SocialSentimentProvider {
  private readonly client: AxiosInstance;
  private readonly endpoint: string;
  private readonly apiKey?: string;

  constructor(config: RestProviderConfig) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint ?? '/social/sentiment/latest';
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  }

  async fetchSocialSentiment(pair: string): Promise<SocialSentimentSnapshot | null> {
    try {
      const response = await this.client.get(this.endpoint, {
        params: { symbol: normalizeSymbol(pair) },
        headers: authHeaders(this.apiKey),
      });
      const latest = pickLatest(response.data?.data ?? response.data);
      if (!latest) return null;

      const sentimentScore = Math.max(-1, Math.min(1, toNumber(latest.sentiment_score ?? latest.sentimentScore)));
      const momentum = Math.max(-1, Math.min(1, toNumber(latest.momentum_score ?? latest.momentum, 0)));
      const mentionDeltaPct = toNumber(latest.mention_delta_pct ?? latest.mentionDeltaPct ?? latest.mentionDelta, 0);

      return {
        sentimentScore,
        momentum,
        mentionDeltaPct,
        timestamp: Number(latest.timestamp ?? latest.collected_at ?? Date.now()),
      };
    } catch (error) {
      logger.warn('social_sentiment_provider_error', {
        event: 'social_sentiment_provider_error',
        error: error instanceof Error ? error.message : String(error),
        provider: 'RestSocialSentimentProvider',
      });
      return null;
    }
  }
}

export class RestInstitutionalFlowProvider implements InstitutionalFlowProvider {
  private readonly client: AxiosInstance;
  private readonly endpoint: string;
  private readonly apiKey?: string;

  constructor(config: RestProviderConfig) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint ?? '/institutional/positions/latest';
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  }

  async fetchInstitutionalFlow(pair: string): Promise<InstitutionalFlowSnapshot | null> {
    try {
      const response = await this.client.get(this.endpoint, {
        params: { symbol: normalizeSymbol(pair) },
        headers: authHeaders(this.apiKey),
      });
      const latest = pickLatest(response.data?.data ?? response.data);
      if (!latest) return null;

      const netLongRatio = Math.max(-1, Math.min(1, toNumber(latest.net_long_ratio ?? latest.netLongRatio)));
      const positionChangePct = toNumber(
        latest.position_change_pct ?? latest.positionChangePct ?? latest.dayOverDayChangePct,
        0,
      );
      const openInterestSkew = Math.max(-1, Math.min(1, toNumber(latest.open_interest_skew ?? latest.openInterestSkew, 0)));

      return {
        netLongRatio,
        positionChangePct,
        openInterestSkew,
        timestamp: Number(latest.timestamp ?? latest.collected_at ?? Date.now()),
      };
    } catch (error) {
      logger.warn('institutional_flow_provider_error', {
        event: 'institutional_flow_provider_error',
        error: error instanceof Error ? error.message : String(error),
        provider: 'RestInstitutionalFlowProvider',
      });
      return null;
    }
  }
}

export class RestMacroEconomicDataProvider implements MacroEconomicProvider {
  private readonly client: AxiosInstance;
  private readonly endpoint: string;
  private readonly apiKey?: string;

  constructor(config: RestProviderConfig) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint ?? '/macro/signals/latest';
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  }

  async fetchMacroSignals(pair: string): Promise<MacroSignalSnapshot | null> {
    try {
      const response = await this.client.get(this.endpoint, {
        params: { symbol: normalizeSymbol(pair) },
        headers: authHeaders(this.apiKey),
      });
      const latest = pickLatest(response.data?.data ?? response.data);
      if (!latest) return null;

      const eventRiskLevel = Math.max(0, Math.min(1, toNumber(latest.event_risk_level ?? latest.eventRiskLevel ?? latest.risk, 0)));
      const surpriseIndex = toNumber(latest.surprise_index ?? latest.surpriseIndex ?? latest.surprise, 0);
      const policyBias = toNumber(latest.policy_bias ?? latest.policyBias ?? latest.bias, 0);

      return {
        eventRiskLevel,
        surpriseIndex,
        policyBias,
        timestamp: Number(latest.timestamp ?? latest.collected_at ?? Date.now()),
      };
    } catch (error) {
      logger.warn('macro_economic_provider_error', {
        event: 'macro_economic_provider_error',
        error: error instanceof Error ? error.message : String(error),
        provider: 'RestMacroEconomicDataProvider',
      });
      return null;
    }
  }
}

export class RestAlternativeDataProvider implements AlternativeDataProvider {
  private readonly client: AxiosInstance;
  private readonly endpoint: string;
  private readonly apiKey?: string;

  constructor(config: RestProviderConfig) {
    this.apiKey = config.apiKey;
    this.endpoint = config.endpoint ?? '/alternative/snapshot/latest';
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  }

  async fetchAlternativeSnapshot(pair: string): Promise<AlternativeDataSnapshot | null> {
    try {
      const response = await this.client.get(this.endpoint, {
        params: { symbol: normalizeSymbol(pair) },
        headers: authHeaders(this.apiKey),
      });
      const latest = pickLatest(response.data?.data ?? response.data);
      if (!latest) return null;

      const supplyStress = toNumber(latest.supply_stress ?? latest.supplyStress ?? latest.inventoryStress, 0);
      const demandPulse = toNumber(latest.demand_pulse ?? latest.demandPulse ?? latest.activityScore, 0);
      const logisticsPressure = toNumber(latest.logistics_pressure ?? latest.logisticsPressure ?? latest.shippingStress, 0);

      return {
        supplyStress,
        demandPulse,
        logisticsPressure,
        timestamp: Number(latest.timestamp ?? latest.collected_at ?? Date.now()),
      };
    } catch (error) {
      logger.warn('alternative_data_provider_error', {
        event: 'alternative_data_provider_error',
        error: error instanceof Error ? error.message : String(error),
        provider: 'RestAlternativeDataProvider',
      });
      return null;
    }
  }
}
