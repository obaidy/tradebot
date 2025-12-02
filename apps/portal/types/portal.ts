export type StrategyRequirement = {
  type: 'env';
  keys: string[];
  message?: string;
  mode?: 'all' | 'any';
};

export type StrategySummary = {
  id: string;
  name: string;
  description: string;
  allowedPlans: string[];
  defaultPair: string;
  supportsPaper: boolean;
  supportsLive: boolean;
  supportsSummary: boolean;
  status: 'active' | 'beta' | 'coming_soon';
  ctaLabel?: string;
  ctaDescription?: string;
  requirements?: StrategyRequirement[];
  recommendedPairs?: string[];
  riskLevel?: 'low' | 'medium' | 'high';
};

export type Plan = {
  id: string;
  name: string;
  description: string;
  priceUsd: number;
  features: string[];
  strategies: string[];
  limits: {
    maxSymbols: number;
    allowLiveTrading: boolean;
    paperOnly: boolean;
    allowedExchanges: string[];
    maxPerTradeUsd: number;
    maxExposureUsd: number;
    maxDailyVolumeUsd: number;
  };
};

export type PortfolioAllocation = {
  strategyId: string;
  weightPct: number;
  maxRiskPct?: number | null;
  runMode?: string | null;
  enabled: boolean;
  config?: Record<string, any> | null;
  updatedAt?: string | null;
};

export type PortfolioPlanEntry = {
  strategyId: string;
  requestedRunMode: string;
  finalRunMode: string;
  weightPct: number;
  normalizedWeightPct: number;
  bankrollUsd: number;
  allocationUsd: number;
  maxRiskUsd?: number | null;
  enabled: boolean;
  reason?: string | null;
};

export type PortfolioPlan = {
  entries?: PortfolioPlanEntry[];
  totalRequestedWeightPct?: number;
  normalized?: boolean;
} | null;

export type ClientSnapshot = {
  client: {
    id: string;
    plan: string;
    billingStatus: string;
    trialEndsAt: string | null;
    billingAutoPaused?: boolean;
    isPaused?: boolean;
    killRequested?: boolean;
    limits?: Record<string, any> | null;
  };
  credentials: Array<{
    exchangeName: string;
    createdAt: string;
    hasPassphrase: boolean;
  }>;
};

export type PortalBootstrap = {
  plans: Plan[];
  strategies: StrategySummary[];
  snapshot: ClientSnapshot | null;
  portfolio: { allocations?: PortfolioAllocation[]; plan?: PortfolioPlan | null } | null;
  history: {
    runs?: Array<{
      runId: string;
      status: string;
      startedAt: string | null;
      runMode: string;
      estNetProfit: number | null;
      strategyId?: string | null;
    }>;
    guard?: any;
    inventory?: any[];
  } | null;
  metrics: {
    pnl?: { global?: number; run?: number; history?: number[] };
  } | null;
  needsOnboarding: boolean;
  hasActiveBots: boolean;
};

