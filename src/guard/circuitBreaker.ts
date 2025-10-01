import { killSwitch } from './killSwitch';
import { apiErrorCounter, pnlGauge } from '../telemetry/metrics';
import { GuardStateRepository, GuardState } from '../db/guardStateRepo';
import { Notifier } from '../alerts/notifier';
import { logger } from '../utils/logger';
import { errorMessage } from '../utils/formatError';
import { CONFIG } from '../config';

export interface CircuitConfig {
  maxGlobalDrawdownUsd: number;
  maxRunLossUsd: number;
  maxApiErrorsPerMin: number;
  staleTickerMs: number;
}

const DEFAULT_STATE: GuardState = {
  globalPnl: 0,
  runPnl: 0,
  inventoryBase: 0,
  inventoryCost: 0,
  lastTickerTs: Date.now(),
  lastTickerRecordedAt: Date.now(),
  lastTickerSource: null,
  lastTickerLatencyMs: null,
  lastTickerSymbol: null,
  apiErrorTimestamps: [],
};

export interface TickerHeartbeat {
  timestamp?: number | null;
  source?: string | null;
  latencyMs?: number | null;
  symbol?: string | null;
}

export class CircuitBreaker {
  private state: GuardState = { ...DEFAULT_STATE };
  private repo: GuardStateRepository | null = null;
  private initialized = false;
  private baseConfig: CircuitConfig;
  private activeConfig: CircuitConfig;
  private clientId: string | null = null;

  constructor(config: CircuitConfig) {
    this.baseConfig = { ...config };
    this.activeConfig = { ...config };
  }

  private normalize(overrides?: Partial<CircuitConfig>) {
    const pick = (key: keyof CircuitConfig) => {
      const value = overrides?.[key];
      if (value === undefined || value === null) return this.baseConfig[key];
      const num = Number(value);
      return Number.isFinite(num) && num > 0 ? num : this.baseConfig[key];
    };
    this.activeConfig = {
      maxGlobalDrawdownUsd: pick('maxGlobalDrawdownUsd'),
      maxRunLossUsd: pick('maxRunLossUsd'),
      maxApiErrorsPerMin: pick('maxApiErrorsPerMin'),
      staleTickerMs: pick('staleTickerMs'),
    };
  }

  configureForClient(overrides?: Partial<CircuitConfig>, clientId?: string) {
    this.normalize(overrides);
    if (clientId) {
      this.clientId = clientId;
    }
  }

  async initialize(repo: GuardStateRepository) {
    if (this.initialized && this.repo === repo) return;
    this.repo = repo;
    this.state = await repo.load();
    this.initialized = true;
    pnlGauge.labels(this.clientId ?? 'unknown').set(this.state.globalPnl);
  }

  async resetRun() {
    if (!this.initialized || !this.repo) return;
    this.state.runPnl = 0;
    const now = Date.now();
    this.state.lastTickerTs = now;
    this.state.lastTickerRecordedAt = now;
    this.state.lastTickerLatencyMs = null;
    this.state.lastTickerSource = null;
    this.state.lastTickerSymbol = null;
    await this.persist();
  }

  recordTicker(heartbeat: TickerHeartbeat) {
    if (!this.initialized) return;
    const now = Date.now();
    const candidateTs = heartbeat.timestamp ?? now;
    const normalizedTs = Number(candidateTs);
    const effectiveTs = Number.isFinite(normalizedTs) && normalizedTs > 0 ? normalizedTs : now;
    this.state.lastTickerTs = effectiveTs;
    this.state.lastTickerRecordedAt = now;
    if (heartbeat.source !== undefined) {
      this.state.lastTickerSource = heartbeat.source ?? null;
    }
    if (heartbeat.symbol !== undefined) {
      this.state.lastTickerSymbol = heartbeat.symbol ?? null;
    }
    if (heartbeat.latencyMs !== undefined) {
      const normalizedLatency =
        heartbeat.latencyMs === null || heartbeat.latencyMs === undefined
          ? null
          : Number(heartbeat.latencyMs);
      this.state.lastTickerLatencyMs =
        normalizedLatency !== null && Number.isFinite(normalizedLatency) ? normalizedLatency : null;
    }
    this.persist().catch((error) => {
      logger.error('guard_state_persist_failed', {
        event: 'guard_state_persist_failed',
        clientId: this.clientId ?? undefined,
        stage: 'ticker',
        error: errorMessage(error),
      });
    });
  }

  recordApiError(type: string) {
    if (!this.initialized) return;
    const now = Date.now();
    this.state.apiErrorTimestamps.push(now);
    this.state.apiErrorTimestamps = this.state.apiErrorTimestamps.filter((ts) => now - ts <= 60 * 1000);
    apiErrorCounter.labels(this.clientId ?? 'unknown', type).inc();
    this.persist().catch((error) => {
      logger.error('guard_state_persist_failed', {
        event: 'guard_state_persist_failed',
        clientId: this.clientId ?? undefined,
        stage: 'api_error',
        error: errorMessage(error),
      });
    });
    if (this.state.apiErrorTimestamps.length >= this.activeConfig.maxApiErrorsPerMin) {
      const message = `API error rate exceeded (${this.state.apiErrorTimestamps.length}/min, limit ${this.activeConfig.maxApiErrorsPerMin})`;
      killSwitch.activate(message, { clientId: this.clientId ?? undefined }).catch((error) => {
        logger.error('kill_switch_activation_failed', {
          event: 'kill_switch_activation_failed',
          clientId: this.clientId ?? undefined,
          reason: 'api_error_threshold',
          error: errorMessage(error),
        });
      });
      if (this.clientId) {
        Notifier.notifyClient({ clientId: this.clientId, message, subject: 'API Error Threshold' }).catch((error) => {
          logger.warn('notify_client_failed', {
            event: 'notify_client_failed',
            clientId: this.clientId,
            subject: 'API Error Threshold',
            error: errorMessage(error),
          });
        });
      }
    }
  }

