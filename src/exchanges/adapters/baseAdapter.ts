import { ExchangeAdapter, ExchangeAdapterConfig, AdapterOrderRequest, AdapterOrderResponse, QuoteTick } from './types';

export abstract class BaseExchangeAdapter implements ExchangeAdapter {
  public readonly id: string;
  public readonly type: ExchangeAdapter['type'];
  public supportsFutures = false;
  public supportsSpot = true;
  public supportsMargin = false;
  protected config: ExchangeAdapterConfig;
  protected connected = false;

  protected constructor(type: ExchangeAdapter['type'], config: ExchangeAdapterConfig) {
    this.type = type;
    this.config = config;
    this.id = config.id;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  assertConnected() {
    if (!this.connected) {
      throw new Error(`adapter_not_connected:${this.id}`);
    }
  }

  abstract fetchBalances(): Promise<Record<string, number>>;
  abstract fetchOpenOrders(symbol?: string): Promise<AdapterOrderResponse[]>;
  abstract fetchTicker(symbol: string): Promise<QuoteTick>;
  abstract placeOrder(request: AdapterOrderRequest): Promise<AdapterOrderResponse>;
  abstract cancelOrder(id: string, symbol?: string): Promise<void>;
}
