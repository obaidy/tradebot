export {
  listStrategies,
  getStrategyDefinition,
  ensureStrategySupportsRunMode,
  checkStrategyRequirements,
} from './registry';
export { runGridStrategy } from './gridStrategy';
export { runMevBot } from './mevStrategy';
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
