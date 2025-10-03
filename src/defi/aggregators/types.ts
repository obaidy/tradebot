export interface DexRouteLeg {
  protocol: string;
  tokenIn: string;
  tokenOut: string;
  portionPct: number;
}

export interface DexQuoteRequest {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps?: number;
  userAddress?: string;
}

export interface DexQuoteResponse {
  aggregator: string;
  amountIn: string;
  amountOut: string;
  estimatedGasUsd?: number;
  route: DexRouteLeg[];
  rawQuote: Record<string, unknown>;
}

export interface DexSwapRequest extends DexQuoteRequest {
  aggregator?: string;
  minAmountOut: string;
  recipient: string;
}

export interface DexSwapResponse {
  aggregator: string;
  txHash: string;
  amountIn: string;
  amountOut: string;
  route: DexRouteLeg[];
  rawTx: Record<string, unknown>;
}

export interface DexAggregatorClient {
  readonly id: string;
  isEnabled(): boolean;
  quote(params: DexQuoteRequest): Promise<DexQuoteResponse>;
  executeSwap(params: DexSwapRequest): Promise<DexSwapResponse>;
}
