import { listStrategies, getStrategyDefinition } from '../../../src/strategies';
import { CONFIG } from '../../../src/config';
import type { StrategyDefinition } from '../../../src/strategies/registry';
import { pool } from '../../../src/db/pool';
import { ClientStrategyAllocationsRepository } from '../../../src/db/clientStrategyAllocationsRepo';

const strategyAllocationsRepo = new ClientStrategyAllocationsRepository(pool);

function resolvePlanId(clientId: string): string {
  const defaultPlan = CONFIG.MOBILE?.DEFAULT_PLAN ?? 'starter';
  return defaultPlan;
}

function filterStrategiesByPlan(planId: string, registry: StrategyDefinition[]): StrategyDefinition[] {
  const normalised = planId.toLowerCase();
  return registry.filter((definition) =>
    definition.allowedPlans.some((allowed) => String(allowed).toLowerCase() === normalised)
  );
}

export async function listStrategiesForClient(clientId: string) {
  const registry = listStrategies();
  const planId = resolvePlanId(clientId);
  const allowed = filterStrategiesByPlan(planId, registry);
  const allocations = await strategyAllocationsRepo.listByClient(clientId);
  const allocationByStrategy = new Map<string, (typeof allocations)[number]>();
  allocations.forEach((allocation) => allocationByStrategy.set(allocation.strategyId, allocation));

  return allowed.map((definition) => {
    const allocation = allocationByStrategy.get(definition.id);
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      supportsPaper: definition.supportsPaper,
      supportsLive: definition.supportsLive,
      status: definition.status,
      hasAllocation: Boolean(allocation),
      allocation,
    };
  });
}

export async function updateClientStrategyAllocation(clientId: string, strategyId: string, input: any) {
  const definition = getStrategyDefinition(strategyId as any);
  if (!definition) {
    throw new Error('unknown_strategy');
  }
  const weightPct = Number(input.weightPct ?? input.weight_pct ?? 0);
  const maxRiskPct = input.maxRiskPct ?? input.max_risk_pct ?? null;
  const enabled = input.enabled ?? true;
  const runMode = input.runMode ?? input.run_mode ?? (definition.supportsLive ? 'live' : 'paper');
  const updated = await strategyAllocationsRepo.upsert({
    clientId,
    strategyId,
    weightPct,
    enabled,
    runMode,
    maxRiskPct: typeof maxRiskPct === 'number' ? maxRiskPct : null,
    config: input.config ?? null,
  });
  return updated;
}

export async function deleteClientStrategyAllocationById(clientId: string, strategyId: string) {
  await strategyAllocationsRepo.delete(clientId, strategyId);
}
