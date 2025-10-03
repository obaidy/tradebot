import { createExchangeAdapter } from '../exchanges/adapterFactory';
import type { StrategyRunContext } from './types';
import { logger } from '../utils/logger';

function resolveDexConfig(ctx: StrategyRunContext) {
  const config = ctx.config ?? {};
  return {
    tokenIn: (config.tokenIn as string) || process.env.DEX_TOKEN_IN || 'WETH',
    tokenOut: (config.tokenOut as string) || process.env.DEX_TOKEN_OUT || 'USDC',
    amountIn: Number(config.amountIn ?? process.env.DEX_AMOUNT_IN ?? 0.1),
    slippagePct: Number(config.slippagePct ?? process.env.DEX_MAX_SLIPPAGE_PCT ?? 0.5),
    recipient: (config.recipient as string) || process.env.DEX_RECIPIENT || '',
    rpcUrl: (config.rpcUrl as string) || process.env.DEX_RPC_URL,
    privateKey: (config.privateKey as string) || process.env.DEX_PRIVATE_KEY,
  };
}

export async function runDexSwapStrategy(ctx: StrategyRunContext) {
  const { tokenIn, tokenOut, amountIn, recipient, rpcUrl, privateKey, slippagePct } = resolveDexConfig(ctx);

  if (!rpcUrl) {
    throw new Error('dex_rpc_url_missing');
  }

  if (!privateKey && ctx.runMode === 'live') {
    throw new Error('dex_private_key_missing');
  }

  const adapter = createExchangeAdapter({
    kind: 'dex',
    id: 'dex-router',
    rpcUrl,
    privateKey: privateKey ?? undefined,
    extra: { routerAddress: process.env.DEX_ROUTER_ADDRESS },
  });

  await adapter.connect();
  try {
    if (ctx.runMode !== 'live') {
      logger.info('dex_swap_simulation', {
        event: 'dex_swap_simulation',
        clientId: ctx.clientId,
        tokenIn,
        tokenOut,
        amountIn,
        slippagePct,
        runMode: ctx.runMode,
      });
      return;
    }

    const minAmountOutEstimate = await adapter.estimateSwap?.({
      tokenIn,
      tokenOut,
      amountIn,
    });

    const minAmountOut = minAmountOutEstimate
      ? minAmountOutEstimate * (1 - slippagePct / 100)
      : 0;

    const txHash = await adapter.executeSwap?.({
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut,
      recipient: recipient || ctx.clientId,
    });

    logger.info('dex_swap_executed', {
      event: 'dex_swap_executed',
      clientId: ctx.clientId,
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut,
      txHash,
    });
  } finally {
    await adapter.disconnect();
  }
}
