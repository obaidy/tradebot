import { Pool } from 'pg';
import { CONFIG } from '../config';
import {
  ClientApiCredentialRow,
  ClientApiCredentialsRepository,
  ClientRow,
  ClientsRepository,
} from '../db/clientsRepo';
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
}

export interface GuardLimits {
  maxGlobalDrawdownUsd?: number;
  maxRunLossUsd?: number;
  maxApiErrorsPerMin?: number;
  staleTickerMs?: number;
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

export class ClientConfigService {
  private readonly clientsRepo: ClientsRepository;
  private readonly credentialsRepo: ClientApiCredentialsRepository;
  private readonly allowedClientId?: string;
  private readonly defaultExchange: string;

  constructor(private readonly pool: Pool, opts: ClientConfigServiceOptions = {}) {
    this.clientsRepo = new ClientsRepository(pool);
    this.credentialsRepo = new ClientApiCredentialsRepository(pool);
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
    return { client, limits, risk, exchangeId, guard };
  }

  async getClientConfig(clientId: string, exchangeName?: string): Promise<ClientConfig> {
    const profile = await this.getClientProfile(clientId);
    const exchangeId = exchangeName ?? profile.exchangeId;
    const credentialsRow = await this.credentialsRepo.getCredentials(clientId, exchangeId);
    if (!credentialsRow) {
      throw new Error(`Missing API credentials for client ${clientId} on exchange ${exchangeId}`);
    }
    await initSecretManager();
    const apiKey = decryptSecret(credentialsRow.apiKeyEnc);
    const apiSecret = decryptSecret(credentialsRow.apiSecretEnc);
    const passphrase = credentialsRow.passphraseEnc ? decryptSecret(credentialsRow.passphraseEnc) : null;

    return {
      client: profile.client,
      limits: profile.limits,
      risk: profile.risk,
      guard: profile.guard,
      exchange: {
        id: exchangeId,
        apiKey,
        apiSecret,
        passphrase,
        row: credentialsRow,
      },
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
    const apiKeyEnc = encryptSecret(input.apiKey);
    const apiSecretEnc = encryptSecret(input.apiSecret);
    const passphraseEnc = input.passphrase ? encryptSecret(input.passphrase) : null;
    return this.credentialsRepo.upsert({
      clientId: input.clientId,
      exchangeName: input.exchangeName,
      apiKeyEnc,
      apiSecretEnc,
      passphraseEnc,
    });
  }
}
