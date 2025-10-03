import axios from 'axios';
import { logger } from '../../utils/logger';
import type { DexAggregatorClient, DexQuoteRequest, DexQuoteResponse, DexSwapRequest, DexSwapResponse } from './types';

const DEFAULT_BASE_URL = 'https://api.1inch.dev/swap/v6.0';

export class OneInchAggregator implements DexAggregatorClient {
  readonly id = '1inch';
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor() {
    this.baseUrl = process.env.ONEINCH_API_URL || DEFAULT_BASE_URL;
    this.apiKey = process.env.ONEINCH_API_KEY;
  }

  isEnabled(): boolean {
    return Boolean(this.apiKey);
  }

  async quote(params: DexQuoteRequest): Promise<DexQuoteResponse> {
    if (!this.isEnabled()) {
      throw new Error('oneinch_disabled');
    }
    const url = `${this.baseUrl}/${params.chainId}/quote`;
    try {
      const response = await axios.get(url, {
        params: {
          fromTokenAddress: params.tokenIn,
          toTokenAddress: params.tokenOut,
          amount: params.amountIn,
          slippage: params.slippageBps ? params.slippageBps / 100 : undefined,
        },
        headers: this.buildHeaders(),
      });
      const data = response.data ?? {};
      return {
        aggregator: this.id,
        amountIn: params.amountIn,
        amountOut: data.toTokenAmount ?? '0',
        estimatedGasUsd: data.estimatedGasCost?.usd,
        route: Array.isArray(data.protocols)
          ? data.protocols.flat().map((leg: any) => ({
              protocol: String(leg.name ?? 'unknown'),
              tokenIn: String(leg.fromTokenAddress ?? params.tokenIn),
              tokenOut: String(leg.toTokenAddress ?? params.tokenOut),
              portionPct: Number(leg.part ?? 100),
            }))
          : [
              {
                protocol: 'unknown',
                tokenIn: params.tokenIn,
                tokenOut: params.tokenOut,
                portionPct: 100,
              },
            ],
        rawQuote: data,
      };
    } catch (error) {
      logger.warn('oneinch_quote_failed', {
        event: 'oneinch_quote_failed',
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
      throw new Error('oneinch_disabled');
    }
    const url = `${this.baseUrl}/${params.chainId}/swap`;
    try {
      const response = await axios.get(url, {
        params: {
          fromTokenAddress: params.tokenIn,
          toTokenAddress: params.tokenOut,
          amount: params.amountIn,
          fromAddress: params.recipient,
          slippage: params.slippageBps ? params.slippageBps / 100 : undefined,
          destReceiver: params.recipient,
        },
        headers: this.buildHeaders(),
      });
      const data = response.data ?? {};
      return {
        aggregator: this.id,
        txHash: data.tx?.hash ?? `stub-${Date.now()}`,
        amountIn: params.amountIn,
        amountOut: data.toTokenAmount ?? params.minAmountOut,
        route: [
          {
            protocol: '1inch',
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            portionPct: 100,
          },
        ],
        rawTx: data,
      };
    } catch (error) {
      logger.warn('oneinch_swap_failed', {
        event: 'oneinch_swap_failed',
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
          Authorization: `Bearer ${this.apiKey}`,
        }
      : undefined;
  }
}
