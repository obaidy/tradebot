import { DexAggregationService } from '../defi/aggregators';
import type { StrategyRunContext } from './types';
import { logger } from '../utils/logger';

interface DexAggregationConfig {
  chainId?: number;
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: number;
  slippageBps?: number;
  recipient?: string;
  aggregator?: string;
}

function resolveConfig(ctx: StrategyRunContext): Required<DexAggregationConfig> {
  const cfg = ctx.config ?? {};
  return {
    chainId: Number(cfg.chainId ?? process.env.DEX_CHAIN_ID ?? 1),
    tokenIn: String(cfg.tokenIn ?? process.env.DEX_TOKEN_IN ?? 'ETH'),
    tokenOut: String(cfg.tokenOut ?? process.env.DEX_TOKEN_OUT ?? 'USDC'),
    amountIn: Number(cfg.amountIn ?? process.env.DEX_AMOUNT_IN ?? 0.5),
    slippageBps: Number(cfg.slippageBps ?? process.env.DEX_SLIPPAGE_BPS ?? 50),
    recipient: String(cfg.recipient ?? ctx.clientId),
    aggregator: String(cfg.aggregator ?? ''),
  };
}

export async function runDexAggregationStrategy(ctx: StrategyRunContext) {
  const config = resolveConfig(ctx);
  const service = new DexAggregationService();
  const quote = await service.quoteBestRoute({
    chainId: config.chainId,
    tokenIn: config.tokenIn,
    tokenOut: config.tokenOut,
    amountIn: config.amountIn.toString(),
    slippageBps: config.slippageBps,
    userAddress: config.recipient,
  });

  logger.info('dex_aggregation_quote', {
    event: 'dex_aggregation_quote',
    clientId: ctx.clientId,
    quote,
  });

  if (ctx.runMode !== 'live') {
    logger.info('dex_aggregation_simulation', {
      event: 'dex_aggregation_simulation',
      clientId: ctx.clientId,
      quote,
    });
    return;
  }

  const swap = await service.executeSwap({
    chainId: config.chainId,
    tokenIn: config.tokenIn,
    tokenOut: config.tokenOut,
    amountIn: config.amountIn.toString(),
    slippageBps: config.slippageBps,
    recipient: config.recipient,
    minAmountOut: quote.amountOut,
    aggregator: config.aggregator || quote.aggregator,
  });

  logger.info('dex_aggregation_executed', {
    event: 'dex_aggregation_executed',
    clientId: ctx.clientId,
    swap,
  });
}
