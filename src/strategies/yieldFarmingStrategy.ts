import { YieldFarmManager } from '../defi/yield/yieldFarmManager';
import type { StrategyRunContext } from './types';
import { logger } from '../utils/logger';

interface YieldConfig {
  protocol?: string;
  poolAddress?: string;
  chainId?: number;
  tokenIn?: string;
  amount?: number;
  compoundRewards?: boolean;
}

function resolveConfig(ctx: StrategyRunContext): Required<YieldConfig> {
  const cfg = ctx.config ?? {};
  return {
    protocol: String(cfg.protocol ?? process.env.YIELD_PROTOCOL ?? 'uniswap-v3'),
    poolAddress: String(cfg.poolAddress ?? process.env.YIELD_POOL_ADDRESS ?? '0xPool'),
    chainId: Number(cfg.chainId ?? process.env.YIELD_CHAIN_ID ?? 1),
    tokenIn: String(cfg.tokenIn ?? process.env.YIELD_TOKEN_IN ?? 'USDC'),
    amount: Number(cfg.amount ?? process.env.YIELD_AMOUNT ?? 1000),
    compoundRewards: Boolean(cfg.compoundRewards ?? (process.env.YIELD_COMPOUND ?? 'true') === 'true'),
  };
}

export async function runYieldFarmingStrategy(ctx: StrategyRunContext) {
  const config = resolveConfig(ctx);
  const manager = new YieldFarmManager();

  const position = await manager.deployLiquidity({
    protocol: config.protocol,
    poolAddress: config.poolAddress,
    chainId: config.chainId,
    tokenIn: config.tokenIn,
    amount: config.amount,
    compoundRewards: config.compoundRewards,
  });

  if (ctx.runMode !== 'live') {
    logger.info('yield_farming_simulation', {
      event: 'yield_farming_simulation',
      clientId: ctx.clientId,
      position,
    });
    return;
  }

  const harvested = await manager.harvestRewards(position);
  logger.info('yield_farming_harvested', {
    event: 'yield_farming_harvested',
    clientId: ctx.clientId,
    harvested,
  });

  if (!config.compoundRewards) {
    await manager.unwind(harvested);
    logger.info('yield_farming_unwound', {
      event: 'yield_farming_unwound',
      clientId: ctx.clientId,
      harvested,
    });
  }
}
