import { createExchangeAdapter } from '../exchanges/adapterFactory';
import type { StrategyRunContext } from './types';
import { logger } from '../utils/logger';

type PerpGridConfig = {
  exchangeId?: string;
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  leverage?: number;
  orderSize?: number;
  priceOffsetPct?: number;
};

function resolveConfig(ctx: StrategyRunContext): PerpGridConfig {
  const config = ctx.config ?? {};
  return {
    exchangeId: (config.exchangeId as string) || process.env.DERIVATIVES_EXCHANGE,
    apiKey: (config.apiKey as string) || process.env.EXCHANGE_API_KEY,
    apiSecret: (config.apiSecret as string) || process.env.EXCHANGE_API_SECRET,
    passphrase: (config.passphrase as string) || process.env.EXCHANGE_API_PASSPHRASE,
    leverage: Number(config.leverage ?? process.env.DERIVATIVES_LEVERAGE ?? 3),
    orderSize: Number(config.orderSize ?? process.env.DERIVATIVES_ORDER_SIZE ?? 0.01),
    priceOffsetPct: Number(config.priceOffsetPct ?? process.env.DERIVATIVES_PRICE_OFFSET_PCT ?? 0.25),
  };
}

export async function runPerpGridStrategy(ctx: StrategyRunContext) {
  const resolved = resolveConfig(ctx);
  const exchangeId = resolved.exchangeId;
  const apiKey = resolved.apiKey;
  const apiSecret = resolved.apiSecret;
  const passphrase = resolved.passphrase;
  const leverage = resolved.leverage ?? 3;
  const orderSize = resolved.orderSize ?? 0.01;
  const priceOffsetPct = resolved.priceOffsetPct ?? 0.25;
  if (!exchangeId) {
    throw new Error('derivatives_exchange_missing');
  }

  if (ctx.runMode === 'live' && (!apiKey || !apiSecret)) {
    throw new Error('derivatives_api_credentials_missing');
  }

  const adapter = createExchangeAdapter({
    kind: 'derivatives',
    id: exchangeId,
    apiKey: apiKey ?? undefined,
    apiSecret: apiSecret ?? undefined,
    passphrase: passphrase ?? undefined,
    extra: { exchangeId },
  });

  await adapter.connect();
  try {
    const ticker = await adapter.fetchTicker(ctx.pair);
    if (!ticker.last) {
      throw new Error(`ticker_unavailable:${ctx.pair}`);
    }

    const basePrice = ticker.last;
    const buyPrice = basePrice * (1 - priceOffsetPct / 100);
    const sellPrice = basePrice * (1 + priceOffsetPct / 100);

    logger.info('perp_grid_ticker', {
      event: 'perp_grid_ticker',
      clientId: ctx.clientId,
      pair: ctx.pair,
      basePrice,
      buyPrice,
      sellPrice,
      leverage,
    });

    if (ctx.runMode !== 'live') {
      logger.info('perp_grid_simulation', {
        event: 'perp_grid_simulation',
        clientId: ctx.clientId,
        pair: ctx.pair,
        runMode: ctx.runMode,
      });
      return;
    }

    if (typeof adapter.changeLeverage === 'function') {
      await adapter.changeLeverage(ctx.pair, leverage);
    }

    const buyOrder = await adapter.placeOrder({
      symbol: ctx.pair,
      side: 'buy',
      amount: orderSize,
      price: buyPrice,
      type: 'limit',
      leverage,
    });

    const sellOrder = await adapter.placeOrder({
      symbol: ctx.pair,
      side: 'sell',
      amount: orderSize,
      price: sellPrice,
      type: 'limit',
      leverage,
    });

    logger.info('perp_grid_orders_submitted', {
      event: 'perp_grid_orders_submitted',
      clientId: ctx.clientId,
      pair: ctx.pair,
      buyOrder,
      sellOrder,
    });
  } finally {
    await adapter.disconnect();
  }
}
