import { describe, expect, it } from 'vitest';
import type { ClientConfig } from '../src/services/clientConfig';
import { buildPortfolioExecutionPlan } from '../src/services/portfolio/portfolioManager';

function createClientConfig(overrides?: Partial<ClientConfig>): ClientConfig {
  return {
    client: {
      id: 'client-a',
      name: 'Client A',
      owner: 'owner',
      plan: 'starter',
      status: 'active',
      contactInfo: null,
      limits: null,
      isPaused: false,
      killRequested: false,
      billingStatus: 'active',
      trialEndsAt: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      billingAutoPaused: false,
      createdAt: new Date(),
    },
    risk: {
      bankrollUsd: 10000,
      maxPerTradePct: 0.02,
      dailyLossStopPct: 0.05,
    },
    exchange: {
      id: 'binance',
      apiKey: 'key',
      apiSecret: 'secret',
      passphrase: null,
      row: {
        clientId: 'client-a',
        exchangeName: 'binance',
        apiKeyEnc: '',
        apiSecretEnc: '',
        passphraseEnc: null,
        createdAt: new Date(),
      },
    },
    limits: {},
    guard: {},
    operations: {
      allowLiveTrading: true,
      maxPerTradeUsd: 100,
      allowedSymbols: null,
      allowedExchanges: null,
      maxSymbols: undefined,
      maxExposureUsd: undefined,
      paperOnly: false,
      maxDailyVolumeUsd: undefined,
    },
    portfolio: {
      allocations: [
        {
          strategyId: 'grid',
          weightPct: 60,
          enabled: true,
        },
        {
          strategyId: 'mev',
          weightPct: 40,
          enabled: true,
        },
      ],
      totalWeightPct: 100,
    },
    ...overrides,
  } as ClientConfig;
}

describe('buildPortfolioExecutionPlan', () => {
  it('normalizes allocations and computes USD exposure', () => {
    const plan = buildPortfolioExecutionPlan(createClientConfig());
    expect(plan.totalRequestedWeightPct).toBe(100);
    expect(plan.entries).toHaveLength(2);

    const gridEntry = plan.entries.find((entry) => entry.strategyId === 'grid');
    const mevEntry = plan.entries.find((entry) => entry.strategyId === 'mev');

    expect(gridEntry?.allocationUsd).toBeCloseTo(6000, 2);
    expect(mevEntry?.allocationUsd).toBeCloseTo(4000, 2);
    expect(gridEntry?.finalRunMode).toBe('live');
  });

  it('falls back to paper mode when live trading is not allowed', () => {
    const config = createClientConfig({
      operations: {
        allowLiveTrading: false,
        paperOnly: true,
        maxPerTradeUsd: 100,
        allowedSymbols: null,
        allowedExchanges: null,
        maxSymbols: undefined,
        maxExposureUsd: undefined,
        maxDailyVolumeUsd: undefined,
      },
    });

    const plan = buildPortfolioExecutionPlan(config);
    expect(plan.entries.every((entry) => entry.finalRunMode === 'paper')).toBe(true);
  });

  it('disables unknown strategies gracefully', () => {
    const config = createClientConfig({
      portfolio: {
        allocations: [
          { strategyId: 'grid', weightPct: 50, enabled: true },
          { strategyId: 'unknown' as any, weightPct: 50, enabled: true },
        ],
        totalWeightPct: 100,
      },
    });

    const plan = buildPortfolioExecutionPlan(config);
    const unknownEntry = plan.entries.find((entry) => entry.strategyId === 'unknown');
    expect(unknownEntry?.enabled).toBe(false);
    expect(unknownEntry?.reason).toBe('unknown_strategy');
  });
});
