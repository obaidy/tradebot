import type { BigNumberish, Provider } from 'ethers';
import type { OrderSide } from '../../strategies/types';

export type ExchangeAdapterType = 'spot' | 'dex' | 'derivatives' | 'fix' | 'prime';

export interface AdapterOrderRequest {
  symbol: string;
  side: OrderSide;
  amount: number;
  price?: number;
  type?: 'market' | 'limit' | 'post_only';
  leverage?: number;
  clientOrderId?: string;
  timeInForce?: string;
}

export interface AdapterOrderResponse {
  id: string;
  status: 'accepted' | 'filled' | 'partially_filled' | 'rejected' | 'cancelled';
  filled: number;
  remaining: number;
  avgFillPrice?: number;
  raw?: Record<string, unknown>;
}

export interface QuoteTick {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  timestamp: number;
}

export interface ExchangeAdapterConfig {
  id: string;
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  rpcUrl?: string;
  privateKey?: string;
  walletProvider?: Provider;
  sandbox?: boolean;
  extra?: Record<string, unknown>;
}

export interface ExchangeAdapter {
  readonly id: string;
  readonly type: ExchangeAdapterType;
  readonly supportsFutures: boolean;
  readonly supportsSpot: boolean;
  readonly supportsMargin: boolean;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  fetchBalances(): Promise<Record<string, number>>;
  fetchOpenOrders(symbol?: string): Promise<AdapterOrderResponse[]>;
  fetchTicker(symbol: string): Promise<QuoteTick>;
  placeOrder(request: AdapterOrderRequest): Promise<AdapterOrderResponse>;
  cancelOrder(id: string, symbol?: string): Promise<void>;

  // Optional derivatives API
  changeLeverage?(symbol: string, leverage: number): Promise<void>;
  setHedgeMode?(enabled: boolean): Promise<void>;

  // Optional DEX methods
  estimateSwap?(params: { tokenIn: string; tokenOut: string; amountIn: BigNumberish }): Promise<number>;
  executeSwap?(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: BigNumberish;
    minAmountOut: BigNumberish;
    recipient: string;
  }): Promise<string>;
}

export interface ArbitrageOpportunity {
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  volumeUsd: number;
}
