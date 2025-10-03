import ccxt from 'ccxt';
import { BaseExchangeAdapter } from './baseAdapter';
import { AdapterOrderRequest, AdapterOrderResponse, ExchangeAdapterConfig, QuoteTick } from './types';
import { logger } from '../../utils/logger';

export class DerivativesExchangeAdapter extends BaseExchangeAdapter {
  private readonly exchange: any;

  constructor(config: ExchangeAdapterConfig) {
    super('derivatives', config);
    const extra = (config.extra as Record<string, any> | undefined) ?? {};
    const exchangeName = extra.exchangeId || config.id || process.env.DERIVATIVES_EXCHANGE || 'binanceusdm';
    const ExchangeClass = (ccxt as any)[exchangeName];
    if (!ExchangeClass) {
      throw new Error(`unknown_derivatives_exchange:${exchangeName}`);
    }
    const ccxtOptions = {
      defaultType: 'future',
      adjustForTimeDifference: true,
      ...(extra.ccxtOptions && typeof extra.ccxtOptions === 'object' ? extra.ccxtOptions : {}),
    };

    this.exchange = new ExchangeClass({
      apiKey: config.apiKey,
      secret: config.apiSecret,
      password: config.passphrase,
      enableRateLimit: true,
      options: ccxtOptions,
    });
    const has: Record<string, any> = this.exchange.has ?? {};
    this.supportsSpot = Boolean(has.spot ?? false);
    this.supportsFutures = true;
    this.supportsMargin = Boolean(has.margin ?? false);
  }

  override async connect(): Promise<void> {
    await super.connect();
    if (typeof this.exchange.loadMarkets === 'function') {
      await this.exchange.loadMarkets();
    }
  }

  async fetchBalances(): Promise<Record<string, number>> {
    this.assertConnected();
    const balances = await this.exchange.fetchBalance({ type: 'future' });
    const result: Record<string, number> = {};
    Object.entries(balances.total ?? {}).forEach(([asset, amount]) => {
      if (typeof amount === 'number') {
        result[asset] = amount;
      }
    });
    return result;
  }

  async fetchOpenOrders(symbol?: string): Promise<AdapterOrderResponse[]> {
    this.assertConnected();
    const orders = await this.exchange.fetchOpenOrders(symbol, undefined, undefined, { type: 'future' });
    return orders.map((order: any) => ({
      id: order.id,
      status: (order.status as AdapterOrderResponse['status']) ?? 'accepted',
      filled: Number(order.filled ?? 0),
      remaining: Number(order.remaining ?? 0),
      avgFillPrice: order.average ? Number(order.average) : undefined,
      raw: order,
    }));
  }

  async fetchTicker(symbol: string): Promise<QuoteTick> {
    this.assertConnected();
    const ticker = await this.exchange.fetchTicker(symbol);
    return {
      symbol,
      bid: ticker.bid ?? null,
      ask: ticker.ask ?? null,
      last: ticker.last ?? null,
      timestamp: ticker.timestamp ?? Date.now(),
    };
  }

  async placeOrder(request: AdapterOrderRequest): Promise<AdapterOrderResponse> {
    this.assertConnected();
    const params: Record<string, unknown> = { type: 'future' };
    if (request.leverage) {
      params.leverage = request.leverage;
    }
    const order = await this.exchange.createOrder(request.symbol, request.type ?? 'limit', request.side, request.amount, request.price ?? null, params);
    return {
      id: order.id,
      status: (order.status as AdapterOrderResponse['status']) ?? 'accepted',
      filled: Number(order.filled ?? 0),
      remaining: Number(order.remaining ?? 0),
      avgFillPrice: order.average ? Number(order.average) : undefined,
      raw: order,
    };
  }

  async cancelOrder(id: string, symbol?: string): Promise<void> {
    this.assertConnected();
    await this.exchange.cancelOrder(id, symbol, { type: 'future' });
  }

  async changeLeverage(symbol: string, leverage: number): Promise<void> {
    this.assertConnected();
    if (typeof (this.exchange as any).setLeverage !== 'function') {
      throw new Error('leverage_not_supported');
    }
    await (this.exchange as any).setLeverage(leverage, symbol, { type: 'future' });
  }

  async setHedgeMode(enabled: boolean): Promise<void> {
    this.assertConnected();
    if (typeof (this.exchange as any).setMarginMode !== 'function') {
      logger.warn('derivatives_margin_mode_unsupported', {
        event: 'derivatives_margin_mode_unsupported',
        exchange: this.exchange.id,
      });
      return;
    }
    const mode = enabled ? 'hedge' : 'cross';
    await (this.exchange as any).setMarginMode(mode, undefined, { type: 'future' });
  }
}
