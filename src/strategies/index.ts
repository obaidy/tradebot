export {
  listStrategies,
  getStrategyDefinition,
  ensureStrategySupportsRunMode,
  checkStrategyRequirements,
} from './registry';
export { runGridStrategy } from './gridStrategy';
export { runMevBot } from './mevStrategy';
export { runDexSwapStrategy } from './dexSwapStrategy';
export { runPerpGridStrategy } from './perpGridStrategy';
export { runDexAggregationStrategy } from './dexAggregationStrategy';
export { runYieldFarmingStrategy } from './yieldFarmingStrategy';
export { runFlashLoanArbStrategy } from './flashLoanArbStrategy';
export { runCrossChainArbStrategy } from './crossChainArbStrategy';
export { runNftMarketMakerStrategy } from './nftMarketMakerStrategy';
export { runWhaleCopyStrategy } from './whaleCopy';
export { runSentimentSniperStrategy } from './sentimentSniper';
export { runPerpBasisStrategy } from './perpBasis';
export type { StrategyRequirement, StrategySummary } from './registry';
export type { StrategyId, StrategyRunMode, StrategyRunContext } from './types';

import { getStrategyDefinition } from './registry';
import type { StrategyId, StrategyRunContext } from './types';

export async function runStrategy(strategyId: StrategyId, context: StrategyRunContext) {
  const definition = getStrategyDefinition(strategyId);
  if (!definition) {
    throw new Error(`unknown_strategy:${strategyId}`);
  }
  await definition.run(context);
}
