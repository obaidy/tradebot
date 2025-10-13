import { TradeApprovalRepository, TradeApprovalRecord } from '../db/tradeApprovalRepo';
import { ClientAuditLogRepository } from '../db/auditLogRepo';
import { logger } from '../utils/logger';

export class ApprovalRequiredError extends Error {
  public readonly approval: TradeApprovalRecord;

  constructor(message: string, approval: TradeApprovalRecord) {
    super(message);
    this.name = 'ApprovalRequiredError';
    this.approval = approval;
  }
}

type EnsureApprovedInput = {
  clientId: string;
  strategyId?: string | null;
  correlationId: string;
  amountUsd: number;
  requestedBy: string;
  metadata?: Record<string, unknown>;
};

export class TradeApprovalPolicy {
  private readonly thresholdUsd: number;
  private readonly actorForAudit: string;

  constructor(
    private readonly approvals: TradeApprovalRepository,
    private readonly auditLog: ClientAuditLogRepository,
    options?: { thresholdUsd?: number; actorForAudit?: string }
  ) {
    this.thresholdUsd = options?.thresholdUsd ?? Number(process.env.TRADE_APPROVAL_THRESHOLD_USD || 50000);
    this.actorForAudit = options?.actorForAudit ?? 'system';
  }

  shouldEnforce(amountUsd: number): boolean {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return false;
    return amountUsd >= this.thresholdUsd;
  }

  async ensureApproved(input: EnsureApprovedInput): Promise<void> {
    if (!this.shouldEnforce(input.amountUsd)) {
      return;
    }

    const existing = await this.approvals.getByCorrelation(input.clientId, input.correlationId);
    if (existing && existing.status === 'approved') {
      return;
    }

    if (existing && existing.status === 'pending') {
      throw new ApprovalRequiredError('Trade approval pending', existing);
    }

    const record = await this.approvals.createPending({
      clientId: input.clientId,
      strategyId: input.strategyId ?? null,
      correlationId: input.correlationId,
      tradeType: 'grid_trade',
      thresholdReason: `amount_usd>=${this.thresholdUsd}`,
      amountUsd: input.amountUsd,
      requestedBy: input.requestedBy,
      metadata: input.metadata ?? null,
    });

    await this.auditLog.addEntry({
      clientId: input.clientId,
      actor: this.actorForAudit,
      action: 'trade_approval_requested',
      metadata: {
        correlationId: input.correlationId,
        strategyId: input.strategyId ?? null,
        threshold: this.thresholdUsd,
        amountUsd: input.amountUsd,
      },
    });

    logger.warn('trade_approval_required', {
      event: 'trade_approval_required',
      clientId: input.clientId,
      strategyId: input.strategyId,
      correlationId: input.correlationId,
      amountUsd: input.amountUsd,
      threshold: this.thresholdUsd,
      approvalId: record.id,
    });

    throw new ApprovalRequiredError('Trade exceeds configured threshold and requires approval', record);
  }
}
