import { Pool } from 'pg';
import { CONFIG } from '../config';
import {
  ClientApiCredentialRow,
  ClientApiCredentialsRepository,
  ClientRow,
  ClientsRepository,
  ClientStrategySecretRow,
  ClientStrategySecretUpsert,
  ClientStrategySecretsRepository,
} from '../db/clientsRepo';
import { ClientStrategyAllocationsRepository } from '../db/clientStrategyAllocationsRepo';
import type { StrategyId, StrategyRunMode } from '../strategies/types';
import { decryptSecret, encryptSecret, initSecretManager } from '../secrets/secretManager';

function toNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  return String(value);
}

export interface RiskConfig {
  bankrollUsd: number;
  maxPerTradePct: number;
  dailyLossStopPct: number;
  perTradeUsd?: number;
}

export interface ClientLimits {
  risk?: Partial<Record<string, unknown>>;
  exchange?: {
    primary?: string;
    symbols?: string[];
    maxNotionalUsd?: number;
    [key: string]: unknown;
  };
  throttles?: Record<string, unknown>;
  guard?: Record<string, unknown>;
  maxSymbols?: number;
  allowLiveTrading?: boolean;
  allowedSymbols?: string[];
  maxExposureUsd?: number;
  paperOnly?: boolean;
  allowedExchanges?: string[];
  maxDailyVolumeUsd?: number;
  [key: string]: unknown;
}

export interface ClientConfig {
  client: ClientRow;
  risk: RiskConfig;
  exchange: {
    id: string;
    apiKey: string;
    apiSecret: string;
    passphrase?: string | null;
    row: ClientApiCredentialRow;
  };
  limits: ClientLimits;
  guard: GuardLimits;
  operations: OperationalLimits;
  portfolio: StrategyPortfolioConfig;
}

export interface GuardLimits {
  maxGlobalDrawdownUsd?: number;
  maxRunLossUsd?: number;
  maxApiErrorsPerMin?: number;
  staleTickerMs?: number;
}

export interface OperationalLimits {
  maxSymbols?: number;
  allowLiveTrading?: boolean;
  maxPerTradeUsd?: number;
  allowedSymbols?: string[] | null;
  maxExposureUsd?: number;
  paperOnly?: boolean;
  allowedExchanges?: string[] | null;
  maxDailyVolumeUsd?: number;
}

export interface StrategyAllocationConfig {
  strategyId: StrategyId;
  weightPct: number;
  maxRiskPct?: number | null;
  runMode?: StrategyRunMode | null;
  enabled: boolean;
  config?: Record<string, unknown> | null;
}

export interface StrategyPortfolioConfig {
  allocations: StrategyAllocationConfig[];
  totalWeightPct: number;
}

export interface ClientConfigServiceOptions {
  allowedClientId?: string;
  defaultExchange?: string;
}

function deriveRiskConfig(defaults: RiskConfig, overrides: ClientLimits['risk']): RiskConfig {
  const riskOverrides = overrides ?? {};
  const bankroll = riskOverrides.bankrollUsd ?? riskOverrides.bankroll_usd;
  const maxPerTrade =
    riskOverrides.maxPerTradePct ?? riskOverrides.max_per_trade_pct ?? riskOverrides.maxPerTrade ?? riskOverrides.max_per_trade;
  const dailyLoss =
    riskOverrides.dailyLossStopPct ??
    riskOverrides.daily_loss_stop_pct ??
    riskOverrides.dailyLossStop ??
    riskOverrides.daily_loss_stop;
  const perTradeUsd = riskOverrides.perTradeUsd ?? riskOverrides.per_trade_usd;

  const risk: RiskConfig = {
    bankrollUsd: toNumber(bankroll, defaults.bankrollUsd),
    maxPerTradePct: toNumber(maxPerTrade, defaults.maxPerTradePct),
    dailyLossStopPct: toNumber(dailyLoss, defaults.dailyLossStopPct),
  };

  if (perTradeUsd !== undefined && perTradeUsd !== null) {
    const parsed = Number(perTradeUsd);
    if (Number.isFinite(parsed) && parsed > 0) {
      risk.perTradeUsd = parsed;
    }
  }

  return risk;
}

function resolveExchangeId(limits: ClientLimits, fallback: string): string {
  const fromLimits = limits.exchange?.primary ?? (limits.exchange as any)?.id;
  const str = normalizeString(fromLimits);
  if (str) return str;
  return fallback;
}

