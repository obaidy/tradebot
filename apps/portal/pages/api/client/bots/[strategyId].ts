import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { fetchClientPortfolio, fetchClientSnapshot, updateClientPortfolio } from '../../../../lib/adminClient';
import { getSessionClientId } from '../../../../lib/sessionClient';
import type { ClientSnapshot } from '../../../../types/portal';

type PortfolioAllocation = {
  strategyId: string;
  weightPct: number;
  runMode: string;
  maxRiskPct?: number | null;
  enabled?: boolean;
  config?: Record<string, unknown> | null;
  updatedAt?: string | null;
};

type ClientPortfolio = {
  allocations?: PortfolioAllocation[];
};

function normalizeAllocations(portfolio: ClientPortfolio | null): PortfolioAllocation[] {
  const allocations = portfolio?.allocations ?? [];
  return allocations.map((allocation) => ({
    strategyId: allocation.strategyId,
    weightPct: allocation.weightPct,
    maxRiskPct: allocation.maxRiskPct ?? null,
    runMode: allocation.runMode ?? 'paper',
    enabled: allocation.enabled,
    config: allocation.config ?? null,
    updatedAt: allocation.updatedAt ?? null,
  }));
}

async function saveAllocations(clientId: string, allocations: PortfolioAllocation[], actor: string) {
  await updateClientPortfolio(clientId, { allocations }, actor);
  const nextPortfolio = (await fetchClientPortfolio(clientId)) as ClientPortfolio | null;
  const normalizedAllocations = nextPortfolio?.allocations ?? [];
  return normalizedAllocations.map((allocation) => ({
    strategyId: allocation.strategyId,
    weightPct: allocation.weightPct,
    runMode: allocation.runMode ?? 'paper',
    enabled: allocation.enabled,
    config: allocation.config ?? null,
    updatedAt: allocation.updatedAt ?? null,
  }));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const clientId = getSessionClientId(session);
  if (!clientId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const strategyId = Array.isArray(req.query.strategyId) ? req.query.strategyId[0] : req.query.strategyId;
  if (!strategyId) {
    res.status(400).json({ error: 'strategy_id_required' });
    return;
  }
  const actor = session?.user?.email ?? clientId;
  if (req.method === 'PATCH') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
      const portfolio = (await fetchClientPortfolio(clientId)) as ClientPortfolio | null;
      const allocations = normalizeAllocations(portfolio);
      const target = allocations.find((allocation) => allocation.strategyId === strategyId);
      if (!target) {
        res.status(404).json({ error: 'bot_not_found' });
        return;
      }
      if (body.enabled !== undefined) {
        target.enabled = Boolean(body.enabled);
      }
      if (body.mode === 'live' || body.mode === 'paper') {
        target.runMode = body.mode;
        target.config = { ...(target.config ?? {}), mode: body.mode };
      }
      if (typeof body.pair === 'string' && body.pair.trim().length) {
        target.config = { ...(target.config ?? {}), pair: body.pair.trim() };
      }
      if (typeof body.riskPreset === 'string' && body.riskPreset.trim().length) {
        target.config = { ...(target.config ?? {}), riskPreset: body.riskPreset.trim() };
      }
      if (body.allocationUsd !== undefined) {
        const allocationUsd = Number(body.allocationUsd);
        if (!Number.isFinite(allocationUsd) || allocationUsd <= 0) {
          res.status(400).json({ error: 'allocation_invalid' });
          return;
        }
        const snapshot = (await fetchClientSnapshot(clientId)) as ClientSnapshot | null;
        const bankrollUsd =
          Number(((snapshot?.client?.limits ?? {}) as any)?.risk?.bankrollUsd) ||
          Number((snapshot?.client as any)?.bankrollUsd) ||
          1000;
        const weightPct = Math.min(100, Math.max(1, Math.round((allocationUsd / bankrollUsd) * 100)));
        target.weightPct = weightPct;
        target.config = { ...(target.config ?? {}), allocationUsd };
      }
      const bots = await saveAllocations(clientId, allocations, actor);
      res.status(200).json({ bots });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'bot_update_failed' });
    }
    return;
  }
  if (req.method === 'DELETE') {
    try {
      const portfolio = (await fetchClientPortfolio(clientId)) as ClientPortfolio | null;
      const allocations = normalizeAllocations(portfolio).filter(
        (allocation) => allocation.strategyId !== strategyId
      );
      const bots = await saveAllocations(clientId, allocations, actor);
      res.status(200).json({ bots });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'bot_delete_failed' });
    }
    return;
  }
  res.status(405).json({ error: 'method_not_allowed' });
}
