import { parseUnits } from 'ethers';
import { StrategyRunContext } from '../types';
import { getPool } from '../../db/pool';
import { runMigrations } from '../../db/migrations';
import { SentimentSnapshotsRepository } from '../../db/sentimentSnapshotsRepo';
import { BotSignalsRepository } from '../../db/botSignalsRepo';
import { RunsRepository, OrdersRepository } from '../../db/repositories';
import { SentimentSniperWorker } from './worker';
import { logger, setLogContext, clearLogContext } from '../../utils/logger';
import { getTokenMetadata } from '../../services/onchain/tokenMetadata';

export async function runSentimentSniperStrategy(ctx: StrategyRunContext) {
  setLogContext({ strategy: 'sentiment-sniper', clientId: ctx.clientId, runMode: ctx.runMode });
  try {
    const pool = getPool();
    await runMigrations(pool);
    const snapshotsRepo = new SentimentSnapshotsRepository(pool, ctx.clientId);
    const signalsRepo = new BotSignalsRepository(pool, ctx.clientId);
    const runsRepo = new RunsRepository(pool, ctx.clientId);
    const ordersRepo = new OrdersRepository(pool, ctx.clientId);

    const baseToken =
      (typeof ctx.config?.baseToken === 'string' && ctx.config.baseToken) ||
      process.env.SENTIMENT_BASE_TOKEN ||
      process.env.WHALE_COPY_BASE_TOKEN ||
      '0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2';
    const baseTokenMeta = await getTokenMetadata(baseToken);

    const bankrollTokens =
      Number(ctx.config?.bankroll ?? process.env.SENTIMENT_BANKROLL ?? process.env.SENTIMENT_BANKROLL_ETH ?? 2) || 2;
    const bankrollAtomic = parseUnits(bankrollTokens.toString(), baseTokenMeta.decimals);
    const baseTradePct =
      Number(ctx.config?.sizePct ?? process.env.SENTIMENT_SIZE_PCT ?? process.env.SENTIMENT_BASE_TRADE_PCT ?? 0.0015);
    const baseTradeBps = Math.max(1, Math.min(1200, Math.round(baseTradePct * 10_000)));
    const slippageBps = Math.max(
      30,
      Number(ctx.config?.slippageBps ?? process.env.SENTIMENT_SLIPPAGE_BPS ?? 250)
    );
    const normalizationScore =
      Number(ctx.config?.normalizationScore ?? process.env.SENTIMENT_NORMALIZATION_SCORE ?? 400) || 400;
    const walletPrivateKey =
      (typeof ctx.config?.walletPrivateKey === 'string' && ctx.config.walletPrivateKey.length
        ? ctx.config.walletPrivateKey
        : null) ?? process.env.WALLET_PRIVATE_KEY;

    const worker = new SentimentSniperWorker(snapshotsRepo, signalsRepo, {
      clientId: ctx.clientId,
      runMode: ctx.runMode,
      minimumMentions: Number(ctx.config?.minimumMentions ?? undefined) || undefined,
      maximumResults: Number(ctx.config?.maximumResults ?? undefined) || undefined,
      baseTokenAddress: baseTokenMeta.address,
      baseTokenDecimals: baseTokenMeta.decimals,
      baseTokenSymbol: baseTokenMeta.symbol ?? 'WETH',
      baseTradeBps,
      bankrollAtomic,
      slippageBps,
      walletPrivateKey: walletPrivateKey ?? undefined,
      runsRepo,
      ordersRepo,
      normalizationScore,
    });
    const results = await worker.runOnce();
    logger.info('sentiment_sniper_run_complete', {
      event: 'sentiment_sniper_run_complete',
      processed: results.length,
      positives: results.filter((entry) => entry.safetyPassed).length,
    });
  } finally {
    clearLogContext();
  }
}
