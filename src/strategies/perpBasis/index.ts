import { StrategyRunContext } from '../types';
import { getPool } from '../../db/pool';
import { runMigrations } from '../../db/migrations';
import { BotSignalsRepository } from '../../db/botSignalsRepo';
import { BotPositionsRepository } from '../../db/botPositionsRepo';
import { RunsRepository, OrdersRepository } from '../../db/repositories';
import { PerpBasisWorker } from './worker';
import { logger, setLogContext, clearLogContext } from '../../utils/logger';

export async function runPerpBasisStrategy(ctx: StrategyRunContext) {
  setLogContext({ strategy: 'perp-basis', clientId: ctx.clientId, runMode: ctx.runMode });
  try {
    const pool = getPool();
    await runMigrations(pool);
    const signalsRepo = new BotSignalsRepository(pool, ctx.clientId);
    const positionsRepo = new BotPositionsRepository(pool, ctx.clientId);
    const runsRepo = new RunsRepository(pool, ctx.clientId);
    const ordersRepo = new OrdersRepository(pool, ctx.clientId);

    const bankrollUsd =
      Number(
        ctx.config?.bankrollUsd ??
          process.env.PERP_BASIS_BANKROLL_USD ??
          process.env.BANKROLL_USD ??
          process.env.PERP_BANKROLL_USD ??
          75_000
      ) || 75_000;
    const sizePct =
      Number(ctx.config?.sizePct ?? process.env.PERP_BASIS_SIZE_PCT ?? process.env.PERP_SIZE_PCT ?? 0.05) || 0.05;
    const minAbsFundingRate =
      Number(ctx.config?.minAbsFundingRate ?? process.env.PERP_BASIS_MIN_ABS_FUNDING ?? 0.0002) || 0.0002;
    const maxResults =
      Number(ctx.config?.maxResults ?? process.env.PERP_BASIS_MAX_RESULTS ?? process.env.PERP_MAX_RESULTS ?? 10) || 10;

    const configuredSpotExchange =
      (typeof ctx.config?.spotExchangeId === 'string' && ctx.config.spotExchangeId) ||
      process.env.PERP_BASIS_SPOT_EXCHANGE ||
      process.env.PERP_BASIS_EXCHANGE ||
      'binance';
    const configuredPerpExchange =
      (typeof ctx.config?.perpExchangeId === 'string' && ctx.config.perpExchangeId) ||
      process.env.PERP_BASIS_PERP_EXCHANGE ||
      (configuredSpotExchange === 'binance'
        ? 'binanceusdm'
        : configuredSpotExchange === 'kucoin'
          ? 'kucoinfutures'
          : configuredSpotExchange);

    const apiKey =
      (typeof ctx.config?.apiKey === 'string' && ctx.config.apiKey) ||
      process.env.PERP_BASIS_API_KEY ||
      process.env.BINANCE_API_KEY ||
      process.env.KUCOIN_API_KEY ||
      undefined;
    const apiSecret =
      (typeof ctx.config?.apiSecret === 'string' && ctx.config.apiSecret) ||
      process.env.PERP_BASIS_API_SECRET ||
      process.env.BINANCE_API_SECRET ||
      process.env.KUCOIN_API_SECRET ||
      undefined;
    const passphrase =
      (typeof ctx.config?.passphrase === 'string' && ctx.config.passphrase) ||
      process.env.PERP_BASIS_API_PASSPHRASE ||
      process.env.BINANCE_API_PASSPHRASE ||
      process.env.KUCOIN_API_PASSPHRASE ||
      undefined;
    const leverage =
      Number(ctx.config?.leverage ?? process.env.PERP_BASIS_LEVERAGE ?? process.env.PERP_LEVERAGE ?? 2) || 2;
    const enableNegativeFunding =
      typeof ctx.config?.enableNegativeFunding === 'boolean'
        ? ctx.config.enableNegativeFunding
        : (process.env.PERP_BASIS_ENABLE_NEGATIVE ?? 'false').toLowerCase() === 'true';

    const worker = new PerpBasisWorker(signalsRepo, positionsRepo, {
      clientId: ctx.clientId,
      runMode: ctx.runMode,
      bankrollUsd,
      sizePct,
      minAbsFundingRate,
      maxResults,
      spotExchangeId: configuredSpotExchange,
      perpExchangeId: configuredPerpExchange,
      apiKey,
      apiSecret,
      passphrase,
      leverage,
      enableNegativeFunding,
      runsRepo,
      ordersRepo,
    });
    const processed = await worker.runOnce();
    logger.info('perp_basis_run_complete', {
      event: 'perp_basis_run_complete',
      processed,
      clientId: ctx.clientId,
    });
  } finally {
    clearLogContext();
  }
}
