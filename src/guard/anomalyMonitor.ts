import { ClientAuditLogRepository } from '../db/auditLogRepo';
import { logger } from '../utils/logger';

export interface TradeAnomalyContext {
  clientId: string;
  runId: string;
  strategyId?: string | null;
  amountUsd: number;
  perTradeUsd: number;
  baselinePerTradeUsd: number;
  compositeScore?: number | null;
  actor?: string | null;
}

type Anomaly = {
  code: string;
  message: string;
  severity: 'warning' | 'critical';
};

export class TradeAnomalyMonitor {
  private readonly largeTradeThreshold: number;
  private readonly negativeScoreThreshold: number;
  private readonly perTradeMultiplier: number;
  private readonly actorForAudit: string;

  constructor(private readonly auditLog: ClientAuditLogRepository, options?: {
    largeTradeThreshold?: number;
    negativeScoreThreshold?: number;
    perTradeMultiplier?: number;
    actorForAudit?: string;
  }) {
    this.largeTradeThreshold = options?.largeTradeThreshold ?? Number(process.env.ANOMALY_LARGE_TRADE_USD || 75000);
    this.negativeScoreThreshold = options?.negativeScoreThreshold ?? Number(process.env.ANOMALY_NEGATIVE_SCORE_THRESHOLD || -0.4);
    this.perTradeMultiplier = options?.perTradeMultiplier ?? Number(process.env.ANOMALY_PER_TRADE_MULTIPLIER || 2.5);
    this.actorForAudit = options?.actorForAudit ?? 'system';
  }

  private detect(context: TradeAnomalyContext): Anomaly[] {
    const findings: Anomaly[] = [];
    if (Number.isFinite(context.amountUsd) && context.amountUsd >= this.largeTradeThreshold) {
      findings.push({
        code: 'large_exposure',
        message: `Planned exposure ${context.amountUsd.toFixed(2)} exceeds large trade threshold ${this.largeTradeThreshold}.`,
        severity: 'warning',
      });
    }
    if (
      Number.isFinite(context.perTradeUsd) &&
      Number.isFinite(context.baselinePerTradeUsd) &&
      context.baselinePerTradeUsd > 0 &&
      context.perTradeUsd >= context.baselinePerTradeUsd * this.perTradeMultiplier
    ) {
      findings.push({
        code: 'per_trade_spike',
        message: `Per-trade USD ${context.perTradeUsd.toFixed(2)} exceeds ${this.perTradeMultiplier}× baseline ${context.baselinePerTradeUsd.toFixed(2)}.`,
        severity: 'warning',
      });
    }
    if (
      context.compositeScore !== undefined &&
      context.compositeScore !== null &&
      context.compositeScore <= this.negativeScoreThreshold &&
      context.perTradeUsd > context.baselinePerTradeUsd
    ) {
      findings.push({
        code: 'negative_regime_risk',
        message: `Composite score ${context.compositeScore.toFixed(4)} is below ${this.negativeScoreThreshold} while per-trade increased.`,
        severity: 'warning',
      });
    }
    return findings;
  }

  async evaluate(context: TradeAnomalyContext): Promise<void> {
    const anomalies = this.detect(context);
    if (!anomalies.length) return;

    const metadata = {
      runId: context.runId,
      strategyId: context.strategyId ?? null,
      amountUsd: context.amountUsd,
      perTradeUsd: context.perTradeUsd,
      baselinePerTradeUsd: context.baselinePerTradeUsd,
      compositeScore: context.compositeScore ?? null,
      actor: context.actor ?? null,
      anomalies,
    };

    await this.auditLog.addEntry({
      clientId: context.clientId,
      actor: this.actorForAudit,
      action: 'trade_anomaly_detected',
      metadata,
    });

    logger.warn('trade_anomaly_detected', {
      event: 'trade_anomaly_detected',
      clientId: context.clientId,
      runId: context.runId,
      strategyId: context.strategyId,
      anomalies,
    });
  }
}
