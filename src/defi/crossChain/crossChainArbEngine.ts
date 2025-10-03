import { logger } from '../../utils/logger';
import type { ArbitrageOpportunity } from '../../exchanges/adapters/types';

export interface BridgeRoute {
  sourceChainId: number;
  destinationChainId: number;
  bridge: string;
  estimatedFeeUsd: number;
  estimatedDurationSec: number;
}

export interface CrossChainArbConfig {
  bridges: BridgeRoute[];
  minProfitUsd: number;
}

export interface CrossChainArbResult {
  opportunity: ArbitrageOpportunity;
  bridgeUsed: BridgeRoute;
  netProfitUsd: number;
  etaSeconds: number;
}

export class CrossChainArbEngine {
  constructor(private readonly config: CrossChainArbConfig) {}

  findBestBridge(sourceChainId: number, destinationChainId: number): BridgeRoute | null {
    return (
      this.config.bridges
        .filter((bridge) => bridge.sourceChainId === sourceChainId && bridge.destinationChainId === destinationChainId)
        .sort((a, b) => a.estimatedFeeUsd - b.estimatedFeeUsd)[0] ?? null
    );
  }

  async evaluate(opportunity: ArbitrageOpportunity, sourceChainId: number, destinationChainId: number): Promise<CrossChainArbResult | null> {
    const bridge = this.findBestBridge(sourceChainId, destinationChainId);
    if (!bridge) return null;
    const grossProfit = (opportunity.spreadPct / 100) * opportunity.volumeUsd;
    const netProfit = grossProfit - bridge.estimatedFeeUsd;
    if (netProfit < this.config.minProfitUsd) {
      return null;
    }
    logger.info('cross_chain_arb_evaluated', {
      event: 'cross_chain_arb_evaluated',
      opportunity,
      bridge,
      netProfit,
    });
    return {
      opportunity,
      bridgeUsed: bridge,
      netProfitUsd: netProfit,
      etaSeconds: bridge.estimatedDurationSec,
    };
  }
}
