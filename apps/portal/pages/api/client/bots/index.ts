import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { fetchClientPortfolio, fetchClientSnapshot, updateClientPortfolio } from '../../../../lib/adminClient';
import { getSessionClientId } from '../../../../lib/sessionClient';
import type { ClientSnapshot, PortfolioAllocation } from '../../../../types/portal';

function computeWeightPct(allocationUsd: number, bankrollUsd: number) {
  if (!Number.isFinite(allocationUsd) || allocationUsd <= 0) return 0;
  if (!Number.isFinite(bankrollUsd) || bankrollUsd <= 0) return 100;
  return Math.min(100, Math.max(1, Math.round((allocationUsd / bankrollUsd) * 100)));
}

async function listBots(clientId: string) {
  const portfolio = (await fetchClientPortfolio(clientId)) as { allocations?: PortfolioAllocation[] } | null;
  const allocations = portfolio?.allocations ?? [];
  return allocations.map((allocation) => ({
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
  if (req.method === 'GET') {
    try {
      const bots = await listBots(clientId);
      res.status(200).json({ bots });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'bots_fetch_failed' });
    }
    return;
  }
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
      const strategyId = typeof body.strategyId === 'string' ? body.strategyId : '';
      const pair = typeof body.pair === 'string' ? body.pair : '';
      const allocationUsd = Number(body.allocationUsd);
      const mode = body.mode === 'live' ? 'live' : 'paper';
      const riskPreset = typeof body.riskPreset === 'string' ? body.riskPreset : 'balanced';
      const exchangeId = typeof body.exchangeId === 'string' ? body.exchangeId : 'binance';
      if (!strategyId) {
        res.status(400).json({ error: 'strategy_id_required' });
        return;
      }
      if (!pair) {
        res.status(400).json({ error: 'pair_required' });
        return;
      }
      if (!Number.isFinite(allocationUsd) || allocationUsd <= 0) {
        res.status(400).json({ error: 'allocation_invalid' });
        return;
      }
      const snapshot = (await fetchClientSnapshot(clientId)) as ClientSnapshot | null;
      const bankrollUsd =
        Number(((snapshot?.client?.limits ?? {}) as any)?.risk?.bankrollUsd) ||
        Number((snapshot?.client as any)?.bankrollUsd) ||
        1000;
      const weightPct = computeWeightPct(allocationUsd, bankrollUsd);
      const portfolio = (await fetchClientPortfolio(clientId)) as { allocations?: PortfolioAllocation[] } | null;
      const existing = (portfolio?.allocations ?? []).filter((allocation) => allocation.strategyId !== strategyId);
      const actor = session?.user?.email ?? clientId;
      const nextAllocations = [
        ...existing.map((allocation: any) => ({
          strategyId: allocation.strategyId,
          weightPct: allocation.weightPct,
          maxRiskPct: allocation.maxRiskPct ?? null,
          runMode: allocation.runMode ?? null,
          enabled: allocation.enabled,
          config: allocation.config ?? allocation.configJson ?? null,
        })),
        {
          strategyId,
          weightPct,
          maxRiskPct: null,
          runMode: mode,
          enabled: true,
          config: {
            pair,
            allocationUsd,
            exchangeId,
            riskPreset,
            mode,
          },
        },
      ];
      await updateClientPortfolio(clientId, { allocations: nextAllocations }, actor);
      const bots = await listBots(clientId);
      res.status(201).json({ bots });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'bot_create_failed' });
    }
    return;
  }
  res.status(405).json({ error: 'method_not_allowed' });
}
