import ccxt from 'ccxt';
import { BaseExchangeAdapter } from './baseAdapter';
import { ExchangeAdapterConfig, AdapterOrderRequest, AdapterOrderResponse, QuoteTick } from './types';
import { logger } from '../../utils/logger';

export class CcxtExchangeAdapter extends BaseExchangeAdapter {
  private readonly exchange: any;

  constructor(config: ExchangeAdapterConfig) {
    super('spot', config);
    const extra = (config.extra as Record<string, any> | undefined) ?? {};
    const exchangeName = extra.exchangeId || config.id;
    const ExchangeClass = (ccxt as any)[exchangeName];
    if (!ExchangeClass) {
      throw new Error(`unknown_ccxt_exchange:${exchangeName}`);
    }
    this.exchange = new ExchangeClass({
      apiKey: config.apiKey,
      secret: config.apiSecret,
      password: config.passphrase,
      enableRateLimit: true,
      ...(config.extra?.ccxtOptions ?? {}),
    });
    const has: Record<string, any> = this.exchange.has ?? {};
    this.supportsFutures = Boolean(has.futures ?? has.swap ?? false);
    this.supportsMargin = Boolean(has.margin ?? false);
  }

  override async connect(): Promise<void> {
    await super.connect();
    if (typeof this.exchange.loadMarkets === 'function') {
      await this.exchange.loadMarkets();
    }
  }

  override async disconnect(): Promise<void> {
    await super.disconnect();
    if (typeof this.exchange.close === 'function') {
      try {
        await this.exchange.close();
      } catch (err) {
        logger.warn('ccxt_adapter_close_failed', {
          event: 'ccxt_adapter_close_failed',
          exchange: this.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async fetchBalances(): Promise<Record<string, number>> {
    this.assertConnected();
    const balances = await this.exchange.fetchBalance();
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
    const orders = await this.exchange.fetchOpenOrders(symbol);
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
    const orderType = request.type ?? 'limit';
    const price = request.price ?? null;
    const response = await this.exchange.createOrder(request.symbol, orderType, request.side, request.amount, price, {
      clientOrderId: request.clientOrderId,
      timeInForce: request.timeInForce,
    });
    return {
      id: response.id,
      status: (response.status as AdapterOrderResponse['status']) ?? 'accepted',
      filled: Number(response.filled ?? 0),
      remaining: Number(response.remaining ?? 0),
      avgFillPrice: response.average ? Number(response.average) : undefined,
      raw: response,
    };
  }

  async cancelOrder(id: string, symbol?: string): Promise<void> {
    this.assertConnected();
    await this.exchange.cancelOrder(id, symbol);
  }
}
