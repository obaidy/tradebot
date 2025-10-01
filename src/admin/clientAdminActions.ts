import {
  ClientsRepository,
  ClientApiCredentialsRepository,
  ClientStrategySecretsRepository,
  ClientRow,
  ClientApiCredentialRow,
  ClientStrategySecretRow,
  ClientUpsertInput,
} from '../db/clientsRepo';
import { ClientStrategyAllocationsRepository } from '../db/clientStrategyAllocationsRepo';
import { ClientConfigService, StrategyAllocationConfig } from '../services/clientConfig';
import type { StrategyId, StrategyRunMode } from '../strategies/types';
import { getStrategyDefinition } from '../strategies';

export type UpsertClientInput = ClientUpsertInput;

export interface StoredCredentialSummary {
  clientId: string;
  exchangeName: string;
  createdAt: Date;
  hasPassphrase: boolean;
}

export function mapCredentialRow(row: ClientApiCredentialRow): StoredCredentialSummary {
  return {
    clientId: row.clientId,
    exchangeName: row.exchangeName,
    createdAt: row.createdAt,
    hasPassphrase: Boolean(row.passphraseEnc),
  };
}

export async function fetchClients(clientsRepo: ClientsRepository): Promise<ClientRow[]> {
  return clientsRepo.listAll();
}

export async function fetchClientSnapshot(
  clientsRepo: ClientsRepository,
  credsRepo: ClientApiCredentialsRepository,
  clientId: string
) {
  const client = await clientsRepo.findById(clientId);
  if (!client) {
    throw new Error(`Client ${clientId} not found`);
  }
  const credentials = await credsRepo.listByClient(clientId);
  return {
    client,
    credentials: credentials.map(mapCredentialRow),
  };
}

export async function upsertClientRecord(
  clientsRepo: ClientsRepository,
  input: UpsertClientInput
): Promise<ClientRow> {
  return clientsRepo.upsert(input);
}

export async function listClientCredentials(
  credsRepo: ClientApiCredentialsRepository,
  clientId: string
): Promise<StoredCredentialSummary[]> {
  const rows = await credsRepo.listByClient(clientId);
  return rows.map(mapCredentialRow);
}

export async function storeClientCredentials(
  configService: ClientConfigService,
  input: {
    clientId: string;
    exchangeName: string;
    apiKey: string;
    apiSecret: string;
    passphrase?: string | null;
  }
): Promise<StoredCredentialSummary> {
  const row = await configService.storeExchangeCredentials({
    clientId: input.clientId,
    exchangeName: input.exchangeName,
    apiKey: input.apiKey,
    apiSecret: input.apiSecret,
    passphrase: input.passphrase ?? null,
  });
  return mapCredentialRow(row);
}

export async function deleteClientCredentials(
  credsRepo: ClientApiCredentialsRepository,
  clientId: string,
  exchangeName: string
) {
  await credsRepo.delete(clientId, exchangeName);
}

export interface StrategySecretSummary {
  clientId: string;
  strategyId: string;
  hasSecret: boolean;
  address?: string;
  updatedAt?: Date;
  metadata?: Record<string, unknown> | null;
}

export function mapStrategySecret(row: ClientStrategySecretRow | null): StrategySecretSummary {
  if (!row) {
    return { clientId: '', strategyId: '', hasSecret: false, metadata: null };
  }
  const metadata = row.metadata ?? {};
  const address = typeof metadata.address === 'string' ? metadata.address : undefined;
  return {
    clientId: row.clientId,
    strategyId: row.strategyId,
    hasSecret: true,
    address,
    updatedAt: row.updatedAt,
    metadata,
  };
}

export async function fetchStrategySecretSummary(
  secretsRepo: ClientStrategySecretsRepository,
  clientId: string,
  strategyId: string
): Promise<StrategySecretSummary> {
  const row = await secretsRepo.get(clientId, strategyId);
  if (!row) {
    return { clientId, strategyId, hasSecret: false };
  }
  const base = mapStrategySecret(row);
  return { ...base, clientId, strategyId };
}

export async function storeStrategySecretRecord(
  configService: ClientConfigService,
  input: { clientId: string; strategyId: string; secret: string; metadata?: Record<string, unknown> | null }
): Promise<StrategySecretSummary> {
  const row = await configService.storeStrategySecret(input);
  const summary = mapStrategySecret(row);
  return { ...summary, clientId: row.clientId, strategyId: row.strategyId };
}

export async function deleteStrategySecretRecord(
  configService: ClientConfigService,
  clientId: string,
  strategyId: string
) {
  await configService.deleteStrategySecret(clientId, strategyId);
}

