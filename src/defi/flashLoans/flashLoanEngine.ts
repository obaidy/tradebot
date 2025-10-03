import { logger } from '../../utils/logger';
import type { ArbitrageOpportunity } from '../../exchanges/adapters/types';

export interface FlashLoanConfig {
  provider: 'aave' | 'balancer' | 'dydx';
  chainId: number;
  maxBorrowUsd: number;
  slippageBps: number;
}

export interface FlashLoanExecutionResult {
  opportunity: ArbitrageOpportunity;
  profitUsd: number;
  txHash?: string;
}

export class FlashLoanEngine {
  constructor(private readonly config: FlashLoanConfig) {}

  async evaluate(opportunity: ArbitrageOpportunity): Promise<boolean> {
    const potentialProfit = (opportunity.spreadPct / 100) * opportunity.volumeUsd;
    const feasible = potentialProfit > 0 && opportunity.volumeUsd <= this.config.maxBorrowUsd;
    logger.debug('flash_loan_evaluate', {
      event: 'flash_loan_evaluate',
      feasible,
      potentialProfit,
      provider: this.config.provider,
    });
    return feasible;
  }

  async execute(opportunity: ArbitrageOpportunity): Promise<FlashLoanExecutionResult> {
    const profitUsd = (opportunity.spreadPct / 100) * opportunity.volumeUsd * 0.8; // haircut for fees
    logger.info('flash_loan_execute', {
      event: 'flash_loan_execute',
      provider: this.config.provider,
      opportunity,
      profitUsd,
    });
    return {
      opportunity,
      profitUsd,
      txHash: `flash-${Date.now()}`,
    };
  }
}
