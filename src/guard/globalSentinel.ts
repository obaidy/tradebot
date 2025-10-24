import ccxt from 'ccxt';
import type { Pool } from 'pg';
import { killSwitch } from './killSwitch';
import { RiskEventsRepository } from '../db/riskEventsRepo';
import { logger } from '../utils/logger';
import { errorMessage } from '../utils/formatError';
import { getHttpProvider } from '../services/onchain/provider';
import { Notifier } from '../alerts/notifier';
import { sentinelTriggerCounter, sentinelGasGauge, sentinelBtcMoveGauge } from '../telemetry/metrics';

export interface GlobalSentinelConfig {
  clientId: string;
  pool: Pool;
  btcThresholdPct?: number;
  gasMaxWei?: bigint;
  evaluateExchanges?: string[];
  cooldownMs?: number;
}

interface SentinelFinding {
  type: string;
  severity: number;
  message: string;
  details?: Record<string, unknown>;
}

export class GlobalKillSwitchSentinel {
  private readonly btcThresholdPct: number;
  private readonly gasMaxWei: bigint;
  private readonly exchanges: string[];
  private readonly cooldownMs: number;
  private readonly repo: RiskEventsRepository;

  constructor(private readonly config: GlobalSentinelConfig) {
    this.repo = new RiskEventsRepository(config.pool, config.clientId);
    this.btcThresholdPct = config.btcThresholdPct ?? Number(process.env.BTC_NUKE_TRIGGER_PCT_5M ?? 4);
    const gasThresholdRaw = process.env.MAX_GAS_WEI ?? '250000000000';
    const parsedGas = config.gasMaxWei ?? BigInt(gasThresholdRaw);
    this.gasMaxWei = parsedGas;
    this.exchanges =
      config.evaluateExchanges && config.evaluateExchanges.length
        ? config.evaluateExchanges
        : ['binance', 'kucoin'];
    this.cooldownMs = config.cooldownMs ?? Number(process.env.KILL_SWITCH_SENTINEL_COOLDOWN_MS ?? 120_000);
  }

  async evaluate(): Promise<void> {
    try {
      const findings = await this.collectFindings();
      if (!findings.length) return;
      for (const finding of findings) {
        const latest = await this.repo.latestByType(finding.type);
        if (latest && Date.now() - latest.createdAt.getTime() < this.cooldownMs) {
          continue;
        }
        await this.repo.insert({
          type: finding.type,
          severity: finding.severity,
          details: {
            message: finding.message,
            ...(finding.details ?? {}),
          },
        });
        const activated = await this.activate(finding);
        if (activated) {
          break;
        }
      }
    } catch (error) {
      logger.error('global_sentinel_failed', {
        event: 'global_sentinel_failed',
        clientId: this.config.clientId,
        error: errorMessage(error),
      });
    }
  }

  private async activate(finding: SentinelFinding): Promise<boolean> {
    if (killSwitch.isActive()) {
      logger.debug('kill_switch_already_active', {
        event: 'kill_switch_already_active',
        reason: finding.message,
      });
      return false;
    }
    sentinelTriggerCounter.labels(this.config.clientId, finding.type).inc();
    await killSwitch.activate(finding.message, { clientId: this.config.clientId }).catch((error) => {
      logger.error('kill_switch_activation_error', {
        event: 'kill_switch_activation_error',
        clientId: this.config.clientId,
        reason: finding.message,
        error: errorMessage(error),
      });
    });
    await Notifier.notifyOps(`Kill switch triggered (${finding.type}): ${finding.message}`).catch((error) => {
      logger.warn('kill_switch_notify_failed', {
        event: 'kill_switch_notify_failed',
        clientId: this.config.clientId,
        reason: finding.message,
        error: errorMessage(error),
      });
    });
    return true;
  }

  private async collectFindings(): Promise<SentinelFinding[]> {
    const [btc, gas, api] = await Promise.allSettled([
      this.checkBtcMomentum(),
      this.checkGas(),
      this.checkExchangeHealth(),
    ]);
    const findings: SentinelFinding[] = [];
    if (btc.status === 'fulfilled' && btc.value) findings.push(btc.value);
    if (gas.status === 'fulfilled' && gas.value) findings.push(gas.value);
    if (api.status === 'fulfilled' && api.value) findings.push(api.value);
    return findings;
  }

  private async checkBtcMomentum(): Promise<SentinelFinding | null> {
    try {
      const binance = new ccxt.binance({ enableRateLimit: true });
      const candles = (await binance.fetchOHLCV('BTC/USDT', '1m', undefined, 6)) as Array<
        [number, number, number, number, number, number]
      >;
      if (!candles || candles.length < 2) return null;
      const lookbackIndex = Math.max(0, candles.length - 6);
      const baseline = candles[lookbackIndex];
      const latest = candles[candles.length - 1];
      if (!baseline || !latest) return null;
      const first = Number(baseline[4]);
      const last = Number(latest[4]);
      if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null;
      const changePct = ((last - first) / first) * 100;
      sentinelBtcMoveGauge.labels(this.config.clientId).set(changePct);
      if (changePct <= -this.btcThresholdPct) {
        return {
          type: 'btc_drop',
          severity: 5,
          message: `BTC fell ${changePct.toFixed(2)}% in ~5m`,
          details: { changePct, first, last },
        };
      }
      return null;
    } catch (error) {
      logger.warn('sentinel_btc_check_failed', {
        event: 'sentinel_btc_check_failed',
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async checkGas(): Promise<SentinelFinding | null> {
    try {
      const provider = getHttpProvider();
      const feeData = await provider.getFeeData();
      const maxFee = feeData.maxFeePerGas ?? feeData.gasPrice;
      if (maxFee) {
        sentinelGasGauge.labels(this.config.clientId).set(Number(maxFee));
      }
      if (!maxFee) return null;
      if (maxFee >= this.gasMaxWei) {
        return {
          type: 'gas_spike',
          severity: 4,
          message: `Gas ${maxFee.toString()} wei exceeds ${this.gasMaxWei.toString()} wei`,
          details: {
            gasWei: maxFee.toString(),
            thresholdWei: this.gasMaxWei.toString(),
          },
        };
      }
      return null;
    } catch (error) {
      logger.warn('sentinel_gas_check_failed', {
        event: 'sentinel_gas_check_failed',
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async checkExchangeHealth(): Promise<SentinelFinding | null> {
    const issues: Record<string, string> = {};
    await Promise.all(
      this.exchanges.map(async (exchangeId) => {
        const ExchangeClass = (ccxt as any)[exchangeId];
        if (!ExchangeClass) {
          return;
        }
        const exchange = new ExchangeClass({ enableRateLimit: true });
        if (!exchange.has.fetchStatus) {
          return;
        }
        try {
          const status = await exchange.fetchStatus();
          if (status.status !== 'ok') {
            issues[exchangeId] = status.status ?? 'unknown';
          }
        } catch (error) {
          issues[exchangeId] = error instanceof Error ? error.message : String(error);
        }
      })
    );
    const entries = Object.entries(issues);
    if (!entries.length) return null;
    const detailEntries = entries.map(([exchange, reason]) => `${exchange}:${reason}`).join(', ');
    return {
      type: 'api_down',
      severity: 3,
      message: `Exchange health degraded (${detailEntries})`,
      details: issues,
    };
  }
}