export interface StrategyAllocationSummary {
  strategyId: StrategyId;
  weightPct: number;
  maxRiskPct?: number | null;
  runMode?: StrategyRunMode | null;
  enabled: boolean;
  config?: Record<string, unknown> | null;
  updatedAt: Date;
}

function mapAllocationRow(row: { strategyId: StrategyId; weightPct: number; maxRiskPct: number | null; runMode: StrategyRunMode | null; enabled: boolean; configJson: Record<string, unknown> | null; updatedAt: Date; }): StrategyAllocationSummary {
  return {
    strategyId: row.strategyId,
    weightPct: Number(row.weightPct),
    maxRiskPct: row.maxRiskPct != null ? Number(row.maxRiskPct) : null,
    runMode: row.runMode ?? null,
    enabled: row.enabled,
    config: row.configJson ?? null,
    updatedAt: row.updatedAt,
  };
}

export async function listClientStrategyAllocations(
  repo: ClientStrategyAllocationsRepository,
  clientId: string
): Promise<StrategyAllocationSummary[]> {
  const rows = await repo.listByClient(clientId);
  return rows.map(mapAllocationRow);
}

interface AllocationInput {
  strategyId: StrategyId;
  weightPct: number;
  maxRiskPct?: number | null;
  runMode?: StrategyRunMode | null;
  enabled?: boolean;
  config?: Record<string, unknown> | null;
}

function normalizeAllocationInput(input: any): AllocationInput {
  const strategyId = String(input.strategyId ?? input.strategy_id ?? '').trim() as StrategyId;
  const weightPct = Number(input.weightPct ?? input.weight_pct);
  const maxRiskPct = input.maxRiskPct ?? input.max_risk_pct;
  const runMode = input.runMode ?? input.run_mode ?? null;
  return {
    strategyId,
    weightPct,
    maxRiskPct: maxRiskPct != null ? Number(maxRiskPct) : null,
    runMode: runMode ? (String(runMode).toLowerCase() as StrategyRunMode) : null,
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : true,
    config: input.config ?? null,
  };
}

function validateAllocationInput(allocation: AllocationInput) {
  if (!allocation.strategyId) {
    throw new Error('strategy_id_required');
  }
  if (!Number.isFinite(allocation.weightPct) || allocation.weightPct < 0) {
    throw new Error('weight_pct_invalid');
  }
  const strategy = getStrategyDefinition(allocation.strategyId);
  if (!strategy) {
    throw new Error(`unknown_strategy:${allocation.strategyId}`);
  }
  if (allocation.maxRiskPct != null && (!Number.isFinite(allocation.maxRiskPct) || allocation.maxRiskPct < 0)) {
    throw new Error('max_risk_pct_invalid');
  }
  if (allocation.runMode && !['live', 'paper', 'summary'].includes(allocation.runMode)) {
    throw new Error('run_mode_invalid');
  }
}

export async function replaceClientStrategyAllocations(
  repo: ClientStrategyAllocationsRepository,
  clientId: string,
  payloadAllocations: any[]
): Promise<StrategyAllocationSummary[]> {
  if (!Array.isArray(payloadAllocations)) {
    throw new Error('allocations_array_required');
  }

  const normalized = payloadAllocations.map(normalizeAllocationInput);
  if (!normalized.length) {
    throw new Error('allocations_empty');
  }

  normalized.forEach(validateAllocationInput);

  const totalWeight = normalized
    .filter((allocation) => allocation.enabled !== false)
    .reduce((sum, allocation) => sum + allocation.weightPct, 0);
  if (totalWeight <= 0) {
    throw new Error('weight_sum_invalid');
  }

  const existing = await repo.listByClient(clientId);
  const seen = new Set<string>();

  for (const allocation of normalized) {
    await repo.upsert({
      clientId,
      strategyId: allocation.strategyId,
      weightPct: allocation.weightPct,
      maxRiskPct: allocation.maxRiskPct ?? null,
      runMode: allocation.runMode ?? null,
      enabled: allocation.enabled ?? true,
      config: allocation.config ?? null,
    });
    seen.add(allocation.strategyId);
  }

  for (const row of existing) {
    if (!seen.has(row.strategyId)) {
      await repo.delete(clientId, row.strategyId);
    }
  }

  const updated = await repo.listByClient(clientId);
  return updated.map(mapAllocationRow);
}

export async function deleteClientStrategyAllocation(
  repo: ClientStrategyAllocationsRepository,
  clientId: string,
  strategyId: StrategyId
): Promise<void> {
  await repo.delete(clientId, strategyId);
}
