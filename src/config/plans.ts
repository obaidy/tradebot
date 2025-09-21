export type PlanId = 'starter' | 'pro';

export interface PlanDefinition {
  id: PlanId | string;
  name: string;
  priceUsd: number;
  description: string;
  features: string[];
  limits: {
    maxSymbols: number;
    allowLiveTrading: boolean;
    maxPerTradeUsd: number;
    guard: {
      maxGlobalDrawdownUsd: number;
      maxRunLossUsd: number;
      maxApiErrorsPerMin: number;
      staleTickerMs: number;
    };
  };
}

export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    id: 'starter',
    name: 'Starter',
    priceUsd: 49,
    description: 'Single exchange, paper-first onboarding, email support.',
    features: ['Paper trading only', 'One exchange connection', 'Baseline metrics dashboard'],
    limits: {
      maxSymbols: 3,
      allowLiveTrading: false,
      maxPerTradeUsd: 200,
      guard: {
        maxGlobalDrawdownUsd: 200,
        maxRunLossUsd: 100,
        maxApiErrorsPerMin: 8,
        staleTickerMs: 180_000,
      },
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    priceUsd: 199,
    description: 'Multi-exchange, live trading allowed, advanced support.',
    features: ['Live trading unlock', 'Multiple exchange keys', 'Advanced metrics + alerts'],
    limits: {
      maxSymbols: 10,
      allowLiveTrading: true,
      maxPerTradeUsd: 2000,
      guard: {
        maxGlobalDrawdownUsd: 1000,
        maxRunLossUsd: 400,
        maxApiErrorsPerMin: 12,
        staleTickerMs: 90_000,
      },
    },
  },
];

export function getPlanById(planId: string) {
  return PLAN_DEFINITIONS.find((plan) => plan.id === planId) ?? null;
}
