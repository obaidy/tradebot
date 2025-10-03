import axios from 'axios';
import { logger } from '../../utils/logger';
import type { DexAggregatorClient, DexQuoteRequest, DexQuoteResponse, DexSwapRequest, DexSwapResponse } from './types';

const DEFAULT_BASE_URL = 'https://apiv5.paraswap.io';

export class ParaSwapAggregator implements DexAggregatorClient {
  readonly id = 'paraswap';
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor() {
    this.baseUrl = process.env.PARASWAP_API_URL || DEFAULT_BASE_URL;
    this.apiKey = process.env.PARASWAP_API_KEY;
  }

  isEnabled(): boolean {
    return Boolean(this.apiKey);
  }

  async quote(params: DexQuoteRequest): Promise<DexQuoteResponse> {
    if (!this.isEnabled()) {
      throw new Error('paraswap_disabled');
    }
    const url = `${this.baseUrl}/prices`; // price discovery endpoint
    try {
      const response = await axios.get(url, {
        params: {
          network: params.chainId,
          srcToken: params.tokenIn,
          destToken: params.tokenOut,
          amount: params.amountIn,
          side: 'SELL',
          includeDEXS: 'true',
        },
        headers: this.buildHeaders(),
      });
      const data = response.data ?? {};
      const bestRoute = Array.isArray(data.route) ? data.route : [];
      return {
        aggregator: this.id,
        amountIn: params.amountIn,
        amountOut: data.priceRoute?.destAmount ?? '0',
        estimatedGasUsd: data.priceRoute?.gasCostUSD ? Number(data.priceRoute.gasCostUSD) : undefined,
        route: bestRoute.map((leg: any) => ({
          protocol: String(leg.exchange ?? 'unknown'),
          tokenIn: String(leg.srcToken ?? params.tokenIn),
          tokenOut: String(leg.destToken ?? params.tokenOut),
          portionPct: Number(leg.percent ?? 100),
        })),
        rawQuote: data,
      };
    } catch (error) {
      logger.warn('paraswap_quote_failed', {
        event: 'paraswap_quote_failed',
        chainId: params.chainId,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async executeSwap(params: DexSwapRequest): Promise<DexSwapResponse> {
    if (!this.isEnabled()) {
      throw new Error('paraswap_disabled');
    }
    const url = `${this.baseUrl}/transactions/${params.chainId}`;
    try {
      const response = await axios.post(
        url,
        {
          srcToken: params.tokenIn,
          destToken: params.tokenOut,
          srcAmount: params.amountIn,
          destAmount: params.minAmountOut,
          userAddress: params.recipient,
          slippage: params.slippageBps ? params.slippageBps / 100 : undefined,
        },
        {
          headers: this.buildHeaders(),
        }
      );
      const data = response.data ?? {};
      return {
        aggregator: this.id,
        txHash: data.hash ?? `stub-${Date.now()}`,
        amountIn: params.amountIn,
        amountOut: data.destAmount ?? params.minAmountOut,
        route: [
          {
            protocol: 'paraswap',
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            portionPct: 100,
          },
        ],
        rawTx: data,
      };
    } catch (error) {
      logger.warn('paraswap_swap_failed', {
        event: 'paraswap_swap_failed',
        chainId: params.chainId,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private buildHeaders() {
    return this.apiKey
      ? {
          'x-apikey': this.apiKey,
        }
      : undefined;
  }
}