  recordFill(side: 'buy' | 'sell', price: number, amount: number, fee = 0) {
    if (!this.initialized) return;
    const value = price * amount;
    if (side === 'buy') {
      this.state.inventoryBase += amount;
      this.state.inventoryCost += value + fee;
    } else {
      if (this.state.inventoryBase <= 0) return;
      const avgCost = this.state.inventoryCost / this.state.inventoryBase;
      const realized = (price - avgCost) * amount - fee;
      this.state.globalPnl += realized;
      this.state.runPnl += realized;
      this.state.inventoryBase -= amount;
      this.state.inventoryCost -= avgCost * amount;
      pnlGauge.labels(this.clientId ?? 'unknown').set(this.state.globalPnl);
      if (this.state.globalPnl <= -this.activeConfig.maxGlobalDrawdownUsd) {
        const message = `Global drawdown exceeded ${this.activeConfig.maxGlobalDrawdownUsd}`;
        killSwitch.activate(message, { clientId: this.clientId ?? undefined }).catch((error) => {
          logger.error('kill_switch_activation_failed', {
            event: 'kill_switch_activation_failed',
            clientId: this.clientId ?? undefined,
            reason: 'drawdown',
            error: errorMessage(error),
          });
        });
        if (this.clientId) {
        Notifier.notifyClient({ clientId: this.clientId, message, subject: 'Global Drawdown Exceeded' }).catch((error) => {
          logger.warn('notify_client_failed', {
            event: 'notify_client_failed',
            clientId: this.clientId,
            subject: 'Global Drawdown Exceeded',
            error: errorMessage(error),
          });
        });
        }
      }
      if (this.state.runPnl <= -this.activeConfig.maxRunLossUsd) {
        const message = `Run loss exceeded ${this.activeConfig.maxRunLossUsd}`;
        killSwitch.activate(message, { clientId: this.clientId ?? undefined }).catch((error) => {
          logger.error('kill_switch_activation_failed', {
            event: 'kill_switch_activation_failed',
            clientId: this.clientId ?? undefined,
            reason: 'run_loss',
            error: errorMessage(error),
          });
        });
        if (this.clientId) {
        Notifier.notifyClient({ clientId: this.clientId, message, subject: 'Run Loss Threshold' }).catch((error) => {
          logger.warn('notify_client_failed', {
            event: 'notify_client_failed',
            clientId: this.clientId,
            subject: 'Run Loss Threshold',
            error: errorMessage(error),
          });
        });
        }
      }
    }
    this.persist().catch((error) => {
      logger.error('guard_state_persist_failed', {
        event: 'guard_state_persist_failed',
        clientId: this.clientId ?? undefined,
        stage: 'record_fill',
        error: errorMessage(error),
      });
    });
  }

  checkStaleData() {
    if (!this.initialized) return;
    const now = Date.now();
    const streamingConfiguredMs =
      CONFIG.STREAMING.ENABLED && CONFIG.STREAMING.STALE_TICKER_MS > 0
        ? CONFIG.STREAMING.STALE_TICKER_MS * 4
        : Number.POSITIVE_INFINITY;
    const threshold = Math.min(this.activeConfig.staleTickerMs, streamingConfiguredMs);
    const lastHeartbeatTs = this.state.lastTickerRecordedAt || this.state.lastTickerTs;
    if (now - lastHeartbeatTs > threshold) {
      const staleForMs = now - lastHeartbeatTs;
      const message = `Market data stale for ${Math.round(staleForMs)}ms`;
      killSwitch.activate(message, { clientId: this.clientId ?? undefined }).catch((error) => {
        logger.error('kill_switch_activation_failed', {
          event: 'kill_switch_activation_failed',
          clientId: this.clientId ?? undefined,
          reason: 'stale_data',
          error: errorMessage(error),
        });
      });
      if (this.clientId) {
        Notifier.notifyClient({ clientId: this.clientId, message, subject: 'Market Data Stale' }).catch((error) => {
          logger.warn('notify_client_failed', {
            event: 'notify_client_failed',
            clientId: this.clientId,
            subject: 'Market Data Stale',
            error: errorMessage(error),
          });
        });
      }
      logger.warn('market_data_stale_detected', {
        event: 'market_data_stale_detected',
        clientId: this.clientId ?? undefined,
        staleForMs,
        threshold,
        lastTickerSource: this.state.lastTickerSource ?? undefined,
        lastTickerLatencyMs: this.state.lastTickerLatencyMs ?? undefined,
        lastTickerSymbol: this.state.lastTickerSymbol ?? undefined,
      });
    }
  }

  private async persist() {
    if (!this.repo) return;
    await this.repo.save(this.state);
  }
}

export const circuitBreaker = new CircuitBreaker({
  maxGlobalDrawdownUsd: Number(process.env.MAX_GLOBAL_DRAWDOWN_USD || '500'),
  maxRunLossUsd: Number(process.env.MAX_RUN_LOSS_USD || '200'),
  maxApiErrorsPerMin: Number(process.env.MAX_API_ERRORS_PER_MIN || '10'),
  staleTickerMs: Number(process.env.STALE_TICKER_MS || (5 * 60 * 1000).toString()),
});
