import { parseUnits } from 'ethers';
import { StrategyRunContext } from '../types';
import { getPool } from '../../db/pool';
import { runMigrations } from '../../db/migrations';
import { WhaleWatchlistRepository } from '../../db/whaleWatchlistRepo';
import { BotSignalsRepository } from '../../db/botSignalsRepo';
import { RunsRepository, OrdersRepository } from '../../db/repositories';
import { WhaleCopyWorker } from './worker';
import { logger, setLogContext, clearLogContext } from '../../utils/logger';
import { getTokenMetadata } from '../../services/onchain/tokenMetadata';

export async function runWhaleCopyStrategy(ctx: StrategyRunContext) {
  setLogContext({ strategy: 'whale-copy', clientId: ctx.clientId, runMode: ctx.runMode });
  try {
    const pool = getPool();
    await runMigrations(pool);

    const watchlistRepo = new WhaleWatchlistRepository(pool, ctx.clientId);
    const signalsRepo = new BotSignalsRepository(pool, ctx.clientId);
    const runsRepo = new RunsRepository(pool, ctx.clientId);
    const ordersRepo = new OrdersRepository(pool, ctx.clientId);

    const baseToken =
      (typeof ctx.config?.baseToken === 'string' && ctx.config.baseToken) ||
      process.env.WHALE_COPY_BASE_TOKEN ||
      '0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2'; // WETH

    const baseTokenMeta = await getTokenMetadata(baseToken);

    const bankrollTokens =
      Number(ctx.config?.bankroll ?? process.env.WHALE_COPY_BANKROLL ?? process.env.WHALE_COPY_BANKROLL_ETH ?? 3) ||
      3;
    const bankrollAtomic = parseUnits(bankrollTokens.toString(), baseTokenMeta.decimals);
    const baseTradePct =
      Number(ctx.config?.sizePct ?? process.env.WHALE_COPY_SIZE_PCT ?? process.env.WHALE_COPY_BASE_TRADE_PCT ?? 0.003);
    const baseTradeBps = Math.max(1, Math.min(2000, Math.round(baseTradePct * 10_000)));
    const blockLookback = Number(ctx.config?.blockLookback ?? process.env.WHALE_COPY_BLOCK_LOOKBACK ?? 40);
    const slippageBps = Math.max(
      25,
      Number(ctx.config?.slippageBps ?? process.env.WHALE_COPY_SLIPPAGE_BPS ?? 200)
    );
    const walletPrivateKey =
      (typeof ctx.config?.walletPrivateKey === 'string' && ctx.config.walletPrivateKey.length
        ? ctx.config.walletPrivateKey
        : null) ?? process.env.WALLET_PRIVATE_KEY;

    const worker = new WhaleCopyWorker(watchlistRepo, signalsRepo, {
      clientId: ctx.clientId,
      runMode: ctx.runMode,
      baseTradeBps,
      bankrollAtomic,
      blockLookback,
      baseTokenAddress: baseTokenMeta.address,
      baseTokenDecimals: baseTokenMeta.decimals,
      baseTokenSymbol: baseTokenMeta.symbol ?? 'WETH',
      slippageBps,
      walletPrivateKey: walletPrivateKey ?? undefined,
      runsRepo,
      ordersRepo,
    });

    const processed = await worker.runOnce();
    logger.info('whale_copy_run_complete', {
      event: 'whale_copy_run_complete',
      processed,
      clientId: ctx.clientId,
    });
  } finally {
    clearLogContext();
  }
}
