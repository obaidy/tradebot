export type StrategyId = 'grid' | 'mev';

export type StrategyRunMode = 'summary' | 'paper' | 'live';

import type { PlanId } from '../config/planTypes';

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
