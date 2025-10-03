export type StrategyId =
  | 'grid'
  | 'mev'
  | 'dex-swap'
  | 'perp-grid'
  | 'dex-aggregation'
  | 'yield-farming'
  | 'flash-loan-arb'
  | 'cross-chain-arb'
  | 'nft-market-maker';

export type StrategyRunMode = 'summary' | 'paper' | 'live';

import type { PlanId } from '../config/planTypes';

export type OrderSide = 'buy' | 'sell';

export interface StrategyRunServices {
  updateStrategySecretMetadata?: (patch: Record<string, unknown>) => Promise<void>;
}

export interface StrategyRunContext {
  clientId: string;
  planId: PlanId;
  pair: string;
  runMode: StrategyRunMode;
  actor?: string;
  config?: Record<string, unknown>;
  services?: StrategyRunServices;
}
