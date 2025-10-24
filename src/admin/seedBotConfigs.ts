import { getPool, closePool } from '../db/pool';
import { runMigrations } from '../db/migrations';
import { WhaleWatchlistRepository } from '../db/whaleWatchlistRepo';
import { ClientStrategyAllocationsRepository } from '../db/clientStrategyAllocationsRepo';
import { logger } from '../utils/logger';

const DEFAULT_CLIENT_ID = process.env.SEED_CLIENT_ID || process.env.CLIENT_ID || 'default';

async function seedWhaleWatchlist(repo: WhaleWatchlistRepository) {
  const wallets = [
    {
      chain: 'eth',
      wallet: '0x5A52E96BAcdaBb82fd05763E25335261B270Efcb', // Wintermute Multisig
      minLiquidityUsd: 50_000,
      maxMcapUsd: 12_000_000,
      notes: 'Wintermute curated wallet',
    },
    {
      chain: 'eth',
      wallet: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', // Bitfinex cold wallet (monitored for whale exits)
      minLiquidityUsd: 40_000,
      maxMcapUsd: 9_000_000,
      notes: 'Bitfinex liquidity whale',
    },
    {
      chain: 'eth',
      wallet: '0x000000000000000000000000000000000000dead',
      minLiquidityUsd: 30_000,
      maxMcapUsd: 5_000_000,
      notes: 'Burn-monitor placeholder for rug detection',
    },
  ];
  for (const entry of wallets) {
    await repo.upsert({
      chain: entry.chain,
      wallet: entry.wallet,
      minLiquidityUsd: entry.minLiquidityUsd,
      maxMcapUsd: entry.maxMcapUsd,
      blockedTokens: [],
      notes: entry.notes,
    });
  }
}

async function seedStrategyConfigs(repo: ClientStrategyAllocationsRepository, clientId: string) {
  await repo.upsert({
    clientId,
    strategyId: 'whale-copy',
    weightPct: 0.35,
    maxRiskPct: 0.15,
    runMode: 'paper',
    config: {
      sizePct: 0.003,
      blockLookback: 50,
      baseToken: process.env.WHALE_COPY_BASE_TOKEN ?? '0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2',
      bankroll: Number(process.env.WHALE_COPY_BANKROLL ?? process.env.WHALE_COPY_BANKROLL_ETH ?? 3),
      slippageBps: Number(process.env.WHALE_COPY_SLIPPAGE_BPS ?? 200),
    },
  });

  await repo.upsert({
    clientId,
    strategyId: 'sentiment-sniper',
    weightPct: 0.25,
    maxRiskPct: 0.12,
    runMode: 'paper',
    config: {
      minimumMentions: Number(process.env.SENTIMENT_MIN_MENTIONS ?? 18),
      maximumResults: Number(process.env.SENTIMENT_MAX_RESULTS ?? 20),
      sizePct: Number(process.env.SENTIMENT_SIZE_PCT ?? 0.0015),
      normalizationScore: Number(process.env.SENTIMENT_NORMALIZATION_SCORE ?? 400),
      slippageBps: Number(process.env.SENTIMENT_SLIPPAGE_BPS ?? 250),
    },
  });

  await repo.upsert({
    clientId,
    strategyId: 'perp-basis',
    weightPct: 0.4,
    maxRiskPct: 0.2,
    runMode: 'paper',
    config: {
      bankrollUsd: Number(process.env.PERP_BASIS_BANKROLL_USD ?? 75_000),
      sizePct: Number(process.env.PERP_BASIS_SIZE_PCT ?? 0.05),
      minAbsFundingRate: Number(process.env.PERP_BASIS_MIN_ABS_FUNDING ?? 0.0002),
      maxResults: Number(process.env.PERP_BASIS_MAX_RESULTS ?? 8),
      leverage: Number(process.env.PERP_BASIS_LEVERAGE ?? 2),
      spotExchangeId: process.env.PERP_BASIS_SPOT_EXCHANGE ?? 'binance',
      perpExchangeId: process.env.PERP_BASIS_PERP_EXCHANGE ?? 'binanceusdm',
    },
  });
}

async function seed() {
  const clientId = DEFAULT_CLIENT_ID;
  const pool = getPool();
  await runMigrations(pool);
  const whaleRepo = new WhaleWatchlistRepository(pool, clientId);
  const allocationsRepo = new ClientStrategyAllocationsRepository(pool);

  await seedWhaleWatchlist(whaleRepo);
  await seedStrategyConfigs(allocationsRepo, clientId);

  logger.info('bot_seed_complete', {
    event: 'bot_seed_complete',
    clientId,
  });
}

if (require.main === module) {
  seed()
    .then(async () => {
      // eslint-disable-next-line no-console
      console.log('[seedBotConfigs] Seeded whale watchlist and strategy configs.');
      await closePool();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('[seedBotConfigs] failed', error);
      await closePool();
      process.exit(1);
    });
}