function deriveGuardLimits(overrides: ClientLimits['guard']): GuardLimits {
  const guardOverrides = overrides ?? {};

  const mapNumber = (keys: string[], fallback?: number) => {
    for (const key of keys) {
      const candidate = guardOverrides?.[key];
      if (candidate !== undefined && candidate !== null) {
        const num = Number(candidate);
        if (Number.isFinite(num) && num > 0) {
          return num;
        }
      }
    }
    return fallback;
  };

  return {
    maxGlobalDrawdownUsd: mapNumber(['maxGlobalDrawdownUsd', 'max_global_drawdown_usd']),
    maxRunLossUsd: mapNumber(['maxRunLossUsd', 'max_run_loss_usd']),
    maxApiErrorsPerMin: mapNumber(['maxApiErrorsPerMin', 'max_api_errors_per_min']),
    staleTickerMs: mapNumber(['staleTickerMs', 'stale_ticker_ms']),
  };
}

function deriveOperationalLimits(limits: ClientLimits, risk: RiskConfig): OperationalLimits {
  const maxSymbols = typeof limits.maxSymbols === 'number'
    ? limits.maxSymbols
    : typeof limits.risk?.maxSymbols === 'number'
    ? Number(limits.risk?.maxSymbols)
    : undefined;
  const allowLiveTrading = typeof limits.allowLiveTrading === 'boolean' ? limits.allowLiveTrading : undefined;
  const maxPerTradeUsd = typeof (limits as any).maxPerTradeUsd === 'number'
    ? Number((limits as any).maxPerTradeUsd)
    : typeof (limits.risk as any)?.maxPerTradeUsd === 'number'
    ? Number((limits.risk as any).maxPerTradeUsd)
    : undefined;
  const maxExposureUsd = typeof (limits as any).maxExposureUsd === 'number'
    ? Number((limits as any).maxExposureUsd)
    : typeof (limits.risk as any)?.maxExposureUsd === 'number'
    ? Number((limits.risk as any).maxExposureUsd)
    : undefined;
  const paperOnly = typeof limits.paperOnly === 'boolean' ? limits.paperOnly : undefined;
  const allowedSymbols = Array.isArray(limits.allowedSymbols)
    ? (limits.allowedSymbols as string[])
    : Array.isArray(limits.exchange?.symbols)
    ? (limits.exchange?.symbols as string[])
    : null;
  const allowedExchanges = Array.isArray(limits.allowedExchanges)
    ? (limits.allowedExchanges as string[])
    : Array.isArray((limits.exchange as any)?.allowed)
    ? ((limits.exchange as any)?.allowed as string[])
    : null;
  const maxDailyVolumeUsd = typeof (limits as any).maxDailyVolumeUsd === 'number'
    ? Number((limits as any).maxDailyVolumeUsd)
    : undefined;

  const liveTradingAllowed = paperOnly ? false : allowLiveTrading;

  return {
    maxSymbols,
    allowLiveTrading: liveTradingAllowed,
    maxPerTradeUsd: maxPerTradeUsd ?? risk.perTradeUsd,
    allowedSymbols,
    maxExposureUsd,
    paperOnly,
    allowedExchanges,
    maxDailyVolumeUsd,
  };
}

export class ClientConfigService {
  private readonly clientsRepo: ClientsRepository;
  private readonly credentialsRepo: ClientApiCredentialsRepository;
  private readonly strategySecretsRepo: ClientStrategySecretsRepository;
  private readonly strategyAllocationsRepo: ClientStrategyAllocationsRepository;
  private readonly allowedClientId?: string;
  private readonly defaultExchange: string;

  constructor(private readonly pool: Pool, opts: ClientConfigServiceOptions = {}) {
    this.clientsRepo = new ClientsRepository(pool);
    this.credentialsRepo = new ClientApiCredentialsRepository(pool);
    this.strategySecretsRepo = new ClientStrategySecretsRepository(pool);
    this.strategyAllocationsRepo = new ClientStrategyAllocationsRepository(pool);
    this.allowedClientId = opts.allowedClientId;
    this.defaultExchange = opts.defaultExchange ?? CONFIG.DEFAULT_EXCHANGE;
  }

  private ensureAllowed(clientId: string) {
    if (this.allowedClientId && this.allowedClientId !== clientId) {
      throw new Error(
        `ClientConfigService is restricted to client_id=${this.allowedClientId}; received ${clientId}`
      );
    }
  }

  async getClient(clientId: string): Promise<ClientRow> {
    this.ensureAllowed(clientId);
    const client = await this.clientsRepo.findById(clientId);
    if (!client) {
      throw new Error(`Client ${clientId} not found`);
    }
    if (client.status !== 'active') {
      throw new Error(`Client ${clientId} is not active (status=${client.status})`);
    }
    return client;
  }

