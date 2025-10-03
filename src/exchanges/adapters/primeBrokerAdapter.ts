import axios, { AxiosInstance } from 'axios';
import { BaseExchangeAdapter } from './baseAdapter';
import type { AdapterOrderRequest, AdapterOrderResponse, ExchangeAdapterConfig, QuoteTick } from './types';
import { logger } from '../../utils/logger';
import { logOrderRouting } from '../../telemetry/orderRoutingLogger';

export class PrimeBrokerAdapter extends BaseExchangeAdapter {
  private readonly client: AxiosInstance;
  private readonly deskId?: string;
  private readonly settlementAccount?: string;

  constructor(config: ExchangeAdapterConfig) {
    super('prime', config);
    const baseURL = (config.extra?.baseUrl as string | undefined) || process.env.PRIME_BROKER_API_URL;
    if (!baseURL) throw new Error('prime_broker_base_url_missing');
    const apiKey = config.apiKey ?? process.env.PRIME_BROKER_API_KEY;
    this.deskId = (config.extra?.deskId as string | undefined) ?? process.env.PRIME_BROKER_DESK_ID ?? undefined;
    this.settlementAccount =
      (config.extra?.settlementAccount as string | undefined) ?? process.env.PRIME_BROKER_ACCOUNT_ID ?? undefined;
    this.client = axios.create({
      baseURL,
      timeout: 10_000,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
    this.supportsSpot = true;
    this.supportsFutures = true;
    this.supportsMargin = true;
  }

  async fetchBalances(): Promise<Record<string, number>> {
    this.assertConnected();
    const res = await this.client.get('/balances');
    const result: Record<string, number> = {};
    Object.entries(res.data ?? {}).forEach(([asset, value]) => {
      const num = Number(value);
      if (!Number.isNaN(num)) result[asset] = num;
    });
    return result;
  }

  async fetchOpenOrders(symbol?: string): Promise<AdapterOrderResponse[]> {
    this.assertConnected();
    const res = await this.client.get('/orders', { params: symbol ? { symbol } : undefined });
    const orders: any[] = res.data ?? [];
    return orders.map((order) => ({
      id: order.id,
      status: order.status ?? 'accepted',
      filled: Number(order.filled ?? 0),
      remaining: Number(order.remaining ?? 0),
      avgFillPrice: order.avgFillPrice ? Number(order.avgFillPrice) : undefined,
      raw: order,
    }));
  }

  async fetchTicker(symbol: string): Promise<QuoteTick> {
    this.assertConnected();
    const res = await this.client.get('/ticker', { params: { symbol } });
    const ticker = res.data ?? {};
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
    const res = await this.client.post('/orders', {
      symbol: request.symbol,
      side: request.side,
      amount: request.amount,
      price: request.price ?? null,
      type: request.type ?? 'limit',
      leverage: request.leverage ?? null,
      clientOrderId: request.clientOrderId ?? null,
      deskId: this.deskId ?? null,
      settlementAccount: this.settlementAccount ?? null,
    });
    const order = res.data ?? {};

    logOrderRouting({
      adapterId: this.id,
      venue: 'prime',
      symbol: request.symbol,
      side: request.side,
      quantity: request.amount,
      metadata: {
        clientOrderId: order.id ?? request.clientOrderId ?? null,
        deskId: this.deskId ?? null,
        settlementAccount: this.settlementAccount ?? null,
        type: request.type ?? 'limit',
      },
    });

    return {
      id: order.id,
      status: order.status ?? 'accepted',
      filled: Number(order.filled ?? 0),
      remaining: Number(order.remaining ?? request.amount ?? 0),
      avgFillPrice: order.avgFillPrice ? Number(order.avgFillPrice) : undefined,
      raw: order,
    };
  }

  async cancelOrder(id: string): Promise<void> {
    this.assertConnected();
    await this.client.post(`/orders/${id}/cancel`);
    logger.info('prime_broker_cancel_sent', {
      event: 'prime_broker_cancel_sent',
      adapterId: this.id,
      orderId: id,
    });
  }
}
