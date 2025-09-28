import type { PlanId } from './planTypes';

import type { StrategyId } from '../strategies/types';
export { PlanId } from './planTypes';

export interface PlanDefinition {
  id: PlanId | string;
  name: string;
  priceUsd: number;
  description: string;
  features: string[];
  strategies: StrategyId[];
  stripePriceId?: string;
  limits: {
    maxSymbols: number;
    allowLiveTrading: boolean;
    paperOnly: boolean;
    allowedExchanges: string[];
    maxPerTradeUsd: number;
    maxExposureUsd: number;
    maxDailyVolumeUsd: number;
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
    strategies: ['grid'],
    stripePriceId: process.env.STRIPE_STARTER_PRICE_ID || 'price_starter_test',
    limits: {
      maxSymbols: 3,
      allowLiveTrading: false,
      paperOnly: true,
      allowedExchanges: ['binance'],
      maxPerTradeUsd: 200,
      maxExposureUsd: 1500,
      maxDailyVolumeUsd: 5000,
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
    strategies: ['grid', 'mev'],
    stripePriceId: process.env.STRIPE_PRO_PRICE_ID || 'price_pro_test',
    limits: {
      maxSymbols: 10,
      allowLiveTrading: true,
      paperOnly: false,
      allowedExchanges: ['binance', 'kraken', 'coinbasepro'],
      maxPerTradeUsd: 2000,
      maxExposureUsd: 15000,
      maxDailyVolumeUsd: 50000,
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

export function getPlanByPriceId(priceId: string | null | undefined) {
  if (!priceId) return null;
  return PLAN_DEFINITIONS.find((plan) => plan.stripePriceId === priceId) ?? null;
}

export function buildPlanLimits(plan: PlanDefinition) {
  return {
    guard: plan.limits.guard,
    risk: {
      maxPerTradeUsd: plan.limits.maxPerTradeUsd,
      maxExposureUsd: plan.limits.maxExposureUsd,
    },
    maxSymbols: plan.limits.maxSymbols,
    allowLiveTrading: plan.limits.allowLiveTrading,
    paperOnly: plan.limits.paperOnly,
    allowedExchanges: plan.limits.allowedExchanges,
    maxPerTradeUsd: plan.limits.maxPerTradeUsd,
    maxExposureUsd: plan.limits.maxExposureUsd,
    maxDailyVolumeUsd: plan.limits.maxDailyVolumeUsd,
  };
}