  async getClientProfile(clientId: string): Promise<{
    client: ClientRow;
    limits: ClientLimits;
    risk: RiskConfig;
    exchangeId: string;
    guard: GuardLimits;
    operations: OperationalLimits;
  }> {
    const client = await this.getClient(clientId);
    const limits = (client.limits ?? {}) as ClientLimits;
    const riskDefaults: RiskConfig = {
      bankrollUsd: CONFIG.RISK.BANKROLL_USD,
      maxPerTradePct: CONFIG.RISK.MAX_PER_TRADE_PCT,
      dailyLossStopPct: CONFIG.RISK.DAILY_LOSS_STOP_PCT,
    };
    const risk = deriveRiskConfig(riskDefaults, limits.risk);
    const exchangeId = resolveExchangeId(limits, this.defaultExchange);
    const guard = deriveGuardLimits(limits.guard);
    const operations = deriveOperationalLimits(limits, risk);
    const enforceExchangeLimit = !CONFIG.PAPER_MODE;
    if (enforceExchangeLimit && operations.allowedExchanges && operations.allowedExchanges.length > 0) {
      if (!operations.allowedExchanges.includes(exchangeId)) {
        throw new Error(`Exchange ${exchangeId} is not permitted for client ${clientId}`);
      }
    }
    return { client, limits, risk, exchangeId, guard, operations };
  }

  async getClientConfig(clientId: string, exchangeName?: string): Promise<ClientConfig> {
    const profile = await this.getClientProfile(clientId);
    const exchangeId = exchangeName ?? profile.exchangeId;
    const credentialsRow = await this.credentialsRepo.getCredentials(clientId, exchangeId);
    if (!credentialsRow) {
      throw new Error(`Missing API credentials for client ${clientId} on exchange ${exchangeId}`);
    }
    await initSecretManager();
    const apiKey = await decryptSecret(credentialsRow.apiKeyEnc);
    const apiSecret = await decryptSecret(credentialsRow.apiSecretEnc);
    const passphrase = credentialsRow.passphraseEnc ? await decryptSecret(credentialsRow.passphraseEnc) : null;

    const portfolio = await this.getStrategyPortfolio(clientId);

    return {
      client: profile.client,
      limits: profile.limits,
      risk: profile.risk,
      guard: profile.guard,
      operations: profile.operations,
      exchange: {
        id: exchangeId,
        apiKey,
        apiSecret,
        passphrase,
        row: credentialsRow,
      },
      portfolio,
    };
  }

  async storeExchangeCredentials(input: {
    clientId: string;
    exchangeName: string;
    apiKey: string;
    apiSecret: string;
    passphrase?: string | null;
  }): Promise<ClientApiCredentialRow> {
    this.ensureAllowed(input.clientId);
    await initSecretManager();
    const apiKeyEnc = await encryptSecret(input.apiKey);
    const apiSecretEnc = await encryptSecret(input.apiSecret);
    const passphraseEnc = input.passphrase ? await encryptSecret(input.passphrase) : null;
    return this.credentialsRepo.upsert({
      clientId: input.clientId,
      exchangeName: input.exchangeName,
      apiKeyEnc,
      apiSecretEnc,
      passphraseEnc,
    });
  }

  async storeStrategySecret(input: {
    clientId: string;
    strategyId: string;
    secret: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<ClientStrategySecretRow> {
    this.ensureAllowed(input.clientId);
    await initSecretManager();
    const secretEnc = await encryptSecret(input.secret);
    const upsertPayload: ClientStrategySecretUpsert = {
      clientId: input.clientId,
      strategyId: input.strategyId,
      secretEnc,
      metadata: input.metadata ?? null,
    };
    return this.strategySecretsRepo.upsert(upsertPayload);
  }

  async getStrategySecret(clientId: string, strategyId: string): Promise<{
    row: ClientStrategySecretRow;
    secret: string;
  } | null> {
    this.ensureAllowed(clientId);
    const row = await this.strategySecretsRepo.get(clientId, strategyId);
    if (!row) return null;
    await initSecretManager();
    const secret = await decryptSecret(row.secretEnc);
    return { row, secret };
  }

  async deleteStrategySecret(clientId: string, strategyId: string) {
    this.ensureAllowed(clientId);
    await this.strategySecretsRepo.delete(clientId, strategyId);
  }

  async getStrategyPortfolio(clientId: string): Promise<StrategyPortfolioConfig> {
    const rows = await this.strategyAllocationsRepo.listByClient(clientId);
    if (!rows.length) {
      return { allocations: [], totalWeightPct: 0 };
    }

    const allocations: StrategyAllocationConfig[] = rows.map((row) => ({
      strategyId: row.strategyId,
      weightPct: Number(row.weightPct),
      maxRiskPct: row.maxRiskPct,
      runMode: row.runMode ?? undefined,
      enabled: row.enabled,
      config: row.configJson ?? undefined,
    }));

    const totalWeightPct = allocations
      .filter((allocation) => allocation.enabled)
      .reduce((sum, allocation) => sum + allocation.weightPct, 0);

    return { allocations, totalWeightPct };
  }
}
