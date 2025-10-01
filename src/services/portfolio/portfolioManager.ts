import { getStrategyDefinition } from '../../strategies/registry';
import type { StrategyId, StrategyRunMode } from '../../strategies/types';
import type { ClientConfig, StrategyAllocationConfig, StrategyPortfolioConfig } from '../clientConfig';

export interface PortfolioPlanEntry {
  strategyId: StrategyId;
  requestedRunMode: StrategyRunMode;
  finalRunMode: StrategyRunMode;
  weightPct: number;
  normalizedWeightPct: number;
  bankrollUsd: number;
  allocationUsd: number;
  maxRiskUsd?: number | null;
  enabled: boolean;
  reason?: string;
}

export interface PortfolioExecutionPlan {
  entries: PortfolioPlanEntry[];
  totalRequestedWeightPct: number;
  normalized: boolean;
}

interface ComputeOptions {
  defaultRunMode?: StrategyRunMode;
}

export function buildPortfolioExecutionPlan(
  clientConfig: ClientConfig,
  options: ComputeOptions = {}
): PortfolioExecutionPlan {
  const portfolio: StrategyPortfolioConfig = clientConfig.portfolio ?? { allocations: [], totalWeightPct: 0 };
  const allocations = portfolio.allocations ?? [];
  if (!allocations.length) {
    return {
      entries: [],
      totalRequestedWeightPct: 0,
      normalized: false,
    };
  }

  const enabledAllocations = allocations.filter((allocation) => allocation.enabled !== false && allocation.weightPct > 0);
  const totalRequestedWeightPct = enabledAllocations.reduce((sum, allocation) => sum + allocation.weightPct, 0);
  const normalized = totalRequestedWeightPct > 0 ? totalRequestedWeightPct !== 100 : false;
  const defaultModeFromOptions = options.defaultRunMode ?? inferDefaultMode(clientConfig);
  const totalBankroll = clientConfig.risk.bankrollUsd;
  const entries: PortfolioPlanEntry[] = allocations.map((allocation) => {
    const strategyDef = getStrategyDefinition(allocation.strategyId);
    if (!strategyDef) {
      return makeDisabledEntry(allocation, defaultModeFromOptions, totalBankroll, 'unknown_strategy');
    }

    if (!allocation.enabled) {
      return makeDisabledEntry(allocation, defaultModeFromOptions, totalBankroll, 'allocation_disabled');
    }

    const weightPct = allocation.weightPct > 0 ? allocation.weightPct : 0;
    const weightFraction = computeWeightFraction(weightPct, totalRequestedWeightPct, enabledAllocations.length);
    const normalizedWeight = weightFraction * 100;

    const requestedMode = allocation.runMode ?? defaultModeFromOptions;
    const finalMode = resolveRunMode(
      strategyDef.supportsPaper,
      strategyDef.supportsLive,
      requestedMode,
      clientConfig.operations.paperOnly
    );
    if (!finalMode) {
      return makeDisabledEntry(allocation, requestedMode, totalBankroll, 'run_mode_not_supported');
    }

    const allocationUsd = roundToCents(totalBankroll * weightFraction);
    const maxRiskUsd = allocation.maxRiskPct != null ? roundToCents(totalBankroll * (allocation.maxRiskPct / 100)) : null;

    return {
      strategyId: allocation.strategyId,
      requestedRunMode: requestedMode,
      finalRunMode: finalMode,
      weightPct,
      normalizedWeightPct: normalizedWeight,
      bankrollUsd: totalBankroll,
      allocationUsd,
      maxRiskUsd,
      enabled: true,
      reason: undefined,
    };
  });

  return {
    entries,
    totalRequestedWeightPct,
    normalized,
  };
}

function inferDefaultMode(clientConfig: ClientConfig): StrategyRunMode {
  if (clientConfig.operations.paperOnly) return 'paper';
  if (clientConfig.operations.allowLiveTrading === false) return 'paper';
  return 'live';
}

function resolveRunMode(
  strategySupportsPaper: boolean,
  strategySupportsLive: boolean,
  requested: StrategyRunMode,
  paperOnly: boolean | undefined
): StrategyRunMode | null {
  if (requested === 'summary') return 'summary';
  if (paperOnly || !strategySupportsLive) {
    return strategySupportsPaper ? 'paper' : null;
  }
  if (requested === 'live') {
    return strategySupportsLive ? 'live' : strategySupportsPaper ? 'paper' : null;
  }
  if (requested === 'paper') {
    return strategySupportsPaper ? 'paper' : strategySupportsLive ? 'live' : null;
  }
  return null;
}

function computeWeightFraction(weightPct: number, totalWeightPct: number, enabledCount: number): number {
  if (totalWeightPct > 0) {
    return weightPct / totalWeightPct;
  }
  if (enabledCount > 0) {
    return 1 / enabledCount;
  }
  return 0;
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function makeDisabledEntry(
  allocation: StrategyAllocationConfig,
  requestedMode: StrategyRunMode,
  bankrollUsd: number,
  reason: string
): PortfolioPlanEntry {
  return {
    strategyId: allocation.strategyId,
    requestedRunMode: requestedMode,
    finalRunMode: requestedMode,
    weightPct: allocation.weightPct,
    normalizedWeightPct: 0,
    bankrollUsd,
    allocationUsd: 0,
    maxRiskUsd: allocation.maxRiskPct != null ? roundToCents(bankrollUsd * (allocation.maxRiskPct / 100)) : null,
    enabled: false,
    reason,
  };
}
